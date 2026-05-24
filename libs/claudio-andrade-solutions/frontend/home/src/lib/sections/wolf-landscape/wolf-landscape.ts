import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { phosphorArrowDown } from '@ng-icons/phosphor-icons/regular';
import { phosphorSparkleBold } from '@ng-icons/phosphor-icons/bold';

import { CompanionDockDirective } from '@cas-ui-shared/companion/companion-dock.directive';

import { WolfLakeCanvas } from './wolf-lake-canvas';
import { WolfLakeFlow } from './wolf-lake-flow';
import { WolfSky } from './wolf-sky';

/**
 * WolfLandscape — hero de apertura. Fondo es la imagen estática MK6
 * (`hero-wolf/hero-mk6.{avif|webp|png}`): lago + lobo wireframe + skyline
 * + cielo estrellado. La imagen vive intacta como capa visual base; un
 * `<picture>` la negocia por formato según el navegador.
 *
 * Encima viven (de atrás hacia adelante, z-index ascendente):
 *  0) `<app-wolf-lake-flow>` — Canvas WebGL que aplica un flow map al
 *     área del agua, desplazando la textura existente hacia el bottom
 *     del frame. Fade-in cuando está listo; sin animación si
 *     prefers-reduced-motion o WebGL no está disponible.
 *  1) `<app-wolf-sky>` — 22 estrellas CSS que titilan sobre las
 *     estrellas pintadas del poster (no genera nuevas).
 *  2) `<app-wolf-lake-canvas>` — Canvas2D con peces ambientales + pez del
 *     cursor con física de profundidad, clamped al polígono del lago.
 *  3+) Copy editorial: telemetría top-left, badge + título + lede en
 *      lead column, card "próxima cohorte" + scroll hint en aside.
 *      Legibilidad por text-shadow apilados — sin scrim sobre el bg.
 */
@Component({
  selector: 'app-wolf-landscape',
  imports: [NgIcon, WolfLakeCanvas, WolfLakeFlow, WolfSky, CompanionDockDirective],
  providers: [provideIcons({ phosphorArrowDown, phosphorSparkleBold })],
  templateUrl: './wolf-landscape.html',
  styleUrl: './wolf-landscape.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WolfLandscape {}
