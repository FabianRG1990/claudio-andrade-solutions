import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowUpRightBold,
  phosphorCheckBold,
} from '@ng-icons/phosphor-icons/bold';

import { engagements } from '@cas-ui-shared/data/data';
import { Eyebrow } from '@cas-ui-shared/components/eyebrow/eyebrow';
import { RevealDirective } from '@cas-ui-shared/directives/reveal/reveal.directive';
import { CompanionDockDirective } from '@cas-ui-shared/companion/companion-dock.directive';

/**
 * Engagements — capítulo 03 del manifiesto. Tres modelos de contratación en
 * grid; el central (highlight=true) se eleva, escala y pinta con tintes
 * lagoon.
 */
@Component({
  selector: 'app-engagements',
  imports: [RouterLink, NgIcon, Eyebrow, RevealDirective, CompanionDockDirective],
  providers: [
    provideIcons({ phosphorArrowUpRightBold, phosphorCheckBold }),
  ],
  templateUrl: './engagements.html',
  styleUrl: './engagements.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Engagements {
  protected readonly engagements = engagements;
}
