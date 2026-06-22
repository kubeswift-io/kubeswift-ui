import { Routes } from '@angular/router';
import { Fleet } from './fleet/fleet';

export const routes: Routes = [
  { path: '', component: Fleet },
  { path: '**', redirectTo: '' },
];
