import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * EmblemMark — emblema circular solo (manta + tortuga + kelp + olas), sin
 * marco ni burbuja. Pensado como contenido de un botón/link cuando la marca
 * pura debe llevar el protagonismo de la identidad.
 */
@Component({
  selector: 'app-emblem-mark',
  templateUrl: './emblem-mark.html',
  styleUrl: './emblem-mark.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmblemMark {
  readonly size = input(40);
}
