import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';
import { CreateSandbox } from '../create-sandbox/create-sandbox';
import type { Sandbox, SandboxEvent, SandboxPool } from '../gen/kubeswift/v1/sandbox_pb';
import type { Cluster } from '../gen/kubeswift/v1/cluster_pb';
import type { ClusterError, ObjectRef } from '../gen/kubeswift/v1/common_pb';
import { EventType } from '../gen/kubeswift/v1/common_pb';

/**
 * Sandboxes is the fleet-merged MicroVM inventory: a live SwiftSandbox table
 * (ListSandboxes snapshot then WatchSandboxes server-stream — sandboxes are
 * ephemeral, so phase moves without a poll) plus a SwiftSandboxPool table
 * (warm buffers). Create + delete run as the signed-in user (member RBAC + the
 * webhook gate them); a denial surfaces, never a silent success. Per-cluster
 * errors (partial-fleet) surface explicitly.
 */
@Component({
  selector: 'app-sandboxes',
  imports: [MatTableModule, MatIconModule, CreateSandbox],
  templateUrl: './sandboxes.html',
  styleUrl: './sandboxes.scss',
})
export class Sandboxes implements OnInit, OnDestroy {
  private readonly gw = inject(GatewayService);
  readonly sandboxes = signal<Sandbox[]>([]);
  readonly pools = signal<SandboxPool[]>([]);
  readonly clusters = signal<Cluster[]>([]);
  readonly errors = signal<ClusterError[]>([]);
  readonly loadError = signal<string | null>(null);
  readonly live = signal(false);
  readonly showCreate = signal(false);
  readonly sandboxCols = ['cluster', 'name', 'phase', 'image', 'node', 'ip', 'pool', 'exit', 'actions'];
  readonly poolCols = ['cluster', 'name', 'phase', 'image', 'warm', 'claimed', 'min', 'actions'];

  private readonly map = new Map<string, Sandbox>();
  private readonly errMap = new Map<string, string>();
  private abort?: AbortController;
  private destroyed = false;

  ngOnInit(): void {
    void this.loadClusters();
    void this.loadPools();
    void this.stream();
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    this.abort?.abort();
  }

  private async loadClusters(): Promise<void> {
    try {
      const r = await this.gw.clusters.listClusters({});
      this.clusters.set(r.clusters);
    } catch {
      /* the create form still works with a manually typed cluster */
    }
  }

  async loadPools(): Promise<void> {
    try {
      const r = await this.gw.sandboxes.listSandboxPools({});
      this.pools.set([...r.pools].sort((a, b) => refKey(a.ref).localeCompare(refKey(b.ref))));
    } catch (e) {
      this.loadError.set(e instanceof Error ? e.message : String(e));
    }
  }

  private async stream(): Promise<void> {
    while (!this.destroyed) {
      this.abort = new AbortController();
      const signal = this.abort.signal;
      try {
        const snap = await this.gw.sandboxes.listSandboxes({}, { signal });
        this.map.clear();
        this.errMap.clear();
        for (const s of snap.sandboxes) this.map.set(refKey(s.ref), s);
        for (const e of snap.errors) this.errMap.set(e.cluster, e.message);
        this.flush();
        this.loadError.set(null);
        this.live.set(true);

        for await (const ev of this.gw.sandboxes.watchSandboxes({}, { signal })) {
          this.applyEvent(ev);
        }
      } catch (e: unknown) {
        if (this.destroyed) break;
        this.live.set(false);
        this.loadError.set(e instanceof Error ? e.message : String(e));
      }
      if (this.destroyed) break;
      await delay(3000);
    }
  }

  private applyEvent(ev: SandboxEvent): void {
    if (ev.error) {
      this.errMap.set(ev.error.cluster, ev.error.message);
      this.flush();
      return;
    }
    const s = ev.sandbox;
    if (!s) return;
    const k = refKey(s.ref);
    if (ev.type === EventType.DELETED) this.map.delete(k);
    else this.map.set(k, s);
    this.flush();
  }

  private flush(): void {
    this.sandboxes.set(
      [...this.map.values()].sort((a, b) => {
        const at = Number(a.createdAt?.seconds ?? 0n);
        const bt = Number(b.createdAt?.seconds ?? 0n);
        if (at !== bt) return bt - at; // newest first
        return (a.ref?.name ?? '').localeCompare(b.ref?.name ?? '');
      }),
    );
    this.errors.set(
      [...this.errMap.entries()].map(([cluster, message]) => ({ cluster, message }) as ClusterError),
    );
  }

  async deleteSandbox(s: Sandbox): Promise<void> {
    if (!s.ref || !confirm(`Delete sandbox "${s.ref.name}"? This cannot be undone.`)) return;
    try {
      await this.gw.sandboxes.deleteSandbox({ ref: s.ref });
      // the live WatchSandboxes stream removes the row
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  async deletePool(p: SandboxPool): Promise<void> {
    if (!p.ref || !confirm(`Delete pool "${p.ref.name}"? Its warm slots are removed.`)) return;
    try {
      await this.gw.sandboxes.deleteSandboxPool({ ref: p.ref });
      await this.loadPools();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  onCreated(): void {
    this.showCreate.set(false);
    void this.loadPools(); // a new pool has no watch; the sandbox stream covers a new sandbox
  }

  exitLabel(s: Sandbox): string {
    return s.phase === 'Completed' || s.phase === 'Failed' ? String(s.exitCode) : '—';
  }
}

function refKey(r?: ObjectRef): string {
  return `${r?.cluster}/${r?.namespace}/${r?.name}`;
}
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
