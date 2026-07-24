import { Component, effect, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';
import { listNames } from '../wizard-util';
import type { Cluster } from '../gen/kubeswift/v1/cluster_pb';

/**
 * CreateSandboxPool is the guided Create wizard for a SwiftSandboxPool — N
 * pre-booted warm microVM slots a SwiftSandbox claims by poolRef for sub-second
 * start. Optionally each slot holds a GPU (warm GPU pool) and/or a preloaded
 * model. Submits via ResourceService.ApplyResource as the signed-in user.
 */
@Component({
  selector: 'app-create-sandboxpool',
  imports: [MatIconModule],
  templateUrl: './create-sandboxpool.html',
  styleUrl: '../wizard.scss',
})
export class CreateSandboxPool {
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
  readonly cpu = signal<number>(1);
  readonly memory = signal('512Mi');
  readonly networkMode = signal('restricted');
  readonly rootfsMode = signal('');
  readonly minWarm = signal<number>(1);
  readonly maxWarm = signal<number>(0);
  readonly gpuProfileRef = signal('');
  readonly modelRef = signal('');
  readonly modelMount = signal('/model');
  readonly imagePullSecret = signal('');

  readonly namespaces = signal<string[]>([]);
  readonly gpuProfiles = signal<string[]>([]);
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
        void this.loadPickers(first);
      }
    });
  }

  async selectCluster(c: string): Promise<void> {
    this.cluster.set(c);
    await this.loadPickers(c);
  }
  private async loadPickers(cluster: string): Promise<void> {
    const [ns, gpu] = await Promise.all([
      listNames(this.gw, cluster, 'namespaces'),
      listNames(this.gw, cluster, 'swiftgpuprofiles'),
    ]);
    this.namespaces.set(ns);
    this.gpuProfiles.set(gpu);
  }

  canCreate(): boolean {
    if (!this.cluster() || !this.namespace() || !this.name().trim() || !this.image().trim()) {
      return false;
    }
    if (this.modelRef().trim() && !this.modelMount().trim()) return false;
    if (this.maxWarm() > 0 && this.maxWarm() < this.minWarm()) return false;
    return true;
  }

  async create(): Promise<void> {
    if (!this.canCreate() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);

    const spec: Record<string, unknown> = {
      image: this.image().trim(),
      memory: this.memory().trim() || '512Mi',
      minWarm: Math.floor(this.minWarm()),
    };
    if (this.cpu() > 0) spec['cpu'] = Math.floor(this.cpu());
    if (this.networkMode()) spec['network'] = { mode: this.networkMode() };
    if (this.rootfsMode()) spec['rootfsMode'] = this.rootfsMode();
    if (this.maxWarm() > 0) spec['maxWarm'] = Math.floor(this.maxWarm());
    if (this.imagePullSecret().trim()) spec['imagePullSecret'] = this.imagePullSecret().trim();
    if (this.gpuProfileRef()) spec['gpuProfileRef'] = { name: this.gpuProfileRef() };
    const model = this.modelRef().trim();
    if (model) {
      const m: Record<string, unknown> = { imageRef: model };
      if (this.modelMount().trim()) m['mountPath'] = this.modelMount().trim();
      spec['model'] = m;
    }

    const obj = {
      apiVersion: 'sandbox.kubeswift.io/v1alpha1',
      kind: 'SwiftSandboxPool',
      metadata: { name: this.name().trim(), namespace: this.namespace() },
      spec,
    };

    try {
      await this.gw.resources.applyResource({
        cluster: this.cluster(),
        kind: 'swiftsandboxpools',
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
