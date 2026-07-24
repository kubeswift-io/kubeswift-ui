import { Component, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { FormShell } from '../form-shell/form-shell';
import { ResourceForm } from '../resource-form';
import { listNames } from '../wizard-util';

type Obj = Record<string, unknown>;
type SecretType = 'Opaque' | 'dockerconfigjson' | 'tls';
interface KV {
  key: string;
  value: string;
}

/**
 * CreateSecret is the create/rotate-only form for a core Secret. Values are
 * written via `stringData` and NEVER read back — the gateway redacts them (E4),
 * so on edit the value fields start empty: leave them blank to keep the existing
 * values (server-side apply preserves unsent fields), or enter new values to
 * rotate. Metadata/type edits are always safe. Extends ResourceForm.
 */
@Component({
  selector: 'app-create-secret',
  imports: [MatIconModule, FormShell],
  templateUrl: './create-secret.html',
  styleUrl: '../wizard.scss',
})
export class CreateSecret extends ResourceForm {
  readonly kindKey = 'secrets';
  readonly apiVersion = 'v1';
  readonly kindName = 'Secret';
  readonly namespaced = true;

  readonly secretType = signal<SecretType>('Opaque');
  readonly entries = signal<KV[]>([{ key: '', value: '' }]);
  readonly registry = signal('ghcr.io');
  readonly username = signal('');
  readonly password = signal('');
  readonly email = signal('');
  readonly tlsCrt = signal('');
  readonly tlsKey = signal('');
  readonly namespaces = signal<string[]>([]);

  protected override async onCluster(cluster: string): Promise<void> {
    this.namespaces.set(await listNames(this.gw, cluster, 'namespaces'));
  }

  hydrate(obj: Obj): void {
    const t = String(obj['type'] ?? 'Opaque');
    this.secretType.set(
      t === 'kubernetes.io/dockerconfigjson' ? 'dockerconfigjson' : t === 'kubernetes.io/tls' ? 'tls' : 'Opaque',
    );
    // Values are redacted on read — the editors stay empty (blank = keep).
  }

  private hasNewValues(): boolean {
    if (this.secretType() === 'Opaque') return this.entries().some((e) => e.key.trim());
    if (this.secretType() === 'dockerconfigjson') {
      return !!(this.registry().trim() && this.username().trim() && this.password());
    }
    return !!(this.tlsCrt().trim() && this.tlsKey().trim());
  }

  build(base: Obj): Obj {
    base['type'] =
      this.secretType() === 'dockerconfigjson'
        ? 'kubernetes.io/dockerconfigjson'
        : this.secretType() === 'tls'
          ? 'kubernetes.io/tls'
          : 'Opaque';
    // Only write values when the user actually entered them; otherwise omit
    // stringData so an edit preserves the existing (redacted) values.
    if (this.hasNewValues()) {
      const stringData: Record<string, string> = {};
      if (this.secretType() === 'Opaque') {
        for (const e of this.entries()) if (e.key.trim()) stringData[e.key.trim()] = e.value;
      } else if (this.secretType() === 'dockerconfigjson') {
        const auth = btoa(`${this.username().trim()}:${this.password()}`);
        const entry: Record<string, string> = { username: this.username().trim(), password: this.password(), auth };
        if (this.email().trim()) entry['email'] = this.email().trim();
        stringData['.dockerconfigjson'] = JSON.stringify({ auths: { [this.registry().trim()]: entry } });
      } else {
        stringData['tls.crt'] = this.tlsCrt();
        stringData['tls.key'] = this.tlsKey();
      }
      base['stringData'] = stringData;
    } else {
      delete base['stringData'];
    }
    return base;
  }

  canSave(): boolean {
    if (!this.cluster() || !this.namespace() || !this.name().trim()) return false;
    // Edit: metadata/type only is fine (blank values keep existing). Create: need values.
    return this.isEdit() || this.hasNewValues();
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
