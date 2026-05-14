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

/** Wavelength (en unidades de longitud corporal). λ/L ≈ 1 = carangiform
 *  puro (jacks/mackerel/predadores de lago). λ/L < 1 lee como anguilliform
 *  (anguila/serpiente — dos crestas visibles a la vez). Sfakiotakis 1999,
 *  Webb 1984. */
const GLOW_WAVES_PER_BODY = 0.95;

/** Exponente del envelope del wave. u² (current biomimético subcarangiform,
 *  ~25% amplitud al medio del cuerpo) lee snake/eel-ish. u³ concentra el
 *  movimiento en el tercio posterior = carangiform real. Di Santo 2021:
 *  ratio amplitud cabeza:cola en peces típicos ~1:6, lo que requiere
 *  envelope más agresivo que u². */
const GLOW_WAVE_ENV_POWER = 3.0;

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

  /** Modo "suspendido": cuando true, el pez frena gradualmente a casi 0
   *  (override del minSpeed kinematic). Usado por el cursor fish cuando
   *  alcanza al cursor: el pez se queda flotando en su posición en
   *  lugar de seguir orbitando alrededor con Dubins forward-only.
   *  Si el cursor se mueve, isHovering se desactiva externamente y el
   *  pez vuelve a perseguir.
   */
  isHovering = false;

  /** Modo cazador transitorio: 1 = ambiente normal (oscilación de energy
   *  y speedScale propio). > 1 = depredador: energy=1.0 constante y
   *  speed final multiplicado por este factor. Se setea externo cada
   *  frame (NO bake en speedScale) para que el mismo pez pueda pasar
   *  de patrullaje ambiente a hunt y volver, sin afectar su comportamiento
   *  off-water. */
  huntingBoost = 1;

  // ── Hover station-keeping state (Drucker & Lauder 1999, Webb 1984,
  // Bainbridge 1963) ──────────────────────────────────────────────────
  // Cuando isHovering=true, el pez no usa kinematic bicycle. Usa position
  // lerp hacia target, yaw sway natural (Bainbridge), vertical bob de
  // gill rhythm (crítico para no parecer pez muerto flotando), y twitch
  // ocasional de re-fixación (Webb pike sit-and-wait). Los "*Applied"
  // son los offsets cumulativos para poder restaurarlos al salir del
  // hover (sin esto, el residual del sway se quedaría sumado al heading
  // y el pez volvería ligeramente desviado al cruising).
  hoverYawPhase = Math.random() * Math.PI * 2;
  hoverYawApplied = 0;
  hoverBobPhase = Math.random() * Math.PI * 2;
  hoverBobApplied = 0;
  hoverTwitchCooldown = 2 + Math.random() * 3;
  hoverTwitchRemaining = 0;
  hoverTwitchApplied = 0;

  /** Energía oscilante per-pez (rad). Cada pez tiene su propio período
   *  (8-25 segundos) y phase inicial random — sin patrón sincronizado.
   *  Drives speed: cuando energy es baja (sin valley), el pez nada
   *  más lento como si "descansara". Cuando energy es alta (peak),
   *  burst-like. Transición suave (no on/off). Resultado: cada pez
   *  tiene rachas de actividad y rachas de calma desincronizadas. */
  energyPhase: number = Math.random() * Math.PI * 2;
  /** Frecuencia angular de energyPhase (rad/s). 0.25-0.80 → período
   *  8-25s. Cada pez su propio valor para que las rachas no se
   *  sincronicen entre peces. */
  energyFreq: number = 0.25 + Math.random() * 0.55;

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
  /**
   * Ángulo máximo de bend POR JOINT (gradient rostral→caudal). Cabeza
   * ≈ π/24 (~7.5°, muy rígida — la "cervical region" estabilizada que
   * documenta Nowroozi & Brainerd 2012 para Morone saxatilis). Cola
   * ≈ π/7 (~25°, flexible). Smoothstep entre los dos extremos para que
   * el front 50% del cuerpo se mantenga casi rígido y el bend se
   * acumule en el back 50%. Resultado: pez nada, no serpiente.
   */
  bendLimits: number[] = [];
  /**
   * Turn rate (|dHeading/dt|) suavizado. Drives el "swimGate" —
   * durante turns rápidos (preparatoria del C-start, stage 1 de
   * Domenici & Blake 1997), el wave de propulsión PARA y el cuerpo
   * mantiene la C. Después del turn, el wave reacelera con ease-in
   * (~285ms). Sin esto, la cola sigue ondulando durante el giro fuerte
   * y se ve "deformada" como reportó el usuario.
   */
  smoothedTurnRate = 0;
  /**
   * Gate del swim wave [0..1]. 1 = wave a full amplitude. 0 = wave
   * suprimido (durante C-start stage 1). Versión laggeada con ease-in
   * post-turn para que la wave no haga "pop" instantáneo al volver.
   */
  swimGateLagged = 1;
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

  /** Posición que el pez "MIRA" durante hover. Decoupled del `target`
   *  (que es la posición a la que el cuerpo se mueve). En modo hover el
   *  cuerpo está anclado (target=anchor fijo) pero la cabeza yaw hacia
   *  el cursor — esto es el patrón "predator strike post" de Naughty Dog
   *  AI: el cuerpo queda quieto en su sitio de acecho mientras solo la
   *  cabeza tracking. Fix del bug "target chatter" / "IK popping" cuando
   *  el usuario mueve el cursor rápidamente sobre el pez: el cuerpo no
   *  reacciona porque su target no cambia; la cabeza tracking absorbe
   *  el movimiento a través de un look-target con low-pass de tau ~250ms.
   *  En cruising mode no se usa (el kinematic usa `target` directamente). */
  lookTarget: Vec;

  // Wander state (state machine: cruising → pausing → cruising; usado por applyWander)
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
    // Heading inicial random — sin esto todos los peces arrancarían
    // apuntando a +x (heading=0 por field default) y harían movimiento
    // sincronizado los primeros segundos hasta chocar con orillas.
    this.heading = Math.random() * Math.PI * 2;
    this.prevHeading = this.heading;
    this.orbit = opts.orbit;
    this.target = { x: start.x, y: start.y };
    this.lookTarget = { x: start.x, y: start.y };
    this.wanderTarget = { x: opts.orbit.cx, y: opts.orbit.cy };
    // Init chain — N vértebras alineadas en línea recta detrás de la cabeza
    // (asumiendo heading inicial = facing right). chainJoints[0] está en
    // `start`, joint[i] una distancia (xUnit_diff * size) detrás. Todos los
    // ángulos look-back inician en 0 (apuntan a +x = hacia la cabeza).
    //
    // bendLimits: gradient rostral→caudal con smoothstep biased hacia
    // mantener anterior 50% rígido. Front quedo a π/24 (~7.5°), tail a
    // π/7 (~25°). Ratio ~3× matches Nowroozi & Brainerd data on
    // intervertebral angular stiffness gradient en peces reales.
    {
      const N = GLOW_BODY_PROFILE.length;
      this.chainJoints = new Array(N);
      this.chainAngles = new Array(N).fill(0);
      this.bendLimits = new Array(N);
      const noseX = GLOW_BODY_PROFILE[0][0];
      // ── Stiffness gradient (Spine industry-standard 2D fish rig) ────
      // Hallazgos del research: cabeza rígida = primer 28-33% del cuerpo
      // (un solo "hueso"), bend empieza DETRÁS del opérculo, trunk 12-18°
      // por joint, peduncle 25-35° (donde vive el carangiform whip).
      //
      // GLOW_BODY_PROFILE 13 joints — total xUnit 2.20→-1.55 (3.75 units).
      // El opérculo cae a ~30% desde nariz = xUnit 1.075 ≈ joint 4.
      //   joints 0-3 (xUnit 2.20→1.35, primer 23%): RÍGIDOS — bendLimits=0,
      //     joints[1..3] forzados al ángulo de chainAngles[0]=heading.
      //     Segmento de cabeza unitario que rota como bloque.
      //   joints 4-8 (trunk, 25-50% del cuerpo): 12→18° ramp.
      //   joints 9-12 (peduncle, 50%→tail): 22→35° ramp — donde el wave
      //     carangiform amplifica.
      //
      // Sin esto, joints 1-3 con ~7-8° cada uno sumaban ~25° de bend en
      // la región de cabeza → la nariz se "corría" lateralmente al girar
      // (bug reportado: "la cabeza no es un solo segmento").
      const TRUNK_LIMITS: ReadonlyArray<number> = [
        0,            // i=0: head (no se usa, joint 0 traksea heading)
        0,            // i=1: head — rígido relativo a head
        0,            // i=2: head — rígido
        0,            // i=3: head — rígido (final del bloque cabeza)
        Math.PI / 15, // i=4: ~12° — operculum, trunk start
        Math.PI / 14, // i=5: ~12.9°
        Math.PI / 13, // i=6: ~13.8°
        Math.PI / 12, // i=7: ~15°
        Math.PI / 11, // i=8: ~16.4° — trunk end
        Math.PI / 9,  // i=9: ~20° — peduncle transition
        Math.PI / 7,  // i=10: ~25.7° — peduncle
        Math.PI / 6,  // i=11: ~30°
        Math.PI / 5,  // i=12: ~36° — tail base, max carangiform whip
      ];
      for (let i = 0; i < N; i++) {
        const offsetUnit = noseX - GLOW_BODY_PROFILE[i][0];
        this.chainJoints[i] = { x: start.x - offsetUnit * opts.size, y: start.y };
        this.bendLimits[i] = TRUNK_LIMITS[i] ?? Math.PI / 7;
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
   * Single-pass resolve — port directo de `Chain.pde::resolve` de argonaut,
   * con DOS modificaciones biomecánicas críticas:
   *
   * 1) Head angle = MOTION DIRECTION (this.heading), slew-limited.
   *    NO se ancla al cuerpo (que estaría joint[1]→joint[0]) porque
   *    durante un C-bend, joint[1] queda AL LADO de joint[0] (no detrás)
   *    y la dirección j1→j0 apunta hacia la curva del cuerpo, NO hacia
   *    donde el pez está nadando. Eso hacía que la trompa se viera
   *    "corrida para los lados" durante el giro.
   *
   *    Biomecánicamente correcto: peces reales estabilizan la cabeza en
   *    la dirección de NADO. El cuerpo se curva en C DETRÁS, pero la
   *    cabeza mantiene su orientación en la dirección de movimiento.
   *
   *    Slew limit (HEAD_MAX_TURN_PER_FRAME) se mantiene como defensa por
   *    si this.heading pega un salto edge-case — en práctica heading
   *    rota a max 1 rad/s = 0.95°/frame, muy debajo del slew de 4.5°/frame,
   *    así que no constraint en condiciones normales.
   *
   * 2) bendLimits[i] per-joint en lugar de constante global. Cabeza
   *    rígida (π/24), cola flexible (π/7). Stiffness gradient real
   *    según Nowroozi & Brainerd 2012. Como chainAngles[1] está
   *    constrained a ±bendLimits[1] (~π/24) de chainAngles[0]=heading,
   *    el primer segmento del cuerpo no puede desviarse más de ~7.5°
   *    de la dirección de nado. El bend se acumula gradualmente hacia
   *    la cola.
   */
  private resolveChainStep(newHeadPos: Vec): void {
    const N = this.chainJoints.length;
    // Cabeza salta a la nueva posición (geometría)
    this.chainJoints[0] = { x: newHeadPos.x, y: newHeadPos.y };

    // Head angle tracks motion direction, slew-limited
    const desiredAng = this.heading;
    const HEAD_MAX_TURN_PER_FRAME = (Math.PI / 24) * 0.6;
    const desiredDelta = wrapAngleSigned(desiredAng - this.chainAngles[0]);
    const clampedDelta = Math.max(
      -HEAD_MAX_TURN_PER_FRAME,
      Math.min(HEAD_MAX_TURN_PER_FRAME, desiredDelta),
    );
    this.chainAngles[0] = wrapAngleSigned(this.chainAngles[0] + clampedDelta);

    // Propagación con bendLimits[i] per-joint
    for (let i = 1; i < N; i++) {
      const prev = this.chainJoints[i - 1];
      const cur = this.chainJoints[i];
      const naturalAngle = Math.atan2(prev.y - cur.y, prev.x - cur.x);
      const constrained = constrainAngleArg(naturalAngle, this.chainAngles[i - 1], this.bendLimits[i]);
      this.chainAngles[i] = constrained;
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

    // Energy oscillation per pez — modula speed con período único 8-25s.
    // Avanzamos el phase en CADA frame (hover o cruising) para que no haya
    // saltos de energy al entrar/salir del modo cazador.
    this.energyPhase += _dt * this.energyFreq;
    const oscEnergy = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.energyPhase));
    const energy = this.huntingBoost > 1 ? 1.0 : oscEnergy;

    if (this.isHovering) {
      // ─── STATION-KEEPING MODE ─────────────────────────────────────
      // Drucker & Lauder 1999 (pectoral fin sculling, fish-not-shark
      // hovering), Webb 1984 (pike sit-and-wait predator — no orbital
      // motion, body straight pointing at prey), Bainbridge 1963 (yaw
      // sway de ±2-5° @ 0.5-1.5 Hz que distingue "vivo" de "muerto
      // flotando"). El pez NO usa kinematic bicycle aquí porque la
      // bicycle es forward-only y NO puede parar en sitio — overshoot
      // y orbita inevitable. En su lugar: position lerp hacia target
      // + heading lerp lento + sway + bob + twitch.
      // Vector hacia el position target (anchor, frozen durante hover).
      // El cuerpo se desplaza hacia ahí pero MUY lentamente — el anchor
      // se setea al inicio del hover en la posición del pez, así que
      // dxh/dyh suelen ser ~0 y la posición queda lockeada.
      const dxh = this.target.x - this.position.x;
      const dyh = this.target.y - this.position.y;

      // Vector hacia el lookTarget (cursor smoothed, separado del target
      // de cuerpo). Esto es lo que usa el heading lerp — la cabeza
      // tracking el cursor mientras el cuerpo queda quieto.
      const lookDx = this.lookTarget.x - this.position.x;
      const lookDy = this.lookTarget.y - this.position.y;
      const lookDist = Math.hypot(lookDx, lookDy);

      // 1) Heading lerp — pez "gira la cabeza" hacia el lookTarget a rate
      //    PROPORCIONAL a la distancia. Cuando el lookTarget está casi
      //    encima (lookDist < 30 px), el rate baja → no spin sobre el eje
      //    aunque el cursor wobblee un píxel.
      //
      //    Deadband 3 px: el bob vertical aplica un offset de ±1.5 px a
      //    position.y cada frame; con deadband de 0.5 px el lerp se
      //    disparaba intentando "mirar el bob" y acumulaba drift que
      //    después de 2-3s producía giro sobre el eje. Con 3 px el bob
      //    queda en zona muerta y solo movimientos reales del cursor
      //    disparan rotación.
      if (lookDist > 3) {
        const targetAngle = Math.atan2(lookDy, lookDx);
        let diff = targetAngle - this.heading;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        const rate = 0.4 * Math.min(1, lookDist / 30);
        const turn = Math.sign(diff) * Math.min(Math.abs(diff), rate * _dt);
        this.heading += turn;
      }

      // 2) Yaw sway ±3° @ 0.8 Hz (Bainbridge 1963). Aplicado como delta
      //    sobre el heading; trackeamos cumulativo para poder restaurar
      //    al salir.
      this.hoverYawPhase += _dt * 0.8 * 2 * Math.PI;
      const yawTarget = Math.sin(this.hoverYawPhase) * 0.052; // ±3° en rad
      this.heading += (yawTarget - this.hoverYawApplied);
      this.hoverYawApplied = yawTarget;

      // 3) Twitch ocasional de re-fixación (Webb 1984). Cada 2-5s un
      //    flick de ±10° por 150ms, luego vuelve. Esto rompe la
      //    estaticidad y lee como "el pez está mirando otra cosa por
      //    un segundo, vuelve a fijar".
      if (this.hoverTwitchRemaining > 0) {
        this.hoverTwitchRemaining -= _dt;
        if (this.hoverTwitchRemaining <= 0) {
          this.heading -= this.hoverTwitchApplied;
          this.hoverTwitchApplied = 0;
          this.hoverTwitchCooldown = 2 + Math.random() * 3;
        }
      } else if (this.hoverTwitchCooldown > 0) {
        this.hoverTwitchCooldown -= _dt;
      } else {
        this.hoverTwitchApplied = (Math.random() < 0.5 ? -1 : 1) * 0.175;
        this.heading += this.hoverTwitchApplied;
        this.hoverTwitchRemaining = 0.15;
      }

      // 4) Position lerp hacia target — tau ~0.4s. El pez "flota" hacia
      //    su posición de espera, no teleport, no overshoot.
      const posLerp = Math.min(1, _dt * 2.5);
      this.position.x += dxh * posLerp;
      this.position.y += dyh * posLerp;

      // 5) Vertical micro-bob ±1.5px @ 0.5 Hz (gill rhythm). CRÍTICO
      //    para que no parezca pez muerto flotando.
      this.hoverBobPhase += _dt * 0.5 * 2 * Math.PI;
      const bobTarget = Math.sin(this.hoverBobPhase) * 1.5;
      this.position.y += (bobTarget - this.hoverBobApplied);
      this.hoverBobApplied = bobTarget;

      // 6) currentSpeed bajo (no cero) → tail wave sigue sutilmente
      //    activo, no congelado. Drucker & Lauder hover regime: tail
      //    flicks a ~0.4 Hz.
      this.currentSpeed = 0.3;

      this.velocity.x = this.position.x - this.prevPos.x;
      this.velocity.y = this.position.y - this.prevPos.y;
      this.speed = Math.hypot(this.velocity.x, this.velocity.y);
    } else {
      // ─── CRUISING MODE (kinematic bicycle / Dubins forward-only) ──
      // Si veníamos de hover, deshacer los offsets cumulativos para
      // que no quede drift residual de sway/twitch/bob al volver a
      // cruising.
      if (this.hoverYawApplied !== 0 || this.hoverTwitchApplied !== 0 || this.hoverBobApplied !== 0) {
        this.heading -= this.hoverYawApplied;
        this.heading -= this.hoverTwitchApplied;
        this.position.y -= this.hoverBobApplied;
        this.hoverYawApplied = 0;
        this.hoverTwitchApplied = 0;
        this.hoverBobApplied = 0;
        this.hoverTwitchRemaining = 0;
        this.hoverTwitchCooldown = 2 + Math.random() * 3;
      }

      const dx = this.target.x - this.position.x;
      const dy = this.target.y - this.position.y;
      const dist = Math.hypot(dx, dy);

      // 1) Steering — heading bounded turn rate hacia target.
      let alignment = 1;
      if (dist > 0.5) {
        const targetAngle = Math.atan2(dy, dx);
        let diff = targetAngle - this.heading;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        const turn = Math.sign(diff) * Math.min(Math.abs(diff), 2.0 * _dt);
        this.heading += turn;
        alignment = Math.cos(diff);
      }

      // 2) Forward speed FUERTEMENTE GATEADO por alignment.
      //
      // Principio: la velocidad solo se construye cuando el pez está
      // orientado hacia el target. Si el target está en el hemisferio
      // trasero (alignment < 0), targetSpeed → 0 y el pez pivota tranquilo
      // en su sitio mientras el heading rota hacia el cursor. Una vez
      // alineado, acelera.
      //
      // Sin este gate, alignment=-0.5 daba speedFactor01=0.25 y el pez
      // se arrastraba hacia atrás "en C como camarón" cuando el cursor
      // se movía detrás suyo. También causaba colisiones con bordes a
      // alta velocidad porque mantenía momentum durante el U-turn → se
      // estampaba contra orillas. Real biomechanics de pez en yaw turn:
      // primero brake, luego pivot con pectorales (Drucker & Lauder),
      // luego accelerate cuando aligned.
      //
      // minSpeed = 0 (no floor) → el pez efectivamente puede pararse.
      // speedFactor01 = max(0, alignment) → no aporta speed con target
      // detrás. Combinado con lerp rápido (k=5) cuando alignment<0, la
      // velocidad se disipa en ~200ms al cambiar de alineado a desalineado.
      const minSpeed = 0;
      const maxSpeed = 3.6 * this.speedScale * depthFactor * energy * this.huntingBoost;
      const speedFactor01 = Math.max(0, alignment);
      const turnDamping = Math.min(0.25, Math.abs(this.angularVel) * 0.20);
      let targetSpeed = (minSpeed + (maxSpeed - minSpeed) * speedFactor01) * (1 - turnDamping);

      // 2b) Proximity brake adaptativo. El radio escala con currentSpeed
      //     porque un pez yendo a 20 px/frame necesita más runway para
      //     decelerar naturalmente que uno yendo a 4 px/frame — fix del
      //     bug "frena en seco" cuando llegaba rápido al cursor. Curva
      //     pow 0.7: gradual al inicio del brake zone, más fuerte cerca
      //     del target.
      //
      //     Solo aplica con alignment > 0.5 — el gating de speed ya se
      //     encarga del caso target-detrás (targetSpeed=0).
      const brakeRadius = Math.max(80, this.currentSpeed * 20);
      const brakeActive = dist < brakeRadius && alignment > 0.5;
      if (brakeActive) {
        const brakeT = dist / brakeRadius;
        const brakeFactor = 0.05 + 0.95 * Math.pow(brakeT, 0.7);
        targetSpeed *= brakeFactor;
      }

      // lerpRate: 6 dentro del brake (tau ~170ms para decelerar a tiempo).
      //   5 cuando alignment < 0 (target detrás) → tau ~200ms para que
      //     el pez DISIPE la velocidad rápido y pivote en sitio en lugar
      //     de arrastrarse curvado. Esto fix el "camarón" y también las
      //     colisiones con bordes a alta velocidad.
      //   2 default (tau ~500ms) para la aceleración natural en chase.
      const lerpRate = brakeActive ? 6 : (alignment < 0 ? 5 : 2);
      this.currentSpeed += (targetSpeed - this.currentSpeed) * Math.min(1, _dt * lerpRate);

      // 3) Integra currentSpeed (con inercia) en heading direction.
      const vx = Math.cos(this.heading) * this.currentSpeed;
      const vy = Math.sin(this.heading) * this.currentSpeed;
      this.position.x += vx * _dt * 60;
      this.position.y += vy * _dt * 60;

      this.velocity.x = this.position.x - this.prevPos.x;
      this.velocity.y = this.position.y - this.prevPos.y;
      this.speed = Math.hypot(this.velocity.x, this.velocity.y);
    }

    // ─── Física natural ──────────────────────────────────────────────
    // 1) Velocidad angular smoothed (para eye saccade). Diff de heading
    //    normalizado a [-π, π], con lerp para evitar spikes.
    let headingDelta = this.heading - this.prevHeading;
    while (headingDelta > Math.PI) headingDelta -= 2 * Math.PI;
    while (headingDelta < -Math.PI) headingDelta += 2 * Math.PI;
    const rawAngVel = headingDelta / Math.max(_dt, 1e-6);
    this.angularVel = this.angularVel * 0.85 + rawAngVel * 0.15;
    this.prevHeading = this.heading;

    // 1b) Smoothed turn rate (rad/s, magnitud) → swim gate. Cuando el
    //     pez gira fuerte (preparatoria del C-start), la wave de
    //     propulsión PARA y el cuerpo mantiene la C. Después, ease-in
    //     ~285ms para reacelerar. Domenici & Blake 1997.
    const rawTurnRate = Math.abs(rawAngVel);
    this.smoothedTurnRate = this.smoothedTurnRate * 0.80 + rawTurnRate * 0.20;
    // smoothstep(1.5, 2.5): por debajo de 1.5 rad/s wave full; arriba
    // de 2.5 rad/s wave totalmente suprimido. Re-escalado al nuevo
    // maxTurnRate=2.0 — los turns "fuertes" llegan a ~2.0 rad/s y
    // activan el gate. Los turns suaves no.
    const TURN_GATE_LO = 1.5;
    const TURN_GATE_HI = 2.5;
    let swimGate = 1.0;
    if (this.smoothedTurnRate >= TURN_GATE_HI) swimGate = 0;
    else if (this.smoothedTurnRate > TURN_GATE_LO) {
      const t = (this.smoothedTurnRate - TURN_GATE_LO) / (TURN_GATE_HI - TURN_GATE_LO);
      swimGate = 1 - (t * t * (3 - 2 * t)); // smoothstep
    }
    // Lagged version: cae INSTANTÁNEO (acompaña el inicio del turn) pero
    // sube con ease-in (∼285ms para volver a 1.0). Reproduce stage 3 del
    // C-start: fase post-snap donde el wave reacelera gradualmente.
    if (swimGate < this.swimGateLagged) {
      this.swimGateLagged = swimGate; // instant fall
    } else {
      this.swimGateLagged = Math.min(swimGate, this.swimGateLagged + _dt * 3.5);
    }

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
    //
    // En modo hover (station-keeping), el pez NO se traslada pero el
    // usuario quiere que SE VEA NADANDO en el sitio — como "remando
    // contra corriente". Forzamos bodyEffort=0.6 (cruising sostenido)
    // → cola ondula a ~0.64 Hz con amplitud visible. La posición sigue
    // lockeada por el position-lerp del hover branch, así que el pez
    // se queda donde está pero con la animación completa de nado.
    const targetBodyEffort = this.isHovering
      ? 0.6
      : Math.min(1, this.speed / 1.5);
    this.bodyEffort += (targetBodyEffort - this.bodyEffort) * Math.min(1, _dt * 4);
    // Rhythm jitter — variación lenta natural del omega (~±8%) usando
    // un sin de baja frecuencia desfasado por instancia (swimPhase es
    // único por pez, así que cada uno tiene su propio "carácter rítmico").
    // Resultado: ratos late más fuerte/débil sin patrón mecánico.
    const rhythmVar = 1 + Math.sin(this.swimPhase * 0.13) * 0.08;
    const swimOmega = (1.0 + 5.0 * this.bodyEffort) * rhythmVar;
    // Solo avanzar swimPhase cuando la wave NO está suprimida. Si está
    // suprimida (giro fuerte), congelar el phase → cuando vuelve, el
    // wave reaparece coherente sin frequency-shift visible.
    if (this.swimGateLagged > 0.3) {
      this.swimPhase += _dt * swimOmega;
    }

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

    // ─── Master params para behavior coupling de aletas ──────────────
    // Computados una sola vez por frame, drivean todas las aletas:
    //   • speed01:   0 idle → 1 cruise. Erect/depress de dorsal+pélvica.
    //   • idle01:    inverso. Max area cuando casi parado.
    //   • turning:   signed [-1,+1] yaw rate. Asimetría pectoral.
    //   • braking:   0 normal → 1 decel/aducting. Cup-forward pectoral.
    //   • hovering:  1 si isHovering. X-pattern scull (Fase 3).
    //
    // Refs research: Drucker & Lauder 2003 (pectoral inside/outside
    // asymmetry en turns), Lauder bluegill JEB 2001 (spinous dorsal
    // collapses a >0.5 BL/s), Standen 2005 (pelvic fan en braking).
    const speed01 = speedFactor;
    const idle01 = 1 - speed01;
    const turning = Math.max(-1, Math.min(1, this.angularVel * 2.5));
    const braking = Math.min(1,
      (this.isHovering ? 0.7 : 0) +
      Math.max(0, 1 - this.swimGateLagged) * 0.6,
    );
    const hovering = this.isHovering ? 1 : 0;

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
    // ADEMÁS escala con swimGateLagged → durante turns fuertes, la wave
    // de propulsión se atenúa hasta cero (C-start stage 1 — Domenici
    // & Blake 1997). Reproduce: pez para de mover la cola para hacer
    // la C cleanly, después reacelera con ease-in.
    const viewAmpBoost = 1 + 0.7 * viewMorph;
    const ampPx = s * (0.04 + 0.18 * this.bodyEffort) * viewAmpBoost * this.swimGateLagged;
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
    //
    // Envelope = u^GLOW_WAVE_ENV_POWER (default 3.0) — concentra el
    // movimiento en el tercio posterior del cuerpo = carangiform real
    // (no anguilliform/serpiente). Di Santo 2021: head:tail amp ratio
    // ~1:6 en peces típicos, lo que requiere envelope agresivo.
    const waveAt = (xUnit: number): number => {
      const u = (xNoseUnit - xUnit) / bodyLenUnit; // 0 head → 1 tail
      const env = Math.pow(Math.max(0, u), GLOW_WAVE_ENV_POWER);
      return env * ampPx * Math.sin(this.swimPhase + k * xUnit);
    };

    // ─── chainAt — interpola posición + ángulo entre vértebras ────────
    // Para cada xUnit del BODY_PROFILE (no uniforme), encuentra el chain
    // segment que lo contiene y devuelve la posición LOCAL (relativa al
    // head, en world axes — no rotada), el world look-back angle, y el
    // localBend (magnitud de la diferencia angular entre joints adyacentes,
    // en radianes). El localBend drives el width-reduction adaptivo en
    // mapToSpine para evitar self-intersection del silhouette en bend
    // alto (problema "media luna" / cuerpo grueso al hacer C).
    const headW = this.chainJoints[0];
    const chainAt = (xUnit: number): { lx: number; ly: number; ang: number; localBend: number } => {
      const noseX = GLOW_BODY_PROFILE[0][0];
      const tailX = GLOW_BODY_PROFILE[N - 1][0];
      // Beyond head (xUnit > nose) — extrapolate forward
      if (xUnit >= noseX) {
        const j = this.chainJoints[0];
        const a = this.chainAngles[0];
        const offsetPx = (xUnit - noseX) * this.size;
        // localBend en la cabeza: diferencia con el segundo joint (mide
        // qué tanto está doblada la cervical region — siempre baja por
        // bendLimits[1] muy restrictivo).
        let dab = this.chainAngles[1] - this.chainAngles[0];
        if (dab > Math.PI) dab -= Math.PI * 2;
        if (dab < -Math.PI) dab += Math.PI * 2;
        return {
          lx: (j.x - headW.x) + Math.cos(a) * offsetPx,
          ly: (j.y - headW.y) + Math.sin(a) * offsetPx,
          ang: a,
          localBend: Math.abs(dab),
        };
      }
      // Beyond tail (xUnit < tail) — extrapolate backward
      if (xUnit <= tailX) {
        const j = this.chainJoints[N - 1];
        const a = this.chainAngles[N - 1];
        const offsetPx = (tailX - xUnit) * this.size;
        let dab = this.chainAngles[N - 1] - this.chainAngles[N - 2];
        if (dab > Math.PI) dab -= Math.PI * 2;
        if (dab < -Math.PI) dab += Math.PI * 2;
        return {
          lx: (j.x - headW.x) - Math.cos(a) * offsetPx,
          ly: (j.y - headW.y) - Math.sin(a) * offsetPx,
          ang: a,
          localBend: Math.abs(dab),
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
          let da = this.chainAngles[i + 1] - this.chainAngles[i];
          if (da > Math.PI) da -= Math.PI * 2;
          if (da < -Math.PI) da += Math.PI * 2;
          const ang = this.chainAngles[i] + da * t;
          return {
            lx: (j0.x - headW.x) + ((j1.x - j0.x)) * t,
            ly: (j0.y - headW.y) + ((j1.y - j0.y)) * t,
            ang,
            localBend: Math.abs(da),
          };
        }
      }
      // Fallback (shouldn't reach)
      const j = this.chainJoints[N - 1];
      return { lx: j.x - headW.x, ly: j.y - headW.y, ang: this.chainAngles[N - 1], localBend: 0 };
    };

    // ─── mapToSpine — pos + cross-section + wave en world frame ─────
    // Devuelve coords LOCAL al head pero en EJES MUNDO (no hay rotate del
    // ctx). yUnit signed: NEG = back/joroba, POS = belly. Wave es lateral
    // (perp al spine), no se invierte con dorsalSide para que oscile en
    // body-frame consistente. La perpendicular del cross-section SÍ se
    // invierte con dorsalSide (mantiene joroba arriba visualmente cuando
    // el pez gira pasado vertical).
    //
    // ADAPTIVE WIDTH REDUCTION (anti-balloon en C-bend):
    //   widthScale = 1 - 0.55 * clamp(localBend / (π/4), 0, 1)
    //   Cuando el bend local es 0 (cuerpo recto), widthScale=1 (full width).
    //   Cuando llega a π/4 (45°) o más, widthScale=0.45 (45% del width).
    //   Mata la self-intersection en el lado interior del C — el cuerpo
    //   se ve slender/crescent en lugar de "media luna gorda" (Tytell &
    //   Lauder 2008 PIV photos: real fish en C son slender crescents).
    //   Coeficiente k=0.55 confirmado por Spine + ABZÛ GDC 2017.
    //   Solo aplica al cross-section (yUnit), NO al wave (que es independiente).
    const mapToSpine = (xUnit: number, yUnitSigned: number): Vec => {
      const c = chainAt(xUnit);
      const sinA = Math.sin(c.ang);
      const cosA = Math.cos(c.ang);
      // Width reduction adaptiva según localBend (Jacobson 2011 / Spine docs)
      const bendNorm = Math.min(1, c.localBend / (Math.PI / 4));
      const widthScale = 1 - 0.55 * bendNorm;
      const yUnitPx = yUnitSigned * s * this.dorsalSide * widthScale;
      const wavePx = waveAt(xUnit);
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

    // ─── 2) Body silhouette path (compartido por fill + 3-pass edge) ──
    ctx.beginPath();
    ctx.moveTo(topPts[0].x, topPts[0].y); // nariz
    smoothPath(topPts);
    ctx.lineTo(botPts[N - 1].x, botPts[N - 1].y);
    const botReversed: Vec[] = [];
    for (let i = N - 1; i >= 0; i--) botReversed.push(botPts[i]);
    smoothPath(botReversed);
    ctx.closePath();

    // ─── 2a) Counter-shading body fill (Pixar Finding Dory pattern) ───
    // Two-pass fill para que el counter-shading siga al ventral REAL
    // del pez (no al screen-bottom) y la transición durante el dorsalSide
    // flip sea SUAVE en vez de brincar:
    //
    //   Pass 1: cuerpo opaco con color sólido del palette. Siempre.
    //   Pass 2: gradient dorsal→ventral on top con globalAlpha = (1-m).
    //     m = sin²(heading), 0 en lateral, 1 en vertical.
    //
    // El dorsalSide flipea EXACTAMENTE cuando heading cruza la vertical
    // (cosH=0 → m=1). En ese momento el gradient está al alpha=0 →
    // invisible → el flip es geométricamente invisible. Cuando el pez
    // sale de vertical (m baja), el gradient fade-in en el lado correcto
    // (ventral REAL del pez, ya en su nueva orientación).
    //
    // Esto garantiza:
    //   • Vientre blanco siempre del lado del ventral biológico ✓
    //   • Transición continua al girar (no brinco) ✓
    //   • En vista vertical el cuerpo se ve flat (sin pseudo-counter-
    //     shading screen-vertical que daba "pez de cabeza blanca" o
    //     "pez de cola blanca" según hacia dónde apuntaba)
    let dx0 = 0, dy0 = 0, vx0 = 0, vy0 = 0;
    for (let i = 4; i <= 7; i++) {
      dx0 += topPts[i].x; dy0 += topPts[i].y;
      vx0 += botPts[i].x; vy0 += botPts[i].y;
    }
    dx0 /= 4; dy0 /= 4; vx0 /= 4; vy0 /= 4;

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';

    // Pass 1: solid body color base (siempre opaco)
    ctx.fillStyle = this.color.body;
    ctx.fill();

    // Pass 2: counter-shading gradient on top, fadea con viewMorph
    const csAlpha = (1 - m);
    if (csAlpha > 0.02) {
      const csGrad = ctx.createLinearGradient(dx0, dy0, vx0, vy0);
      csGrad.addColorStop(0, hexA('#020610', csAlpha));
      csGrad.addColorStop(0.45, hexA(this.color.body, 0)); // mid transparente para blend con base
      csGrad.addColorStop(1, hexA('#dde6ff', csAlpha));
      ctx.fillStyle = csGrad;
      ctx.fill();
    }

    // ─── 2b) 3-pass edge treatment (Phosphor "engraved" look) ────────
    // Tres strokes layered sobre el mismo path para obtener depth en el
    // borde sin hard cartoon outline:
    //   Pass 1: halo exterior — stroke ancho con rim color en additive
    //           (lighter), 30% alpha. Crea el "glow envelope".
    //   Pass 2: línea principal — stroke fino oscuro source-over, 95%
    //           alpha. La "línea negra" que da definición a la silueta.
    //   Pass 3: highlight interior — stroke muy fino blanco source-over,
    //           22% alpha. Sugiere "reflejo del agua" sobre el dorsal.
    // Pass 1 va antes en additive; pass 2 y 3 en source-over para que
    // los colores oscuros y claros se vean reales (no se aditivan).

    // Pass 1 — outer halo (additive). TIGHTENED de 0.18 → 0.08 para
    // que el halo no bleed lejos del silhouette. Antes el halo wide
    // hacía que el pez se viera "borroso, sin definición" (reportado
    // por el usuario). Con halo angosto el silhouette queda crisp y
    // el glow envelope sigue presente pero contenido.
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = hexA(this.color.rim, 0.35 + boost * 0.15);
    ctx.lineWidth = Math.max(1.0, s * 0.08);
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Pass 2 — main edge (dark, source-over). Línea dura de definición.
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = hexA('#020610', 0.95);
    ctx.lineWidth = Math.max(0.5, s * 0.06);
    ctx.stroke();

    // Pass 3 — inner highlight (white, source-over). Refleja "luz del
    // agua" sobre el dorsal.
    ctx.strokeStyle = hexA('#ffffff', 0.22);
    ctx.lineWidth = Math.max(0.3, s * 0.03);
    ctx.stroke();

    ctx.restore(); // restaura globalCompositeOperation a 'lighter' del padre

    // ─── 2c) Lateral line (anatomical detail tipo Audubon ichthyology) ──
    // Single 0.5-1px stroke a lo largo del flanco del pez, en yU 0.05
    // (~55% de altura corporal medida desde dorsal = línea lateral
    // anatómica). Color = rim del palette pero alpha bajísimo (0.18-0.22)
    // para que sea sutil — se nota como detalle pero no compite con el
    // counter-shading. Solo side view (m bajo) — en top view la línea
    // lateral no es visible.
    const lateralLineAlpha = (1 - m) * 0.22;
    if (lateralLineAlpha > 0.02) {
      const llStart = mapToSpine(1.40, 0.05);
      const llXs = [1.40, 0.80, 0.20, -0.40, -0.95, -1.30];
      const llPts = llXs.map(x => mapToSpine(x, 0.05));
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = lateralLineAlpha;
      ctx.strokeStyle = this.color.rim;
      ctx.lineWidth = Math.max(0.4, s * 0.04);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(llStart.x, llStart.y);
      smoothPath(llPts);
      ctx.stroke();
      ctx.restore();
    }


    // ─── 3.5) Línea del opérculo (branquia) — solo side view ─────────
    // Curva única que separa cabeza de tronco a xUnit ≈ 0.95 (limite del
    // bloque de cabeza rígida en TRUNK_LIMITS). Es el detalle anatómico
    // más universal para que algo lea como "pez vivo" — todos los teleos
    // tienen este arco visible. Stroked tenue (alpha 0.45) para no
    // competir con el rim. Fade con (1-m)² porque en top view la cabeza
    // se ve desde arriba y el opérculo ya no aplica.
    const operculumAlpha = (1 - m) * (1 - m);
    if (operculumAlpha > 0.02) {
      const opXU = 1.00; // anatomical operculum boundary
      const opTop = mapToSpine(opXU, -0.55); // dorsal side
      const opMid = mapToSpine(opXU - 0.10, 0); // bulge inward (curva característica)
      const opBot = mapToSpine(opXU, 0.30);  // ventral side
      ctx.save();
      ctx.globalAlpha = operculumAlpha;
      // Alpha bumpeado a 0.95 y stroke más grueso — bajo additive blending
      // ('lighter' composite del ctx padre), el rim color a 0.50 alpha
      // se difumina con el body underneath y la línea no se notaba.
      // 0.95 + stroke 0.07s la hace claramente visible como gill cover.
      ctx.strokeStyle = hexA(this.color.rim, 0.95);
      ctx.lineWidth = Math.max(0.55, s * 0.07);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(opTop.x, opTop.y);
      ctx.quadraticCurveTo(opMid.x, opMid.y, opBot.x, opBot.y);
      ctx.stroke();
      ctx.restore();
    }

    // ─── 3.6) Head bioluminescence — broad distributed warmth ────────
    // Reemplaza el "lure organ" puntual (xU=0.85) que el usuario
    // reportó como "carros con luces prendidas" por una warmth amplia
    // y distribuida sobre toda la masa craneal. El glow se centra en
    // el cráneo (xU=1.00, yU=0) y se extiende casi al doble del
    // ancho corporal en cada eje, repartiendo la luz en vez de
    // concentrarla. Alphas mínimos (0.06 / 0.035) — la criatura lee
    // como bioluminiscente por la mancha entera de la cabeza, no
    // como un faro ni dos. Quedan sin brillar puntos identificables.
    //
    // Ref: ilustraciones de lanternfish/myctophidae premium donde la
    // luz es niebla distribuida bajo la piel translúcida.
    if (operculumAlpha > 0.02) {
      const headCenter = mapToSpine(1.00, 0);
      const headR = Math.max(4, s * 0.85);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = operculumAlpha;
      const headGlow = ctx.createRadialGradient(
        headCenter.x, headCenter.y, 0,
        headCenter.x, headCenter.y, headR,
      );
      headGlow.addColorStop(0,    hexA(this.color.halo, 0.06));
      headGlow.addColorStop(0.45, hexA(this.color.halo, 0.035));
      headGlow.addColorStop(1,    hexA(this.color.halo, 0));
      ctx.fillStyle = headGlow;
      ctx.beginPath();
      ctx.arc(headCenter.x, headCenter.y, headR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ─── 4) Ojos morpheados — anatomía clara (iris + pupila + reflejo) ──
    // Posición xUnit 1.30 ≈ 24% desde la nariz → cae en upper-third de
    // la cabeza (regla iconográfica: 18-22% desde snout). En side view
    // (m=0) ambos ojos overlap en yUnit=-0.30 (upper third de la cabeza,
    // antes era yUnit=0 = centerline ⇒ ojo "centrado" se veía menos pez);
    // en top view (m=1) se separan a ±0.22 mirror. Anatomía real: iris
    // (color rim, 60% del eye), pupila oscura (body color, 35%), reflejo
    // chico (highlight). Quitamos el blob blanco-azul radial enorme
    // que el usuario reportó como "ojo claro irreal".
    const eyeR = s * 0.16;             // diámetro ~32% body unit (era 0.44)
    const eyeθGlobal = tangentAt(1.30);
    const saccadeMag = -this.angularVel * s * 0.04;
    for (const eyeSign of [-1, +1]) {
      // Side view: eye en upper-third. Top view: separados horizontalmente.
      const eyeYU = morphY(-0.30, eyeSign * 0.22);
      const eyeBase = mapToSpine(1.30, eyeYU);
      const ex = eyeBase.x - Math.sin(eyeθGlobal) * saccadeMag;
      const ey = eyeBase.y + Math.cos(eyeθGlobal) * saccadeMag;

      // Eye stack 5 capas (Pixar dual-highlight pattern):
      //   1) Socket shadow ring → marca el "hueco" del ojo en el cráneo
      //   2) Iris radial gradient
      //   3) Pupila vertical-oval (no round) — peces tienen pupila ligeramente
      //      vertical-elíptica, no circular perfecta
      //   4) Catchlight 11 o'clock (reflejo principal)
      //   5) Cornea sheen — crescent arc en el back-bottom del ojo (segunda
      //      luz de la córnea curva, vende la "esfera mojada")

      // Capa 1 — Socket shadow ring (anillo oscuro 1px afuera del iris)
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = hexA('#020610', 0.55);
      ctx.beginPath();
      ctx.arc(ex, ey, eyeR * 1.20, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Capa 2 — Iris ANATÓMICO (source-over, no additive). Antes era
      // radial gradient bajo el composite 'lighter' del padre →
      // creaba un disco glowing que se leía como "faro". Ahora es un
      // disco de color iris (cyan/teal del rim) con sutil radial
      // darker-toward-pupil → ojo realista con iris pigmentado, no luz.
      // Patrón opuesto al glow: oscuro al centro (cerca de la pupila)
      // y rim del iris más claro — exactamente como un iris real bajo
      // luz frontal.
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      const iris = ctx.createRadialGradient(ex, ey, 0, ex, ey, eyeR * 0.95);
      iris.addColorStop(0,    hexA(this.color.core, 0.85)); // darker hacia pupila
      iris.addColorStop(0.55, hexA(this.color.rim, 0.75));  // mid: color del iris
      iris.addColorStop(1,    hexA(this.color.rim, 0.55));  // edge: ligero fade al socket
      ctx.fillStyle = iris;
      ctx.beginPath();
      ctx.arc(ex, ey, eyeR * 0.95, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Capa 3 — Pupila vertical-oval. Real fish pupils son ligeramente
      // verticales, no circulares perfectas. ry = 1.15 * rx → oval sutil.
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = hexA('#020610', 0.92);
      ctx.beginPath();
      ctx.ellipse(ex, ey, eyeR * 0.45, eyeR * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Capa 4 — Catchlight (11 o'clock). Alpha reducido (0.92→0.60) y
      // tamaño chico para que sea un destello sutil de "ojo vivo", no
      // un reflejo de faro.
      ctx.fillStyle = hexA('#ffffff', 0.60);
      ctx.beginPath();
      ctx.arc(ex - eyeR * 0.20, ey - eyeR * 0.22, eyeR * 0.13, 0, Math.PI * 2);
      ctx.fill();

      // Capa 5 — Cornea sheen (crescent arc en el lower-back del ojo).
      // Alpha reducido (0.30→0.18) — sigue presente como sutileza pero
      // no agrega al ruido lumínico de la cabeza.
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = hexA('#ffffff', 0.18);
      ctx.lineWidth = Math.max(0.3, eyeR * 0.10);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(ex, ey, eyeR * 0.85, Math.PI * 0.15, Math.PI * 0.55);
      ctx.stroke();
      ctx.restore();
    }

    // ─── 5) Dorsal fins — bipartite (spinous + soft) acantomorfo ─────
    // Reemplaza el dorsal-triángulo-único anterior (que research flag
    // como "dibujo infantil de tiburón"). Los acantomorfos perciformes
    // tienen dorsal BIPARTITA:
    //   • 5a) Spinous dorsal (anterior, xU +0.55 → -0.05): vela rígida,
    //         rayos no segmentados hard, leading edge convex hacia
    //         arriba. Apex sail-like en xU +0.20.
    //   • 5b) Soft dorsal (posterior, xU -0.05 → -0.85): trapezoidal/
    //         redondeada, rayos segmentados flexibles, peak en xU -0.40.
    // Fade con (1-m)² porque ambas son features dorsal-midline (en top
    // view se ven como stripe central, ya cubierto por el spine glow).
    //
    // Fase 1: posiciones anatómicas + membranas + rays + biolum trailing.
    // Fase 2 añadirá erect/depress dinámico con speed.
    // Fase 3 añadirá body-wave coupling para wag más anatómico.
    const dorsalAlpha = (1 - m) * (1 - m);
    if (dorsalAlpha > 0.02) {
      ctx.save();
      ctx.globalAlpha = dorsalAlpha;

      // ── 5a) SPINOUS DORSAL (vela rígida, leading-convex) ──────────
      // Sail-like outline: leading-base, apex (alto), trailing-tip,
      // trailing-base. Wag mínimo (rayos espinosos = rígidos, casi sin
      // movimiento — solo trim sutil con el body wave).
      //
      // ERECT/DEPRESS dinámico (Lauder bluegill JEB 2001): a velocidad
      // cruise (>0.5 BL/s) el spinous dorsal se PLIEGA contra el lomo
      // por hidrodinámica. spErect lerpa la altura de apex de full
      // sail (1.0 idle) a colapsada (~0.30 cruise). Las deviations
      // de los rayos también escalan → toda la vela colapsa coherente.
      const spErect = 1 - speed01 * 0.70;
      const spBaseY = -0.62;
      const spWag = Math.sin(this.finPhase * 0.7) * s * 0.020 * spErect;
      const spLeadBase = mapToSpine(0.55, spBaseY);
      const spApex = mapToSpine(0.20, spBaseY - 0.46 * spErect);
      const spTrailTip = mapToSpine(-0.05, spBaseY - 0.16 * spErect);
      const spTrailBase = mapToSpine(-0.05, -0.55);
      const spθ = tangentAt(0.20);
      const spApexX = spApex.x + Math.cos(spθ) * spWag;
      const spApexY = spApex.y + Math.sin(spθ) * spWag;

      ctx.beginPath();
      ctx.moveTo(spLeadBase.x, spLeadBase.y);
      // Leading edge: convex up arc desde leading-base al apex
      const spLeadMid = mapToSpine(0.40, spBaseY - 0.33 * spErect);
      ctx.quadraticCurveTo(spLeadMid.x, spLeadMid.y, spApexX, spApexY);
      // Trailing edge: línea recta del apex al trailing-tip
      ctx.lineTo(spTrailTip.x, spTrailTip.y);
      ctx.lineTo(spTrailBase.x, spTrailBase.y);
      ctx.closePath();

      const spBaseMid = {
        x: (spLeadBase.x + spTrailBase.x) * 0.5,
        y: (spLeadBase.y + spTrailBase.y) * 0.5,
      };
      const spRadius = Math.hypot(spApexX - spBaseMid.x, spApexY - spBaseMid.y);
      const spGrad = ctx.createRadialGradient(
        spBaseMid.x, spBaseMid.y, 0,
        spBaseMid.x, spBaseMid.y, spRadius,
      );
      // AO base shadow (stop 0) → main fill → fade. La aleta lee como
      // "saliendo de un crease oscuro" en su attachment al body, no
      // flotando encima.
      spGrad.addColorStop(0,    hexA('#020610', 0.30));
      spGrad.addColorStop(0.15, hexA(this.color.body, 0.50));
      spGrad.addColorStop(0.70, hexA(this.color.body, 0.20));
      spGrad.addColorStop(1,    hexA(this.color.body, 0.05));
      ctx.fillStyle = spGrad;
      ctx.fill();

      // Spinous rays (3) — líneas RECTAS de base a apex, suggesting
      // las espinas óseas no segmentadas. Bunching toward leading edge
      // (real spinous rays no van uniformemente espaciados).
      // Rays escalan con spErect (cuando la vela colapsa, los spines
      // se pliegan contra el lomo y las líneas se acortan coherente).
      ctx.strokeStyle = hexA(this.color.rim, 0.40);
      ctx.lineWidth = Math.max(0.18, s * 0.024);
      ctx.lineCap = 'round';
      const spRayDefs: Array<[number, number]> = [
        [0.45, -0.33],
        [0.30, -0.40],
        [0.10, -0.33],
      ];
      for (const [rxU, rDevYU] of spRayDefs) {
        const rb = mapToSpine(rxU, -0.60);
        const rt = mapToSpine(rxU, -0.60 + rDevYU * spErect);
        ctx.beginPath();
        ctx.moveTo(rb.x, rb.y);
        ctx.lineTo(rt.x, rt.y);
        ctx.stroke();
      }

      // Leading-edge sharp outline (espinoso = borde óseo duro)
      ctx.strokeStyle = hexA(this.color.rim, 0.65);
      ctx.lineWidth = Math.max(0.35, s * 0.06);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(spLeadBase.x, spLeadBase.y);
      ctx.quadraticCurveTo(spLeadMid.x, spLeadMid.y, spApexX, spApexY);
      ctx.stroke();

      // ── 5b) SOFT DORSAL (trapezoidal flexible, rayos segmentados) ──
      // Wag mayor que la espinosa (rayos soft = flexibles). Phase
      // shifteado +π/2 vs espinosa para que las dos no se muevan en
      // fase (real fish: spinous mostly static, soft undulates).
      const sdWag = Math.sin(this.finPhase * 0.9 + Math.PI * 0.5) * s * 0.045;
      const sdLeadBase = mapToSpine(-0.05, -0.55);
      const sdApex = mapToSpine(-0.40, -0.92);
      const sdTrailBase = mapToSpine(-0.85, -0.42);
      const sdθ = tangentAt(-0.40);
      const sdApexX = sdApex.x + Math.cos(sdθ) * sdWag;
      const sdApexY = sdApex.y + Math.sin(sdθ) * sdWag;

      ctx.beginPath();
      ctx.moveTo(sdLeadBase.x, sdLeadBase.y);
      // Smooth quadratic arc del leading-base al apex (membrane curve)
      const sdLeadCtrl = mapToSpine(-0.20, -0.78);
      ctx.quadraticCurveTo(sdLeadCtrl.x, sdLeadCtrl.y, sdApexX, sdApexY);
      // Trailing arc del apex al trailing-base (membrane fade)
      const sdTrailCtrl = mapToSpine(-0.65, -0.65);
      ctx.quadraticCurveTo(sdTrailCtrl.x, sdTrailCtrl.y, sdTrailBase.x, sdTrailBase.y);
      ctx.closePath();

      const sdBaseMid = {
        x: (sdLeadBase.x + sdTrailBase.x) * 0.5,
        y: (sdLeadBase.y + sdTrailBase.y) * 0.5,
      };
      const sdRadius = Math.hypot(sdApexX - sdBaseMid.x, sdApexY - sdBaseMid.y);
      const sdGrad = ctx.createRadialGradient(
        sdBaseMid.x, sdBaseMid.y, 0,
        sdBaseMid.x, sdBaseMid.y, sdRadius,
      );
      sdGrad.addColorStop(0,    hexA('#020610', 0.28));
      sdGrad.addColorStop(0.15, hexA(this.color.body, 0.45));
      sdGrad.addColorStop(0.70, hexA(this.color.body, 0.18));
      sdGrad.addColorStop(1,    hexA(this.color.body, 0.04));
      ctx.fillStyle = sdGrad;
      ctx.fill();

      // Soft rays (4) — líneas tenues, ligeramente convergentes hacia
      // el apex. Real soft rays son segmentados → en 2D solo sugerimos
      // como separadores radiales finos.
      ctx.strokeStyle = hexA(this.color.rim, 0.30);
      ctx.lineWidth = Math.max(0.16, s * 0.020);
      const sdRayDefs: Array<[number, number, number]> = [
        [-0.10, -0.50, -0.78],
        [-0.30, -0.55, -0.88],
        [-0.50, -0.55, -0.82],
        [-0.70, -0.50, -0.62],
      ];
      for (const [rxU, rBaseYU, rTipYU] of sdRayDefs) {
        const rb = mapToSpine(rxU, rBaseYU);
        const rt = mapToSpine(rxU, rTipYU);
        ctx.beginPath();
        ctx.moveTo(rb.x, rb.y);
        ctx.lineTo(rt.x, rt.y);
        ctx.stroke();
      }

      // Trailing-edge bioluminescence (Avatar reef fish style) — solo
      // en el soft dorsal porque su trailing edge es la parte más
      // translúcida del fin. La spinous tiene leading-edge brillante
      // (hueso) en lugar de trailing-edge biolum.
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = hexA(this.color.rim, 0.55);
      ctx.lineWidth = Math.max(0.32, s * 0.04);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sdApexX, sdApexY);
      ctx.quadraticCurveTo(sdTrailCtrl.x, sdTrailCtrl.y, sdTrailBase.x, sdTrailBase.y);
      ctx.stroke();

      ctx.restore();
    }

    // ─── 6) Aletas pectorales morpheadas — DOS, splay con m ────────────
    // En side (m=0) ambas en posición vientre (overlap = una sola visual).
    // En top (m=1) en posiciones mirror (±0.36 etc). Paddle stroke
    // alternado: cada lado opuesto en fase para "rowing".
    //
    // ASIMETRÍA EN TURNS (Drucker & Lauder 2003): la pectoral del lado
    // INTERNO al giro extiende hacia adelante (acta como freno + drag
    // en ese lado), la EXTERNA se mete contra el cuerpo (reduce drag).
    // Sin esto los giros lucían fake — both pecs symmetric era el #1
    // tell de "el pez no está girando, está flotando de lado".
    //
    // CUP-FORWARD EN BRAKE: ambas pectorales sweep hacia adelante
    // (positive xU offset) durante hover/brake. Patrón "manos parando
    // agua" característico de fish station-keeping.
    const pecAsymSweep = -turning * 0.30;
    const pecCupForward = braking * 0.25;
    const paddlePhase = this.finPhase * 0.6;
    const pecPaddle = Math.sin(paddlePhase) * (1 - hovering * 0.6); // hover → paddle quiet
    for (const pecSign of [-1, +1] as const) {
      // pecAsymSweep * pecSign: pec interna del giro extiende hacia
      // adelante (sweep+), externa hacia atrás (sweep-). En signo
      // que matchea la convención del fish: pecSign=+1 derecha del
      // body, turning>0 yaw hacia derecha → interna=derecha.
      const sweepOffset = pecAsymSweep * pecSign + pecCupForward;
      const tipXUnit = morphY(
        0.20 - pecPaddle * 0.15 + sweepOffset,
        0.20 - pecPaddle * pecSign * 0.15 + sweepOffset,
      );
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
      // Membrane gradient base→tip (Audubon dry-brush translucency).
      const pBaseMid = {
        x: (pBA.x + pBP.x) * 0.5,
        y: (pBA.y + pBP.y) * 0.5,
      };
      const pecRadius = Math.hypot(pTip.x - pBaseMid.x, pTip.y - pBaseMid.y);
      const pecGrad = ctx.createRadialGradient(
        pBaseMid.x, pBaseMid.y, 0,
        pBaseMid.x, pBaseMid.y, pecRadius,
      );
      pecGrad.addColorStop(0,    hexA('#020610', 0.25));
      pecGrad.addColorStop(0.15, hexA(this.color.body, 0.40));
      pecGrad.addColorStop(0.75, hexA(this.color.body, 0.15));
      pecGrad.addColorStop(1,    hexA(this.color.body, 0.04));
      ctx.fillStyle = pecGrad;
      ctx.fill();
      ctx.strokeStyle = hexA(this.color.rim, 0.40);
      ctx.lineWidth = Math.max(0.25, s * 0.05);
      ctx.stroke();
      // Ray central — una sola línea tenue de la base al tip, sugiere
      // la membrana radiada del pectoral. Una sola línea (no dos como
      // dorsal) porque el pectoral es más chico — más detalle satura.
      ctx.strokeStyle = hexA(this.color.rim, 0.30);
      ctx.lineWidth = Math.max(0.18, s * 0.022);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(pBA.x, pBA.y);
      ctx.lineTo(pTip.x, pTip.y);
      ctx.stroke();
    }

    // ─── 6.5) Pelvic fins — paired thoracic position ─────────────────
    // Acanthomorph perciformes (lobina/sunfish/perca — predador lacustre)
    // tienen pélvicas TORÁCICAS: justo debajo/detrás de pectorales,
    // NO abdominales. Anchor xU +0.85 con offset lateral ±0.30 (top
    // view splay). Pequeñas (~50% pectoral area), con 1 spine + 4
    // soft rays típicos. Función: trim, fine-pitch control, braking.
    //
    // FAN-OUT EN HOVER/BRAKE (Standen 2005): durante station-keeping
    // las pélvicas se ABREN lateral (drag plate ventral). pvFanOut
    // multiplica la deviation del tip → en brake/hover extienden
    // hasta 1.4× su tucked length. En cruise quedan pegadas (tucked
    // default 1.0×).
    //
    // Fase 1: posiciones anatómicas + tucked default. Fase 2 fan-out.
    // Fase 3 añadirá X-pattern antifase sculling con pectorales.
    {
      const pvFanOut = 1 + (hovering + braking * 0.5) * 0.40;
      const pvBaseXU = 0.95;
      const pvTipBaseXU = 0.55;
      // X-PATTERN ANTIFASE SCULL (Drucker & Lauder 2003 trout station-
      // holding): durante hover, las pélvicas scull antifase con la
      // PECTORAL contralateral. Pélvica izq ⇄ Pectoral der, pélvica
      // der ⇄ Pectoral izq. Resultado: standing-wobble característico
      // del pez sosteniendo posición. Sin esto el hover lee como
      // "pez congelado en vez de activo trim-correcting".
      // Frecuencia = paddlePhase (lower than tail beat). Amplitud
      // gateada por hovering → en cruise queda 0.
      const pvScullAmp = 0.10 * hovering;
      for (const pvSign of [-1, +1] as const) {
        // Antifase entre pélvicas L/R; la del lado +1 va con paddlePhase,
        // la del lado -1 va con paddlePhase+π. Esto matchea la convención
        // de la pectoral (que ya usa paddlePhase con asimetría per pecSign).
        const pvScullPhase = paddlePhase + (pvSign > 0 ? 0 : Math.PI);
        const pvScull = Math.sin(pvScullPhase) * pvScullAmp;

        // Side view (m=0): ambas overlap en posición ventral. Fase 1
        // las dejamos casi tucked: tip baja sutil bajo el vientre.
        // Top view (m=1): mirrored a ±0.55 (splay lateral).
        const pvBaseYU = morphY(0.42, pvSign * 0.30);
        const pvTipYU = morphY(0.78 * pvFanOut, pvSign * 0.62 * pvFanOut);
        const pvTipXU = pvTipBaseXU + pvScull;
        const pvBA = mapToSpine(pvBaseXU, pvBaseYU - 0.04);
        const pvBP = mapToSpine(pvBaseXU - 0.10, pvBaseYU + 0.04);
        const pvTip = mapToSpine(pvTipXU, pvTipYU);

        // Triangular paddle pequeño (~50% del pectoral)
        ctx.beginPath();
        ctx.moveTo(pvBA.x, pvBA.y);
        const pvLeadCtrl = {
          x: (pvBA.x + pvTip.x) * 0.5,
          y: (pvBA.y + pvTip.y) * 0.5,
        };
        ctx.quadraticCurveTo(pvLeadCtrl.x, pvLeadCtrl.y, pvTip.x, pvTip.y);
        ctx.lineTo(pvBP.x, pvBP.y);
        ctx.closePath();

        const pvBaseMid = {
          x: (pvBA.x + pvBP.x) * 0.5,
          y: (pvBA.y + pvBP.y) * 0.5,
        };
        const pvRadius = Math.hypot(pvTip.x - pvBaseMid.x, pvTip.y - pvBaseMid.y);
        const pvGrad = ctx.createRadialGradient(
          pvBaseMid.x, pvBaseMid.y, 0,
          pvBaseMid.x, pvBaseMid.y, pvRadius,
        );
        pvGrad.addColorStop(0,    hexA('#020610', 0.22));
        pvGrad.addColorStop(0.15, hexA(this.color.body, 0.35));
        pvGrad.addColorStop(0.70, hexA(this.color.body, 0.12));
        pvGrad.addColorStop(1,    hexA(this.color.body, 0.03));
        ctx.fillStyle = pvGrad;
        ctx.fill();

        // Leading edge stroke (1 spine bony) sutil
        ctx.strokeStyle = hexA(this.color.rim, 0.32);
        ctx.lineWidth = Math.max(0.18, s * 0.035);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(pvBA.x, pvBA.y);
        ctx.quadraticCurveTo(pvLeadCtrl.x, pvLeadCtrl.y, pvTip.x, pvTip.y);
        ctx.stroke();

        // 1 ray central (fin chico, no satura con más detalle)
        ctx.strokeStyle = hexA(this.color.rim, 0.22);
        ctx.lineWidth = Math.max(0.13, s * 0.016);
        ctx.beginPath();
        ctx.moveTo(pvBP.x, pvBP.y);
        ctx.lineTo(pvTip.x, pvTip.y);
        ctx.stroke();
      }
    }

    // ─── 7) Aleta anal — antifase del soft dorsal (ventral mirror) ────
    // Espejo ventral del soft dorsal: trapezoidal flexible con rayos
    // segmentados. Counter-shading INVERTIDO: tinte ventral claro
    // (#dde6ff) en lugar del body color del dorsal — hereda la lógica
    // de counter-shading del cuerpo (dorsal oscuro / ventral claro).
    // Wave phase + π/2 vs soft dorsal: cuando el dorsal flexa una vía,
    // el anal flexa la opuesta — produce jets laterales OPUESTOS que
    // anulan el yaw torque del body wave (Standen & Lauder 2005).
    const analAlpha = (1 - m) * (1 - m);
    if (analAlpha > 0.02) {
      ctx.save();
      ctx.globalAlpha = analAlpha;

      const anWag = Math.sin(this.finPhase * 0.9 + Math.PI) * s * 0.040;
      const anLeadBase = mapToSpine(-0.55, 0.32);
      const anApex = mapToSpine(-0.90, 0.78);
      const anTrailBase = mapToSpine(-1.30, 0.22);
      const anθ = tangentAt(-0.90);
      const anApexX = anApex.x + Math.cos(anθ) * anWag;
      const anApexY = anApex.y + Math.sin(anθ) * anWag;

      ctx.beginPath();
      ctx.moveTo(anLeadBase.x, anLeadBase.y);
      const anLeadCtrl = mapToSpine(-0.70, 0.62);
      ctx.quadraticCurveTo(anLeadCtrl.x, anLeadCtrl.y, anApexX, anApexY);
      const anTrailCtrl = mapToSpine(-1.10, 0.55);
      ctx.quadraticCurveTo(anTrailCtrl.x, anTrailCtrl.y, anTrailBase.x, anTrailBase.y);
      ctx.closePath();

      // Counter-shading ventral: tinte pale en lugar del body dark
      const anBaseMid = {
        x: (anLeadBase.x + anTrailBase.x) * 0.5,
        y: (anLeadBase.y + anTrailBase.y) * 0.5,
      };
      const anRadius = Math.hypot(anApexX - anBaseMid.x, anApexY - anBaseMid.y);
      const anGrad = ctx.createRadialGradient(
        anBaseMid.x, anBaseMid.y, 0,
        anBaseMid.x, anBaseMid.y, anRadius,
      );
      // AO base shadow → ventral pale → fade
      anGrad.addColorStop(0,    hexA('#020610', 0.25));
      anGrad.addColorStop(0.15, hexA('#dde6ff', 0.35));
      anGrad.addColorStop(0.70, hexA('#dde6ff', 0.15));
      anGrad.addColorStop(1,    hexA('#dde6ff', 0.03));
      ctx.fillStyle = anGrad;
      ctx.fill();

      // Soft rays (3, menos que el dorsal porque anal es más chico)
      ctx.strokeStyle = hexA(this.color.rim, 0.28);
      ctx.lineWidth = Math.max(0.14, s * 0.018);
      ctx.lineCap = 'round';
      const anRayDefs: Array<[number, number, number]> = [
        [-0.65, 0.40, 0.68],
        [-0.90, 0.42, 0.75],
        [-1.15, 0.35, 0.55],
      ];
      for (const [rxU, rBaseYU, rTipYU] of anRayDefs) {
        const rb = mapToSpine(rxU, rBaseYU);
        const rt = mapToSpine(rxU, rTipYU);
        ctx.beginPath();
        ctx.moveTo(rb.x, rb.y);
        ctx.lineTo(rt.x, rt.y);
        ctx.stroke();
      }

      // Trailing-edge biolum (mirror del soft dorsal)
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = hexA(this.color.rim, 0.50);
      ctx.lineWidth = Math.max(0.30, s * 0.04);
      ctx.beginPath();
      ctx.moveTo(anApexX, anApexY);
      ctx.quadraticCurveTo(anTrailCtrl.x, anTrailCtrl.y, anTrailBase.x, anTrailBase.y);
      ctx.stroke();

      ctx.restore();
    }

    // ─── 8) Caudal fin — rigid local-frame V-fork (no bend deform) ───
    // Refactor completo (anterior approach iteraba 4 xU positions con
    // flare/narrow math reactivos a headToTail → durante turns el drive
    // llegaba a π → fanOut ≈ 4.7 → tail tall ~3 spine units = "demasiado
    // grande" + lóbulos como líneas deformes que el usuario reportó).
    //
    // Nuevo: polígono FIJO en local-frame anclado en peduncle (xU=-1.55),
    // orientado por la tangent del spine + sway phase-lagged del swim
    // wave. NO se deforma con el bend del cuerpo — el bend lo absorbe la
    // chain misma (peduncle anchor + tangent ya curvan smooth con FABRIK).
    // Sizing proporcional al body (tailL = 0.55s = 15% del body length,
    // antes podía llegar a 80%+ del body length). Render style idéntico
    // al soft dorsal: radial con AO base, rays radiales, biolum trailing.
    const peduncleXU = -1.55;
    const peduncleAnchor = mapToSpine(peduncleXU, 0);
    const pedTang = tangentAt(peduncleXU);

    // Sway phase-lagged del swim wave (π/2 lag típico carangiform).
    // Magnitud escala con bodyEffort (más wag en burst, menos en idle)
    // y se atenúa con swimGateLagged (durante C-bend el sway → 0).
    const swayPhase = this.swimPhase + k * peduncleXU - Math.PI * 0.5;
    const swayMag = (0.10 + 0.22 * this.bodyEffort) * this.swimGateLagged;
    const swayOffset = Math.sin(swayPhase) * swayMag;
    const tailOrient = pedTang + Math.PI + swayOffset;

    // Local→world basis (anchor at 0,0; +x = aft, +y = ventral local)
    const tcA = Math.cos(tailOrient);
    const tsA = Math.sin(tailOrient);
    const toWorld = (lx: number, ly: number): Vec => ({
      x: peduncleAnchor.x + lx * tcA - ly * tsA,
      y: peduncleAnchor.y + lx * tsA + ly * tcA,
    });

    // Sizing proporcional. m=1 (top view) achata el lobe span a 30%
    // (la cola vista desde arriba se proyecta como single blade) y
    // cierra el V-notch (notch migra hacia el tip).
    const tailL = s * 0.68;
    const lobeBend = (1 - m) * 0.85 + 0.30; // 1.15 side → 0.30 top
    const lobeW = s * 0.39 * lobeBend;
    const baseHalfW = s * 0.11;
    const vDepth = (1 - m) * 0.40;
    const notchInset = tailL * (1 - vDepth);

    // Local vertices (forked polygon: 9 puntos para quadratic curves)
    const wBaseTop  = toWorld(0,             -baseHalfW);
    const wUpperOut = toWorld(tailL * 0.45,  -lobeW * 0.92);
    const wUpperTip = toWorld(tailL,         -lobeW * 0.78);
    const wUpperIn  = toWorld(tailL * 0.78,  -lobeW * 0.30);
    const wNotch    = toWorld(notchInset,    0);
    const wLowerIn  = toWorld(tailL * 0.78,  +lobeW * 0.30);
    const wLowerTip = toWorld(tailL,         +lobeW * 0.78);
    const wLowerOut = toWorld(tailL * 0.45,  +lobeW * 0.92);
    const wBaseBot  = toWorld(0,             +baseHalfW);

    // Outline — quadratic curves estilo soft dorsal/anal
    ctx.beginPath();
    ctx.moveTo(wBaseTop.x, wBaseTop.y);
    ctx.quadraticCurveTo(wUpperOut.x, wUpperOut.y, wUpperTip.x, wUpperTip.y);
    ctx.quadraticCurveTo(wUpperIn.x,  wUpperIn.y,  wNotch.x,    wNotch.y);
    ctx.quadraticCurveTo(wLowerIn.x,  wLowerIn.y,  wLowerTip.x, wLowerTip.y);
    ctx.quadraticCurveTo(wLowerOut.x, wLowerOut.y, wBaseBot.x,  wBaseBot.y);
    ctx.closePath();

    // Radial gradient con AO base shadow + body fill MÁS BRILLOSO que
    // el soft dorsal porque el caudal es más grande y bajo additive
    // composite necesita más alpha para leerse contra el background.
    const tailGrad = ctx.createRadialGradient(
      peduncleAnchor.x, peduncleAnchor.y, 0,
      peduncleAnchor.x, peduncleAnchor.y, tailL,
    );
    tailGrad.addColorStop(0,    hexA('#020610', 0.30));
    tailGrad.addColorStop(0.15, hexA(this.color.body, 0.52));
    tailGrad.addColorStop(0.70, hexA(this.color.body, 0.22));
    tailGrad.addColorStop(1,    hexA(this.color.body, 0.05));
    ctx.fillStyle = tailGrad;
    ctx.fill();

    // OUTLINE silueta — el caudal anterior tenía outline rim alpha 0.42
    // y al removerlo el polígono quedaba sin definición de borde, leyendo
    // como halo difuso en lugar de aleta. Lo restauramos con leading
    // edge alpha más alto para matchear la presencia visual del dorsal.
    ctx.strokeStyle = hexA(this.color.rim, 0.45);
    ctx.lineWidth = Math.max(0.35, s * 0.055);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // Rays — 4 líneas radiando del peduncle hacia outer de cada lóbulo
    ctx.strokeStyle = hexA(this.color.rim, 0.32);
    ctx.lineWidth = Math.max(0.16, s * 0.022);
    const rayLocal: Array<[number, number]> = [
      [tailL * 0.50, -lobeW * 0.82],
      [tailL * 0.85, -lobeW * 0.75],
      [tailL * 0.85, +lobeW * 0.75],
      [tailL * 0.50, +lobeW * 0.82],
    ];
    for (const [rlx, rly] of rayLocal) {
      const wr = toWorld(rlx, rly);
      ctx.beginPath();
      ctx.moveTo(peduncleAnchor.x, peduncleAnchor.y);
      ctx.lineTo(wr.x, wr.y);
      ctx.stroke();
    }

    // Trailing-edge biolum — bordes exteriores (Avatar reef fish).
    // Alpha 0.75 (era 0.55) — el caudal trailing-edge es THE feature
    // bioluminiscente más diagnóstico, debe leerse claro contra el lake.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = hexA(this.color.rim, 0.62);
    ctx.lineWidth = Math.max(0.35, s * 0.045);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(wBaseTop.x, wBaseTop.y);
    ctx.quadraticCurveTo(wUpperOut.x, wUpperOut.y, wUpperTip.x, wUpperTip.y);
    ctx.moveTo(wBaseBot.x, wBaseBot.y);
    ctx.quadraticCurveTo(wLowerOut.x, wLowerOut.y, wLowerTip.x, wLowerTip.y);
    ctx.stroke();
    ctx.restore();

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
 * Empuja la cabeza del pez hacia el ancla si sale del lago seguro
 * (mask < 0.85). ÚLTIMO RECURSO — la primera línea de defensa es
 * applyWallAvoidance (orienta el heading hacia agua libre antes de
 * que el pez llegue a la pared). Este clamp SOLO corrige posicional-
 * mente leaks pequeños. Push capped a ~3 px/frame para evitar el
 * "brinco" visible que reportaba el usuario (el push de 14 px del
 * intento anterior teleportaba la cabeza cada frame).
 */
const clampSpineToLake = (
  fish: { spine: Vec[] }, // GlowFish expone .spine como [position]
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
      // Push capped a 3 px/frame — corrige leaks sin teleportar.
      // applyWallAvoidance debería evitar que el pez llegue a este
      // punto; si lo hace, este clamp lo regresa al lago en ~5-10
      // frames sin "brinco" visible.
      const push = Math.min(3, 0.8 + (1 - m / 0.85) * 2.2);
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
    // Velocidad del cursor smoothed (px/s). Se calcula frame a frame en
    // el tick loop usando dt. Drives el "match speed" del pez cazador:
    // cuando el cursor se mueve rápido, el pez también; cuando el cursor
    // se queda quieto cerca, el pez no embiste, baja a velocidad ambiente.
    let prevPointerX = 0;
    let prevPointerY = 0;
    let cursorSpeedSmoothed = 0;
    // Engagement timeout — si el pez ya alcanzó el cursor (hovering) y
    // este se queda quieto 3 segundos, el pez "pierde interés" y vuelve
    // a patrullaje. El flag persiste hasta que el cursor se mueva de
    // nuevo, momento en el que se re-engancha. Esto evita estados largos
    // de station-keeping donde se pueden acumular bugs visuales sutiles.
    let cursorIdleWhileHovering = 0; // segundos
    let cursorDisengaged = false;

    // Hover state — anchor (position target congelado al entrar al hover,
    // "strike post" estilo Naughty Dog AI) y look target (smoothed cursor
    // que la cabeza tracking). Decouple del body y head es el fix
    // canónico de "target chatter / IK popping" cuando el cursor wigglea
    // sobre el personaje (Octocat 404, Lusion hero scenes). El low-pass
    // del cursor (tau ~250ms) filtra wiggles antes de que lleguen al rig.
    let hoverAnchorX = 0;
    let hoverAnchorY = 0;
    let hoverLookX = 0;
    let hoverLookY = 0;
    let hoverStateInitialized = false;
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
    // Y range = [0.58, 0.85] — el extremo bottom (>0.85) suele recortarse
    // del viewport en desktop wide (object-fit: cover hace clip top+bottom).
    // Y distribuido UNIFORME para que los peces aprovechen todo el rango
    // vertical del lago (no acumularse en una banda).
    const pickWaterPoint = (): Vec => {
      for (let i = 0; i < 40; i++) {
        const u = 0.08 + Math.random() * 0.75;
        const v = 0.58 + Math.random() * 0.27;
        if (sampleMask(mask, u, v) > 0.65) {
          return { x: u, y: v };
        }
      }
      return { x: 0.45, y: 0.72 };
    };

    /**
     * Versión sesgada hacia ADELANTE del pez. Genera waypoints en un
     * cone ±90° del heading actual (= mitad delantera del pez), a
     * distancia razonable. Esto evita que el pez tenga que hacer U-turns
     * de 180° cada vez que cambia de target — el modelo Dubins (forward-
     * only) lo obliga a hacer arcos enormes en U-turns. Resultado: el
     * pez nada de waypoint en waypoint en una trayectoria mayormente
     * forward, con giros suaves cuando el target está al lado.
     *
     * Si el cone forward no encuentra agua válida (e.g., el pez está
     * apuntando hacia tierra), fallback al pickWaterPoint global.
     */
    const pickWaterPointAhead = (headUV: Vec, heading: number): Vec => {
      for (let i = 0; i < 30; i++) {
        // Cone ±60° del heading — adelante pero con variedad lateral
        // suficiente para que distintos peces tomen direcciones
        // distintas. Distancia LARGA 0.30-0.55 UV → en desktop son
        // 430-790 px, el pez nada varios segundos antes de llegar.
        // Más distancia = menos waypoints = menos giros.
        const headingDeviation = (Math.random() - 0.5) * (Math.PI * 2 / 3);
        const sampleAngle = heading + headingDeviation;
        const dist = 0.30 + Math.random() * 0.25;
        const u = headUV.x + Math.cos(sampleAngle) * dist;
        const v = headUV.y + Math.sin(sampleAngle) * dist;
        if (u < 0.08 || u > 0.83 || v < 0.58 || v > 0.85) continue;
        if (sampleMask(mask, u, v) > 0.65) {
          return { x: u, y: v };
        }
      }
      // Fallback: global pick (puede caer detrás, pero solo cuando el
      // cone está bloqueado por orilla = el pez SÍ necesita devolverse).
      return pickWaterPoint();
    };

    // Wander simple — el pez nada DERECHO en su heading actual y SOLO
    // gira cuando va a chocar contra orilla. Sin waypoints random, sin
    // state machine, sin pausas artificiales. El target siempre es un
    // punto lejano en la dirección de nado. Cuando el lookahead detecta
    // orilla adelante, el target se reorienta hacia la dirección lateral
    // con MÁS agua disponible. Resultado: el pez SOLO gira cuando no
    // tiene más opción.
    //
    // Probamos 7 direcciones (heading + ±π/4, ±π/2, ±3π/4) y elegimos
    // la que mejor mask devuelve. Preference suave por dev=0 (heading
    // actual) — si el frente sigue siendo razonable, no gira.
    const LOOK_DEVIATIONS = [
      0,
      -Math.PI / 4, +Math.PI / 4,
      -Math.PI / 2, +Math.PI / 2,
      -3 * Math.PI / 4, +3 * Math.PI / 4,
    ];
    const applyWander = (f: GlowFish, _dtNow: number): void => {
      const headX = f.spine[0].x;
      const headY = f.spine[0].y;
      const lookaheadDist = 200 + f.bodyScale * 7;
      let bestAngle = f.heading;
      let bestScore = -Infinity;
      for (const dev of LOOK_DEVIATIONS) {
        const tryAngle = f.heading + dev;
        const tryX = headX + Math.cos(tryAngle) * lookaheadDist;
        const tryY = headY + Math.sin(tryAngle) * lookaheadDist;
        const tryIUV = canvasUVToImgUV(
          { x: tryX / cw, y: tryY / ch },
          cw, ch, IMG_W, IMG_H,
        );
        // Penaliza si el lookahead cae fuera del hero visible (y > 0.85)
        const outOfHero = tryIUV.y > 0.85 ? 0.5 : 0;
        // Preference fuerte por seguir derecho (dev=0) — solo gira si
        // la deviación tiene MUY mejor agua que el frente actual.
        const preference = dev === 0 ? 0.25 : 0;
        const score = sampleMask(mask, tryIUV.x, tryIUV.y) - outOfHero + preference;
        if (score > bestScore) {
          bestScore = score;
          bestAngle = tryAngle;
        }
      }
      // Target = punto lejano en bestAngle. Si bestAngle === heading,
      // pez sigue derecho. Si no, gira con maxTurnRate del kinematic.
      const tx = headX + Math.cos(bestAngle) * 600;
      const ty = headY + Math.sin(bestAngle) * 600;
      f.setTargetSmooth({ x: tx, y: ty }, 0.10);
    };

    // ── Wall avoidance reactivo ─────────────────────────────────────
    // applyWander decide rutas a largo plazo (200+ px lookahead). Pero
    // cuando el pez ya está PEGADO a la orilla, el lookahead largo cae
    // dentro de roca en TODAS las direcciones y el preference bias del
    // dev=0 termina mandando al pez derecho a la pared, frame tras frame.
    // El clampSpineToLake lo empujaba con 14 px → "brinco" visible que el
    // usuario reportó (peces atorados saltando contra el borde).
    //
    // Solución: feelers cortos (25 / 50 px) que detectan paredes inminentes.
    // Cuando una pared está a < 25 px del head (estamos a punto de chocar)
    // o el frontal a 50 px ya es roca, override directo de f.target hacia
    // el lado libre (o U-turn si ambos lados están bloqueados también).
    // Brake currentSpeed proporcional a la profundidad de la pared → el
    // pez frena ANTES de embestir. Retorna true si disparó, para que el
    // tick loop pueda skippear wander/follow ese frame.
    const applyWallAvoidance = (f: GlowFish, _dtNow: number): boolean => {
      const headX = f.spine[0].x;
      const headY = f.spine[0].y;
      const probe = (angle: number, dist: number): number => {
        const px = headX + Math.cos(angle) * dist;
        const py = headY + Math.sin(angle) * dist;
        const iuv = canvasUVToImgUV(
          { x: px / cw, y: py / ch },
          cw, ch, IMG_W, IMG_H,
        );
        return sampleMask(mask, iuv.x, iuv.y);
      };
      // Forward: emergencia (25 px) y advance warning (50 px). Tomamos
      // el MIN — si la ruta corta toca pared, no importa que más lejos
      // haya agua otra vez: ya vamos a chocar.
      const mFnear = probe(f.heading, 25);
      const mFfar = probe(f.heading, 50);
      const mF = Math.min(mFnear, mFfar);
      // También probamos justo en el head — si la cabeza YA está en zona
      // de roca, hay que escapar de inmediato sin importar lo demás.
      const mHead = probe(f.heading, 0);
      // Umbral 0.85 alineado con clampSpineToLake. Si frente está bien,
      // no interferir con wander/follow.
      if (mF >= 0.85 && mHead >= 0.85) return false;

      // Lados a 50 px (60° fuera del heading) — qué tan libre está cada
      // costado para decidir hacia dónde girar.
      const mL = probe(f.heading - Math.PI / 3, 50);
      const mR = probe(f.heading + Math.PI / 3, 50);

      // Decide escape direction.
      let escapeAngle: number;
      if (mL > 0.85 && mR < 0.85) {
        escapeAngle = f.heading - Math.PI / 2.2; // izquierda libre, gira fuerte
      } else if (mR > 0.85 && mL < 0.85) {
        escapeAngle = f.heading + Math.PI / 2.2; // derecha libre, gira fuerte
      } else if (mL > mR + 0.05) {
        escapeAngle = f.heading - Math.PI / 3;
      } else if (mR > mL + 0.05) {
        escapeAngle = f.heading + Math.PI / 3;
      } else {
        // Corner trap — ambos lados igual de bloqueados. U-turn forzado.
        // Mantenemos el signo del angularVel actual para que el pez no
        // oscile entre izquierda/derecha cuando ambas lecturas empatan.
        const sign = f.angularVel >= 0 ? 1 : -1;
        escapeAngle = f.heading + sign * Math.PI * 0.85;
      }

      // Override target — punto a 250 px en escapeAngle. Lo escribimos
      // directo (sin lerp) porque es emergencia: necesitamos que el
      // kinematic empiece a girar ya mismo en el próximo update().
      const reach = 250;
      f.target.x = headX + Math.cos(escapeAngle) * reach;
      f.target.y = headY + Math.sin(escapeAngle) * reach;

      // Brake — más profundo en pared = más freno. Sin esto, el momentum
      // sigue empujando al pez contra la roca mientras el heading gira.
      const wallDepth = 1 - Math.min(mF, mHead) / 0.85; // 0..1
      f.currentSpeed *= 1 - 0.55 * wallDepth;

      // Si estaba hovering (pez del cursor), salir del hover — la pared
      // tiene prioridad sobre la suspensión.
      f.isHovering = false;

      return true;
    };

    // ─── GlowFish (5) ambientales — peces silueta-luminosa estilo argonaut
    // chain. Distribuidos en los SPAWN_UV originales del lago, todos
    // verificados dentro del polígono seguro del agua.
    // Paleta azul ELÉCTRICO PURO, sin celeste/cyan. Hexes con G < B/2
    // para forzar el tono "literalmente azul" que el usuario pidió.
    const GLOW_PALETTE: GlowFishColor[] = [
      { rim: '#3870ff', body: '#060932', core: '#1858ff', halo: '#0040ff' },
      { rim: '#3068ee', body: '#070b35', core: '#1450ee', halo: '#0038f0' },
      { rim: '#4078ff', body: '#080c38', core: '#2060ff', halo: '#0048ff' },
      { rim: '#2c5cdc', body: '#050828', core: '#1048d8', halo: '#0030e0' },
      { rim: '#5088ff', body: '#0a1040', core: '#2868ff', halo: '#0050ff' },
    ];
    // 4 spawn points para los ambientales (el 5º pez total es el cursorFish,
    // que patrulla cerca de 0.40,0.82 cuando no hay cursor sobre el agua).
    // Todos en y ≤ 0.83 para que estén dentro del área visible del hero.
    const GLOW_SPAWN: Vec[] = [
      { x: 0.12, y: 0.72 }, // fondo izq
      { x: 0.45, y: 0.70 }, // fondo medio (lejos)
      { x: 0.62, y: 0.82 }, // cerca derecha-medio
      { x: 0.18, y: 0.83 }, // cerca izq
    ];
    const glowFishes: GlowFish[] = [];
    const buildGlowFishes = (): void => {
      glowFishes.length = 0;
      for (let i = 0; i < GLOW_SPAWN.length; i++) {
        const uv = GLOW_SPAWN[i];
        const cuv = imgUVToCanvasUV(uv, cw, ch, IMG_W, IMG_H);
        const start = { x: cuv.x * cw, y: cuv.y * ch };
        // size ~20 en desktop, ~11 en mobile.
        const baseSize = Math.max(11, Math.min(20, cw / 72));
        glowFishes.push(new GlowFish(start, {
          size: baseSize,
          // SpeedScale 0.85-1.15 — los peces ambientales nadan a
          // velocidad "bonita y con energía" (per-instance variation
          // para que no parezcan un cardumen sincronizado).
          speedScale: 0.85 + Math.random() * 0.30,
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

    // ─── Cursor fish — GlowFish con speedScale ambiente (1.0). Cuando
    // el cursor está sobre el agua, le aplicamos huntingBoost dinámico
    // en el tick loop (modo depredador). Cuando el cursor sale del agua,
    // huntingBoost vuelve a 1 y el pez se comporta como cualquier
    // ambiental: oscilación de energy, speedScale normal, applyWander.
    // Brighter palette para destacar como protagonista.
    const cursorSize = Math.max(13, Math.min(24, cw / 60));
    const cursorFish = new GlowFish(
      { x: cw * 0.55, y: ch * 0.80 },
      {
        size: cursorSize,
        speedScale: 1.0,
        color: { rim: '#80a4ff', body: '#0a1444', core: '#3878ff', halo: '#0b50ff' },
        orbit: {
          cx: 0.40,
          cy: 0.80,
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
      //
      // Edge gutter — ~8 px (≈0.5rem) en los bordes izquierdo y derecho
      // del canvas. Si el cursor entra en esa franja, lo tratamos como
      // off-water aunque el mask diga lo contrario. Esto evita bugs
      // visuales cuando el cursor se acerca demasiado al borde de la
      // pantalla (o sale por el costado): el pez deja de perseguir y
      // vuelve a patrullaje en lugar de quedarse brincando contra una
      // orilla geométrica del canvas. Análogo al comportamiento de
      // arriba/abajo (mask < 0.35).
      const edgeGutterPx = 8;
      const cursorInEdgeGutter = pointer.x < edgeGutterPx
        || pointer.x > cw - edgeGutterPx;
      let cursorOnWater = false;
      if (pointer.active && !cursorInEdgeGutter && !cursorDisengaged) {
        const iuv = canvasUVToImgUV({ x: pointer.x / cw, y: pointer.y / ch }, cw, ch, IMG_W, IMG_H);
        if (sampleMask(mask, iuv.x, iuv.y) > 0.35) {
          cursorOnWater = true;
        }
      }

      // Wall avoidance corre primero, EXCEPTO si ya estamos en hover —
      // el hover no se mueve hacia adelante, así que los feelers ya no
      // son necesarios. Sin este bypass, applyWallAvoidance setea
      // isHovering=false al detectar paredes cercanas (e.g. el cursor
      // está cerca del borde) → hover y wall-avoidance oscilan frame
      // tras frame → "contortion" reportada por el usuario.
      const cursorFishEscaping = cursorFish.isHovering
        ? false
        : applyWallAvoidance(cursorFish, dt);

      // Cursor velocity tracking — para el match-speed del pez cazador.
      // Smoothed (lerp 0.3) para evitar spikes por pointermove con dt
      // chiquito. Cuando pointer.active=false, decae a 0.
      if (pointer.active) {
        const cdx = pointer.x - prevPointerX;
        const cdy = pointer.y - prevPointerY;
        const rawCursorSpeed = Math.hypot(cdx, cdy) / Math.max(dt, 1e-6);
        cursorSpeedSmoothed = cursorSpeedSmoothed * 0.7 + rawCursorSpeed * 0.3;
      } else {
        cursorSpeedSmoothed *= 0.85;
      }
      prevPointerX = pointer.x;
      prevPointerY = pointer.y;

      // Engagement state — el pez "pierde interés" cuando lleva ≥ 3s en
      // hover y el cursor sigue inmóvil. Threshold de 25 px/s para
      // "moving" — debajo de eso el cursor está esencialmente quieto
      // (smoothing tiene tau ~50ms así que movimientos reales lo elevan
      // bien por encima). Mientras hovering+disengaged se mantiene en
      // false, sumamos dt; al pasar 3s flippeamos cursorDisengaged a
      // true y cursorOnWater se hará false la próxima vuelta → el pez
      // sale de hover y vuelve a wander. Persiste hasta que el cursor
      // se mueva (re-enganche).
      const cursorIsMoving = cursorSpeedSmoothed > 25;
      if (cursorIsMoving) {
        cursorIdleWhileHovering = 0;
        cursorDisengaged = false;
      } else if (cursorFish.isHovering && !cursorDisengaged) {
        cursorIdleWhileHovering += dt;
        if (cursorIdleWhileHovering >= 3.0) {
          cursorDisengaged = true;
        }
      }

      if (cursorOnWater) {
        cursorFish.glowBoostTarget = 0.85;
        if (!cursorFishEscaping) {
          // Distancia y radios de hover.
          const dToCursor = Math.hypot(
            cursorFish.position.x - pointer.x,
            cursorFish.position.y - pointer.y,
          );
          const hoverRadiusEnter = 14 + cursorFish.size * 1.4;
          const hoverRadiusExit = hoverRadiusEnter * 1.6;
          // ¿El cursor está claramente DETRÁS del pez? Si pasa al
          // hemisferio trasero (|ang| > ~99° del heading), rompemos el
          // hover. Sin este check, cuando el usuario movía el cursor
          // LENTO hacia atrás del pez en hover, el position-lerp arrastraba
          // al pez hacia atrás mientras la cabeza rotaba despacio → look
          // "camarón en C arrastrado". Al romper hover, kinematic toma
          // over y con el gating de speed (max(0, alignment)) el pez
          // decelera a 0, pivota tranquilo, y solo reanuda chase cuando
          // está alineado.
          const angToCursor = Math.atan2(
            pointer.y - cursorFish.position.y,
            pointer.x - cursorFish.position.x,
          );
          let headingDiffToCursor = angToCursor - cursorFish.heading;
          while (headingDiffToCursor > Math.PI) headingDiffToCursor -= 2 * Math.PI;
          while (headingDiffToCursor < -Math.PI) headingDiffToCursor += 2 * Math.PI;
          const cursorBehindFish = Math.abs(headingDiffToCursor) > Math.PI * 0.55;

          // Hover detection con HYSTERESIS — el pez entra al hover a ≈45 px,
          // pero solo sale cuando el cursor se aleja a 1.6× ese radio (≈72 px).
          // Sin la hysteresis, microvibraciones del cursor hacían parpadear
          // isHovering entre frames y el pez entraba/salía del station-keeping
          // varias veces por segundo.
          cursorFish.isHovering = cursorFish.isHovering
            ? (dToCursor < hoverRadiusExit && !cursorBehindFish)
            : dToCursor < hoverRadiusEnter;

          // ─── Body / head decoupling (fix de "target chatter") ─────
          // Cuando el cursor wigglea sobre el pez en hover, el chain del
          // cuerpo persigue cada cambio y se retuerce (Naughty Dog GDC:
          // "IK popping"). Solución canónica de tres capas:
          //   1) Dead zone: el cuerpo se ANCLA al entrar al hover (target
          //      congelado en la posición del pez), wiggles del cursor
          //      no afectan position.
          //   2) Decouple head: la cabeza yaw hacia un lookTarget separado
          //      (usado en update() hover branch), el cuerpo no sigue.
          //   3) Low-pass del cursor: el lookTarget lerps hacia el cursor
          //      con tau ~250ms (rate dt*4), filtra wiggles antes del rig.
          //
          // En cruising mode los dos targets coinciden (heading y position
          // usan el mismo, kinematic bicycle normal).
          if (cursorFish.isHovering) {
            if (!hoverStateInitialized) {
              hoverAnchorX = cursorFish.position.x;
              hoverAnchorY = cursorFish.position.y;
              hoverLookX = pointer.x;
              hoverLookY = pointer.y;
              hoverStateInitialized = true;
            }
            // Body anchored — sin setTargetSmooth, asignación directa.
            cursorFish.target.x = hoverAnchorX;
            cursorFish.target.y = hoverAnchorY;
            // Head tracking — low-pass del cursor (tau ~250ms).
            const lookLerp = Math.min(1, dt * 4);
            hoverLookX += (pointer.x - hoverLookX) * lookLerp;
            hoverLookY += (pointer.y - hoverLookY) * lookLerp;
            cursorFish.lookTarget.x = hoverLookX;
            cursorFish.lookTarget.y = hoverLookY;
          } else {
            hoverStateInitialized = false;
            cursorFish.setTargetSmooth({ x: pointer.x, y: pointer.y }, 0.18);
            // En cruising, lookTarget sigue al target (no decoupling).
            cursorFish.lookTarget.x = cursorFish.target.x;
            cursorFish.lookTarget.y = cursorFish.target.y;
          }

          // huntingBoost adaptativo: interpolación entre
          //   • matchBoost (cuando está cerca, va al ritmo del cursor)
          //   • sprintBoost (cuando está lejos, embiste a full)
          // según la distancia normalizada al cursor.
          //
          //   distFactor = 0 cuando dToCursor < closeRadius (cerca)
          //   distFactor = 1 cuando dToCursor > farRadius (lejos)
          //
          // matchBoost convierte la velocidad del cursor (px/s smoothed) a
          // un factor del speed ambiente: si el cursor se mueve a 432 px/s
          // (2× ambient maxSpeed de 216 px/s), matchBoost = 2.0. Min 1.0
          // para que aún con cursor quieto el pez no quede totalmente
          // congelado (sigue glide-ando hasta el hover). Cap 3.0 para
          // que un swipe rápido del cursor no haga al pez teleportar.
          const closeRadius = hoverRadiusExit; // ~72 px
          const farRadius = 500;
          // distFactor con curva sqrt — rampa rápido los primeros ~150 px,
          // y satura suave hacia farRadius. Sin esto, la transición de
          // "casi cerca" a "lejos" se sentía gradual. Ahora apenas el pez
          // se separa unos 100 px, ya empieza a sprintar fuerte.
          const distNorm = Math.min(1, Math.max(0, (dToCursor - closeRadius) / (farRadius - closeRadius)));
          const distFactor = Math.sqrt(distNorm);
          const nominalPxPerSec = 216; // 3.6 px/frame * 60 fps
          const matchBoost = Math.max(1.0, Math.min(4.0, cursorSpeedSmoothed / nominalPxPerSec));
          // sprintBoost = 6.0 → maxSpeed efectivo ≈ 21.6 px/frame ≈ 1300 px/s
          // a distancia farRadius+. El pez se ve claramente "acelerando para
          // alcanzar" cuando está lejos, no solo "moviéndose más rápido".
          const sprintBoost = 6.0;
          cursorFish.huntingBoost = matchBoost + distFactor * (sprintBoost - matchBoost);
        }
      } else {
        cursorFish.glowBoostTarget = 0.4;
        cursorFish.huntingBoost = 1;
        if (!cursorFishEscaping) {
          // Modo patrullaje — mismo comportamiento que los ambientales:
          // wander libre, huntingBoost=1 (sin boost), energy oscila normal,
          // speedScale ambiente. El pez no recuerda que era cazador.
          applyWander(cursorFish, dt);
          cursorFish.isHovering = false;
        }
      }

      const cursorHeadVForUpdate = canvasUVToImgUV(
        { x: cursorFish.spine[0].x / cw, y: cursorFish.spine[0].y / ch },
        cw, ch, IMG_W, IMG_H,
      ).y;
      cursorFish.update(dt, cursorOnWater, depthScaleAt(cursorHeadVForUpdate));

      // GlowFish ambientales — wander libre por todo el lago. Cada pez
      // tiene su propio waypoint y reloj de burst-glide. Resultado:
      // movimiento desincronizado, sensación de instinto natural.
      for (const gf of glowFishes) {
        // Wall avoidance reactivo PRIMERO. Si hay pared a < 50 px, override
        // target hacia el lado libre y skip wander. Esto evita el bug del
        // pez atorado contra la orilla brincando frame tras frame.
        const escaping = applyWallAvoidance(gf, dt);
        if (!escaping) {
          applyWander(gf, dt);
        }

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

      // El pez-cursor también se queda dentro del lago.
      const safeAnchor = imgUVToCanvasUV({ x: 0.40, y: 0.80 }, cw, ch, IMG_W, IMG_H);
      clampSpineToLake(cursorFish, mask, cw, ch, IMG_W, IMG_H, safeAnchor);

      // ─── Render
      ctx.clearRect(0, 0, cw, ch);
      ctx.save();
      ctx.filter = 'blur(0.5px)';
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
