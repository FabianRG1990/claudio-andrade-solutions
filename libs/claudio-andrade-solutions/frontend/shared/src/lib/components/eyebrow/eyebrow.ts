import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Eyebrow — etiqueta capítulo / sección con punto monocromo y borde
 * tonalizado. 4 tonos disponibles: lagoon (default), foam, coral, kelp.
 */
@Component({
  selector: 'app-eyebrow',
  templateUrl: './eyebrow.html',
  styleUrl: './eyebrow.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Eyebrow {
  readonly tone = input<'lagoon' | 'foam' | 'coral' | 'kelp'>('lagoon');
}
