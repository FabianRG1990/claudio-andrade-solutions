import { Route } from '@angular/router';

import { HomePage } from './pages/home/home';

export const acuarioUiHomeRoutes: Route[] = [
  { path: '', component: HomePage, pathMatch: 'full' },
];
