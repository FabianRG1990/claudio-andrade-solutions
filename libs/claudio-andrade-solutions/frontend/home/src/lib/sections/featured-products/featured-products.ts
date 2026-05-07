import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { phosphorArrowUpRightBold } from '@ng-icons/phosphor-icons/bold';

import { Product, products } from '@cas-ui-shared/data/data';
import { ImgFadeDirective } from '@cas-ui-shared/directives/img-fade/img-fade.directive';
import { RevealDirective } from '@cas-ui-shared/directives/reveal/reveal.directive';
import { SectionHeading } from '@cas-ui-shared/components/section-heading/section-heading';

/**
 * FeaturedProducts — primer capítulo del manifiesto. SectionHeading + CTA al
 * lado, y bento asimétrico de 5 cards (1 XL + 4 medianas) con los productos.
 */
@Component({
  selector: 'app-featured-products',
  imports: [RouterLink, NgIcon, ImgFadeDirective, RevealDirective, SectionHeading],
  providers: [provideIcons({ phosphorArrowUpRightBold })],
  templateUrl: './featured-products.html',
  styleUrl: './featured-products.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeaturedProducts {
  protected readonly featured: ReadonlyArray<Product> = products.slice(0, 5);
}
