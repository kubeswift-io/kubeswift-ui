import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { FormShell } from '../form-shell/form-shell';
import { BindingFormBase } from '../rbac/binding-base';

@Component({
  selector: 'app-create-rolebinding',
  imports: [MatIconModule, FormShell],
  templateUrl: '../rbac/binding-form.html',
  styleUrl: '../wizard.scss',
})
export class CreateRoleBinding extends BindingFormBase {
  readonly kindKey = 'rolebindings';
  readonly kindName = 'RoleBinding';
  readonly namespaced = true;
  readonly label = 'role binding';
  readonly allowRoleKind = true;
}
