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
  /** Tiempo (s) chasing el current wanderTarget. Si excede ~7s sin
   *  llegar, applyWander fuerza pick de nuevo target — failsafe contra
   *  fish stuck oscilando alrededor de un target inalcanzable
   *  (e.g., target straight above with kinematic motion overshooting). */
  wanderChaseTime = 0;

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
// GlowFish — pez silueta-luminosa al estilo de la imagen de referencia.
// Cuerpo ovalado outlined con luz azul (no construido por puntos sueltos
// como LakeFish), aletas pequeñas outlined, núcleo brillante longitudinal,
// ojo destacado, halo soft. Movimiento simple (lerp + heading smoothing,
// SIN FABRIK, SIN spine articulado), tipo pez dorado patrullando.
// Compatible con applyWander y clampSpineToLake porque expone los mismos
// fields (spine como array de 1 elemento sincronizado a position).
// =============================================================================

interface GlowFishColor {
  /** Línea brillante del rim (luz que traza la silueta). */
  rim: string;
  /** Color del fill translúcido del cuerpo (azul oscuro). */
  body: string;
  /** Color del núcleo / espina central brillante. */
  core: string;
  /** Color del halo exterior (azul saturado). */
  halo: string;
}

/**
 * Perfil corporal del GlowFish — 13 secciones transversales muestreadas
 * del silhouette Bezier original. Cada entrada es `[xCoeff, topY, bottomY]`
 * en unidades de `s` (size). xCoeff +2.20 = nariz, -1.55 = base de cola.
 * topY es la altura del dorso (negativa = arriba), bottomY es la del
 * vientre (positiva = abajo). El centro de cada sección está en y=0
 * relativo al sistema local del pez.
 *
 * El render bend-friendly construye el silueta uniendo estos puntos
 * (top profile head→tail + bottom profile tail→head) y aplica un
 * desplazamiento vertical waveY(x) común a top y bottom de cada sección,
 * de modo que la sección entera se traslada lateralmente — la espina se
 * curva, las cross-sections siguen rígidas. Esto reproduce el carangiform
 * swimming de los teleósteos: onda viajera con amplitud cuadrática
 * creciente desde la cabeza hasta la cola.
 *
 * Mantener este array sincronizado con cualquier cambio del silhouette
 * para que el rest-pose (effort=0) coincida con el diseño base.
 */
const GLOW_BODY_PROFILE: ReadonlyArray<readonly [number, number, number]> = [
  [ 2.20,  0.00,  0.00], // nariz
  [ 2.00, -0.13,  0.06],
  [ 1.70, -0.29,  0.15],
  [ 1.35, -0.45,  0.24],
  [ 0.95, -0.57,  0.32],
  [ 0.55, -0.64,  0.33],
  [ 0.20, -0.66,  0.33], // joroba peak
  [-0.20, -0.60,  0.31],
  [-0.55, -0.51,  0.28],
  [-0.90, -0.41,  0.25],
  [-1.20, -0.30,  0.21],
  [-1.40, -0.22,  0.18],
  [-1.55, -0.16,  0.16], // tail base
];

/** Wavelength (en unidades de longitud corporal) — carangiform típico. */
const GLOW_WAVES_PER_BODY = 1.2;

/**
 * Máximo bend per joint en la spinal chain (argonaut animal-proc-anim:
 * `Chain.pde`, `angleConstraint = PI/8`). Si dos vértebras consecutivas
 * intentan estar a más de este ángulo, la posterior se clampea al borde
 * — produce curvatura suave, sin kinks. Valor sacado del repo oficial
 * que el usuario referenció (qlfh_rv6khY).
 */
const GLOW_BEND_LIMIT = Math.PI / 8;

/** Normaliza ángulo a (-π, π]. */
const wrapAngleSigned = (a: number): number => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
};

/**
 * Clamp `angle` a ±`limit` rad de `anchor`. Versión port directo de
 * `Util.pde::constrainAngle` de argonaut, usando convención (-π, π]
 * en lugar de [0, 2π) para evitar wrap issues con TypeScript.
 */
const constrainAngleArg = (angle: number, anchor: number, limit: number): number => {
  const diff = wrapAngleSigned(angle - anchor);
  if (Math.abs(diff) <= limit) return wrapAngleSigned(angle);
  return wrapAngleSigned(anchor + Math.sign(diff) * limit);
};

/**
 * Perfil corporal del GlowFish — TOP view (vista de arriba/dorsal).
 * Simétrico left/right (la silueta del pez vista desde arriba es igual
 * de ambos lados). `[xUnit, halfWidth]` — `halfWidth` aplica
 * positivamente y negativamente al render desde la espina (ambos lados).
 *
 * Usado cuando el heading del pez es predominantemente vertical (heading
 * cerca de ±π/2) — el render hace crossfade entre side view y top view
 * según |cos(heading)| vs |sin(heading)|. En vertical sólo top view
 * es visible, lo que disuelve el "brinco" del flip dorsalSide (que
 * ahora ocurre cuando sideAlpha=0, invisible al ojo).
 *
 * Forma: long thin oval (~25% width vs length), nariz y cola
 * estrechas, máximo width en ~10-25% del cuerpo (justo detrás de
 * la cabeza, donde el pez es más ancho lateralmente).
 */
const GLOW_TOP_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [ 2.20, 0.00], // nariz
  [ 2.00, 0.10],
  [ 1.70, 0.20],
  [ 1.35, 0.30],
  [ 0.95, 0.38],
  [ 0.55, 0.42],
  [ 0.20, 0.43], // máximo width
  [-0.20, 0.42],
  [-0.55, 0.38],
  [-0.90, 0.32],
  [-1.20, 0.24],
  [-1.40, 0.16],
  [-1.55, 0.10], // tail base
];

class GlowFish {
  /** Posición del centro del pez en canvas-px. */
  position: Vec;
  /** Spine de 1 elemento que apunta a position — para compatibilidad con
   *  applyWander (lee spine[0]) y clampSpineToLake (itera fish.spine). */
  spine: Vec[];
  /** Heading actual de la cabeza en radianes. Smooth-rotates hacia target. */
  heading = 0;
  /** Velocidad del frame anterior (delta de position). */
  velocity: Vec = { x: 0, y: 0 };
  prevPos: Vec;
  /** Tamaño base — equivalente al "radio característico". El cuerpo extiende
   *  ~size*1.8 horizontal y size*0.65 vertical. Aliased a bodyScale para
   *  compatibilidad con applyWander/clampSpineToLake. */
  size: number;
  bodyScale: number;
  speedScale: number;
  finPhase = Math.random() * Math.PI * 2;
  glowBoost = 0;
  glowBoostTarget = 0;
  color: GlowFishColor;

  // ─── Física natural — animación fluida ──────────────────────────────────
  /** Speed actual (px/frame). Calculado en update, leído en render para
   *  drives del dorsal sweep dinámico y otras animaciones derivadas. */
  speed = 0;
  /** Heading del frame anterior, para calcular velocidad angular. */
  prevHeading = 0;
  /** Velocidad angular smoothed (rad/s). Drives el eye saccade. */
  angularVel = 0;
  /** Speed del frame anterior, para calcular aceleración. */
  prevSpeed = 0;
  /** Stretch X smoothed (squash-and-stretch). >1 al acelerar (cuerpo se
   *  alarga), <1 al frenar (comprime). Y se ajusta inverso para mantener
   *  proporción. Range típico [0.90, 1.12]. */
  stretchX = 1;
  /** Sign del Y-flip dorsal: +1 facing right (joroba up via local -y),
   *  -1 facing left (joroba up requiere flip Y porque rotar π pondría
   *  la joroba abajo). Snap con hysteresis ANCHA (~17°) + time-lock
   *  (~250ms entre flips). La snap es invisible porque ocurre cuando
   *  |cos(heading)|≈0 (X-scale al mínimo 15%) y la C-bend tiene al
   *  cuerpo curvado en U. */
  dorsalSide: 1 | -1 = 1;
  /** Cooldown timer entre flips de dorsalSide. Evita que un pez con
   *  heading oscilante alrededor de vertical flippee 10 veces por
   *  segundo (problema visible: "se queda mal colocado"). */
  flipCooldown = 0;
  /** Banking lateral smoothed (radianes equivalentes en X-skew). Drives
   *  el skew(1,0,bankSkew,1,0,0) durante giros — el cuerpo se inclina
   *  hacia el lado del giro, igual que un avión vira. Computado de
   *  `angularVel` con low-pass (k=4) y clamped a [-0.4, 0.4]. */
  bankSkew = 0;
  /** Bias del envelope de la onda corporal — sesga la onda hacia el lado
   *  del giro, replicando la C-bend biomecánica que hacen los peces
   *  reales antes/durante un cambio de dirección agresivo (C-start
   *  maneuver de la literatura biomecánica). Smoothed con k=3, clamped
   *  a [-1, 1]. */
  turnBend = 0;
  /** Versión retrasada de turnBend (k=1.5, tau ~650ms). Usada en el
   *  tail (xUnit hacia -1.55) mientras turnBend (current) se usa en el
   *  head (xUnit hacia 2.20). Resultado: cuando el head cambia rumbo,
   *  la cola conserva temporariamente el bend antiguo → cuerpo forma
   *  una S transient (overlapping action / follow-through Disney 12).
   *  Aporta vida orgánica a los giros. */
  delayedTurnBend = 0;
  /** Speed smoothed con inercia (k=2, tau ~500ms). El kinematic update
   *  computa el targetSpeed por alignment, pero currentSpeed lerps
   *  hacia ahí — sensación de momentum, no de cambios discretos.
   *  Position se integra con currentSpeed, no targetSpeed. */
  currentSpeed = 0;

  /**
   * Spinal chain — N vértebras EN COORDENADAS DE MUNDO. La cabeza es
   * `chainJoints[0]`. Cada frame, después del kinematic update,
   * `resolveChainToTarget(this.position)` hace que la cabeza salte
   * (con sub-pasos chicos) hacia la nueva posición y la columna se
   * acomoda manteniendo distancias (linkSize por segmento) y ángulos
   * (max ±GLOW_BEND_LIMIT entre vértebras consecutivas).
   *
   * Técnica de argonaut/animal-proc-anim. El cuerpo PHYSICALLY traza
   * el camino que la cabeza pintó. NO es un buffer temporal — es
   * geometría persistente con constraints. Render directo en world
   * coords (sin ctx.rotate/translate del cuerpo) — único modo de evitar
   * el bug "amarrados de un mecate" del intento anterior.
   */
  chainJoints: Vec[] = [];
  /**
   * Look-back angle de cada vértebra (de joint i hacia joint i-1, en
   * coordenadas de MUNDO). chainAngles[0] = dirección en la que la
   * cabeza acaba de moverse. Se mantiene explícito (no derivado de
   * joints) para usar el ángulo del frame anterior como ancla del
   * constraint propagation, así un movimiento puntual no flippea la
   * columna entera.
   */
  chainAngles: number[] = [];
  /** Phase del traveling wave del cuerpo (radianes). Avanza cada frame por
   *  `dt * omega`, donde omega escala con `bodyEffort`. Drives la
   *  undulación del silhouette — `sin(swimPhase + k·x)` desplaza cada
   *  cross-section lateralmente con amplitud que crece hacia la cola. */
  swimPhase = Math.random() * Math.PI * 2;
  /** Effort signal smoothed [0..1]. Drives la amplitud y la frecuencia
   *  del body wave. 0 = en reposo (breathing apenas perceptible, ~1 rad/s,
   *  amp ~4% de s), 1 = burst activo (~6 rad/s, amp ~22% de s).
   *  Smoothed con tau ~250ms para que cambios bruscos de speed no
   *  produzcan jerk en la amplitud. */
  bodyEffort = 0;

  /** Orbit usada como ancla para clampSpineToLake. El wander libre la ignora. */
  orbit: { cx: number; cy: number; rx: number; ry: number; phase: number; speed: number };
  target: Vec;

  // Wander state (mismos fields que LakeFish para drop-in con applyWander)
  wanderTarget: Vec;
  wanderState: 'cruising' | 'pausing' = 'cruising';
  pauseTimer = 0;
  wanderChaseTime = 0;
  hoverDriftTarget: Vec | null = null;
  hoverDriftTimer = 0;

  constructor(start: Vec, opts: {
    size: number;
    speedScale: number;
    color: GlowFishColor;
    orbit: GlowFish['orbit'];
  }) {
    this.position = { x: start.x, y: start.y };
    this.prevPos = { x: start.x, y: start.y };
    this.spine = [this.position]; // alias por referencia
    this.size = opts.size;
    this.bodyScale = opts.size;
    this.speedScale = opts.speedScale;
    this.color = opts.color;
    this.orbit = opts.orbit;
    this.target = { x: start.x, y: start.y };
    this.wanderTarget = { x: opts.orbit.cx, y: opts.orbit.cy };
    // Init chain — N vértebras alineadas en línea recta detrás de la cabeza
    // (asumiendo heading inicial = facing right). chainJoints[0] está en
    // `start`, joint[i] una distancia (xUnit_diff * size) detrás. Todos los
    // ángulos look-back inician en 0 (apuntan a +x = hacia la cabeza).
    {
      const N = GLOW_BODY_PROFILE.length;
      this.chainJoints = new Array(N);
      this.chainAngles = new Array(N).fill(0);
      const noseX = GLOW_BODY_PROFILE[0][0];
      for (let i = 0; i < N; i++) {
        const offsetUnit = noseX - GLOW_BODY_PROFILE[i][0];
        this.chainJoints[i] = { x: start.x - offsetUnit * opts.size, y: start.y };
      }
    }
  }

  /**
   * Sub-stepped resolve — la cabeza camina hacia `target` en pasos
   * cortos (≤ minSegLen × sin(GLOW_BEND_LIMIT) × 0.6) para que cada
   * sub-paso satisfaga la regla "step distance < linkSize × sin(angle
   * constraint)" del paper de argonaut. Sin esto, en frames con velocity
   * alta el constraint se satura en todos los joints simultáneamente y
   * la chain queda con un kink visible justo detrás de la cabeza
   * ("spike de pez espada" del intento anterior).
   */
  private resolveChainToTarget(target: Vec): void {
    // Min segment determina el sub-step máximo seguro.
    let minSegUnit = Number.POSITIVE_INFINITY;
    for (let i = 1; i < GLOW_BODY_PROFILE.length; i++) {
      const seg = GLOW_BODY_PROFILE[i - 1][0] - GLOW_BODY_PROFILE[i][0];
      if (seg < minSegUnit) minSegUnit = seg;
    }
    const minSegPx = minSegUnit * this.size;
    const safeStep = Math.max(0.5, minSegPx * Math.sin(GLOW_BEND_LIMIT) * 0.6);

    // Sub-stepping: si el head se mueve mucho, hacer varios pasos
    let head = this.chainJoints[0];
    let dx = target.x - head.x;
    let dy = target.y - head.y;
    let dist = Math.hypot(dx, dy);

    // Hard cap para evitar runaway (e.g., teletransporte por edge case)
    let safety = 32;
    while (dist > safeStep && safety-- > 0) {
      const nx = head.x + (dx / dist) * safeStep;
      const ny = head.y + (dy / dist) * safeStep;
      this.resolveChainStep({ x: nx, y: ny });
      head = this.chainJoints[0];
      dx = target.x - head.x;
      dy = target.y - head.y;
      dist = Math.hypot(dx, dy);
    }
    this.resolveChainStep(target);
  }

  /**
   * Single-pass resolve — port directo de `Chain.pde::resolve` de argonaut.
   * La cabeza salta a `newHeadPos` (sin clampear; el caller debe asegurar
   * que el step sea pequeño usando `resolveChainToTarget`). Cada vértebra
   * subsiguiente se reacomoda manteniendo distancia (linkSize) y ángulo
   * constrained (±GLOW_BEND_LIMIT) respecto a la anterior.
   */
  private resolveChainStep(newHeadPos: Vec): void {
    const N = this.chainJoints.length;
    const oldHead = this.chainJoints[0];
    const moveDx = newHeadPos.x - oldHead.x;
    const moveDy = newHeadPos.y - oldHead.y;
    // Si el head no se movió (movement≈0), preservar el ancla anterior.
    // Sin esto, atan2(0,0)=0 colapsaría chainAngles[0] a 0 = +x = facing right,
    // arrastrando toda la columna a recta horizontal. Mata todo el bend.
    if (Math.hypot(moveDx, moveDy) > 1e-4) {
      this.chainAngles[0] = Math.atan2(moveDy, moveDx);
    }
    this.chainJoints[0] = { x: newHeadPos.x, y: newHeadPos.y };

    for (let i = 1; i < N; i++) {
      const prev = this.chainJoints[i - 1];
      const cur = this.chainJoints[i];
      // look-back: dirección de joint[i] (vieja pos) hacia joint[i-1] (nueva)
      const naturalAngle = Math.atan2(prev.y - cur.y, prev.x - cur.x);
      // Clamp al ángulo del joint anterior ±BEND_LIMIT
      const constrained = constrainAngleArg(naturalAngle, this.chainAngles[i - 1], GLOW_BEND_LIMIT);
      this.chainAngles[i] = constrained;
      // joint[i] = joint[i-1] - linkSize * unit(constrained look-back)
      // (igual que argonaut: joint[i] queda a distancia exacta linkSize
      // detrás de joint[i-1] en la dirección OPUESTA al look-back).
      const segLenPx = (GLOW_BODY_PROFILE[i - 1][0] - GLOW_BODY_PROFILE[i][0]) * this.size;
      this.chainJoints[i] = {
        x: prev.x - Math.cos(constrained) * segLenPx,
        y: prev.y - Math.sin(constrained) * segLenPx,
      };
    }
  }

  setTargetSmooth(raw: Vec, smoothing: number): void {
    this.target.x += (raw.x - this.target.x) * smoothing;
    this.target.y += (raw.y - this.target.y) * smoothing;
  }

  /**
   * Update — modelo cinemático tipo bicycle / Dubins (NO pivot in place).
   *
   * El pez SIEMPRE nada hacia adelante en su heading actual, como un auto
   * o un barco. NO puede girar sobre su propio eje. Para alcanzar un
   * target detrás suyo, debe sobrepasarlo, arcear, y volver — exactamente
   * como hacen los peces reales (y por qué los tiburones quedan trabados
   * en jaulas: tienen radio mínimo de giro grande y deben nadar curvas).
   *
   * Mecánica:
   *   1) Steering: heading rota hacia atan2(target-pos), bounded por
   *      `maxTurnRate` (rad/s). Esto crea un radio mínimo de giro.
   *   2) Forward speed: SIEMPRE > 0 (clave — sin esto el pez podría
   *      "frenarse" para pivotar). Modulado por alignment con target:
   *      full speed cuando heading aligned, slower (pero NO cero) cuando
   *      necesita girar mucho. Esto reproduce el "slow down for tight
   *      turns" biomecánico real.
   *   3) Position: integra velocity = forward * speed * dt. NO hay
   *      "approach target" lerp — la trajectoria emerge de la integración
   *      forward + steering.
   *
   * Resultado emergente: arcs naturales en lugar de pivot, U-turns
   * cuando el target queda detrás, overshoot + correction loops.
   *
   * Radio mínimo: Rmin = forwardSpeed / maxTurnRate. Con
   * forwardSpeed_min ~0.6 y maxTurnRate ~1.6 rad/s, Rmin ≈ 0.4 px/frame
   * × 60 = ~25 px/s, que para un fish de size 30 da ~5x body length.
   * Más restrictivo = más curvas dramáticas.
   */
  update(_dt: number, _isFollowing: boolean, depthFactor: number): void {
    this.prevPos.x = this.position.x;
    this.prevPos.y = this.position.y;

    const dx = this.target.x - this.position.x;
    const dy = this.target.y - this.position.y;
    const dist = Math.hypot(dx, dy);

    // 1) Steering — heading bounded turn rate hacia target.
    let alignment = 1; // -1 (target detrás) a +1 (target adelante)
    if (dist > 0.5) {
      const targetAngle = Math.atan2(dy, dx);
      let diff = targetAngle - this.heading;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      // Max turn rate más moderado — radio mínimo más amplio = arcs
      // más graciosos, menos overshoot. Para 180° toma ~3.1s con
      // velocidad típica = U-turn dramatic pero natural.
      const maxTurnRate = 1.0; // rad/s ≈ 57°/s
      const turn = Math.sign(diff) * Math.min(Math.abs(diff), maxTurnRate * _dt);
      this.heading += turn;
      alignment = Math.cos(diff); // proyección del heading sobre el target
    }

    // 2) Forward speed con MOMENTUM — targetSpeed por alignment,
    //    currentSpeed lerps hacia ahí con tau ~500ms. La fish no
    //    cambia velocidad instantánea: acelera y desacelera con inercia.
    //    Resultado: tras un giro brusco, sigue gliding un instante;
    //    al volver a alinearse con el target, acelera gradualmente.
    const minSpeed = 1.4 * this.speedScale * depthFactor;
    const maxSpeed = 2.6 * this.speedScale * depthFactor;
    const speedFactor01 = 0.5 + 0.5 * alignment; // 0..1
    // TURN SPEED DAMPING moderado — pequeña reducción durante turns
    // (max 25%) para mantener forward motion visible. Sin damping
    // excesivo, el head sigue avanzando y el chain-based body trail
    // hace el visible curve, no parece "wagging in place".
    const turnDamping = Math.min(0.25, Math.abs(this.angularVel) * 0.20);
    const targetSpeed = (minSpeed + (maxSpeed - minSpeed) * speedFactor01) * (1 - turnDamping);
    this.currentSpeed += (targetSpeed - this.currentSpeed) * Math.min(1, _dt * 2);

    // 3) Integra currentSpeed (con inercia) en heading direction.
    const vx = Math.cos(this.heading) * this.currentSpeed;
    const vy = Math.sin(this.heading) * this.currentSpeed;
    this.position.x += vx * _dt * 60;
    this.position.y += vy * _dt * 60;

    this.velocity.x = this.position.x - this.prevPos.x;
    this.velocity.y = this.position.y - this.prevPos.y;
    this.speed = Math.hypot(this.velocity.x, this.velocity.y);

    // ─── Física natural ──────────────────────────────────────────────
    // 1) Velocidad angular smoothed (para eye saccade). Diff de heading
    //    normalizado a [-π, π], con lerp para evitar spikes.
    let headingDelta = this.heading - this.prevHeading;
    while (headingDelta > Math.PI) headingDelta -= 2 * Math.PI;
    while (headingDelta < -Math.PI) headingDelta += 2 * Math.PI;
    const rawAngVel = headingDelta / Math.max(_dt, 1e-6);
    this.angularVel = this.angularVel * 0.85 + rawAngVel * 0.15;
    this.prevHeading = this.heading;

    // 2) Squash-and-stretch — el cuerpo se alarga al acelerar y comprime
    //    al frenar. Mantiene el "volumen" del silhouette aplicando Y
    //    inverso en render. Disney 12 principles aplicado a peces.
    const accel = this.speed - this.prevSpeed;
    this.prevSpeed = this.speed;
    const targetStretch = 1 + Math.max(-0.10, Math.min(0.12, accel * 0.20));
    this.stretchX += (targetStretch - this.stretchX) * Math.min(1, _dt * 8);

    // 3) Y-flip dorsal con hysteresis ANCHA + time-lock.
    //    HYSTERESIS = 0.30 (~17° dead zone) — el heading necesita estar
    //    solidamente pasado de la vertical para flipear, no apenas
    //    cruzando. Mata el flipeo repetido cuando el heading oscila
    //    alrededor de vertical (problema visible: peces "stuck flipping").
    //    flipCooldown = 250ms entre flips — segunda barrera contra
    //    oscilación rápida.
    if (this.flipCooldown > 0) {
      this.flipCooldown = Math.max(0, this.flipCooldown - _dt);
    }
    const cosH = Math.cos(this.heading);
    // Hysteresis ESTRECHA — el flip ocurre casi en vertical (cosH≈0)
    // donde sideAlpha=|cosH|≈0 y top view es la dominante. Invisible.
    const HYSTERESIS = 0.05;
    let newDorsal: 1 | -1 = this.dorsalSide;
    if (this.flipCooldown <= 0) {
      if (this.dorsalSide === 1 && cosH < -HYSTERESIS) newDorsal = -1;
      else if (this.dorsalSide === -1 && cosH > HYSTERESIS) newDorsal = 1;
      if (newDorsal !== this.dorsalSide) {
        this.flipCooldown = 0.25; // 250ms
      }
    }
    this.dorsalSide = newDorsal;

    // 3b) Banking — el cuerpo se inclina hacia el lado del giro.
    //     bankSkew es un X-skew (afín 2D) — equivale a "lean" sin
    //     agregar otro rotate. Clamped para no over-skew.
    const targetBankSkew = Math.max(-0.4, Math.min(0.4, this.angularVel * 0.18));
    this.bankSkew += (targetBankSkew - this.bankSkew) * Math.min(1, _dt * 4);

    // 3c) C-bend AMPLIFICADA — el cuerpo se curva HACIA el giro durante
    //     turns. Es la "preparatory C-bend" del C-start maneuver
    //     biomecánico (PMC8943085). Coeficiente alto (0.85) para que la
    //     curvatura sea visualmente DOMINANTE durante el giro y enmascare
    //     el Y-flip. Smoothed con k=3 (tau ~330ms) para persistir un
    //     instante después del giro y luego relajarse.
    const targetTurnBend = Math.max(-1, Math.min(1, this.angularVel * 0.85));
    this.turnBend += (targetTurnBend - this.turnBend) * Math.min(1, _dt * 3);
    // delayedTurnBend lerps MUY LENTO (k=1.0, tau ~1000ms). En la cola
    // este bend es lo que se aplica → durante turns rápidos, tail mantiene
    // el bend antiguo casi 1s después que el head ya cambió → S transient
    // dramática y persistente (overlapping action visible).
    this.delayedTurnBend += (this.turnBend - this.delayedTurnBend) * Math.min(1, _dt * 1.0);

    // 4) Body undulation — traveling wave (carangiform swimming). El
    //    `bodyEffort` es smoothed para que la amplitud no cambie con jerk
    //    cuando el speed pega saltos. Speed range típico [0..3] px/frame
    //    → mapeo a [0..1]. La frecuencia (omega) escala linealmente: en
    //    reposo el cuerpo "respira" lento (~0.16 Hz), en burst late a
    //    ~1 Hz (carangiform real swimming es ~1-3 Hz, mapeo conservador
    //    para no over-animar en pantalla).
    const targetBodyEffort = Math.min(1, this.speed / 1.5);
    this.bodyEffort += (targetBodyEffort - this.bodyEffort) * Math.min(1, _dt * 4);
    // Rhythm jitter — variación lenta natural del omega (~±8%) usando
    // un sin de baja frecuencia desfasado por instancia (swimPhase es
    // único por pez, así que cada uno tiene su propio "carácter rítmico").
    // Resultado: ratos late más fuerte/débil sin patrón mecánico.
    const rhythmVar = 1 + Math.sin(this.swimPhase * 0.13) * 0.08;
    const swimOmega = (1.0 + 5.0 * this.bodyEffort) * rhythmVar;
    this.swimPhase += _dt * swimOmega;

    // Fin idle phase — wiggle suave de aletas (dorsal/pectoral), rate
    //  driven by speed. La cola NO usa este phase; está acoplada al
    //  traveling wave del cuerpo (continuación natural de la onda).
    this.finPhase += _dt * (1.8 + this.speed * 0.3);

    // Glow boost smoothing.
    this.glowBoost += (this.glowBoostTarget - this.glowBoost) * Math.min(1, _dt * 4);

    // Spinal chain resolve — la cabeza camina hacia this.position en
    // sub-pasos chicos; las vértebras se acomodan con constraints.
    this.resolveChainToTarget(this.position);
  }

  /**
   * Render — silueta-luminosa estilo imagen de referencia:
   *   1) Halo soft exterior radial
   *   2) Cuerpo: silueta ovalada outlined con rim brillante + fill translúcido
   *   3) Núcleo central: línea longitudinal de luz que termina en spot brillante
   *   4) Ojo: dot blanco-azul muy brillante en el head
   *   5) Aleta dorsal arriba (triangular outlined)
   *   6) Dos aletas pectorales (splayed outlined)
   *   7) Cola pequeña en V outlined
   *
   * `depthScale` aplica como ctx.scale uniforme alrededor del centro.
   */
  render(ctx: CanvasRenderingContext2D, depthScale: number): void {
    ctx.save();
    ctx.translate(this.position.x, this.position.y);
    ctx.scale(depthScale, depthScale);
    // NOTA: NO rotamos el contexto. El cuerpo se renderiza directamente
    // en world coords (relativos al head). Cada vértebra de la chain
    // tiene su propio world look-back angle — el perpendicular del
    // cross-section usa ESE angle, no un rotate global. Esto evita el
    // bug "amarrados de un mecate" del intento anterior, donde combinar
    // ctx.rotate + chain world-coords causaba doble rotación visual.
    ctx.globalCompositeOperation = 'lighter';

    const s = this.size;
    const boost = this.glowBoost;
    // Speed factor 0..1 para drives de aletas dinámicas
    const speedFactor = Math.min(1, this.speed / 3.0);

    // ─── Multi-view billboard (side ↔ top crossfade) ──────────────────
    // Premium 2.5D: dos views procedurales mezclando alpha según heading.
    //   • Side view: full cuando heading horizontal (|cos|=1)
    //   • Top view:  full cuando heading vertical (|sin|=1)
    //   • In between: cross-fade — three-quarter view ilusión
    //
    // El "brinco" del flip dorsalSide se disuelve aquí: el flip ocurre
    // cuando cos(heading)≈0 → exactamente cuando sideAlpha→0 → el flip
    // es invisible. Top view (sin dorsalSide concept, simétrico L/R)
    // toma el relevo. Side view re-aparece del otro lado mirrored sin
    // discontinuidad visible.
    //
    // Nado vertical (heading=±π/2) ahora muestra TOP view: pez visto
    // desde arriba con dos pectorales splayed, dos ojos, silhouette
    // simétrica. Resuelve el "calcomanía subiendo" de antes.
    const sinHR = Math.sin(this.heading);
    // Morph factor — 0 = side profile, 1 = top profile, smooth ease.
    // Computed aquí (antes de waveAt) para que la wave amplitude pueda
    // escalar con view angle (vertical = más visible serpentear).
    const viewMorph = sinHR * sinHR;
    const sy = 2 - this.stretchX; // squash-and-stretch (compartido)

    // ─── Body undulation — traveling wave (carangiform) ───────────────
    // La onda viajera se aplica a CADA cross-section del cuerpo (top y
    // bottom de la misma sección se trasladan juntos), a las vértebras,
    // a la espina y al tail. Resultado: la espina del pez se curva como
    // una S viajera; las cross-sections rígidas la siguen. Esto reemplaza
    // el silhouette estático que sólo trasladaba al pez como un bloque.
    //
    //   waveY(x) = env(x) · ampPx · sin(swimPhase + k·x)
    //
    //   • env(x) = u² donde u = 0 en cabeza, 1 en cola — quadratic
    //     envelope: la cabeza casi no se mueve, la cola hace todo el
    //     latigazo (igual que peces reales tipo carangiform).
    //   • ampPx escala con bodyEffort: en reposo ~4% del size (apenas
    //     "breathing"), en burst ~22% (latigazo activo).
    //   • k corresponde a 1.2 wavelengths a lo largo del cuerpo,
    //     valor típico para teleósteos. La onda viaja head→tail (signo
    //     positivo en `+ k·x` con x decreciente hacia la cola).
    const xNoseUnit = 2.20;
    const xTailUnit = -1.55;
    const bodyLenUnit = xNoseUnit - xTailUnit; // 3.75
    const k = (Math.PI * 2 * GLOW_WAVES_PER_BODY) / bodyLenUnit;
    // Wave amplitude SCALES con viewMorph (1.0× side → 1.7× top). En
    // vertical el body serpentea visiblemente más (motion lateral es
    // la dominante vista desde arriba). Smooth scale → fluidez sin pop.
    const viewAmpBoost = 1 + 0.7 * viewMorph;
    const ampPx = s * (0.04 + 0.18 * this.bodyEffort) * viewAmpBoost;
    // C-bend bias con TAIL-LEADS (overlapping action) — el head usa
    // turnBend current; el tail usa delayedTurnBend (lag ~650ms). Cuando
    // el head cambia rumbo, el tail conserva temporariamente el bend
    // antiguo → cuerpo forma una S transient. Es el seguimiento orgánico
    // que hace que el giro NO se sienta como bloque rígido — la energía
    // del giro propaga del head al tail con delay biomecánico real.
    //
    const N = GLOW_BODY_PROFILE.length;

    // ─── waveAt — solo undulación de nado, SIN cBend ─────────────────
    // El bend del giro lo provee la chain espacial (chainJoints curvan
    // físicamente al girar). Acá solo agregamos la onda viajera del nado
    // como pequeño offset perpendicular a cada cross-section.
    const waveAt = (xUnit: number): number => {
      const u = (xNoseUnit - xUnit) / bodyLenUnit; // 0 head → 1 tail
      const env = u * u;
      return env * ampPx * Math.sin(this.swimPhase + k * xUnit);
    };

    // ─── chainAt — interpola posición + ángulo entre vértebras ────────
    // Para cada xUnit del BODY_PROFILE (no uniforme), encuentra el chain
    // segment que lo contiene y devuelve la posición LOCAL (relativa al
    // head, en world axes — no rotada) y el world look-back angle. Para
    // xUnit fuera del rango (eye 1.30 OK, tail tip -2.30 fuera), extrapola
    // usando el ángulo del joint extremo.
    const headW = this.chainJoints[0];
    const chainAt = (xUnit: number): { lx: number; ly: number; ang: number } => {
      const noseX = GLOW_BODY_PROFILE[0][0];
      const tailX = GLOW_BODY_PROFILE[N - 1][0];
      // Beyond head (xUnit > nose) — extrapolate forward
      if (xUnit >= noseX) {
        const j = this.chainJoints[0];
        const a = this.chainAngles[0];
        const offsetPx = (xUnit - noseX) * this.size;
        // forward direction = look-back angle (from joint 0 toward where
        // joint -1 would be = AWAY from joint 1 = INTO direction of motion)
        // joint[0] is the head, look-back angle points FROM head BACK to
        // body (toward joint 1)... wait no. chainAngles[0] is set to
        // direction of head movement. So it points "forward". Extrapolating
        // beyond nose = going further in chainAngles[0] direction.
        return {
          lx: (j.x - headW.x) + Math.cos(a) * offsetPx,
          ly: (j.y - headW.y) + Math.sin(a) * offsetPx,
          ang: a,
        };
      }
      // Beyond tail (xUnit < tail) — extrapolate backward
      if (xUnit <= tailX) {
        const j = this.chainJoints[N - 1];
        const a = this.chainAngles[N - 1];
        const offsetPx = (tailX - xUnit) * this.size;
        // chainAngles[i] is from joint[i] toward joint[i-1] = toward head
        // To go backward (toward tail extension), opposite direction
        return {
          lx: (j.x - headW.x) - Math.cos(a) * offsetPx,
          ly: (j.y - headW.y) - Math.sin(a) * offsetPx,
          ang: a,
        };
      }
      // Find the segment [i, i+1] containing this xUnit
      for (let i = 0; i < N - 1; i++) {
        const x0 = GLOW_BODY_PROFILE[i][0];
        const x1 = GLOW_BODY_PROFILE[i + 1][0];
        if (xUnit <= x0 && xUnit >= x1) {
          const t = (x0 - xUnit) / (x0 - x1);
          const j0 = this.chainJoints[i];
          const j1 = this.chainJoints[i + 1];
          // Wrap-aware angle interpolation
          let da = this.chainAngles[i + 1] - this.chainAngles[i];
          if (da > Math.PI) da -= Math.PI * 2;
          if (da < -Math.PI) da += Math.PI * 2;
          const ang = this.chainAngles[i] + da * t;
          return {
            lx: (j0.x - headW.x) + ((j1.x - j0.x)) * t,
            ly: (j0.y - headW.y) + ((j1.y - j0.y)) * t,
            ang,
          };
        }
      }
      // Fallback (shouldn't reach)
      const j = this.chainJoints[N - 1];
      return { lx: j.x - headW.x, ly: j.y - headW.y, ang: this.chainAngles[N - 1] };
    };

    // ─── mapToSpine — pos + cross-section + wave en world frame ─────
    // Devuelve coords LOCAL al head pero en EJES MUNDO (no hay rotate del
    // ctx). yUnit signed: NEG = back/joroba, POS = belly. Wave es lateral
    // (perp al spine), no se invierte con dorsalSide para que oscile en
    // body-frame consistente. La perpendicular del cross-section SÍ se
    // invierte con dorsalSide (mantiene joroba arriba visualmente cuando
    // el pez gira pasado vertical).
    const mapToSpine = (xUnit: number, yUnitSigned: number): Vec => {
      const c = chainAt(xUnit);
      const sinA = Math.sin(c.ang);
      const cosA = Math.cos(c.ang);
      // Perpendicular para back-side: (sin(a), -cos(a)) cuando dorsalSide=+1
      // (rotar forward 90° CW visual en Y-down). Flip con dorsalSide.
      // Cross-section offset = -yUnit * dorsalSide * (sin(a), -cos(a))
      // = (-yUnit*dorsalSide*sin(a), yUnit*dorsalSide*cos(a))
      // Wave offset (sin dorsalSide flip) = wave * (sin(a), -cos(a))
      // Total perpendicular en pixels:
      const yUnitPx = yUnitSigned * s * this.dorsalSide;
      const wavePx = waveAt(xUnit);
      // Combinado: lateral_offset = (wave - yUnit*dorsalSide*s)
      // Para que back side (yUnit<0) quede en dirección perp positiva:
      const lateral = wavePx - yUnitPx;
      return {
        x: c.lx + lateral * sinA,
        y: c.ly - lateral * cosA,
      };
    };

    // tangentAt — para backward-compat con el resto del render (dorsal wag,
    // saccade del ojo). Devuelve el world look-back angle del joint en xUnit.
    const tangentAt = (xUnit: number): number => chainAt(xUnit).ang;

    // ─── 1) Halo exterior soft ───
    const haloR = s * 4.6;
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, haloR);
    halo.addColorStop(0, hexA(this.color.halo, 0.32 + boost * 0.20));
    halo.addColorStop(0.35, hexA(this.color.halo, 0.16 + boost * 0.12));
    halo.addColorStop(0.7, hexA(this.color.halo, 0.05));
    halo.addColorStop(1, hexA(this.color.halo, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.ellipse(0, 0, haloR, haloR * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();

    // Quadratic-through-midpoints helper para suavizar polyline.
    // Definido aquí (antes de los views) para que ambos lo compartan.
    const smoothPath = (pts: Vec[]): void => {
      if (pts.length < 2) return;
      ctx.lineTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) * 0.5;
        const my = (pts[i].y + pts[i + 1].y) * 0.5;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    };

    // ══════════════════════════════════════════════════════════════════
    // MORPHED VIEW — UNA sola silueta que se transforma continuamente
    // entre side profile (asimétrica, joroba+vientre, 1 ojo, 1 pec) y
    // top profile (simétrica, 2 ojos, 2 pecs). View-Dependent Deformation:
    // los vertices del silhouette + features lerp entre ambos profiles
    // según m = sin²(heading). Single coherent shape en todo momento,
    // sin overlap de capas — la transición es la deformación misma.
    //
    // m = 0 (heading horizontal): pure side profile
    // m = 1 (heading vertical):   pure top profile
    // m = 0.5 (heading 45°):     three-quarter view real
    //
    // El dorsalSide flip aplica a ALL the morphed Y, pero al ocurrir
    // (cosH≈0, m≈1) la silueta es simétrica → flip invisible.
    {
      ctx.save();
      // Sin scale ni translate aquí: chainAt ya devuelve coords LOCALES
      // al head (joint[0] en (0,0)), y el dorsalSide flip se aplica dentro
      // de mapToSpine vía signo de la perpendicular. La silueta morpheada
      // YA representa el cambio de view angle por su forma.
      ctx.globalAlpha = 1;

      // Morph factor — alias del viewMorph computado al inicio
      const m = viewMorph;
      const morphY = (sideYU: number, topYU: number): number =>
        sideYU * (1 - m) + topYU * m;

      // ─── Silueta morpheada (side ↔ top profile, single coherent) ────
      // Cada anchor del silhouette: morphY entre el profile asimétrico
      // (BODY_PROFILE) y el simétrico (TOP_PROFILE). Single shape que
      // se transforma continuamente con m. NO overlapping de capas.
      const topPts: Vec[] = new Array(N);
      const botPts: Vec[] = new Array(N);
      for (let i = 0; i < N; i++) {
        const [xUnit, sideTopY, sideBotY] = GLOW_BODY_PROFILE[i];
        const topHalfW = GLOW_TOP_PROFILE[i][1];
        // Top edge of silhouette: side gives joroba (-Y), top gives -halfW
        topPts[i] = mapToSpine(xUnit, morphY(sideTopY, -topHalfW));
        // Bottom edge: side gives vientre (+Y), top gives +halfW
        botPts[i] = mapToSpine(xUnit, morphY(sideBotY, +topHalfW));
      }

    ctx.beginPath();
    ctx.moveTo(topPts[0].x, topPts[0].y); // nariz
    smoothPath(topPts);
    ctx.lineTo(botPts[N - 1].x, botPts[N - 1].y);
    const botReversed: Vec[] = [];
    for (let i = N - 1; i >= 0; i--) botReversed.push(botPts[i]);
    smoothPath(botReversed);
    ctx.closePath();
    ctx.fillStyle = hexA(this.color.body, 0.42 + boost * 0.15);
    ctx.fill();
    ctx.strokeStyle = hexA(this.color.rim, 0.88 + boost * 0.12);
    ctx.lineWidth = Math.max(0.7, s * 0.13);
    ctx.stroke();

    // ─── 3) Espina central + vertebrae spots (siguen la onda) ─────────
    // La espina conectora también ondula — la construyo como polyline
    // de N samples con waveY aplicado a cada uno. Cada vertebra se
    // posiciona en su xUnit con su propio waveAt(xUnit) → quedan
    // exactamente sobre la espina curvada.
    const spinePts: Vec[] = [];
    for (let i = 0; i < N; i++) {
      const xUnit = GLOW_BODY_PROFILE[i][0];
      // mapToSpine con yUnit=0 = sobre el centerline articulado del chain
      spinePts.push(mapToSpine(xUnit, 0));
    }
    // Render espina como path stroked con gradiente longitudinal tenue.
    // El gradient lo orientamos del head al tail vía los endpoints reales.
    const spineGrad = ctx.createLinearGradient(
      spinePts[0].x, spinePts[0].y,
      spinePts[N - 1].x, spinePts[N - 1].y,
    );
    spineGrad.addColorStop(0, hexA(this.color.core, 0));
    spineGrad.addColorStop(0.12, hexA(this.color.core, 0.55));
    spineGrad.addColorStop(0.85, hexA(this.color.core, 0.55));
    spineGrad.addColorStop(1, hexA(this.color.core, 0));
    ctx.strokeStyle = spineGrad;
    ctx.lineWidth = Math.max(0.6, s * 0.14);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(spinePts[0].x, spinePts[0].y);
    smoothPath(spinePts);
    ctx.stroke();

    // Vertebrae spots — sobre la espina articulada + bio-pulse synced
    // al wave. Cada vertebra brilla extra cuando el peak de la onda
    // pasa por su xUnit — efecto de "muscle activation visible".
    // [xUnit, brightnessFactor]. brightness 0..1.
    const vertebrae: Array<[number, number]> = [
      [-1.10, 0.45],
      [-0.40, 0.70],
      [ 0.30, 1.00],   // el más bright (heart)
      [ 0.95, 0.65],
      [ 1.55, 0.40],
    ];
    for (const [vxUnit, vAlpha] of vertebrae) {
      const v = mapToSpine(vxUnit, 0); // sobre el centerline articulado
      // Bio-pulse AMPLIFICADA — el peak local de la onda aumenta brillo
      // (max +60%). Visible muscle activation que viaja head→tail
      // con la onda corporal. Más dramático que la versión anterior
      // (0.18 → 0.55) para que las "vértebras se vean activarse".
      const wavePhaseLocal = Math.sin(this.swimPhase + k * vxUnit);
      const pulse = 1 + 0.55 * Math.max(0, wavePhaseLocal) * (0.4 + 0.6 * this.bodyEffort);
      // Per-vertebra Y-jitter — pequeña oscilación independiente
      // perpendicular a la espina (muscle fiber twitches). Phase
      // distinta por vértebra para que no se vean sincronizadas.
      const jitterMag = Math.sin(this.swimPhase * 2.7 + vxUnit * 8.3) * s * 0.025;
      const θj = tangentAt(vxUnit);
      const jitterX = Math.sin(θj) * jitterMag;
      const jitterY = -Math.cos(θj) * jitterMag;
      const cx = v.x + jitterX;
      const cy = v.y + jitterY;
      const r = s * (0.18 + vAlpha * 0.10);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.4);
      g.addColorStop(0, hexA('#dde6ff', 0.85 * vAlpha * pulse + boost * 0.10));
      g.addColorStop(0.35, hexA(this.color.core, 0.78 * vAlpha * pulse));
      g.addColorStop(1, hexA(this.color.core, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 2.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // ─── 4) Ojos morpheados — DOS, posición se separa con m ────────────
    // En side view (m=0) ambos ojos están en yUnit=0 (overlapping =
    // single visual eye). En top view (m=1) están en ±0.22 (mirror).
    // En entre, se separan suavemente — sin "aparecer" segundo ojo
    // discreto, simplemente la silueta única se separa en dos.
    const eyeR = s * 0.22;
    const eyeθGlobal = tangentAt(1.30);
    const saccadeMag = -this.angularVel * s * 0.04;
    for (const eyeSign of [-1, +1]) {
      const eyeYU = morphY(0, eyeSign * 0.22);
      const eyeBase = mapToSpine(1.30, eyeYU);
      const eyeRenderX = eyeBase.x - Math.sin(eyeθGlobal) * saccadeMag;
      const eyeRenderY = eyeBase.y + Math.cos(eyeθGlobal) * saccadeMag;
      const eg = ctx.createRadialGradient(eyeRenderX, eyeRenderY, 0, eyeRenderX, eyeRenderY, eyeR * 2.4);
      eg.addColorStop(0, hexA('#ffffff', 0.96));
      eg.addColorStop(0.40, hexA(this.color.core, 0.78));
      eg.addColorStop(1, hexA(this.color.core, 0));
      ctx.fillStyle = eg;
      ctx.beginPath();
      ctx.arc(eyeBase.x, eyeBase.y, eyeR * 2.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // ─── 5) Aleta dorsal — fade out con m (solo visible en side view) ──
    // La dorsal triangular es un feature lateral; no tiene sentido en
    // top view (donde la dorsal se ve como stripe central, ya cubierto
    // por el spine glow). Fade smooth con (1-m)².
    const dorsalAlpha = (1 - m) * (1 - m);
    if (dorsalAlpha > 0.02) {
      const dorsalWag = Math.sin(this.finPhase * 0.9) * s * 0.04;
      const dorsalTipXUnit = -0.35 - speedFactor * 0.40;
      const dorsalTipYUnit = -1.25 + speedFactor * 0.20;
      const dBaseA = mapToSpine(-0.20, -0.62);
      const dBaseP = mapToSpine(-0.95, -0.40);
      const dTip = mapToSpine(dorsalTipXUnit, dorsalTipYUnit);
      const dTipθ = tangentAt(dorsalTipXUnit);
      const dTipWagX = dTip.x + Math.cos(dTipθ) * dorsalWag;
      const dTipWagY = dTip.y + Math.sin(dTipθ) * dorsalWag;
      ctx.save();
      ctx.globalAlpha = dorsalAlpha;
      ctx.beginPath();
      ctx.moveTo(dBaseA.x, dBaseA.y);
      ctx.lineTo(dTipWagX, dTipWagY);
      ctx.lineTo(dBaseP.x, dBaseP.y);
      ctx.closePath();
      ctx.fillStyle = hexA(this.color.body, 0.28);
      ctx.fill();
      ctx.strokeStyle = hexA(this.color.rim, 0.55);
      ctx.lineWidth = Math.max(0.35, s * 0.07);
      ctx.stroke();
      ctx.restore();
    }

    // ─── 6) Aletas pectorales morpheadas — DOS, splay con m ────────────
    // En side (m=0) ambas en posición vientre (overlap = una sola visual).
    // En top (m=1) en posiciones mirror (±0.36 etc). Paddle stroke
    // alternado: cada lado opuesto en fase para "rowing".
    const paddlePhase = this.finPhase * 0.6;
    const pecPaddle = Math.sin(paddlePhase);
    for (const pecSign of [-1, +1] as const) {
      // Top-view tip XUnit oscilla por side: side=+1 atrás cuando paddle>0,
      // side=-1 adelante (rowing alternado). En side view (m=0) ambas
      // pectorales convergen al mismo movimiento ventral.
      const tipXUnit = morphY(0.20 - pecPaddle * 0.15, 0.20 - pecPaddle * pecSign * 0.15);
      const tipYUnit = morphY(0.78, pecSign * (0.85 + pecPaddle * pecSign * 0.08));
      const baseAYU = morphY(0.28, pecSign * 0.36);
      const basePYU = morphY(0.30, pecSign * 0.40);
      const midYU = morphY(0.55, pecSign * 0.55);
      const pBA = mapToSpine(0.85, baseAYU);
      const pTip = mapToSpine(tipXUnit, tipYUnit);
      const pMid = mapToSpine(0.05, midYU);
      const pBP = mapToSpine(0.55, basePYU);
      ctx.beginPath();
      ctx.moveTo(pBA.x, pBA.y);
      ctx.quadraticCurveTo(pTip.x, pTip.y, pMid.x, pMid.y);
      ctx.lineTo(pBP.x, pBP.y);
      ctx.closePath();
      ctx.fillStyle = hexA(this.color.body, 0.18);
      ctx.fill();
      ctx.strokeStyle = hexA(this.color.rim, 0.40);
      ctx.lineWidth = Math.max(0.25, s * 0.05);
      ctx.stroke();
    }

    // ─── 7) Aleta anal — fade out con m (solo side view) ──────────────
    const analAlpha = (1 - m) * (1 - m);
    if (analAlpha > 0.02) {
      const aBA = mapToSpine(-0.75, 0.30);
      const aTip = mapToSpine(-1.05, 0.62);
      const aBP = mapToSpine(-1.30, 0.22);
      ctx.save();
      ctx.globalAlpha = analAlpha;
      ctx.beginPath();
      ctx.moveTo(aBA.x, aBA.y);
      ctx.lineTo(aTip.x, aTip.y);
      ctx.lineTo(aBP.x, aBP.y);
      ctx.closePath();
      ctx.fillStyle = hexA(this.color.body, 0.22);
      ctx.fill();
      ctx.strokeStyle = hexA(this.color.rim, 0.40);
      ctx.lineWidth = Math.max(0.25, s * 0.05);
      ctx.stroke();
      ctx.restore();
    }

    // ─── 8) Caudal fin abanicada estilo argonaut ─────────────────────
    // El ancho de la cola crece con la diferencia angular acumulada
    // head→tail (más bend = cola más abierta). Es la firma visual del
    // turn de argonaut: cuando el pez se curva en C, la cola se abanica.
    //
    // headToTail aprox = wrap(chainAngles[0] - chainAngles[N-1]). Cuando
    // el body está recto, ≈0 → cola plana. En giro fuerte, hasta ~PI.
    const headToTail = wrapAngleSigned(this.chainAngles[0] - this.chainAngles[N - 1]);
    const fanMag = Math.abs(headToTail);
    // Bottom-side de la cola crece quadratically con el offset del joint
    // base (joint del tail base = N-1, xUnits desde -1.55 hasta -2.30).
    // Argonaut: tailWidth = 1.5 * headToTail * (i-8)^2. En nuestro perfil,
    // el tail spans 4 sub-positions (-1.55, -1.80, -2.05, -2.30).
    const tailXUnits = [-1.55, -1.80, -2.05, -2.30];
    const tailBotPts: Vec[] = [];
    const tailTopPts: Vec[] = [];
    for (let i = 0; i < tailXUnits.length; i++) {
      const xU = tailXUnits[i];
      // Outer edge (lado contrario al bend) crece quadratically con headToTail
      const fanOut = 1.5 * fanMag * (i / (tailXUnits.length - 1)) * (i / (tailXUnits.length - 1));
      // Inner edge crece linealmente con un cap más bajo
      const fanIn = Math.max(-0.85, Math.min(0.85, fanMag * 0.40));
      // Si headToTail es positivo, el bottom se abre (el lado outer)
      const sgn = Math.sign(headToTail) || 1;
      // yUnit del top y bottom de la cola, modulado por el fan
      const baseTopY = -0.10 - fanOut * 0.6;
      const baseBotY = +0.10 + fanOut * 0.6;
      // Lado opuesto al bend (sgn) recibe el fan grande
      const topY = sgn > 0 ? baseTopY : -fanIn - 0.10;
      const botY = sgn > 0 ? +fanIn + 0.10 : baseBotY;
      tailTopPts.push(mapToSpine(xU, topY));
      tailBotPts.push(mapToSpine(xU, botY));
    }
    // Render: closed shape from base-top through tail-top, around tip,
    // back through tail-bot to base-bot.
    ctx.beginPath();
    ctx.moveTo(tailTopPts[0].x, tailTopPts[0].y);
    for (let i = 1; i < tailTopPts.length; i++) {
      ctx.lineTo(tailTopPts[i].x, tailTopPts[i].y);
    }
    for (let i = tailBotPts.length - 1; i >= 0; i--) {
      ctx.lineTo(tailBotPts[i].x, tailBotPts[i].y);
    }
    ctx.closePath();
    ctx.fillStyle = hexA(this.color.body, 0.26 + fanMag * 0.10);
    ctx.fill();
    ctx.strokeStyle = hexA(this.color.rim, 0.42);
    ctx.lineWidth = Math.max(0.30, s * 0.06);
    ctx.stroke();

      ctx.restore(); // close MORPHED VIEW block
    }

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
  fish: { spine: Vec[] }, // LakeFish o GlowFish — ambos exponen .spine
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
    const applyWander = (f: LakeFish | GlowFish, dtNow: number): void => {
      if (f.wanderState === 'cruising') {
        const wcuv = imgUVToCanvasUV(f.wanderTarget, cw, ch, IMG_W, IMG_H);
        const wx = wcuv.x * cw;
        const wy = wcuv.y * ch;
        f.setTargetSmooth({ x: wx, y: wy }, 0.04);
        const dToTarget = Math.hypot(f.spine[0].x - wx, f.spine[0].y - wy);
        f.wanderChaseTime += dtNow;
        // Threshold de llegada — proporcional al tamaño del pez + margen.
        // (Aumentado ahora con kinematic motion: el pez no se detiene en
        // el target, lo orbita; el threshold tiene que ser generoso para
        // que pase a pausing sin necesitar landing exacto.)
        const arriveTreshold = 30 + f.bodyScale * 5;
        // Anti-stuck failsafe: si el pez chase 7s sin llegar (target
        // inalcanzable o stuck en oscilación cinemática), pick nuevo
        // wanderTarget. Esto rompe el loop de "stuck flipping vertical".
        const chaseTimeout = 7;
        if (dToTarget < arriveTreshold || f.wanderChaseTime > chaseTimeout) {
          f.wanderState = 'pausing';
          f.pauseTimer = 0.8 + Math.random() * 2.7;
          f.wanderChaseTime = 0;
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

    // ─── GlowFish (3) — peces silueta-luminosa al estilo de la imagen de
    // referencia. Coexisten con los LakeFish ambientales para que el
    // usuario compare ambos estilos en el mismo lago. Spawn en puntos
    // que no chocan con SPAWN_UV de los LakeFish.
    // Paleta azul ELÉCTRICO PURO, sin celeste/cyan. Hexes con G < B/2
    // para forzar el tono "literalmente azul" que el usuario pidió
    // mirando la referencia. Rim/core ya no son blanco-azul, son
    // azul saturado bright. El blanco aparece SOLO en los puntos
    // brillantes internos (vertebrae spots).
    const GLOW_PALETTE: GlowFishColor[] = [
      { rim: '#3870ff', body: '#060932', core: '#1858ff', halo: '#0040ff' },
      { rim: '#3068ee', body: '#070b35', core: '#1450ee', halo: '#0038f0' },
      { rim: '#4078ff', body: '#080c38', core: '#2060ff', halo: '#0048ff' },
    ];
    const GLOW_SPAWN: Vec[] = [
      { x: 0.22, y: 0.66 },
      { x: 0.50, y: 0.78 },
      { x: 0.72, y: 0.88 },
    ];
    const glowFishes: GlowFish[] = [];
    const buildGlowFishes = (): void => {
      glowFishes.length = 0;
      for (let i = 0; i < GLOW_SPAWN.length; i++) {
        const uv = GLOW_SPAWN[i];
        const cuv = imgUVToCanvasUV(uv, cw, ch, IMG_W, IMG_H);
        const start = { x: cuv.x * cw, y: cuv.y * ch };
        // size ~20 en desktop, ~11 en mobile (+~55% vs versión previa).
        // Los GlowFish extienden ~4.5×size de largo total (con tail),
        // así que size=20 da ~90px en desktop, ~50px en mobile.
        const baseSize = Math.max(11, Math.min(20, cw / 72));
        glowFishes.push(new GlowFish(start, {
          size: baseSize,
          // SpeedScale 0.45-0.7 — los GlowFish son más calmos que los
          // LakeFish (pez dorado-like, no cardumen), así que aún cuando
          // su pull/maxStep base son menores, terminan moviéndose
          // notablemente más despacio.
          speedScale: 0.45 + Math.random() * 0.25,
          color: GLOW_PALETTE[i % GLOW_PALETTE.length],
          orbit: {
            cx: uv.x,
            cy: uv.y,
            rx: 0.04,
            ry: 0.02,
            phase: Math.random() * Math.PI * 2,
            speed: 0.10,
          },
        }));
      }
    };
    buildGlowFishes();

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
      buildGlowFishes();
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

      // GlowFish — peces silueta-luminosa nuevos. Misma wander logic
      // que los LakeFish ambientales, pero con física simple (sin FABRIK)
      // y render tipo silueta outlined (cuerpo + aletas + núcleo + halo).
      for (const gf of glowFishes) {
        applyWander(gf, dt);

        const ghead = gf.spine[0];
        let gboost = 0;
        if (pointer.active) {
          const dPointer = Math.hypot(ghead.x - pointer.x, ghead.y - pointer.y);
          const radius = 90 + gf.bodyScale * 8;
          gboost = Math.max(gboost, Math.max(0, 1 - dPointer / radius));
        }
        const dCursorFish2 = Math.hypot(ghead.x - cursorFish.spine[0].x, ghead.y - cursorFish.spine[0].y);
        const cfRadius2 = 70 + gf.bodyScale * 6;
        gboost = Math.max(gboost, Math.max(0, 1 - dCursorFish2 / cfRadius2));
        gf.glowBoostTarget = gboost;

        const gHeadV = canvasUVToImgUV(
          { x: ghead.x / cw, y: ghead.y / ch }, cw, ch, IMG_W, IMG_H,
        ).y;
        gf.update(dt, false, depthScaleAt(gHeadV));

        clampSpineToLake(gf, mask, cw, ch, IMG_W, IMG_H,
          imgUVToCanvasUV({ x: gf.orbit.cx, y: gf.orbit.cy }, cw, ch, IMG_W, IMG_H));
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
      // Render GlowFish (mismo blur sutil para que se sientan sumergidos
      // junto al resto de peces).
      for (const gf of glowFishes) {
        const ghV = canvasUVToImgUV({ x: gf.spine[0].x / cw, y: gf.spine[0].y / ch }, cw, ch, IMG_W, IMG_H).y;
        gf.render(ctx, depthScaleAt(ghV));
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
