import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { phosphorArrowUpRightBold } from '@ng-icons/phosphor-icons/bold';

import { products } from '@cas-ui-shared/data/data';
import { ImgFadeDirective } from '@cas-ui-shared/directives/img-fade/img-fade.directive';
import { PageHeader } from '@cas-ui-shared/components/page-header/page-header';
import { RevealDirective } from '@cas-ui-shared/directives/reveal/reveal.directive';

/**
 * ProductosPage — catálogo editorial de los 6 productos premium. Header
 * (100dvh) + grid alternado (imagen ↔ texto) con métricas por producto.
 * Cada CTA dirige a /contacto para iniciar el proceso de propuesta.
 */
@Component({
  selector: 'app-productos-page',
  imports: [ImgFadeDirective, NgIcon, PageHeader, RevealDirective, RouterLink],
  providers: [provideIcons({ phosphorArrowUpRightBold })],
  templateUrl: './productos.html',
  styleUrl: './productos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductosPage {
  protected readonly products = products;
}
