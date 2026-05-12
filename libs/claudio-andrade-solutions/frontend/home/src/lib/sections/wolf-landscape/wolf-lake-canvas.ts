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
  /** Esfuerzo del nado [0..1] — señal smoothed con tau ~250ms que sigue
   *  la velocidad real del head. Maneja amplitud Y frecuencia tanto de
   *  la onda del cuerpo como del wag de la cola. Crítico: el smoothing
   *  con decay lento previene el "twisting al frenar" — cuando el head
   *  se detiene, la cola se desinfla gradualmente (~250ms) en lugar de
   *  seguir wagging mecánicamente a full amplitude. Sin esta señal,
   *  parecía que el pez chocaba contra una pared al pausar y se
   *  retorcía. */
  effort = 0;
  color: FishColor;

  /** Patrullaje base — órbita pequeña en imagen-UV. Usado como ancla de
   *  seguridad para `clampSpineToLake`. El wander libre del pez no la usa. */
  orbit: { cx: number; cy: number; rx: number; ry: number; phase: number; speed: number };
  /** Target en canvas-px (el head se acerca smooth). */
  target: Vec;

  // ─── Wander (territorio amplio, no órbita chica) ────────────────────────────
  /** Waypoint actual del pez en imagen-UV. Cuando llega cerca, elige otro. */
  wanderTarget: Vec;
  /** 'cruising' = nadando hacia wanderTarget. 'pausing' = llegó, observa. */
  wanderState: 'cruising' | 'pausing' = 'cruising';
  /** Segundos restantes de pausa antes de elegir nuevo waypoint. */
  pauseTimer = 0;

  // ─── Física real de pez (sólo modo 'ambient') ──────────────────────────────
  /** Dirección actual a la que mira la cabeza (radianes). Solo usada en
   *  modo 'ambient'. Un pez real no pivota instantáneo: rota con turn-rate
   *  finito, lo que produce arcos bancarios. */
  heading = 0;
  /** Micro-target del hover. Solo usado en modo 'ambient' durante pausing. */
  hoverDriftTarget: Vec | null = null;
  /** Segundos hasta que se elija nuevo hoverDriftTarget. Solo 'ambient'. */
  hoverDriftTimer = 0;

  /** Modo de física:
   *  • 'ambient' — los peces del lago: heading + drag + effort smoothed +
   *    wander state machine + hover drift. Física naturalista nueva.
   *  • 'cursor'  — el pez que sigue el cursor: movimiento directo head→target
   *    sin turn-rate limit ni drag, wave/cola driven by speed bruto, patrol
   *    orbit-based. Comportamiento legacy explícitamente preferido por el
   *    usuario para este pez ("ya tiene un montón de lag, ya no sigue el
   *    cursor", quiere "el mismo comportamiento que tenía ayer"). */
  physicsMode: 'cursor' | 'ambient' = 'ambient';

  constructor(start: Vec, opts: {
    segments: number;
    segLen: number;
    bodyScale: number;
    speedScale: number;
    color: FishColor;
    orbit: LakeFish['orbit'];
    physicsMode?: 'cursor' | 'ambient';
  }) {
    this.segments = opts.segments;
    this.segLen = opts.segLen;
    this.bodyScale = opts.bodyScale;
    this.speedScale = opts.speedScale;
    this.color = opts.color;
    this.orbit = opts.orbit;
    this.physicsMode = opts.physicsMode ?? 'ambient';
    this.spine = Array.from({ length: opts.segments }, (_, i) => ({
      x: start.x - i * opts.segLen,
      y: start.y,
    }));
    this.prevHead = { x: start.x, y: start.y };
    this.target = { x: start.x, y: start.y };
    // Primer wanderTarget = spawn (orbit center). En el primer tick el
    // pez ya está ahí, así que entrará en pausing y elegirá uno nuevo.
    this.wanderTarget = { x: opts.orbit.cx, y: opts.orbit.cy };
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

    // ─── Movimiento de la cabeza — branchado por physicsMode ───
    // 'ambient': heading + turn-rate limit + drag al girar (física real
    //            naturalista).
    // 'cursor':  movimiento directo head→target sin lag, como ayer
    //            (el usuario lo prefirió explícitamente: "ya tiene un
    //            montón de lag, ya no sigue el cursor").
    const pull = (isFollowing ? 0.20 : 0.08) * depthFactor;
    const maxStep = (isFollowing ? 14 : 5) * this.speedScale * dt * 60 * depthFactor;
    if (this.physicsMode === 'cursor') {
      const step = Math.min(dist * pull, maxStep);
      if (dist > 0.5) {
        head.x += (dx / dist) * step;
        head.y += (dy / dist) * step;
      }
    } else {
      // Heading con turn-rate limit
      if (dist > 0.5) {
        const targetAngle = Math.atan2(dy, dx);
        let angleDiff = targetAngle - this.heading;
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
        const currSpeed = Math.hypot(this.velocity.x, this.velocity.y);
        const turnRate = Math.min(6.0 / (1 + currSpeed * 0.15), 4.5);
        const turn = Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), turnRate * dt);
        this.heading += turn;
      }
      // Drag al girar + movimiento a lo largo del heading
      let stepMag = Math.min(dist * pull, maxStep);
      if (dist > 0.5) {
        const targetAngle = Math.atan2(dy, dx);
        let alignDiff = targetAngle - this.heading;
        while (alignDiff > Math.PI) alignDiff -= 2 * Math.PI;
        while (alignDiff < -Math.PI) alignDiff += 2 * Math.PI;
        const alignment = Math.cos(alignDiff);
        const dragFactor = 0.35 + 0.65 * Math.max(0, alignment);
        stepMag *= dragFactor;
        head.x += Math.cos(this.heading) * stepMag;
        head.y += Math.sin(this.heading) * stepMag;
      }
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

    // Onda lateral del cuerpo — branchada por physicsMode:
    //   'cursor':  fórmula legacy de ayer — phase rate `3.5 + speed*0.6`,
    //              amplitud `min(speed*0.10, 0.8)`. Comportamiento que el
    //              usuario quiere preservar para el pez del cursor.
    //   'ambient': nuevo signal `effort` smoothed (lerp k=4, tau ~250ms)
    //              que evita el "twisting al frenar" — al detenerse el
    //              head, la cola se desinfla gradualmente en lugar de
    //              seguir oscilando.
    let baseAmp: number;
    if (this.physicsMode === 'cursor') {
      this.phase += dt * (3.5 + speed * 0.6);
      baseAmp = Math.min(speed * 0.10, 0.8);
    } else {
      const targetEffort = Math.min(1, speed / 2.0);
      this.effort += (targetEffort - this.effort) * Math.min(1, dt * 4);
      this.phase += dt * (1.0 + this.effort * 3.0);
      baseAmp = 0.20 + 0.80 * this.effort;
    }
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

    // tailWag — branchado por physicsMode:
    //   'cursor':  fórmula legacy de ayer: `1.4 + min(speed*0.4, 3.5)`,
    //              rango 1.4 (idle) hasta 4.9 (rápido). Cola viva con
    //              amplitud completa — comportamiento que el usuario
    //              quiere preservar explícitamente.
    //   'ambient': escalado por effort smoothed para evitar twisting
    //              al frenar. Quieto: 0.41px. Cruisendo: 2.03px.
    let tailWag: number;
    if (this.physicsMode === 'cursor') {
      const speed = Math.hypot(this.velocity.x, this.velocity.y);
      tailWag = Math.sin(this.phase - 4.0) * (1.4 + Math.min(speed * 0.4, 3.5));
    } else {
      const wagFactor = 0.20 + 0.80 * this.effort;
      tailWag = Math.sin(this.phase - 4.0) * (this.bodyScale * 0.45 * wagFactor);
    }

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
      // Multiplicador subido de 0.85 → 1.0 (~+18% de grosor). Acerca la
      // proporción largo:ancho al pez de referencia (más fusiforme,
      // menos "gusano"). Sin cambios en la curva sin/pow, solo el factor
      // final — la silueta sigue siendo torpedo natural.
      const w = scale * Math.sin(Math.PI * Math.pow(t, 0.55)) * (1 - 0.32 * t) * 1.0;
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

    // ─── Wander territory — el pez deja de patrullar en una órbita chica y
    // empieza a explorar libremente puntos válidos del lago. El usuario
    // pidió "más distancia, no anidados en un solo lugar".
    //
    // Bounding box del lago en imagen-UV: x∈[0.08, 0.83] (poly cierra a
    // 0.85), y∈[0.58, 0.98] (LAKE_TOP_V + feather). pickWaterPoint
    // hace rejection sampling hasta encontrar un (u,v) con mask > 0.65
    // (agua sólida, no feather de orilla). Fallback al centro del lago
    // si después de 40 intentos no encuentra — virtualmente imposible
    // con el área del polígono actual.
    const pickWaterPoint = (): Vec => {
      for (let i = 0; i < 40; i++) {
        const u = 0.08 + Math.random() * 0.75;
        const v = 0.58 + Math.random() * 0.40;
        if (sampleMask(mask, u, v) > 0.65) {
          return { x: u, y: v };
        }
      }
      return { x: 0.45, y: 0.86 };
    };

    // Aplica el estado machine de wander a un pez:
    //   'cruising' = nadando hacia wanderTarget; cuando llega cerca,
    //                transiciona a 'pausing'.
    //   'pausing'  = pez detenido observando alrededor (target = posición
    //                actual). Después de `pauseTimer` segundos elige un
    //                nuevo waypoint y vuelve a 'cruising'.
    //
    // El pauseTimer se randomiza 0.8-3.5s por transición — cada pez
    // tiene su propio ritmo, así nunca pausan todos a la vez.
    const applyWander = (f: LakeFish, dtNow: number): void => {
      if (f.wanderState === 'cruising') {
        const wcuv = imgUVToCanvasUV(f.wanderTarget, cw, ch, IMG_W, IMG_H);
        const wx = wcuv.x * cw;
        const wy = wcuv.y * ch;
        f.setTargetSmooth({ x: wx, y: wy }, 0.04);
        const dToTarget = Math.hypot(f.spine[0].x - wx, f.spine[0].y - wy);
        // Threshold de llegada — proporcional al tamaño del pez + margen.
        if (dToTarget < 22 + f.bodyScale * 4) {
          f.wanderState = 'pausing';
          f.pauseTimer = 0.8 + Math.random() * 2.7;
          f.hoverDriftTarget = null; // forzar elección inmediata
          f.hoverDriftTimer = 0;
        }
      } else {
        // Pausing — micro-drift: target oscila lento entre puntos random
        // a 6-18px del head. Esto rota el heading suavemente y da la
        // ilusión de que el pez "mira a su alrededor" como pez real
        // hovereando con sus pectorales. Cada pez tiene su propio timer
        // de drift, así nunca giran todos a la vez.
        f.hoverDriftTimer -= dtNow;
        if (f.hoverDriftTimer <= 0 || !f.hoverDriftTarget) {
          const angle = Math.random() * Math.PI * 2;
          const radius = 6 + Math.random() * 12;
          f.hoverDriftTarget = {
            x: f.spine[0].x + Math.cos(angle) * radius,
            y: f.spine[0].y + Math.sin(angle) * radius,
          };
          f.hoverDriftTimer = 0.6 + Math.random() * 1.4;
        }
        f.setTargetSmooth(f.hoverDriftTarget, 0.02);
        f.pauseTimer -= dtNow;
        if (f.pauseTimer <= 0) {
          f.wanderTarget = pickWaterPoint();
          f.wanderState = 'cruising';
          f.hoverDriftTarget = null;
        }
      }
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
        // Escala bumped 2.5–5.0 → 2.9–5.7 (~+14%). Peces más grandes
        // como en la imagen de referencia, sin cambiar la física (sólo
        // los píxeles que el render dibuja).
        const baseScale = Math.max(2.9, Math.min(5.7, cw / 280));
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
    // Cursor base bumped 2.8–5.4 → 3.2–6.1 (~+13%). El pez del cursor
    // sigue siendo el "principal" (1.08× sobre cursorBase), un poco más
    // grande que los ambientales como antes.
    const cursorBase = Math.max(3.2, Math.min(6.1, cw / 260));
    const cursorFish = new LakeFish(
      { x: cw * 0.55, y: ch * 0.85 },
      {
        segments: 12,
        segLen: cursorBase * 0.95,
        bodyScale: cursorBase * 1.08,
        // speedScale 0.85 — el pez del cursor se mueve con energía.
        speedScale: 0.85,
        color: { spine: '#b8c8ff', body: '#1648dc', glow: '#0d4dff' },
        // physicsMode='cursor' — el pez del cursor mantiene la física
        // legacy (movimiento directo head→target sin turn-rate limit ni
        // drag, wave/cola driven by speed bruto, patrol orbit-based).
        // Comportamiento explícitamente preferido por el usuario: "ya
        // tiene un montón de lag, ya no sigue el cursor", quiere el
        // comportamiento de ayer.
        physicsMode: 'cursor',
        // Orbit no-cero — cuando el cursor sale del agua (o no hay
        // cursor), el pez patrulla en esta órbita en vez de quedarse
        // esperando en la orilla o usar el wander state machine.
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
        // Modo follow — target = posición del cursor, smoothing 0.10
        // para respuesta viva. isFollowing=true en update() activa los
        // pull/maxStep altos (0.20/14) del pez del cursor.
        cursorFish.setTargetSmooth({ x: pointer.x, y: pointer.y }, 0.10);
        cursorFish.glowBoostTarget = 0.85;
      } else {
        // Modo patrullaje — orbit-based legacy (NO wander state machine).
        // El usuario pidió explícitamente que el pez del cursor conserve
        // el comportamiento de ayer, incluido el patrullaje en la órbita
        // chica del frente del lago en vez del wander libre que aplica
        // a los peces ambientales.
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

      // Ambient fish — wander libre por todo el lago. Cada pez tiene su
      // propio waypoint (state machine cruising/pausing) y su propio
      // reloj de burst-glide (thrust signal en update()). El resultado
      // es que distintos peces nadan en distintos momentos, pausan en
      // distintos puntos, dan coletazos en distintos instantes — ningún
      // movimiento sincronizado, instinto natural.
      for (const f of fishes) {
        applyWander(f, dt);

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
