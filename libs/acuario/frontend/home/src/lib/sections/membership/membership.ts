import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowUpRightBold,
  phosphorCheckBold,
} from '@ng-icons/phosphor-icons/bold';

import { tickets } from '@acuario-ui-shared/data/data';
import { Eyebrow } from '@acuario-ui-shared/components/eyebrow/eyebrow';
import { RevealDirective } from '@acuario-ui-shared/directives/reveal/reveal.directive';

/**
 * Membership — capítulo 03 del Patronato. Tres tickets en grid; el central
 * (highlight=true) se eleva, escala y pinta con tintes lagoon.
 */
@Component({
  selector: 'app-membership',
  imports: [RouterLink, NgIcon, Eyebrow, RevealDirective],
  providers: [
    provideIcons({ phosphorArrowUpRightBold, phosphorCheckBold }),
  ],
  templateUrl: './membership.html',
  styleUrl: './membership.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Membership {
  protected readonly tickets = tickets;
}
