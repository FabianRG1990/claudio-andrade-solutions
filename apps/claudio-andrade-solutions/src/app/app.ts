import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

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
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, OceanBackground, FloatingNav, Footer, WhatsappCompanion],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}
