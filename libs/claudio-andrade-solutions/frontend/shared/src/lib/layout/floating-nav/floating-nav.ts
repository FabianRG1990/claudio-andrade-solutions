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
  phosphorChatCircleText,
  phosphorHouseSimple,
  phosphorList,
  phosphorPackage,
  phosphorUsersThree,
  phosphorX,
} from '@ng-icons/phosphor-icons/regular';
import { filter, map, startWith } from 'rxjs/operators';

interface NavLink {
  readonly href: string;
  readonly label: string;
  /** Nombre del icono phosphor — protagonista visual del item en el drawer
   *  mobile (réplica del patrón side-menu de moofyvip). */
  readonly icon: string;
}

const LINKS: ReadonlyArray<NavLink> = [
  { href: '/', label: 'Inicio', icon: 'phosphorHouseSimple' },
  { href: '/productos', label: 'Productos', icon: 'phosphorPackage' },
  { href: '/nosotros', label: 'Acerca de nosotros', icon: 'phosphorUsersThree' },
  { href: '/contacto', label: 'Contáctenos', icon: 'phosphorChatCircleText' },
];

/**
 * FloatingNav — rail centrado horizontalmente con los links del sitio.
 * El brand (logo + wordmark) ya no vive aquí: se quitó por pedido del
 * usuario. El nav es solo links flotando con hover hermoso.
 *
 *  - Indicador del link activo (fade-in via clase, sustituye `layoutId`)
 *  - Burger + bottom-sheet móvil con stagger en los items
 *  - Cierre automático del menú al cambiar de ruta
 *  - Body scroll lock cuando el menú móvil está abierto
 */
@Component({
  selector: 'app-floating-nav',
  imports: [RouterLink, NgIcon],
  providers: [
    provideIcons({
      phosphorChatCircleText,
      phosphorHouseSimple,
      phosphorList,
      phosphorPackage,
      phosphorUsersThree,
      phosphorX,
    }),
  ],
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

  /** Cierra el drawer mobile sin navegar. Usado por el backdrop y el botón
   *  de cerrar en la cabecera del drawer. */
  protected closeMenu(): void {
    this.menuOpen.set(false);
  }

  /**
   * Click handler para los links del nav. Si el destino es la misma ruta
   * donde ya estás, hace scroll-to-top suave. Si la ruta es distinta,
   * deja que RouterLink navegue normalmente — el
   * `scrollPositionRestoration: 'top'` del router config se encarga del
   * reset.
   */
  protected onLinkClick(href: string, event: MouseEvent): void {
    if (!this.isBrowser) return;
    if (this.router.url === href || (href === '/' && this.router.url === '/')) {
      event.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  constructor() {
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
