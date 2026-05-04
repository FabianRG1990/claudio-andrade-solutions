import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { phosphorArrowUpRightBold } from '@ng-icons/phosphor-icons/bold';

import { exhibits } from '@acuario-ui-shared/data/data';
import { ImgFadeDirective } from '@acuario-ui-shared/directives/img-fade/img-fade.directive';
import { PageHeader } from '@acuario-ui-shared/components/page-header/page-header';
import { RevealDirective } from '@acuario-ui-shared/directives/reveal/reveal.directive';

/**
 * ExhibicionesPage — recorrido editorial por los 6 biomas. Header (100dvh,
 * solo en la vista inicial) + grid alternado (imagen ↔ texto) con stats
 * por exhibit. El header ocupa la viewport entera al cargar; el listado
 * aparece en cuanto el usuario scrollea, sin gap muerto en el medio.
 */
@Component({
  selector: 'app-exhibiciones-page',
  imports: [ImgFadeDirective, NgIcon, PageHeader, RevealDirective],
  providers: [provideIcons({ phosphorArrowUpRightBold })],
  templateUrl: './exhibiciones.html',
  styleUrl: './exhibiciones.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExhibicionesPage {
  protected readonly exhibits = exhibits;
}
