import { isPlatformBrowser } from '@angular/common';
import {
  DestroyRef,
  Directive,
  ElementRef,
  HostBinding,
  PLATFORM_ID,
  afterNextRender,
  inject,
  input,
} from '@angular/core';

/**
 * appReveal — directiva equivalente al `<Reveal>` con framer-motion del
 * proyecto Next. Aplica las clases `.reveal` (oculto + blur) y, una vez que
 * el elemento entra en viewport, agrega `.is-visible` para disparar la
 * transición CSS definida en `_utilities.scss`.
 *
 * Uso:
 *   <div appReveal>...</div>
 *   <div appReveal [delay]="0.08">...</div>
 *   <div appReveal [delay]="0.16" [amount]="0.6">...</div>
 *
 * Honora `prefers-reduced-motion` automáticamente desde la regla CSS:
 * cuando el usuario lo solicita, el estado oculto se anula y el elemento
 * se ve sin animación.
 */
@Directive({
  selector: '[appReveal]',
  standalone: true,
})
export class RevealDirective {
  /** Delay en segundos antes de iniciar la transición. */
  readonly delay = input(0);

  /** Porcentaje del elemento visible necesario para disparar (0..1). El
   *  default es 0.15 (no 0.4 como framer-motion) porque IntersectionObserver
   *  trata el threshold como ratio estricto: para elementos más altos que
   *  el viewport, 0.4 jamás se alcanza y el reveal nunca dispara. 0.15 da
   *  un trigger temprano y consistente sin importar el alto del elemento. */
  readonly amount = input(0.15);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly destroyRef = inject(DestroyRef);

  @HostBinding('class.reveal') readonly hostClass = true;

  constructor() {
    afterNextRender(() => {
      if (!this.isBrowser) return;

      const el = this.host.nativeElement;
      el.style.setProperty('--reveal-delay', `${this.delay()}s`);

      // Si el usuario prefiere movimiento reducido, marca como visible
      // de inmediato (la regla CSS ya neutraliza la transición).
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        el.classList.add('is-visible');
        return;
      }

      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            // Sin rAF defer: ahora `.reveal` usa CSS `animation` (no
            // `transition`), y las animations sí corren incluso si la
            // clase `.is-visible` se aplica en el mismo frame que el
            // mount del componente.
            el.classList.add('is-visible');
            observer.disconnect();
          }
        },
        { threshold: this.amount() },
      );
      observer.observe(el);

      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }
}
