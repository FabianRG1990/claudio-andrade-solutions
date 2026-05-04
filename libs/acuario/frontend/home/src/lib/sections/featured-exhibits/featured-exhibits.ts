import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { phosphorArrowUpRightBold } from '@ng-icons/phosphor-icons/bold';

import { Exhibit, exhibits } from '@acuario-ui-shared/data/data';
import { ImgFadeDirective } from '@acuario-ui-shared/directives/img-fade/img-fade.directive';
import { RevealDirective } from '@acuario-ui-shared/directives/reveal/reveal.directive';
import { SectionHeading } from '@acuario-ui-shared/components/section-heading/section-heading';

/**
 * FeaturedExhibits — primer capítulo del manifiesto. SectionHeading + CTA al
 * lado, y bento asimétrico de 5 cards (1 XL + 4 medianas) con los biomas.
 */
@Component({
  selector: 'app-featured-exhibits',
  imports: [RouterLink, NgIcon, ImgFadeDirective, RevealDirective, SectionHeading],
  providers: [provideIcons({ phosphorArrowUpRightBold })],
  templateUrl: './featured-exhibits.html',
  styleUrl: './featured-exhibits.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeaturedExhibits {
  protected readonly featured: ReadonlyArray<Exhibit> = exhibits.slice(0, 5);
}
