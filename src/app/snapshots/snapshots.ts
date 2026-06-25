import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';
import { RestoreDialog } from '../restore-dialog/restore-dialog';
import type { Cluster } from '../gen/kubeswift/v1/cluster_pb';
import type { Resource } from '../gen/kubeswift/v1/resource_pb';

interface RestoreTarget {
  snapshot: string;
  guest: string;
  namespace: string;
}

/**
 * Snapshots is the backup/restore management view. It lists a member's
 * SwiftSnapshots + SwiftRestores (ResourceService, polled), and offers Restore
 * (opens the restore dialog) + Delete per row — all as the signed-in user, so
 * RBAC gates them and a denial surfaces. Creating a snapshot lives in the VM's
 * drawer on the Fleet page, where the guest is in context.
 */
@Component({
  selector: 'app-snapshots',
  imports: [MatIconModule, RestoreDialog],
  templateUrl: './snapshots.html',
  styleUrl: './snapshots.scss',
})
export class Snapshots implements OnInit, OnDestroy {
  private readonly gw = inject(GatewayService);
  readonly clusters = signal<Cluster[]>([]);
  readonly selectedCluster = signal('');
  readonly snapshots = signal<Resource[]>([]);
  readonly restores = signal<Resource[]>([]);
  readonly error = signal<string | null>(null);
  readonly restoreFrom = signal<RestoreTarget | null>(null);

  private timer?: ReturnType<typeof setInterval>;

  async ngOnInit(): Promise<void> {
    try {
      const cl = await this.gw.clusters.listClusters({});
      this.clusters.set(cl.clusters);
      this.selectedCluster.set(
        cl.clusters.find((c) => c.ready)?.name ?? cl.clusters[0]?.name ?? '',
      );
    } catch (e) {
      this.error.set(this.msg(e));
    }
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), 5000);
  }
  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async selectCluster(name: string): Promise<void> {
    this.selectedCluster.set(name);
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    const cluster = this.selectedCluster();
    if (!cluster) return;
    try {
      const [s, r] = await Promise.all([
        this.gw.resources.listResources({ cluster, kind: 'swiftsnapshots' }),
        this.gw.resources.listResources({ cluster, kind: 'swiftrestores' }),
      ]);
      this.snapshots.set(s.resources);
      this.restores.set(r.resources);
      this.error.set(s.error?.message ?? r.error?.message ?? null);
    } catch (e) {
      this.error.set(this.msg(e));
    }
  }

  col(r: Resource, k: string): string {
    return r.columns[k] ?? '';
  }
  ns(r: Resource): string {
    return r.ref?.namespace ?? '';
  }
  age(r: Resource): string {
    const sec = Number(r.createdAt?.seconds ?? 0n);
    if (!sec) return '—';
    const d = Math.max(0, Math.floor(Date.now() / 1000) - sec);
    if (d < 60) return `${d}s`;
    if (d < 3600) return `${Math.floor(d / 60)}m`;
    if (d < 86400) return `${Math.floor(d / 3600)}h`;
    return `${Math.floor(d / 86400)}d`;
  }

  openRestore(r: Resource): void {
    this.restoreFrom.set({
      snapshot: r.ref?.name ?? '',
      guest: this.col(r, 'guest'),
      namespace: r.ref?.namespace ?? 'default',
    });
  }
  onRestored(): void {
    this.restoreFrom.set(null);
    void this.refresh();
  }

  async del(kind: string, r: Resource): Promise<void> {
    const name = r.ref?.name ?? '';
    if (!name || !confirm(`Delete ${name}? This cannot be undone.`)) return;
    try {
      await this.gw.resources.deleteResource({
        cluster: this.selectedCluster(),
        kind,
        namespace: r.ref?.namespace ?? '',
        name,
      });
      await this.refresh();
    } catch (e) {
      this.error.set(this.msg(e));
    }
  }

  private msg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }
}
