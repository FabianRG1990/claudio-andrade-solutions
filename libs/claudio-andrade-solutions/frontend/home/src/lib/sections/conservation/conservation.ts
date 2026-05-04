import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';

import {
  conservationStats,
  moofyCaseSlides,
} from '@cas-ui-shared/data/data';
import { ImgFadeDirective } from '@cas-ui-shared/directives/img-fade/img-fade.directive';
import { PillButton } from '@cas-ui-shared/components/pill-button/pill-button';
import { RevealDirective } from '@cas-ui-shared/directives/reveal/reveal.directive';
import { SectionHeading } from '@cas-ui-shared/components/section-heading/section-heading';

// Duración por slide (ms). 3.5 s: ritmo punzante pero da tiempo a leer
// el counter y el caption del slide-label antes de que cambie la imagen.
const SLIDE_INTERVAL_MS = 3500;

/**
 * Conservation — capítulo 04 reconvertido a "Caso destacado". Antes
 * mostraba un único programa de conservación; hoy es un showcase del
 * trabajo real: carrusel de 5 capturas de moofy.vip (la plataforma para
 * proveedores de Walmart construida por CAS) con cross-fade + ken-burns
 * y barra de progreso Stories-style. La transición misma demuestra el
 * nivel de detalle del estudio: matar dos pájaros — caso real + skill
 * de animación premium en una sola lectura.
 *
 * El carrusel se gatea estrictamente a browser (sin auto-advance en SSR)
 * y respeta `prefers-reduced-motion` apagando el interval.
 */
@Component({
  selector: 'app-conservation',
  imports: [ImgFadeDirective, PillButton, RevealDirective, SectionHeading],
  templateUrl: './conservation.html',
  styleUrl: './conservation.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Conservation {
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  protected readonly stats = conservationStats;
  protected readonly slides = moofyCaseSlides;
  protected readonly currentIndex = signal(0);

  // Mantenemos referencia al timer para poder reiniciarlo cuando el
  // usuario hace click en una bar (queremos darle 4 s frescos en su
  // selección, no terminar el contador previo) o pausarlo en hover.
  private intervalId: number | null = null;
  private prefersReducedMotion = false;

  constructor() {
    afterNextRender(() => {
      if (!this.isBrowser) return;
      this.prefersReducedMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches;
      this.startInterval();
      this.destroyRef.onDestroy(() => this.stopInterval());
    });
  }

  /** Formato "01", "02"... para el contador editorial del slide-label. */
  protected pad(n: number): string {
    return n.toString().padStart(2, '0');
  }

  /** Pointer enter sobre el frame: pausa el avance automático. */
  protected pause(): void {
    this.stopInterval();
  }

  /** Pointer leave: retoma el ciclo desde donde está. */
  protected resume(): void {
    this.startInterval();
  }

  private startInterval(): void {
    if (!this.isBrowser || this.prefersReducedMotion) return;
    this.stopInterval();
    this.intervalId = window.setInterval(() => {
      this.currentIndex.update((i) => (i + 1) % this.slides.length);
    }, SLIDE_INTERVAL_MS);
  }

  private stopInterval(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
