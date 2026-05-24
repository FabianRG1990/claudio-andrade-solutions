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
  private swimP1: Vec = { x: 0, y: 0 };
  private swimP2: Vec = { x: 0, y: 0 };
  private swimStartTime = 0;
  private readonly SWIM_DURATION_MS = 2000;

  private rafId = 0;
  private dirty = false;
  // Offset del centro del companion respecto al borde derecho del dock.
  // 16px ≈ 4px de aire visual + radio del trigger (16). Matchea el
  // espaciado del lockup original del hero (Hablemos + icon con gap
  // 12px) — el user pidió que volviera a esa posición.
  private readonly DOCK_OFFSET_X = 16;
  // Margen del viewport para clamping. El pez entra/sale por aquí (no
  // exactamente en el borde) para que el ojo perciba "viene de afuera"
  // sin que aparezca pegado al edge.
  private readonly VIEWPORT_MARGIN = 80;
  // Tiempo de scroll-settle antes de comprometerse a un swim. Mientras
  // el dock activo cambia rápidamente (scroll fast), cada cambio reinicia
  // el timer. Cuando el scroll para, 250ms después arranca el swim al
  // dock final. Resultado: UN solo swim por sesión de scroll, no cadena
  // de swims encadenados (eso era el "el pez no sabe a dónde ir").
  private readonly DOCK_DEBOUNCE_MS = 250;
  private dockChangeDebounceTimer = 0;

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
    const onScroll = () => { this.dirty = true; this.scheduleRaf(); };
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

    if (active !== this.dockedId) {
      // Dock activo cambió respecto al docked actual.
      //
      // Primera vez (sin docked previo) — teleport sin animar.
      if (this.dockedId === null) {
        const dock = this.registry.docks().find((d) => d.id === active);
        if (!dock) return;
        this.current = this.computeDockPosition(dock);
        this.dockedId = active;
        this.applyTransform();
        return;
      }
      // Caso normal: schedule swim con debounce. El swim arranca
      // 250ms después de que el dock activo deje de cambiar. Mientras
      // el user esté scrolleando rápido, el timer se reinicia y el
      // pez NUNCA aparece a medio camino — solo cuando el scroll se
      // calma, el swim ÚNICO A→B se dispara hacia el dock final.
      this.scheduleDebouncedSwim();
    } else {
      // Mismo dock — el companion sigue el rect del eyebrow mientras
      // el user scrollea dentro de la sección. NO es swim, solo
      // tracking sin animación. Aquí no se renderiza pez.
      const dock = this.registry.docks().find((d) => d.id === active);
      if (!dock) return;
      const target = this.computeDockPosition(dock);
      this.current = target;
      this.applyTransform();
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

  /**
   * Trae un punto al área visible del viewport. Si está más allá del
   * borde, lo proyecta al borde más cercano con un margen. Esto
   * garantiza que el pez SIEMPRE entre/salga por una zona visible — no
   * "desde el cielo" o "del subsuelo".
   */
  private clampToViewport(p: Vec): Vec {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const m = this.VIEWPORT_MARGIN;
    return {
      x: Math.max(m, Math.min(vw - m, p.x)),
      y: Math.max(m, Math.min(vh - m, p.y)),
    };
  }

  private startSwim(targetUnclamped: Vec, targetId: string): void {
    // Clamp ambos extremos al viewport. Si el dock anterior quedó muy
    // arriba (scroll up rápido) o el nuevo aparece desde abajo, el pez
    // entra desde el borde correcto en vez de aparecer en una zona
    // off-screen donde el usuario no lo ve.
    this.swimStart = this.clampToViewport(this.current);
    this.swimEnd = this.clampToViewport(targetUnclamped);

    // Bezier path SIEMPRE arquea por el centro visible. Esto es la
    // "ruta predeterminada" que el user pidió — independiente de la
    // distancia entre docks, la forma del arco es consistente.
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const dy = this.swimEnd.y - this.swimStart.y;

    // Centro X: punto medio entre A y B, pero TRAÍDO HACIA el centro
    // visible — si los docks están a la derecha (típico, viven junto
    // a eyebrows), el arco se ladea a la izquierda donde hay espacio.
    const baseMidX = (this.swimStart.x + this.swimEnd.x) * 0.5;
    const vwCenter = vw / 2;
    const centerPull = Math.min(vw * 0.30, Math.abs(baseMidX - vwCenter));
    const midX = baseMidX + Math.sign(vwCenter - baseMidX) * centerPull;

    // Centro Y: depende de la dirección. Down-scroll (dy>0) → arco abajo
    // (el pez bucea). Up-scroll (dy<0) → arco arriba (el pez sube en
    // arco). Cap a 0.62 / 0.38 del viewport — siempre visible.
    const midY = dy >= 0 ? vh * 0.62 : vh * 0.38;

    this.swimP1 = { x: midX, y: midY };
    this.swimP2 = { x: midX, y: midY };
    this.swimStartTime = performance.now();
    this.swimPhase = 0; // reset wave phase para cada swim — onda arranca limpia
    this.swimState.set('swimming');
    this.dockedId = targetId; // pivot ahora "pertenece" al nuevo dock
    this.hub()?.close();
    this.scheduleRaf();
  }

  private cubicBezier(p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): Vec {
    const it = 1 - t;
    const b0 = it * it * it;
    const b1 = 3 * it * it * t;
    const b2 = 3 * it * t * t;
    const b3 = t * t * t;
    return {
      x: b0 * p0.x + b1 * p1.x + b2 * p2.x + b3 * p3.x,
      y: b0 * p0.y + b1 * p1.y + b2 * p2.y + b3 * p3.y,
    };
  }

  private cubicBezierTangent(p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): Vec {
    const it = 1 - t;
    return {
      x: 3 * it * it * (p1.x - p0.x) + 6 * it * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
      y: 3 * it * it * (p1.y - p0.y) + 6 * it * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y),
    };
  }

  private tickSwim(): void {
    const now = performance.now();
    const elapsed = now - this.swimStartTime;
    const t = Math.min(1, elapsed / this.SWIM_DURATION_MS);
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    const pos = this.cubicBezier(this.swimStart, this.swimP1, this.swimP2, this.swimEnd, eased);

    if (this.fishReady && this.fishRenderer) {
      const tan = this.cubicBezierTangent(this.swimStart, this.swimP1, this.swimP2, this.swimEnd, eased);
      const heading = Math.atan2(tan.y, tan.x);
      this.swimPhase += 0.18;

      // Effort fade-in/out — wave amplitude crece al despegar y baja al
      // anclar. Esto suaviza la emergencia desde el botón y la llegada
      // al destino sin "stops" abruptos.
      const fadeIn = Math.min(t / 0.18, 1);
      const fadeOut = Math.min((1 - t) / 0.18, 1);
      const effort = Math.max(0, Math.min(1, fadeIn * fadeOut));

      const state: CompanionFishState = {
        headX: pos.x,
        headY: pos.y,
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
      // Swim terminado. Lock al swimEnd exacto.
      this.current = this.swimEnd;
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
