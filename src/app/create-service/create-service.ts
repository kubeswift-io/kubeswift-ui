import { Component, effect, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';
import { listNames } from '../wizard-util';
import type { Cluster } from '../gen/kubeswift/v1/cluster_pb';

interface KV {
  key: string;
  value: string;
}
interface Port {
  name: string;
  port: number;
  targetPort: number;
  protocol: string;
}

/**
 * CreateService is the guided create form for a core Service — type, a label
 * selector, and a ports table (or an ExternalName alias). Submits via
 * ResourceService.ApplyResource as the signed-in user.
 */
@Component({
  selector: 'app-create-service',
  imports: [MatIconModule],
  templateUrl: './create-service.html',
  styleUrl: '../wizard.scss',
})
export class CreateService {
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
  readonly svcType = signal('ClusterIP');
  readonly externalName = signal('');
  readonly selector = signal<KV[]>([{ key: 'app', value: '' }]);
  readonly ports = signal<Port[]>([{ name: 'http', port: 80, targetPort: 0, protocol: 'TCP' }]);

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

  isExternalName(): boolean {
    return this.svcType() === 'ExternalName';
  }

  addSel(): void {
    this.selector.update((s) => [...s, { key: '', value: '' }]);
  }
  removeSel(i: number): void {
    this.selector.update((s) => s.filter((_, j) => j !== i));
  }
  setSel(i: number, field: keyof KV, val: string): void {
    this.selector.update((s) => s.map((kv, j) => (j === i ? { ...kv, [field]: val } : kv)));
  }
  addPort(): void {
    this.ports.update((p) => [...p, { name: '', port: 0, targetPort: 0, protocol: 'TCP' }]);
  }
  removePort(i: number): void {
    this.ports.update((p) => p.filter((_, j) => j !== i));
  }
  setPort(i: number, field: keyof Port, val: string): void {
    this.ports.update((p) =>
      p.map((pt, j) =>
        j === i ? { ...pt, [field]: field === 'name' || field === 'protocol' ? val : +val || 0 } : pt,
      ),
    );
  }

  canCreate(): boolean {
    if (!this.cluster() || !this.namespace() || !this.name().trim()) return false;
    if (this.isExternalName()) return !!this.externalName().trim();
    return this.ports().some((p) => p.port > 0);
  }

  async create(): Promise<void> {
    if (!this.canCreate() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);

    const spec: Record<string, unknown> = { type: this.svcType() };
    if (this.isExternalName()) {
      spec['externalName'] = this.externalName().trim();
    } else {
      const sel: Record<string, string> = {};
      for (const s of this.selector()) if (s.key.trim()) sel[s.key.trim()] = s.value;
      if (Object.keys(sel).length) spec['selector'] = sel;
      spec['ports'] = this.ports()
        .filter((p) => p.port > 0)
        .map((p) => {
          const o: Record<string, unknown> = { port: p.port, protocol: p.protocol || 'TCP' };
          if (p.name.trim()) o['name'] = p.name.trim();
          if (p.targetPort > 0) o['targetPort'] = p.targetPort;
          return o;
        });
    }

    const obj = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name: this.name().trim(), namespace: this.namespace() },
      spec,
    };

    try {
      await this.gw.resources.applyResource({
        cluster: this.cluster(),
        kind: 'services',
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
