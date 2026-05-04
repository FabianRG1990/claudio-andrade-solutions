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
 * HeroFishCanvas
 * -----------------------------------------------------------------------------
 * Animación procedural sobre Canvas 2D:
 *  1. Pez articulado (espinazo de 18 segmentos, FABRIK + onda senoidal lateral)
 *     que persigue al cursor con física de muelle.
 *  2. Pequeña escuela ambiental (3-5 peces) en órbitas lemniscáticas.
 *  3. Plancton / motes ascendentes.
 *  4. Superficie de agua con ecuación de ondas en grid (heightfield) — el
 *     cursor "perturba" el campo y las olas se propagan, interfieren y
 *     reflejan en los bordes. Se renderiza como caustics platino.
 *
 * Sin Three.js: todo es 2D plano. El bridge a Angular usa afterNextRender
 * (SSR-safe) y DestroyRef para cleanup completo del RAF + listeners.
 *
 * Port directo de `components/hero/hero-fish-canvas.tsx` del Next original
 * — toda la matemática es idéntica.
 * -----------------------------------------------------------------------------
 */

type Vec = { x: number; y: number };

type FishOptions = {
  segments: number;
  segLen: number;
  bodyScale: number;
  color: { fill: string; rim: string; belly: string; fin: string; eye: string };
  speedScale: number;
  isHero: boolean;
};

class Fish {
  spine: Vec[];
  prev: Vec[];
  segLen: number;
  segments: number;
  bodyScale: number;
  color: FishOptions['color'];
  speedScale: number;
  isHero: boolean;
  velocity: Vec = { x: 0, y: 0 };
  phase = Math.random() * Math.PI * 2;
  bobPhase = Math.random() * Math.PI * 2;
  blink = 0;

  constructor(start: Vec, opts: FishOptions) {
    this.segments = opts.segments;
    this.segLen = opts.segLen;
    this.bodyScale = opts.bodyScale;
    this.color = opts.color;
    this.speedScale = opts.speedScale;
    this.isHero = opts.isHero;

    this.spine = Array.from({ length: opts.segments }, (_, i) => ({
      x: start.x - i * opts.segLen,
      y: start.y,
    }));
    this.prev = this.spine.map((p) => ({ x: p.x, y: p.y }));
  }

  // FABRIK-style chain: head moves to target, every other point follows
  // maintaining segment length.
  update(target: Vec, dt: number): void {
    this.prev = this.spine.map((p) => ({ ...p }));

    const head = this.spine[0];
    const dx = target.x - head.x;
    const dy = target.y - head.y;
    const dist = Math.hypot(dx, dy);

    const pull = this.isHero ? 0.13 : 0.08;
    const maxStep = (this.isHero ? 9 : 5) * this.speedScale * dt * 60;

    const step = Math.min(dist * pull, maxStep);
    if (dist > 0.5) {
      head.x += (dx / dist) * step;
      head.y += (dy / dist) * step;
    }

    this.velocity.x = head.x - this.prev[0].x;
    this.velocity.y = head.y - this.prev[0].y;
    const speed = Math.hypot(this.velocity.x, this.velocity.y);

    for (let i = 1; i < this.spine.length; i++) {
      const a = this.spine[i - 1];
      const b = this.spine[i];
      const ddx = b.x - a.x;
      const ddy = b.y - a.y;
      const d = Math.hypot(ddx, ddy) || 1;
      b.x = a.x + (ddx / d) * this.segLen;
      b.y = a.y + (ddy / d) * this.segLen;
    }

    this.phase += dt * (4 + speed * 0.7);
    const baseAmp = Math.min(speed * 0.55, 8) + 0.4;

    for (let i = 2; i < this.spine.length; i++) {
      const t = i / (this.spine.length - 1);
      const wave = Math.sin(this.phase - t * 4.5) * baseAmp * t * t;
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

    this.blink -= dt;
    if (this.blink < -3 + Math.random() * 5) this.blink = 0.18;
  }

  private widthAt(t: number): number {
    const w =
      Math.sin(Math.PI * Math.pow(t, 0.62)) * (1 - 0.45 * t) * this.bodyScale;
    return Math.max(2, w);
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
    const second = this.spine[1];
    const headTan = { x: head.x - second.x, y: head.y - second.y };
    const headLen = Math.hypot(headTan.x, headTan.y) || 1;
    const headDir = { x: headTan.x / headLen, y: headTan.y / headLen };
    const headPerp = { x: -headDir.y, y: headDir.x };
    const headW = this.widthAt(0.02);

    const noseTip = {
      x: head.x + headDir.x * headW * 0.55,
      y: head.y + headDir.y * headW * 0.55,
    };

    const tail = this.spine[this.spine.length - 1];
    const beforeTail = this.spine[this.spine.length - 2];
    const tailDir = { x: tail.x - beforeTail.x, y: tail.y - beforeTail.y };
    const tailLen = Math.hypot(tailDir.x, tailDir.y) || 1;
    tailDir.x /= tailLen;
    tailDir.y /= tailLen;

    // ============ CAUDAL FIN
    const speed = Math.hypot(this.velocity.x, this.velocity.y);
    const tailWag = Math.sin(this.phase - 4.5) * (4 + Math.min(speed, 12));
    const finReach = this.bodyScale * 1.7;
    const finPerp = { x: -tailDir.y, y: tailDir.x };
    const tailEnd = {
      x: tail.x + tailDir.x * finReach + finPerp.x * tailWag * 0.6,
      y: tail.y + tailDir.y * finReach + finPerp.y * tailWag * 0.6,
    };
    const tailUp = {
      x:
        tail.x +
        tailDir.x * finReach * 0.55 +
        finPerp.x * (this.bodyScale * 0.95 + tailWag * 0.4),
      y:
        tail.y +
        tailDir.y * finReach * 0.55 +
        finPerp.y * (this.bodyScale * 0.95 + tailWag * 0.4),
    };
    const tailDown = {
      x:
        tail.x +
        tailDir.x * finReach * 0.55 -
        finPerp.x * (this.bodyScale * 0.95 - tailWag * 0.4),
      y:
        tail.y +
        tailDir.y * finReach * 0.55 -
        finPerp.y * (this.bodyScale * 0.95 - tailWag * 0.4),
    };

    ctx.save();
    const tailGrad = ctx.createLinearGradient(tail.x, tail.y, tailEnd.x, tailEnd.y);
    tailGrad.addColorStop(0, this.color.fill);
    tailGrad.addColorStop(1, this.color.fin);
    ctx.fillStyle = tailGrad;
    ctx.globalAlpha = this.isHero ? 0.95 : 0.7;
    ctx.beginPath();
    ctx.moveTo(tail.x, tail.y);
    ctx.quadraticCurveTo(
      (tail.x + tailUp.x) / 2 + tailDir.x * 4,
      (tail.y + tailUp.y) / 2 + tailDir.y * 4,
      tailUp.x,
      tailUp.y,
    );
    ctx.quadraticCurveTo(
      (tailUp.x + tailEnd.x) / 2 - tailDir.x * 6,
      (tailUp.y + tailEnd.y) / 2 - tailDir.y * 6,
      tailEnd.x,
      tailEnd.y,
    );
    ctx.quadraticCurveTo(
      (tailEnd.x + tailDown.x) / 2 - tailDir.x * 6,
      (tailEnd.y + tailDown.y) / 2 - tailDir.y * 6,
      tailDown.x,
      tailDown.y,
    );
    ctx.quadraticCurveTo(
      (tail.x + tailDown.x) / 2 + tailDir.x * 4,
      (tail.y + tailDown.y) / 2 + tailDir.y * 4,
      tail.x,
      tail.y,
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // ============ DORSAL FIN — top of body around 30%-55%
    if (this.isHero) {
      const i1 = Math.floor(this.spine.length * 0.32);
      const i2 = Math.floor(this.spine.length * 0.6);
      const sp1 = this.spine[i1];
      const sp2 = this.spine[i2];
      const t1Tan = {
        x: this.spine[i1 + 1].x - this.spine[i1 - 1].x,
        y: this.spine[i1 + 1].y - this.spine[i1 - 1].y,
      };
      const t1Len = Math.hypot(t1Tan.x, t1Tan.y) || 1;
      const u1 = { x: -t1Tan.y / t1Len, y: t1Tan.x / t1Len };
      const fin1 = {
        x: sp1.x + u1.x * this.bodyScale * 1.7,
        y: sp1.y + u1.y * this.bodyScale * 1.7,
      };

      const t2Tan = {
        x: this.spine[i2].x - this.spine[i2 - 1].x,
        y: this.spine[i2].y - this.spine[i2 - 1].y,
      };
      const t2Len = Math.hypot(t2Tan.x, t2Tan.y) || 1;
      const u2 = { x: -t2Tan.y / t2Len, y: t2Tan.x / t2Len };

      ctx.save();
      ctx.fillStyle = this.color.fin;
      ctx.globalAlpha = this.isHero ? 0.85 : 0.55;
      ctx.beginPath();
      ctx.moveTo(left[i1].x, left[i1].y);
      ctx.quadraticCurveTo(
        fin1.x,
        fin1.y,
        sp2.x + u2.x * this.bodyScale * 0.4,
        sp2.y + u2.y * this.bodyScale * 0.4,
      );
      ctx.lineTo(left[i2].x, left[i2].y);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // ============ PECTORAL FIN
    if (this.isHero) {
      const i1 = Math.floor(this.spine.length * 0.18);
      const sp1 = this.spine[i1];
      const tan = {
        x: this.spine[i1 + 1].x - this.spine[i1 - 1].x,
        y: this.spine[i1 + 1].y - this.spine[i1 - 1].y,
      };
      const tLen = Math.hypot(tan.x, tan.y) || 1;
      const u = { x: -tan.y / tLen, y: tan.x / tLen };
      const flap = Math.sin(this.phase * 1.4) * 0.4 + 0.6;
      const finTip = {
        x:
          sp1.x -
          u.x * this.bodyScale * 1.4 * flap -
          (tan.x / tLen) * this.bodyScale * 0.7,
        y:
          sp1.y -
          u.y * this.bodyScale * 1.4 * flap -
          (tan.y / tLen) * this.bodyScale * 0.7,
      };
      ctx.save();
      ctx.fillStyle = this.color.fin;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(right[i1].x, right[i1].y);
      ctx.quadraticCurveTo(
        finTip.x,
        finTip.y,
        right[i1 + 2].x - (tan.x / tLen) * 2,
        right[i1 + 2].y - (tan.y / tLen) * 2,
      );
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // ============ BODY
    ctx.save();
    const bodyGrad = ctx.createLinearGradient(
      head.x + headPerp.x * this.bodyScale * 1.5,
      head.y + headPerp.y * this.bodyScale * 1.5,
      head.x - headPerp.x * this.bodyScale * 1.5,
      head.y - headPerp.y * this.bodyScale * 1.5,
    );
    bodyGrad.addColorStop(0, this.color.rim);
    bodyGrad.addColorStop(0.45, this.color.fill);
    bodyGrad.addColorStop(1, this.color.belly);
    ctx.fillStyle = bodyGrad;
    ctx.globalAlpha = this.isHero ? 1 : 0.8;
    ctx.beginPath();
    ctx.moveTo(noseTip.x, noseTip.y);
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
    ctx.lineTo(noseTip.x, noseTip.y);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = this.isHero ? 0.35 : 0.15;
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = this.color.rim;
    ctx.stroke();
    ctx.restore();

    // ============ EYE
    const eyeIdx = 1;
    const eyeBase = this.spine[eyeIdx];
    const eyeTan = {
      x: this.spine[eyeIdx + 1].x - this.spine[eyeIdx - 0].x,
      y: this.spine[eyeIdx + 1].y - this.spine[eyeIdx - 0].y,
    };
    const eyeTLen = Math.hypot(eyeTan.x, eyeTan.y) || 1;
    const eyeU = { x: -eyeTan.y / eyeTLen, y: eyeTan.x / eyeTLen };
    const eyeRad = Math.max(this.bodyScale * 0.18, 1.6);
    const eyeOffset = this.bodyScale * 0.55;
    const eye = {
      x: eyeBase.x + eyeU.x * eyeOffset + headDir.x * this.bodyScale * 0.2,
      y: eyeBase.y + eyeU.y * eyeOffset + headDir.y * this.bodyScale * 0.2,
    };

    ctx.save();
    ctx.fillStyle = 'rgba(245,241,232,0.92)';
    ctx.beginPath();
    ctx.arc(eye.x, eye.y, eyeRad, 0, Math.PI * 2);
    ctx.fill();
    if (this.blink <= 0) {
      ctx.fillStyle = this.color.eye;
      ctx.beginPath();
      ctx.arc(
        eye.x + headDir.x * eyeRad * 0.25,
        eye.y + headDir.y * eyeRad * 0.25,
        eyeRad * 0.55,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.fillStyle = 'rgba(245,241,232,0.85)';
      ctx.beginPath();
      ctx.arc(
        eye.x + headDir.x * eyeRad * 0.4 - eyeU.x * eyeRad * 0.2,
        eye.y + headDir.y * eyeRad * 0.4 - eyeU.y * eyeRad * 0.2,
        eyeRad * 0.18,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.restore();

    // ============ GLOW (only hero)
    if (this.isHero) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const glowGrad = ctx.createRadialGradient(
        head.x,
        head.y,
        0,
        head.x,
        head.y,
        this.bodyScale * 5,
      );
      glowGrad.addColorStop(0, 'rgba(127,227,214,0.18)');
      glowGrad.addColorStop(1, 'rgba(127,227,214,0)');
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(head.x, head.y, this.bodyScale * 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

// Wave-equation simulation on a heightfield grid. Cursor "pokes" the field
// along its path; waves propagate, interfere, reflect at edges, then render
// as caustic-style highlights on the gradient (slope) of the surface.
class WaveField {
  cellSize: number;
  cols: number;
  rows: number;
  cur: Float32Array;
  prev: Float32Array;
  offscreen: HTMLCanvasElement;
  offCtx: CanvasRenderingContext2D;
  imageData: ImageData;
  damping = 0.984;
  heightCap = 2.4;

  constructor(w: number, h: number) {
    // cellSize 7 (antes 5). El wave-grid es O(cols*rows) por frame y se itera
    // hasta 4 sub-steps por frame. Bajar de 5→7 reduce las celdas ~2× con
    // pérdida visual mínima — los rizos se ven igual de fluidos porque la
    // resolución del filtro blur(1.3px) sobre el render ya difumina detalles
    // de subpíxel.
    this.cellSize = 7;
    this.cols = Math.max(8, Math.ceil(w / this.cellSize));
    this.rows = Math.max(8, Math.ceil(h / this.cellSize));
    this.cur = new Float32Array(this.cols * this.rows);
    this.prev = new Float32Array(this.cols * this.rows);
    this.offscreen = document.createElement('canvas');
    this.offscreen.width = this.cols;
    this.offscreen.height = this.rows;
    const ctx = this.offscreen.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('no offscreen ctx');
    this.offCtx = ctx;
    this.imageData = this.offCtx.createImageData(this.cols, this.rows);
    this.primeColor();
  }

  // RGB stays static; only alpha rewritten per frame from the gradient.
  // Cooled silver — moonlight on water (low chroma).
  private primeColor(): void {
    const d = this.imageData.data;
    for (let i = 0; i < this.cols * this.rows; i++) {
      const j = i * 4;
      d[j] = 196;
      d[j + 1] = 218;
      d[j + 2] = 224;
    }
  }

  resize(w: number, h: number): void {
    const cols = Math.max(8, Math.ceil(w / this.cellSize));
    const rows = Math.max(8, Math.ceil(h / this.cellSize));
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    this.cur = new Float32Array(cols * rows);
    this.prev = new Float32Array(cols * rows);
    this.offscreen.width = cols;
    this.offscreen.height = rows;
    this.imageData = this.offCtx.createImageData(cols, rows);
    this.primeColor();
  }

  poke(x: number, y: number, strength: number): void {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const r = 3;
    for (let dy = -r; dy <= r; dy++) {
      const yy = cy + dy;
      if (yy < 1 || yy >= this.rows - 1) continue;
      const yi = yy * this.cols;
      for (let dx = -r; dx <= r; dx++) {
        const xx = cx + dx;
        if (xx < 1 || xx >= this.cols - 1) continue;
        const d = Math.hypot(dx, dy);
        if (d > r) continue;
        const f = 1 - d / r;
        this.cur[yi + xx] += strength * f * f;
      }
    }
  }

  pokeLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    strength: number,
  ): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(dist / (this.cellSize * 0.7)));
    const per = strength / (1 + steps * 0.35);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      this.poke(x0 + dx * t, y0 + dy * t, per);
    }
  }

  step(): void {
    const cols = this.cols;
    const rows = this.rows;
    const cur = this.cur;
    const prev = this.prev;
    const damping = this.damping;
    const cap = this.heightCap;
    for (let y = 1; y < rows - 1; y++) {
      const yi = y * cols;
      for (let x = 1; x < cols - 1; x++) {
        const i = yi + x;
        const sum = cur[i + 1] + cur[i - 1] + cur[i + cols] + cur[i - cols];
        let n = sum * 0.5 - prev[i];
        n *= damping;
        if (n > cap) n = cap;
        else if (n < -cap) n = -cap;
        prev[i] = n;
      }
    }
    const tmp = this.cur;
    this.cur = this.prev;
    this.prev = tmp;
  }

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const cols = this.cols;
    const rows = this.rows;
    const cur = this.cur;
    const data = this.imageData.data;

    for (let y = 0; y < rows; y++) {
      const yi = y * cols;
      for (let x = 0; x < cols; x++) {
        const i = yi + x;
        let gx = 0;
        let gy = 0;
        if (x > 0 && x < cols - 1) gx = cur[i + 1] - cur[i - 1];
        if (y > 0 && y < rows - 1) gy = cur[i + cols] - cur[i - cols];
        const grad = Math.sqrt(gx * gx + gy * gy);
        const heightAbs = Math.abs(cur[i]);
        let a = grad * 58 + heightAbs * 11;
        if (a > 130) a = 130;
        data[i * 4 + 3] = a;
      }
    }

    this.offCtx.putImageData(this.imageData, 0, 0);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.78;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.filter = 'blur(1.3px)';
    ctx.drawImage(this.offscreen, 0, 0, w, h);
    ctx.restore();
  }
}

class HeroMote {
  x: number;
  y: number;
  r: number;
  vy: number;
  drift: number;
  phase: number;
  alpha: number;

  constructor(w: number, h: number) {
    this.x = Math.random() * w;
    this.y = h + Math.random() * h * 0.4;
    this.r = 0.6 + Math.random() * 1.6;
    this.vy = -8 - Math.random() * 14;
    this.drift = (Math.random() - 0.5) * 0.6;
    this.phase = Math.random() * Math.PI * 2;
    this.alpha = 0.18 + Math.random() * 0.35;
  }

  update(dt: number, w: number, h: number): void {
    this.phase += dt * (0.4 + Math.random() * 0.05);
    this.y += this.vy * dt;
    this.x += Math.sin(this.phase) * this.drift;
    if (this.y < -10) {
      this.y = h + 10;
      this.x = Math.random() * w;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.fillStyle = `rgba(127, 227, 214, ${this.alpha})`;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

@Component({
  selector: 'app-hero-fish-canvas',
  templateUrl: './hero-fish-canvas.html',
  styleUrl: './hero-fish-canvas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeroFishCanvas {
  private readonly containerRef =
    viewChild.required<ElementRef<HTMLDivElement>>('container');
  private readonly canvasRef =
    viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      const cleanup = this.start();
      this.destroyRef.onDestroy(() => cleanup?.());
    });
  }

  private start(): (() => void) | void {
    const container = this.containerRef().nativeElement;
    const canvas = this.canvasRef().nativeElement;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    // prefers-reduced-motion → no animación. El canvas se queda quieto en
    // estado inicial (un único frame estático). Bypass total del RAF +
    // listeners; ahorra GPU completo a usuarios que lo piden.
    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    if (reducedMotion) return;

    let w = 0;
    let h = 0;
    // DPR cap 1.5 (antes 2) — 1.5² = 2.25× píxeles vs. 1× en lugar de 4×.
    // Visualmente la diferencia es mínima en este canvas (las siluetas tienen
    // blur por sí solas) pero la carga GPU baja casi a la mitad.
    let dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    const resize = (): void => {
      const rect = container.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const pointer = { x: w * 0.55, y: h * 0.55, active: false };
    const target = { x: pointer.x, y: pointer.y };
    const lastPoke = { x: pointer.x, y: pointer.y, valid: false };
    let pointerVel = 0;

    const onMove = (e: PointerEvent): void => {
      const rect = container.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const inside =
        px >= 0 && py >= 0 && px <= rect.width && py <= rect.height;
      if (inside) {
        if (pointer.active) {
          pointerVel = Math.hypot(px - pointer.x, py - pointer.y);
        }
        pointer.x = px;
        pointer.y = py;
        pointer.active = true;
      } else {
        pointer.active = false;
        lastPoke.valid = false;
      }
    };

    window.addEventListener('pointermove', onMove, { passive: true });

    // Hero fish — escala con el ancho del viewport. ResizeObserver de abajo
    // re-asigna heroScale/segLen para que el pez no se vea ridículo en
    // phones (donde antes salía con bodyScale ~12 dejándolo enorme).
    let heroScale = Math.max(7, Math.min(12, w / 130));
    const hero = new Fish(
      { x: w * 0.55, y: h * 0.55 },
      {
        segments: 18,
        segLen: heroScale * 1.0,
        bodyScale: heroScale,
        speedScale: 1,
        isHero: true,
        color: {
          fill: '#cfe9ee',
          rim: '#7FE3D6',
          belly: '#4a7a8a',
          fin: '#5EC4D1',
          eye: '#061826',
        },
      },
    );

    // Density por área para los peces ambientales: ~1 pez por cada 280 000 px²
    // (clampeado entre 2 y 6). Antes era step `w<720?3:5` que dejaba phones
    // saturados y desktops vacíos. Ahora se reflowea por área en cada resize.
    const ambientCountForArea = (cw: number, ch: number): number =>
      Math.max(2, Math.min(6, Math.round((cw * ch) / 280_000)));

    let ambients: Fish[] = [];
    let ambientTargets: Array<{
      cx: number; cy: number; rx: number; ry: number;
      phase: number; speed: number; offset: number;
    }> = [];
    const palette = [
      { fill: '#9dbac4', rim: '#5EC4D1', belly: '#2c4a58', fin: '#7FE3D6', eye: '#061826' },
      { fill: '#a5b4a9', rim: '#7FE3D6', belly: '#34514a', fin: '#4A6B5C', eye: '#061826' },
      { fill: '#d8b8a8', rim: '#D87060', belly: '#7a4a44', fin: '#D87060', eye: '#061826' },
    ];

    const reflowAmbients = (): void => {
      const targetCount = ambientCountForArea(w, h);
      ambients = Array.from({ length: targetCount }, (_, i) => {
        const sc = 4 + Math.random() * 3.5;
        return new Fish(
          { x: Math.random() * w, y: 60 + Math.random() * Math.max(60, h - 120) },
          {
            segments: 14,
            segLen: sc * 1.05,
            bodyScale: sc,
            speedScale: 0.55 + Math.random() * 0.3,
            isHero: false,
            color: palette[i % palette.length],
          },
        );
      });
      ambientTargets = ambients.map((_, i) => ({
        cx: w * (0.2 + Math.random() * 0.6),
        cy: h * (0.25 + Math.random() * 0.5),
        rx: w * (0.15 + Math.random() * 0.2),
        ry: h * (0.15 + Math.random() * 0.2),
        phase: Math.random() * Math.PI * 2,
        speed: 0.12 + Math.random() * 0.14,
        offset: i,
      }));
    };
    reflowAmbients();

    // Motes: density por área (1 cada ~16 000 px²). Mantiene el plancton
    // visualmente igual de denso en cualquier viewport.
    let motes: HeroMote[] = Array.from(
      { length: Math.max(20, Math.round((w * h) / 16_000)) },
      () => new HeroMote(w, h),
    );

    const waves = new WaveField(w, h);

    // ResizeObserver — reflowea TODO el cast (no solo redimensiona el canvas):
    // ambient fish + sus orbits, motes, escala del hero, wave grid. El layout
    // se rearma proporcional al área del nuevo viewport. Esto reemplaza el
    // window.resize listener que solo estiraba el canvas (zoom).
    const ro = new ResizeObserver(() => {
      resize();
      heroScale = Math.max(7, Math.min(12, w / 130));
      hero.bodyScale = heroScale;
      hero.segLen = heroScale * 1.0;
      reflowAmbients();
      motes = Array.from(
        { length: Math.max(20, Math.round((w * h) / 16_000)) },
        () => new HeroMote(w, h),
      );
      waves.resize(w, h);
    });
    ro.observe(container);

    let idlePhase = 0;
    let raf = 0;
    let lastT = performance.now();
    let waveAccumulator = 0;
    const WAVE_STEP = 1 / 120;

    // Pausa por visibilidad: cuando el hero se scrollea fuera de pantalla, o
    // cuando la tab está oculta, no hay razón para correr el RAF. Antes el
    // canvas seguía animando peces y wave-grid aunque el usuario estuviera
    // 5 secciones abajo — minutos de GPU desperdiciados.
    let isOnScreen = true;
    let isTabVisible = !document.hidden;
    const isActive = (): boolean => isOnScreen && isTabVisible;

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

    const io = new IntersectionObserver(
      ([entry]) => {
        isOnScreen = entry.isIntersecting;
        if (isActive()) start();
        else stop();
      },
      { threshold: 0 },
    );
    io.observe(container);

    const onVisChange = (): void => {
      isTabVisible = !document.hidden;
      if (isActive()) start();
      else stop();
    };
    document.addEventListener('visibilitychange', onVisChange);

    const tick = (now: number): void => {
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      idlePhase += dt * 0.5;

      if (pointer.active) {
        const speed = pointerVel;
        const baseStrength = 0.18 + Math.min(speed * 0.014, 0.32);
        if (lastPoke.valid) {
          waves.pokeLine(
            lastPoke.x,
            lastPoke.y,
            pointer.x,
            pointer.y,
            baseStrength,
          );
        } else {
          waves.poke(pointer.x, pointer.y, 0.45);
        }
        lastPoke.x = pointer.x;
        lastPoke.y = pointer.y;
        lastPoke.valid = true;
        pointerVel *= 0.74;
      }

      waveAccumulator += dt;
      let steps = 0;
      while (waveAccumulator >= WAVE_STEP && steps < 4) {
        waves.step();
        waveAccumulator -= WAVE_STEP;
        steps++;
      }

      if (pointer.active) {
        target.x += (pointer.x - target.x) * 0.18;
        target.y += (pointer.y - target.y) * 0.18;
      } else {
        const cx = w * 0.55;
        const cy = h * 0.5;
        const tx = cx + Math.cos(idlePhase) * w * 0.18;
        const ty = cy + Math.sin(idlePhase * 1.7) * h * 0.12;
        target.x += (tx - target.x) * 0.04;
        target.y += (ty - target.y) * 0.04;
      }

      ctx.clearRect(0, 0, w, h);

      for (const m of motes) {
        m.update(dt, w, h);
        m.render(ctx);
      }

      ambients.forEach((f, i) => {
        const at = ambientTargets[i];
        at.phase += dt * at.speed;
        const tx = at.cx + Math.cos(at.phase) * at.rx;
        const ty = at.cy + Math.sin(at.phase * 1.3) * at.ry;
        f.update({ x: tx, y: ty }, dt);
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.filter = 'blur(0.6px)';
        f.render(ctx);
        ctx.restore();
      });

      hero.update(target, dt);
      hero.render(ctx);

      waves.render(ctx, w, h);

      raf = requestAnimationFrame(tick);
    };
    start();

    return () => {
      stop();
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', onVisChange);
      io.disconnect();
      ro.disconnect();
    };
  }
}
