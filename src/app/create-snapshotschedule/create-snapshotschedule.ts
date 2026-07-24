import { Component, effect, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';
import { listNames } from '../wizard-util';
import type { Cluster } from '../gen/kubeswift/v1/cluster_pb';

/**
 * CreateSnapshotSchedule is the guided Create wizard for a SwiftSnapshotSchedule
 * — cron snapshots of a guest with keep-N retention. It covers the two
 * cluster-local backends (local memory+disk, CSI disk-only); S3/OCI object
 * backends need endpoint config, so they route through "Edit as YAML". Submits
 * via ResourceService.ApplyResource as the signed-in user.
 */
@Component({
  selector: 'app-create-snapshotschedule',
  imports: [MatIconModule],
  templateUrl: './create-snapshotschedule.html',
  styleUrl: '../wizard.scss',
})
export class CreateSnapshotSchedule {
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
  readonly guestRef = signal('');
  readonly schedule = signal('0 2 * * *');
  readonly backend = signal('local');
  readonly includeMemory = signal(true);
  readonly csiClass = signal('');
  readonly keepLast = signal<number>(7);
  readonly concurrency = signal('Forbid');
  readonly suspend = signal(false);

  readonly namespaces = signal<string[]>([]);
  readonly guests = signal<string[]>([]);
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
  async selectNamespace(ns: string): Promise<void> {
    this.namespace.set(ns);
    this.guestRef.set('');
    this.guests.set(await listNames(this.gw, this.cluster(), 'swiftguests', ns));
  }
  private async loadPickers(cluster: string): Promise<void> {
    const [ns, g] = await Promise.all([
      listNames(this.gw, cluster, 'namespaces'),
      listNames(this.gw, cluster, 'swiftguests', this.namespace()),
    ]);
    this.namespaces.set(ns);
    this.guests.set(g);
  }

  canCreate(): boolean {
    return !!(
      this.cluster() &&
      this.namespace() &&
      this.name().trim() &&
      this.guestRef() &&
      this.schedule().trim()
    );
  }

  async create(): Promise<void> {
    if (!this.canCreate() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);

    let backendObj: Record<string, unknown>;
    let includeMemory: boolean;
    if (this.backend() === 'csi-volume-snapshot') {
      const csi: Record<string, unknown> = {};
      if (this.csiClass().trim()) csi['volumeSnapshotClassName'] = this.csiClass().trim();
      backendObj = { type: 'csi-volume-snapshot', csiVolumeSnapshot: csi };
      includeMemory = false; // CSI is disk-only by definition
    } else {
      backendObj = { type: 'local' };
      includeMemory = this.includeMemory();
    }

    const templateSpec: Record<string, unknown> = {
      guestRef: { name: this.guestRef() },
      backend: backendObj,
      includeMemory,
    };
    const spec: Record<string, unknown> = {
      schedule: this.schedule().trim(),
      concurrencyPolicy: this.concurrency(),
      template: { spec: templateSpec },
    };
    if (this.suspend()) spec['suspend'] = true;
    if (this.keepLast() > 0) spec['retention'] = { keepLast: Math.floor(this.keepLast()) };

    const obj = {
      apiVersion: 'snapshot.kubeswift.io/v1alpha1',
      kind: 'SwiftSnapshotSchedule',
      metadata: { name: this.name().trim(), namespace: this.namespace() },
      spec,
    };

    try {
      await this.gw.resources.applyResource({
        cluster: this.cluster(),
        kind: 'swiftsnapshotschedules',
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
