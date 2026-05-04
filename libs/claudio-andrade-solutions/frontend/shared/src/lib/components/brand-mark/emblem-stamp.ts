import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * EmblemStamp — emblema solo, sin marco. Watermark editorial limpio
 * (90% opacity por defecto). Usado en `PageHeader` como sello de marca.
 */
@Component({
  selector: 'app-emblem-stamp',
  templateUrl: './emblem-stamp.html',
  styleUrl: './emblem-stamp.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmblemStamp {
  readonly size = input(32);
}
