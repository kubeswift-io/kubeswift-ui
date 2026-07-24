import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { FormShell } from '../form-shell/form-shell';
import { BindingFormBase } from '../rbac/binding-base';

@Component({
  selector: 'app-create-clusterrolebinding',
  imports: [MatIconModule, FormShell],
  templateUrl: '../rbac/binding-form.html',
  styleUrl: '../wizard.scss',
})
export class CreateClusterRoleBinding extends BindingFormBase {
  readonly kindKey = 'clusterrolebindings';
  readonly kindName = 'ClusterRoleBinding';
  readonly namespaced = false;
  readonly label = 'cluster role binding';
  readonly allowRoleKind = false;
}
