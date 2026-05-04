import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { BubbleStream } from '../bubble-stream/bubble-stream';
import { CausticBg } from '../caustic-bg/caustic-bg';
import { EmblemStamp } from '../brand-mark/emblem-stamp';
import { Eyebrow } from '../eyebrow/eyebrow';
import { RevealDirective } from '../../directives/reveal/reveal.directive';

/**
 * PageHeader — header editorial reutilizable para las rutas internas
 * (/exhibiciones, /especies, /contacto). Replica el `<PageHeader>` del
 * proyecto Next: bg-mesh-deep + caustic + bubble-stream + reveal staggered
 * sobre dos columnas (eyebrow/capítulo/sello a la izquierda, título +
 * descripción a la derecha).
 */
@Component({
  selector: 'app-page-header',
  imports: [BubbleStream, CausticBg, EmblemStamp, Eyebrow, RevealDirective],
  templateUrl: './page-header.html',
  styleUrl: './page-header.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PageHeader {
  readonly eyebrow = input.required<string>();
  readonly capitulo = input.required<string>();
  readonly title = input.required<string>();
  readonly italic = input<string | undefined>(undefined);
  readonly description = input<string | undefined>(undefined);
}
