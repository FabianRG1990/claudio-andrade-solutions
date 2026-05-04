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

// Tintes muy bajos — los peces leen como siluetas en la profundidad, casi
// fundidas con el agua oscura.
const TINTS: ReadonlyArray<{ body: string; tail: string }> = [
  { body: 'rgba(127, 227, 214, 0.11)', tail: 'rgba(94, 196, 209, 0.08)' },
  { body: 'rgba(180, 205, 215, 0.09)', tail: 'rgba(140, 165, 180, 0.06)' },
  { body: 'rgba(94, 196, 209, 0.10)', tail: 'rgba(74, 107, 92, 0.07)' },
  { body: 'rgba(74, 107, 92, 0.11)', tail: 'rgba(60, 90, 80, 0.08)' },
  { body: 'rgba(110, 150, 175, 0.09)', tail: 'rgba(85, 120, 145, 0.06)' },
];

class ShadowFish {
  spine: Vec[];
  segLen: number;
  bodyScale: number;
  baseAlpha: number;
  phase = Math.random() * Math.PI * 2;
  target: Vec;
  targetTimer = 0;
  speed: number;
  blurAmount: number;
  tint: { body: string; tail: string };
  segments: number;

  constructor(start: Vec, w: number, h: number, depth: number) {
    // depth: 0..1 — 0 cerca, 1 lejos
    const sc = (1 - depth) * 7 + 2.5;
    this.bodyScale = sc;
    this.segLen = sc * 0.95;
    this.segments = 14;
    this.spine = Array.from({ length: this.segments }, (_, i) => ({
      x: start.x - i * this.segLen,
      y: start.y,
    }));
    this.baseAlpha = 0.45 + (1 - depth) * 0.35;
    this.speed = 0.45 + (1 - depth) * 0.45;
    this.blurAmount = 0.8 + depth * 1.8;
    this.tint = TINTS[Math.floor(Math.random() * TINTS.length)];
    this.target = {
      x: Math.random() * w,
      y: 80 + Math.random() * Math.max(80, h - 160),
    };
    this.pickTarget(w, h);
  }

  private pickTarget(w: number, h: number): void {
    const head = this.spine[0];
    const angle = Math.random() * Math.PI * 2;
    const dist = 220 + Math.random() * 600;
    this.target.x = Math.max(40, Math.min(w - 40, head.x + Math.cos(angle) * dist));
    this.target.y = Math.max(40, Math.min(h - 40, head.y + Math.sin(angle) * dist));
    this.targetTimer = 4 + Math.random() * 5;
  }

  update(dt: number, w: number, h: number): void {
    this.targetTimer -= dt;
    if (this.targetTimer <= 0) this.pickTarget(w, h);

    const head = this.spine[0];
    const dx = this.target.x - head.x;
    const dy = this.target.y - head.y;
    const dist = Math.hypot(dx, dy);
    const pull = 0.022;
    const maxStep = this.speed * dt * 60;
    const step = Math.min(dist * pull, maxStep);
    if (dist > 0.5) {
      head.x += (dx / dist) * step;
      head.y += (dy / dist) * step;
    }

    // FABRIK constraint
    for (let i = 1; i < this.spine.length; i++) {
      const a = this.spine[i - 1];
      const b = this.spine[i];
      const ddx = b.x - a.x;
      const ddy = b.y - a.y;
      const d = Math.hypot(ddx, ddy) || 1;
      b.x = a.x + (ddx / d) * this.segLen;
      b.y = a.y + (ddy / d) * this.segLen;
    }

    // Tail wave (lighter than hero fish — these are ambient)
    const baseSpeed = step;
    this.phase += dt * (3 + baseSpeed * 0.4);
    for (let i = 2; i < this.spine.length; i++) {
      const t = i / (this.spine.length - 1);
      const wave = Math.sin(this.phase - t * 4) * 1.2 * t * t;
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
    return Math.max(
      1.5,
      Math.sin(Math.PI * Math.pow(t, 0.6)) * (1 - 0.4 * t) * this.bodyScale,
    );
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
    const tail = this.spine[this.spine.length - 1];
    const beforeTail = this.spine[this.spine.length - 2];
    const tailDir = { x: tail.x - beforeTail.x, y: tail.y - beforeTail.y };
    const tailLen = Math.hypot(tailDir.x, tailDir.y) || 1;
    tailDir.x /= tailLen;
    tailDir.y /= tailLen;
    const finPerp = { x: -tailDir.y, y: tailDir.x };
    const tailWag = Math.sin(this.phase - 4) * (this.bodyScale * 0.5);
    const finReach = this.bodyScale * 1.55;
    const tailEnd = {
      x: tail.x + tailDir.x * finReach + finPerp.x * tailWag * 0.4,
      y: tail.y + tailDir.y * finReach + finPerp.y * tailWag * 0.4,
    };
    const tailUp = {
      x:
        tail.x +
        tailDir.x * finReach * 0.5 +
        finPerp.x * (this.bodyScale * 0.85 + tailWag * 0.3),
      y:
        tail.y +
        tailDir.y * finReach * 0.5 +
        finPerp.y * (this.bodyScale * 0.85 + tailWag * 0.3),
    };
    const tailDown = {
      x:
        tail.x +
        tailDir.x * finReach * 0.5 -
        finPerp.x * (this.bodyScale * 0.85 - tailWag * 0.3),
      y:
        tail.y +
        tailDir.y * finReach * 0.5 -
        finPerp.y * (this.bodyScale * 0.85 - tailWag * 0.3),
    };

    ctx.save();
    ctx.globalAlpha = this.baseAlpha;

    // Tail
    ctx.fillStyle = this.tint.tail;
    ctx.beginPath();
    ctx.moveTo(tail.x, tail.y);
    ctx.quadraticCurveTo(tailUp.x, tailUp.y, tailEnd.x, tailEnd.y);
    ctx.quadraticCurveTo(tailDown.x, tailDown.y, tail.x, tail.y);
    ctx.closePath();
    ctx.fill();

    // Body silhouette
    ctx.fillStyle = this.tint.body;
    ctx.beginPath();
    ctx.moveTo(head.x, head.y);
    for (let i = 0; i < left.length - 1; i++) {
      const c1 = left[i];
      const c2 = left[i + 1];
      const mx = (c1.x + c2.x) / 2;
      const my = (c1.y + c2.y) / 2;
      ctx.quadraticCurveTo(c1.x, c1.y, mx, my);
    }
    ctx.lineTo(tail.x, tail.y);
    for (let i = right.length - 1; i > 0; i--) {
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
    this.alpha = 0.04 + Math.random() * 0.09;
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
    // Esto evita el caso de "phone saturado" o "widescreen vacío".
    const fishCountForArea = (cw: number, ch: number): number => {
      const ratio = Math.sqrt((cw * ch) / (1440 * 900));
      return Math.max(3, Math.round(9 * ratio));
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
    // en home: el hero tiene bg-mesh-deep opaco y los peces NO se ven mientras
    // el usuario lee el primer pliegue → pausamos para ahorrar GPU. En las
    // demás rutas el page-header solo cubre los primeros ~500px y abajo del
    // header los peces son visibles desde el primer scroll-Y, así que el
    // canvas debe estar animando desde el momento en que la página carga —
    // si pausamos hasta `scrollY > 0.7vh`, el usuario ve los peces congelados
    // en la zona del depth-transition y siente que es una imagen estática.
    // La fluidez del background es prioridad sobre el ahorro GPU en internas.
    let isHomePage = this.router.url === '/' || this.router.url.startsWith('/?');
    let isCovered = isHomePage && window.scrollY < window.innerHeight * 0.7;
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
        // Reevaluar covered: en internas nunca está covered; en home depende
        // del scrollY actual.
        isCovered = isHomePage && window.scrollY < window.innerHeight * 0.7;
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
        isCovered = window.scrollY < window.innerHeight * 0.7;
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
