import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';

import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { phosphorArrowUpRightBold } from '@ng-icons/phosphor-icons/bold';

import { caseStudies } from '@cas-ui-shared/data/data';
import { prefersReducedMotion } from '@cas-ui-shared/utils/device-capability';
import { RevealDirective } from '@cas-ui-shared/directives/reveal/reveal.directive';
import { SectionHeading } from '@cas-ui-shared/components/section-heading/section-heading';

// Cadencia por slide (ms). 3.5 s permite leer caption + asentar ken-burns
// (4.5 s con 1.2 s delay = ~3.3 s de movimiento visible) antes del siguiente
// cross-fade.
const SLIDE_INTERVAL_MS = 3500;
// Stagger entre carruseles para que los 3 cards no avancen sincronizados.
const STAGGER_OFFSET_MS = 700;

/**
 * CaseStudies — capítulo 04 · "Casos destacados" (×3).
 *
 * Carrusel autopaced. Best-practice 2025 (web research):
 *   • setInterval para advance (industry standard, simple, predecible).
 *   • IntersectionObserver para start/stop según visibilidad de la sección
 *     en viewport — ahorra CPU + evita avance fantasma cuando el usuario no
 *     está mirando.
 *   • document.visibilitychange para pausar cuando la pestaña queda en bg
 *     (los browsers throttlean setInterval a 1 Hz en hidden, lo que rompe
 *     la cadencia visual al volver al foreground).
 *   • prefers-reduced-motion gate.
 *   • SIN hover-pause (pointerenter/leave). Investigación: el patrón
 *     pointer-pause es frágil — `pointerleave` no siempre dispara cuando
 *     el cursor sale por focus, scroll o page transition, y deja el
 *     interval cancelado de forma permanente. Sin hover-pause + IO el
 *     usuario puede tener mouse sobre el card horas y el ciclo continúa.
 *
 * Cada caso lleva su propio interval id; el stagger inicial garantiza que
 * los tres carruseles no laten a la vez.
 */
@Component({
  selector: 'app-case-studies',
  imports: [RouterLink, NgIcon, RevealDirective, SectionHeading],
  providers: [provideIcons({ phosphorArrowUpRightBold })],
  templateUrl: './case-studies.html',
  styleUrl: './case-studies.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CaseStudies {
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly hostEl = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  protected readonly cases = caseStudies;
  protected readonly indices = caseStudies.map(() => signal(0));

  private readonly intervalIds: Array<number | null> = caseStudies.map(() => null);
  private readonly staggerIds: Array<number | null> = caseStudies.map(() => null);
  private prefersReducedMotion = false;
  private intersectionObs: IntersectionObserver | null = null;
  private isOnScreen = false;

  constructor() {
    afterNextRender(() => {
      if (!this.isBrowser) return;
      this.prefersReducedMotion = prefersReducedMotion();

      // 1) IntersectionObserver — start/stop según viewport. threshold 0.1
      //    porque la sección es alta; con 0.5 tardaría mucho en disparar.
      this.intersectionObs = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            this.isOnScreen = e.isIntersecting;
            if (e.isIntersecting) {
              this.startAll();
            } else {
              this.stopAll();
            }
          }
        },
        { threshold: 0.1 },
      );
      this.intersectionObs.observe(this.hostEl.nativeElement);

      // 2) visibilitychange — pestaña en background pausa, vuelve al
      //    foreground re-arranca con stagger fresco (timestamps reseteados).
      document.addEventListener('visibilitychange', this.onVisibilityChange);

      this.destroyRef.onDestroy(() => {
        this.stopAll();
        this.intersectionObs?.disconnect();
        this.intersectionObs = null;
        document.removeEventListener('visibilitychange', this.onVisibilityChange);
      });
    });
  }

  protected pad(n: number): string {
    return n.toString().padStart(2, '0');
  }

  /** Visibilidad de pestaña — `document.hidden` es la fuente de verdad. */
  private readonly onVisibilityChange = (): void => {
    if (document.hidden) {
      this.stopAll();
    } else if (this.isOnScreen) {
      this.startAll();
    }
  };

  private startAll(): void {
    if (this.prefersReducedMotion) return;
    this.cases.forEach((_, i) => this.startOne(i));
  }

  private stopAll(): void {
    this.cases.forEach((_, i) => this.stopOne(i));
  }

  private startOne(i: number): void {
    if (!this.isBrowser || this.prefersReducedMotion) return;
    // Idempotente — limpia antes de re-armar.
    this.stopOne(i);
    this.staggerIds[i] = window.setTimeout(() => {
      this.staggerIds[i] = null;
      this.intervalIds[i] = window.setInterval(() => {
        const sig = this.indices[i];
        sig.update((idx) => (idx + 1) % this.cases[i].slides.length);
      }, SLIDE_INTERVAL_MS);
    }, STAGGER_OFFSET_MS * i);
  }

  private stopOne(i: number): void {
    if (this.intervalIds[i] !== null) {
      window.clearInterval(this.intervalIds[i] as number);
      this.intervalIds[i] = null;
    }
    if (this.staggerIds[i] !== null) {
      window.clearTimeout(this.staggerIds[i] as number);
      this.staggerIds[i] = null;
    }
  }
}
