import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';
import type { Migration } from '../gen/kubeswift/v1/migration_pb';
import type { ClusterError } from '../gen/kubeswift/v1/common_pb';

/**
 * Migrations is the fleet-merged migrations table. It polls ListMigrations
 * every 2s (migrations run ~30-70s, so polling shows phase + progress live);
 * a server-stream Watch is a later add. Per-cluster errors surface explicitly.
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
  readonly columns = ['cluster', 'guest', 'route', 'mode', 'phase', 'progress', 'downtime'];

  private timer?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    void this.poll();
    this.timer = setInterval(() => void this.poll(), 2000);
  }
  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async poll(): Promise<void> {
    try {
      const res = await this.gw.migrations.listMigrations({});
      this.migrations.set(res.migrations);
      this.errors.set(res.errors);
      this.loadError.set(null);
    } catch (e: unknown) {
      this.loadError.set(e instanceof Error ? e.message : String(e));
    }
  }

  downtime(m: Migration): string {
    return m.observedDowntimeSeconds > 0 ? m.observedDowntimeSeconds.toFixed(2) + 's' : '—';
  }
}
