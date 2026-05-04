import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { phosphorArrowUpRightBold } from '@ng-icons/phosphor-icons/bold';
import {
  phosphorClock,
  phosphorMapPin,
  phosphorTicket,
} from '@ng-icons/phosphor-icons/regular';

import { visitInfo } from '@acuario-ui-shared/data/data';
import { Eyebrow } from '@acuario-ui-shared/components/eyebrow/eyebrow';
import { RevealDirective } from '@acuario-ui-shared/directives/reveal/reveal.directive';

/**
 * Visit — capítulo 05. Columna izquierda sticky con manifiesto + CTAs;
 * columna derecha con 3 cards informativas (Horarios, Ubicación, Entrada).
 */
@Component({
  selector: 'app-visit',
  imports: [RouterLink, NgIcon, Eyebrow, RevealDirective],
  providers: [
    provideIcons({
      phosphorArrowUpRightBold,
      phosphorClock,
      phosphorMapPin,
      phosphorTicket,
    }),
  ],
  templateUrl: './visit.html',
  styleUrl: './visit.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Visit {
  protected readonly visitInfo = visitInfo;
}
