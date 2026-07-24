import { Component, effect, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';
import { listNames } from '../wizard-util';
import type { Cluster } from '../gen/kubeswift/v1/cluster_pb';

/**
 * CreateSeedProfile is the guided Create wizard for a SwiftSeedProfile — the
 * cloud-init NoCloud seed (user-data / meta-data / network-config) a SwiftGuest
 * references. Inline data only; secret/configmap refs are an "Edit as YAML"
 * escape hatch. Submits via ResourceService.ApplyResource as the signed-in user.
 */
@Component({
  selector: 'app-create-seedprofile',
  imports: [MatIconModule],
  templateUrl: './create-seedprofile.html',
  styleUrl: '../wizard.scss',
})
export class CreateSeedProfile {
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
  readonly userData = signal('#cloud-config\n');
  readonly metaData = signal('');
  readonly networkData = signal('');

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

  canCreate(): boolean {
    return !!(this.cluster() && this.namespace() && this.name().trim() && this.userData().trim());
  }

  async create(): Promise<void> {
    if (!this.canCreate() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);

    const spec: Record<string, unknown> = {
      datasource: 'NoCloud',
      userData: this.userData(),
    };
    if (this.metaData().trim()) spec['metaData'] = this.metaData();
    if (this.networkData().trim()) spec['networkData'] = this.networkData();

    const obj = {
      apiVersion: 'seed.kubeswift.io/v1alpha1',
      kind: 'SwiftSeedProfile',
      metadata: { name: this.name().trim(), namespace: this.namespace() },
      spec,
    };

    try {
      await this.gw.resources.applyResource({
        cluster: this.cluster(),
        kind: 'swiftseedprofiles',
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
