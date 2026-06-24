import { Component, effect, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';
import type { Cluster } from '../gen/kubeswift/v1/cluster_pb';

interface PortRow {
  name: string;
  port: number;
  targetPort: number;
  expose: string;
}

type BootSource = 'image' | 'kernel' | 'clone';

/**
 * CreateGuest is the right slide-in Create-VM wizard. It loads its pickers
 * (images / kernels / classes / seed profiles / GPU profiles / snapshots /
 * namespaces / nodes) from the Explorer reads for the selected member, then
 * submits GuestService.CreateGuest. Everything runs as the signed-in user, so
 * the member RBAC + the SwiftGuest webhook gate the create; a denial surfaces in
 * the banner, never a silent success. The new VM appears in the Fleet table via
 * the live WatchGuests stream — no manual refresh.
 */
@Component({
  selector: 'app-create-guest',
  imports: [MatIconModule],
  templateUrl: './create-guest.html',
  styleUrl: './create-guest.scss',
})
export class CreateGuest {
  private readonly gw = inject(GatewayService);
  readonly clusters = input.required<Cluster[]>();
  readonly initialCluster = input<string>('');
  readonly created = output<void>();
  readonly closed = output<void>();

  // Form.
  readonly cluster = signal('');
  readonly namespace = signal('default');
  readonly name = signal('');
  readonly bootSource = signal<BootSource>('image');
  readonly imageRef = signal('');
  readonly kernelRef = signal('');
  readonly kernelCmdline = signal('');
  readonly cloneSnapshotRef = signal('');
  readonly cloneTargetNode = signal('');
  readonly guestClassRef = signal('');
  readonly seedProfileRef = signal('');
  readonly gpuProfileRef = signal('');
  readonly runPolicy = signal('Running');
  readonly osType = signal('');
  readonly nodeName = signal('');
  readonly ports = signal<PortRow[]>([]);

  // Pickers.
  readonly namespaces = signal<string[]>([]);
  readonly images = signal<string[]>([]);
  readonly kernels = signal<string[]>([]);
  readonly classes = signal<string[]>([]);
  readonly seeds = signal<string[]>([]);
  readonly gpuProfiles = signal<string[]>([]);
  readonly snapshots = signal<string[]>([]);
  readonly nodes = signal<string[]>([]);

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    // Pick the default cluster once the input lands, then load its pickers.
    effect(() => {
      const init = this.initialCluster();
      const cs = this.clusters();
      if (this.cluster() || cs.length === 0) return;
      const first = init || cs.find((c) => c.ready)?.name || cs[0]?.name || '';
      if (first) {
        this.cluster.set(first);
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
    const [ns, img, krn, cls, sd, gpu, snap] = await Promise.all([
      names('namespaces'),
      names('swiftimages'),
      names('swiftkernels'),
      names('swiftguestclasses'),
      names('swiftseedprofiles'),
      names('swiftgpuprofiles'),
      names('swiftsnapshots'),
    ]);
    this.namespaces.set(ns);
    this.images.set(img);
    this.kernels.set(krn);
    this.classes.set(cls);
    this.seeds.set(sd);
    this.gpuProfiles.set(gpu);
    this.snapshots.set(snap);
    if (!this.guestClassRef() && cls.length) this.guestClassRef.set(cls[0]);
    try {
      const n = await this.gw.clusters.listNodes({ cluster });
      this.nodes.set(
        n.nodes
          .map((x) => x.name)
          .filter(Boolean)
          .sort(),
      );
    } catch {
      this.nodes.set([]);
    }
  }

  addPort(): void {
    this.ports.update((p) => [...p, { name: '', port: 0, targetPort: 0, expose: '' }]);
  }
  removePort(i: number): void {
    this.ports.update((p) => p.filter((_, j) => j !== i));
  }
  setPort(i: number, field: keyof PortRow, val: string): void {
    this.ports.update((p) =>
      p.map((row, j) =>
        j === i
          ? { ...row, [field]: field === 'port' || field === 'targetPort' ? Number(val) || 0 : val }
          : row,
      ),
    );
  }

  canCreate(): boolean {
    if (!this.cluster() || !this.namespace() || !this.name().trim() || !this.guestClassRef()) {
      return false;
    }
    switch (this.bootSource()) {
      case 'image':
        return !!this.imageRef();
      case 'kernel':
        return !!this.kernelRef();
      case 'clone':
        return !!this.cloneSnapshotRef();
    }
  }

  async create(): Promise<void> {
    if (!this.canCreate() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    const bs = this.bootSource();
    try {
      await this.gw.guests.createGuest({
        cluster: this.cluster(),
        namespace: this.namespace(),
        name: this.name().trim(),
        imageRef: bs === 'image' ? this.imageRef() : '',
        kernelRef: bs === 'kernel' ? this.kernelRef() : '',
        kernelCmdline: bs === 'kernel' ? this.kernelCmdline().trim() : '',
        cloneSnapshotRef: bs === 'clone' ? this.cloneSnapshotRef() : '',
        cloneTargetNode: bs === 'clone' ? this.cloneTargetNode().trim() : '',
        guestClassRef: this.guestClassRef(),
        seedProfileRef: this.seedProfileRef(),
        gpuProfileRef: bs === 'image' ? this.gpuProfileRef() : '',
        runPolicy: this.runPolicy(),
        osType: bs === 'image' ? this.osType() : '',
        nodeName: this.nodeName(),
        ports: this.ports()
          .filter((p) => p.port > 0)
          .map((p) => ({
            name: p.name.trim(),
            port: p.port,
            targetPort: p.targetPort,
            protocol: '',
            expose: p.expose,
          })),
      });
      this.created.emit();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }
}
