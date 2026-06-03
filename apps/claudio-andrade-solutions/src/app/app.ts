import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { prefersReducedMotion } from '@cas-ui-shared/utils/device-capability';

import {
  FloatingNav,
  Footer,
  OceanBackground,
  WhatsappCompanion,
} from '@cas-ui-shared';

/**
 * App — root layout. Equivalente al RootLayout de `app/layout.tsx` en el
 * proyecto Next: ocean-background fijo en z-0, nav fijo en z-50, main con
 * z-10 sobre el océano y footer al final. El chrome (nav + footer + bg)
 * vive en `@cas-ui-shared/layout/*` para que cualquier app pueda
 * componer este shell sin duplicar componentes.
 *
 * Boot splash: el splash y el trigger `html.app-booted` viven en
 * `index.html` (inline script). Decisión deliberada — no depende de Angular
 * hidratando para fadear: si la hidratación tarda o falla, el splash igual
 * sale en `window load` o en el failsafe de 4s.
 *
 * Rotation veil: cuando el teléfono pasa de vertical a horizontal el layout
 * cambia de grid stack a flex accordion en el breakpoint 768px — un snap
 * inevitable porque CSS no anima transiciones de display. Para suavizar la
 * percepción del cambio, escuchamos el cambio de orientación y disparamos un
 * overlay oscuro: aparece instantáneo (mismo paint que el relayout, así
 * enmascara el snap) y se desvanece en ~320ms. Respeta prefers-reduced-motion.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, OceanBackground, FloatingNav, Footer, WhatsappCompanion],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App implements OnInit, OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  protected readonly rotating = signal(false);
  private orientationMql?: MediaQueryList;
  private orientationHandler?: () => void;
  private rotationResetTimer?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (prefersReducedMotion()) return;

    this.orientationMql = window.matchMedia('(orientation: portrait)');
    this.orientationHandler = () => {
      this.rotating.set(true);
      if (this.rotationResetTimer) clearTimeout(this.rotationResetTimer);
      // Hold del velo opaco: 90ms — suficiente para que el browser registre
      // un paint con la clase activa (= transition:none, opacity instantánea)
      // antes de que la quitemos y dispare el fade-out de 320ms.
      this.rotationResetTimer = setTimeout(() => this.rotating.set(false), 90);
    };
    this.orientationMql.addEventListener('change', this.orientationHandler);
  }

  ngOnDestroy(): void {
    if (this.orientationMql && this.orientationHandler) {
      this.orientationMql.removeEventListener('change', this.orientationHandler);
    }
    if (this.rotationResetTimer) clearTimeout(this.rotationResetTimer);
  }
}
