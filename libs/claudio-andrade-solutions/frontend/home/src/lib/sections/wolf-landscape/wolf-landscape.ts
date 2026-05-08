import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { phosphorArrowDown } from '@ng-icons/phosphor-icons/regular';
import { phosphorSparkleBold } from '@ng-icons/phosphor-icons/bold';

/**
 * WolfLandscape — hero de apertura. Fondo es una sola imagen estática
 * (`hero-wolf/hero-mk2.png`): lago + lobo + skyline + puntos
 * bioluminiscentes en el agua. Sin canvas, sin fish, sin niebla: la
 * escena no anima.
 *
 * Encima vive una sola capa de copy editorial: telemetría arriba a la
 * izquierda (la derecha se quitó para no taparle la cara al lobo),
 * badge + título + lede en lead column izquierda y card "próxima
 * cohorte" + scroll hint en aside derecha. La legibilidad sobre la
 * escena la dan los `text-shadow` apilados de cada elemento — sin
 * scrim/vignette.
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
