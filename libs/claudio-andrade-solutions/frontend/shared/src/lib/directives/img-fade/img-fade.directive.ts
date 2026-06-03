import { isPlatformBrowser } from '@angular/common';
import {
  Directive,
  ElementRef,
  PLATFORM_ID,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';

/**
 * appImgFade — fade-in suave para `<img>` cuando termina de cargar. Replica
 * el efecto de `next/image` que oculta el `<img>` hasta que la decodificación
 * está lista para evitar el "pop in" áspero.
 *
 * Comportamiento:
 *   - SSR: render con la imagen visible (no escondemos en server, eso rompe
 *     SEO y first contentful paint).
 *   - Cliente: si la imagen ya está cacheada (`complete && naturalWidth > 0`)
 *     marca como cargada inmediatamente. Si no, oculta hasta que dispara
 *     el evento `load`, momento en que añade `.img-fade--loaded` y la CSS
 *     hace fade de 0 → 1 en 700 ms.
 *
 * Uso:
 *   <img appImgFade [src]="..." [alt]="..." />
 */
@Directive({
  selector: 'img[appImgFade]',
  standalone: true,
  host: {
    class: 'img-fade',
    '[class.img-fade--pending]': 'pending()',
    '[class.img-fade--loaded]': 'loaded()',
    '(load)': 'onLoad()',
  },
})
export class ImgFadeDirective {
  private readonly el = inject<ElementRef<HTMLImageElement>>(ElementRef);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly pending = signal(false);
  protected readonly loaded = signal(false);

  constructor() {
    if (!isPlatformBrowser(this.platformId)) return;

    // En cliente: marca pending así la regla CSS la oculta. afterNextRender
    // garantiza que las host bindings ya están aplicadas antes de chequear
    // si la imagen estaba cacheada (caso típico tras navegar dentro del SPA).
    afterNextRender(() => {
      const img = this.el.nativeElement;
      if (img.complete && img.naturalWidth > 0) {
        this.loaded.set(true);
        return;
      }
      this.pending.set(true);
    });
  }

  protected onLoad(): void {
    this.pending.set(false);
    this.loaded.set(true);
  }
}
