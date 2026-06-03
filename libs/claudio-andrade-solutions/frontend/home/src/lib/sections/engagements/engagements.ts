import { ChangeDetectionStrategy, Component } from '@angular/core';

import { engagements } from '@cas-ui-shared/data/data';
import { Eyebrow } from '@cas-ui-shared/components/eyebrow/eyebrow';
import { RevealDirective } from '@cas-ui-shared/directives/reveal/reveal.directive';
import { CompanionDockDirective } from '@cas-ui-shared/companion/companion-dock.directive';

import { EngagementCard } from './engagement-card/engagement-card';

/**
 * Engagements — capítulo 03 del manifiesto. Shell delgado: eyebrow + título +
 * lead + grid. Cada tarjeta es el componente presentacional `EngagementCard`
 * (extraído acá; el SCSS de la tarjeta — ~900 líneas — vive con él). El central
 * (highlight=true) se eleva por el ancho de columna del grid y tintes lagoon.
 */
@Component({
  selector: 'app-engagements',
  imports: [Eyebrow, RevealDirective, CompanionDockDirective, EngagementCard],
  templateUrl: './engagements.html',
  styleUrl: './engagements.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Engagements {
  protected readonly engagements = engagements;
}
