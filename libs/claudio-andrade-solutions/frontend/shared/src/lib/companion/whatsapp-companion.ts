import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

import { WhatsappHub } from '../components/whatsapp-hub/whatsapp-hub';
import { CompanionDockRegistry, type CompanionDock } from './companion-dock.service';
import { CompanionFishRenderer, type CompanionFishState } from './companion-fish';

type SwimState = 'idle' | 'swimming';

interface Vec {
  x: number;
  y: number;
}

/**
 * WhatsappCompanion — pieza global que sigue al usuario por las secciones
 * de la home. Botón WhatsApp 32px que se ancla al borde derecho del dock
 * activo. Al cambiar de dock por scroll, el botón desaparece y emerge un
 * pez verde (mismo modelo three.js que el hero) que nada por una curva
 * Bezier predeterminada al nuevo dock, donde vuelve a ser botón.
 *
 * Reglas clave (calibradas tras feedback del usuario):
 *
 *   1) **Una sola ruta en vuelo a la vez.** Mientras el pez nada, los
 *      cambios de dock activo solo actualizan `queuedTargetId`. Cuando el
 *      swim termina, si hay queued !== actual, arranca un swim NUEVO al
 *      último target. Esto evita el "pez perdido" del scroll rápido: en
 *      vez de re-puntearse a un nuevo destino cada 100ms, ejecuta swims
 *      completos secuenciales.
 *
 *   2) **Pivot congelado durante la espera del swim.** Cuando un dock
 *      cambia, NO seguimos el dock viejo via scroll (sino el pez
 *      "arrancaría" desde una posición que ya no existe en pantalla).
 *      El pivot queda donde estaba hasta que el swim arranca; el swim
 *      arranca desde ahí.
 *
 *   3) **Start/end clamped al viewport.** Si el dock anterior ya quedó
 *      off-screen (caso típico del scroll rápido al subir), el swimStart
 *      se clamp al borde del viewport más cercano. Resultado: el pez
 *      siempre ENTRA y SALE por un borde visible — nunca aparece
 *      "del cielo" o se queda fuera de pantalla.
 *
 *   4) **Tamaño compacto.** FISH_SIZE 10 → body ~70px. Lectura "guía
 *      visual", no "criatura dominante".
 */
@Component({
  selector: 'app-whatsapp-companion',
  imports: [WhatsappHub],
  templateUrl: './whatsapp-companion.html',
  styleUrl: './whatsapp-companion.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WhatsappCompanion {
  private readonly registry = inject(CompanionDockRegistry);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly hub = viewChild<WhatsappHub>('hub');
  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('fishCanvas');
  private readonly pivotRef = viewChild<ElementRef<HTMLElement>>('pivot');

  protected readonly activeDockId = signal<string | null>(null);
  protected readonly swimState = signal<SwimState>('idle');
  protected readonly hasDocks = computed(() => this.registry.docks().length > 0);

  // Posición actual del pivot (viewport coords). El transform del pivot
  // se actualiza desde acá cada frame que cambia.
  private current: Vec = { x: 0, y: 0 };

  // Dock al que el companion está actualmente anclado. Diferente de
  // `activeDockId()`: ese es el dock DETECTADO por el scroll; éste es el
  // dock al que el pivot está visualmente asociado. Diverge mientras
  // el swim está en curso.
  private dockedId: string | null = null;

  // ─── Swim state ───────────────────────────────────────────────────────
  private swimStart: Vec = { x: 0, y: 0 };
  private swimEnd: Vec = { x: 0, y: 0 };
  private swimStartTime = 0;
  // 1500ms = swim corto, evita que el pez se sienta "estorbando" la pantalla
  // durante mucho tiempo. Suficiente para leer la trayectoria sin agotar al ojo.
  private readonly SWIM_DURATION_MS = 1500;

  private rafId = 0;
  private dirty = false;
  // Offset del centro del companion respecto al borde derecho del dock.
  // 16px ≈ 4px de aire visual + radio del trigger (16). Matchea el
  // espaciado del lockup original del hero (Hablemos + icon con gap
  // 12px) — el user pidió que volviera a esa posición.
  private readonly DOCK_OFFSET_X = 16;
  // Tiempo de scroll-settle antes de comprometerse a un swim. Mientras
  // el dock activo cambia rápidamente (scroll fast), cada cambio reinicia
  // el timer. Cuando el scroll para, 250ms después arranca el swim al
  // dock final. Resultado: UN solo swim por sesión de scroll, no cadena
  // de swims encadenados (eso era el "el pez no sabe a dónde ir").
  private readonly DOCK_DEBOUNCE_MS = 250;
  private dockChangeDebounceTimer = 0;
  // Última activeDockId que sí fue scheduleada para evitar resetear el timer
  // de debounce en cada frame del rAF continuo. Solo re-schedule cuando el
  // active dock cambia respecto al último que disparó scheduleDebouncedSwim.
  private lastScheduledActiveId: string | null = null;

  // ─── Fish renderer ────────────────────────────────────────────────────
  private fishRenderer: CompanionFishRenderer | null = null;
  private fishReady = false;
  private swimPhase = 0;
  // Tamaño intermedio — body ~100px (size 14 * 7). Mid-point entre el
  // 18 inicial (muy grande, "criatura dominante") y el 10 anterior
  // (muy chico, "pez invisible"). Lectura: presencia clara sin
  // dominar el viewport.
  private readonly FISH_SIZE = 14;

  constructor() {
    afterNextRender(() => {
      if (!isPlatformBrowser(this.platformId)) return;
      this.setupTracking();
      this.initFishRenderer();
    });

    effect(() => {
      this.registry.docks();
      if (isPlatformBrowser(this.platformId)) {
        this.dirty = true;
        this.scheduleRaf();
      }
    });

    this.destroyRef.onDestroy(() => {
      if (this.rafId) cancelAnimationFrame(this.rafId);
      if (this.dockChangeDebounceTimer) clearTimeout(this.dockChangeDebounceTimer);
      this.fishRenderer?.dispose();
    });
  }

  private async initFishRenderer(): Promise<void> {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const renderer = new CompanionFishRenderer();
    try {
      await renderer.init(canvas, w, h);
      this.fishRenderer = renderer;
      this.fishReady = true;
    } catch (err) {
      console.warn('[WhatsappCompanion] fish init failed:', err);
    }
  }

  private setupTracking(): void {
    const onScroll = () => {
      this.dirty = true;
      this.scheduleRaf();
    };
    const onResize = () => {
      this.dirty = true;
      const canvas = this.canvasRef()?.nativeElement;
      if (canvas && this.fishRenderer) {
        this.fishRenderer.resize(window.innerWidth, window.innerHeight);
      }
      this.scheduleRaf();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });

    this.destroyRef.onDestroy(() => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    });

    this.dirty = true;
    this.scheduleRaf();
  }

  private scheduleRaf(): void {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      this.tick();
      // rAF continuo: tick() re-lee el rect del dock cada frame para que el
      // ícono se mantenga pegado aún si el dock se mueve por otra animación
      // (ej. .reveal con `transform: translateY(28px) → 0` durante 400ms).
      // Sin esto, si el user para el scroll mid-reveal, el ícono se queda
      // anclado a la posición pre-reveal y se ve desalineado del eyebrow.
      // El cost es despreciable: 1 getBoundingClientRect + 1 setProperty
      // por frame.
      this.scheduleRaf();
    });
  }

  private tick(): void {
    if (this.dirty) {
      this.dirty = false;
      this.recomputeActiveDock();
    }

    if (this.swimState() === 'swimming') {
      // Swim locked — no interrumpimos NUNCA. Sigue su path A→B
      // pase lo que pase con el scroll. Regla del user: "no se puede
      // mover de ahí, cumple la animación".
      this.tickSwim();
      return;
    }

    // Estado idle.
    const active = this.activeDockId();
    if (!active) return;

    // Primera vez (sin docked previo) — teleport sin animar al active.
    if (this.dockedId === null) {
      const dock = this.registry.docks().find((d) => d.id === active);
      if (!dock) return;
      this.current = this.computeDockPosition(dock);
      this.dockedId = active;
      this.applyTransform();
      return;
    }

    // Anclado a la PÁGINA: el ícono SIEMPRE sigue al rect actual del dock
    // viejo (el "docked"). Cuando el user scrollea, getBoundingClientRect
    // devuelve la viewport position del dock — si el dock está fuera del
    // viewport (user scrolleó pasado de él), el ícono también queda fuera
    // del viewport. Igual que los peces ambientales del hero: viven en su
    // sección, no en la pantalla del user.
    const docked = this.registry.docks().find((d) => d.id === this.dockedId);
    if (docked) {
      this.current = this.computeDockPosition(docked);
      this.applyTransform();
    }

    // Si el active diverge del docked, schedule swim al active. El swim
    // arranca 250ms después del último cambio. Durante el wait, el ícono
    // sigue al dock viejo (que puede irse del viewport si el user scrollea).
    //
    // IMPORTANTE: solo re-schedule si el active CAMBIÓ respecto al último
    // que fue scheduleado. Con rAF continuo, sin este guard, scheduleDebounced
    // se llamaría cada frame y resetaría el timer infinitamente — el swim
    // nunca arrancaría.
    if (active !== this.dockedId && active !== this.lastScheduledActiveId) {
      this.lastScheduledActiveId = active;
      this.scheduleDebouncedSwim();
    } else if (active === this.dockedId) {
      // Llegamos al docked (puede pasar si el swim ya terminó). Reset el
      // tracker para que un futuro cambio dispare un nuevo schedule.
      this.lastScheduledActiveId = null;
    }
  }

  /**
   * Programar un swim al dock activo actual, esperando DOCK_DEBOUNCE_MS
   * desde el último cambio. Si el dock activo sigue cambiando (scroll
   * rápido), el timer se reinicia y nada arranca. Cuando el scroll para,
   * 250ms después el swim arranca hacia el dock final. Una sola animación
   * por sesión de scroll — sin cadenas.
   */
  private scheduleDebouncedSwim(): void {
    if (this.dockChangeDebounceTimer) {
      clearTimeout(this.dockChangeDebounceTimer);
    }
    this.dockChangeDebounceTimer = setTimeout(() => {
      this.dockChangeDebounceTimer = 0;
      // Re-check todo en el momento del fire — el scroll pudo haber
      // movido el dock activo desde que se programó.
      if (this.swimState() !== 'idle') return;
      const active = this.activeDockId();
      if (!active || active === this.dockedId) return;
      const dock = this.registry.docks().find((d) => d.id === active);
      if (!dock) return;
      const target = this.computeDockPosition(dock);
      this.startSwim(target, active);
    }, this.DOCK_DEBOUNCE_MS) as unknown as number;
  }

  private recomputeActiveDock(): void {
    const docks = this.registry.docks();
    if (docks.length === 0) {
      this.activeDockId.set(null);
      return;
    }
    const triggerY = window.innerHeight * 0.35;
    let bestId = docks[0].id;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const dock of docks) {
      const rect = dock.el.getBoundingClientRect();
      const centerY = rect.top + rect.height / 2;
      const dist = Math.abs(centerY - triggerY);
      if (dist < bestDist) {
        bestDist = dist;
        bestId = dock.id;
      }
    }
    if (bestId !== this.activeDockId()) {
      this.activeDockId.set(bestId);
    }
  }

  private computeDockPosition(dock: CompanionDock): Vec {
    const rect = dock.el.getBoundingClientRect();
    // El dock puede declarar un offsetX propio (útil para anchors tipo
    // pill con padding interno, donde el default 16 deja el ícono pegado
    // al borde redondeado). Si no, usar el global DOCK_OFFSET_X (16).
    const offsetX = dock.offsetX ?? this.DOCK_OFFSET_X;
    return {
      x: rect.right + offsetX,
      y: rect.top + rect.height / 2,
    };
  }

  private startSwim(targetViewport: Vec, targetId: string): void {
    // CLAVE: swimStart/swimEnd se guardan en COORDS DE PÁGINA (no viewport).
    // El renderer convierte page→viewport restando scrollY al pintar. Esto
    // hace que el pez NO siga el scroll — es como los peces ambientales del
    // hero, que viven en el canvas del hero y no en el viewport. Si el user
    // scrollea, el pez sigue su trayecto en el espacio de la página y
    // aparece/desaparece del viewport naturalmente (no "viaja con el scroll").
    const scrollY = window.scrollY;
    // A: posición de PÁGINA del dock viejo (donde estaba el ícono ahora).
    // Calculada desde el elemento del dock para que sea exacta aún si el
    // user scrolleó durante el debounce.
    const oldDock = this.dockedId
      ? this.registry.docks().find((d) => d.id === this.dockedId)
      : null;
    const aViewport = oldDock ? this.computeDockPosition(oldDock) : this.current;
    this.swimStart = { x: aViewport.x, y: aViewport.y + scrollY };
    // B: posición de PÁGINA del dock nuevo.
    this.swimEnd = { x: targetViewport.x, y: targetViewport.y + scrollY };
    this.swimStartTime = performance.now();
    this.swimPhase = 0;
    this.swimState.set('swimming');
    this.dockedId = targetId;
    this.hub()?.close();
    this.scheduleRaf();
  }

  /**
   * Path FIJO del pez — independiente de scroll up/down. Línea recta entre
   * swimStart y swimEnd con un sin-bulge perpendicular SIEMPRE hacia la
   * izquierda (toward smaller X). Esto da la misma forma de animación sin
   * importar si el user scrollea hacia abajo o arriba, y mantiene al pez
   * fuera de la zona central de contenido (cards, títulos).
   *
   *   t ∈ [0, 1]
   *   pos(t) = lerp(A, B, t) + perpLeft(A→B) · sin(πt) · amp
   *
   * Returns: posición + heading tangencial para orientar el pez.
   */
  private swimAt(t: number): { pos: Vec; heading: number } {
    const A = this.swimStart;
    const B = this.swimEnd;
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len = Math.hypot(dx, dy) || 1;
    // Linear interp
    const lx = A.x + dx * t;
    const ly = A.y + dy * t;
    // Perpendicular SIEMPRE apunta a la IZQUIERDA en screen coords (perpX ≤ 0).
    // Rotamos (dx,dy) 90° CCW → (-dy, dx). Si eso da perpX > 0, lo invertimos
    // para garantizar dirección consistente sin importar la orientación A→B.
    let perpX = -dy / len;
    let perpY = dx / len;
    if (perpX > 0) {
      perpX = -perpX;
      perpY = -perpY;
    }
    // Amplitud: 18% de la distancia, capped a 160px. Para swims cortos el
    // arco es chico; para largos no se vuelve excesivo.
    const amp = Math.min(len * 0.18, 160);
    const bulge = Math.sin(t * Math.PI) * amp;
    const pos = {
      x: lx + perpX * bulge,
      y: ly + perpY * bulge,
    };
    // Heading: derivada analítica del path en t (tangente).
    //   d/dt [linear] = (dx, dy)
    //   d/dt [perp · sin(πt) · amp] = perp · cos(πt) · π · amp
    const dBulge = Math.cos(t * Math.PI) * Math.PI * amp;
    const tx = dx + perpX * dBulge;
    const ty = dy + perpY * dBulge;
    const heading = Math.atan2(ty, tx);
    return { pos, heading };
  }

  private tickSwim(): void {
    const now = performance.now();
    const elapsed = now - this.swimStartTime;
    const t = Math.min(1, elapsed / this.SWIM_DURATION_MS);
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    // swimAt devuelve pos en coords de PÁGINA. Convertir a viewport para el
    // renderer (que pinta sobre canvas position:fixed en viewport coords).
    // Esto es lo que hace que el pez NO se mueva con el scroll: la posición
    // de página es fija (locked en swim-start), pero la viewport position
    // cambia naturalmente cuando el user scrollea — el pez se ve salir/entrar
    // del viewport como cualquier elemento estático en la página.
    const { pos: pagePos, heading } = this.swimAt(eased);
    const viewportPos: Vec = { x: pagePos.x, y: pagePos.y - window.scrollY };

    if (this.fishReady && this.fishRenderer) {
      this.swimPhase += 0.18;

      // Effort fade-in/out — wave amplitude crece al despegar y baja al
      // anclar. Esto suaviza la emergencia desde el botón y la llegada
      // al destino sin "stops" abruptos.
      const fadeIn = Math.min(t / 0.18, 1);
      const fadeOut = Math.min((1 - t) / 0.18, 1);
      const effort = Math.max(0, Math.min(1, fadeIn * fadeOut));

      const state: CompanionFishState = {
        headX: viewportPos.x,
        headY: viewportPos.y,
        heading,
        size: this.FISH_SIZE,
        swimPhase: this.swimPhase,
        bodyEffort: effort * 0.9,
        swimGate: effort,
      };
      this.fishRenderer.update(state);
      this.fishRenderer.render();
    }

    if (t >= 1) {
      // Swim terminado. Snap del ícono a la posición VIEWPORT del nuevo dock
      // (recomputada ahora, así toma el scrollY actual — el user pudo haber
      // scrolleado durante el swim, y queremos el ícono pegado al dock real,
      // no a la posición de viewport que tenía al iniciar el swim).
      const newDock = this.registry.docks().find((d) => d.id === this.dockedId);
      this.current = newDock
        ? this.computeDockPosition(newDock)
        : { x: this.swimEnd.x, y: this.swimEnd.y - window.scrollY };
      this.applyTransform();
      this.swimState.set('idle');

      // Limpiamos el canvas 220ms más tarde — eso le da tiempo al hub
      // a aparecer (CSS transition 200ms) ON TOP del último frame del
      // pez. El ojo lee "el pez se convirtió en botón" en vez de
      // "pez desaparece + botón aparece" (el pluff feo).
      if (this.fishReady && this.fishRenderer) {
        setTimeout(() => {
          // Si arrancó otro swim mientras esperábamos, no limpiar.
          if (this.swimState() !== 'swimming') {
            const canvas = this.canvasRef()?.nativeElement;
            const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
            if (gl) {
              gl.clearColor(0, 0, 0, 0);
              gl.clear(gl.COLOR_BUFFER_BIT);
            }
          }
        }, 220);
      }

      // Re-evaluar el dock activo. Si el user siguió scrolleando durante
      // el swim, el active dock probablemente cambió. La debounce volverá
      // a disparar UN swim adicional al dock final cuando el scroll se
      // calme — no encadenado, sino programado tras 250ms de scroll-stop.
      this.dirty = true;
      this.scheduleRaf();
      return;
    }

    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      this.tick();
    });
  }

  private applyTransform(): void {
    const pivot = this.pivotRef()?.nativeElement;
    if (!pivot) return;
    pivot.style.transform = `translate3d(${this.current.x}px, ${this.current.y}px, 0)`;
  }
}
