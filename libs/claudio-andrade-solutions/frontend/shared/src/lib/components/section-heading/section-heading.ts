import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Eyebrow } from '../eyebrow/eyebrow';
import { RevealDirective } from '../../directives/reveal/reveal.directive';
import { CompanionDockDirective } from '../../companion/companion-dock.directive';

/**
 * SectionHeading — patrón editorial reutilizable: eyebrow + título grande
 * (con palabra italic opcional) + descripción opcional. Cada bloque
 * aparece con stagger via la directiva `appReveal` (delays 0, 0.08, 0.16).
 *
 * Si se pasan `dockId` + `dockOrder`, el `<h2>` se marca como anchor del
 * WhatsappCompanion global — el companion se ancla a su borde derecho
 * cuando esta sección está activa según el scroll.
 */
@Component({
  selector: 'app-section-heading',
  imports: [Eyebrow, RevealDirective, CompanionDockDirective],
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
  // ID + order del dock para el WhatsappCompanion. Si no se pasan, no se
  // registra como anchor.
  readonly dockId = input<string | undefined>(undefined);
  readonly dockOrder = input<number>(0);
  // Offset entre el borde derecho del eyebrow (pill) y el centro del
  // ícono. Default 28 = 16 (radio del ícono) + 12 (aire visual desde el
  // borde redondeado del pill). Sin esto el ícono queda pegado al pill.
  readonly dockOffsetX = input<number>(28);
}
