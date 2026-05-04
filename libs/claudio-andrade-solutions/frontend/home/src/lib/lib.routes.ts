import { Route } from '@angular/router';

import { HomePage } from './pages/home/home';

export const casUiHomeRoutes: Route[] = [
  { path: '', component: HomePage, pathMatch: 'full' },
];
