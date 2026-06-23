import { Routes } from '@angular/router';
import { Fleet } from './fleet/fleet';
import { Migrations } from './migrations/migrations';

export const routes: Routes = [
  { path: '', component: Fleet },
  { path: 'migrations', component: Migrations },
  { path: '**', redirectTo: '' },
];
