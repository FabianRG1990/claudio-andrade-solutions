import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowRightBold,
  phosphorCheckBold,
  phosphorUsersBold,
  phosphorXBold,
} from '@ng-icons/phosphor-icons/bold';
import {
  phosphorMagnifyingGlass,
  phosphorRocket,
  phosphorUsers,
} from '@ng-icons/phosphor-icons/regular';
import { phosphorStarFill } from '@ng-icons/phosphor-icons/fill';

import { Engagement } from '@cas-ui-shared/data/data';
import { RevealDirective } from '@cas-ui-shared/directives/reveal/reveal.directive';

/**
 * EngagementCard — tarjeta presentacional de un modelo de contratación.
 * Extraída de `Engagements` (skill estructura-de-codigo/02): el componente
 * padre quedó como shell delgado (eyebrow + título + grid) y cada tarjeta es
 * este componente, con su propio template + estilos chicos.
 *
 * `:host { display: contents }` (en el SCSS) hace que el <article> interno sea
 * el grid-item directo, preservando exactamente el layout del grid original.
 * El reveal vive acá (sobre el <article>) y el delay por índice entra por input.
 */
@Component({
  selector: 'app-engagement-card',
  imports: [RouterLink, NgIcon, RevealDirective],
  providers: [
    provideIcons({
      phosphorArrowRightBold,
      phosphorCheckBold,
      phosphorMagnifyingGlass,
      phosphorRocket,
      phosphorUsers,
      phosphorUsersBold,
      phosphorXBold,
      phosphorStarFill,
    }),
  ],
  templateUrl: './engagement-card.html',
  styleUrl: './engagement-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EngagementCard {
  /** Modelo de contratación a renderizar. */
  readonly engagement = input.required<Engagement>();

  /** Delay del reveal (segundos), provisto por el padre según el índice. */
  readonly delay = input(0);
}
