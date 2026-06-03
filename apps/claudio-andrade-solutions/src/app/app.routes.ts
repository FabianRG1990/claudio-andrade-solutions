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
    path: 'productos',
    loadChildren: () => import('@cas-ui-productos'),
  },
  {
    path: 'nosotros',
    loadChildren: () => import('@cas-ui-nosotros'),
  },
  {
    path: 'contacto',
    loadChildren: () => import('@cas-ui-contacto'),
  },
  { path: '**', redirectTo: '' },
];
