// CompanionFish — renderer del pez del companion (WhatsApp).
//
// Es un derivado PARALELO del FishThreeRenderer del hero: usa el mismo GLB
// (`/hero-wolf/fish-model.glb`, ya pre-cargado por el hero o por nosotros si
// el companion arranca primero), el mismo vertex shader de path-deformation
// con onda carangiform sobre la espina, y el mismo light overlay (ojo) por
// arriba del body. La diferencia clave: la paleta neon es VERDE WhatsApp
// (no cyan) y se omiten los passes específicos del lago (dissolve blur,
// submerge depth, caustics, water tint) que no aplican a un pez nadando
// sobre el shell de la app fuera del hero.
//
// Cuándo se usa: durante el swim del WhatsappCompanion entre docks. La
// renderer tiene un canvas full-viewport `position: fixed`. Mientras el
// companion está idle (anclado a un dock), el canvas vive transparente y
// no se renderiza. Cuando arranca un swim:
//   1. El companion calcula una curva Bezier de A→B.
//   2. Cada frame el companion llama updateSwim(t, headingTangent, swimPhase).
//   3. La renderer construye la spine (carangiform wave sobre la posición
//      interpolada) y dibuja el pez con bloom.
//   4. Al finalizar el swim, render() deja de llamarse y el canvas vuelve
//      a estar inactivo.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import type { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

const FISH_GLB_URL = '/hero-wolf/fish-model.glb';

// Misma chain length que el hero — 13 vértebras del GLOW_BODY_PROFILE.
export const COMPANION_SPINE_LEN = 13;
const MAX_SPINE = 16;

// Mismas constantes carangiform que el hero.
const WAVES_PER_BODY = 0.95;
const WAVE_ENV_POWER = 3.0;
const X_NOSE_UNIT = 2.20;
const X_TAIL_UNIT = -1.55;
const BODY_LEN_UNIT = X_NOSE_UNIT - X_TAIL_UNIT;
const K_WAVE = (Math.PI * 2 * WAVES_PER_BODY) / BODY_LEN_UNIT;

const ELEV_PITCH = THREE.MathUtils.degToRad(45);
const SIN_E = Math.sin(ELEV_PITCH);
const COS_E = Math.cos(ELEV_PITCH);

const SPRITE_SIZE_FACTOR = 7.0;

// Paleta WhatsApp verde — RGB peaks que tras ACES quedan blown-out hacia
// verde brillante. La banda B (azul) baja a 0.20 para evitar tint cyan;
// el canal G domina; R bajo evita amarillo. Multiplier x5 hace que el
// bloom genere halo amplio verde.
const NEON_RGB = new THREE.Vector3(0.30, 1.65, 0.55);
const RIM_RGB = new THREE.Vector3(0.20, 1.10, 0.45);
const LIGHT_RGB = new THREE.Vector3(0.50, 1.55, 0.85);

interface CompanionFishUniforms {
  uSpine: { value: Float32Array };
  uSegLen: { value: Float32Array };
  uSegN: { value: number };
  uSpineTotal: { value: number };
  uMeshScale: { value: number };
  uSinE: { value: number };
  uCosE: { value: number };
  uMeshMin: { value: THREE.Vector3 };
  uMeshMax: { value: THREE.Vector3 };
  uTime: { value: number };
  uResolution: { value: THREE.Vector2 };
}

interface LightDef {
  pos: { x: number; y: number; z: number };
  size: number;
}

// Solo el ojo — mismo que el hero. Una sola luz overlay.
const LIGHT_DEFS: LightDef[] = [
  { pos: { x: 0.40, y: 0.04, z: 0.06 }, size: 1.0 },
];

/**
 * Pez minimal: posición en canvas-px, heading (rad), tamaño base y
 * fase de swim. La renderer recibe esto cada frame para construir la
 * spine + dibujar.
 */
export interface CompanionFishState {
  /** Posición de la cabeza en canvas px (top-left origin, Y down). */
  headX: number;
  headY: number;
  /** Heading actual de la cabeza en radianes (0 = +X derecha). */
  heading: number;
  /** Tamaño base (radio característico). Cuerpo total ≈ size * 3.75. */
  size: number;
  /** Phase de la onda corporal — incrementa cada frame. */
  swimPhase: number;
  /** Effort 0..1. 1 = wave amplitude máxima. */
  bodyEffort: number;
  /** Gate del wave 0..1. 1 = wave activa. */
  swimGate: number;
}

export class CompanionFishRenderer {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.OrthographicCamera;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private envTexture: THREE.Texture | null = null;

  private canvasW = 1;
  private canvasH = 1;

  private baseGeometry: THREE.BufferGeometry | null = null;
  private baseMaterial: THREE.MeshStandardMaterial | null = null;
  private lightMaterial: THREE.ShaderMaterial | null = null;

  private readonly meshMin = new THREE.Vector3();
  private readonly meshMax = new THREE.Vector3();

  // Una sola fish handle — el companion solo tiene un pez.
  private mesh: THREE.Mesh | null = null;
  private uniforms: CompanionFishUniforms | null = null;
  private lightsGeometry: THREE.BufferGeometry | null = null;
  private lightsMesh: THREE.Points | null = null;

  // ─── Lifecycle ─────────────────────────────────────────────────────────
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
    this.camera = new THREE.OrthographicCamera(
      -width / 2, width / 2,
      height / 2, -height / 2,
      -10000, 10000,
    );
    this.camera.position.set(0, 0, 1000);
    this.camera.lookAt(0, 0, 0);

    // Iluminación azul (como el hero) — el cuerpo del pez lee navy
    // chrome con reflexiones azules submarinas. El verde queda
    // EXCLUSIVAMENTE en los neones (ojos + lineas procedurales),
    // creando contraste cyan-body + green-eye = preferencia del user.
    //
    // Fill levels altos: el pez del companion vuela sobre el shell de
    // la app (sin lago bright detrás), entonces requiere bastante más
    // baseline luminance que el hero para no fundirse con el fondo
    // oscuro post-hero. Key light blanco-warm + ambient azul brillante
    // + hemi con ground levantado al azul medio para que el belly no
    // quede negro contra el fondo dark.
    this.scene.add(new THREE.AmbientLight(0xc8d8ff, 1.65));
    const key = new THREE.DirectionalLight(0xfff2dd, 1.6);
    key.position.set(0.3, 1.0, 0.5);
    this.scene.add(key);
    this.scene.add(new THREE.HemisphereLight(0x90b4ff, 0x2a4a80, 1.05));

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x90b4ff);
    this.envTexture = pmrem.fromScene(envScene, 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.envTexture;

    // ─── Post-processing: bloom para el destello neón ─────────────────
    // Cierre con CopyShader renderToScreen — sin esto el UnrealBloomPass
    // escribe al canvas con alpha=1 y arruina la transparencia. Mismo
    // patrón que el hero (FishThreeRenderer).
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
    // Bloom más fuerte y ancho — los neones del companion necesitan un
    // halo más amplio para sentirse "premium glowing object" sobre el
    // fondo dark de las secciones post-hero (a la Apple Vision Pro /
    // Linear product marketing). Threshold bajo para que también el
    // rim cyan haga halo, no solo los puntos hot.
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      3.20, // strength (was 2.40)
      1.00, // radius (was 0.85)
      0.22, // threshold (was 0.30)
    );
    this.composer.addPass(this.bloomPass);
    const copyPass = new ShaderPass(CopyShader);
    copyPass.renderToScreen = true;
    this.composer.addPass(copyPass);

    // ─── Light overlay material — verde HDR ────────────────────────────
    this.lightMaterial = new THREE.ShaderMaterial({
      uniforms: { uPointBase: { value: 8.0 } },
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
          float core = pow(1.0 - smoothstep(0.0, 0.45, d), 2.0);
          // Verde HDR brillante — mismo formato que el cyan del hero,
          // canales corridos a la dominante G.
          vec3 green = vec3(0.55, 1.85, 0.95);
          vec3 col = green * core * 2.5;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });

    // ─── Load GLB ──────────────────────────────────────────────────────
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(FISH_GLB_URL);

    let foundMesh: THREE.Mesh | null = null;
    gltf.scene.traverse((obj) => {
      if (!foundMesh && (obj as THREE.Mesh).isMesh) {
        foundMesh = obj as THREE.Mesh;
      }
    });
    if (!foundMesh) throw new Error('CompanionFishRenderer: no mesh in GLB');

    const meshObj = foundMesh as THREE.Mesh;
    this.baseGeometry = meshObj.geometry;
    this.baseMaterial = meshObj.material as THREE.MeshStandardMaterial;
    this.baseGeometry.computeBoundingBox();
    const bbox = this.baseGeometry.boundingBox;
    if (bbox) {
      this.meshMin.copy(bbox.min);
      this.meshMax.copy(bbox.max);
    }

    // Material PBR — body lee como "pulido pintado" en vez de chrome
    // puro. El hero usa metalness 0.95 porque el lago lo refleja todo;
    // acá no hay lago, entonces bajamos metalness a 0.62 para que el
    // body responda con su própio color (diffuse) en vez de depender
    // del environment dark de la página. Roughness sube un toque para
    // dispersar más la luz key y dar lift uniforme. envMapIntensity
    // alto para que las pocas reflexiones sean blue-bright (no oscuras).
    // emissiveIntensity 2.0 — los marks de la texture (incluyendo el
    // ojo verde) pulsan fuerte.
    this.baseMaterial.metalness = 0.62;
    this.baseMaterial.roughness = 0.28;
    this.baseMaterial.envMapIntensity = 3.4;
    this.baseMaterial.color = new THREE.Color(0xffffff);
    this.baseMaterial.emissiveMap = this.baseMaterial.map;
    this.baseMaterial.emissive = new THREE.Color(0x4ae285);
    this.baseMaterial.emissiveIntensity = 2.0;
    this.baseMaterial.transparent = true;
    this.baseMaterial.needsUpdate = true;

    this.setupFish();
  }

  // ─── Setup del único fish handle ─────────────────────────────────────
  private setupFish(): void {
    if (!this.baseGeometry || !this.baseMaterial || !this.lightMaterial) {
      throw new Error('CompanionFishRenderer: not initialized');
    }

    const material = this.baseMaterial.clone();
    const uniforms: CompanionFishUniforms = {
      uSpine: { value: new Float32Array(MAX_SPINE * 2) },
      uSegLen: { value: new Float32Array(MAX_SPINE) },
      uSegN: { value: COMPANION_SPINE_LEN },
      uSpineTotal: { value: 100 },
      uMeshScale: { value: 140 },
      uSinE: { value: SIN_E },
      uCosE: { value: COS_E },
      uMeshMin: { value: this.meshMin.clone() },
      uMeshMax: { value: this.meshMax.clone() },
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(this.canvasW, this.canvasH) },
    };

    material.onBeforeCompile = (shader) => {
      shader.uniforms['uSpine'] = uniforms.uSpine;
      shader.uniforms['uSegLen'] = uniforms.uSegLen;
      shader.uniforms['uSegN'] = uniforms.uSegN;
      shader.uniforms['uSpineTotal'] = uniforms.uSpineTotal;
      shader.uniforms['uMeshScale'] = uniforms.uMeshScale;
      shader.uniforms['uSinE'] = uniforms.uSinE;
      shader.uniforms['uCosE'] = uniforms.uCosE;
      shader.uniforms['uMeshMin'] = uniforms.uMeshMin;
      shader.uniforms['uMeshMax'] = uniforms.uMeshMax;
      shader.uniforms['uTime'] = uniforms.uTime;
      shader.uniforms['uResolution'] = uniforms.uResolution;

      // ─── Fragment <common>: varying + uniformes ────────────────────
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
        varying vec3 vLocalPos;
        uniform vec3 uMeshMin;
        uniform vec3 uMeshMax;
        uniform float uTime;
        uniform vec2 uResolution;
        `,
      );

      // ─── Fragment <emissivemap>: PBR emissive interno ──────────────
      // Idéntico al hero — solo capta los ojos brillantes pintados en
      // la texture, multiplica por su color (cyan). El verde de los
      // ojos se aplica más abajo (output_fragment) tinteando la región
      // del ojo a verde.
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

      // ─── Fragment <output>: neon lines (cyan = body) + ojo (verde) ─
      // Paleta híbrida: cuerpo cyan-azul como hero, OJO verde
      // WhatsApp. Solo el ojo cambia respecto al hero.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <output_fragment>',
        `
        vec3 meshSize = uMeshMax - uMeshMin;
        float bodyU   = clamp((uMeshMax.x - vLocalPos.x) / max(meshSize.x, 1e-4), 0.0, 1.0);
        float dorsalV = clamp((vLocalPos.y - uMeshMin.y) / max(meshSize.y, 1e-4), 0.0, 1.0);

        vec3 lnViewDir = normalize(vViewPosition);
        float lnNoV = max(0.0, dot(normalize(vNormal), lnViewDir));
        float lnFresnel = pow(1.0 - lnNoV, 2.0);
        float lineBoost = 1.0 + 3.0 * lnFresnel;

        // Acumuladores SEPARADOS — body lines (cyan) vs eye (green).
        float bodyMask = 0.0;
        float eyeMask = 0.0;

        // (a) Head/body separator vertical — CYAN
        {
          float dU = abs(bodyU - 0.24);
          float vM = smoothstep(0.15, 0.28, dorsalV) * (1.0 - smoothstep(0.72, 0.88, dorsalV));
          bodyMask += (1.0 - smoothstep(0.040, 0.090, dU)) * vM * 3.50;
          bodyMask += (1.0 - smoothstep(0.090, 0.230, dU)) * vM * 1.40;
        }
        // (b) Lateral line central — CYAN
        {
          float uM = smoothstep(0.22, 0.30, bodyU) * (1.0 - smoothstep(0.58, 0.66, bodyU));
          float dV = abs(dorsalV - 0.58);
          bodyMask += uM * (1.0 - smoothstep(0.040, 0.090, dV)) * 4.00;
          bodyMask += uM * (1.0 - smoothstep(0.090, 0.250, dV)) * 1.60;
        }
        // (c) Línea pectoral — CYAN
        {
          float uM = smoothstep(0.32, 0.38, bodyU) * (1.0 - smoothstep(0.50, 0.58, bodyU));
          float dV = abs(dorsalV - 0.38);
          bodyMask += uM * (1.0 - smoothstep(0.040, 0.090, dV)) * 3.50;
          bodyMask += uM * (1.0 - smoothstep(0.090, 0.240, dV)) * 1.40;
        }
        // (d) Belly line — CYAN
        {
          float uM = smoothstep(0.36, 0.44, bodyU) * (1.0 - smoothstep(0.58, 0.66, bodyU));
          float dV = abs(dorsalV - 0.22);
          bodyMask += uM * (1.0 - smoothstep(0.040, 0.090, dV)) * 4.00;
          bodyMask += uM * (1.0 - smoothstep(0.090, 0.260, dV)) * 1.80;
        }
        // (e) Eye HOT — GREEN (WhatsApp signature)
        {
          float yScale = meshSize.y / meshSize.x;
          vec2 d = vec2(bodyU - 0.11, (dorsalV - 0.60) * yScale);
          float dist = length(d);
          eyeMask += (1.0 - smoothstep(0.085, 0.140, dist)) * 9.00;
          eyeMask += (1.0 - smoothstep(0.140, 0.380, dist)) * 3.50;
        }
        // (f) Tail button — CYAN
        {
          float yScale = meshSize.y / meshSize.x;
          vec2 d = vec2(bodyU - 0.82, (dorsalV - 0.50) * yScale);
          float dist = length(d);
          bodyMask += (1.0 - smoothstep(0.045, 0.090, dist)) * 5.50;
          bodyMask += (1.0 - smoothstep(0.090, 0.220, dist)) * 2.00;
        }
        // (g) Dorsal ridge — línea fina a lo largo del lomo, signature
        // bioluminiscente. Sin esto, cuando el pez nada VERTICAL entre
        // capítulos N→N+1 el viewer ve el lomo y no tiene chromatic
        // signature contra el fondo dark. La línea corre de bodyU 0.22
        // (justo después del head/body separator) a 0.85 (antes del
        // tail button), en dorsalV 0.92 — bien arriba, casi en el edge
        // dorsal. Mismo color cyan que las demás líneas.
        {
          float uM = smoothstep(0.22, 0.30, bodyU) * (1.0 - smoothstep(0.78, 0.88, bodyU));
          float dV = abs(dorsalV - 0.92);
          bodyMask += uM * (1.0 - smoothstep(0.030, 0.075, dV)) * 5.00;
          bodyMask += uM * (1.0 - smoothstep(0.075, 0.200, dV)) * 1.80;
        }

        bodyMask *= lineBoost;
        eyeMask *= lineBoost;

        // Cyan body lines (mismo color que el hero) — bump a 8.5 para
        // legibilidad fuerte sobre fondo dark post-hero. El bloom las
        // toma como hot points y genera halo cyan amplio.
        gl_FragColor.rgb += vec3(0.40, 0.95, 1.80) * bodyMask * 8.5;
        // Green eye (WhatsApp green saturado) — bump a 8.0.
        gl_FragColor.rgb += vec3(0.30, 1.65, 0.55) * eyeMask * 8.0;

        // Dorsal wash — lift sutil de color en la mitad superior del
        // cuerpo, sin afectar el belly (que ya está bien servido por el
        // hemi ground bounce). Sin esto, cuando el pez nada vertical
        // entre capítulos el lomo se lee como sombra. Tinte teal-cyan
        // pastel (no satura — solo lifts el midtone), enmascarado a
        // dorsalV > 0.55 con falloff suave hasta 0.95. Magnitud
        // moderada (×1.10) para no perder la sensación premium.
        float dorsalAccent = smoothstep(0.55, 0.95, dorsalV);
        gl_FragColor.rgb += vec3(0.22, 0.55, 0.85) * dorsalAccent * 1.10;

        // Texture neon boost — el GLB tiene el ojo pintado en cyan.
        // Re-tintamos a VERDE en la zona del ojo (bodyU ~ 0.05-0.20)
        // y dejamos cyan en el resto.
        #ifdef USE_EMISSIVEMAP
          vec4 neonTexel = texture2D(emissiveMap, vEmissiveMapUv);
          float neonLum = max(neonTexel.r, max(neonTexel.g, neonTexel.b));
          float neonMaskAdd = smoothstep(0.55, 0.80, neonLum);
          // El ojo del mesh está a bodyU ~ 0.11; tintamos verde solo
          // ahí. El resto del cuerpo conserva el cyan original.
          float eyeRegion = 1.0 - smoothstep(0.05, 0.25, abs(bodyU - 0.11));
          vec3 eyeColor = vec3(0.45, 1.55, 0.75);
          vec3 bodyColor = vec3(0.80, 1.10, 1.60);
          vec3 mixColor = mix(bodyColor, eyeColor, eyeRegion);
          gl_FragColor.rgb += mixColor * neonLum * neonMaskAdd * 5.0;
        #endif

        // Rim fresnel a DOBLE capa — la firma premium de objetos 3D
        // sobre fondo dark (Apple Vision Pro / Linear / Stripe). La
        // capa ancha (pow 1.4) baña todo el contorno con cyan pastel
        // suave dando sensación de "objeto levitando sobre dark glow";
        // la capa sharp (pow 4.0) afina el edge exacto en cyan-bright
        // para que la silueta esté siempre definida. El bloom amplifica
        // ambas y genera el halo amplio característico.
        vec3 vRimViewDir = normalize(vViewPosition);
        float vRimNoV = max(0.0, dot(normalize(vNormal), vRimViewDir));
        float vRimWide = pow(1.0 - vRimNoV, 1.4);
        float vRimSharp = pow(1.0 - vRimNoV, 4.0);
        gl_FragColor.rgb += vec3(0.30, 0.65, 1.30) * vRimWide * 1.40;
        gl_FragColor.rgb += vec3(0.55, 1.10, 1.95) * vRimSharp * 3.20;

        #include <output_fragment>
        `,
      );

      // ─── Vertex shader: misma deformation que el hero ──────────────
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
        uniform float uTime;
        vec2 vSpinePos;
        vec2 vSpineTangent;
        vec2 vSpinePerp;
        varying vec3 vLocalPos;
        `,
      );

      shader.vertexShader = shader.vertexShader.replace(
        '#include <beginnormal_vertex>',
        `
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
    this.scene.add(mesh);

    // Light overlay (un ojo verde HDR)
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
    lightsMesh.renderOrder = 10;
    this.scene.add(lightsMesh);

    this.mesh = mesh;
    this.uniforms = uniforms;
    this.lightsGeometry = lightsGeometry;
    this.lightsMesh = lightsMesh;
  }

  // ─── Update per frame ────────────────────────────────────────────────
  /**
   * Llamar cada frame durante el swim. Construye la spine a partir de
   * la posición/heading del pez + la onda carangiform, y deja todos los
   * uniforms listos para el render.
   */
  update(state: CompanionFishState): void {
    if (!this.uniforms || !this.lightsGeometry) return;

    const N = COMPANION_SPINE_LEN;
    const halfW = this.canvasW / 2;
    const halfH = this.canvasH / 2;

    // Construir chainJoints recto desde la cabeza en la dirección de
    // -heading (la cola va hacia atrás del swim). El cuerpo tiene
    // longitud size * SPRITE_SIZE_FACTOR. Distribuir N joints uniformes.
    const bodyLen = state.size * SPRITE_SIZE_FACTOR;
    const cosH = Math.cos(state.heading);
    const sinH = Math.sin(state.heading);

    // Onda carangiform sobre la espina recta — añade curvatura lateral.
    // Amplitud: 30% base + hasta 60% extra por effort. Con size=14 y
    // effort=1: ampPx ≈ 14 · 0.90 ≈ 12.6 px de barrido lateral en la cola
    // (≈ 13% del body length 98px). Eso es la banda canónica del
    // carangiform tail-tip amplitude: 10-15% de L. Antes era ~2.8 px y se
    // leía como pez rígido; ahora se ve nadar de verdad.
    const viewMorph = Math.sin(state.heading) ** 2;
    const viewAmpBoost = 1 + 0.7 * viewMorph;
    const ampPx = state.size
      * (0.30 + 0.60 * state.bodyEffort)
      * viewAmpBoost
      * state.swimGate;

    const spine = this.uniforms.uSpine.value;
    const segLen = this.uniforms.uSegLen.value;

    let prevX = 0;
    let prevY = 0;
    let cum = 0;
    segLen[0] = 0;

    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      // Joint en el frame de la cabeza: head=joint 0, tail=joint N-1.
      // La spine va hacia ATRÁS del heading.
      const along = t * bodyLen;
      const jx = state.headX - cosH * along;
      const jy = state.headY - sinH * along;

      // Perpendicular CCW al heading (en frame world).
      const perpX = -sinH;
      const perpY = cosH;

      // xUnit lineal de nose a tail.
      const xUnit = X_NOSE_UNIT + (X_TAIL_UNIT - X_NOSE_UNIT) * t;
      const u = (X_NOSE_UNIT - xUnit) / BODY_LEN_UNIT;
      const env = Math.pow(u, WAVE_ENV_POWER);
      const wave = env * ampPx * Math.sin(state.swimPhase + K_WAVE * xUnit);

      const wx = jx + perpX * wave;
      const wy = jy + perpY * wave;

      // Screen-centered (origen al centro del canvas, Y up).
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

    // Pad
    for (let i = N; i < MAX_SPINE; i++) {
      spine[i * 2] = prevX;
      spine[i * 2 + 1] = prevY;
      segLen[i] = cum;
    }

    // Normalizar longitud (mismo trick que el hero).
    const targetBodyLen = bodyLen;
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

    this.uniforms.uSegN.value = N;
    this.uniforms.uSpineTotal.value = cum;
    this.uniforms.uMeshScale.value = targetBodyLen;
    this.uniforms.uTime.value = performance.now() * 0.001;

    // ─── Light overlay (ojo) ─────────────────────────────────────────
    const lightPos = this.lightsGeometry.attributes['position'].array as Float32Array;
    const lightSizes = this.lightsGeometry.attributes['aSize'].array as Float32Array;
    const meshScale = targetBodyLen;

    for (let li = 0; li < LIGHT_DEFS.length; li++) {
      const def = LIGHT_DEFS[li];
      const bodyT = Math.max(0, Math.min(1, 0.5 - def.pos.x));
      const targetDist = bodyT * cum;

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

      let tx = bx - ax;
      let ty = by - ay;
      const tlen = Math.hypot(tx, ty) || 1;
      tx /= tlen;
      ty /= tlen;
      const px = -ty;
      const py = tx;

      const zSign = py >= 0 ? -1 : 1;
      const effectiveZ = def.pos.z * zSign;

      const yOffset = def.pos.y * meshScale * SIN_E;
      const zDepth = def.pos.y * meshScale * COS_E;
      lightPos[li * 3 + 0] = sxL + px * effectiveZ * meshScale;
      lightPos[li * 3 + 1] = syL + py * effectiveZ * meshScale + yOffset;
      lightPos[li * 3 + 2] = zDepth;
      lightSizes[li] = def.size;
    }

    this.lightsGeometry.attributes['position'].needsUpdate = true;
    this.lightsGeometry.attributes['aSize'].needsUpdate = true;
  }

  render(): void {
    if (this.composer) {
      this.composer.render();
    } else if (this.renderer) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  resize(width: number, height: number): void {
    this.canvasW = width;
    this.canvasH = height;
    if (!this.renderer) return;
    this.renderer.setSize(width, height, false);
    this.camera.left = -width / 2;
    this.camera.right = width / 2;
    this.camera.top = height / 2;
    this.camera.bottom = -height / 2;
    this.camera.updateProjectionMatrix();
    this.composer?.setSize(width, height);
    this.bloomPass?.setSize(width, height);
    if (this.uniforms) {
      this.uniforms.uResolution.value.set(width, height);
    }
  }

  dispose(): void {
    this.mesh?.removeFromParent();
    this.lightsMesh?.removeFromParent();
    this.envTexture?.dispose();
    this.renderer?.dispose();
  }
}
