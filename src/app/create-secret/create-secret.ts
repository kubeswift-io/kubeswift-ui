import { Component, effect, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';
import { listNames } from '../wizard-util';
import type { Cluster } from '../gen/kubeswift/v1/cluster_pb';

type SecretType = 'Opaque' | 'dockerconfigjson' | 'tls';
interface KV {
  key: string;
  value: string;
}

/**
 * CreateSecret is a create/rotate-only guided form for a core Secret. It writes
 * values via `stringData` (write-only) and NEVER reads existing values back —
 * preserving the gateway's E4 redaction posture. Three shapes: Opaque key/values,
 * a dockerconfigjson pull credential, and a TLS cert/key pair. Submits via
 * ResourceService.ApplyResource as the signed-in user.
 */
@Component({
  selector: 'app-create-secret',
  imports: [MatIconModule],
  templateUrl: './create-secret.html',
  styleUrl: '../wizard.scss',
})
export class CreateSecret {
  private readonly gw = inject(GatewayService);
  readonly clusters = input.required<Cluster[]>();
  readonly initialCluster = input<string>('');
  readonly initialNamespace = input<string>('');
  readonly created = output<void>();
  readonly closed = output<void>();
  readonly advanced = output<void>();

  readonly cluster = signal('');
  readonly namespace = signal('default');
  readonly name = signal('');
  readonly secretType = signal<SecretType>('Opaque');
  // Opaque
  readonly entries = signal<KV[]>([{ key: '', value: '' }]);
  // dockerconfigjson
  readonly registry = signal('ghcr.io');
  readonly username = signal('');
  readonly password = signal('');
  readonly email = signal('');
  // tls
  readonly tlsCrt = signal('');
  readonly tlsKey = signal('');

  readonly namespaces = signal<string[]>([]);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      const cs = this.clusters();
      if (this.cluster() || cs.length === 0) return;
      const first = this.initialCluster() || cs.find((c) => c.ready)?.name || cs[0]?.name || '';
      if (first) {
        this.cluster.set(first);
        if (this.initialNamespace()) this.namespace.set(this.initialNamespace());
        void this.loadNamespaces(first);
      }
    });
  }

  async selectCluster(c: string): Promise<void> {
    this.cluster.set(c);
    await this.loadNamespaces(c);
  }
  private async loadNamespaces(cluster: string): Promise<void> {
    this.namespaces.set(await listNames(this.gw, cluster, 'namespaces'));
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

  canCreate(): boolean {
    if (!this.cluster() || !this.namespace() || !this.name().trim()) return false;
    if (this.secretType() === 'Opaque') return this.entries().some((e) => e.key.trim());
    if (this.secretType() === 'dockerconfigjson') {
      return !!(this.registry().trim() && this.username().trim() && this.password());
    }
    return !!(this.tlsCrt().trim() && this.tlsKey().trim()); // tls
  }

  async create(): Promise<void> {
    if (!this.canCreate() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);

    let type = 'Opaque';
    const stringData: Record<string, string> = {};
    if (this.secretType() === 'Opaque') {
      for (const e of this.entries()) if (e.key.trim()) stringData[e.key.trim()] = e.value;
    } else if (this.secretType() === 'dockerconfigjson') {
      type = 'kubernetes.io/dockerconfigjson';
      const auth = btoa(`${this.username().trim()}:${this.password()}`);
      const entry: Record<string, string> = {
        username: this.username().trim(),
        password: this.password(),
        auth,
      };
      if (this.email().trim()) entry['email'] = this.email().trim();
      stringData['.dockerconfigjson'] = JSON.stringify({ auths: { [this.registry().trim()]: entry } });
    } else {
      type = 'kubernetes.io/tls';
      stringData['tls.crt'] = this.tlsCrt();
      stringData['tls.key'] = this.tlsKey();
    }

    const obj = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: this.name().trim(), namespace: this.namespace() },
      type,
      stringData,
    };

    try {
      await this.gw.resources.applyResource({
        cluster: this.cluster(),
        kind: 'secrets',
        namespace: this.namespace(),
        yaml: JSON.stringify(obj),
      });
      this.created.emit();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }
}
