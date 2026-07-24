import { Component, effect, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';
import { listNames } from '../wizard-util';
import type { Cluster } from '../gen/kubeswift/v1/cluster_pb';

/**
 * CreateGPUProfile is the guided Create wizard for a SwiftGPUProfile — a GPU
 * passthrough request (count / model / tier / partition mode) a SwiftGuest or
 * GPU sandbox references. NUMA topology + Fabric Manager tuning stay an "Edit as
 * YAML" escape hatch. Submits via ResourceService.ApplyResource as the user.
 */
@Component({
  selector: 'app-create-gpuprofile',
  imports: [MatIconModule],
  templateUrl: './create-gpuprofile.html',
  styleUrl: '../wizard.scss',
})
export class CreateGPUProfile {
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
  readonly count = signal<number>(1);
  readonly model = signal('');
  readonly tier = signal('pcie');
  readonly partitionMode = signal('isolated');
  readonly hugepages = signal('');
  readonly vcpuPinning = signal(false);
  // PCIe topology (optional).
  readonly gpuDirectClique = signal<number>(0);
  readonly noMmap = signal(false);

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

  // hgx tiers need the PCIe hierarchy; nudge partitionMode + topology to sane
  // defaults when the operator picks one (still editable).
  selectTier(t: string): void {
    this.tier.set(t);
    if (t === 'hgx-shared') this.partitionMode.set('shared');
    else if (t === 'hgx-full') this.partitionMode.set('full');
    else this.partitionMode.set('isolated');
  }

  canCreate(): boolean {
    return !!(this.cluster() && this.namespace() && this.name().trim() && this.count() > 0);
  }

  async create(): Promise<void> {
    if (!this.canCreate() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);

    const spec: Record<string, unknown> = {
      count: Math.floor(this.count()),
      tier: this.tier(),
      partitionMode: this.partitionMode(),
      vcpuPinning: this.vcpuPinning(),
    };
    if (this.model().trim()) spec['model'] = this.model().trim();
    if (this.hugepages()) spec['hugepages'] = this.hugepages();
    const pcie: Record<string, unknown> = {};
    if (this.gpuDirectClique() > 0) pcie['gpuDirectClique'] = Math.floor(this.gpuDirectClique());
    if (this.noMmap()) pcie['noMmap'] = true;
    if (this.tier() !== 'pcie') pcie['rootPortPerDevice'] = true;
    if (Object.keys(pcie).length) spec['pcieTopology'] = pcie;

    const obj = {
      apiVersion: 'gpu.kubeswift.io/v1alpha1',
      kind: 'SwiftGPUProfile',
      metadata: { name: this.name().trim(), namespace: this.namespace() },
      spec,
    };

    try {
      await this.gw.resources.applyResource({
        cluster: this.cluster(),
        kind: 'swiftgpuprofiles',
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
