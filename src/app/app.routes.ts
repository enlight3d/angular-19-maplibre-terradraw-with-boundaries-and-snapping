import { Routes } from '@angular/router';
import { MapDemoComponent } from './map/map.component';

export const routes: Routes = [
  { path: '', redirectTo: 'map', pathMatch: 'full' },
  {
    path: 'map',
    pathMatch: 'full',
    component: MapDemoComponent,
  },
];
