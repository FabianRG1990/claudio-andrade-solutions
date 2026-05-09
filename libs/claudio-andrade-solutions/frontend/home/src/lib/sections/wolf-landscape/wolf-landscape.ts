import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { phosphorArrowDown } from '@ng-icons/phosphor-icons/regular';
import { phosphorSparkleBold } from '@ng-icons/phosphor-icons/bold';

import { WolfLakeCanvas } from './wolf-lake-canvas';
// WolfSky importado pero NO usado — la capa CSS quedó desactivada.
// Se mantiene el archivo por si después decidimos re-habilitar partes.
// import { WolfSky } from './wolf-sky';

/**
 * WolfLandscape — hero de apertura. Fondo es la imagen estática MK3
 * (`hero-wolf/hero-mk3.png`): lago + lobo + skyline + Vía Láctea + puntos
 * bioluminiscentes. La imagen vive intacta como capa visual base.
 *
 * Encima viven (de atrás hacia adelante):
 *  1) `<app-wolf-lake-canvas>` — Canvas2D que dibuja peces ambientales y
 *     un pez que sigue el cursor con física de profundidad. Solo dibuja
 *     dentro de la máscara del lago, así que ningún pez sube a la roca,
 *     a los árboles ni al cielo.
 *  2) Copy editorial: telemetría top-left, badge + título + lede en lead
 *     column, card "próxima cohorte" + scroll hint en aside derecha. La
 *     legibilidad la dan los `text-shadow` apilados — sin scrim.
 */
@Component({
  selector: 'app-wolf-landscape',
  imports: [NgIcon, WolfLakeCanvas],
  providers: [provideIcons({ phosphorArrowDown, phosphorSparkleBold })],
  templateUrl: './wolf-landscape.html',
  styleUrl: './wolf-landscape.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WolfLandscape {}
