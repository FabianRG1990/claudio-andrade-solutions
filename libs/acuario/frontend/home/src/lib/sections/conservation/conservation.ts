import { ChangeDetectionStrategy, Component } from '@angular/core';

import { conservationStats } from '@acuario-ui-shared/data/data';
import { ImgFadeDirective } from '@acuario-ui-shared/directives/img-fade/img-fade.directive';
import { PillButton } from '@acuario-ui-shared/components/pill-button/pill-button';
import { RevealDirective } from '@acuario-ui-shared/directives/reveal/reveal.directive';
import { SectionHeading } from '@acuario-ui-shared/components/section-heading/section-heading';

/**
 * Conservation — capítulo 04. Programa destacado a la izquierda (Lab
 * Coralino) + columna derecha con 4 stats tipográficos y manifiesto del 38%.
 */
@Component({
  selector: 'app-conservation',
  imports: [ImgFadeDirective, PillButton, RevealDirective, SectionHeading],
  templateUrl: './conservation.html',
  styleUrl: './conservation.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Conservation {
  protected readonly stats = conservationStats;
}
