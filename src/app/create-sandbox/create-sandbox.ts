import { Component, effect, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';
import type { Cluster } from '../gen/kubeswift/v1/cluster_pb';

type Source = 'new' | 'pool';
type ScratchKind = '' | 'blank' | 'pvc';

/**
 * CreateSandbox is the right slide-in Create-microVM wizard for a SwiftSandbox.
 * It loads its pickers (namespaces / warm pools / GPU profiles) from the Explorer
 * reads for the selected member, then submits the built object via
 * ResourceService.ApplyResource (there is no typed CreateSandbox RPC — sandboxes
 * ride the generic resource plane). Everything runs as the signed-in user, so the
 * member RBAC + the SwiftSandbox webhook gate the create; a denial surfaces in the
 * banner, never a silent success.
 *
 * Two sources: a standalone "New microVM" (image + resources + network + the
 * v0.12 shapes: GPU profile, model preload, scratch disk) or a "Checkout from
 * pool" that claims a warm slot (poolRef) and inherits the slot's shape — GPU and
 * poolRef are mutually exclusive (a GPU sandbox boots cold), so GPU/model/scratch
 * are hidden in pool mode.
 */
@Component({
  selector: 'app-create-sandbox',
  imports: [MatIconModule],
  templateUrl: './create-sandbox.html',
  styleUrl: './create-sandbox.scss',
})
export class CreateSandbox {
  private readonly gw = inject(GatewayService);
  readonly clusters = input.required<Cluster[]>();
  readonly initialCluster = input<string>('');
  readonly initialNamespace = input<string>('');
  readonly created = output<void>();
  readonly closed = output<void>();
  readonly advanced = output<void>();

  // Form.
  readonly cluster = signal('');
  readonly namespace = signal('default');
  readonly name = signal('');
  readonly source = signal<Source>('new');
  readonly image = signal('');
  readonly cpu = signal<number>(1);
  readonly memory = signal('512Mi');
  readonly networkMode = signal('restricted');
  readonly rootfsMode = signal(''); // '' -> controller default (block)
  readonly command = signal('');
  // Warm-pool checkout.
  readonly poolRef = signal('');
  // GPU sandbox (native backend).
  readonly gpuProfileRef = signal('');
  // Model preload (OCI artifact mounted RO).
  readonly modelRef = signal('');
  readonly modelMount = signal('/model');
  // Scratch disk.
  readonly scratchKind = signal<ScratchKind>('');
  readonly scratchSize = signal('1Gi');
  readonly scratchPvc = signal('');
  readonly scratchMount = signal('/scratch');

  // Pickers.
  readonly namespaces = signal<string[]>([]);
  readonly pools = signal<string[]>([]);
  readonly gpuProfiles = signal<string[]>([]);

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      const init = this.initialCluster();
      const cs = this.clusters();
      if (this.cluster() || cs.length === 0) return;
      const first = init || cs.find((c) => c.ready)?.name || cs[0]?.name || '';
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
    if (!cluster) return;
    const names = async (kind: string): Promise<string[]> => {
      try {
        const r = await this.gw.resources.listResources({ cluster, kind });
        return r.resources
          .map((x) => x.ref?.name ?? '')
          .filter(Boolean)
          .sort();
      } catch {
        return [];
      }
    };
    const [ns, pl, gpu] = await Promise.all([
      names('namespaces'),
      names('swiftsandboxpools'),
      names('swiftgpuprofiles'),
    ]);
    this.namespaces.set(ns);
    this.pools.set(pl);
    this.gpuProfiles.set(gpu);
  }

  // Choosing a pool prefills the image from the pool's spec so the checkout is
  // rootfs-compatible; the field stays editable.
  async selectPool(name: string): Promise<void> {
    this.poolRef.set(name);
    if (!name) return;
    try {
      const r = await this.gw.resources.getResource({
        cluster: this.cluster(),
        kind: 'swiftsandboxpools',
        namespace: this.namespace(),
        name,
      });
      const o = JSON.parse(r.json) as { spec?: { image?: string } };
      if (o.spec?.image) this.image.set(o.spec.image);
    } catch {
      // leave image as-is; the user can type it.
    }
  }

  canCreate(): boolean {
    if (!this.cluster() || !this.namespace() || !this.name().trim() || !this.image().trim()) {
      return false;
    }
    if (this.source() === 'pool' && !this.poolRef()) return false;
    if (this.source() === 'new') {
      if (this.modelRef().trim() && !this.modelMount().trim()) return false;
      if (this.scratchKind() === 'blank' && !this.scratchSize().trim()) return false;
      if (this.scratchKind() === 'pvc' && !this.scratchPvc().trim()) return false;
    }
    return true;
  }

  async create(): Promise<void> {
    if (!this.canCreate() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);

    const spec: Record<string, unknown> = {
      image: this.image().trim(),
      memory: this.memory().trim() || '512Mi',
    };
    if (this.cpu() > 0) spec['cpu'] = Math.floor(this.cpu());
    if (this.networkMode()) spec['network'] = { mode: this.networkMode() };
    if (this.rootfsMode()) spec['rootfsMode'] = this.rootfsMode();
    const cmd = this.command().trim();
    if (cmd) spec['command'] = cmd.split(/\s+/);

    if (this.source() === 'pool') {
      spec['poolRef'] = { name: this.poolRef() };
    } else {
      if (this.gpuProfileRef()) spec['gpuProfileRef'] = { name: this.gpuProfileRef() };
      const model = this.modelRef().trim();
      if (model) {
        const m: Record<string, unknown> = { imageRef: model };
        if (this.modelMount().trim()) m['mountPath'] = this.modelMount().trim();
        spec['model'] = m;
      }
      if (this.scratchKind() === 'blank') {
        const sd: Record<string, unknown> = { blank: { size: this.scratchSize().trim() } };
        if (this.scratchMount().trim()) sd['mountPath'] = this.scratchMount().trim();
        spec['scratchDisk'] = sd;
      } else if (this.scratchKind() === 'pvc') {
        const sd: Record<string, unknown> = { pvcRef: { name: this.scratchPvc().trim() } };
        if (this.scratchMount().trim()) sd['mountPath'] = this.scratchMount().trim();
        spec['scratchDisk'] = sd;
      }
    }

    const obj = {
      apiVersion: 'sandbox.kubeswift.io/v1alpha1',
      kind: 'SwiftSandbox',
      metadata: { name: this.name().trim(), namespace: this.namespace() },
      spec,
    };

    try {
      await this.gw.resources.applyResource({
        cluster: this.cluster(),
        kind: 'swiftsandboxes',
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
