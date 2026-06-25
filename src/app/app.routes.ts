import { Routes } from '@angular/router';
import { Overview } from './overview/overview';
import { Fleet } from './fleet/fleet';
import { Migrations } from './migrations/migrations';
import { Explorer } from './explorer/explorer';
import { Access } from './access/access';

export const routes: Routes = [
  { path: '', component: Overview },
  { path: 'fleet', component: Fleet },
  { path: 'explorer', component: Explorer },
  { path: 'migrations', component: Migrations },
  { path: 'access', component: Access },
  { path: '**', redirectTo: '' },
];
