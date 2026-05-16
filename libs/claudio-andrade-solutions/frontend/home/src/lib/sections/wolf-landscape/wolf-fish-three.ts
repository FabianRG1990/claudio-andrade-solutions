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
// Solo tipos (los addons fallan en SSR si son static imports — abajo van con
// dynamic import dentro de init()).
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import type { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

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
  // Bounding box del mesh local (pre-deformacion). El fragment normaliza
  // vLocalPos con esto para pintar neon lines en coords body-relative
  // [0,1] consistentes a lo largo de cualquier mesh.
  uMeshMin: { value: THREE.Vector3 };
  uMeshMax: { value: THREE.Vector3 };
}

export interface FishHandle {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  uniforms: FishUniforms;
  // Sistema de luces overlay independiente del shader del body.
  // Cada pez tiene un Points mesh con N vertices (uno por luz). El
  // material custom dibuja cada point como un circulo cyan HDR brillante
  // que el bloom captura. Las posiciones se calculan frame por frame en
  // JS usando la misma matematica de path-deformation que el vertex
  // shader del body → las luces siguen las curvas del cuerpo.
  lightsGeometry: THREE.BufferGeometry;
  lightsMesh: THREE.Points;
}

/** Posiciones de las luces en coords mesh-local (head=+X, dorsal=+Y,
 *  lateral=+Z). Cada feature se renderiza en AMBOS lados del cuerpo
 *  (z positivo + z negativo) para que se vea desde cualquier angulo
 *  de giro del pez. */
interface LightDef {
  /** Posicion mesh-local en la mitad +Z; el otro lado se hace en runtime. */
  pos: { x: number; y: number; z: number };
  /** Tamaño relativo al pez (1.0 = ~10% body length). */
  size: number;
}

const LIGHT_DEFS: LightDef[] = [
  // Solo el ojo por ahora — primero validamos visualmente que se ve.
  // z=0.06 = pegado al body (no fuera del silhouette). El cuerpo en
  // la cabeza es ~7% wide, asi que 0.06 cae justo en la superficie.
  { pos: { x: 0.40, y: 0.04, z: 0.06 }, size: 1.0 },
];

export class FishThreeRenderer {
  private readonly numJoints: number;

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.OrthographicCamera;
  private envTexture: THREE.Texture | null = null;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;

  private canvasW = 1;
  private canvasH = 1;

  private baseGeometry: THREE.BufferGeometry | null = null;
  private baseMaterial: THREE.MeshStandardMaterial | null = null;
  // Material compartido para todas las luces overlay (todos los peces).
  // Custom shader: vertex pasa MVP + setea gl_PointSize segun aSize attr;
  // fragment dibuja circulo cyan HDR brillante usando gl_PointCoord.
  // AdditiveBlending + depthTest=false = siempre encima del body.
  private lightMaterial: THREE.ShaderMaterial | null = null;
  // Bounding box del mesh en coords locales — usado para normalizar el
  // body-local position en el fragment shader y poder pintar neon lines
  // proceduralmente en ubicaciones especificas del cuerpo (lateral line,
  // separator cabeza, panza, etc).
  private readonly meshMin = new THREE.Vector3();
  private readonly meshMax = new THREE.Vector3();

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
    this.renderer.toneMappingExposure = 1.0;

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

    // ─── Post-processing: bloom para emision de luz neon ───────────────
    // CRITICAL: este block debe ir DESPUES de this.camera setup (linea ~135).
    // Bug previo: composer creado antes del camera → RenderPass.camera =
    // undefined → renderer.render(scene, undefined) → camera.parent throws.
    //
    // Imports dinamicos: los addons de Three.js tocan WebGL APIs al cargar
    // el modulo y rompen SSR del Angular server-render si son static.
    const [
      { EffectComposer },
      { RenderPass },
      { UnrealBloomPass },
      { ShaderPass },
      { CopyShader },
    ] = await Promise.all([
      import('three/examples/jsm/postprocessing/EffectComposer.js'),
      import('three/examples/jsm/postprocessing/RenderPass.js'),
      import('three/examples/jsm/postprocessing/UnrealBloomPass.js'),
      import('three/examples/jsm/postprocessing/ShaderPass.js'),
      import('three/examples/jsm/shaders/CopyShader.js'),
    ]);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      3.20, // strength — bloom EXTREMO, las luces irradian al agua
      0.95, // radius — halo MUY amplio
      0.25, // threshold — capta cualquier pixel apenas brillante
    );
    this.composer.addPass(this.bloomPass);
    const copyPass = new ShaderPass(CopyShader);
    copyPass.renderToScreen = true;
    this.composer.addPass(copyPass);

    // ─── Light overlay material (shared entre todos los peces) ─────────
    // Renderiza cada vertex de un Points como un circulo cyan HDR
    // brillante. Independiente del shader del body — es geometria
    // separada que SIEMPRE aparece encima (depthTest=false). Esto
    // garantiza visibilidad. El bloom captura el cyan saturado y
    // genera halo dramatico igual al destello del rim.
    this.lightMaterial = new THREE.ShaderMaterial({
      uniforms: {
        // uPointBase = 8 px de diametro a base size 1.0. Con bloom
        // (strength 3.2) se ve como ojo brillante de ~8-10px = razonable
        // para un fish renderizado a ~100px. Mas grande = orb (mal).
        uPointBase: { value: 8.0 },
      },
      vertexShader: `
        uniform float uPointBase;
        attribute float aSize;
        void main() {
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uPointBase;
        }
      `,
      fragmentShader: `
        void main() {
          vec2 c = gl_PointCoord - vec2(0.5);
          float d = length(c) * 2.0;
          if (d > 1.0) discard;
          // Soft cyan disc — el point es chico, no necesita halo enorme;
          // el bloom global se encarga de eso.
          float core = pow(1.0 - smoothstep(0.0, 0.45, d), 2.0);
          vec3 cyan = vec3(0.55, 1.05, 1.95);
          vec3 col = cyan * core * 2.5;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });

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

    // Computa bounding box una sola vez. El fragment shader usa
    // (uMeshMin, uMeshMax) para mapear cualquier vLocalPos a coords
    // body-normalized [0,1]: bodyU = head→tail, dorsalV = belly→dorsal.
    // Con estas coords pintamos neon lines en ubicaciones fijas del cuerpo
    // (no dependen del path-deformation porque vLocalPos es pre-deformacion).
    this.baseGeometry.computeBoundingBox();
    const bbox = this.baseGeometry.boundingBox;
    if (bbox) {
      this.meshMin.copy(bbox.min);
      this.meshMax.copy(bbox.max);
      // eslint-disable-next-line no-console
      console.log('[FishThree] mesh bbox', this.meshMin.toArray(), this.meshMax.toArray());
    }

    // PBR robotic premium — matchea el reference image del usuario:
    //   • body chrome navy oscuro (texture del Tripo3D ya pinta navy)
    //   • neón cyan brillante en ojo + lateral line + accents (YA pintados
    //     en el baseColorTexture; activamos emissiveMap para que glow real)
    //   • rim light cyan en silueta (Fresnel inyectado en el shader abajo)
    //   • metal pulido con reflejos del env (metalness alto + envMap fuerte)
    this.baseMaterial.metalness = 0.95;
    this.baseMaterial.roughness = 0.22;
    this.baseMaterial.envMapIntensity = 2.2;
    this.baseMaterial.color = new THREE.Color(0xffffff); // sin tint — texture natural
    // baseColorTexture como emissiveMap: las zonas brillantes pintadas (ojo,
    // stripes neón, seams glow) emiten luz; las zonas oscuras (panels navy)
    // no. Multiplicador cyan empuja el tone hacia el azul electrico del ref.
    this.baseMaterial.emissiveMap = this.baseMaterial.map;
    // Intensity 1.0 + el threshold mask del shader (x6 boost solo en zonas
    // brillantes pintadas) hace que los neones se vean como luces de verdad.
    // El multiplicador cyan del emissive tinta el glow.
    this.baseMaterial.emissive = new THREE.Color(0x90c8ff);
    this.baseMaterial.emissiveIntensity = 1.0;
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
      uMeshMin: { value: this.meshMin.clone() },
      uMeshMax: { value: this.meshMax.clone() },
    };
    material.userData = { uniforms };

    material.onBeforeCompile = (shader) => {
      // eslint-disable-next-line no-console
      console.log('[FishThree] shader compile v10-eye-down-side');
      shader.uniforms['uSpine'] = uniforms.uSpine;
      shader.uniforms['uSegLen'] = uniforms.uSegLen;
      shader.uniforms['uSegN'] = uniforms.uSegN;
      shader.uniforms['uSpineTotal'] = uniforms.uSpineTotal;
      shader.uniforms['uMeshScale'] = uniforms.uMeshScale;
      shader.uniforms['uSinE'] = uniforms.uSinE;
      shader.uniforms['uCosE'] = uniforms.uCosE;
      shader.uniforms['uMeshMin'] = uniforms.uMeshMin;
      shader.uniforms['uMeshMax'] = uniforms.uMeshMax;

      // ─── Fragment <common>: varying + uniformes para neon procedural ────
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
        varying vec3 vLocalPos;
        uniform vec3 uMeshMin;
        uniform vec3 uMeshMax;
        `,
      );

      // Emisivo INTERNO (totalEmissiveRadiance) suave: aporta info correcta
      // de iluminacion al PBR. El glow visible viene del bloque ADITIVO
      // mas abajo. Threshold alto solo capta lo super brillante de la
      // textura (= ojos pintados); el resto del cuerpo navy queda neutro.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `
        #ifdef USE_EMISSIVEMAP
          vec4 emissiveTexel = texture2D(emissiveMap, vEmissiveMapUv);
          float emisLum = max(emissiveTexel.r, max(emissiveTexel.g, emissiveTexel.b));
          float neonMask = smoothstep(0.50, 0.80, emisLum);
          totalEmissiveRadiance *= emissiveTexel.rgb * neonMask * 3.0;
        #endif
        `,
      );

      // ─── Fragment: emision ADITIVA post-shading (BYPASS tone-mapping) ───
      // Aqui esta el "destello cyan" que al usuario le fascina. Tres fuentes
      // que se suman DIRECT a gl_FragColor antes del tone mapping ACES:
      //
      //  (1) NEON LINES PROCEDURAL — pintadas en el shader, NO en el texture
      //      (la texture del Tripo3D NO tiene estas lineas pintadas con la
      //      intensidad necesaria; solo tiene el ojo y panels navy). El
      //      shader las pinta segun coords body-local normalizadas, asi
      //      caen en las posiciones nombradas por el usuario:
      //        a) Separator vertical detras del ojo (head→body)
      //        b) Lateral line central (horizontal media-altura)
      //        c) Linea encima de la pectoral fin (horizontal lower-mid)
      //        d) Belly line (horizontal panza)
      //        e) Eye reinforcement (circulo brillante, ojo)
      //        f) Tail button (circulo brillante en la base de la cola)
      //
      //  (2) TEXTURE NEON BOOST — captura los ojos brillantes pintados en el
      //      texture (refuerza el eye procedural).
      //
      //  (3) FRESNEL RIM — destello en silueta (mas marcado en giros).
      //      Mantener: es el efecto que al usuario le encanta en giros.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <output_fragment>',
        `
        // ── Body-local normalized coords ────────────────────────────────
        // bodyU: 0=head, 1=tail   (cabeza esta en +X en este mesh Tripo3D)
        // dorsalV: 0=belly, 1=dorsal
        vec3 meshSize = uMeshMax - uMeshMin;
        float bodyU   = clamp((uMeshMax.x - vLocalPos.x) / max(meshSize.x, 1e-4), 0.0, 1.0);
        float dorsalV = clamp((vLocalPos.y - uMeshMin.y) / max(meshSize.y, 1e-4), 0.0, 1.0);

        // ── Fresnel del fragmento ───────────────────────────────────────
        // Mismo mecanismo que el rim light destello, usado como AMPLIFIER
        // de las luces neon en giros. Baseline ya es brillante (las luces
        // siempre estan on); cuando la curva del cuerpo esta rasante a la
        // camara, el fresnel x3 multiplica el brillo → destello dramatico.
        vec3 lnViewDir = normalize(vViewPosition);
        float lnNoV = max(0.0, dot(normalize(vNormal), lnViewDir));
        float lnFresnel = pow(1.0 - lnNoV, 2.0);
        float lineBoost = 1.0 + 3.0 * lnFresnel;

        // ── Neon procedural: lineas GRANDES y BRIGHT ───────────────────
        // Tamaños ~2x del intento anterior — a render scale ~100px el pez,
        // features 5%/15% del body son 5px/15px = visibles claramente.
        // Sin sideMask — las luces envuelven todo el cuerpo (la camara
        // de 45° pitch ve mayormente el lomo + algo del flanco superior).
        float lineCore = 0.0;
        float lineHalo = 0.0;

        // (a) Head/body separator: banda vertical detras del ojo (gruesa)
        {
          float dU = abs(bodyU - 0.24);
          float vM = smoothstep(0.15, 0.28, dorsalV) * (1.0 - smoothstep(0.72, 0.88, dorsalV));
          lineCore += (1.0 - smoothstep(0.040, 0.090, dU)) * vM * 3.50;
          lineHalo += (1.0 - smoothstep(0.090, 0.230, dU)) * vM * 1.40;
        }
        // (b) Lateral line central — horizontal media (mas larga y gruesa)
        {
          float uM = smoothstep(0.22, 0.30, bodyU) * (1.0 - smoothstep(0.58, 0.66, bodyU));
          float dV = abs(dorsalV - 0.58);
          lineCore += uM * (1.0 - smoothstep(0.040, 0.090, dV)) * 4.00;
          lineHalo += uM * (1.0 - smoothstep(0.090, 0.250, dV)) * 1.60;
        }
        // (c) Linea encima de la pectoral fin
        {
          float uM = smoothstep(0.32, 0.38, bodyU) * (1.0 - smoothstep(0.50, 0.58, bodyU));
          float dV = abs(dorsalV - 0.38);
          lineCore += uM * (1.0 - smoothstep(0.040, 0.090, dV)) * 3.50;
          lineHalo += uM * (1.0 - smoothstep(0.090, 0.240, dV)) * 1.40;
        }
        // (d) Belly line — horizontal panza (al ver desde arriba apenas
        // visible — se compensa con boost extra para que el halo trepe
        // sobre el flanco bajo y se note)
        {
          float uM = smoothstep(0.36, 0.44, bodyU) * (1.0 - smoothstep(0.58, 0.66, bodyU));
          float dV = abs(dorsalV - 0.22);
          lineCore += uM * (1.0 - smoothstep(0.040, 0.090, dV)) * 4.00;
          lineHalo += uM * (1.0 - smoothstep(0.090, 0.260, dV)) * 1.80;
        }
        // (e) Eye — circulo HOT GRANDE que cubra el ojo entero del mesh.
        // Aspect ratio correcto: meshSize.x = 1.0 (body length normalized),
        // meshSize.y = 0.43 (body height). Para circulo redondo en mesh-space
        // el d.y debe scalar por (meshSize.y / meshSize.x) = 0.43 — asi
        // length(d) representa distancia fisica del mesh, no warped.
        // Radio 0.085 mesh-units = ~9% body length = tamaño tipico del ojo
        // de un atun (eye diameter ~17% body length). Halo extiende a 28%
        // para irradiar luz al agua circundante.
        {
          float yScale = meshSize.y / meshSize.x;
          vec2 d = vec2(bodyU - 0.11, (dorsalV - 0.60) * yScale);
          float dist = length(d);
          lineCore += (1.0 - smoothstep(0.085, 0.140, dist)) * 9.00;
          lineHalo += (1.0 - smoothstep(0.140, 0.380, dist)) * 3.50;
        }
        // (f) Tail button — circulo HOT bright en la base de la cola
        // (mesh-space aspect ratio correcto)
        {
          float yScale = meshSize.y / meshSize.x;
          vec2 d = vec2(bodyU - 0.82, (dorsalV - 0.50) * yScale);
          float dist = length(d);
          lineCore += (1.0 - smoothstep(0.045, 0.090, dist)) * 5.50;
          lineHalo += (1.0 - smoothstep(0.090, 0.220, dist)) * 2.00;
        }

        // Mascara final = (core + halo) * fresnel boost (x1 baseline, x4 turn).
        float lineMask = (lineCore + lineHalo) * lineBoost;

        // Suma cyan brillante ULTRA saturada. Multiplier x5.0 sobre
        // vec3(0.40,0.95,1.80) = canal B peak ~9.0 → tras ACES queda
        // WHITE-cyan blown-out → bloom (threshold 0.40, strength 2.20)
        // genera halo amplio = "destello" permanente en las lineas.
        gl_FragColor.rgb += vec3(0.40, 0.95, 1.80) * lineMask * 5.0;

        // (2) Texture neon boost — ojos pintados en el texture
        #ifdef USE_EMISSIVEMAP
          vec4 neonTexel = texture2D(emissiveMap, vEmissiveMapUv);
          float neonLum = max(neonTexel.r, max(neonTexel.g, neonTexel.b));
          float neonMaskAdd = smoothstep(0.55, 0.80, neonLum);
          gl_FragColor.rgb += neonTexel.rgb * vec3(0.80, 1.10, 1.60) * neonMaskAdd * 5.0;
        #endif

        // (3) Fresnel rim — destello en silueta (giros)
        vec3 vRimViewDir = normalize(vViewPosition);
        float vRimNoV = max(0.0, dot(normalize(vNormal), vRimViewDir));
        float vRimFresnel = pow(1.0 - vRimNoV, 2.5);
        gl_FragColor.rgb += vec3(0.30, 0.70, 1.50) * vRimFresnel * 1.20;

        #include <output_fragment>
        `,
      );

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
        // Globals compartidos entre <beginnormal_vertex> y <begin_vertex>
        // (ambos viven en el mismo main()). Calculamos el frame de
        // deformacion en beginnormal_vertex y lo reusamos para position.
        vec2 vSpinePos;
        vec2 vSpineTangent;
        vec2 vSpinePerp;
        // Mesh-local position (pre-deformacion) que el fragment usa para
        // pintar neon lines en coords body-relative consistentes.
        varying vec3 vLocalPos;
        `,
      );

      // Override beginnormal_vertex: compute deformation frame + rotate
      // normal from mesh-local frame to world frame BEFORE
      // defaultnormal_vertex transforms it via normalMatrix.
      //
      // Sin esta rotacion la normal queda en el frame original del mesh
      // (head=+X, top=+Y, side=+Z) aunque el position ya fue movido al frame
      // post-deformacion → lighting "azul solo de un lado" porque las
      // normales no concuerdan con como esta orientado el cuerpo en world.
      shader.vertexShader = shader.vertexShader.replace(
        '#include <beginnormal_vertex>',
        `
        // Spine deformation frame — mismo calculo que begin_vertex.
        float bodyT = clamp(0.5 - position.x, 0.0, 1.0);
        float targetDist = bodyT * uSpineTotal;
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
        vSpinePos = mix(spineA, spineB, localT);
        vSpineTangent = normalize(spineB - spineA + vec2(1e-6, 0.0));
        vSpinePerp = vec2(-vSpineTangent.y, vSpineTangent.x);

        // Rotation matrix (mesh-local -> world):
        //   local +X (body axis) → (tangent.x, tangent.y, 0)         world
        //   local +Y (dorsal)   → (0, sin(elev), cos(elev))          world
        //   local +Z (lateral)  → (perp.x, perp.y, 0)                world
        // Aplicado al normal: cada componente del local normal contribuye
        // al world normal segun esta base.
        vec3 objectNormal = normalize(vec3(
          normal.x * vSpineTangent.x + normal.z * vSpinePerp.x,
          normal.x * vSpineTangent.y + normal.y * uSinE + normal.z * vSpinePerp.y,
          normal.y * uCosE
        ));
        #ifdef USE_TANGENT
        vec3 objectTangent = vec3(tangent.xyz);
        #endif
        `,
      );

      // Replace begin_vertex with path-deformed position. Reusa
      // vSpinePos/vSpineTangent/vSpinePerp ya computados en beginnormal_vertex.
      // Tambien captura vLocalPos = position (pre-deformacion) para que el
      // fragment shader pueda pintar features fijas al cuerpo del pez.
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        vLocalPos = position;
        vec3 transformed = vec3(
          vSpinePos.x + vSpinePerp.x * position.z * uMeshScale,
          vSpinePos.y + vSpinePerp.y * position.z * uMeshScale + position.y * uMeshScale * uSinE,
          position.y * uMeshScale * uCosE
        );
        `,
      );
    };

    const mesh = new THREE.Mesh(this.baseGeometry, material);
    mesh.frustumCulled = false;
    // Mesh transform queda identidad (no posicionamos via group); el shader
    // escribe world coords directamente. Dejamos matrixAutoUpdate=true para
    // que Three.js maneje matrixWorld bien con el composer.
    this.scene.add(mesh);

    // ─── Luces overlay (Points mesh por pez) ────────────────────────────
    // 1 vertex por LIGHT_DEF (un solo ojo por pez, no dos). Renderizar
    // ambos lados causa el efecto "2 esferas alrededor del pez" porque
    // la perpendicular del swim direction proyecta cada eye a posiciones
    // distintas en screen. En reality solo se ve UN ojo (el visible).
    if (!this.lightMaterial) {
      throw new Error('FishThreeRenderer: lightMaterial not initialized');
    }
    const lightCount = LIGHT_DEFS.length;
    const lightsGeometry = new THREE.BufferGeometry();
    lightsGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(lightCount * 3), 3),
    );
    const sizes = new Float32Array(lightCount);
    for (let i = 0; i < lightCount; i++) sizes[i] = LIGHT_DEFS[i].size;
    lightsGeometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    const lightsMesh = new THREE.Points(lightsGeometry, this.lightMaterial);
    lightsMesh.frustumCulled = false;
    // Render order alto = se dibuja DESPUES del body → encima visualmente.
    lightsMesh.renderOrder = 10;
    this.scene.add(lightsMesh);

    const handle: FishHandle = { mesh, material, uniforms, lightsGeometry, lightsMesh };
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

    // ─── Update posiciones de luces overlay ────────────────────────────
    // Por cada LIGHT_DEF, calculamos la world position del punto en mesh-
    // local (x,y,z) usando la misma matematica que el vertex shader:
    //   1. x mesh → bodyT → arc-length lookup en spine → spinePos
    //   2. perp del segmento * z * meshScale = offset lateral
    //   3. y * meshScale * sinE = offset vertical screen (perspective elev)
    //   4. y * meshScale * cosE = offset depth (Z mundo)
    // Renderizamos ambos lados (z+ y z-) para que las luces sean visibles
    // independientemente del giro del pez.
    const lightPos = handle.lightsGeometry.attributes['position'].array as Float32Array;
    const lightSizes = handle.lightsGeometry.attributes['aSize'].array as Float32Array;
    const meshScale = targetBodyLen;

    for (let li = 0; li < LIGHT_DEFS.length; li++) {
      const def = LIGHT_DEFS[li];
      // bodyT mapping: clamp(0.5 - x, 0, 1)  — head +X
      const bodyT = Math.max(0, Math.min(1, 0.5 - def.pos.x));
      const targetDist = bodyT * cum;

      // Find segment in spine
      let segIdx = N - 2;
      for (let j = 0; j < N - 1; j++) {
        if (segLen[j + 1] >= targetDist) { segIdx = j; break; }
      }
      segIdx = Math.max(0, segIdx);

      const ax = spine[segIdx * 2];
      const ay = spine[segIdx * 2 + 1];
      const bx = spine[(segIdx + 1) * 2];
      const by = spine[(segIdx + 1) * 2 + 1];
      const segDist = Math.max(0.0001, segLen[segIdx + 1] - segLen[segIdx]);
      const localT = Math.max(0, Math.min(1, (targetDist - segLen[segIdx]) / segDist));
      const sxL = ax + (bx - ax) * localT;
      const syL = ay + (by - ay) * localT;

      // Tangente del segmento
      let tx = bx - ax;
      let ty = by - ay;
      const tlen = Math.hypot(tx, ty) || 1;
      tx /= tlen;
      ty /= tlen;
      // Perpendicular CCW
      const px = -ty;
      const py = tx;

      // Elegir el signo de z para que el offset perp * z proyecte SIEMPRE
      // al lado screen-DOWN del swim line. Razon: con la camara a 45° de
      // elevation mirando al lago desde arriba, el dorso (parte superior
      // del cuerpo) domina la silueta; el ojo visible es el que cae mas
      // cerca del belly silhouette (lado inferior del cuerpo proyectado).
      // Si perp ya apunta abajo (py<0), usar +Z; si apunta arriba (py>=0),
      // usar -Z. Asi py * effZ siempre es negativo = ojo screen-DOWN.
      const zSign = py >= 0 ? -1 : 1;
      const effectiveZ = def.pos.z * zSign;

      const yOffset = def.pos.y * meshScale * SIN_E;
      const zDepth = def.pos.y * meshScale * COS_E;
      lightPos[li * 3 + 0] = sxL + px * effectiveZ * meshScale;
      lightPos[li * 3 + 1] = syL + py * effectiveZ * meshScale + yOffset;
      lightPos[li * 3 + 2] = zDepth;
      // Size escala con depthScale (peces lejanos = ojos chicos)
      lightSizes[li] = def.size * depthScale;
    }

    handle.lightsGeometry.attributes['position'].needsUpdate = true;
    handle.lightsGeometry.attributes['aSize'].needsUpdate = true;
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
    this.composer?.setSize(width, height);
    this.bloomPass?.setSize(width, height);
  }

  render(): void {
    // Si composer aun no se inicializo (race con first frame antes de init
    // resolver), fallback a render directo.
    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  destroy(): void {
    for (const h of this.handles) {
      this.scene.remove(h.mesh);
      this.scene.remove(h.lightsMesh);
      h.material.dispose();
      h.lightsGeometry.dispose();
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
    this.lightMaterial?.dispose();
    this.envTexture?.dispose();
    this.renderer.dispose();
  }
}
