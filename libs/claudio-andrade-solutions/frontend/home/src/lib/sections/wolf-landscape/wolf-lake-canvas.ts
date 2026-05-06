import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  viewChild,
} from '@angular/core';

/**
 * WolfLakeCanvas
 * -----------------------------------------------------------------------------
 * Anima la imagen del WolfLandscape sin tocarle ni un pixel a la composición
 * original. Tres capas:
 *
 *  1) WebGL2 (z=1) — reemplaza visualmente la <img> con un shader que:
 *      a) muestrea la imagen original con object-fit:cover + position:right
 *         bottom replicado en GLSL (mismo encuadre que la <img>),
 *      b) desplaza el UV verticalmente según el gradiente de un wave-field,
 *         lo que hace que el reflejo del lobo y los árboles "tiemble" donde
 *         pasa una onda — sin tocar el resto de la imagen,
 *      c) suma un destello platino sobre las facetas inclinadas (highlight
 *         de luna en las olas),
 *      d) overlay de niebla con loop perfecto: 4D simplex noise muestreado
 *         con (cos t, sin t) en sus dos últimas coords, garantía matemática
 *         de seamless loop con período fijo.
 *
 *  2) Canvas 2D (z=2) — peces articulados (FABRIK + senoidal lateral) que
 *     patrullan dentro del mask del agua. State machine de atención al
 *     cursor: idle → curious (UN pez se acerca al cursor) → losing-interest
 *     (se desvía, se va) → cooldown. Solo un pez "activo" a la vez; los
 *     demás siguen su patrullaje.
 *
 *  3) <img> base (z=0, hidden) — fallback si WebGL2 no existe o el usuario
 *     pidió prefers-reduced-motion.
 *
 * El wave-field corre en CPU (Float32Array, ecuación de ondas estándar) y se
 * sube a GPU como textura R8 cada frame. El mask define las paredes (rocas /
 * orillas) — en celdas con mask≈0 fuerzo height=0, lo que produce reflexión
 * natural de las olas en la frontera del agua.
 *
 * El cleanup de RAF + listeners + IntersectionObserver + ResizeObserver es
 * SSR-safe vía afterNextRender + DestroyRef.
 * -----------------------------------------------------------------------------
 */

// =============================================================================
// GLSL — vertex + fragment shaders
// =============================================================================

// vUV usa convención DOM (Y=0 arriba, Y=1 abajo), igual que los pixels
// de la <img> y del mask que subimos como ArrayBufferView. Esto evita
// el problema clásico de WebGL: UNPACK_FLIP_Y solo aplica a fuentes DOM
// (no a Uint8Array), así que mezclar texturas DOM y RAW con flip_y deja
// alguna invertida. Flippeando vUV una sola vez en el vertex shader,
// todas las texturas se samplean en la misma convención y no hay sorpresas.
const VERT_SRC = `#version 300 es
in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = vec2(aPos.x * 0.5 + 0.5, 1.0 - (aPos.y * 0.5 + 0.5));
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// 4D Simplex noise — Ashima Arts (Stefan Gustavson, Ian McEwan), MIT.
// https://github.com/ashima/webgl-noise/blob/master/src/noise4D.glsl
// Lo embebo tal cual: el patrón estándar de seamless looping animation es
// muestrear noise 4D con (cos t, sin t) en las dos últimas coordenadas; el
// loop se garantiza con el período de t (matemáticamente exacto, no
// "casi", no "aproximadamente").
const FRAG_SRC = `#version 300 es
precision highp float;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uImage;
uniform sampler2D uMask;
uniform sampler2D uWaveHeight;
uniform vec2 uCanvasSize;
uniform vec2 uImgSize;
uniform vec2 uWaveSize;
uniform float uTime;
uniform float uFogPeriod;
uniform float uWaveCap;
uniform float uReduceMotion; // 0 = animar, 1 = pasar imagen sin tocar

vec4 mod289(vec4 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
float mod289(float x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
float permute(float x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float taylorInvSqrt(float r) { return 1.79284291400159 - 0.85373472095314 * r; }

vec4 grad4(float j, vec4 ip) {
  const vec4 ones = vec4(1.0, 1.0, 1.0, -1.0);
  vec4 p, s;
  p.xyz = floor(fract(vec3(j) * ip.xyz) * 7.0) * ip.z - 1.0;
  p.w = 1.5 - dot(abs(p.xyz), ones.xyz);
  s = vec4(lessThan(p, vec4(0.0)));
  p.xyz = p.xyz + (s.xyz * 2.0 - 1.0) * s.www;
  return p;
}

#define F4 0.309016994374947451

float snoise4(vec4 v) {
  const vec4 C = vec4(0.138196601125011, 0.276393202250021,
                      0.414589803375032, -0.447213595499958);
  vec4 i = floor(v + dot(v, vec4(F4)));
  vec4 x0 = v - i + dot(i, C.xxxx);
  vec4 i0;
  vec3 isX = step(x0.yzw, x0.xxx);
  vec3 isYZ = step(x0.zww, x0.yyz);
  i0.x = isX.x + isX.y + isX.z;
  i0.yzw = 1.0 - isX;
  i0.y += isYZ.x + isYZ.y;
  i0.zw += 1.0 - isYZ.xy;
  i0.z += isYZ.z;
  i0.w += 1.0 - isYZ.z;
  vec4 i3 = clamp(i0, 0.0, 1.0);
  vec4 i2 = clamp(i0 - 1.0, 0.0, 1.0);
  vec4 i1 = clamp(i0 - 2.0, 0.0, 1.0);
  vec4 x1 = x0 - i1 + C.xxxx;
  vec4 x2 = x0 - i2 + C.yyyy;
  vec4 x3 = x0 - i3 + C.zzzz;
  vec4 x4 = x0 + C.wwww;
  i = mod289(i);
  float j0 = permute(permute(permute(permute(i.w) + i.z) + i.y) + i.x);
  vec4 j1 = permute(permute(permute(permute(
                i.w + vec4(i1.w, i2.w, i3.w, 1.0))
              + i.z + vec4(i1.z, i2.z, i3.z, 1.0))
              + i.y + vec4(i1.y, i2.y, i3.y, 1.0))
              + i.x + vec4(i1.x, i2.x, i3.x, 1.0));
  vec4 ip = vec4(1.0/294.0, 1.0/49.0, 1.0/7.0, 0.0);
  vec4 p0 = grad4(j0, ip);
  vec4 p1 = grad4(j1.x, ip);
  vec4 p2 = grad4(j1.y, ip);
  vec4 p3 = grad4(j1.z, ip);
  vec4 p4 = grad4(j1.w, ip);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  p4 *= taylorInvSqrt(dot(p4, p4));
  vec3 m0 = max(0.6 - vec3(dot(x0, x0), dot(x1, x1), dot(x2, x2)), 0.0);
  vec2 m1 = max(0.6 - vec2(dot(x3, x3), dot(x4, x4)), 0.0);
  m0 = m0 * m0;
  m1 = m1 * m1;
  return 49.0 * (dot(m0 * m0, vec3(dot(p0, x0), dot(p1, x1), dot(p2, x2)))
              + dot(m1 * m1, vec2(dot(p3, x3), dot(p4, x4))));
}

vec2 toImgUV(vec2 canvasUV) {
  // Replica object-fit:cover + object-position:right bottom de la <img>.
  // Anchor (1, 1) → derecha-abajo. coverScale ≥ 1 garantiza que llenamos
  // todo el canvas, recortando el sobrante por el lado opuesto al anchor.
  float coverScale = max(uCanvasSize.x / uImgSize.x, uCanvasSize.y / uImgSize.y);
  vec2 displayed = uImgSize * coverScale;
  vec2 uv;
  uv.x = 1.0 - (1.0 - canvasUV.x) * uCanvasSize.x / displayed.x;
  uv.y = 1.0 - (1.0 - canvasUV.y) * uCanvasSize.y / displayed.y;
  return uv;
}

float sampleHeight(vec2 uv) {
  float v = texture(uWaveHeight, uv).r;
  return (v - 0.5) * 2.0 * uWaveCap;
}

// Cáustica replicando alpha = clamp(grad*58 + |h|*11, 0, 130) del abismo,
// normalizado a 0..1. Se llama 5 veces (centro + 4 vecinos) para emular
// el filter:blur(1.3px) que el abismo le aplica al canvas offscreen.
float causticAlphaAt(vec2 uv) {
  float dxh = 1.0 / uWaveSize.x;
  float dyh = 1.0 / uWaveSize.y;
  float h0 = sampleHeight(uv);
  float gxh = sampleHeight(uv + vec2(dxh, 0.0)) - sampleHeight(uv - vec2(dxh, 0.0));
  float gyh = sampleHeight(uv + vec2(0.0, dyh)) - sampleHeight(uv - vec2(0.0, dyh));
  float gradLen = sqrt(gxh * gxh + gyh * gyh);
  return clamp(gradLen * (58.0/255.0) + abs(h0) * (11.0/255.0), 0.0, 130.0/255.0);
}

void main() {
  vec2 imgUV = toImgUV(vUV);

  // Off-image guard — para canvas con aspect raro donde imgUV se sale del
  // rango. Pintamos el abismo en lugar de samplear textura fuera de bounds.
  if (imgUV.x < 0.0 || imgUV.x > 1.0 || imgUV.y < 0.0 || imgUV.y > 1.0) {
    fragColor = vec4(0.024, 0.035, 0.10, 1.0);
    return;
  }

  // Reduced motion — sample directo y salida.
  if (uReduceMotion > 0.5) {
    fragColor = vec4(texture(uImage, imgUV).rgb, 1.0);
    return;
  }

  float dx = 1.0 / uWaveSize.x;
  float dy = 1.0 / uWaveSize.y;
  float gx = sampleHeight(imgUV + vec2(dx, 0.0)) - sampleHeight(imgUV - vec2(dx, 0.0));
  float gy = sampleHeight(imgUV + vec2(0.0, dy)) - sampleHeight(imgUV - vec2(0.0, dy));

  float mask = texture(uMask, imgUV).r;

  // Displacement del UV — mínimo, solo para que el reflejo se mueva
  // sutilmente cuando pasa una onda. Curva cuadrática: ondas chicas no
  // distorsionan; solo las fuertes mueven el reflejo.
  vec2 distortedUV = imgUV;
  distortedUV.x -= gx * abs(gx) * 0.020 * mask;
  distortedUV.y -= gy * abs(gy) * 0.034 * mask;
  distortedUV = clamp(distortedUV, vec2(0.001), vec2(0.999));

  vec3 color = texture(uImage, distortedUV).rgb;

  // Cáustica con blur (5-tap cross) — emulando el filter:blur(1.3px) que
  // el abismo le aplica al canvas offscreen antes de drawImage. Sin este
  // blur las cáusticas se ven crispy/digitales; con él, fluidas como
  // agua de verdad. Coste: 5×5 = 25 lookups de la wave-texture, barato
  // en GPU moderno comparado con un blur post-process completo.
  float blurR = 1.6 / max(uCanvasSize.x, uCanvasSize.y);
  float a0 = causticAlphaAt(imgUV);
  float a1 = causticAlphaAt(imgUV + vec2(blurR, 0.0));
  float a2 = causticAlphaAt(imgUV - vec2(blurR, 0.0));
  float a3 = causticAlphaAt(imgUV + vec2(0.0, blurR));
  float a4 = causticAlphaAt(imgUV - vec2(0.0, blurR));
  float causticAlpha = a0 * 0.40 + (a1 + a2 + a3 + a4) * 0.15;

  // Color silver del abismo — (196, 218, 224) / 255 — tinte cyan-platino.
  // Layer alpha 0.78 con screen blend matching exactamente el ctx.save +
  // globalCompositeOperation:'screen' + globalAlpha:0.78 del abismo.
  vec3 causticCol = vec3(196.0/255.0, 218.0/255.0, 224.0/255.0);
  vec3 causticAdd = (vec3(1.0) - color) * causticCol * causticAlpha;
  color += causticAdd * 0.78 * mask;

  // Niebla — el sample point ORBITA un círculo (radio 0.07 UV) con
  // período uFogPeriod. La banda visual no se mueve — pero el patrón de
  // ruido bajo ella sí, así que el ojo ve niebla flotando/circulando
  // dentro de la banda en lugar de morfar en sitio. Sumado a domain warp
  // (turbulencia interna) y dos octavas (estructura lenta + shimmer
  // rápido), el movimiento se siente realista. Loop perfecto: ambos
  // ángulos vuelven a 0 en uFogPeriod (fAfast=fA*2 → entero → seamless).
  // Dos sub-bandas verticales: la del agua usa mask (vapor sobre la
  // superficie), la de los pinos NO (niebla atmosférica entre los
  // troncos, en el aire). El peso de la sub-banda de los pinos va a
  // 0.45 porque el área de fondo es más oscura que la del agua y la
  // niebla blanca se ve fantasmal al mismo opacity que sobre el lago;
  // a la mitad se siente translúcida, natural, premium.
  float ySurface = smoothstep(0.40, 0.45, imgUV.y) *
                   (1.0 - smoothstep(0.50, 0.58, imgUV.y));
  float yPine = smoothstep(0.26, 0.33, imgUV.y) *
                (1.0 - smoothstep(0.39, 0.44, imgUV.y));
  float fogXBand = smoothstep(0.0, 0.08, imgUV.x) *
                   (1.0 - smoothstep(0.50, 0.68, imgUV.x));
  float fogBand = max(ySurface * mask, yPine * 0.45) * fogXBand;

  float fA = (uTime / uFogPeriod) * 6.2831853;
  float fAfast = fA * 2.0;
  float fCs = cos(fA);
  float fSn = sin(fA);
  float fCsF = cos(fAfast);
  float fSnF = sin(fAfast);

  // Orbital drift del sample point — la pieza clave que hace visible el
  // movimiento. Un círculo de radio 0.10 UV traversa el campo de ruido y
  // el patrón de niebla "fluye" dentro de su banda. Sin desplazamiento
  // neto entre t=0 y t=T (regresa al punto inicial).
  vec2 orbit = vec2(fCs, fSn) * 0.10;

  // Domain warp — turbulencia adicional sobre la silueta. Frecuencia
  // baja, amplitud pequeña; le da micro-deformación sin volverse caótico.
  vec2 warpUV = imgUV * vec2(1.6, 2.4) + 5.1;
  float wx = snoise4(vec4(warpUV,       fCs * 0.9, fSn * 0.9));
  float wy = snoise4(vec4(warpUV + 7.3, fCs * 0.9, fSn * 0.9));
  vec2 warp = vec2(wx, wy) * 0.07;

  vec2 fogUV = imgUV + orbit + warp;

  // Octava grande — estructura, fase lenta. Radio 0.9 en 4D garantiza
  // que el morph cubra una vuelta completa del campo en cada ciclo.
  float n1 = snoise4(vec4(fogUV * vec2(2.5, 4.0),
                          fCs * 0.9, fSn * 0.9)) * 0.5 + 0.5;
  // Octava chica — shimmer, fase rápida (2× la angular). Da el detalle
  // de "vapor que se mueve" sin que la estructura grande pierda calma.
  float n2 = snoise4(vec4(fogUV * vec2(6.5, 10.0) + 3.7,
                          fCsF * 0.7, fSnF * 0.7)) * 0.5 + 0.5;
  float fogN = n1 * 0.65 + n2 * 0.35;

  vec3 fogColor = vec3(0.78, 0.86, 0.92);
  color = mix(color, fogColor, fogBand * fogN * 0.30);

  fragColor = vec4(color, 1.0);
}`;

// =============================================================================
// Wave-field — ecuación de ondas en grid, con barrera de mask
// =============================================================================

class WaveField {
  cols: number;
  rows: number;
  cur: Float32Array;
  prev: Float32Array;
  mask: Float32Array; // 0..1 — 0=tierra (rebota), 1=agua libre
  texData: Uint8Array;
  // Idéntico al WaveField del hero del abismo (hero-fish-canvas) —
  // requisito explícito del usuario: las ondas tienen que reaccionar
  // exactamente igual que en esa sección.
  damping = 0.984;
  heightCap = 2.4;

  constructor(cols: number, rows: number, srcMask: Uint8ClampedArray, maskW: number, maskH: number) {
    this.cols = cols;
    this.rows = rows;
    this.cur = new Float32Array(cols * rows);
    this.prev = new Float32Array(cols * rows);
    this.mask = new Float32Array(cols * rows);
    this.texData = new Uint8Array(cols * rows);

    // Resamplear mask de su resolución original al grid del wave-field.
    for (let r = 0; r < rows; r++) {
      const v = r / Math.max(1, rows - 1);
      const my = Math.min(maskH - 1, Math.floor(v * (maskH - 1)));
      for (let c = 0; c < cols; c++) {
        const u = c / Math.max(1, cols - 1);
        const mx = Math.min(maskW - 1, Math.floor(u * (maskW - 1)));
        this.mask[r * cols + c] = srcMask[my * maskW + mx] / 255;
      }
    }
  }

  // (u, v) en image-UV (0..1). Inserta una "perturbación" gaussiana
  // sobre el campo, atenuada por el mask: si poke cae en tierra, se anula.
  poke(u: number, v: number, strength: number): void {
    const cx = Math.floor(u * this.cols);
    const cy = Math.floor(v * this.rows);
    const r = 3;
    for (let dy = -r; dy <= r; dy++) {
      const yy = cy + dy;
      if (yy < 1 || yy >= this.rows - 1) continue;
      for (let dx = -r; dx <= r; dx++) {
        const xx = cx + dx;
        if (xx < 1 || xx >= this.cols - 1) continue;
        const d = Math.hypot(dx, dy);
        if (d > r) continue;
        const f = 1 - d / r;
        const i = yy * this.cols + xx;
        this.cur[i] += strength * f * f * this.mask[i];
      }
    }
  }

  pokeLine(u0: number, v0: number, u1: number, v1: number, strength: number): void {
    const dx = u1 - u0;
    const dy = v1 - v0;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(dist * Math.max(this.cols, this.rows) * 0.7));
    const per = strength / (1 + steps * 0.35);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      this.poke(u0 + dx * t, v0 + dy * t, per);
    }
  }

  step(): void {
    const cols = this.cols;
    const rows = this.rows;
    const cur = this.cur;
    const prev = this.prev;
    const mask = this.mask;
    const damping = this.damping;
    const cap = this.heightCap;

    for (let y = 1; y < rows - 1; y++) {
      const yi = y * cols;
      for (let x = 1; x < cols - 1; x++) {
        const i = yi + x;
        const m = mask[i];
        if (m < 0.05) {
          // Tierra: altura clavada en 0. Onda que llega aquí "no encuentra
          // medio para propagar" → se refleja al próximo step. Es la
          // condición de Dirichlet boundary clásica del wave equation.
          prev[i] = 0;
          continue;
        }
        const r = cur[i + 1] * mask[i + 1];
        const l = cur[i - 1] * mask[i - 1];
        const d = cur[i + cols] * mask[i + cols];
        const u = cur[i - cols] * mask[i - cols];
        let n = (r + l + d + u) * 0.5 - prev[i];
        // Damping uniforme — sin penalty extra en feather de orillas.
        // Mismo behavior que el abismo (sin mask). Las ondas rebotan en
        // la roca al ~100% y el decay general se encarga de matarlas
        // tras 1-3 rebotes (heightCap + damping=0.984 da ese balance).
        n *= damping;
        if (n > cap) n = cap;
        else if (n < -cap) n = -cap;
        prev[i] = n;
      }
    }
    const tmp = this.cur;
    this.cur = this.prev;
    this.prev = tmp;
  }

  // Convierte el field a Uint8 para upload como textura R8.
  // Mapping: [-cap, cap] → [0, 255], 0.5 = neutro.
  packForTexture(): Uint8Array {
    const cap = this.heightCap;
    const cur = this.cur;
    const td = this.texData;
    for (let i = 0; i < cur.length; i++) {
      const v = (cur[i] / cap) * 0.5 + 0.5;
      td[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.floor(v * 255);
    }
    return td;
  }

  // Bilinear sample del mask en (u,v) image-UV. Lo usan los peces para no
  // entrar a tierra firme.
  sampleMask(u: number, v: number): number {
    const fx = Math.max(0, Math.min(this.cols - 1.001, u * (this.cols - 1)));
    const fy = Math.max(0, Math.min(this.rows - 1.001, v * (this.rows - 1)));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const cs = this.cols;
    const a = this.mask[y0 * cs + x0] * (1 - tx) + this.mask[y0 * cs + x0 + 1] * tx;
    const b = this.mask[(y0 + 1) * cs + x0] * (1 - tx) + this.mask[(y0 + 1) * cs + x0 + 1] * tx;
    return a * (1 - ty) + b * ty;
  }
}

// =============================================================================
// Pez del lago — FABRIK chain + onda lateral + state machine de cursor
// =============================================================================

type Vec = { x: number; y: number };

// 3 estados — sin 'leaving'. Cuando un pez pierde interés en el cursor,
// su target switchea suavemente de "cursor" a "orbit center", y el pez
// vuelve a su patrullaje natural (no se va volando, no se detiene seco).
type FishState = 'idle' | 'curious' | 'cooldown';

class LakeFish {
  spine: Vec[];
  segments: number;
  segLen: number;
  bodyScale: number;
  speedScale: number;
  phase = Math.random() * Math.PI * 2;
  velocity: Vec = { x: 0, y: 0 };
  prevHead: Vec;

  // State machine
  state: FishState = 'idle';
  stateTimer = 0;        // segundos restantes en estado actual
  cooldownLeft = 0;      // tras leaving, no puede ser elegido como curious

  // Patrullaje base (lemniscata)
  orbit: { cx: number; cy: number; rx: number; ry: number; phase: number; speed: number };

  // Target derivado de estado
  target: Vec;

  // Color
  color: { fill: string; rim: string; belly: string; fin: string; eye: string };

  constructor(start: Vec, opts: {
    segments: number;
    segLen: number;
    bodyScale: number;
    speedScale: number;
    orbit: LakeFish['orbit'];
    color: LakeFish['color'];
  }) {
    this.segments = opts.segments;
    this.segLen = opts.segLen;
    this.bodyScale = opts.bodyScale;
    this.speedScale = opts.speedScale;
    this.orbit = opts.orbit;
    this.color = opts.color;
    this.spine = Array.from({ length: opts.segments }, (_, i) => ({
      x: start.x - i * opts.segLen,
      y: start.y,
    }));
    this.prevHead = { x: start.x, y: start.y };
    this.target = { x: start.x, y: start.y };
  }

  // setTargetSmooth — replica el patrón del hero fish del abismo:
  //   target.x += (raw - target.x) * smoothing
  // En lugar de saltar directamente al raw target, el target del pez
  // converge gradualmente hacia él. Esto da el efecto "tranquilo y bonito"
  // que tiene el pez del abismo: cuando el cursor se mueve rápido, el pez
  // no se teleporta, va con un retraso suave.
  setTargetSmooth(raw: Vec, smoothing: number): void {
    this.target.x += (raw.x - this.target.x) * smoothing;
    this.target.y += (raw.y - this.target.y) * smoothing;
  }

  // FABRIK chain step — la cabeza tira de la cola, segLen se preserva.
  // Después de la cadena, sumamos onda lateral senoidal para vida orgánica.
  // pull/maxStep alineados con el hero fish del abismo: 0.13/9 cuando
  // sigue activamente al cursor, 0.08/5 cuando patrulla.
  update(dt: number): void {
    this.prevHead.x = this.spine[0].x;
    this.prevHead.y = this.spine[0].y;

    const head = this.spine[0];
    const dx = this.target.x - head.x;
    const dy = this.target.y - head.y;
    const dist = Math.hypot(dx, dy);

    const pull = this.state === 'curious' ? 0.13 : 0.08;
    const maxStep = (this.state === 'curious' ? 9 : 5) * this.speedScale * dt * 60;
    const step = Math.min(dist * pull, maxStep);
    if (dist > 0.5) {
      head.x += (dx / dist) * step;
      head.y += (dy / dist) * step;
    }

    this.velocity.x = head.x - this.prevHead.x;
    this.velocity.y = head.y - this.prevHead.y;
    const speed = Math.hypot(this.velocity.x, this.velocity.y);

    for (let i = 1; i < this.spine.length; i++) {
      const a = this.spine[i - 1];
      const b = this.spine[i];
      const ddx = b.x - a.x;
      const ddy = b.y - a.y;
      const d = Math.hypot(ddx, ddy) || 1;
      b.x = a.x + (ddx / d) * this.segLen;
      b.y = a.y + (ddy / d) * this.segLen;
    }

    this.phase += dt * (3.5 + speed * 0.6);
    const baseAmp = Math.min(speed * 0.45, 5) + 0.3;

    for (let i = 2; i < this.spine.length; i++) {
      const t = i / (this.spine.length - 1);
      const wave = Math.sin(this.phase - t * 4.2) * baseAmp * t * t;
      const a = this.spine[i - 1];
      const b = this.spine[i];
      const tx = b.x - a.x;
      const ty = b.y - a.y;
      const len = Math.hypot(tx, ty) || 1;
      const nx = -ty / len;
      const ny = tx / len;
      b.x += nx * wave;
      b.y += ny * wave;
      const ddx = b.x - a.x;
      const ddy = b.y - a.y;
      const d = Math.hypot(ddx, ddy) || 1;
      b.x = a.x + (ddx / d) * this.segLen;
      b.y = a.y + (ddy / d) * this.segLen;
    }
  }

  private widthAt(t: number): number {
    return Math.max(1.5, Math.sin(Math.PI * Math.pow(t, 0.6)) * (1 - 0.4 * t) * this.bodyScale);
  }

  render(ctx: CanvasRenderingContext2D): void {
    const left: Vec[] = [];
    const right: Vec[] = [];

    for (let i = 0; i < this.spine.length; i++) {
      const t = i / (this.spine.length - 1);
      const cur = this.spine[i];
      const nx = i < this.spine.length - 1 ? this.spine[i + 1] : cur;
      const px = i > 0 ? this.spine[i - 1] : cur;
      const tx = nx.x - px.x;
      const ty = nx.y - px.y;
      const len = Math.hypot(tx, ty) || 1;
      const ux = -ty / len;
      const uy = tx / len;
      const w = this.widthAt(t);
      left.push({ x: cur.x + ux * w, y: cur.y + uy * w });
      right.push({ x: cur.x - ux * w, y: cur.y - uy * w });
    }

    const head = this.spine[0];
    const second = this.spine[1];
    const headTan = { x: head.x - second.x, y: head.y - second.y };
    const headLen = Math.hypot(headTan.x, headTan.y) || 1;
    const headDir = { x: headTan.x / headLen, y: headTan.y / headLen };
    const noseTip = {
      x: head.x + headDir.x * this.bodyScale * 0.5,
      y: head.y + headDir.y * this.bodyScale * 0.5,
    };

    const tail = this.spine[this.spine.length - 1];
    const beforeTail = this.spine[this.spine.length - 2];
    const tailDir = { x: tail.x - beforeTail.x, y: tail.y - beforeTail.y };
    const tailLen = Math.hypot(tailDir.x, tailDir.y) || 1;
    tailDir.x /= tailLen;
    tailDir.y /= tailLen;

    // Caudal
    const speed = Math.hypot(this.velocity.x, this.velocity.y);
    const tailWag = Math.sin(this.phase - 4.0) * (3 + Math.min(speed, 8));
    const finReach = this.bodyScale * 1.5;
    const finPerp = { x: -tailDir.y, y: tailDir.x };
    const tailEnd = {
      x: tail.x + tailDir.x * finReach + finPerp.x * tailWag * 0.55,
      y: tail.y + tailDir.y * finReach + finPerp.y * tailWag * 0.55,
    };
    const tailUp = {
      x: tail.x + tailDir.x * finReach * 0.55 + finPerp.x * (this.bodyScale * 0.85 + tailWag * 0.35),
      y: tail.y + tailDir.y * finReach * 0.55 + finPerp.y * (this.bodyScale * 0.85 + tailWag * 0.35),
    };
    const tailDown = {
      x: tail.x + tailDir.x * finReach * 0.55 - finPerp.x * (this.bodyScale * 0.85 - tailWag * 0.35),
      y: tail.y + tailDir.y * finReach * 0.55 - finPerp.y * (this.bodyScale * 0.85 - tailWag * 0.35),
    };

    ctx.save();
    const tailGrad = ctx.createLinearGradient(tail.x, tail.y, tailEnd.x, tailEnd.y);
    tailGrad.addColorStop(0, this.color.fill);
    tailGrad.addColorStop(1, this.color.fin);
    ctx.fillStyle = tailGrad;
    ctx.globalAlpha = 0.78;
    ctx.beginPath();
    ctx.moveTo(tail.x, tail.y);
    ctx.quadraticCurveTo(
      (tail.x + tailUp.x) / 2 + tailDir.x * 3,
      (tail.y + tailUp.y) / 2 + tailDir.y * 3,
      tailUp.x, tailUp.y,
    );
    ctx.quadraticCurveTo(
      (tailUp.x + tailEnd.x) / 2 - tailDir.x * 4,
      (tailUp.y + tailEnd.y) / 2 - tailDir.y * 4,
      tailEnd.x, tailEnd.y,
    );
    ctx.quadraticCurveTo(
      (tailEnd.x + tailDown.x) / 2 - tailDir.x * 4,
      (tailEnd.y + tailDown.y) / 2 - tailDir.y * 4,
      tailDown.x, tailDown.y,
    );
    ctx.quadraticCurveTo(
      (tail.x + tailDown.x) / 2 + tailDir.x * 3,
      (tail.y + tailDown.y) / 2 + tailDir.y * 3,
      tail.x, tail.y,
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Cuerpo
    ctx.save();
    const bodyGrad = ctx.createLinearGradient(
      head.x + this.bodyScale * 1.4, head.y,
      head.x - this.bodyScale * 1.4, head.y,
    );
    bodyGrad.addColorStop(0, this.color.rim);
    bodyGrad.addColorStop(0.45, this.color.fill);
    bodyGrad.addColorStop(1, this.color.belly);
    ctx.fillStyle = bodyGrad;
    ctx.globalAlpha = 0.88;
    ctx.beginPath();
    ctx.moveTo(noseTip.x, noseTip.y);
    for (let i = 0; i < left.length - 1; i++) {
      const c1 = left[i];
      const c2 = left[i + 1];
      ctx.quadraticCurveTo(c1.x, c1.y, (c1.x + c2.x) / 2, (c1.y + c2.y) / 2);
    }
    ctx.lineTo(tail.x, tail.y);
    for (let i = right.length - 1; i > 0; i--) {
      const c1 = right[i];
      const c2 = right[i - 1];
      ctx.quadraticCurveTo(c1.x, c1.y, (c1.x + c2.x) / 2, (c1.y + c2.y) / 2);
    }
    ctx.lineTo(noseTip.x, noseTip.y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

// =============================================================================
// Helpers — asset loading + cover transform
// =============================================================================

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });

const imageToMask = (img: HTMLImageElement): { data: Uint8ClampedArray; width: number; height: number } => {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d ctx for mask');
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, c.width, c.height);
  // Mask es grayscale, R == G == B; copio R en buffer denso
  const out = new Uint8ClampedArray(c.width * c.height);
  for (let i = 0; i < out.length; i++) out[i] = id.data[i * 4];
  return { data: out, width: c.width, height: c.height };
};

// Cover transform: dado un punto en image-UV (0..1), devuelve canvas-UV (0..1)
// asumiendo object-fit:cover + object-position:right bottom.
const imgUVToCanvasUV = (
  uv: Vec, canvasW: number, canvasH: number, imgW: number, imgH: number,
): Vec => {
  const coverScale = Math.max(canvasW / imgW, canvasH / imgH);
  const dispW = imgW * coverScale;
  const dispH = imgH * coverScale;
  return {
    x: 1 - (1 - uv.x) * dispW / canvasW,
    y: 1 - (1 - uv.y) * dispH / canvasH,
  };
};

// Inversa: canvas-UV → image-UV.
const canvasUVToImgUV = (
  uv: Vec, canvasW: number, canvasH: number, imgW: number, imgH: number,
): Vec => {
  const coverScale = Math.max(canvasW / imgW, canvasH / imgH);
  const dispW = imgW * coverScale;
  const dispH = imgH * coverScale;
  return {
    x: 1 - (1 - uv.x) * canvasW / dispW,
    y: 1 - (1 - uv.y) * canvasH / dispH,
  };
};

// =============================================================================
// WebGL helpers
// =============================================================================

const compileShader = (gl: WebGL2RenderingContext, type: number, src: string): WebGLShader => {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('createShader failed');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? 'unknown';
    gl.deleteShader(sh);
    throw new Error('shader compile: ' + log);
  }
  return sh;
};

const linkProgram = (gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram => {
  const p = gl.createProgram();
  if (!p) throw new Error('createProgram failed');
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p) ?? 'unknown';
    gl.deleteProgram(p);
    throw new Error('program link: ' + log);
  }
  return p;
};

// =============================================================================
// Component
// =============================================================================

@Component({
  selector: 'app-wolf-lake-canvas',
  templateUrl: './wolf-lake-canvas.html',
  styleUrl: './wolf-lake-canvas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WolfLakeCanvas {
  private readonly containerRef = viewChild.required<ElementRef<HTMLDivElement>>('container');
  private readonly imgRef = viewChild.required<ElementRef<HTMLImageElement>>('img');
  private readonly glRef = viewChild.required<ElementRef<HTMLCanvasElement>>('gl');
  private readonly fishRef = viewChild.required<ElementRef<HTMLCanvasElement>>('fish');
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      this.start().then((cleanup) => {
        if (cleanup) this.destroyRef.onDestroy(cleanup);
      });
    });
  }

  private async start(): Promise<(() => void) | void> {
    const container = this.containerRef().nativeElement;
    const imgEl = this.imgRef().nativeElement;
    const glCanvas = this.glRef().nativeElement;
    const fishCanvas = this.fishRef().nativeElement;

    // ─── prefers-reduced-motion: mostrar imagen estática y salir
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      imgEl.classList.add('wolf-lake__bg--fallback');
      return;
    }

    // ─── Cargar imagen + mask
    let bgImg: HTMLImageElement;
    let maskImg: HTMLImageElement;
    try {
      [bgImg, maskImg] = await Promise.all([
        loadImage('/hero-wolf/fondo.jpg'),
        loadImage('/hero-wolf/water-mask.png'),
      ]);
    } catch {
      imgEl.classList.add('wolf-lake__bg--fallback');
      return;
    }

    const mask = imageToMask(maskImg);
    const imgW = bgImg.naturalWidth;
    const imgH = bgImg.naturalHeight;

    // ─── WebGL2 setup
    const gl = glCanvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: false });
    if (!gl) {
      imgEl.classList.add('wolf-lake__bg--fallback');
      return;
    }

    const fishCtx = fishCanvas.getContext('2d', { alpha: true });
    if (!fishCtx) return;

    let vs: WebGLShader, fs: WebGLShader, prog: WebGLProgram;
    try {
      vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
      fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
      prog = linkProgram(gl, vs, fs);
    } catch (err) {
      console.error('[wolf-lake] shader error:', err);
      imgEl.classList.add('wolf-lake__bg--fallback');
      return;
    }

    // Quad fullscreen
    const quad = new Float32Array([-1, -1,  1, -1, -1,  1,  1,  1]);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // No flippeamos al subir — el flip se hace en el vertex shader una vez.
    // UNPACK_FLIP_Y_WEBGL solo aplica a fuentes DOM (HTMLImageElement),
    // pero mask y wave-field son ArrayBufferView donde se ignora.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    // Image texture
    const imgTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, imgTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bgImg);

    // Mask texture
    const maskTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.R8, mask.width, mask.height, 0,
      gl.RED, gl.UNSIGNED_BYTE, mask.data,
    );

    // Wave-field — grid alineado al feel del abismo. cellSize ~6.4px en
    // image-space → propagación equivalente a la del abismo (cellSize 7
    // en canvas-space) cuando la imagen llena el viewport.
    const WAVE_COLS = 200;
    const WAVE_ROWS = Math.round((mask.height / mask.width) * WAVE_COLS);
    const waves = new WaveField(WAVE_COLS, WAVE_ROWS, mask.data, mask.width, mask.height);

    const waveTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, waveTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.R8, WAVE_COLS, WAVE_ROWS, 0,
      gl.RED, gl.UNSIGNED_BYTE, waves.packForTexture(),
    );

    // Uniform locations
    const uImage = gl.getUniformLocation(prog, 'uImage');
    const uMask = gl.getUniformLocation(prog, 'uMask');
    const uWave = gl.getUniformLocation(prog, 'uWaveHeight');
    const uCanvasSize = gl.getUniformLocation(prog, 'uCanvasSize');
    const uImgSize = gl.getUniformLocation(prog, 'uImgSize');
    const uWaveSize = gl.getUniformLocation(prog, 'uWaveSize');
    const uTime = gl.getUniformLocation(prog, 'uTime');
    const uFogPeriod = gl.getUniformLocation(prog, 'uFogPeriod');
    const uWaveCap = gl.getUniformLocation(prog, 'uWaveCap');
    const uReduceMotion = gl.getUniformLocation(prog, 'uReduceMotion');

    // ─── Resize handler — sincroniza canvas + DPR a tamaño contenedor
    let cw = 0, ch = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const resize = (): void => {
      const rect = container.getBoundingClientRect();
      cw = Math.max(1, rect.width);
      ch = Math.max(1, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const pw = Math.floor(cw * dpr);
      const ph = Math.floor(ch * dpr);
      glCanvas.width = pw;
      glCanvas.height = ph;
      glCanvas.style.width = `${cw}px`;
      glCanvas.style.height = `${ch}px`;
      fishCanvas.width = pw;
      fishCanvas.height = ph;
      fishCanvas.style.width = `${cw}px`;
      fishCanvas.style.height = `${ch}px`;
      fishCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    // ─── Pointer tracking — convierte clientX/Y a image-UV (para wave) y a
    // canvas-pixel (para fish targets).
    const pointer = {
      active: false,
      canvasX: 0, canvasY: 0,           // píxeles del canvas (para fish)
      imgU: 0, imgV: 0,                  // UV imagen (para wave-field)
      lastImgU: 0, lastImgV: 0,
      hasLast: false,
      vel: 0,
    };

    const onMove = (e: PointerEvent): void => {
      const rect = container.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      if (cx < 0 || cy < 0 || cx > rect.width || cy > rect.height) {
        pointer.active = false;
        pointer.hasLast = false;
        return;
      }
      const cu = cx / rect.width;
      const cv = cy / rect.height;
      const iuv = canvasUVToImgUV({ x: cu, y: cv }, rect.width, rect.height, imgW, imgH);
      if (pointer.active) {
        const dxu = iuv.x - pointer.imgU;
        const dyv = iuv.y - pointer.imgV;
        pointer.vel = Math.hypot(dxu, dyv) * Math.max(rect.width, rect.height);
      }
      pointer.canvasX = cx;
      pointer.canvasY = cy;
      pointer.imgU = iuv.x;
      pointer.imgV = iuv.y;
      pointer.active = true;
    };
    window.addEventListener('pointermove', onMove, { passive: true });

    // ─── Peces (4 fijos)
    // Posiciones iniciales en image-UV, dispersos por el lago.
    const FISH_PALETTE = [
      { fill: '#5a7480', rim: '#9cc7c8', belly: '#2a3942', fin: '#7fa2a8', eye: '#0a1419' },
      { fill: '#4d6770', rim: '#8eb8b8', belly: '#243038', fin: '#6c8e92', eye: '#0a1419' },
      { fill: '#5d6f6a', rim: '#a4c2b8', belly: '#283731', fin: '#7c9890', eye: '#0a1419' },
      { fill: '#637480', rim: '#a8c4cc', belly: '#2c3a44', fin: '#84a0aa', eye: '#0a1419' },
    ];
    // Spawn UV — distribuidos por todo el lago, incluyendo el sector
    // bajo la roca (donde está el reflejo del lobo). 5 peces, cubrimos
    // izquierda, centro, abajo, y zona reflejo del lobo, así el cursor
    // siempre tiene un candidato cerca para volverse curious.
    // El sector más alto que toleramos para spawns/orbits es y≥0.66 — más
    // arriba la mask se vuelve feather de árboles y, aunque el clamp empuja
    // de regreso, el cuerpo (~50px de largo) llega a asomar contra la
    // línea del bosque antes de la corrección. Mantenerlos más abajo
    // garantiza que ni un nadador en la cresta de su orbit (cy - ry) toque
    // el feather superior.
    const SPAWN_UV: Vec[] = [
      { x: 0.16, y: 0.66 },
      { x: 0.34, y: 0.78 },
      { x: 0.52, y: 0.72 },
      { x: 0.46, y: 0.92 },
      { x: 0.92, y: 0.80 }, // bajo la roca, zona reflejo del lobo
    ];

    const fishes: LakeFish[] = [];
    // Estado global del state machine de peces. Solo UN pez está en
    // 'curious' a la vez. Lo declaramos ANTES de buildFishes para que
    // este pueda resetearlo en cada rebuild — si no, una resize del
    // contenedor podía dejar un índice "huérfano" apuntando a un pez
    // recién creado en estado idle, y el state machine quedaba trabado
    // (ningún pez nuevo era elegido como curious).
    let activeCuriousIdx = -1;
    const buildFishes = (): void => {
      fishes.length = 0;
      activeCuriousIdx = -1;
      for (let i = 0; i < SPAWN_UV.length; i++) {
        const uvSpawn = SPAWN_UV[i];
        const cuv = imgUVToCanvasUV(uvSpawn, cw, ch, imgW, imgH);
        const start = { x: cuv.x * cw, y: cuv.y * ch };
        // Tamaño visible — ligeramente más grande que antes para que se
        // note el seguimiento al cursor sin volverse protagónico.
        const sc = Math.max(3.0, Math.min(5.0, cw / 320));
        fishes.push(new LakeFish(start, {
          segments: 12,
          segLen: sc * 0.95,
          bodyScale: sc,
          // speedScale alineado con peces ambientales del abismo (0.55-0.85).
          // El "tranquilo, bonito" se logra con esta velocidad + smoothing
          // del target: ni se teleporta ni se siente lento, fluye natural.
          speedScale: 0.55 + Math.random() * 0.30,
          color: FISH_PALETTE[i % FISH_PALETTE.length],
          orbit: {
            cx: uvSpawn.x,
            cy: uvSpawn.y,
            // ry achicado (antes 0.035–0.065) — limita la deriva vertical
            // del patrullaje para que el pez nunca se acerque al feather
            // superior de la orilla. La cresta del orbit (cy - ry) ahora
            // queda al menos 0.04 image-V por debajo de su spawn.
            rx: 0.05 + Math.random() * 0.04,
            ry: 0.022 + Math.random() * 0.018,
            phase: Math.random() * Math.PI * 2,
            speed: 0.16 + Math.random() * 0.10,
          },
        }));
      }
    };
    buildFishes();

    const ro = new ResizeObserver(() => {
      resize();
      buildFishes();
    });
    ro.observe(container);

    let isOnScreen = true;
    let isTabVisible = !document.hidden;
    const isActive = (): boolean => isOnScreen && isTabVisible;

    let raf = 0;
    let lastT = performance.now();
    let waveAccumulator = 0;
    let timeS = 0;
    // Idéntico al hero del abismo: 120 substeps/s. Las ondas se propagan
    // y rebotan al mismo ritmo que en esa sección.
    const WAVE_STEP = 1 / 120;
    // 26s por ciclo — orbital drift + warp + dos octavas. Más corto que
    // 36s para que el movimiento se perciba al primer vistazo sin tener
    // que clavarle decenas de segundos a la pantalla; aún suficientemente
    // lento para que la silueta se sienta como respiración premium.
    const FOG_PERIOD = 26;

    const start = (): void => {
      if (raf !== 0) return;
      lastT = performance.now();
      raf = requestAnimationFrame(tick);
    };
    const stop = (): void => {
      if (raf === 0) return;
      cancelAnimationFrame(raf);
      raf = 0;
    };

    const io = new IntersectionObserver(([entry]) => {
      isOnScreen = entry.isIntersecting;
      if (isActive()) start(); else stop();
    }, { threshold: 0 });
    io.observe(container);

    const onVis = (): void => {
      isTabVisible = !document.hidden;
      if (isActive()) start(); else stop();
    };
    document.addEventListener('visibilitychange', onVis);

    const tick = (now: number): void => {
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      timeS += dt;

      // 1) Wave-field — strength alineada al hero del abismo (0.18 base
      // + vel*0.014). Solo pokeamos si el cursor SE MOVIÓ entre frames.
      // Si está quieto sobre el agua, no genera ondas (requisito explícito
      // del usuario). El primer evento solo registra posición sin pokear.
      if (pointer.active) {
        if (!pointer.hasLast) {
          pointer.lastImgU = pointer.imgU;
          pointer.lastImgV = pointer.imgV;
          pointer.hasLast = true;
        } else {
          const dxu = pointer.imgU - pointer.lastImgU;
          const dyv = pointer.imgV - pointer.lastImgV;
          const movedSq = dxu * dxu + dyv * dyv;
          // Threshold ~1px en image-UV de 1280 — filtra jitter de trackpad.
          if (movedSq > 0.000001) {
            const baseStrength = 0.18 + Math.min(pointer.vel * 0.014, 0.32);
            waves.pokeLine(
              pointer.lastImgU, pointer.lastImgV,
              pointer.imgU, pointer.imgV,
              baseStrength,
            );
            pointer.lastImgU = pointer.imgU;
            pointer.lastImgV = pointer.imgV;
          }
        }
        pointer.vel *= 0.74;
      } else {
        pointer.hasLast = false;
      }

      waveAccumulator += dt;
      let steps = 0;
      while (waveAccumulator >= WAVE_STEP && steps < 4) {
        waves.step();
        waveAccumulator -= WAVE_STEP;
        steps++;
      }

      // Subir wave field a textura
      gl.bindTexture(gl.TEXTURE_2D, waveTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, WAVE_COLS, WAVE_ROWS, gl.RED, gl.UNSIGNED_BYTE, waves.packForTexture());

      // 2) State machine de peces
      // Cooldown timers + transición de vuelta a idle. Sin esta transición,
      // tras un ciclo curious → leaving → cooldown el pez se queda en estado
      // 'cooldown' con cooldownLeft<=0, y el selector (que requiere 'idle')
      // nunca lo elige más → loop muerto. El usuario quiere bucle infinito:
      // cuando el último pez termina su ciclo, el primero ya debe estar
      // listo para volver a perseguir el cursor.
      for (const f of fishes) {
        if (f.cooldownLeft > 0) f.cooldownLeft -= dt;
        if (f.state === 'cooldown' && f.cooldownLeft <= 0) {
          f.state = 'idle';
        }
      }

      // Si hay alguien curioso, decrementa su timer; cuando se acaba,
      // transición DIRECTA a cooldown. Sin estado 'leaving' — el pez no
      // huye, simplemente pierde interés y su target switchea de "cursor"
      // a "orbit center"; con el smoothing del setTargetSmooth, eso se
      // traduce visualmente en que el pez deja de seguir y se aleja
      // tranquilo, exactamente como pediste.
      if (activeCuriousIdx >= 0) {
        const curr = fishes[activeCuriousIdx];
        if (!curr || curr.state !== 'curious') {
          activeCuriousIdx = -1;
        } else {
          curr.stateTimer -= dt;
          if (curr.stateTimer <= 0) {
            curr.state = 'cooldown';
            // Cooldown corto (3-5s) — con 5 peces el ciclo total es ~30s,
            // bucle continuo: cuando el último termina, el primero ya
            // volvió a idle y puede ser elegido.
            curr.cooldownLeft = 3 + Math.random() * 2;
            activeCuriousIdx = -1;
          }
        }
      }

      // ¿Elegir nuevo curious? Solo si:
      //   - cursor está activo dentro del contenedor
      //   - cursor está sobre agua (mask > 0.3 en el punto del cursor)
      //   - no hay nadie curious en este momento
      //   - hay candidatos (idle, cooldownLeft<=0) cerca del cursor
      if (activeCuriousIdx === -1 && pointer.active) {
        const onWater = waves.sampleMask(pointer.imgU, pointer.imgV) > 0.3;
        if (onWater) {
          let bestIdx = -1;
          let bestDist = Infinity;
          for (let i = 0; i < fishes.length; i++) {
            const f = fishes[i];
            if (f.state !== 'idle' || f.cooldownLeft > 0) continue;
            const head = f.spine[0];
            const dist = Math.hypot(head.x - pointer.canvasX, head.y - pointer.canvasY);
            // Solo elegir si el pez está razonablemente cerca (no que cruce
            // todo el lago). Threshold proporcional al canvas.
            if (dist < cw * 0.45 && dist < bestDist) {
              bestDist = dist;
              bestIdx = i;
            }
          }
          if (bestIdx >= 0) {
            const chosen = fishes[bestIdx];
            chosen.state = 'curious';
            // Curiosidad 4-6s — tiempo suficiente para que se note el
            // seguimiento como una interacción "tranquila", no apuro.
            chosen.stateTimer = 4 + Math.random() * 2;
            activeCuriousIdx = bestIdx;
          }
        }
      }

      // Helper — recibe un target en canvas-px. Si cae fuera de "agua
      // sólida" (mask > 0.85), camina sobre la línea hacia "fromX/Y"
      // hasta encontrar el primer punto en agua sólida. Threshold 0.85
      // (antes 0.65) garantiza que el target NUNCA cae en el feather
      // ancho de la orilla del bosque — el cuerpo del pez (cabeza +
      // nariz, ~50px de largo total) cabe entero adentro del lago sin
      // asomar a la línea de árboles ni a la roca, ni siquiera por el
      // tamaño de un cursor de flecha (~16-20px) como estaba ocurriendo.
      const constrainTargetToWater = (
        tx: number, ty: number, fromX: number, fromY: number,
      ): Vec => {
        const sample = (x: number, y: number): number => {
          const iuv = canvasUVToImgUV(
            { x: x / cw, y: y / ch }, cw, ch, imgW, imgH,
          );
          return waves.sampleMask(iuv.x, iuv.y);
        };
        if (sample(tx, ty) > 0.85) return { x: tx, y: ty };
        // Walk back desde target → fish hasta encontrar agua sólida.
        for (let t = 0.85; t >= 0; t -= 0.1) {
          const px = fromX + (tx - fromX) * t;
          const py = fromY + (ty - fromY) * t;
          if (sample(px, py) > 0.85) return { x: px, y: py };
        }
        return { x: fromX, y: fromY };
      };

      // 3) Set targets per estado y update peces. Todos los targets se
      // setean con smoothing al estilo abismo (target += (raw - target) * k):
      //   curious: 0.18 (el pez chasea al cursor con retraso suave)
      //   idle / cooldown: 0.04 (drift suave por la órbita)
      // Esta interpolación, sumada al pull del head hacia target, da el
      // doble smoothing que se siente "tranquilo y bonito".
      for (let i = 0; i < fishes.length; i++) {
        const f = fishes[i];
        const head = f.spine[0];
        if (f.state === 'curious') {
          // Offset orbital chiquito y lento — el pez ronda el cursor en
          // lugar de pegarse exacto encima. bodyScale*1.5 ≈ 6-7px de
          // radio horizontal. El offset vertical queda achicado (0.55,
          // antes 1.2) para que, cuando el cursor esté cerca del bosque,
          // el pez no se desvíe arriba del cursor y termine empujado
          // contra el feather. La oscilación lateral mantiene la
          // sensación de "pez curioso", la vertical solo aporta vida.
          const offset = Math.sin(timeS * 0.9 + i) * f.bodyScale * 1.5;
          const offsetY = Math.cos(timeS * 0.8 + i) * f.bodyScale * 0.55;
          const rawTx = pointer.canvasX + offset;
          const rawTy = pointer.canvasY + offsetY;
          const constrained = constrainTargetToWater(rawTx, rawTy, head.x, head.y);
          f.setTargetSmooth(constrained, 0.18);
        } else {
          // idle / cooldown — patrullaje en orbit con drift suave.
          f.orbit.phase += dt * f.orbit.speed;
          let tx = f.orbit.cx + Math.cos(f.orbit.phase) * f.orbit.rx;
          let ty = f.orbit.cy + Math.sin(f.orbit.phase * 1.3) * f.orbit.ry;
          if (waves.sampleMask(tx, ty) < 0.3) {
            tx = f.orbit.cx;
            ty = f.orbit.cy;
          }
          const cuv = imgUVToCanvasUV({ x: tx, y: ty }, cw, ch, imgW, imgH);
          f.setTargetSmooth({ x: cuv.x * cw, y: cuv.y * ch }, 0.04);
        }
        f.update(dt);

        // Defensive head clamp — si la cabeza entra al feather de la
        // orilla (mask < 0.82), la empujamos de vuelta al orbit center.
        // Threshold 0.82 (antes 0.55): el cuerpo del pez tiene ~50px
        // de largo y la nariz sobresale del head ~bodyScale*0.5 px;
        // con 0.55 quedaba un margen demasiado angosto y, en frames
        // donde el pez seguía al cursor en línea recta hacia el bosque,
        // nariz + cabeza alcanzaban a asomar ~16-20px contra la línea
        // de árboles antes de que el clamp lo notara. Subiéndolo a
        // 0.82 el clamp dispara mucho antes y todo el cuerpo + nariz
        // se quedan dentro del agua sólida.
        const headIuv = canvasUVToImgUV(
          { x: head.x / cw, y: head.y / ch }, cw, ch, imgW, imgH,
        );
        if (waves.sampleMask(headIuv.x, headIuv.y) < 0.82) {
          const oc = imgUVToCanvasUV(
            { x: f.orbit.cx, y: f.orbit.cy }, cw, ch, imgW, imgH,
          );
          const ocx = oc.x * cw;
          const ocy = oc.y * ch;
          const dx = ocx - head.x;
          const dy = ocy - head.y;
          const d = Math.hypot(dx, dy) || 1;
          // Empuje proporcional a "qué tan adentro de la orilla está":
          // entre 5 y 15 px/frame. Cuanto más cerca del bosque, más
          // fuerte el empuje hacia el agua. Denominador 0.82 alineado
          // al threshold de detección.
          const m = waves.sampleMask(headIuv.x, headIuv.y);
          const push = 5 + (1 - m / 0.82) * 10;
          head.x += (dx / d) * push;
          head.y += (dy / d) * push;
        }
      }

      // 4) Render WebGL pass
      gl.viewport(0, 0, glCanvas.width, glCanvas.height);
      gl.clearColor(0.024, 0.035, 0.10, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, imgTex); gl.uniform1i(uImage, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, maskTex); gl.uniform1i(uMask, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, waveTex); gl.uniform1i(uWave, 2);
      gl.uniform2f(uCanvasSize, glCanvas.width, glCanvas.height);
      gl.uniform2f(uImgSize, imgW, imgH);
      gl.uniform2f(uWaveSize, WAVE_COLS, WAVE_ROWS);
      gl.uniform1f(uTime, timeS);
      gl.uniform1f(uFogPeriod, FOG_PERIOD);
      gl.uniform1f(uWaveCap, waves.heightCap);
      gl.uniform1f(uReduceMotion, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(null);

      // 5) Render fish overlay (Canvas 2D)
      fishCtx.clearRect(0, 0, cw, ch);
      // Slight blur + low alpha — sensación de "están bajo el agua".
      fishCtx.save();
      fishCtx.filter = 'blur(0.6px)';
      for (const f of fishes) f.render(fishCtx);
      fishCtx.restore();

      raf = requestAnimationFrame(tick);
    };

    // Empezar
    if (isActive()) start();

    return () => {
      stop();
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', onVis);
      io.disconnect();
      ro.disconnect();
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(vbo);
      gl.deleteVertexArray(vao);
      gl.deleteTexture(imgTex);
      gl.deleteTexture(maskTex);
      gl.deleteTexture(waveTex);
    };
  }
}
