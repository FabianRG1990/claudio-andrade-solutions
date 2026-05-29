import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { phosphorArrowRightBold, phosphorArrowUpRightBold } from '@ng-icons/phosphor-icons/bold';

import { Product, products } from '@cas-ui-shared/data/data';
import { ImgFadeDirective } from '@cas-ui-shared/directives/img-fade/img-fade.directive';
import { RevealDirective } from '@cas-ui-shared/directives/reveal/reveal.directive';
import { SectionHeading } from '@cas-ui-shared/components/section-heading/section-heading';

@Component({
  selector: 'app-featured-products',
  imports: [RouterLink, NgIcon, ImgFadeDirective, RevealDirective, SectionHeading],
  providers: [provideIcons({ phosphorArrowUpRightBold, phosphorArrowRightBold })],
  templateUrl: './featured-products.html',
  styleUrl: './featured-products.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeaturedProducts {
  protected readonly featured: ReadonlyArray<Product> = products.slice(0, 5);
  protected readonly activeIndex = signal(0);

  protected onActivate(i: number): void {
    this.activeIndex.set(i);
  }

  // Hover gateado a `(hover: hover)`: en touch el browser sintetiza mouseenter
  // durante el tap, y eso interferiría con el toggle de accordion. Touch
  // controla la activación exclusivamente vía onCardTap.
  protected onHoverActivate(i: number): void {
    if (
      typeof window !== 'undefined' &&
      !window.matchMedia('(hover: hover)').matches
    ) {
      return;
    }
    this.activeIndex.set(i);
  }

  // Card NUNCA navega — el único punto de navegación es la flecha (.product-card__arrow).
  // En touch + accordion (≥768), tap expande la card. En cualquier otro caso
  // el click sobre la card no hace nada (no debe robar foco ni redirigir).
  protected onCardTap(i: number): void {
    const isTouchAccordion =
      typeof window !== 'undefined' &&
      window.matchMedia('(hover: none) and (min-width: 768px)').matches;
    if (isTouchAccordion) {
      this.activeIndex.set(i);
    }
  }

  // El click en la flecha NO debe burbujear a la card — si lo hace, el
  // tap activaría onCardTap simultáneamente.
  protected onArrowClick(event: MouseEvent): void {
    event.stopPropagation();
  }
}
