import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Eyebrow } from '../eyebrow/eyebrow';
import { RevealDirective } from '../../directives/reveal/reveal.directive';

/**
 * SectionHeading — patrón editorial reutilizable: eyebrow + título grande
 * (con palabra italic opcional) + descripción opcional. Cada bloque
 * aparece con stagger via la directiva `appReveal` (delays 0, 0.08, 0.16).
 */
@Component({
  selector: 'app-section-heading',
  imports: [Eyebrow, RevealDirective],
  templateUrl: './section-heading.html',
  styleUrl: './section-heading.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SectionHeading {
  readonly eyebrow = input.required<string>();
  readonly title = input.required<string>();
  readonly italic = input<string | undefined>(undefined);
  readonly description = input<string | undefined>(undefined);
  readonly align = input<'left' | 'center'>('left');
  readonly tone = input<'lagoon' | 'foam' | 'coral' | 'kelp'>('lagoon');
}
