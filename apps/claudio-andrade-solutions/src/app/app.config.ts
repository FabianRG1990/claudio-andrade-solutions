import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withInMemoryScrolling, withRouterConfig } from '@angular/router';
import { appRoutes } from './app.routes';
import {
  provideClientHydration,
  withEventReplay,
} from '@angular/platform-browser';

export const appConfig: ApplicationConfig = {
  providers: [
    provideClientHydration(withEventReplay()),
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      appRoutes,
      // Cada navegación arranca al tope. Sin esto Angular preserva el
      // scroll de la ruta anterior — pésimo cuando el usuario salta de un
      // landing largo (Home) a otra sección y aterriza por el footer.
      withInMemoryScrolling({
        scrollPositionRestoration: 'top',
        anchorScrolling: 'enabled',
      }),
      // Permite que clickear el mismo link (e.g. logo o "Inicio" estando ya
      // en `/`) emita NavigationEnd otra vez. Necesario para que el handler
      // del nav pueda hacer scroll-to-top en ese caso.
      withRouterConfig({ onSameUrlNavigation: 'reload' }),
    ),
  ],
};
