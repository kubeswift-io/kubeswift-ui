import { Component, OnInit, OnDestroy, computed, inject, signal } from '@angular/core';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatButtonModule } from '@angular/material/button';
import { GatewayService } from '../gateway.service';
import { GuestDetail } from '../guest-detail/guest-detail';
import { CreateGuest, type GuestPrefill } from '../create-guest/create-guest';
import type { Cluster } from '../gen/kubeswift/v1/cluster_pb';
import type { Guest, GuestEvent } from '../gen/kubeswift/v1/guest_pb';
import type { ClusterError } from '../gen/kubeswift/v1/common_pb';
import { EventType } from '../gen/kubeswift/v1/common_pb';

/**
 * Fleet is the live, fleet-merged VM inventory. It snapshots with ListGuests
 * then follows WatchGuests (server-stream) so the table updates without a
 * refresh; a dropped stream reconnects. Clicking a cluster chip filters the
 * table. The gateway's per-cluster errors (partial-fleet) are surfaced
 * explicitly — a failing member never blanks the table.
 */
@Component({
  selector: 'app-fleet',
  imports: [
    MatTableModule,
    MatIconModule,
    MatProgressBarModule,
    MatButtonModule,
    GuestDetail,
    CreateGuest,
  ],
  templateUrl: './fleet.html',
  styleUrl: './fleet.scss',
})
export class Fleet implements OnInit, OnDestroy {
  private readonly gw = inject(GatewayService);
  readonly baseUrl = this.gw.baseUrl;

  readonly clusters = signal<Cluster[]>([]);
  readonly guests = signal<Guest[]>([]);
  readonly errors = signal<ClusterError[]>([]);
  readonly selectedCluster = signal<string | null>(null);
  readonly selected = signal<Guest | null>(null);
  readonly loadError = signal<string | null>(null);
  readonly live = signal(false);
  readonly showCreate = signal(false); // Create-VM wizard
  readonly wizardCluster = signal(''); // cluster the wizard targets
  readonly clonePrefill = signal<GuestPrefill | null>(null); // set when cloning

  openCreate(): void {
    this.clonePrefill.set(null);
    this.wizardCluster.set(
      this.selectedCluster() ?? this.clusters().find((c) => c.ready)?.name ?? '',
    );
    this.showCreate.set(true);
  }
  // Clone from a guest's drawer: open the wizard pre-filled on the guest's cluster.
  onClone(ev: { cluster: string; prefill: GuestPrefill }): void {
    this.selected.set(null); // close the drawer
    this.wizardCluster.set(ev.cluster);
    this.clonePrefill.set(ev.prefill);
    this.showCreate.set(true);
  }
  closeCreate(): void {
    this.showCreate.set(false);
  }
  // The new VM surfaces in the table via the live WatchGuests stream.
  onCreated(): void {
    this.showCreate.set(false);
  }

  readonly columns = ['cluster', 'namespace', 'name', 'phase', 'node', 'ip', 'bootSource'];

  // The table view: all guests, or just the selected cluster's.
  readonly filtered = computed(() => {
    const c = this.selectedCluster();
    const all = this.guests();
    return c ? all.filter((g) => g.ref?.cluster === c) : all;
  });

  private readonly guestMap = new Map<string, Guest>();
  private readonly errMap = new Map<string, string>();
  private abort?: AbortController;
  private destroyed = false;
  private clusterTimer?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    void this.refreshClusters();
    this.clusterTimer = setInterval(() => void this.refreshClusters(), 15000);
    void this.streamGuests();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.abort?.abort();
    if (this.clusterTimer) clearInterval(this.clusterTimer);
  }

  selectCluster(name: string): void {
    this.selectedCluster.update((c) => (c === name ? null : name));
  }

  // Open the detail drawer instantly from the row, then refresh via
  // GetGuestDetail (so it auto-enriches when the backend aggregates).
  select(g: Guest): void {
    this.selected.set(g);
    const ref = g.ref;
    if (!ref) return;
    void this.gw.guests
      .getGuestDetail({ ref: { cluster: ref.cluster, namespace: ref.namespace, name: ref.name } })
      .then((res) => {
        const cur = this.selected();
        if (res.guest && cur && this.key(cur) === this.key(g)) this.selected.set(res.guest);
      })
      .catch(() => {
        // keep the row data already shown
      });
  }

  closeDetail(): void {
    this.selected.set(null);
  }

  private async refreshClusters(): Promise<void> {
    try {
      const res = await this.gw.clusters.listClusters({});
      this.clusters.set(res.clusters);
    } catch {
      // keep the last known cluster list; the guest stream reports connectivity
    }
  }

  private async streamGuests(): Promise<void> {
    while (!this.destroyed) {
      this.abort = new AbortController();
      const signal = this.abort.signal;
      try {
        const snap = await this.gw.guests.listGuests({}, { signal });
        this.guestMap.clear();
        this.errMap.clear();
        for (const g of snap.guests) this.guestMap.set(this.key(g), g);
        for (const e of snap.errors) this.errMap.set(e.cluster, e.message);
        this.flush();
        this.loadError.set(null);
        this.live.set(true);

        for await (const ev of this.gw.guests.watchGuests({}, { signal })) {
          this.applyEvent(ev);
        }
      } catch (e) {
        if (this.destroyed) break;
        this.live.set(false);
        this.loadError.set(e instanceof Error ? e.message : String(e));
      }
      if (this.destroyed) break;
      await this.delay(3000);
    }
  }

  private applyEvent(ev: GuestEvent): void {
    if (ev.error) {
      this.errMap.set(ev.error.cluster, ev.error.message);
      this.flushErrors();
      return;
    }
    const g = ev.guest;
    if (!g) return;
    const k = this.key(g);
    if (ev.type === EventType.DELETED) {
      this.guestMap.delete(k);
      if (this.isSelected(k)) this.selected.set(null); // the drawer's guest is gone
    } else {
      this.guestMap.set(k, g);
      if (this.isSelected(k)) this.selected.set(g); // keep the open drawer live (phase flips after Start/Stop)
    }
    this.flush();
  }

  private isSelected(k: string): boolean {
    const sel = this.selected();
    return !!sel && this.key(sel) === k;
  }

  private key(g: Guest): string {
    return `${g.ref?.cluster}/${g.ref?.namespace}/${g.ref?.name}`;
  }

  private flush(): void {
    const list = [...this.guestMap.values()].sort((a, b) => {
      const ra = a.ref,
        rb = b.ref;
      return (
        (ra?.cluster ?? '').localeCompare(rb?.cluster ?? '') ||
        (ra?.namespace ?? '').localeCompare(rb?.namespace ?? '') ||
        (ra?.name ?? '').localeCompare(rb?.name ?? '')
      );
    });
    this.guests.set(list);
    this.flushErrors();
  }

  private flushErrors(): void {
    this.errors.set(
      [...this.errMap.entries()].map(
        ([cluster, message]) => ({ cluster, message }) as ClusterError,
      ),
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
