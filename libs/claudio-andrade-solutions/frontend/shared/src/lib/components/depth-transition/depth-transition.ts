import { ChangeDetectionStrategy, Component } from '@angular/core';

interface Ray {
  left: string;
  angle: number;
  dur: number;
  delay: number;
  alpha: number;
}

interface DepthMote {
  left: number;
  size: number;
  dur: number;
  delay: number;
  blur: number;
}

const RAYS: ReadonlyArray<Ray> = [
  { left: '18%', angle: -2, dur: 17, delay: 0, alpha: 0.06 },
  { left: '42%', angle: 2, dur: 19, delay: -5, alpha: 0.05 },
  { left: '66%', angle: -1, dur: 16, delay: -8, alpha: 0.06 },
  { left: '85%', angle: 3, dur: 21, delay: -3, alpha: 0.04 },
];

const MOTES: ReadonlyArray<DepthMote> = Array.from({ length: 14 }, (_, i) => ({
  left: ((i * 137) % 100) + ((i * 0.7) % 5),
  size: 1 + ((i * 7) % 3) * 0.5,
  dur: 16 + ((i * 3) % 9),
  delay: -((i * 1.7) % 14),
  blur: i % 3 === 0 ? 0.7 : 0.3,
}));

/**
 * DepthTransition — puente invisible entre el hero y el manifiesto. Comparte
 * abismo, deja pasar god rays + sedimento muy tenues. Sin banderas visibles
 * ni costuras horizontales.
 */
@Component({
  selector: 'app-depth-transition',
  templateUrl: './depth-transition.html',
  styleUrl: './depth-transition.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DepthTransition {
  protected readonly rays = RAYS;
  protected readonly motes = MOTES;

  protected rayBackground(r: Ray): string {
    return `linear-gradient(180deg, transparent 0%, rgb(127 227 214 / ${r.alpha * 0.4}) 30%, rgb(127 227 214 / ${r.alpha}) 55%, rgb(127 227 214 / ${r.alpha * 0.3}) 80%, transparent 100%)`;
  }
}
