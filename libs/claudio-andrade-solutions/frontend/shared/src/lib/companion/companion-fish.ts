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

// ─── Paleta de transformación ───────────────────────────────────────────────
// Emissive base del companion = cyan-green (4ae285), heredado del hero pero
// shifted hacia G para que el pez no se sienta "azul" sobre el shell verde
// que tendrá la transición. Al hacer colorShift=1 lerpea a WhatsApp green
// puro (25d366) — el color exacto del botón del hub. La transición es de
// 4ae285 → 25d366: mismo verde pero más saturado y oscuro, dando la
// sensación de "el pez condensándose en el ícono".
const EMISSIVE_IDLE = new THREE.Color(0x4ae285);
const EMISSIVE_MORPH = new THREE.Color(0x25d366);
// Bloom strength durante swim normal vs durante curl peak. El bloom alto
// durante el curl crea el "orbe pesado" que disimula visualmente el corte
// topológico (truco Pixar/Apple Vision Pro).
const BLOOM_STRENGTH_BASE = 3.20;
const BLOOM_STRENGTH_MORPH = 4.50;
// Emissive intensity también escala — el pez idle pulsa fuerte (2.0); en
// peak morph el cuerpo se vuelve casi puro emissive (3.2) para que el
// halo verde domine la lectura visual.
const EMISSIVE_INTENSITY_BASE = 2.0;
const EMISSIVE_INTENSITY_MORPH = 3.2;

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
  /**
   * Fase de "curl" 0..1. 0 = spine recta + wave normal (pez nadando);
   * 1 = spine en arco circular cerrado (pez enroscado en O, head = tail).
   * Valores intermedios producen un C-bend progresivo. Se usa para la
   * transformación pez→ícono y viceversa en los extremos del swim.
   *
   * Cuando curl=1 y bodyLen=98px, el círculo formado tiene diámetro
   * 98/π ≈ 31px — exactamente el tamaño del trigger del hub (32px sm).
   * Esto da continuidad geométrica perfecta entre el pez curled y el
   * ícono WhatsApp.
   */
  curlPhase?: number;
  /**
   * Lerp del emissive del cuerpo desde cyan-green (#4ae285, palette
   * default del companion) hacia WhatsApp green puro (#25d366). 0 =
   * cyan-green; 1 = WhatsApp green. Se sube en sincronía con curlPhase
   * para que el orbe curled sea exactamente el color del botón. También
   * dispara un bloom boost (strength 3.20 → 4.50) para el "halo verde
   * pesado" típico del momento de transformación.
   */
  colorShift?: number;
  /**
   * Opacity global del mesh (0..1). 1 = pez 100% visible (default); 0 =
   * invisible. Se usa para crossfade simultáneo con el hub durante el
   * último tramo del swim — el pez fadea OUT al mismo tiempo que el hub
   * fadea IN, total visibility (pez + hub) = ~constante, lectura "el pez
   * SE CONVIRTIÓ en el hub" en vez de "pez llegó + hub apareció encima +
   * pez desapareció" (sequencia que rompe la transformación).
   */
  meshOpacity?: number;
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
  // Referencia al material clonado del mesh (vs baseMaterial que es el del
  // GLB sin clonar). Lo mutamos cada frame en update() para el lerp de
  // emissive durante la transformación curl → hub.
  private fishMaterial: THREE.MeshStandardMaterial | null = null;
  // Color helper reutilizable para el lerp emissive — evita allocs por frame.
  private readonly emissiveScratch = new THREE.Color();
  private uniforms: CompanionFishUniforms | null = null;
  private lightsGeometry: THREE.BufferGeometry | null = null;
  private lightsMesh: THREE.Points | null = null;

  // Flag de modo low-power, leído por update() para subir el emissive
  // intensity del material PBR del pez cuando NO hay bloom — compensa la
  // falta del halo del UnrealBloomPass via emissive directo, así los
  // neones siguen luminosos en mobile.
  private lowPower = false;

  // ─── Lifecycle ─────────────────────────────────────────────────────────
  /**
   * @param options.lowPower Mobile / low-power profile: DPR 1.0, sin
   *   UnrealBloomPass, emissive intensity boost. La animación del pez
   *   se mantiene visible al 100%, solo se reduce el footprint de GPU
   *   memory de ~70 MB a ~10-15 MB para no rebasar el budget de mobile
   *   Safari y producir crash recurrente.
   */
  async init(
    canvas: HTMLCanvasElement,
    width: number,
    height: number,
    options: { lowPower?: boolean } = {},
  ): Promise<void> {
    this.lowPower = options.lowPower === true;
    this.canvasW = width;
    this.canvasH = height;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      // antialias false en lowPower — multi-sample buffer adicional cuesta
      // ~width*height*4 bytes; deshabilitarlo en mobile (donde DPR ya está
      // a 1.0) baja un poco más el footprint. El pez es chico (~100 px),
      // sin AA se ve casi igual.
      antialias: !this.lowPower,
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
    });
    // DPR adaptivo: 1.0 en mobile/low-power (-75% framebuffer), hasta 2.0
    // en desktop. La diferencia visual a 100×100 px del pez es despreciable.
    this.renderer.setPixelRatio(this.lowPower ? 1.0 : Math.min(window.devicePixelRatio || 1, 2));
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
    //
    // Mobile (lowPower): NO montamos composer/bloom. UnrealBloomPass crea
    // internamente un chain de 5 render targets (mipmap blur cascade); en
    // 393×844×16 bytes ≈ 5.3 MB × 5 niveles = ~25 MB GPU SOLO para el
    // bloom. Multiplicado por el DPR² en desktop, son 80-100 MB.
    // En vez de bloom, en mobile usamos `renderer.render(scene, camera)`
    // directo (sin pass chain) y compensamos la pérdida de halo en update()
    // multiplicando el emissive intensity x1.5 — el material PBR sigue
    // dando luz emisiva, solo sin el cascade glow.
    if (!this.lowPower) {
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
    }

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
    this.fishMaterial = material;
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

    // ─── Tres blends separados para el morph ─────────────────────────
    // Cada aspecto de la transformación usa su propia curva de easing —
    // por design, no por accidente. Esto fue el feedback del user: con un
    // solo blend smoothstep, todo arrancaba a la vez y el pez quedaba
    // "tieso girando" porque la flexión y la rotación competían por la
    // atención al mismo ritmo. Separando:
    //
    //   • bendBlend (easeOutCubic) — flexión del cuerpo. Arranca RÁPIDO
    //     así el body se ve doblarse en C casi de inmediato. El user
    //     percibe "el pez se está flexionando" antes que cualquier otra
    //     cosa.
    //
    //   • spinBlend (easeInQuart) — rotación de toda la spine alrededor
    //     del dock-center. Arranca LENTA, se acelera al final. Así la
    //     flexión es visible durante 100-150ms antes de que la rotación
    //     empiece a dominar la lectura visual.
    //
    //   • scaleBlend (smoothstep) — encogimiento del cuerpo. Suave en
    //     ambos extremos. El orbe final es 50% del tamaño original, así
    //     "se mete" dentro del hub (32px) — el orbe queda ~16px diám,
    //     half el size del hub, dando la lectura "el pez se condensó
    //     dentro del logo".
    const curlPhaseRaw = Math.max(0, Math.min(1, state.curlPhase ?? 0));
    const bendBlend = 1 - Math.pow(1 - curlPhaseRaw, 3); // easeOutCubic
    const spinBlend = curlPhaseRaw * curlPhaseRaw * curlPhaseRaw * curlPhaseRaw; // easeInQuart
    const scaleBlend = curlPhaseRaw * curlPhaseRaw * (3 - 2 * curlPhaseRaw); // smoothstep

    // Scale-down agresivo del bodyLen — al curl=1 el body es 15% del
    // original. bodyLen afecta a la spine length, al uMeshScale
    // (thickness del mesh) y al R_outer de la espiral. Todo escala
    // proporcionalmente: el pez se enrosca en una espiral diminuta
    // (~3px radio en curl=1) "metiéndose dentro del logo". El crossfade
    // posterior con el hub (32px) hace que esa motita se desvanezca
    // mientras el logo emerge — fusion genuina, no swap.
    const SCALE_MIN = 0.15;
    const sizeFactor = 1 - (1 - SCALE_MIN) * scaleBlend;
    const bodyLen = state.size * SPRITE_SIZE_FACTOR * sizeFactor;
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

    // Linear spine (curl=0): head at state.head, body extends backward
    // along -heading. Con la espiral implementada abajo, NO necesitamos
    // re-anchoring del head — la espiral converge naturalmente al
    // dock-center (tail at center, head at outer rim). El head queda
    // libre en la posición del swim end (state.head) durante curl=0 y
    // se va desplazando hacia el outer de la espiral conforme curl
    // crece. Al curl=1, head está a R_outer del dock; tail está EN el
    // dock. Visual: la espiral converge al icono.

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

    // ─── Curl pass — lerp cada joint hacia el arco circular ───────────
    // curlPhase 0 = spine recta + carangiform wave (lo construido arriba);
    // curlPhase 1 = spine en círculo cerrado (head encuentra tail). El
    // truco geométrico: un arco con bend = curlPhase·2π y arclen = bodyLen
    // tiene radius = bodyLen/(curlPhase·2π). Cuando curl=1, radius =
    // bodyLen/(2π) → con bodyLen 98px el círculo tiene 31px de diámetro
    // (≈ tamaño del trigger del hub). El blend usa smoothstep para evitar
    // la "esquina" geométrica al inicio/fin de la curl.
    //
    // El arco se construye en world coords (top-left origin, Y down)
    // saliendo de (headX, headY) con tangente -heading. La perpendicular
    // CCW al cuerpo apunta a (+sin(h), -cos(h)) en frame world; usamos
    // ese vector para colocar el centro del arco a distance R en esa
    // dirección. Esto hace que el pez se enrosque SIEMPRE hacia el mismo
    // lado (consistencia visual independiente de la dirección del swim).
    if (curlPhaseRaw > 1e-3) {
      // ─── Espiral de Arquímedes — fusion genuina con el logo ─────────
      //
      // Esta NO es una rotación rígida ("helicóptero") ni un círculo
      // cerrado: es una espiral verdadera que CONVERGE al dock-center.
      // El head queda en el outer rim; la tail acumula vueltas y
      // termina exactamente en el centro = posición del logo. Al lerp
      // desde la spine lineal, el body se enrosca progresivamente como
      // un caracol que se hace pequeño hacia el centro.
      //
      // Por qué Arquímedes (r lineal con θ) en vez de logarítmica
      // (r·e^bθ): la Arquímedes da espacio uniforme entre vueltas, así
      // que la espiral se "lee" como anillos concéntricos parejos. La
      // logarítmica se aprieta mucho en el centro y se ve como nautilo
      // (más artística pero menos premium-clean).
      //
      // 1.5 vueltas = sweet spot: suficiente "enrosque" para que sea
      // espiral evidente, no tanto que cause mareo o que pierda detalle
      // del body wave del path swim que viene antes.
      //
      // Arc length de un Arquímedes con r(θ)=R·(1-θ/θ_max) sobre θ ∈
      // [0, θ_max] ≈ R·θ_max/2. Para θ_max=2π·1.5=3π:
      //   L ≈ R·3π/2 ≈ R·π·1.5
      // Resolver para que L = bodyLen (después del scale-down):
      //   R_outer = bodyLen / (π · 1.5)
      const SPIRAL_TURNS = 1.5;
      const R_outer = bodyLen / (Math.PI * SPIRAL_TURNS);
      const θ_max = 2 * Math.PI * SPIRAL_TURNS;
      const oneMinusBend = 1 - bendBlend;

      // Orientación de la espiral: el head queda en la dirección
      // (sinH, -cosH) desde el dock = perp +CCW del heading, que en
      // world Y-down significa "arriba" del dock visualmente cuando
      // heading=0. Misma dirección que el arc curl anterior usaba para
      // el center, así la continuidad visual con el path-swim que
      // venía antes se mantiene.
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1);
        // r(t): linear shrink R_outer → 0
        const r = R_outer * (1 - t);
        // θ(t): increases CCW around dock-center as we go from head to tail
        const θ = t * θ_max;
        const dirX = Math.sin(state.heading + θ);
        const dirY = -Math.cos(state.heading + θ);
        const spiralWorldX = state.headX + r * dirX;
        const spiralWorldY = state.headY + r * dirY;
        const spiralSx = spiralWorldX - halfW;
        const spiralSy = halfH - spiralWorldY;
        spine[i * 2] = spine[i * 2] * oneMinusBend + spiralSx * bendBlend;
        spine[i * 2 + 1] = spine[i * 2 + 1] * oneMinusBend + spiralSy * bendBlend;
      }

      // Spinblend ya no se usa para rotación rígida — está intrínseco
      // a la espiral (el body inherentemente rota mientras se contrae).
      // Lo dejamos calculado por si lo queremos para algún detalle
      // posterior (ej. emissive boost durante el último tercio del
      // spin), pero no se aplica como rotación de la spine.
      void spinBlend;

      // Recomputar segLen — la longitud poligonal de la espiral con
      // N=13 puntos es algo menor que el ideal (cada segmento es una
      // cuerda, no un arco), pero la normalización posterior compensa.
      cum = 0;
      segLen[0] = 0;
      for (let i = 1; i < N; i++) {
        const dx = spine[i * 2] - spine[(i - 1) * 2];
        const dy = spine[i * 2 + 1] - spine[(i - 1) * 2 + 1];
        cum += Math.hypot(dx, dy);
        segLen[i] = cum;
      }
      prevX = spine[(N - 1) * 2];
      prevY = spine[(N - 1) * 2 + 1];
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

    // ─── Color shift + bloom boost para el morph ─────────────────────
    // colorShift 0..1 — durante los extremos del swim (cuando el pez se
    // está curling o uncurling), el emissive del material lerpea desde
    // el cyan-green idle hacia el WhatsApp green puro. El bloom strength
    // sube de 3.20 → 4.50 dando un halo verde "pesado" que domina la
    // lectura visual durante el corte topológico fish ↔ hub. Esto se
    // hace cada frame mientras el state cambie — sin allocs porque
    // reusamos this.emissiveScratch.
    const colorShift = Math.max(0, Math.min(1, state.colorShift ?? 0));
    const meshOpacity = Math.max(0, Math.min(1, state.meshOpacity ?? 1));
    if (this.fishMaterial) {
      this.emissiveScratch.copy(EMISSIVE_IDLE).lerp(EMISSIVE_MORPH, colorShift);
      this.fishMaterial.emissive.copy(this.emissiveScratch);
      // En mobile (lowPower) NO hay bloom pass → el halo verde dramático
      // se pierde. Compensamos multiplicando el emissive intensity x1.6
      // para que el material PBR emita más luz directa. El pez no luce
      // EXACTAMENTE igual que con bloom (sin el cascade glow soft alrededor)
      // pero queda claramente luminoso, no apagado.
      const lowPowerBoost = this.lowPower ? 1.6 : 1.0;
      this.fishMaterial.emissiveIntensity =
        (EMISSIVE_INTENSITY_BASE
          + (EMISSIVE_INTENSITY_MORPH - EMISSIVE_INTENSITY_BASE) * colorShift)
        * lowPowerBoost;
      // Opacity ramp para crossfade simultáneo con el hub al final del swim.
      // El material ya es `transparent: true` desde el init, así que setear
      // .opacity surte efecto sin tocar nada más. Cuando meshOpacity=1 (el
      // default y la mayor parte del swim), no afecta nada.
      this.fishMaterial.opacity = meshOpacity;
    }
    if (this.bloomPass) {
      this.bloomPass.strength =
        BLOOM_STRENGTH_BASE
        + (BLOOM_STRENGTH_MORPH - BLOOM_STRENGTH_BASE) * colorShift;
    }

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
