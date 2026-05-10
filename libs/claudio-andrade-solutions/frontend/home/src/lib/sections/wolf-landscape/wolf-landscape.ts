import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { phosphorArrowDown } from '@ng-icons/phosphor-icons/regular';
import { phosphorSparkleBold } from '@ng-icons/phosphor-icons/bold';

/**
 * WolfLandscape — hero de apertura. Fondo: imagen estática MK6
 * (`hero-wolf/hero-mk6.png`). Sin video, sin canvas interactivo.
 * Encima vive el copy editorial: telemetría, badge + título + lede en lead
 * column, card "próxima cohorte" + scroll hint en aside derecha. La
 * legibilidad la dan los `text-shadow` apilados — sin scrim.
 */
@Component({
  selector: 'app-wolf-landscape',
  imports: [NgIcon],
  providers: [provideIcons({ phosphorArrowDown, phosphorSparkleBold })],
  templateUrl: './wolf-landscape.html',
  styleUrl: './wolf-landscape.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WolfLandscape {}
