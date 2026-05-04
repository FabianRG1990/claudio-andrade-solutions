import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import {
  FloatingNav,
  Footer,
  OceanBackground,
} from '@acuario-ui-shared';

/**
 * App — root layout. Equivalente al RootLayout de `app/layout.tsx` en el
 * proyecto Next: ocean-background fijo en z-0, nav fijo en z-50, main con
 * z-10 sobre el océano y footer al final. El chrome (nav + footer + bg)
 * vive en `@acuario-ui-shared/layout/*` para que cualquier app pueda
 * componer este shell sin duplicar componentes.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, OceanBackground, FloatingNav, Footer],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}
