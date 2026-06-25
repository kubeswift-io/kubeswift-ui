import { Routes } from '@angular/router';
import { Fleet } from './fleet/fleet';
import { Migrations } from './migrations/migrations';
import { Explorer } from './explorer/explorer';
import { Access } from './access/access';
import { Snapshots } from './snapshots/snapshots';

export const routes: Routes = [
  { path: '', component: Fleet },
  { path: 'explorer', component: Explorer },
  { path: 'snapshots', component: Snapshots },
  { path: 'migrations', component: Migrations },
  { path: 'access', component: Access },
  { path: '**', redirectTo: '' },
];
