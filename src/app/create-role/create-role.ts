import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { FormShell } from '../form-shell/form-shell';
import { RoleFormBase } from '../rbac/role-base';

@Component({
  selector: 'app-create-role',
  imports: [MatIconModule, FormShell],
  templateUrl: '../rbac/role-form.html',
  styleUrl: '../wizard.scss',
})
export class CreateRole extends RoleFormBase {
  readonly kindKey = 'roles';
  readonly kindName = 'Role';
  readonly namespaced = true;
  readonly label = 'role';
}
