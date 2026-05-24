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
  // Signal separado del swimState — controla la visibilidad del hub DOM
  // (ícono WhatsApp). Se setea false al ARRANCAR el swim (no cuando entra
  // a 'swimming' el state), y se vuelve true unos ms ANTES del swim end
  // para que el hub aparezca encima del pez curled (crossfade premium).
  // Sin este signal separado, el hub se ocultaba/aparecía exactamente con
  // los bordes del swim y se veía como "el pez sale del aire" en vez de
  // "el ícono se transformó en pez".
  protected readonly hubVisible = signal(true);

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
  // Timing del swim, dividido en tres tramos:
  //   • MORPH_HEAD_MS — uncurl del orbe en swimStart (hub→pez)
  //   • Path swim — duración efectiva del path A→B
  //   • MORPH_TAIL_MS — curl del pez en swimEnd (pez→hub)
  //
  // Total = HEAD + PATH + TAIL. El path queda en ~1400ms (similar al swim
  // antiguo de 1500ms) y los 250ms de cada extremo cubren la transformación.
  // 250ms es la cadencia premium documentada para morphs orgánicos cortos
  // (Pixar character pose change, Apple Vision Pro icon coalescence): rápido
  // pero leíble — el ojo registra la transición sin sentirse "tirado" por
  // la animación. Más corto se siente "cut"; más largo, "lazy".
  private readonly MORPH_HEAD_MS = 250;
  // Tail morph 350ms (vs 250ms anterior) — la transformación tail es
  // donde el user juzga la calidad del morph. Con 250ms el bend +
  // spin + scale-down se atropellaban: el ojo no alcanzaba a apreciar
  // el detalle de la flexión antes de que la rotación tomara el
  // escenario. 350ms da ~120ms extra para que la flexión easeOutCubic
  // se "lea" como movimiento orgánico de pez antes del spiral.
  private readonly MORPH_TAIL_MS = 350;
  private readonly SWIM_DURATION_MS = 1900;
  // Duración del crossfade pez↔hub (último tramo del swim). 180ms es
  // el sweet spot: suficiente para que el ojo lerpe entre ambos sin
  // ver "salto", corto enough para no quedarse con ambos visibles
  // demasiado tiempo. El user había reportado "el logo aparece antes
  // de que el pez desaparezca" — al acortar la ventana y bajar el
  // tamaño del orbe (50% via scale-down), el crossfade ahora se lee
  // como "el pez se condensó dentro del logo" en vez de "ambos
  // visibles simultáneamente".
  private readonly CROSSFADE_DUR_MS = 180;

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
  // Timer del re-emerge del hub al final del swim. Se programa al inicio
  // del swim para disparar (SWIM - TAIL + 50ms) después, dando un mini
  // overlap visual entre el hub que aparece y el pez que termina de curling.
  private hubEmergeTimer = 0;
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
      if (this.hubEmergeTimer) clearTimeout(this.hubEmergeTimer);
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

  /**
   * Detecta si un dock está actualmente NO RENDERIZADO (display:none en él
   * o algún ancestor). Si el dock está oculto, getBoundingClientRect()
   * devuelve `{top:0, left:0, right:0, bottom:0, width:0, height:0}` —
   * todo en cero. Sin este check, el companion trataría al dock oculto
   * como "candidato active" en (0,0) y posicionaría el hub en la esquina
   * superior izquierda (cortado por el navbar) — bug visible en mobile
   * para el dock "hero" cuyo anchor vive dentro de `.hero__scroll-hint`
   * (display:none < 1100px width).
   *
   * Un dock visible con anchor de tamaño 0 (caso del hero anchor: `width:
   * 0; height: 0`) tendrá width/height en cero pero top/left con su
   * posición real → no caemos en este caso. Solo el rect ABSOLUTO-cero
   * indica display:none.
   */
  private isDockHidden(rect: DOMRect): boolean {
    return (
      rect.width === 0
      && rect.height === 0
      && rect.top === 0
      && rect.left === 0
    );
  }

  private recomputeActiveDock(): void {
    const docks = this.registry.docks();
    if (docks.length === 0) {
      this.activeDockId.set(null);
      return;
    }
    // Algoritmo SIMÉTRICO para scroll-down y scroll-up. Un dock califica
    // como active SOLO si está al menos parcialmente VISIBLE en el
    // viewport Y ha cruzado el trigger (top<=95%vh). Active = el último
    // (mayor order) que califica.
    //
    // ADEMÁS: filtramos docks ocultos (display:none) — sus rects son
    // (0,0,0,0) y harían que el companion intente posicionarse en la
    // esquina superior izquierda del viewport. Bug histórico de
    // responsive: el dock "hero" vive en `.hero__scroll-hint` que tiene
    // display:none < 1100×720. En mobile sin ese filtro, el hub aparecía
    // cortado contra el navbar en (16, 0).
    const vh = window.innerHeight;
    const triggerY = vh * 0.95;
    let activeId: string | null = null;
    for (const dock of docks) {
      const rect = dock.el.getBoundingClientRect();
      // Skip docks no renderizados (display:none en él o ancestor).
      if (this.isDockHidden(rect)) continue;
      // Off-screen ABAJO o aún no llegó al trigger.
      if (rect.top > triggerY) {
        if (activeId !== null) break; // los siguientes están más abajo aún
        continue;
      }
      // Off-screen ARRIBA — invisible, no candidato a active.
      if (rect.top + rect.height < 0) continue;
      // En viewport (al menos parcial) y cruzó el trigger.
      activeId = dock.id;
    }
    if (activeId === null) {
      // Nadie califica. Si ya hay active actual VÁLIDO, lo mantenemos
      // (page-anchored, scrollea con la página naturalmente). Si no,
      // buscamos cualquier dock visible (no oculto) como fallback. Si
      // ningún dock es visible, activeId queda null y el template oculta
      // el pivot — caso mobile inicial donde el único dock razonable es
      // el "hero" pero está display:none.
      const currentActive = this.activeDockId();
      if (currentActive !== null) {
        // Verificar que el active actual no se haya vuelto invisible
        // (raro, pero posible si el layout cambia: resize de mobile a
        // desktop ocultaría docks que antes eran visibles). Si está
        // oculto, NO lo conservamos.
        const currentDock = docks.find((d) => d.id === currentActive);
        if (currentDock) {
          const currentRect = currentDock.el.getBoundingClientRect();
          if (!this.isDockHidden(currentRect)) return;
        }
      }
      for (const dock of docks) {
        const rect = dock.el.getBoundingClientRect();
        if (this.isDockHidden(rect)) continue;
        if (rect.top + rect.height >= 0 && rect.top <= vh) {
          activeId = dock.id;
          break;
        }
      }
      // Sin docks visibles → activeId = null. Template oculta el pivot.
    }
    if (activeId !== this.activeDockId()) {
      this.activeDockId.set(activeId);
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
    // swimStart/swimEnd se guardan en COORDS DE PÁGINA (no viewport). El
    // renderer convierte page→viewport restando scrollY al pintar. Esto
    // hace que el pez NO viaje con el scroll — vive en el espacio de la
    // página y aparece/desaparece del viewport naturalmente.
    const scrollY = window.scrollY;
    // A: posición VIEWPORT del dock viejo (donde el ícono está RealMente
    // — puede estar off-screen si el user scrolleó rápido pasado de él).
    const oldDock = this.dockedId
      ? this.registry.docks().find((d) => d.id === this.dockedId)
      : null;
    const aViewport = oldDock ? this.computeDockPosition(oldDock) : this.current;

    // El swim DEBE arrancar en/cerca de donde el ícono está visible. Tres
    // casos:
    //  (1) Ícono dentro del viewport — pez sale del ícono. Sin clamp.
    //  (2) Ícono OFF-screen arriba (user scrolleó pasado bajando) — pez
    //      entra desde el borde superior del viewport (justo afuera, ~60px
    //      por encima del top). Cruza el borde top en el primer ~5% del
    //      swim → user lo ve venir desde arriba (la dirección del ícono).
    //  (3) Ícono OFF-screen abajo (user scrolleó pasado subiendo, p.ej.
    //      cap-02 → hero) — pez entra desde el borde inferior, 60px abajo
    //      del viewport bottom. Igual lógica.
    //
    // El clamp ESTÁ AFUERA del viewport (no adentro) — antes lo tenía
    // adentro y el user vio al pez "aparecer en medio de pantalla". Ahora
    // entra cruzando el borde naturalmente.
    const vh = window.innerHeight;
    const edgeOffset = 60;
    const minPageY = scrollY - edgeOffset;
    const maxPageY = scrollY + vh + edgeOffset;
    let aPageY = aViewport.y + scrollY;
    if (aPageY < minPageY) aPageY = minPageY;
    else if (aPageY > maxPageY) aPageY = maxPageY;

    const aPage = { x: aViewport.x, y: aPageY };
    const bPage = { x: targetViewport.x, y: targetViewport.y + scrollY };

    this.swimStart = aPage;
    this.swimEnd = bPage;
    this.swimStartTime = performance.now();
    this.swimPhase = 0;
    this.swimState.set('swimming');
    this.dockedId = targetId;
    this.hub()?.close();

    // Hub se oculta INMEDIATAMENTE al arrancar el swim → el CSS hace su
    // fade-out (220ms) concurrente con el pez apareciendo curled-orbe
    // sobre la misma posición. El ojo lee "el ícono se condensó en el
    // pez" porque ambos ocupan el mismo espacio en transición.
    this.hubVisible.set(false);
    // Programar el re-emerge: SWIM - TAIL + 50ms después del start, el
    // hub vuelve a estar visible. CSS lo fadea in (220ms) sobre el pez
    // que está completando su curl en el destino → el ojo lee "el pez
    // se condensó en el ícono" (cierre del loop simétrico).
    if (this.hubEmergeTimer) clearTimeout(this.hubEmergeTimer);
    this.hubEmergeTimer = setTimeout(() => {
      this.hubEmergeTimer = 0;
      // Solo emerger si todavía estamos swimming (no si el swim fue
      // interrumpido o ya terminó por otra razón).
      if (this.swimState() === 'swimming') {
        // Snap del pivot al dock NUEVO antes de hacer visible el hub:
        // durante el swim el pivot estaba congelado en el dock VIEJO,
        // así que si lo hiciéramos visible ahí, aparecería en el lugar
        // equivocado. El fish-canvas pinta el pez curled en la posición
        // del newDock (swimEnd), y queremos que el hub fade-in suceda
        // exactamente encima. El user no ve el "jump" porque el hub está
        // a opacity 0 cuando lo movemos.
        const newDock = this.registry.docks().find((d) => d.id === this.dockedId);
        if (newDock) {
          this.current = this.computeDockPosition(newDock);
          this.applyTransform();
        }
        this.hubVisible.set(true);
      }
    }, this.SWIM_DURATION_MS - this.CROSSFADE_DUR_MS) as unknown as number;

    this.scheduleRaf();
  }

  /**
   * Path CASI RECTO entre swimStart y swimEnd, con un sin-bulge perpendicular
   * MUY sutil (≤ 40px) que evita la línea geométricamente perfecta sin caer
   * en media-luna. La curvatura visible del nado viene de la onda corporal
   * carangiform (companion-fish.ts), no del path — un pez real avanza
   * casi recto y su cuerpo oscila lateralmente sobre esa trayectoria.
   *
   *   t ∈ [0, 1]
   *   pos(t) = lerp(A, B, t) + perpLeft(A→B) · sin(πt) · amp
   *   amp    = min(len · 0.04, 40)
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
    // Amplitud baja — 4% de la distancia, capped a 40px. Casi recto: el ojo
    // lee "el pez nada en línea hacia el destino" en vez de "el pez dibuja
    // una media luna". La sensación de natación viene del cuerpo (wave),
    // no del path.
    const amp = Math.min(len * 0.04, 40);
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

    // ─── Fase de la transformación ────────────────────────────────────
    // El swim se divide en HEAD (uncurl) → PATH → TAIL (curl). Cada fase
    // expone su propio progreso, y derivamos:
    //   • pathT      — t∈[0,1] dentro del path (clampado a 0 en HEAD, 1 en TAIL)
    //   • curlPhase  — 1 → 0 durante HEAD; 0 durante PATH; 0 → 1 durante TAIL
    //   • colorShift — sincronizado con curlPhase (mismo valor)
    //   • waveGate   — 0 → 1 durante HEAD; 1 durante PATH; 1 → 0 durante TAIL
    //                  ramping cuadrático para que la onda carangiform no
    //                  "arranque de golpe" desde el orbe-curled
    const pathDurMs = this.SWIM_DURATION_MS - this.MORPH_HEAD_MS - this.MORPH_TAIL_MS;
    const tailStartMs = this.SWIM_DURATION_MS - this.MORPH_TAIL_MS;
    let pathT: number;
    let curlPhase: number;
    let waveGate: number;
    if (elapsed < this.MORPH_HEAD_MS) {
      const h = elapsed / this.MORPH_HEAD_MS;
      pathT = 0;
      curlPhase = 1 - h;
      waveGate = h * h; // quadratic ramp-up — wave amplitude empieza en 0
    } else if (elapsed >= tailStartMs) {
      const ti = Math.min(1, (elapsed - tailStartMs) / this.MORPH_TAIL_MS);
      pathT = 1;
      curlPhase = ti;
      waveGate = (1 - ti) * (1 - ti); // quadratic ramp-down
    } else {
      pathT = (elapsed - this.MORPH_HEAD_MS) / pathDurMs;
      curlPhase = 0;
      waveGate = 1;
    }
    const colorShift = curlPhase;

    const eased = pathT < 0.5
      ? 4 * pathT * pathT * pathT
      : 1 - Math.pow(-2 * pathT + 2, 3) / 2;

    // swimAt devuelve pos en coords de PÁGINA. Convertir a viewport para el
    // renderer (que pinta sobre canvas position:fixed en viewport coords).
    // Esto es lo que hace que el pez NO se mueva con el scroll: la posición
    // de página es fija (locked en swim-start), pero la viewport position
    // cambia naturalmente cuando el user scrollea — el pez se ve salir/entrar
    // del viewport como cualquier elemento estático en la página.
    const { pos: pagePos, heading } = this.swimAt(eased);
    const viewportPos: Vec = { x: pagePos.x, y: pagePos.y - window.scrollY };

    // Durante el tail curl, override el viewportPos a la posición ACTUAL
    // del dock destino. swimEnd está locked en page coords desde el inicio
    // del swim; si el user scrolleó durante el swim, swimEnd ya no coincide
    // con el dock actual y el orbe-pez queda desalineado del hub que
    // emerge encima. Usar dock-position-now garantiza alineación perfecta
    // entre orbe (renderer canvas) y hub (DOM pivot).
    if (curlPhase > 0 && elapsed >= tailStartMs) {
      const newDock = this.registry.docks().find((d) => d.id === this.dockedId);
      if (newDock) {
        const dockViewport = this.computeDockPosition(newDock);
        viewportPos.x = dockViewport.x;
        viewportPos.y = dockViewport.y;
      }
    }
    // En head curl (uncurl) NO necesitamos override: swimAt(0) devuelve
    // swimStart en page coords = old-dock-page-y, y el hub DOM está
    // page-anchored al old-dock por su pivot — ambos comparten page-y
    // y dan misma viewport-y bajo cualquier scrollY. ✓

    if (this.fishReady && this.fishRenderer) {
      // Tail-beat ≈ 3 Hz. swimPhase += 0.32 rad por frame a 60fps → 19.2 rad/s
      // → 3.05 Hz. Banda canónica de carangiform cruising (atún/salmón
      // ~3-5 Hz). 0.18 era ~1.7 Hz, lo cual se leía como "flota a la deriva"
      // en vez de "nada".
      this.swimPhase += 0.32;

      // Effort fade-in/out solo durante PATH — los morphs (HEAD/TAIL)
      // tienen su propio gate (waveGate). El effort de path simula que el
      // pez "acelera" al arrancar y "frena" al llegar dentro del segmento
      // del path, sin contaminar la lectura de los curls.
      let effort = 0;
      if (curlPhase < 1e-3 && pathT > 0 && pathT < 1) {
        const fadeIn = Math.min(pathT / 0.18, 1);
        const fadeOut = Math.min((1 - pathT) / 0.18, 1);
        effort = Math.max(0, Math.min(1, fadeIn * fadeOut));
      }

      // Head yaw counter-phase: el cráneo de un pez no queda perfectamente
      // estable — gira ~3-5° en contra de la cola con cada beat. Eso
      // refuerza visualmente la lectura "el cuerpo entero empuja agua".
      // Amplitud chica (0.06 rad ≈ 3.4°) para no marear; contra-fase
      // restando sin(swimPhase) — opuesto al sentido instantáneo de la cola.
      const yawAmp = 0.06 * effort * waveGate;
      const headYaw = -Math.sin(this.swimPhase) * yawAmp;

      // Mesh opacity ramp para el crossfade simultáneo con el hub.
      // Empieza CROSSFADE_DUR_MS antes del swim-end, dura lo mismo. Al
      // swim-end, meshOpacity=0 (pez invisible) y hub a opacity~100%.
      // El timing se compute desde swim-end (no desde tail-start) así
      // queda independiente de cuánto dure el curl: al swim end siempre
      // el handoff está completo.
      const HUB_EMERGE_START_MS = this.SWIM_DURATION_MS - this.CROSSFADE_DUR_MS;
      let meshOpacity = 1;
      if (elapsed >= HUB_EMERGE_START_MS) {
        meshOpacity = Math.max(0, 1 - (elapsed - HUB_EMERGE_START_MS) / this.CROSSFADE_DUR_MS);
      }

      const state: CompanionFishState = {
        headX: viewportPos.x,
        headY: viewportPos.y,
        heading: heading + headYaw,
        size: this.FISH_SIZE,
        swimPhase: this.swimPhase,
        bodyEffort: effort * waveGate,
        swimGate: effort * waveGate,
        curlPhase,
        colorShift,
        meshOpacity,
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
      // Safety — normalmente hubEmergeTimer ya hizo set(true) 200ms antes,
      // pero por si setTimeout fue throttled (tab inactivo, debugger, etc.)
      // forzamos el estado correcto al final.
      this.hubVisible.set(true);

      // Limpiamos el canvas INMEDIATAMENTE — al swim end el pez ya está
      // a opacity 0 por el ramp de meshOpacity (que corrió los últimos
      // 220ms en paralelo con el fade-in del hub). El último frame
      // pintado es prácticamente invisible; el clear simplemente borra
      // los píxeles muertos. Antes esperábamos 220ms ANTES de limpiar,
      // así el último frame del pez (a opacity 1 todavía con el modelo
      // viejo) quedaba visible MIENTRAS el hub ya estaba pleno → user
      // veía dos cosas a la vez, rompiendo la lectura "morph".
      if (this.fishReady && this.fishRenderer) {
        const canvas = this.canvasRef()?.nativeElement;
        const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
        if (gl) {
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
        }
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
    // El pivot es position: absolute → recibe coords de PÁGINA (no viewport).
    // Convertir current (viewport) a page sumando scrollY. Esto hace que el
    // browser scrollee el ícono junto con la página automáticamente, sin
    // requerir actualización JS por cada frame de scroll.
    const pageY = this.current.y + window.scrollY;
    pivot.style.transform = `translate3d(${this.current.x}px, ${pageY}px, 0)`;
    // Una vez posicionado, hacerlo visible. El CSS arranca con
    // visibility:hidden para evitar el "flash en (0,0)" entre el mount
    // de Angular y la primera llamada a applyTransform.
    pivot.style.visibility = 'visible';
  }
}
