import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';
import type { Migration, MigrationEvent } from '../gen/kubeswift/v1/migration_pb';
import type { ClusterError } from '../gen/kubeswift/v1/common_pb';
import { EventType } from '../gen/kubeswift/v1/common_pb';

/**
 * Migrations is the live, fleet-merged migrations table. It snapshots with
 * ListMigrations then follows WatchMigrations (server-stream) so phase /
 * progress / downtime update without a poll; a dropped stream reconnects.
 * Per-cluster errors (partial-fleet) surface explicitly.
 */
@Component({
  selector: 'app-migrations',
  imports: [MatTableModule, MatIconModule],
  templateUrl: './migrations.html',
  styleUrl: './migrations.scss',
})
export class Migrations implements OnInit, OnDestroy {
  private readonly gw = inject(GatewayService);
  readonly migrations = signal<Migration[]>([]);
  readonly errors = signal<ClusterError[]>([]);
  readonly loadError = signal<string | null>(null);
  readonly live = signal(false);
  readonly columns = ['cluster', 'guest', 'route', 'mode', 'phase', 'progress', 'downtime'];

  private readonly map = new Map<string, Migration>();
  private readonly errMap = new Map<string, string>();
  private abort?: AbortController;
  private destroyed = false;

  ngOnInit(): void {
    void this.stream();
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    this.abort?.abort();
  }

  private async stream(): Promise<void> {
    while (!this.destroyed) {
      this.abort = new AbortController();
      const signal = this.abort.signal;
      try {
        const snap = await this.gw.migrations.listMigrations({}, { signal });
        this.map.clear();
        this.errMap.clear();
        for (const m of snap.migrations) this.map.set(this.key(m), m);
        for (const e of snap.errors) this.errMap.set(e.cluster, e.message);
        this.flush();
        this.loadError.set(null);
        this.live.set(true);

        for await (const ev of this.gw.migrations.watchMigrations({}, { signal })) {
          this.applyEvent(ev);
        }
      } catch (e: unknown) {
        if (this.destroyed) break;
        this.live.set(false);
        this.loadError.set(e instanceof Error ? e.message : String(e));
      }
      if (this.destroyed) break;
      await this.delay(3000);
    }
  }

  private applyEvent(ev: MigrationEvent): void {
    if (ev.error) {
      this.errMap.set(ev.error.cluster, ev.error.message);
      this.flush();
      return;
    }
    const m = ev.migration;
    if (!m) return;
    const k = this.key(m);
    if (ev.type === EventType.DELETED) this.map.delete(k);
    else this.map.set(k, m);
    this.flush();
  }

  private key(m: Migration): string {
    return `${m.ref?.cluster}/${m.ref?.namespace}/${m.ref?.name}`;
  }

  private flush(): void {
    const list = [...this.map.values()].sort((a, b) => {
      const at = Number(a.createdAt?.seconds ?? 0n);
      const bt = Number(b.createdAt?.seconds ?? 0n);
      if (at !== bt) return bt - at; // newest first
      return (a.ref?.name ?? '').localeCompare(b.ref?.name ?? '');
    });
    this.migrations.set(list);
    this.errors.set(
      [...this.errMap.entries()].map(([cluster, message]) => ({ cluster, message }) as ClusterError),
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  downtime(m: Migration): string {
    return m.observedDowntimeSeconds > 0 ? m.observedDowntimeSeconds.toFixed(2) + 's' : '—';
  }
}
