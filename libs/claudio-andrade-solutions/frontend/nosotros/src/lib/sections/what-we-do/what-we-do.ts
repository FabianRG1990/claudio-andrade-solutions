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

import { prefersReducedMotion } from '@cas-ui-shared/utils/device-capability';
import { ImgFadeDirective } from '@cas-ui-shared/directives/img-fade/img-fade.directive';
import { PillButton } from '@cas-ui-shared/components/pill-button/pill-button';

interface Person {
  /** Nombre completo (se muestra como título del copy). */
  name: string;
  /** Palabra fantasma gigante de fondo — el nombre de pila (estática). */
  ghost: string;
  /** Rol / cargo (eyebrow con color de acento). */
  role: string;
  /** Mini-bio corta. */
  bio: string;
  /** Ruta de la foto (sin extensión; se sirve avif + webp). Si está vacía se
   *  muestra el rectángulo placeholder. El usuario enviará los retratos. */
  image?: string;
  accent: 'coral' | 'lagoon' | 'bioluminescent';
}

// Nombres REALES (los 3 pilares de la empresa). Roles/bios son PLACEHOLDER y
// las fotos aún no existen → se muestra el rectángulo placeholder hasta que el
// usuario envíe los retratos (entonces se setea `image`).
const PEOPLE: ReadonlyArray<Person> = [
  {
    name: 'Claudio Andrade',
    ghost: 'Claudio',
    role: 'Fundador · Tech Lead',
    bio: 'Define la arquitectura y marca el estándar técnico del equipo. Convierte retos de negocio complejos en sistemas probados que escalan.',
    image: '/equipo/claudio',
    // Azul como el resto del equipo (antes coral/rojo).
    accent: 'lagoon',
  },
  {
    name: 'Fabián Rodríguez',
    ghost: 'Fabián',
    role: 'Developer · IA generativa · Landing pages premium',
    bio: 'Domina la IA generativa aplicada al diseño y desarrolla landing pages premium de alto rendimiento. Integra IA y código en experiencias de marca de alto impacto.',
    image: '/equipo/fabian',
    accent: 'lagoon',
  },
  {
    name: 'Steven Muñoz',
    ghost: 'Steven',
    role: 'UI/UX premium · Desarrollo',
    bio: 'Diseña y construye experiencias UI/UX premium donde cada detalle está calculado. Lleva la interfaz del concepto al código sin perder un pixel de precisión.',
    image: '/equipo/steven',
    accent: 'bioluminescent',
  },
];

/**
 * WhatWeDo — segmento "Nuestro equipo" con scroll pinned inspirado en
 * baunfire.com. La escena (`__stage`) se queda fija (`position: sticky`)
 * mientras el usuario recorre un "track" alto (N × 100svh); a medida que avanza
 * el scroll cambia la persona activa: el nombre de fondo (estático) hace
 * crossfade elegante, la imagen rotada se revela, y el copy + dots se actualizan.
 *
 * No es wheel-hijack: el scroll del usuario es normal, solo el contenido hace
 * crossfade mientras la escena está pinned. Toda la lógica corre dentro de
 * `afterNextRender` (browser-only) y se limpia en `DestroyRef`. En
 * `prefers-reduced-motion` el track colapsa y los slides se apilan visibles.
 */
@Component({
  selector: 'app-what-we-do',
  imports: [ImgFadeDirective, PillButton],
  templateUrl: './what-we-do.html',
  styleUrl: './what-we-do.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WhatWeDo {
  protected readonly people = PEOPLE;

  /** Persona actualmente activa (0..N-1). */
  protected readonly activeIndex = signal(0);

  private readonly track = viewChild.required<ElementRef<HTMLElement>>('track');

  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly destroyRef = inject(DestroyRef);

  // Altura recorrible del track (alto del track − viewport). Se recalcula en
  // resize. El `top` se lee en vivo en cada scroll para no desfasarse si el
  // header asienta su altura después del load.
  private trackScrollable = 1;

  constructor() {
    afterNextRender(() => {
      if (!this.isBrowser) return;

      // En reduced-motion la plantilla/CSS ya cubren el fallback apilado: no
      // hace falta listener de scroll.
      if (prefersReducedMotion()) return;

      const trackEl = this.track().nativeElement;

      // Reset a "ningún slide activo": en SSR/init es 0 (progressive enhancement
      // sin JS), pero al hidratar lo apagamos para que el slide 0 dispare su
      // animación de ingreso cuando el usuario entra a la sección — igual que
      // los demás, en vez de aparecer ya formado.
      this.activeIndex.set(-1);

      const measure = () => {
        this.trackScrollable = Math.max(1, trackEl.offsetHeight - window.innerHeight);
        update();
      };

      const update = () => {
        const rectTop = trackEl.getBoundingClientRect().top;
        // Hasta que la sección no entra ~media pantalla, ningún slide activo;
        // así el slide 0 entra animado (nombre → foto) al cruzar el umbral.
        if (rectTop > window.innerHeight * 0.5) {
          if (this.activeIndex() !== -1) this.activeIndex.set(-1);
          return;
        }
        // `-rectTop` = cuánto del track quedó por encima del borde superior del
        // viewport. Lectura en vivo → inmune a layout shifts del header.
        const p = Math.min(1, Math.max(0, -rectTop / this.trackScrollable));
        const idx = Math.min(this.people.length - 1, Math.floor(p * this.people.length));
        if (idx !== this.activeIndex()) this.activeIndex.set(idx);
      };

      // Scroll throttled con rAF (un solo frame pendiente a la vez).
      let scrollRaf = 0;
      const onScroll = () => {
        if (scrollRaf) return;
        scrollRaf = requestAnimationFrame(() => {
          scrollRaf = 0;
          update();
        });
      };

      window.addEventListener('scroll', onScroll, { passive: true });

      const ro = new ResizeObserver(() => measure());
      ro.observe(trackEl);

      measure();

      this.destroyRef.onDestroy(() => {
        window.removeEventListener('scroll', onScroll);
        if (scrollRaf) cancelAnimationFrame(scrollRaf);
        ro.disconnect();
      });
    });
  }

  /** Devuelve la clase de estado de un slide relativo al activo. */
  protected slideState(i: number): 'is-active' | 'is-prev' | 'is-next' {
    const active = this.activeIndex();
    if (i === active) return 'is-active';
    return i < active ? 'is-prev' : 'is-next';
  }

  /** Scroll programático al tramo central de la persona `i` (dots). */
  protected goTo(i: number): void {
    if (!this.isBrowser) return;
    const trackEl = this.track().nativeElement;
    const trackTop = trackEl.getBoundingClientRect().top + window.scrollY;
    const fraction = (i + 0.5) / this.people.length;
    const target = trackTop + fraction * this.trackScrollable;
    window.scrollTo({ top: target, behavior: 'smooth' });
  }
}
