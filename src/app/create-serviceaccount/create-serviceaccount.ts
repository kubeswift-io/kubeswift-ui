import { Component, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { FormShell } from '../form-shell/form-shell';
import { ResourceForm } from '../resource-form';
import { listNames } from '../wizard-util';

type Obj = Record<string, unknown>;

/** CreateServiceAccount — a core ServiceAccount (imagePullSecrets + automount). */
@Component({
  selector: 'app-create-serviceaccount',
  imports: [MatIconModule, FormShell],
  templateUrl: './create-serviceaccount.html',
  styleUrl: '../wizard.scss',
})
export class CreateServiceAccount extends ResourceForm {
  readonly kindKey = 'serviceaccounts';
  readonly apiVersion = 'v1';
  readonly kindName = 'ServiceAccount';
  readonly namespaced = true;

  readonly pullSecrets = signal<string[]>(['']);
  readonly automount = signal<'default' | 'true' | 'false'>('default');
  readonly namespaces = signal<string[]>([]);

  protected override async onCluster(cluster: string): Promise<void> {
    this.namespaces.set(await listNames(this.gw, cluster, 'namespaces'));
  }

  hydrate(obj: Obj): void {
    const ps = ((obj['imagePullSecrets'] ?? []) as Obj[]).map((s) => String(s['name'] ?? ''));
    this.pullSecrets.set(ps.length ? ps : ['']);
    const am = obj['automountServiceAccountToken'];
    this.automount.set(am === true ? 'true' : am === false ? 'false' : 'default');
  }

  build(base: Obj): Obj {
    const ps = this.pullSecrets()
      .map((s) => s.trim())
      .filter(Boolean);
    if (ps.length) base['imagePullSecrets'] = ps.map((name) => ({ name }));
    else delete base['imagePullSecrets'];
    if (this.automount() === 'default') delete base['automountServiceAccountToken'];
    else base['automountServiceAccountToken'] = this.automount() === 'true';
    return base;
  }

  canSave(): boolean {
    return !!(this.cluster() && this.namespace() && this.name().trim());
  }

  addPS(): void {
    this.pullSecrets.update((p) => [...p, '']);
  }
  removePS(i: number): void {
    this.pullSecrets.update((p) => p.filter((_, j) => j !== i));
  }
  setPS(i: number, v: string): void {
    this.pullSecrets.update((p) => p.map((s, j) => (j === i ? v : s)));
  }
}
