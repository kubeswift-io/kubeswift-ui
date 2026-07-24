import { Component, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { FormShell } from '../form-shell/form-shell';
import { ResourceForm } from '../resource-form';
import { listNames } from '../wizard-util';

type Obj = Record<string, unknown>;
interface KV {
  key: string;
  value: string;
}

/**
 * CreateConfigMap is the guided create/edit form for a core ConfigMap — a set of
 * key/value entries (values may be multi-line). Extends ResourceForm for the
 * cluster/namespace/name identity, the Form⇄YAML toggle, and the merge-on-edit
 * save; this class only supplies the data editor + hydrate/build.
 */
@Component({
  selector: 'app-create-configmap',
  imports: [MatIconModule, FormShell],
  templateUrl: './create-configmap.html',
  styleUrl: '../wizard.scss',
})
export class CreateConfigMap extends ResourceForm {
  readonly kindKey = 'configmaps';
  readonly apiVersion = 'v1';
  readonly kindName = 'ConfigMap';
  readonly namespaced = true;

  readonly entries = signal<KV[]>([{ key: '', value: '' }]);
  readonly namespaces = signal<string[]>([]);

  protected override async onCluster(cluster: string): Promise<void> {
    this.namespaces.set(await listNames(this.gw, cluster, 'namespaces'));
  }

  hydrate(obj: Obj): void {
    const data = (obj['data'] ?? {}) as Record<string, unknown>;
    const e = Object.entries(data).map(([key, value]) => ({ key, value: String(value) }));
    this.entries.set(e.length ? e : [{ key: '', value: '' }]);
  }

  build(base: Obj): Obj {
    const data: Record<string, string> = {};
    for (const e of this.entries()) if (e.key.trim()) data[e.key.trim()] = e.value;
    base['data'] = data;
    return base;
  }

  canSave(): boolean {
    return !!(
      this.cluster() &&
      this.namespace() &&
      this.name().trim() &&
      this.entries().some((e) => e.key.trim())
    );
  }

  addEntry(): void {
    this.entries.update((e) => [...e, { key: '', value: '' }]);
  }
  removeEntry(i: number): void {
    this.entries.update((e) => e.filter((_, j) => j !== i));
  }
  setEntry(i: number, field: keyof KV, val: string): void {
    this.entries.update((e) => e.map((kv, j) => (j === i ? { ...kv, [field]: val } : kv)));
  }
}
