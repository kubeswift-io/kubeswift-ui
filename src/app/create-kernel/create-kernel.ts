import { Component, effect, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';
import { listNames } from '../wizard-util';
import type { Cluster } from '../gen/kubeswift/v1/cluster_pb';

/**
 * CreateKernel is the guided Create wizard for a SwiftKernel — a per-node OCI
 * kernel artifact (bzImage + initramfs) used by kernel-boot guests and
 * sandboxes. Submits via ResourceService.ApplyResource as the signed-in user.
 * (A tag change alone won't re-pull an existing kernel — the pull Job is keyed
 * on name+node.)
 */
@Component({
  selector: 'app-create-kernel',
  imports: [MatIconModule],
  templateUrl: './create-kernel.html',
  styleUrl: '../wizard.scss',
})
export class CreateKernel {
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
  readonly image = signal('');
  readonly profile = signal('');
  readonly cmdline = signal('');
  readonly pullSecret = signal('');

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
    return !!(this.cluster() && this.namespace() && this.name().trim() && this.image().trim());
  }

  async create(): Promise<void> {
    if (!this.canCreate() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);

    const ociRef: Record<string, unknown> = { image: this.image().trim() };
    if (this.pullSecret().trim()) ociRef['pullSecret'] = this.pullSecret().trim();
    const spec: Record<string, unknown> = { ociRef };
    if (this.profile().trim()) spec['profile'] = this.profile().trim();
    if (this.cmdline().trim()) spec['kernelCmdline'] = this.cmdline().trim();

    const obj = {
      apiVersion: 'kernel.kubeswift.io/v1alpha1',
      kind: 'SwiftKernel',
      metadata: { name: this.name().trim(), namespace: this.namespace() },
      spec,
    };

    try {
      await this.gw.resources.applyResource({
        cluster: this.cluster(),
        kind: 'swiftkernels',
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
