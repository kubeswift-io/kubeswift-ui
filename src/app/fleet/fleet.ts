import { Component, OnInit, inject, signal } from '@angular/core';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatButtonModule } from '@angular/material/button';
import { GatewayService } from '../gateway.service';
import type { Cluster } from '../gen/kubeswift/v1/cluster_pb';
import type { Guest } from '../gen/kubeswift/v1/guest_pb';
import type { ClusterError } from '../gen/kubeswift/v1/common_pb';

/**
 * Fleet is the P0 landing page: the cluster selector summary + a live,
 * fleet-merged VM inventory, fetched from the gateway's ClusterService +
 * GuestService. The per-cluster error surface (partial-fleet) is rendered
 * explicitly — a member that fails does not blank the whole table.
 */
@Component({
  selector: 'app-fleet',
  imports: [MatTableModule, MatIconModule, MatProgressBarModule, MatButtonModule],
  templateUrl: './fleet.html',
  styleUrl: './fleet.scss',
})
export class Fleet implements OnInit {
  private readonly gw = inject(GatewayService);
  readonly baseUrl = this.gw.baseUrl;

  readonly clusters = signal<Cluster[]>([]);
  readonly guests = signal<Guest[]>([]);
  readonly errors = signal<ClusterError[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);

  readonly columns = ['cluster', 'namespace', 'name', 'phase', 'node', 'ip', 'bootSource'];

  ngOnInit(): void {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const [cl, gl] = await Promise.all([
        this.gw.clusters.listClusters({}),
        this.gw.guests.listGuests({}),
      ]);
      this.clusters.set(cl.clusters);
      this.guests.set(gl.guests);
      this.errors.set(gl.errors);
    } catch (e) {
      this.loadError.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.loading.set(false);
    }
  }
}
