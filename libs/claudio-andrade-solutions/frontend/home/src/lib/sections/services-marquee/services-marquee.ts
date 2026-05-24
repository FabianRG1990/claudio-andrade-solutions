import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorBracketsCurlyBold,
  phosphorBrowsersBold,
  phosphorChartScatterBold,
  phosphorCheckBold,
  phosphorCloudArrowUpBold,
  phosphorCpuBold,
  phosphorDatabaseBold,
  phosphorDevicesBold,
  phosphorFileCodeBold,
  phosphorGearSixBold,
  phosphorRobotBold,
} from '@ng-icons/phosphor-icons/bold';
import { phosphorClock } from '@ng-icons/phosphor-icons/regular';

import { Service, ServiceStatus, services } from '@cas-ui-shared/data/data';
import { Eyebrow } from '@cas-ui-shared/components/eyebrow/eyebrow';
import { RevealDirective } from '@cas-ui-shared/directives/reveal/reveal.directive';
import { CompanionDockDirective } from '@cas-ui-shared/companion/companion-dock.directive';

// `ServiceStatus` se mapea a tonos SCSS y etiquetas humanas para el chip
// de la card.
const STATUS_TONES: Record<ServiceStatus, string> = {
  Estable: 'estable',          // verde · disponible al instante
  Vulnerable: 'vulnerable',    // coral suave · arrancando
  'En peligro': 'en-peligro',  // coral · cupo limitado
  Crítico: 'critico',          // coral intenso · premium
};

const STATUS_LABEL: Record<ServiceStatus, string> = {
  Estable: 'Disponible',
  Vulnerable: 'En arranque',
  'En peligro': 'Cupo limitado',
  Crítico: 'Premium',
};

// Triplicado del dataset. El offset visual del reel arranca en -W (set del
// medio) y wrappea entre -2W y 0 — así el usuario tiene un set entero de
// margen para arrastrar en cualquier dirección antes de tocar el "borde
// virtual" donde re-wrappeamos sin cambio visual.
const SET_COUNT = 3;

// Cadencia del auto-scroll. Conserva la velocidad del CSS animation
// anterior: 50s para recorrer 1 set completo. La velocidad real en px/s
// se calcula desde scrollWidth, así cualquier viewport mantiene el mismo
// ritmo perceptual.
const SECONDS_PER_CYCLE = 50;

// Pausa entre el último input del usuario y el reinicio del auto-scroll.
// Da tiempo a "soltar y mirar" antes de que la cinta empiece a moverse.
const IDLE_TIMEOUT_MS = 600;

// Ramp suave de 0 → velocidad nominal al reanudar después de IDLE_TIMEOUT.
// smoothstep sobre 450ms — entrada continua C¹ en ambos extremos, sin
// tirón al arrancar ni meseta al llegar a velocidad nominal.
const RESUME_RAMP_MS = 450;

// Umbral en píxeles para decidir el eje del gesto en touch. Por debajo de
// esta distancia ni la dimensión horizontal ni la vertical son confiables
// — esperamos a que el dedo se mueva al menos 6px en cualquier dirección,
// y ahí lockeamos el eje. Valor estándar de Embla / Swiper.
const AXIS_LOCK_THRESHOLD_PX = 6;

// Friction del momentum aplicado al soltar un drag. 0.95 por frame a 60Hz
// = ~95% velocidad retenida cada 16.7ms → decay perceptual de ~0.5s para
// llegar a casi cero (típico de scroll inercial nativo). Se ajusta por dt
// real así que tablets a 120Hz se sienten igual que phones a 60Hz.
const MOMENTUM_FRICTION = 0.95;
const FRICTION_REFERENCE_FRAME_MS = 1000 / 60;
// Cap de velocidad inicial de momentum — evita flicks exagerados que mandan
// la cinta a velocidades ridículas. 4 px/ms = 4000 px/s (más de 10 cards
// por segundo), suficientemente rápido para sentirse "vivo" pero no caótico.
const MOMENTUM_MAX_VELOCITY_PX_PER_MS = 4;
// Threshold de "ya no se mueve" — cuando |v| cae bajo esto, terminamos el
// momentum y devolvemos control al auto-scroll.
const MOMENTUM_STOP_VELOCITY = 0.02;

interface ReelItem extends Service {
  reelKey: string;
  // sequence: "01", "02", ..., "10". Los tres sets repiten 01..10 cada
  // vuelta para que el lector vea la misma numeración en cada pasada.
  sequence: string;
}

interface DragState {
  pointerId: number;
  pointerType: string;
  startClientX: number;
  startClientY: number;
  startOffset: number;
  isAxisLocked: boolean;
  isHorizontal: boolean;
  lastClientX: number;
  lastT: number;
  velocity: number; // px/ms
}

/**
 * ServicesMarquee — capítulo 02 "Lo que ofrecemos". Carrusel infinito
 * drag-scroll con cards solid-3D.
 *
 * Patrón: industry-standard transform-based (Embla / Swiper / Splide).
 *
 *   1. El viewport es overflow:hidden y NO scrollea. El reel hijo se
 *      desplaza con `transform: translate3d(currentX, 0, 0)`.
 *      Razón: con overflow-x:auto, el browser captura el touch y el usuario
 *      no puede scrollear la página verticalmente cuando su dedo está sobre
 *      el carrusel. Con transform + touch-action:pan-y, el browser sigue
 *      manejando scroll vertical de página y nosotros sólo conducimos
 *      cuando detectamos gesto horizontal.
 *
 *   2. Axis lock en touch — al primer pointermove con desplazamiento > 6px,
 *      decidimos: si |dx| > |dy| → tomamos control con setPointerCapture +
 *      preventDefault; si |dy| > |dx| → liberamos el pointer, el browser
 *      maneja el scroll vertical de la página. Mouse y pen entran en modo
 *      drag inmediatamente (no hay ambigüedad de eje en cursores precisos).
 *
 *   3. Long-press pausa — mientras el dedo está apoyado (incluso sin
 *      moverse), `isPointerDown` se mantiene en true y el rAF loop no
 *      avanza. Al soltar, IDLE_TIMEOUT da 600ms antes de retomar
 *      auto-scroll, con ramp smoothstep de 450ms hasta velocidad nominal.
 *      Resultado: el usuario apoya el dedo para leer → cinta queda quieta;
 *      suelta → cinta retoma desde donde estaba.
 *
 *   4. Momentum — al soltar un drag con velocidad, aplica decay exponencial
 *      (friction 0.95/frame ajustado por dt real). Cuando |v| cae bajo
 *      0.02 px/ms, termina el momentum y devuelve control al auto-scroll.
 *
 *   5. Loop seamless — dataset triplicado. currentX arranca en -W (set del
 *      medio). El rAF wrappea cuando currentX cruza ±W. El usuario tiene
 *      un set entero de margen en cada dirección antes de tocar el borde
 *      virtual del wrap.
 *
 *   6. Gates de performance — IntersectionObserver, document.visibilitychange,
 *      prefers-reduced-motion. El drag/touch manual sigue funcionando
 *      con prefers-reduced-motion (no es animación involuntaria — es input
 *      directo del usuario).
 */
@Component({
  selector: 'app-services-marquee',
  imports: [Eyebrow, NgIcon, RevealDirective, CompanionDockDirective],
  providers: [
    provideIcons({
      phosphorBracketsCurlyBold,
      phosphorBrowsersBold,
      phosphorChartScatterBold,
      phosphorCheckBold,
      phosphorClock,
      phosphorCloudArrowUpBold,
      phosphorCpuBold,
      phosphorDatabaseBold,
      phosphorDevicesBold,
      phosphorFileCodeBold,
      phosphorGearSixBold,
      phosphorRobotBold,
    }),
  ],
  templateUrl: './services-marquee.html',
  styleUrl: './services-marquee.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServicesMarquee {
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly hostEl = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  protected readonly viewport = viewChild.required<ElementRef<HTMLDivElement>>('viewport');
  protected readonly reelEl = viewChild.required<ElementRef<HTMLDivElement>>('reelTrack');

  protected readonly reel = computed<ReelItem[]>(() => {
    const out: ReelItem[] = [];
    for (let s = 0; s < SET_COUNT; s++) {
      for (let i = 0; i < services.length; i++) {
        const sp = services[i];
        out.push({
          ...sp,
          reelKey: `${sp.slug}-${s}-${i}`,
          sequence: `${i + 1}`.padStart(2, '0'),
        });
      }
    }
    return out;
  });

  protected readonly isDragging = signal(false);

  // Offset horizontal del reel. Negativo = avanzando hacia la izquierda
  // (cards entrando por la derecha). Arranca en -W (set del medio).
  private currentX = 0;
  // Ancho de un set (10 cards). Se mide en afterNextRender y se actualiza
  // con ResizeObserver.
  private setWidth = 0;

  // Estado del rAF / pausa.
  private rafId = 0;
  private lastFrameT = 0;
  private lastUserInputAt = 0;
  // True mientras hay un dedo/cursor apoyado sobre el carrusel (independiente
  // de si está dragueando o sólo apoyado leyendo). Mientras true, auto-scroll
  // no avanza.
  private isPointerDown = false;
  private prefersReducedMotion = false;
  private intersectionObs: IntersectionObserver | null = null;
  private resizeObs: ResizeObserver | null = null;
  private isOnScreen = false;

  private dragState: DragState | null = null;
  // Velocidad de momentum activo (px/ms). 0 cuando no hay momentum.
  private momentumVelocity = 0;

  protected statusToneAttr(status: ServiceStatus): string {
    return STATUS_TONES[status];
  }

  protected statusLabel(status: ServiceStatus): string {
    return STATUS_LABEL[status];
  }

  constructor() {
    afterNextRender(() => {
      if (!this.isBrowser) return;

      this.prefersReducedMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches;

      this.measureSet();
      // Arranca en el set del medio. Si por cualquier razón setWidth=0
      // (layout no listo), queda en 0 y el rAF re-mide en el primer tick.
      this.currentX = -this.setWidth;
      this.applyTransform();

      // ResizeObserver — los cards son responsive (clamp). Cuando cambia
      // viewport o las fonts cargan, scrollWidth cambia → remeasure y
      // re-normaliza currentX al set del medio.
      this.resizeObs = new ResizeObserver(() => {
        const prevW = this.setWidth;
        this.measureSet();
        if (this.setWidth > 0 && prevW !== this.setWidth) {
          // Convertir currentX al equivalente proporcional en el nuevo W.
          // Sin esto, un resize visible "salta" la cinta. Si prevW era 0
          // (primera medición), arrancamos en -newW (set del medio).
          if (prevW > 0) {
            this.currentX = (this.currentX / prevW) * this.setWidth;
            this.normalizeX();
          } else {
            this.currentX = -this.setWidth;
          }
          this.applyTransform();
        }
      });
      this.resizeObs.observe(this.reelEl().nativeElement);

      // IntersectionObserver — sólo corre auto-scroll cuando la sección
      // está a la vista. Threshold 0.05 porque la sección es alta.
      this.intersectionObs = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            this.isOnScreen = e.isIntersecting;
          }
        },
        { threshold: 0.05 },
      );
      this.intersectionObs.observe(this.hostEl.nativeElement);

      document.addEventListener('visibilitychange', this.onVisibilityChange);

      this.rafId = requestAnimationFrame(this.tick);

      this.destroyRef.onDestroy(() => {
        if (this.rafId) {
          cancelAnimationFrame(this.rafId);
          this.rafId = 0;
        }
        this.resizeObs?.disconnect();
        this.resizeObs = null;
        this.intersectionObs?.disconnect();
        this.intersectionObs = null;
        document.removeEventListener('visibilitychange', this.onVisibilityChange);
      });
    });
  }

  // ─── Layout + transform ────────────────────────────────────────────────
  private measureSet(): void {
    const reel = this.reelEl().nativeElement;
    // scrollWidth incluye los 30 cards × margins. /3 = ancho de un set
    // (10 cards). El margin-right de la última card cuenta también — no
    // afecta porque los 3 sets son simétricos y el ratio es exacto.
    this.setWidth = reel.scrollWidth / SET_COUNT;
  }

  private applyTransform(): void {
    // translate3d (no translateX) → promote al compositor GPU, render
    // sin layout reflow. La z=0 es el truco para forzar layer creation.
    this.reelEl().nativeElement.style.transform =
      `translate3d(${this.currentX}px, 0, 0)`;
  }

  // Wrap del offset al rango (-2W, 0]. Cada wrap es visualmente invisible
  // porque cada set es idéntico al siguiente. Loop infinito sin saltos.
  private normalizeX(): void {
    const W = this.setWidth;
    if (W <= 0) return;
    while (this.currentX <= -2 * W) this.currentX += W;
    while (this.currentX > 0) this.currentX -= W;
  }

  // ─── rAF loop ──────────────────────────────────────────────────────────
  private readonly tick = (t: number): void => {
    this.rafId = requestAnimationFrame(this.tick);

    if (this.lastFrameT === 0) {
      this.lastFrameT = t;
      return;
    }
    const dtMs = t - this.lastFrameT;
    this.lastFrameT = t;

    // setWidth puede ser 0 si la primera medición fue antes de que el
    // layout estuviera listo. Re-medir hasta tener un valor.
    if (this.setWidth <= 0) {
      this.measureSet();
      if (this.setWidth > 0) {
        this.currentX = -this.setWidth;
        this.applyTransform();
      }
      return;
    }

    // Momentum tiene prioridad sobre auto-scroll. Mientras hay velocidad
    // residual de un drag, decae con friction exponencial.
    if (this.momentumVelocity !== 0) {
      this.currentX += this.momentumVelocity * dtMs;
      // Friction normalizada por frame de 60Hz, ajustada a dt real:
      // un frame de 16.7ms aplica friction una vez; 33.3ms aplica al
      // cuadrado; 8.3ms aplica raíz. Mantiene la sensación consistente
      // entre 60Hz y 120Hz displays.
      const frames = dtMs / FRICTION_REFERENCE_FRAME_MS;
      this.momentumVelocity *= Math.pow(MOMENTUM_FRICTION, frames);
      if (Math.abs(this.momentumVelocity) < MOMENTUM_STOP_VELOCITY) {
        this.momentumVelocity = 0;
        // Al terminar momentum, lastUserInputAt arranca el countdown del
        // IDLE_TIMEOUT desde ahora — no desde el pointerup original.
        this.lastUserInputAt = t;
      }
      this.normalizeX();
      this.applyTransform();
      return;
    }

    // Gates de "no auto-scroll":
    //   • prefersReducedMotion → el usuario pidió no animar
    //   • pestaña oculta → no consumir CPU
    //   • sección fuera de viewport → idem
    //   • drag horizontal activo → el usuario está controlando
    //   • dedo/cursor apoyado (incluso sin draguear) → "estoy leyendo,
    //     no me muevas la cinta"
    if (
      this.prefersReducedMotion ||
      document.hidden ||
      !this.isOnScreen ||
      this.dragState !== null ||
      this.isPointerDown
    ) {
      return;
    }

    const sinceInput = t - this.lastUserInputAt;
    if (sinceInput < IDLE_TIMEOUT_MS) return;

    // Ramp smoothstep desde 0 → velocidad nominal sobre RESUME_RAMP_MS.
    // smoothstep(x) = x²(3 - 2x) — C¹ continuo, sin tirón.
    const rampRaw = Math.min(
      1,
      (sinceInput - IDLE_TIMEOUT_MS) / RESUME_RAMP_MS,
    );
    const ramp = rampRaw * rampRaw * (3 - 2 * rampRaw);

    const pxPerSec = this.setWidth / SECONDS_PER_CYCLE;
    // Avanza hacia la izquierda (currentX se hace más negativo).
    this.currentX -= (pxPerSec / 1000) * ramp * dtMs;
    this.normalizeX();
    this.applyTransform();
  };

  private readonly onVisibilityChange = (): void => {
    if (!document.hidden) {
      // Al volver al foreground, resetear lastFrameT para que el primer
      // tick no calcule un dt enorme (que produciría un salto visible).
      this.lastFrameT = 0;
      this.lastUserInputAt = performance.now();
    }
  };

  // ─── Pointer handlers ──────────────────────────────────────────────────
  protected onPointerDown(e: PointerEvent): void {
    this.lastUserInputAt = performance.now();
    this.isPointerDown = true;
    // Cualquier toque mata el momentum activo. Comportamiento estándar:
    // el usuario "atrapa" la cinta inercial al tocarla.
    this.momentumVelocity = 0;

    this.dragState = {
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startOffset: this.currentX,
      // Mouse y pen lockeamos eje inmediatamente como horizontal (no hay
      // ambigüedad con cursores precisos). Touch espera al primer movimiento
      // para decidir.
      isAxisLocked: e.pointerType === 'mouse' || e.pointerType === 'pen',
      isHorizontal: e.pointerType === 'mouse' || e.pointerType === 'pen',
      lastClientX: e.clientX,
      lastT: performance.now(),
      velocity: 0,
    };

    if (e.pointerType === 'mouse' || e.pointerType === 'pen') {
      // Mouse/pen: capture inmediato y modo dragging visible.
      this.viewport().nativeElement.setPointerCapture(e.pointerId);
      this.isDragging.set(true);
      // preventDefault para evitar arrastre fantasma de imágenes/texto.
      e.preventDefault();
    }
    // Touch: NO setPointerCapture acá — esperamos al primer pointermove
    // para decidir si es horizontal (capturamos + tomamos control) o
    // vertical (liberamos para que el browser haga scroll de página).
  }

  protected onPointerMove(e: PointerEvent): void {
    if (this.dragState === null || e.pointerId !== this.dragState.pointerId) {
      return;
    }

    // Decisión de eje para touch — sólo se ejecuta una vez por gesto.
    if (!this.dragState.isAxisLocked) {
      const dx = Math.abs(e.clientX - this.dragState.startClientX);
      const dy = Math.abs(e.clientY - this.dragState.startClientY);

      // Aún sin movimiento significativo — esperamos.
      if (dx < AXIS_LOCK_THRESHOLD_PX && dy < AXIS_LOCK_THRESHOLD_PX) return;

      this.dragState.isAxisLocked = true;
      this.dragState.isHorizontal = dx > dy;

      if (this.dragState.isHorizontal) {
        // Tomamos control: capturamos pointer (eventos siguen llegando
        // aunque el dedo se vaya del viewport) y marcamos dragging.
        this.viewport().nativeElement.setPointerCapture(e.pointerId);
        this.isDragging.set(true);
      } else {
        // Gesto vertical — soltamos el pointer y dejamos que el browser
        // haga scroll de página. isPointerDown queda true mientras el
        // dedo no se levante (auto-scroll pausa) pero no conducimos el
        // movimiento. dragState se limpia para que pointermove subsequente
        // sea ignorado.
        this.dragState = null;
        return;
      }
    }

    if (!this.dragState.isHorizontal) return;

    const now = performance.now();
    const delta = e.clientX - this.dragState.startClientX;
    this.currentX = this.dragState.startOffset + delta;
    this.normalizeX();
    this.applyTransform();

    // Velocity tracking — la usamos para momentum al soltar. Filtro: si
    // dt es muy chico (eventos rapid-fire), la velocidad calculada es
    // inestable; ignoramos.
    const dt = now - this.dragState.lastT;
    if (dt > 4) {
      this.dragState.velocity = (e.clientX - this.dragState.lastClientX) / dt;
      this.dragState.lastClientX = e.clientX;
      this.dragState.lastT = now;
    }
    this.lastUserInputAt = now;

    // preventDefault en pointermove horizontal — refuerza que el browser
    // no intente nada con este gesto (defensive, en casos edge donde
    // touch-action: pan-y no fue suficiente).
    e.preventDefault();
  }

  protected onPointerUp(e: PointerEvent): void {
    // isPointerDown se limpia SIEMPRE en pointerup, incluso si dragState
    // ya era null (por ejemplo, gesto vertical que liberó el pointer).
    // Esto reactiva el auto-scroll después del IDLE_TIMEOUT.
    this.isPointerDown = false;
    this.lastUserInputAt = performance.now();

    if (this.dragState === null || e.pointerId !== this.dragState.pointerId) {
      return;
    }

    const viewport = this.viewport().nativeElement;
    if (viewport.hasPointerCapture(e.pointerId)) {
      viewport.releasePointerCapture(e.pointerId);
    }

    // Aplica momentum sólo si el gesto fue horizontal y tiene velocidad
    // suficiente. Cap a MAX para evitar flicks ridículos.
    if (this.dragState.isHorizontal) {
      let v = this.dragState.velocity;
      if (Math.abs(v) > MOMENTUM_STOP_VELOCITY) {
        v = Math.max(
          -MOMENTUM_MAX_VELOCITY_PX_PER_MS,
          Math.min(MOMENTUM_MAX_VELOCITY_PX_PER_MS, v),
        );
        this.momentumVelocity = v;
      }
    }

    this.dragState = null;
    this.isDragging.set(false);
  }

  protected onWheel(e: WheelEvent): void {
    // Trackpad horizontal pan o shift+wheel → conducimos el carrusel.
    // Wheel vertical normal NO se intercepta — el browser hace scroll de
    // página, exactamente como el resto del sitio.
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
      e.preventDefault();
      const delta = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX;
      this.currentX -= delta;
      this.normalizeX();
      this.applyTransform();
      this.lastUserInputAt = performance.now();
      // Wheel no genera pointerdown/up — momentum residual del trackpad
      // ya viene del propio sistema, no necesitamos simular el nuestro.
      this.momentumVelocity = 0;
    }
  }
}
