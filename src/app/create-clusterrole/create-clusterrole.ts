import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { FormShell } from '../form-shell/form-shell';
import { RoleFormBase } from '../rbac/role-base';

@Component({
  selector: 'app-create-clusterrole',
  imports: [MatIconModule, FormShell],
  templateUrl: '../rbac/role-form.html',
  styleUrl: '../wizard.scss',
})
export class CreateClusterRole extends RoleFormBase {
  readonly kindKey = 'clusterroles';
  readonly kindName = 'ClusterRole';
  readonly namespaced = false;
  readonly label = 'cluster role';
}
