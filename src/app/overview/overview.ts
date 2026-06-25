import { Component, OnInit, OnDestroy, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';
import type { Cluster } from '../gen/kubeswift/v1/cluster_pb';
import type { Guest } from '../gen/kubeswift/v1/guest_pb';

/**
 * Overview is the fleet dashboard — a cross-cutting summary, NOT a resource-kind
 * browser, so it stays a dedicated view (like Migrations). It computes its
 * numbers client-side from the existing fan-out RPCs (ListGuests / ListClusters
 * / ListMigrations) — no new backend — polled every 10s.
 */
@Component({
  selector: 'app-overview',
  imports: [MatIconModule],
  templateUrl: './overview.html',
  styleUrl: './overview.scss',
})
export class Overview implements OnInit, OnDestroy {
  private readonly gw = inject(GatewayService);
  readonly clusters = signal<Cluster[]>([]);
  readonly guests = signal<Guest[]>([]);
  readonly activeMigrations = signal(0);
  readonly clusterErrors = signal(0);
  readonly error = signal<string | null>(null);
  private timer?: ReturnType<typeof setInterval>;

  async ngOnInit(): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), 10000);
  }
  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async refresh(): Promise<void> {
    try {
      const [cl, g, m] = await Promise.all([
        this.gw.clusters.listClusters({}),
        this.gw.guests.listGuests({}),
        this.gw.migrations.listMigrations({}).catch(() => ({ migrations: [] })),
      ]);
      this.clusters.set(cl.clusters);
      this.guests.set(g.guests);
      this.clusterErrors.set(g.errors?.length ?? 0);
      const terminal = new Set(['Completed', 'Failed', 'Cancelled']);
      this.activeMigrations.set((m.migrations ?? []).filter((x) => !terminal.has(x.phase)).length);
      this.error.set(null);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }

  readonly total = computed(() => this.guests().length);
  readonly readyClusters = computed(() => this.clusters().filter((c) => c.ready).length);

  // Counts grouped into the cards (Pending folds Scheduling in).
  count(...phases: string[]): number {
    const set = new Set(phases);
    return this.guests().filter((g) => set.has(g.phase)).length;
  }

  readonly perCluster = computed(() => {
    const m = new Map<string, { total: number; running: number }>();
    for (const g of this.guests()) {
      const c = g.ref?.cluster ?? '?';
      const e = m.get(c) ?? { total: 0, running: 0 };
      e.total++;
      if (g.phase === 'Running') e.running++;
      m.set(c, e);
    }
    return [...m.entries()]
      .map(([cluster, v]) => ({ cluster, ...v }))
      .sort((a, b) => a.cluster.localeCompare(b.cluster));
  });

  readonly perNode = computed(() => {
    const m = new Map<string, number>();
    for (const g of this.guests()) {
      const n = g.nodeName || '(unscheduled)';
      m.set(n, (m.get(n) ?? 0) + 1);
    }
    return [...m.entries()]
      .map(([node, count]) => ({ node, count }))
      .sort((a, b) => b.count - a.count || a.node.localeCompare(b.node));
  });
}
