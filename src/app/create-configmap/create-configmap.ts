import { Component, effect, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';
import { listNames } from '../wizard-util';
import type { Cluster } from '../gen/kubeswift/v1/cluster_pb';

interface KV {
  key: string;
  value: string;
}

/**
 * CreateConfigMap is the guided create form for a core ConfigMap — a set of
 * key/value entries (values may be multi-line config files). Submits via
 * ResourceService.ApplyResource as the signed-in user.
 */
@Component({
  selector: 'app-create-configmap',
  imports: [MatIconModule],
  templateUrl: './create-configmap.html',
  styleUrl: '../wizard.scss',
})
export class CreateConfigMap {
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
  readonly entries = signal<KV[]>([{ key: '', value: '' }]);

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
    return !!(
      this.cluster() &&
      this.namespace() &&
      this.name().trim() &&
      this.entries().some((e) => e.key.trim())
    );
  }

  async create(): Promise<void> {
    if (!this.canCreate() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);

    const data: Record<string, string> = {};
    for (const e of this.entries()) if (e.key.trim()) data[e.key.trim()] = e.value;

    const obj = {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: { name: this.name().trim(), namespace: this.namespace() },
      data,
    };

    try {
      await this.gw.resources.applyResource({
        cluster: this.cluster(),
        kind: 'configmaps',
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
