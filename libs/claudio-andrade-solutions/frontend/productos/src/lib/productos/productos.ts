import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { phosphorArrowUpRightBold } from '@ng-icons/phosphor-icons/bold';

import { products } from '@cas-ui-shared/data/data';
import { ImgFadeDirective } from '@cas-ui-shared/directives/img-fade/img-fade.directive';
import { PageHeader } from '@cas-ui-shared/components/page-header/page-header';
import { RevealDirective } from '@cas-ui-shared/directives/reveal/reveal.directive';
import { WhatsappHub } from '@cas-ui-shared/components/whatsapp-hub/whatsapp-hub';

/**
 * ProductosPage — catálogo editorial de los 6 productos premium. Header
 * (100dvh) + grid alternado (imagen ↔ texto) con métricas por producto.
 * Cada CTA abre el WhatsappHub para iniciar la conversación de propuesta
 * con el contacto que el usuario prefiera (ventas, CEO o diseño).
 */
@Component({
  selector: 'app-productos-page',
  imports: [ImgFadeDirective, NgIcon, PageHeader, RevealDirective, WhatsappHub],
  providers: [provideIcons({ phosphorArrowUpRightBold })],
  templateUrl: './productos.html',
  styleUrl: './productos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductosPage {
  protected readonly products = products;
}
