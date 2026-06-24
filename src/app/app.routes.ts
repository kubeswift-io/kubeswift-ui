import { Routes } from '@angular/router';
import { Fleet } from './fleet/fleet';
import { Migrations } from './migrations/migrations';
import { Explorer } from './explorer/explorer';

export const routes: Routes = [
  { path: '', component: Fleet },
  { path: 'explorer', component: Explorer },
  { path: 'migrations', component: Migrations },
  { path: '**', redirectTo: '' },
];
