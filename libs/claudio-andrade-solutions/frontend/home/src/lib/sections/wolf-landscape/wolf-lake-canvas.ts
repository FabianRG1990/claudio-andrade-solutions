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
 * WolfLakeCanvas — capa interactiva sobre el lago del Hero MK6.
 *
 * Arquitectura:
 *   • La imagen MK3 vive como `<img>` en el DOM y NO se toca — se queda
 *     intacta como capa visual base.
 *   • Encima de la imagen, un único `<canvas>` 2D pintado fullscreen del
 *     hero. La imagen del lago no se mueve ni se distorsiona; el canvas
 *     solo dibuja los peces y respeta la máscara del lago para que ningún
 *     pez asome contra la roca, el lobo o la orilla.
 *
 * Loop infinito real: la simulación corre continuamente, los peces
 * recirculan en órbitas + senoide lateral + FABRIK chain. No hay un
 * "frame final" — el bucle es la simulación misma. Sin cortes posibles.
 *
 * Componentes:
 *   1) Peces ambientales (5) — patrullan en órbita lemniscata pequeña
 *      alrededor de un spawn point. Cada uno con bodyScale derivado de
 *      la profundidad (Y normalizada en el lago).
 *   2) Pez cursor (1) — sigue el cursor con lerp suave; size se interpola
 *      hacia el size objetivo según la profundidad del cursor en el lago,
 *      con tau = 1.6s (ni bala ni lento, "natural"). Solo dentro del lago.
 *   3) Hover glow — cuando el cursor está dentro del radio R de un pez
 *      ambiental, su intensidad de glow se boostea con falloff radial.
 *
 * Fallbacks:
 *   • prefers-reduced-motion: muestra solo la imagen, no monta canvas.
 *   • Sin canvas 2D context: muestra solo la imagen.
 *
 * Performance: RAF gateado por IntersectionObserver (sale de viewport →
 * pausa) y `document.visibilitychange` (tab oculta → pausa). DPR clamp
 * a 1.5 para no volar GPU memory en pantallas Retina extremas.
 */

type Vec = { x: number; y: number };

// =============================================================================
// LakeFish — pez articulado top-down con FABRIK chain + onda lateral.
// =============================================================================

interface FishColor {
  /** Línea bioluminiscente del centro (espina). */
  spine: string;
  /** Cuerpo translúcido, lectura de "carne" oscura. */
  body: string;
  /** Halo exterior, glow del pez bajo el agua. */
  glow: string;
}

class LakeFish {
  spine: Vec[];
  segments: number;
  segLen: number;
  /** Escala visual base. Modulada por depth en el render. */
  bodyScale: number;
  speedScale: number;
  phase = Math.random() * Math.PI * 2;
  velocity: Vec = { x: 0, y: 0 };
  prevHead: Vec;
  /** Boost de glow [0..1], suavizado hacia un target externo cada frame. */
  glowBoost = 0;
  glowBoostTarget = 0;
  color: FishColor;

  /** Patrullaje base — órbita pequeña en imagen-UV. */
  orbit: { cx: number; cy: number; rx: number; ry: number; phase: number; speed: number };
  /** Target en canvas-px (el head se acerca smooth). */
  target: Vec;

  constructor(start: Vec, opts: {
    segments: number;
    segLen: number;
    bodyScale: number;
    speedScale: number;
    color: FishColor;
    orbit: LakeFish['orbit'];
  }) {
    this.segments = opts.segments;
    this.segLen = opts.segLen;
    this.bodyScale = opts.bodyScale;
    this.speedScale = opts.speedScale;
    this.color = opts.color;
    this.orbit = opts.orbit;
    this.spine = Array.from({ length: opts.segments }, (_, i) => ({
      x: start.x - i * opts.segLen,
      y: start.y,
    }));
    this.prevHead = { x: start.x, y: start.y };
    this.target = { x: start.x, y: start.y };
  }

  /**
   * Suaviza el target gradualmente — `target += (raw - target) * k`. Sin
   * esto, cuando el cursor se mueve rápido, el pez se teleporta. Con k bajo
   * (0.04 en patrullaje, 0.18 cuando sigue al cursor) se siente fluido.
   */
  setTargetSmooth(raw: Vec, smoothing: number): void {
    this.target.x += (raw.x - this.target.x) * smoothing;
    this.target.y += (raw.y - this.target.y) * smoothing;
  }

  /**
   * Step: la cabeza se mueve hacia target, los segmentos siguen vía FABRIK
   * chain (se preserva segLen entre cada par). Después se aplica una onda
   * lateral senoidal por segmento que crece hacia la cola — eso da la
   * curvatura orgánica natural de un pez nadando.
   *
   * `depthFactor` (0..1.5+) escala la velocidad de movimiento. Físicas de
   * perspectiva: un pez al fondo (depthFactor pequeño) debe nadar lento
   * en píxeles para que VISUALMENTE se mueva al mismo ritmo (relativo a
   * su tamaño) que un pez al frente. Sin esto, los peces chicos parecen
   * dardos porque se mueven 9px/frame sobre cuerpos de 7px.
   */
  update(dt: number, isFollowing: boolean, depthFactor = 1): void {
    this.prevHead.x = this.spine[0].x;
    this.prevHead.y = this.spine[0].y;

    const head = this.spine[0];
    const dx = this.target.x - head.x;
    const dy = this.target.y - head.y;
    const dist = Math.hypot(dx, dy);
    // pull también escala con depthFactor para mantener el ratio
    // movimiento-por-frame / tamaño-aparente constante. El pez cursor
    // (isFollowing=true) usa pull/maxStep notablemente más altos que los
    // ambientales — el fondo del hero ya no es el abismo oscuro, es el
    // lago iluminado donde un pez perezoso se siente "muerto" en lugar
    // de tranquilo. Los ambientales mantienen su cadencia de patrullaje.
    const pull = (isFollowing ? 0.20 : 0.08) * depthFactor;
    const maxStep = (isFollowing ? 14 : 5) * this.speedScale * dt * 60 * depthFactor;
    const step = Math.min(dist * pull, maxStep);
    if (dist > 0.5) {
      head.x += (dx / dist) * step;
      head.y += (dy / dist) * step;
    }

    this.velocity.x = head.x - this.prevHead.x;
    this.velocity.y = head.y - this.prevHead.y;
    const speed = Math.hypot(this.velocity.x, this.velocity.y);

    // FABRIK chain: cada segmento se reposiciona a segLen del anterior, en
    // la dirección del actual. Iteración hacia atrás desde la cabeza.
    for (let i = 1; i < this.spine.length; i++) {
      const a = this.spine[i - 1];
      const b = this.spine[i];
      const ddx = b.x - a.x;
      const ddy = b.y - a.y;
      const d = Math.hypot(ddx, ddy) || 1;
      b.x = a.x + (ddx / d) * this.segLen;
      b.y = a.y + (ddy / d) * this.segLen;
    }

    // Onda lateral — amplitud restaurada al valor original, PERO
    // confinada al tramo final del espinazo (la cola). El usuario rechazó
    // el balanceo del cuerpo entero, pero pidió devolver el movimiento
    // de la cola. Solución: cambiar la curva de amplitud-por-segmento
    // de `t²` (rampa suave desde la cabeza) a `t^6` (concentrada en los
    // últimos 2-3 segmentos). Resultado por segmento (11 segs):
    //   i=5 (mitad):       t=0.5 → t^6 = 0.016  (rígido)
    //   i=8 (inicio cola): t=0.8 → t^6 = 0.262  (mild)
    //   i=10 (cola tip):   t=1.0 → t^6 = 1.000  (full)
    // El cuerpo queda recto al gliding; solo la cola ondula con la
    // amplitud original (idle 0.3, hasta ~5.3 con velocidad alta).
    this.phase += dt * (3.5 + speed * 0.6);
    const baseAmp = Math.min(speed * 0.45, 5) + 0.3;
    for (let i = 2; i < this.spine.length; i++) {
      const t = i / (this.spine.length - 1);
      const tailMask = Math.pow(t, 6);
      const wave = Math.sin(this.phase - t * 4.2) * baseAmp * tailMask;
      const a = this.spine[i - 1];
      const b = this.spine[i];
      const tx = b.x - a.x;
      const ty = b.y - a.y;
      const len = Math.hypot(tx, ty) || 1;
      const nx = -ty / len;
      const ny = tx / len;
      b.x += nx * wave;
      b.y += ny * wave;
      // Re-clamp a segLen tras la deformación.
      const ddx = b.x - a.x;
      const ddy = b.y - a.y;
      const d = Math.hypot(ddx, ddy) || 1;
      b.x = a.x + (ddx / d) * this.segLen;
      b.y = a.y + (ddy / d) * this.segLen;
    }

    // Suavizado del glow boost — converge al target en ~250ms.
    this.glowBoost += (this.glowBoostTarget - this.glowBoost) * Math.min(1, dt * 4);
  }

  /**
   * Render — calcado del pez de referencia: glow azul saturado (radial),
   * silueta translúcida del cuerpo, espina segmentada con vértebras
   * brillantes, aletas dorsales/pectorales/anales, ojo luminoso y cola
   * triangular que ondea.
   *
   * Compositing: 'lighter' (additive) — se suma a las zonas oscuras del
   * lago y produce el look bioluminiscente sin blur ni post-process.
   *
   * Escalado uniforme: el `depthScale` se aplica vía ctx.scale() alrededor
   * del centroide del pez. Así el pez ENTERO se achica uniformemente
   * (largo + ancho + aletas + cola + glow) cuando se va al fondo del
   * lago — no solo se adelgaza. Sin esto el pez parecía un gusano que
   * se estira al fondo en lugar de un pez que se aleja.
   */
  render(ctx: CanvasRenderingContext2D, depthScale: number): void {
    const scale = this.bodyScale; // SIN multiplicar por depthScale aquí
    const head = this.spine[0];
    const tail = this.spine[this.spine.length - 1];
    const second = this.spine[1];
    const beforeTail = this.spine[this.spine.length - 2];

    const headDir = norm({ x: head.x - second.x, y: head.y - second.y });
    const tailDir = norm({ x: tail.x - beforeTail.x, y: tail.y - beforeTail.y });

    const speed = Math.hypot(this.velocity.x, this.velocity.y);
    // Wag de cola en valores originales — el usuario probó las versiones
    // atenuadas y prefirió el aleteo de antes. Ahora que el cuerpo ya no
    // se mece (la onda lateral del cuerpo quedó casi en cero arriba), la
    // cola sí debe estar viva con su amplitud completa: idle 1.4, hasta
    // 4.9 con velocidad alta. Solo el cuerpo está rígido; la cola es
    // la que da la sensación de "pez nadando".
    const tailWag = Math.sin(this.phase - 4.0) * (1.4 + Math.min(speed * 0.4, 3.5));

    // Centroide para el transform uniforme — punto medio entre cabeza y
    // cola (centro aproximado del cuerpo).
    const centroidX = (head.x + tail.x) * 0.5;
    const centroidY = (head.y + tail.y) * 0.5;

    ctx.save();
    // Aplicar el depthScale como transform uniforme alrededor del
    // centroide. Todo lo que dibujemos a partir de acá queda escalado
    // proporcionalmente — largo, ancho, aletas, cola, halo, todo junto.
    ctx.translate(centroidX, centroidY);
    ctx.scale(depthScale, depthScale);
    ctx.translate(-centroidX, -centroidY);
    ctx.globalCompositeOperation = 'lighter';

    // ─── Halo amplio exterior — gradient cyan→azul→transparent.
    // Sigue al cuerpo entero, ovalado en la dirección de la espina.
    const cx = (head.x + tail.x) * 0.5;
    const cy = (head.y + tail.y) * 0.5;
    const bodyAngle = Math.atan2(tail.y - head.y, tail.x - head.x);
    const haloR = scale * (4.4 + this.glowBoost * 1.4);
    const haloAlpha = 0.32 + this.glowBoost * 0.35;
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, haloR);
    halo.addColorStop(0, hexA(this.color.glow, haloAlpha));
    halo.addColorStop(0.30, hexA(this.color.glow, haloAlpha * 0.65));
    halo.addColorStop(0.65, hexA(this.color.glow, haloAlpha * 0.20));
    halo.addColorStop(1, hexA(this.color.glow, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.ellipse(cx, cy, haloR, haloR * 0.62, bodyAngle, 0, Math.PI * 2);
    ctx.fill();

    // ─── Aletas: dorsal (arriba, mid), pectoral (abajo, frontal), anal
    // (abajo, posterior). Cada aleta vive perpendicular a la espina en
    // un punto t determinado. "Arriba" y "abajo" se calculan a partir
    // de la dirección del segmento ahí. Las aletas son translúcidas
    // con gradient lineal del cuerpo hacia el borde.
    //
    // Helper: dibuja una aleta triangular con base a lo largo de la
    // espina, tip apuntando perpendicular ± distancia. `side` = +1 (up)
    // o −1 (down) en convención perpendicular.
    const drawFin = (
      tStart: number, tEnd: number, side: number,
      reach: number, sweepBack: number, alphaScale: number,
    ): void => {
      const aIdx = Math.max(0, Math.min(this.spine.length - 1, Math.floor(tStart * (this.spine.length - 1))));
      const bIdx = Math.max(0, Math.min(this.spine.length - 1, Math.floor(tEnd * (this.spine.length - 1))));
      const a = this.spine[aIdx];
      const b = this.spine[bIdx];
      // Perp del segmento medio entre a y b
      const segDx = b.x - a.x;
      const segDy = b.y - a.y;
      const segLen = Math.hypot(segDx, segDy) || 1;
      const segDir = { x: segDx / segLen, y: segDy / segLen };
      const perp = { x: -segDy / segLen * side, y: segDx / segLen * side };
      // Punta de la aleta: a + reach * perp + sweepBack * segDir (las
      // aletas se inclinan hacia atrás del pez como en peces reales).
      const baseMid = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
      const tip = {
        x: baseMid.x + perp.x * reach + segDir.x * sweepBack,
        y: baseMid.y + perp.y * reach + segDir.y * sweepBack,
      };
      const finGrad = ctx.createLinearGradient(baseMid.x, baseMid.y, tip.x, tip.y);
      finGrad.addColorStop(0, hexA(this.color.spine, (0.55 + this.glowBoost * 0.15) * alphaScale));
      finGrad.addColorStop(0.6, hexA(this.color.glow, 0.30 * alphaScale));
      finGrad.addColorStop(1, hexA(this.color.glow, 0));
      ctx.fillStyle = finGrad;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(
        a.x + perp.x * reach * 0.4,
        a.y + perp.y * reach * 0.4,
        tip.x, tip.y,
      );
      ctx.quadraticCurveTo(
        b.x + perp.x * reach * 0.2 + segDir.x * sweepBack * 0.3,
        b.y + perp.y * reach * 0.2 + segDir.y * sweepBack * 0.3,
        b.x, b.y,
      );
      ctx.closePath();
      ctx.fill();
    };

    // Dorsal — arriba del cuerpo, mid-back
    drawFin(0.28, 0.45, +1, scale * 1.45, scale * 0.6, 1.0);
    // Pectoral — abajo, justo detrás de la cabeza
    drawFin(0.10, 0.22, -1, scale * 1.1, scale * 0.4, 0.9);
    // Anal — abajo, mid-tail
    drawFin(0.55, 0.70, -1, scale * 1.0, scale * 0.45, 0.85);

    // ─── Cuerpo translúcido — silueta oval oscura ("carne" del pez) que
    // sigue la espina. Ancho varía con t² para nariz fina + cuerpo medio
    // ancho + cola que se cierra. El cuerpo es darker que el glow para
    // que los puntos vertebrales destaquen contra él.
    const left: Vec[] = [];
    const right: Vec[] = [];
    for (let i = 0; i < this.spine.length; i++) {
      const t = i / (this.spine.length - 1);
      const w = scale * Math.sin(Math.PI * Math.pow(t, 0.55)) * (1 - 0.32 * t) * 0.85;
      const cur = this.spine[i];
      const ahead = i < this.spine.length - 1 ? this.spine[i + 1] : cur;
      const behind = i > 0 ? this.spine[i - 1] : cur;
      const tx = ahead.x - behind.x;
      const ty = ahead.y - behind.y;
      const len = Math.hypot(tx, ty) || 1;
      const ux = -ty / len;
      const uy = tx / len;
      left.push({ x: cur.x + ux * w, y: cur.y + uy * w });
      right.push({ x: cur.x - ux * w, y: cur.y - uy * w });
    }
    const noseTip = {
      x: head.x + headDir.x * scale * 0.45,
      y: head.y + headDir.y * scale * 0.45,
    };
    ctx.fillStyle = hexA(this.color.body, 0.55 + this.glowBoost * 0.10);
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

    // ─── Vértebras — puntos brillantes individuales sobre la espina.
    // En la imagen de referencia, la espina no es un trazo continuo;
    // son destellos discretos por cada articulación, con tamaño que
    // crece hacia el centro del cuerpo. Cada uno renderiza con un
    // pequeño halo radial para que se sienta "vivo, no LED".
    const spineAlpha = 0.92 + this.glowBoost * 0.08;
    for (let i = 0; i < this.spine.length; i++) {
      const t = i / (this.spine.length - 1);
      // Diámetro: pico en t=0.4 (justo después de la cabeza), decae a la cola.
      const r = Math.max(0.6, scale * (0.42 - Math.abs(t - 0.4) * 0.45));
      if (r < 0.5) continue;
      const p = this.spine[i];
      const dot = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.2);
      dot.addColorStop(0, hexA(this.color.spine, spineAlpha));
      dot.addColorStop(0.45, hexA(this.color.spine, spineAlpha * 0.5));
      dot.addColorStop(1, hexA(this.color.spine, 0));
      ctx.fillStyle = dot;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // ─── Punto cabeza/nariz — destello más brillante que las vértebras,
    // imita el "ojo luminoso" del pez de referencia.
    const noseR = Math.max(0.9, scale * 0.32);
    const noseGrad = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, noseR * 2.6);
    noseGrad.addColorStop(0, hexA('#ffffff', 0.85 + this.glowBoost * 0.15));
    noseGrad.addColorStop(0.40, hexA(this.color.spine, 0.72));
    noseGrad.addColorStop(1, hexA(this.color.spine, 0));
    ctx.fillStyle = noseGrad;
    ctx.beginPath();
    ctx.arc(head.x, head.y, noseR * 2.6, 0, Math.PI * 2);
    ctx.fill();

    // ─── Cola — abanico triangular con curva, glow brillante interior
    // que se desvanece al borde. Wag modulado por velocidad.
    const tailLen = scale * 1.7;
    const tailWidth = scale * 0.95;
    const tailPerp = { x: -tailDir.y, y: tailDir.x };
    const tailEnd = {
      x: tail.x + tailDir.x * tailLen + tailPerp.x * tailWag,
      y: tail.y + tailDir.y * tailLen + tailPerp.y * tailWag,
    };
    const tailUp = {
      x: tail.x + tailDir.x * tailLen * 0.50 + tailPerp.x * (tailWidth + tailWag * 0.4),
      y: tail.y + tailDir.y * tailLen * 0.50 + tailPerp.y * (tailWidth + tailWag * 0.4),
    };
    const tailDown = {
      x: tail.x + tailDir.x * tailLen * 0.50 - tailPerp.x * (tailWidth - tailWag * 0.4),
      y: tail.y + tailDir.y * tailLen * 0.50 - tailPerp.y * (tailWidth - tailWag * 0.4),
    };
    const tailGrad = ctx.createLinearGradient(tail.x, tail.y, tailEnd.x, tailEnd.y);
    tailGrad.addColorStop(0, hexA(this.color.spine, 0.78 + this.glowBoost * 0.15));
    tailGrad.addColorStop(0.55, hexA(this.color.spine, 0.40));
    tailGrad.addColorStop(1, hexA(this.color.spine, 0.05));
    ctx.fillStyle = tailGrad;
    ctx.beginPath();
    ctx.moveTo(tail.x, tail.y);
    ctx.quadraticCurveTo(
      (tail.x + tailUp.x) / 2 + tailDir.x * 2,
      (tail.y + tailUp.y) / 2 + tailDir.y * 2,
      tailUp.x, tailUp.y,
    );
    ctx.quadraticCurveTo(
      (tailUp.x + tailEnd.x) / 2 - tailDir.x * 2.5,
      (tailUp.y + tailEnd.y) / 2 - tailDir.y * 2.5,
      tailEnd.x, tailEnd.y,
    );
    ctx.quadraticCurveTo(
      (tailEnd.x + tailDown.x) / 2 - tailDir.x * 2.5,
      (tailEnd.y + tailDown.y) / 2 - tailDir.y * 2.5,
      tailDown.x, tailDown.y,
    );
    ctx.quadraticCurveTo(
      (tail.x + tailDown.x) / 2 + tailDir.x * 2,
      (tail.y + tailDown.y) / 2 + tailDir.y * 2,
      tail.x, tail.y,
    );
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }
}

// =============================================================================
// Helpers
// =============================================================================

const norm = (v: Vec): Vec => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
};

/** Convierte `#rrggbb` + alpha [0..1] a string `rgba(...)`. */
const hexA = (hex: string, a: number): string => {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
};

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });

/** Decodifica el PNG de máscara a un buffer denso de 1 byte/px (canal R). */
const imageToMask = (img: HTMLImageElement): { data: Uint8ClampedArray; width: number; height: number } => {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d ctx for mask');
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, c.width, c.height);
  const out = new Uint8ClampedArray(c.width * c.height);
  for (let i = 0; i < out.length; i++) out[i] = id.data[i * 4];
  return { data: out, width: c.width, height: c.height };
};

/** Cover transform: image-UV (0..1) → canvas-UV (0..1) con object-fit:cover + position:center. */
const imgUVToCanvasUV = (
  uv: Vec, canvasW: number, canvasH: number, imgW: number, imgH: number,
): Vec => {
  const coverScale = Math.max(canvasW / imgW, canvasH / imgH);
  const dispW = imgW * coverScale;
  const dispH = imgH * coverScale;
  // object-position: center → la imagen se centra en X e Y.
  const offsetX = (canvasW - dispW) * 0.5;
  const offsetY = (canvasH - dispH) * 0.5;
  return {
    x: (offsetX + uv.x * dispW) / canvasW,
    y: (offsetY + uv.y * dispH) / canvasH,
  };
};

/** Inversa: canvas-UV → image-UV. */
const canvasUVToImgUV = (
  uv: Vec, canvasW: number, canvasH: number, imgW: number, imgH: number,
): Vec => {
  const coverScale = Math.max(canvasW / imgW, canvasH / imgH);
  const dispW = imgW * coverScale;
  const dispH = imgH * coverScale;
  const offsetX = (canvasW - dispW) * 0.5;
  const offsetY = (canvasH - dispH) * 0.5;
  return {
    x: (uv.x * canvasW - offsetX) / dispW,
    y: (uv.y * canvasH - offsetY) / dispH,
  };
};

/**
 * Empuja TODA la espina del pez hacia el ancla si algún segmento sale
 * del lago seguro (mask < 0.85). Fuerza proporcional a qué tan adentro
 * de la zona prohibida está cada segmento. Threshold 0.85 garantiza
 * que ni el feather de la orilla deja escapar al pez.
 */
const clampSpineToLake = (
  fish: LakeFish,
  mask: { data: Uint8ClampedArray; width: number; height: number },
  cw: number, ch: number, imgW: number, imgH: number,
  anchor: Vec, // canvas-UV (0..1) del ancla seguro
): void => {
  const ax = anchor.x * cw;
  const ay = anchor.y * ch;
  for (const p of fish.spine) {
    const iuv = canvasUVToImgUV({ x: p.x / cw, y: p.y / ch }, cw, ch, imgW, imgH);
    const m = sampleMask(mask, iuv.x, iuv.y);
    if (m < 0.85) {
      // Empuje proporcional: 4 px en el borde (m=0.85) → 14 px en zona
      // totalmente prohibida (m=0). Garantiza que aún en el caso más
      // extremo el pez vuelve al lago en pocos frames.
      const push = 4 + (1 - m / 0.85) * 10;
      const dx = ax - p.x;
      const dy = ay - p.y;
      const d = Math.hypot(dx, dy) || 1;
      p.x += (dx / d) * push;
      p.y += (dy / d) * push;
    }
  }
};

// Sample mask con bilinear interpolation. Si está fuera del rango → 0.
const sampleMask = (
  mask: { data: Uint8ClampedArray; width: number; height: number },
  u: number, v: number,
): number => {
  const x = u * mask.width;
  const y = v * mask.height;
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return 0;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const x1 = Math.min(mask.width - 1, x0 + 1);
  const y1 = Math.min(mask.height - 1, y0 + 1);
  const a = mask.data[y0 * mask.width + x0];
  const b = mask.data[y0 * mask.width + x1];
  const c = mask.data[y1 * mask.width + x0];
  const d = mask.data[y1 * mask.width + x1];
  return ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy) / 255;
};

// =============================================================================
// Componente
// =============================================================================

@Component({
  selector: 'app-wolf-lake-canvas',
  template: '<canvas #canvas class="wolf-lake-canvas" aria-hidden="true"></canvas>',
  styles: [`
    :host { position: absolute; inset: 0; pointer-events: none; z-index: 2; }
    .wolf-lake-canvas { display: block; width: 100%; height: 100%; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WolfLakeCanvas {
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly hostRef = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // Patrón de cleanup tolerante al ciclo de vida — en HMR (y en algunos
    // edge cases de SSR), el componente puede destruirse ANTES de que
    // `start()` resuelva. Si registramos `destroyRef.onDestroy(cleanup)`
    // después de la destrucción, Angular tira NG0911. Solución: registrar
    // el handler de destroy ANTES, capturar el cleanup en una variable, y
    // si el handler ya corrió cuando llegamos a setearla, ejecutamos el
    // cleanup directamente.
    let cleanup: (() => void) | undefined;
    let isDestroyed = false;
    this.destroyRef.onDestroy(() => {
      isDestroyed = true;
      cleanup?.();
    });
    afterNextRender(async () => {
      const c = await this.start();
      if (isDestroyed) {
        c?.();
      } else {
        cleanup = c ?? undefined;
      }
    });
  }

  private async start(): Promise<(() => void) | void> {
    // ─── prefers-reduced-motion: salir, no montamos nada
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const canvas = this.canvasRef().nativeElement;
    const host = this.hostRef.nativeElement;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    // ─── Cargar máscara del lago
    let maskImg: HTMLImageElement;
    try {
      maskImg = await loadImage('/hero-wolf/lake-mask-mk3.png');
    } catch {
      return;
    }
    const mask = imageToMask(maskImg);
    // Dimensiones nativas de la imagen del hero (MK6 = mismas que MK3:
    // 1672×941). Si en el futuro se cambia el src del `<img class="hero__bg">`
    // por una imagen de OTRO tamaño, hay que actualizar estos y regenerar
    // los polígonos en generate-masks.mjs.
    const IMG_W = 1672;
    const IMG_H = 941;

    // ─── Resize handler — mantiene canvas sincronizado al host
    let cw = 0, ch = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const resize = (): void => {
      const rect = host.getBoundingClientRect();
      cw = Math.max(1, rect.width);
      ch = Math.max(1, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.floor(cw * dpr);
      canvas.height = Math.floor(ch * dpr);
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    // ─── Pointer tracking — clientX/Y a canvas-px
    const pointer = { active: false, x: 0, y: 0 };
    const onMove = (e: PointerEvent): void => {
      const rect = host.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      if (px < 0 || py < 0 || px > rect.width || py > rect.height) {
        pointer.active = false;
        return;
      }
      pointer.x = px;
      pointer.y = py;
      pointer.active = true;
    };
    const onLeave = (): void => { pointer.active = false; };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerleave', onLeave, { passive: true });

    // ─── Paleta — azul ELÉCTRICO PURO como en la referencia.
    // Sin cyan/teal/verdoso. Hex todos con G < B y G ≤ R/2 para forzar
    // tono claramente azul. Glow es el color dominante visible al sumar.
    //   spine = vértebras (azul muy claro, casi blanco-azul)
    //   body  = silueta (azul electric medio)
    //   glow  = halo exterior (azul saturado eléctrico)
    const PALETTE: FishColor[] = [
      { spine: '#a0b8ff', body: '#1850e0', glow: '#1565ff' },
      { spine: '#aac0ff', body: '#1958e8', glow: '#1f6cff' },
      { spine: '#9cb4ff', body: '#1448d8', glow: '#0f5ef5' },
      { spine: '#b4c8ff', body: '#1e60ec', glow: '#2474ff' },
      { spine: '#a4bcff', body: '#1654e4', glow: '#1768ff' },
    ];

    // Spawn UV — 6 peces dispersos por el lago seguro. Image-UV (0..1).
    // Todos verificados contra el polígono v5: cabeza del pez SIEMPRE
    // dentro del lago al spawn. El polígono se cierra a x=1510 (≈0.90 en
    // x), así que mantenemos los spawns bajo x=0.85 para tener margen
    // contra el clamp del lado derecho.
    const SPAWN_UV: Vec[] = [
      { x: 0.12, y: 0.72 }, // fondo izq
      { x: 0.28, y: 0.84 }, // medio izq
      { x: 0.45, y: 0.70 }, // fondo medio (lejos)
      { x: 0.40, y: 0.92 }, // cerca medio
      { x: 0.62, y: 0.93 }, // cerca derecha-medio
      { x: 0.18, y: 0.96 }, // cerca izq
    ];

    // ─── depthScale: pez Y normalizado al rango del lago → escala visual.
    // Rango ATENUADO (antes era 0.18×→1.25×, ratio 7×). El usuario pidió
    // que el shrink hacia la ciudad se note pero sin volverse "punto":
    // el fondo del hero ya cambió y un achique tan dramático perdió
    // sentido. Nuevo rango:
    //   y_v 0.540 (orilla lejana, cerca de la ciudad) → 0.50× (visible
    //                                                    como pez chico,
    //                                                    no como punto)
    //   y_v 1.000 (frente del lago, justo abajo)      → 1.15× (sigue
    //                                                    siendo más
    //                                                    grande, ratio
    //                                                    visible 2.3×)
    const LAKE_TOP_V = 0.540;
    const LAKE_BOTTOM_V = 1.00;
    const depthScaleAt = (yV: number): number => {
      const t = Math.max(0, Math.min(1, (yV - LAKE_TOP_V) / (LAKE_BOTTOM_V - LAKE_TOP_V)));
      // Curva t² mantiene la sensación de perspectiva (cambio gradual
      // hacia el fondo, acelera hacia el frente), pero el rango total
      // es mucho más suave que antes.
      const curved = t * t;
      return 0.50 + curved * 0.65;
    };

    // ─── Build ambient fishes — escala pequeña, proporcionada al
    // tamaño visible del lago en el hero.
    const fishes: LakeFish[] = [];
    const buildFishes = (): void => {
      fishes.length = 0;
      for (let i = 0; i < SPAWN_UV.length; i++) {
        const uv = SPAWN_UV[i];
        const cuv = imgUVToCanvasUV(uv, cw, ch, IMG_W, IMG_H);
        const start = { x: cuv.x * cw, y: cuv.y * ch };
        // baseScale: cw=1440 → 4.5. Mobile cw=375 → 2.5. Mantiene peces
        // entre ~30-65px de largo total — claramente visibles, no
        // protagonistas. El lago ocupa ~45% del alto del hero, así que
        // peces más grandes los harían parecer "fuera de escala".
        const baseScale = Math.max(2.5, Math.min(5.0, cw / 320));
        fishes.push(new LakeFish(start, {
          segments: 11,
          segLen: baseScale * 0.95,
          bodyScale: baseScale,
          speedScale: 0.55 + Math.random() * 0.35,
          color: PALETTE[i % PALETTE.length],
          orbit: {
            cx: uv.x,
            cy: uv.y,
            rx: 0.045 + Math.random() * 0.04,
            ry: 0.018 + Math.random() * 0.015,
            phase: Math.random() * Math.PI * 2,
            speed: 0.16 + Math.random() * 0.12,
          },
        }));
      }
    };
    buildFishes();

    // ─── Cursor fish — color azul eléctrico aún más puro (G mínima):
    //   spine '#b8c8ff' (G=200, B=255) — muy claro, casi lavender
    //   body  '#1648dc' (G=72,  B=220) — azul profundo
    //   glow  '#0d4dff' (G=77,  B=255) — saturado eléctrico
    const cursorBase = Math.max(2.8, Math.min(5.4, cw / 290));
    const cursorFish = new LakeFish(
      { x: cw * 0.55, y: ch * 0.85 },
      {
        segments: 12,
        segLen: cursorBase * 0.95,
        bodyScale: cursorBase * 1.08,
        // speedScale 0.85 (antes 0.45) — el fondo cambió, el pez del
        // cursor ahora puede moverse con energía sin que se sienta fuera
        // de tono con la escena.
        speedScale: 0.85,
        color: { spine: '#b8c8ff', body: '#1648dc', glow: '#0d4dff' },
        // Orbit no-cero — cuando el cursor sale del agua (o no hay
        // cursor), el pez se devuelve a este patrullaje en vez de
        // quedarse esperando en la orilla. cx/cy = frente-centro del
        // lago (donde naturalmente vive el pez); rx/ry un poco más
        // amplios que los ambientales porque éste es el "pez principal".
        orbit: {
          cx: 0.40,
          cy: 0.88,
          rx: 0.10,
          ry: 0.025,
          phase: Math.random() * Math.PI * 2,
          speed: 0.18,
        },
      },
    );
    // No usamos un cursorDepth lerpeado por separado — el depthScale del
    // pez del cursor se calcula cada frame directamente de la Y de su
    // cabeza (igual que los ambientales). Esto garantiza que size y
    // position están SIEMPRE en sync: si la cabeza se mueve hacia el
    // fondo, el pez se hace chico en el mismo movimiento, no después.

    const ro = new ResizeObserver(() => {
      resize();
      buildFishes();
    });
    ro.observe(host);

    // ─── Visibility/IntersectionObserver para gatear RAF
    let isOnScreen = true;
    let isTabVisible = !document.hidden;
    const isActive = (): boolean => isOnScreen && isTabVisible;

    let raf = 0;
    let lastT = performance.now();
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
    io.observe(host);

    const onVis = (): void => {
      isTabVisible = !document.hidden;
      if (isActive()) start(); else stop();
    };
    document.addEventListener('visibilitychange', onVis);

    // ─── Tick principal
    const tick = (now: number): void => {
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;

      // Cursor target — el pez sigue al cursor SOLO si está sobre el
      // agua. Fuera del agua (sobre cielo, montañas, lobo, roca) el pez
      // NO espera en la orilla: vuelve a su patrullaje normal como
      // cualquier pez ambiental. Comportamiento explícito pedido por el
      // usuario: "que no me espere ni se quede en la animación de que
      // me esté siguiendo".
      let cursorOnWater = false;
      if (pointer.active) {
        const iuv = canvasUVToImgUV({ x: pointer.x / cw, y: pointer.y / ch }, cw, ch, IMG_W, IMG_H);
        if (sampleMask(mask, iuv.x, iuv.y) > 0.35) {
          cursorOnWater = true;
        }
      }

      if (cursorOnWater) {
        // Modo follow — target = posición del cursor, smoothing 0.10 para
        // respuesta viva. isFollowing=true en update() activa los
        // pull/maxStep altos (0.20/14) del pez del cursor.
        cursorFish.setTargetSmooth({ x: pointer.x, y: pointer.y }, 0.10);
        cursorFish.glowBoostTarget = 0.85;
      } else {
        // Modo patrullaje — exactamente como un pez ambiental: target =
        // punto en órbita, smoothing 0.04 (drift suave). isFollowing=false
        // baja a la cadencia ambiental. La transición es smooth porque
        // setTargetSmooth lerpea el target gradualmente; el pez no
        // "salta" del cursor a la órbita, sino que pierde interés y
        // deriva de regreso a su zona de patrullaje.
        cursorFish.orbit.phase += dt * cursorFish.orbit.speed;
        let tx = cursorFish.orbit.cx + Math.cos(cursorFish.orbit.phase) * cursorFish.orbit.rx;
        let ty = cursorFish.orbit.cy + Math.sin(cursorFish.orbit.phase * 1.3) * cursorFish.orbit.ry;
        if (sampleMask(mask, tx, ty) < 0.4) {
          tx = cursorFish.orbit.cx;
          ty = cursorFish.orbit.cy;
        }
        const cuv = imgUVToCanvasUV({ x: tx, y: ty }, cw, ch, IMG_W, IMG_H);
        cursorFish.setTargetSmooth({ x: cuv.x * cw, y: cuv.y * ch }, 0.04);
        cursorFish.glowBoostTarget = 0.4;
      }

      // Velocidad escalada por profundidad: pez al fondo nada lento
      // (tanto en pixels como visualmente — perspectiva real).
      const cursorHeadVForUpdate = canvasUVToImgUV(
        { x: cursorFish.spine[0].x / cw, y: cursorFish.spine[0].y / ch },
        cw, ch, IMG_W, IMG_H,
      ).y;
      cursorFish.update(dt, cursorOnWater, depthScaleAt(cursorHeadVForUpdate));

      // Ambient fish — patrullaje en orbit, target con clamp a la máscara.
      for (const f of fishes) {
        f.orbit.phase += dt * f.orbit.speed;
        let tx = f.orbit.cx + Math.cos(f.orbit.phase) * f.orbit.rx;
        let ty = f.orbit.cy + Math.sin(f.orbit.phase * 1.3) * f.orbit.ry;
        if (sampleMask(mask, tx, ty) < 0.4) {
          // Si la órbita se sale del lago, target = centro del orbit.
          tx = f.orbit.cx;
          ty = f.orbit.cy;
        }
        const cuv = imgUVToCanvasUV({ x: tx, y: ty }, cw, ch, IMG_W, IMG_H);
        f.setTargetSmooth({ x: cuv.x * cw, y: cuv.y * ch }, 0.04);

        // Hover glow target — falloff radial desde el cursor (si está
        // activo) y desde el cursor fish. El boost es máximo cuando el
        // cursor o el pez-cursor están encima del head del pez ambiental.
        const head = f.spine[0];
        let boost = 0;
        if (pointer.active) {
          const dPointer = Math.hypot(head.x - pointer.x, head.y - pointer.y);
          const radius = 90 + f.bodyScale * 8;
          boost = Math.max(boost, Math.max(0, 1 - dPointer / radius));
        }
        const dCursorFish = Math.hypot(head.x - cursorFish.spine[0].x, head.y - cursorFish.spine[0].y);
        const cfRadius = 70 + f.bodyScale * 6;
        boost = Math.max(boost, Math.max(0, 1 - dCursorFish / cfRadius));
        f.glowBoostTarget = boost;

        // Velocidad escalada por profundidad — peces ambientales al fondo
        // (depthFactor pequeño) se mueven menos px/frame, así no parecen
        // dardos en la lejanía.
        const ambientHeadV = canvasUVToImgUV(
          { x: head.x / cw, y: head.y / ch }, cw, ch, IMG_W, IMG_H,
        ).y;
        f.update(dt, false, depthScaleAt(ambientHeadV));

        // Clamp duro de TODO el cuerpo (no solo cabeza) — recorremos cada
        // segmento de la espina y, si está fuera del agua segura, lo
        // empujamos hacia el centro de la órbita con fuerza proporcional
        // a qué tan adentro de la zona prohibida está.
        clampSpineToLake(f, mask, cw, ch, IMG_W, IMG_H,
          imgUVToCanvasUV({ x: f.orbit.cx, y: f.orbit.cy }, cw, ch, IMG_W, IMG_H));
      }

      // El pez-cursor también se queda dentro del lago (clamp idéntico).
      // Ancla de seguridad: el centro horizontal del lago al frente.
      // glowBoostTarget ya fue asignado arriba según el modo (follow
      // = 0.85, patrol = 0.4) — no se vuelve a setear acá.
      const safeAnchor = imgUVToCanvasUV({ x: 0.40, y: 0.88 }, cw, ch, IMG_W, IMG_H);
      clampSpineToLake(cursorFish, mask, cw, ch, IMG_W, IMG_H, safeAnchor);

      // ─── Render
      ctx.clearRect(0, 0, cw, ch);
      // Filtro blur leve da sensación de "están sumergidos"; el cuerpo y
      // el glow ya son translúcidos pero el blur termina de soft-fundir
      // el pez con el agua.
      ctx.save();
      ctx.filter = 'blur(0.5px)';
      for (const f of fishes) {
        const headV = canvasUVToImgUV({ x: f.spine[0].x / cw, y: f.spine[0].y / ch }, cw, ch, IMG_W, IMG_H).y;
        f.render(ctx, depthScaleAt(headV));
      }
      // El pez del cursor también deriva su size de la Y de su cabeza
      // (igual lógica que ambientales). Como la cabeza se mueve con
      // smoothing, el size cambia gradualmente y SIEMPRE en sync con
      // la posición — no hay desfase entre "ya llegó" y "ya tiene su
      // tamaño correcto".
      const cursorHeadV = canvasUVToImgUV(
        { x: cursorFish.spine[0].x / cw, y: cursorFish.spine[0].y / ch },
        cw, ch, IMG_W, IMG_H,
      ).y;
      cursorFish.render(ctx, depthScaleAt(cursorHeadV));
      ctx.restore();

      raf = requestAnimationFrame(tick);
    };

    if (isActive()) start();

    return () => {
      stop();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('visibilitychange', onVis);
      io.disconnect();
      ro.disconnect();
    };
  }
}
