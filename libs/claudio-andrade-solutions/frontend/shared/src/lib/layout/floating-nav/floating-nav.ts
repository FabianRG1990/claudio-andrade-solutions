import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  afterNextRender,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorList,
  phosphorX,
} from '@ng-icons/phosphor-icons/regular';
import { filter, map, startWith } from 'rxjs/operators';

import { EmblemMark } from '../../components/brand-mark/emblem-mark';
import { GlassPillCanvas } from '../glass-pill-canvas/glass-pill-canvas';

interface NavLink {
  readonly href: string;
  readonly label: string;
}

const LINKS: ReadonlyArray<NavLink> = [
  { href: '/', label: 'Inicio' },
  { href: '/productos', label: 'Productos' },
  { href: '/nosotros', label: 'Acerca de nosotros' },
  { href: '/contacto', label: 'Contáctenos' },
];

/**
 * FloatingNav — split en dos contenedores:
 *  - Brand-bar (position: fixed) con emblema + wordmark, persistente arriba.
 *  - Rail (position: absolute) con la pill desktop y el burger móvil; al
 *    scrollear se va con la página (no es fixed).
 *
 *  - Pill desktop con `<app-glass-pill-canvas>` Three.js detrás de los links
 *  - Indicador del link activo (fade-in via clase, sustituye `layoutId`)
 *  - Burger + bottom-sheet móvil con stagger en los items
 *  - Cursor spotlight escrito como CSS vars (`--mx`, `--my`, `--m-opacity`)
 *  - Cierre automático del menú al cambiar de ruta
 *  - Body scroll lock cuando el menú móvil está abierto
 */
@Component({
  selector: 'app-floating-nav',
  imports: [RouterLink, NgIcon, EmblemMark, GlassPillCanvas],
  providers: [provideIcons({ phosphorList, phosphorX })],
  templateUrl: './floating-nav.html',
  styleUrl: './floating-nav.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FloatingNav {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  protected readonly links = LINKS;
  protected readonly menuOpen = signal(false);
  // pillVisible: refleja si el pill desktop/tablet está realmente en pantalla
  // (≥880px, breakpoint del SCSS). Se usa para gatear el `<app-glass-pill-canvas>`
  // — sin esto el canvas Three.js + WebGL context se monta y corre RAF aún
  // cuando el pill es display:none en mobile, gastando GPU innecesariamente.
  // matchMedia es estable, no hace polling.
  protected readonly pillVisible = signal(false);

  private readonly navRef =
    viewChild<ElementRef<HTMLElement>>('navRef');

  /** URL actual reactiva — sustituto Angular del `usePathname` de Next. */
  protected readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  protected isActive(link: NavLink): boolean {
    const url = this.currentUrl();
    return link.href === '/' ? url === '/' : url.startsWith(link.href);
  }

  /**
   * `true` cuando la ruta actual es la home — el brand (logo + wordmark)
   * solo se renderiza ahí porque vive anclado al Hero, y el Hero solo
   * existe en la home.
   */
  protected isHome(): boolean {
    return this.currentUrl() === '/';
  }

  /**
   * Click handler para el brand y los links del nav. Si el destino es la
   * misma ruta donde ya estás, hace scroll-to-top suave (replica el
   * comportamiento del original: logo o "Inicio" siempre te devuelven al
   * hero, aunque ya estés en `/`). Si la ruta es distinta, deja que
   * RouterLink navegue normalmente — el `scrollPositionRestoration: 'top'`
   * del router config se encarga del reset.
   */
  protected onLinkClick(href: string, event: MouseEvent): void {
    if (!this.isBrowser) return;
    if (this.router.url === href || (href === '/' && this.router.url === '/')) {
      event.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  constructor() {
    // Sondeo de matchMedia para gatear el canvas WebGL del pill. El listener
    // se enchufa solo en browser (afterNextRender) y se limpia con DestroyRef.
    afterNextRender(() => {
      const mql = window.matchMedia('(min-width: 880px)');
      this.pillVisible.set(mql.matches);
      const onMqlChange = (e: MediaQueryListEvent): void => {
        this.pillVisible.set(e.matches);
      };
      mql.addEventListener('change', onMqlChange);
      this.destroyRef.onDestroy(() => mql.removeEventListener('change', onMqlChange));
    });

    // Cursor spotlight — escribe variables CSS sobre el pill directamente,
    // sin re-renders. El estilo del spotlight (`::after`) lo hidrata el CSS
    // del design system (variables consumidas por `.glass-nav` aunque aquí
    // no estén activadas; el patrón se conserva por paridad con el origen).
    afterNextRender(() => {
      const navEl = this.navRef()?.nativeElement;
      if (!navEl) return;

      const onMove = (e: PointerEvent): void => {
        const rect = navEl.getBoundingClientRect();
        navEl.style.setProperty('--mx', `${e.clientX - rect.left}px`);
        navEl.style.setProperty('--my', `${e.clientY - rect.top}px`);
      };
      const onEnter = (): void => {
        navEl.style.setProperty('--m-opacity', '1');
      };
      const onLeave = (): void => {
        navEl.style.setProperty('--m-opacity', '0');
      };

      navEl.addEventListener('pointermove', onMove);
      navEl.addEventListener('pointerenter', onEnter);
      navEl.addEventListener('pointerleave', onLeave);

      this.destroyRef.onDestroy(() => {
        navEl.removeEventListener('pointermove', onMove);
        navEl.removeEventListener('pointerenter', onEnter);
        navEl.removeEventListener('pointerleave', onLeave);
      });
    });

    // Body scroll lock cuando el menú móvil está abierto.
    effect(() => {
      if (!this.isBrowser) return;
      document.body.style.overflow = this.menuOpen() ? 'hidden' : '';
    });

    this.destroyRef.onDestroy(() => {
      if (this.isBrowser) document.body.style.overflow = '';
    });

    // Cierre automático del menú al cambiar de ruta.
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.menuOpen.set(false));
  }

  protected toggleMenu(): void {
    this.menuOpen.update((v) => !v);
  }
}
