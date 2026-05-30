import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';

/**
 * OceanBackground
 * -----------------------------------------------------------------------------
 * Capa fija (position: fixed) que ocupa el viewport completo. Sobre ella nadan
 * peces silueta a distintas profundidades, cae plancton bioluminiscente y se
 * difunde la luz cáustica del agua.
 *
 * Filosofía:
 *  - Un solo canvas para toda la app: el lienzo se queda quieto y las
 *    secciones de la página son las que pasan por encima al hacer scroll.
 *  - El hero NO se ve afectado: tiene su propio bg-mesh-deep opaco.
 *  - Los PageHeader de páginas internas también son opacos, así que el
 *    océano sólo es visible al pasar el primer pliegue.
 *  - Las cards con backdrop-blur capturan los peces nadando detrás como una
 *    silueta esmerilada — efecto vidrio premium real.
 *
 * Ports al ambiente Angular:
 *  - afterNextRender garantiza que el código corre solo en el browser (SSR-safe).
 *  - DestroyRef cancela RAF y listeners al desmontar.
 * -----------------------------------------------------------------------------
 */

type Vec = { x: number; y: number };

// Tintas brass / oro. Match al italic de los títulos (--brass = rgb 255 210
// 74 = #FFD24A). 4 variantes dentro de la familia cream-brass-bronze.
//
// Los colores van OPACOS (sin alpha en la rgb) porque ahora la alpha se
// controla via globalAlpha en render(), y el blend es ADITIVO
// (globalCompositeOperation = 'lighter'). Bajo 'lighter', el alpha
// multiplica cuánta luz se SUMA al navy del fondo en vez de cuán opaco
// queda el pixel — exactamente lo que produce el efecto "tech glow" que
// el usuario pidió: los peces brillan dorado, no son siluetas que tapan.
//
// `glow` se usa como shadowColor para el halo. Es la versión saturada/clara
// del body que bleedea hacia afuera con shadowBlur — el bloom que vende el
// look de luz tecnológica (cf. neon, holograma, fiber-optic readouts).
const TINTS: ReadonlyArray<{ body: string; tail: string; glow: string }> = [
  // Brass base — el dorado clásico, match al italic de los títulos
  { body: 'rgb(232, 195, 130)', tail: 'rgb(210, 175, 105)', glow: 'rgba(255, 215, 140, 1)' },
  // Cream-gold — más claro, lectura "luz reflejada"
  { body: 'rgb(245, 215, 155)', tail: 'rgb(225, 190, 125)', glow: 'rgba(255, 230, 170, 1)' },
  // Bronze-warm — un toque más cálido sin caer en naranja
  { body: 'rgb(220, 180, 105)', tail: 'rgb(195, 155, 80)', glow: 'rgba(250, 205, 130, 1)' },
  // Champagne — el más pálido y etéreo
  { body: 'rgb(252, 228, 175)', tail: 'rgb(232, 200, 145)', glow: 'rgba(255, 240, 200, 1)' },
];

// ============================================================================
// ShadowFish — pez procedural ambiental.
//
// La versión anterior tenía 3 defectos visuales que el usuario marcó:
//   1. "Parecían renacuajos" — la onda solo afectaba i=2..N, cabeza y cuerpo
//      rígidos. Movimiento de tadpole, no de pez.
//   2. "Doblaban por el mismo camino y se deformaban" — el head usaba lerp
//      directo hacia el target. Cuando el target quedaba detrás, el head
//      pivotaba en el mismo punto y FABRIK forzaba el cuerpo a doblarse en
//      horquilla (hairpin), no en arco.
//   3. "Tienen que doblar como una C" — pedido explícito de C-shape turn.
//
// Reescritura combina TRES técnicas validadas (research notes en
// memory/reference_fish_animation_research.md):
//
//   A) Modelo cinemático tipo bicycle (Dubins): `forwardSpeed` siempre > 0
//      modulado por alignment con target; `heading` rota a `maxTurnRate`
//      bounded. Esto crea un radio mínimo de giro (Rmin = speed/turnRate)
//      que IMPIDE el pivot en su lugar. Si el target queda detrás, el pez
//      sobrepasa, arquea, y vuelve — exactamente lo que hacen los peces
//      reales.
//
//   B) Chain espacial argonaut (animal-proc-anim): los joints persisten en
//      coords mundo entre frames. Cada joint mantiene distancia fija al
//      anterior Y un ángulo bounded (±20°) vs el ángulo del anterior. Cuando
//      el head gira rápido, el cuerpo NO puede plegar más de ese ángulo por
//      joint, así que emerge una curva continua C-shape. Sin parpadeos, sin
//      hairpins, sin "carta agarrada de la trompa".
//
//   C) Carangiform traveling wave en TODO el cuerpo: `sin(swimPhase - k*u)`
//      con envelope cuadrático `u²` (cabeza 0, cola máxima). Wavelength ~1.2
//      longitudes corporales (k≈5.2), frecuencia ~1 Hz (omega ~6.5 rad/s).
//      La onda se aplica perpendicular a la tangente de la cadena en cada
//      joint, así undulación + giro coexisten sin distorsión.
// ============================================================================
class ShadowFish {
  // Posición y heading de la cabeza (modelo cinemático).
  x: number;
  y: number;
  heading: number;
  forwardSpeed: number;

  // Onda de nado.
  swimPhase: number;
  swimOmega: number;

  // Geometría.
  bodyLength: number;
  segments: number;
  segLen: number;

  // Visual.
  baseAlpha: number;
  tint: { body: string; tail: string; glow: string };
  // bodyScale mantenido como alias de bodyLength para el sort by-size del
  // tick (los peces lejanos se pintan primero).
  bodyScale: number;

  // Target navigation.
  target: Vec;
  targetTimer = 0;

  // Constantes cinemáticas — bounded turn rate crea Rmin = speed/turnRate.
  readonly maxTurnRate: number;
  readonly minSpeed: number;
  readonly maxSpeed: number;

  // Chain espacial (coords mundo). Persiste entre frames — esa persistencia
  // es lo que garantiza continuidad geométrica y curvas C limpias.
  readonly chainJoints: Vec[];
  readonly chainAngles: number[];
  // 20° max bend por joint. Sumado por 12 joints = 240° de curvatura total
  // máxima — suficiente para una C cerrada en U-turn sin permitir hairpin.
  readonly bendLimit = Math.PI / 9;

  constructor(start: Vec, w: number, h: number, depth: number) {
    // depth: 0..1 — 0 cerca, 1 lejos.
    //
    // Viewport scale: el bodyLength base está calibrado para desktop 1440px.
    // En phone 360 sin escala los peces se ven desproporcionados (~35% del
    // ancho del viewport por un pez "cerca"). `viewportScale` interpola
    // lineal entre 0.45 (phone <540) y 1.0 (desktop ≥1200):
    //   phone 360-540 → 0.45 → bodyLength 14-44px
    //   tablet 768    → 0.64 → 20-62px
    //   desktop 1200+ → 1.00 → 31-97px
    const viewportScale = Math.max(0.45, Math.min(1.0, w / 1200));
    this.bodyLength = ((1 - depth) * 66 + 31) * viewportScale;
    this.bodyScale = this.bodyLength;
    this.segments = 12;
    this.segLen = this.bodyLength / this.segments;

    this.baseAlpha = 0.55 + (1 - depth) * 0.30;
    this.tint = TINTS[Math.floor(Math.random() * TINTS.length)];

    this.x = start.x;
    this.y = start.y;
    this.heading = Math.random() * Math.PI * 2;

    this.swimPhase = Math.random() * Math.PI * 2;
    // omega 5.0-7.0 rad/s = ~0.8-1.1 Hz. Frecuencia baja para lectura
    // atmosférica — peces de fondo, no de acción.
    this.swimOmega = 5.0 + Math.random() * 2.0;

    // Speed: 22-50 px/s con boost por depth. Bajo en términos absolutos
    // (1-2.5 cards width por segundo) para preservar feel "ambiente".
    this.maxSpeed = 22 + (1 - depth) * 28;
    this.minSpeed = this.maxSpeed * 0.50;
    this.forwardSpeed = this.maxSpeed * 0.85;

    // Turn rate 0.7-1.3 rad/s (~40-75°/s). Combinado con speed da Rmin
    // ~22/1.3 = 17px hasta ~50/0.7 = 71px — siempre menor al bodyLength,
    // garantiza que U-turns produzcan una C clara y no un círculo apretado.
    this.maxTurnRate = 0.7 + (1 - depth) * 0.6;

    // Init de la chain: línea recta detrás del head, todos los ángulos
    // alineados con heading. Cualquier movimiento posterior los ajusta.
    this.chainJoints = [];
    this.chainAngles = [];
    for (let i = 0; i <= this.segments; i++) {
      this.chainJoints.push({
        x: this.x - Math.cos(this.heading) * i * this.segLen,
        y: this.y - Math.sin(this.heading) * i * this.segLen,
      });
      this.chainAngles.push(this.heading);
    }

    this.target = { x: 0, y: 0 };
    this.pickTarget(w, h);
  }

  private pickTarget(w: number, h: number): void {
    // Distancia mínima 320px — targets más cercanos producen loops cerrados
    // donde el pez orbita sin alcanzar (overshoot constante por Rmin).
    const angle = Math.random() * Math.PI * 2;
    const dist = 320 + Math.random() * 480;
    this.target.x = Math.max(60, Math.min(w - 60, this.x + Math.cos(angle) * dist));
    this.target.y = Math.max(60, Math.min(h - 60, this.y + Math.sin(angle) * dist));
    this.targetTimer = 5 + Math.random() * 5;
  }

  update(dt: number, w: number, h: number): void {
    this.targetTimer -= dt;
    if (this.targetTimer <= 0) this.pickTarget(w, h);

    // Edge avoidance proactiva: si el pez está cerca del borde y el heading
    // lo lleva afuera, pickea target hacia el centro. Sin esto, peces que
    // hicieron lock con un heading hacia el borde llegan a tocar el clamp
    // visualmente y se ven "atascados".
    const margin = 50;
    const lookaheadDist = this.forwardSpeed * 1.2;
    const lookX = this.x + Math.cos(this.heading) * lookaheadDist;
    const lookY = this.y + Math.sin(this.heading) * lookaheadDist;
    if (
      lookX < margin || lookX > w - margin ||
      lookY < margin || lookY > h - margin
    ) {
      // Apuntar al cuadrante centro con jitter ±90° — evita que todos los
      // peces converjan al centro exacto y formen un nudo.
      const centerAngle = Math.atan2(h / 2 - this.y, w / 2 - this.x);
      const jitter = (Math.random() - 0.5) * Math.PI;
      const newAngle = centerAngle + jitter;
      const dist = 280 + Math.random() * 320;
      this.target.x = Math.max(80, Math.min(w - 80, this.x + Math.cos(newAngle) * dist));
      this.target.y = Math.max(80, Math.min(h - 80, this.y + Math.sin(newAngle) * dist));
      this.targetTimer = 4 + Math.random() * 3;
    }

    // ── Modelo cinemático bicycle ─────────────────────────────────────────
    const targetAngle = Math.atan2(this.target.y - this.y, this.target.x - this.x);
    let diff = targetAngle - this.heading;
    // Normalizar a (-π, π]
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;

    // Rotar heading bounded por maxTurnRate. El sign(diff) elige el lado
    // del giro que produce menor recorrido angular.
    const maxStep = this.maxTurnRate * dt;
    const headingDelta = Math.sign(diff) * Math.min(Math.abs(diff), maxStep);
    this.heading += headingDelta;

    // Speed modulado por alignment: cuando el target está al frente
    // (alignment=1), va al máximo; cuando está detrás (alignment=-1), va
    // al mínimo — pero NUNCA se detiene. Eso es lo que mata el pivot.
    const alignment = Math.cos(diff);
    const targetSpeed = this.minSpeed +
      (this.maxSpeed - this.minSpeed) * (0.5 + 0.5 * alignment);
    // Lerp con tau ~500ms (k=2) para sensación de masa/momentum.
    this.forwardSpeed += (targetSpeed - this.forwardSpeed) * Math.min(1, dt * 2);

    // Integrar posición.
    this.x += Math.cos(this.heading) * this.forwardSpeed * dt;
    this.y += Math.sin(this.heading) * this.forwardSpeed * dt;

    // ── Resolver chain espacial (argonaut) ────────────────────────────────
    // Head salta a la nueva posición. chainAngles[0] = heading actúa como
    // anchor para el constraint de chainAngles[1].
    this.chainJoints[0].x = this.x;
    this.chainJoints[0].y = this.y;
    this.chainAngles[0] = this.heading;

    for (let i = 1; i < this.chainJoints.length; i++) {
      const prev = this.chainJoints[i - 1];
      const cur = this.chainJoints[i];
      // Look-back natural: dirección desde cur hacia prev.
      const naturalLookBack = Math.atan2(prev.y - cur.y, prev.x - cur.x);
      // Constrain a ±bendLimit del look-back del joint anterior. Esto es
      // lo que garantiza que el cuerpo NUNCA se pliegue en horquilla:
      // máximo 20° de curvatura entre joints adyacentes.
      const constrained = this.constrainAngle(
        naturalLookBack,
        this.chainAngles[i - 1],
        this.bendLimit,
      );
      this.chainAngles[i] = constrained;
      // Reposicionar cur a distancia segLen de prev en la dirección OPUESTA
      // al look-back (prev → cur = -lookBack).
      this.chainJoints[i].x = prev.x - Math.cos(constrained) * this.segLen;
      this.chainJoints[i].y = prev.y - Math.sin(constrained) * this.segLen;
    }

    // ── Avanzar fase del wave ─────────────────────────────────────────────
    this.swimPhase += this.swimOmega * dt;
  }

  private constrainAngle(angle: number, anchor: number, limit: number): number {
    let d = angle - anchor;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    d = Math.max(-limit, Math.min(limit, d));
    return anchor + d;
  }

  // Perfil de ancho del cuerpo. u in [0, 1], 0=head, 1=tail. Profile peaks
  // ~30% del head (sin(π·u^0.55) tiene su máximo cerca de u=0.3 con esa
  // potencia), taper lineal hacia la cola.
  private bodyWidth(u: number): number {
    const profile = Math.sin(Math.PI * Math.pow(u, 0.55));
    const taper = 1 - 0.6 * u;
    return Math.max(0.8, profile * taper * this.bodyLength * 0.075);
  }

  render(ctx: CanvasRenderingContext2D): void {
    // Construir la spine visual: chain (curva del giro) + wave (undulación).
    // El wave se añade perpendicular a la tangente local de la chain en cada
    // joint, así girar + nadar coexisten sin que uno distorsione al otro.
    const N = this.chainJoints.length;
    // Wavelength ~1.2 bodyLengths → k = 2π/1.2 ≈ 5.24. Amplitud cresce
    // cuadráticamente desde el head (envelope u²) hasta la cola.
    const k = 5.2;
    const ampMax = this.bodyLength * 0.08;

    const spine: Vec[] = new Array(N);
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1);
      const envelope = u * u;
      const waveOffset = Math.sin(this.swimPhase - k * u) * ampMax * envelope;

      const joint = this.chainJoints[i];
      // Tangente local: promedio de los vecinos para los interiores; en
      // los extremos usa el vecino disponible. La perpendicular es
      // (-tangentY, tangentX) — la onda se aplica en esa dirección.
      let tx: number, ty: number;
      if (i === 0) {
        const next = this.chainJoints[1];
        tx = joint.x - next.x;
        ty = joint.y - next.y;
      } else if (i === N - 1) {
        const prev = this.chainJoints[i - 1];
        tx = prev.x - joint.x;
        ty = prev.y - joint.y;
      } else {
        const prev = this.chainJoints[i - 1];
        const next = this.chainJoints[i + 1];
        tx = prev.x - next.x;
        ty = prev.y - next.y;
      }
      const tl = Math.hypot(tx, ty) || 1;
      const perpX = -ty / tl;
      const perpY = tx / tl;

      spine[i] = {
        x: joint.x + perpX * waveOffset,
        y: joint.y + perpY * waveOffset,
      };
    }

    // ── Outline del cuerpo (left + right de la spine) ─────────────────────
    const left: Vec[] = new Array(N);
    const right: Vec[] = new Array(N);

    for (let i = 0; i < N; i++) {
      const u = i / (N - 1);
      const w = this.bodyWidth(u);
      const cur = spine[i];
      const prev = spine[Math.max(0, i - 1)];
      const next = spine[Math.min(N - 1, i + 1)];
      const tx = next.x - prev.x;
      const ty = next.y - prev.y;
      const tl = Math.hypot(tx, ty) || 1;
      const nx = -ty / tl;
      const ny = tx / tl;
      left[i] = { x: cur.x + nx * w, y: cur.y + ny * w };
      right[i] = { x: cur.x - nx * w, y: cur.y - ny * w };
    }

    const head = spine[0];
    const tail = spine[N - 1];

    // ── Caudal fin (cola en abanico) ──────────────────────────────────────
    const tailPrev = spine[N - 2];
    const tdx = tail.x - tailPrev.x;
    const tdy = tail.y - tailPrev.y;
    const tdl = Math.hypot(tdx, tdy) || 1;
    const tDirX = tdx / tdl;
    const tDirY = tdy / tdl;
    const tNx = -tDirY;
    const tNy = tDirX;
    const finReach = this.bodyLength * 0.14;
    const finWidth = this.bodyLength * 0.09;
    // El wag de la cola sigue la fase del wave (extendido un período más
    // allá del último joint) — extensión natural de la undulación.
    const tailWag = Math.sin(this.swimPhase - k) * (this.bodyLength * 0.05);

    const tailEnd: Vec = {
      x: tail.x + tDirX * finReach + tNx * tailWag * 0.4,
      y: tail.y + tDirY * finReach + tNy * tailWag * 0.4,
    };
    const tailUp: Vec = {
      x: tail.x + tDirX * finReach * 0.5 + tNx * (finWidth + tailWag * 0.25),
      y: tail.y + tDirY * finReach * 0.5 + tNy * (finWidth + tailWag * 0.25),
    };
    const tailDown: Vec = {
      x: tail.x + tDirX * finReach * 0.5 - tNx * (finWidth - tailWag * 0.25),
      y: tail.y + tDirY * finReach * 0.5 - tNy * (finWidth - tailWag * 0.25),
    };

    ctx.save();
    // Blend aditivo: cada fill SUMA su color dorado al navy del fondo (en vez
    // de taparlo como en el render normal). Combinado con el shadowBlur de
    // abajo produce el "tech glow" — los peces se leen como trazas luminosas
    // que iluminan el agua a su alrededor, no como siluetas opacas. Es el
    // mismo principio que neon/aurora/fiber-optic readouts en interfaces sci-fi.
    ctx.globalCompositeOperation = 'lighter';
    // Modulamos baseAlpha por 0.55 porque bajo 'lighter' el alpha es la
    // FUERZA del aporte luminoso (no la opacidad). 0.55*0.55=0.30 promedio
    // → contribución golden ~30% sobre navy → brillo claro pero no quemado.
    ctx.globalAlpha = this.baseAlpha * 0.55;
    // Bloom dorado alrededor del cuerpo. shadowBlur escala con bodyLength
    // para que peces "cerca" (más grandes) tengan halo más amplio; shadowColor
    // es el glow tint completamente saturado — el alpha del fill modula la
    // fuerza visible del halo. Bajo 'lighter' los shadows también se suman,
    // así que halos de tail+body se refuerzan en el centro del pez.
    ctx.shadowColor = this.tint.glow;
    ctx.shadowBlur = this.bodyLength * 0.30;

    ctx.fillStyle = this.tint.tail;
    ctx.beginPath();
    ctx.moveTo(tail.x, tail.y);
    ctx.quadraticCurveTo(tailUp.x, tailUp.y, tailEnd.x, tailEnd.y);
    ctx.quadraticCurveTo(tailDown.x, tailDown.y, tail.x, tail.y);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = this.tint.body;
    ctx.beginPath();
    ctx.moveTo(head.x, head.y);
    for (let i = 0; i < N - 1; i++) {
      const c1 = left[i];
      const c2 = left[i + 1];
      const mx = (c1.x + c2.x) / 2;
      const my = (c1.y + c2.y) / 2;
      ctx.quadraticCurveTo(c1.x, c1.y, mx, my);
    }
    ctx.lineTo(tail.x, tail.y);
    for (let i = N - 1; i > 0; i--) {
      const c1 = right[i];
      const c2 = right[i - 1];
      const mx = (c1.x + c2.x) / 2;
      const my = (c1.y + c2.y) / 2;
      ctx.quadraticCurveTo(c1.x, c1.y, mx, my);
    }
    ctx.lineTo(head.x, head.y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

class Mote {
  x: number;
  y: number;
  r: number;
  vy: number;
  drift: number;
  phase: number;
  alpha: number;

  constructor(w: number, h: number) {
    this.x = Math.random() * w;
    this.y = Math.random() * h;
    this.r = 0.4 + Math.random() * 1.3;
    this.vy = -3 - Math.random() * 7;
    this.drift = (Math.random() - 0.5) * 0.5;
    this.phase = Math.random() * Math.PI * 2;
    this.alpha = 0.07 + Math.random() * 0.10;
  }

  update(dt: number, w: number, h: number): void {
    this.phase += dt * 0.4;
    this.y += this.vy * dt;
    this.x += Math.sin(this.phase) * this.drift;
    if (this.y < -10) {
      this.y = h + 10;
      this.x = Math.random() * w;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = `rgba(127, 227, 214, ${this.alpha})`;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

@Component({
  selector: 'app-ocean-background',
  templateUrl: './ocean-background.html',
  styleUrl: './ocean-background.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OceanBackground {
  private readonly canvasRef =
    viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);

  constructor() {
    afterNextRender(() => {
      const cleanup = this.startAnimation();
      this.destroyRef.onDestroy(() => cleanup?.());
    });
  }

  private startAnimation(): (() => void) | void {
    const canvas = this.canvasRef().nativeElement;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    // prefers-reduced-motion → un solo frame estático y fuera. Sin RAF, sin
    // listeners. Ahorro total para usuarios sensibles a movimiento.
    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    if (reducedMotion) return;

    let w = window.innerWidth;
    let h = window.innerHeight;
    // DPR 1.5 (antes 2) — los peces son siluetas suavemente difuminadas; la
    // pérdida de nitidez en pantallas Retina es imperceptible y la carga GPU
    // baja a la mitad.
    let dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    // Density por área (no lineal por width). En widescreen 1440×900 el peso
    // base es 1.0; en phone 360×640 baja a ~0.4 → menos peces, más respiro.
    //
    // Reducido de 9 → 5 (con coloración dorada los peces son notoriamente
    // más visibles que los antiguos tintes acuario; mantener la densidad
    // anterior saturaba el background). Floor de 2 en lugar de 3 para que
    // viewports muy chicos (phone landscape angosto) no se llenen.
    const fishCountForArea = (cw: number, ch: number): number => {
      const ratio = Math.sqrt((cw * ch) / (1440 * 900));
      return Math.max(2, Math.round(5 * ratio));
    };

    let fish: ShadowFish[] = [];
    let motes: Mote[] = [];

    const reflowEntities = (): void => {
      // Recompone el cast de peces por densidad. No solo redimensiona el
      // canvas: redistribuye spawn positions y ajusta cuántos peces caben
      // proporcional al área. Mismo principio para los motes (plancton).
      const targetFishCount = fishCountForArea(w, h);
      fish = Array.from({ length: targetFishCount }, (_, i) => {
        const depth = i / Math.max(1, targetFishCount - 1);
        return new ShadowFish(
          { x: Math.random() * w, y: Math.random() * h },
          w,
          h,
          depth,
        );
      });
      // Plancton: 1 mota cada ~25 000 px² (rate constante por área).
      const targetMoteCount = Math.max(12, Math.round((w * h) / 25_000));
      motes = Array.from({ length: targetMoteCount }, () => new Mote(w, h));
    };

    // Track dimensiones reales para distinguir resize "real" de un toggle de
    // address bar móvil. En iOS Safari y Chrome Android, scrollear hacia abajo
    // colapsa la barra de URL → window.innerHeight crece ~80-150px →
    // dispara `resize`. Si rebuilteamos los peces en cada uno de esos eventos,
    // el usuario ve los peces "saltar" a posiciones aleatorias cada vez que
    // cambia la dirección de scroll. Por eso reflujamos SOLO cuando el width
    // cambia o cuando el height cambia significativamente (>200px), no por
    // el típico vaivén del address bar.
    let lastReflowW = 0;
    let lastReflowH = 0;

    const resize = (): void => {
      w = window.innerWidth;
      h = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      // Canvas dimensions sí se actualizan siempre — necesario para que el
      // canvas cubra el viewport actual (incluso con address bar colapsado).
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Reflujo SOLO cuando la geometría cambió de verdad (rotación, redimensión
      // de ventana en desktop, navegación entre rutas). Los peces conservan sus
      // posiciones acumuladas durante el scroll vertical en mobile.
      const widthChanged = Math.abs(w - lastReflowW) > 1;
      const heightChangedSignificantly = Math.abs(h - lastReflowH) > 200;
      if (widthChanged || heightChangedSignificantly) {
        reflowEntities();
        lastReflowW = w;
        lastReflowH = h;
      }
    };
    resize();

    let raf = 0;
    let lastT = performance.now();

    // Pausa por scroll + visibilidad. La regla `cubierto por hero` SOLO aplica
    // en home Y SOLO en scrollY === 0: el hero (100vh, poster opaco) cubre el
    // viewport completo únicamente en su sitio inicial. Apenas el usuario
    // mueve el scroll 1px, el hero (en flujo normal) se desplaza hacia arriba
    // y la franja inferior del viewport revela el canvas fijo — los peces
    // deben estar animando desde ese mismo frame. Un umbral más amplio (p.ej.
    // 0.7vh) mantiene los peces congelados durante el 70% del scroll del
    // hero, leyéndose como imagen estática justo antes de la transición al
    // siguiente segmento. La fluidez del background gana al ahorro GPU.
    let isHomePage = this.router.url === '/' || this.router.url.startsWith('/?');
    let isCovered = isHomePage && window.scrollY === 0;
    let isTabVisible = !document.hidden;
    const isActive = (): boolean => !isCovered && isTabVisible;

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

    // Suscripción a NavigationEnd para reevaluar isHomePage al cambiar de
    // ruta. El OceanBackground es global (vive en el app shell), no se
    // recrea entre navegaciones — por eso necesitamos el observable activo.
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((event) => {
        const url = event.urlAfterRedirects;
        isHomePage = url === '/' || url.startsWith('/?');
        // Reevaluar covered: en internas nunca está covered; en home solo si
        // estamos exactamente en scrollY=0 (hero cubriendo todo el viewport).
        isCovered = isHomePage && window.scrollY === 0;
        if (isActive()) start();
        else stop();
      });

    let scrollScheduled = false;
    const onScroll = (): void => {
      // En rutas internas no hay nada que pausar por scroll — el canvas debe
      // animar siempre. Salimos temprano para ahorrar el rAF de coalescing.
      if (!isHomePage) return;
      if (scrollScheduled) return;
      scrollScheduled = true;
      requestAnimationFrame(() => {
        scrollScheduled = false;
        const wasCovered = isCovered;
        isCovered = window.scrollY === 0;
        if (wasCovered === isCovered) return;
        if (isActive()) start();
        else stop();
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    const onVisChange = (): void => {
      isTabVisible = !document.hidden;
      if (isActive()) start();
      else stop();
    };
    document.addEventListener('visibilitychange', onVisChange);

    const tick = (now: number): void => {
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;

      ctx.clearRect(0, 0, w, h);

      // Plancton al fondo
      for (const m of motes) {
        m.update(dt, w, h);
        m.render(ctx);
      }

      // Peces back-to-front (los lejanos primero). Antes cada pez aplicaba
      // `ctx.filter = blur(Xpx)` por frame — operación GPU costosa que se
      // multiplicaba por 9+ peces × 60fps. Ahora la profundidad se comunica
      // con alpha + saturación (en el constructor de ShadowFish), suficiente
      // para que se lean como siluetas a distintas distancias sin el costo
      // del filter blur.
      fish.sort((a, b) => a.bodyScale - b.bodyScale);
      for (const f of fish) {
        f.update(dt, w, h);
        f.render(ctx);
      }

      raf = requestAnimationFrame(tick);
    };
    start();

    window.addEventListener('resize', resize);

    return () => {
      stop();
      window.removeEventListener('resize', resize);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisChange);
    };
  }
}
