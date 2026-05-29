import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { phosphorArrowRightBold, phosphorArrowUpRightBold } from '@ng-icons/phosphor-icons/bold';

import { Product, products } from '@cas-ui-shared/data/data';
import { ImgFadeDirective } from '@cas-ui-shared/directives/img-fade/img-fade.directive';
import { RevealDirective } from '@cas-ui-shared/directives/reveal/reveal.directive';
import { SectionHeading } from '@cas-ui-shared/components/section-heading/section-heading';

// RouterLink se mantiene importado: lo usa el CTA "Ver los 6 productos" del head.
// Las cards no lo usan — ver onCardClick para el motivo.
@Component({
  selector: 'app-featured-products',
  imports: [RouterLink, NgIcon, ImgFadeDirective, RevealDirective, SectionHeading],
  providers: [provideIcons({ phosphorArrowUpRightBold, phosphorArrowRightBold })],
  templateUrl: './featured-products.html',
  styleUrl: './featured-products.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeaturedProducts {
  private readonly router = inject(Router);
  protected readonly featured: ReadonlyArray<Product> = products.slice(0, 5);
  protected readonly activeIndex = signal(0);

  protected onActivate(i: number): void {
    this.activeIndex.set(i);
  }

  // mouseenter en touch se sintetiza durante el tap y, sin este gate, activaba
  // la card ANTES de que onCardClick pudiera comparar el índice previo →
  // el primer tap siempre navegaba. Gate a hover real así el flujo de touch
  // queda bajo el control exclusivo de onCardClick.
  protected onHoverActivate(i: number): void {
    if (
      typeof window !== 'undefined' &&
      !window.matchMedia('(hover: hover)').matches
    ) {
      return;
    }
    this.activeIndex.set(i);
  }

  // Touch + accordion (≥768): el primer tap sobre una card inactiva la expande,
  // el segundo tap (sobre la activa) navega. Sin esto el user en mobile landscape
  // era redirigido al detalle sin poder leer el título ni la descripción —
  // toca a ciegas porque no hay hover que precargue el preview.
  //
  // No usamos routerLink: su HostListener corre antes que (click) en el template
  // y stopImmediatePropagation desde acá llega tarde. Mantenemos href="/productos"
  // para que right-click / middle-click / "abrir en pestaña" sigan funcionando,
  // y navegamos imperativamente vía Router.
  protected onCardClick(event: MouseEvent, i: number): void {
    // Modificadores → deja al browser abrir en nueva pestaña.
    if (
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();

    const isTouchAccordion =
      typeof window !== 'undefined' &&
      window.matchMedia('(hover: none) and (min-width: 768px)').matches;
    if (isTouchAccordion && i !== this.activeIndex()) {
      this.activeIndex.set(i);
      return;
    }
    void this.router.navigateByUrl('/productos');
  }
}
