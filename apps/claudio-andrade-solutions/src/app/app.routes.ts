import { Route } from '@angular/router';

/**
 * Rutas de la app — cada feature lib expone sus rutas como default export
 * y se carga lazy. Beneficios: bundles separados (cache friendly), primer
 * paint del root liviano, y libs de feature totalmente desacoplados que
 * pueden moverse a otro proyecto agarrando solo su carpeta.
 */
export const appRoutes: Route[] = [
  {
    path: '',
    pathMatch: 'full',
    loadChildren: () => import('@cas-ui-home'),
  },
  {
    path: 'exhibiciones',
    loadChildren: () => import('@cas-ui-exhibiciones'),
  },
  {
    path: 'especies',
    loadChildren: () => import('@cas-ui-especies'),
  },
  {
    path: 'contacto',
    loadChildren: () => import('@cas-ui-contacto'),
  },
  { path: '**', redirectTo: '' },
];
