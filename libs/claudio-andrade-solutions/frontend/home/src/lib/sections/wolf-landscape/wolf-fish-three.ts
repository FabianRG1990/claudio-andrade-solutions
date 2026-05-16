// Renderer Three.js + GLB para los peces del lago.
//
// CONECTA EL MESH 3D A LA FÍSICA DEL SIMULADOR.
//
// El simulador (wolf-lake-canvas.ts) ya computa toda la fisica del nadado:
//   • FABRIK chain espacial (capa 8 argonaut) — chainJoints con bend limits
//   • Carangiform traveling wave — env(u^3) * amp * sin(swimPhase + k*xUnit)
//   • C-bend de giros (turnBend / delayedTurnBend con lag)
//   • Tail-lead overlapping action (Disney 12) via delayedTurnBend
//   • Asymmetric tail stroke durante turns
//   • Banking, rhythm jitter, ABZÛ envelope mask
//
// El renderer NO debe recomputar nada de esto — solo debe HACER QUE EL MESH
// SIGA LA CADENA. Como el PIXI MeshRope viejo: el mesh es un "rope deformable"
// que se drapa sobre los joints de la spine.
//
// Implementacion: PATH DEFORMATION por vertex shader. Cada frame:
//   1. CPU: aplica wave carangiform per-joint (igual formula que wolf-fish-pixi.ts)
//      y arma un array de 16 vec2 con la spine + wave en coords screen-centered.
//   2. GPU vertex shader: cada vertex usa su X mesh-local como "body parameter t"
//      (head a +0.5, tail a -0.5), busca su posicion en la spine usando arc-length
//      parameterization, y se planta perpendicular a la spine.
//
// El mesh tiene transform IDENTIDAD — el shader posiciona cada vertex en world
// coords directamente. No hay group/yaw/tilt parents — todo via uniforms.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const FISH_GLB_URL = '/hero-wolf/fish-model.glb';

// Maximo de joints en la spine. La cadena del simulador tiene tipicamente
// 13 (GLOW_BODY_PROFILE.length); reservamos 16 para padding.
const MAX_SPINE = 16;

// Angulo de tilt del dorso del pez hacia la camara. ~45° = vista elevada
// natural (entre full top-down y pure side). Aplica per-vertex en el shader
// — el "up" del pez (mesh local Y) se descompone en sin(elev) screen-up +
// cos(elev) out-of-screen.
const ELEV_PITCH = THREE.MathUtils.degToRad(45);
const SIN_E = Math.sin(ELEV_PITCH);
const COS_E = Math.cos(ELEV_PITCH);

// Constantes del wave carangiform — replica exacta de wolf-fish-pixi.ts.
const WAVES_PER_BODY = 0.95;
const WAVE_ENV_POWER = 3.0;
const X_NOSE_UNIT = 2.20;
const X_TAIL_UNIT = -1.55;
const BODY_LEN_UNIT = X_NOSE_UNIT - X_TAIL_UNIT; // 3.75
const K_WAVE = (Math.PI * 2 * WAVES_PER_BODY) / BODY_LEN_UNIT;

// fish.size * FACTOR * depthScale = caracteristic body length en canvas px.
const SPRITE_SIZE_FACTOR = 7.0;

export interface Vec { x: number; y: number; }

/** GlowFish satisface esta interfaz. Solo necesitamos campos que el simulador
 *  ya produce — nada nuevo. */
export interface FishLike {
  size: number;
  heading: number;
  chainJoints: Vec[];
  swimPhase: number;
  bodyEffort: number;
  swimGateLagged: number;
  dorsalSide: 1 | -1;
}

interface FishUniforms {
  // Spine en screen-centered coords (origen al centro del canvas, Y up):
  // uSpine[i*2] = X, uSpine[i*2+1] = Y. Maximo 16 joints.
  uSpine: { value: Float32Array };
  // Arc-length cumulativo por joint. uSegLen[0] = 0, uSegLen[i] = sum de
  // |segment[0..i-1]|. Usado para mapear bodyT a posicion arclength en la spine.
  uSegLen: { value: Float32Array };
  // Cantidad real de joints en uso (N <= MAX_SPINE).
  uSegN: { value: number };
  // Longitud total de la spine (= uSegLen[N-1]).
  uSpineTotal: { value: number };
  // Escala del mesh: pixels canvas por unidad de modelo. Aplica a vertex.y
  // (dorsal) y vertex.z (lateral). El vertex.x se mapea via body param.
  uMeshScale: { value: number };
  // Cosenos de elev pitch — para descomponer mesh-Y en (screen-up, depth).
  uSinE: { value: number };
  uCosE: { value: number };
}

export interface FishHandle {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  uniforms: FishUniforms;
}

export class FishThreeRenderer {
  private readonly numJoints: number;

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.OrthographicCamera;
  private envTexture: THREE.Texture | null = null;

  private canvasW = 1;
  private canvasH = 1;

  private baseGeometry: THREE.BufferGeometry | null = null;
  private baseMaterial: THREE.MeshStandardMaterial | null = null;

  private readonly handles: FishHandle[] = [];

  constructor(numJoints: number) {
    this.numJoints = numJoints;
  }

  async init(canvas: HTMLCanvasElement, width: number, height: number): Promise<void> {
    this.canvasW = width;
    this.canvasH = height;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene = new THREE.Scene();

    // Ortho centrada, frustum = canvas px. World Y up (= screen up).
    this.camera = new THREE.OrthographicCamera(
      -width / 2, width / 2,
      height / 2, -height / 2,
      -10000, 10000,
    );
    this.camera.position.set(0, 0, 1000);
    this.camera.lookAt(0, 0, 0);

    // Iluminacion submarina.
    this.scene.add(new THREE.AmbientLight(0xc8d8ff, 0.85));
    const key = new THREE.DirectionalLight(0xfff2dd, 1.6);
    key.position.set(0.3, 1.0, 0.5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x6090ff, 0.9);
    rim.position.set(-0.4, 0.2, -0.6);
    this.scene.add(rim);
    this.scene.add(new THREE.HemisphereLight(0x90b4ff, 0x102040, 0.6));

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x90b4ff);
    this.envTexture = pmrem.fromScene(envScene, 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.envTexture;

    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(FISH_GLB_URL);

    let foundMesh: THREE.Mesh | null = null;
    gltf.scene.traverse((obj) => {
      if (!foundMesh && (obj as THREE.Mesh).isMesh) {
        foundMesh = obj as THREE.Mesh;
      }
    });
    if (!foundMesh) throw new Error('FishThreeRenderer: no mesh found in GLB');

    const meshObj = foundMesh as THREE.Mesh;
    this.baseGeometry = meshObj.geometry;
    this.baseMaterial = meshObj.material as THREE.MeshStandardMaterial;

    this.baseMaterial.metalness = 0.60;
    this.baseMaterial.roughness = 0.30;
    this.baseMaterial.envMapIntensity = 1.6;
    this.baseMaterial.emissive = new THREE.Color(0x4a6890);
    this.baseMaterial.emissiveIntensity = 0.55;
    this.baseMaterial.color = new THREE.Color(0xb8c8e0);
    this.baseMaterial.needsUpdate = true;
  }

  addFish(): FishHandle {
    if (!this.baseGeometry || !this.baseMaterial) {
      throw new Error('FishThreeRenderer: init() not completed');
    }

    const material = this.baseMaterial.clone();
    const uniforms: FishUniforms = {
      uSpine: { value: new Float32Array(MAX_SPINE * 2) },
      uSegLen: { value: new Float32Array(MAX_SPINE) },
      uSegN: { value: this.numJoints },
      uSpineTotal: { value: 100 },
      uMeshScale: { value: 140 },
      uSinE: { value: SIN_E },
      uCosE: { value: COS_E },
    };
    material.userData = { uniforms };

    material.onBeforeCompile = (shader) => {
      shader.uniforms['uSpine'] = uniforms.uSpine;
      shader.uniforms['uSegLen'] = uniforms.uSegLen;
      shader.uniforms['uSegN'] = uniforms.uSegN;
      shader.uniforms['uSpineTotal'] = uniforms.uSpineTotal;
      shader.uniforms['uMeshScale'] = uniforms.uMeshScale;
      shader.uniforms['uSinE'] = uniforms.uSinE;
      shader.uniforms['uCosE'] = uniforms.uCosE;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
        uniform vec2 uSpine[${MAX_SPINE}];
        uniform float uSegLen[${MAX_SPINE}];
        uniform float uSegN;
        uniform float uSpineTotal;
        uniform float uMeshScale;
        uniform float uSinE;
        uniform float uCosE;
        `,
      );

      // Reemplaza begin_vertex (donde se inicializa transformed) por nuestro
      // calculo path-deformed. transformed queda en WORLD coords — el mesh
      // tiene modelMatrix identidad asi que se usa directamente.
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        // Body parameter: 0 en cabeza (vertex.x = +0.5), 1 en cola (vertex.x = -0.5)
        float bodyT = clamp(0.5 - position.x, 0.0, 1.0);
        // Distancia objetivo sobre la spine (en canvas px).
        float targetDist = bodyT * uSpineTotal;

        // Busca el segmento de spine que contiene targetDist. Linear scan
        // sobre maximo 15 segmentos — barato (~30 ops en peor caso).
        // Defaults al ultimo segmento valido por si targetDist == uSpineTotal.
        int segIdx = int(uSegN) - 2;
        for (int i = 0; i < ${MAX_SPINE - 1}; i++) {
          if (float(i + 1) >= uSegN) { segIdx = i - 1; break; }
          if (uSegLen[i + 1] >= targetDist) { segIdx = i; break; }
        }
        segIdx = max(segIdx, 0);

        vec2 spineA = uSpine[segIdx];
        vec2 spineB = uSpine[segIdx + 1];
        float segStart = uSegLen[segIdx];
        float segEnd = uSegLen[segIdx + 1];
        float segLen = max(0.0001, segEnd - segStart);
        float localT = clamp((targetDist - segStart) / segLen, 0.0, 1.0);

        vec2 spinePos = mix(spineA, spineB, localT);
        // Tangente unitaria del segmento; perp CCW para que vertex +Z mesh
        // caiga al lado correcto del cuerpo.
        vec2 tangent = normalize(spineB - spineA + vec2(1e-6, 0.0));
        vec2 perp = vec2(-tangent.y, tangent.x);

        // Mesh-local Y (dorsal) y Z (lateral) escalados a canvas px.
        float dorsal = position.y * uMeshScale;
        float lateral = position.z * uMeshScale;

        // World position:
        //   X = spine.x + perp.x * lateral
        //   Y (screen) = spine.y + perp.y * lateral + dorsal * sin(elev)
        //   Z (depth) = dorsal * cos(elev) — out-of-screen, da volumen al pez
        //               cuando hay env reflection / specular
        vec3 transformed = vec3(
          spinePos.x + perp.x * lateral,
          spinePos.y + perp.y * lateral + dorsal * uSinE,
          dorsal * uCosE
        );
        `,
      );
    };

    const mesh = new THREE.Mesh(this.baseGeometry, material);
    mesh.frustumCulled = false;
    // Mesh transform identidad — el shader escribe world coords directamente.
    mesh.matrixAutoUpdate = false;
    this.scene.add(mesh);

    const handle: FishHandle = { mesh, material, uniforms };
    this.handles.push(handle);
    return handle;
  }

  updateFish(handle: FishHandle, fish: FishLike, depthScale: number): void {
    const N = Math.min(fish.chainJoints.length, MAX_SPINE);
    if (N < 2) return;

    // ─── Carangiform wave: misma formula que wolf-fish-pixi.ts (que funcionaba) ─
    const viewMorph = Math.sin(fish.heading) ** 2;
    const viewAmpBoost = 1 + 0.7 * viewMorph;
    const ampPx = fish.size
      * (0.04 + 0.18 * fish.bodyEffort)
      * viewAmpBoost
      * fish.swimGateLagged;

    const halfW = this.canvasW / 2;
    const halfH = this.canvasH / 2;

    const spine = handle.uniforms.uSpine.value;
    const segLen = handle.uniforms.uSegLen.value;

    let prevX = 0;
    let prevY = 0;
    let cum = 0;
    segLen[0] = 0;

    const joints = fish.chainJoints;

    for (let i = 0; i < N; i++) {
      const j = joints[i];
      // Tangente local al spine (de vecinos del chain).
      let tx: number;
      let ty: number;
      if (i === 0) {
        tx = joints[1].x - j.x;
        ty = joints[1].y - j.y;
      } else if (i === N - 1) {
        tx = j.x - joints[N - 2].x;
        ty = j.y - joints[N - 2].y;
      } else {
        tx = joints[i + 1].x - joints[i - 1].x;
        ty = joints[i + 1].y - joints[i - 1].y;
      }
      const tlen = Math.hypot(tx, ty) || 1;
      tx /= tlen;
      ty /= tlen;
      // Perp CCW para wave perpendicular.
      const pxN = -ty;
      const pyN = tx;

      // xUnit aproximado lineal (replica PIXI: joints uniformes en body profile).
      const xUnit = X_NOSE_UNIT + (X_TAIL_UNIT - X_NOSE_UNIT) * (i / (N - 1));
      const u = (X_NOSE_UNIT - xUnit) / BODY_LEN_UNIT; // 0 head -> 1 tail
      const env = Math.pow(u, WAVE_ENV_POWER);
      const wave = env * ampPx * Math.sin(fish.swimPhase + K_WAVE * xUnit);

      // Joint con wave perpendicular (en canvas px world coords).
      const wx = j.x + pxN * wave;
      const wy = j.y + pyN * wave;

      // Screen-centered: origen al centro del canvas, Y flipped (canvas down -> world up).
      const sx = wx - halfW;
      const sy = halfH - wy;

      spine[i * 2] = sx;
      spine[i * 2 + 1] = sy;

      if (i > 0) {
        cum += Math.hypot(sx - prevX, sy - prevY);
        segLen[i] = cum;
      }
      prevX = sx;
      prevY = sy;
    }

    // Pad resto del array con ultimo punto (para que el shader no acceda basura).
    for (let i = N; i < MAX_SPINE; i++) {
      spine[i * 2] = prevX;
      spine[i * 2 + 1] = prevY;
      segLen[i] = cum;
    }

    // ─── Normaliza el spine a longitud objetivo ──────────────────────────
    // La cadena del simulador es ~size * (xNose - xTail) ≈ size * 3.75 px,
    // que NO depende de depthScale. Las dim Y/Z del mesh SI dependen de
    // depthScale (via meshScale). Sin normalizar, la longitud del cuerpo
    // queda constante mientras la altura cambia con depth → al alejarse
    // (depth bajo, mas arriba en pantalla) el pez se ve "alargado/serpiente"
    // porque altura cae pero largo no.
    //
    // Fix: escalar el spine RELATIVO A LA CABEZA por el mismo factor que
    // usamos para Y/Z. Asi length y height escalan juntas, aspect ratio
    // constante = el modelo (2.3:1). Mismo trick que PIXI hacia con
    // norm = bboxW/pathLen + meshScale = targetW/bboxW.
    const targetBodyLen = fish.size * SPRITE_SIZE_FACTOR * depthScale;
    const scaleFactor = cum > 0.01 ? targetBodyLen / cum : 1;
    if (Math.abs(scaleFactor - 1) > 0.001) {
      const headX = spine[0];
      const headY = spine[1];
      for (let i = 1; i < MAX_SPINE; i++) {
        spine[i * 2] = (spine[i * 2] - headX) * scaleFactor + headX;
        spine[i * 2 + 1] = (spine[i * 2 + 1] - headY) * scaleFactor + headY;
        segLen[i] *= scaleFactor;
      }
      cum *= scaleFactor;
    }

    handle.uniforms.uSegN.value = N;
    handle.uniforms.uSpineTotal.value = cum;
    handle.uniforms.uMeshScale.value = targetBodyLen;
  }

  resize(width: number, height: number): void {
    this.canvasW = width;
    this.canvasH = height;
    this.renderer.setSize(width, height, false);
    this.camera.left = -width / 2;
    this.camera.right = width / 2;
    this.camera.top = height / 2;
    this.camera.bottom = -height / 2;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  destroy(): void {
    for (const h of this.handles) {
      this.scene.remove(h.mesh);
      h.material.dispose();
    }
    this.handles.length = 0;
    this.baseGeometry?.dispose();
    if (this.baseMaterial) {
      this.baseMaterial.map?.dispose();
      this.baseMaterial.normalMap?.dispose();
      this.baseMaterial.roughnessMap?.dispose();
      this.baseMaterial.metalnessMap?.dispose();
      this.baseMaterial.dispose();
    }
    this.envTexture?.dispose();
    this.renderer.dispose();
  }
}
