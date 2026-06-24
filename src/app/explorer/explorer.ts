import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';
import type { ResourceKind, Resource } from '../gen/kubeswift/v1/resource_pb';
import type { Cluster } from '../gen/kubeswift/v1/cluster_pb';
import type { ClusterError } from '../gen/kubeswift/v1/common_pb';

interface KindGroup {
  category: string;
  kinds: ResourceKind[];
}

/**
 * Explorer is the read-only cluster resource browser. The left nav is driven by
 * the gateway's ResourceService catalog (ListResourceKinds), so adding a kind is
 * a backend change; ListResources fetches one kind on the selected member as the
 * (impersonated) user. Per-cluster (the explorer browses one member); a global
 * namespace filter scopes namespaced kinds. Secrets show metadata only.
 */
@Component({
  selector: 'app-explorer',
  imports: [MatIconModule],
  templateUrl: './explorer.html',
  styleUrl: './explorer.scss',
})
export class Explorer implements OnInit {
  private readonly gw = inject(GatewayService);

  readonly clusters = signal<Cluster[]>([]);
  readonly selectedCluster = signal<string>('');
  readonly kinds = signal<ResourceKind[]>([]);
  readonly selectedKind = signal<ResourceKind | null>(null);
  readonly namespaces = signal<string[]>([]);
  readonly selectedNamespace = signal<string>(''); // '' = all namespaces
  readonly resources = signal<Resource[]>([]);
  readonly error = signal<ClusterError | null>(null); // per-cluster (partial) failure
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null); // hard RPC failure

  private readonly categoryOrder = [
    'Cluster',
    'Workloads',
    'Networking',
    'Storage',
    'Config',
    'KubeSwift',
  ];

  // The left nav, grouped by category in a stable order.
  readonly groups = computed<KindGroup[]>(() => {
    const byCat = new Map<string, ResourceKind[]>();
    for (const k of this.kinds()) {
      const arr = byCat.get(k.category) ?? [];
      arr.push(k);
      byCat.set(k.category, arr);
    }
    return this.categoryOrder
      .filter((c) => byCat.has(c))
      .map((c) => ({ category: c, kinds: byCat.get(c)! }));
  });

  // Table columns: name (+ namespace for namespaced kinds) + the kind's projected
  // columns + age.
  readonly columns = computed<string[]>(() => {
    const k = this.selectedKind();
    if (!k) return [];
    const cols = k.namespaced ? ['namespace', 'name'] : ['name'];
    cols.push(...k.columns, 'age');
    return cols;
  });

  async ngOnInit(): Promise<void> {
    try {
      const [cl, ks] = await Promise.all([
        this.gw.clusters.listClusters({}),
        this.gw.resources.listResourceKinds({}),
      ]);
      this.clusters.set(cl.clusters);
      this.kinds.set(ks.kinds);
      const first = cl.clusters.find((c) => c.ready)?.name ?? cl.clusters[0]?.name ?? '';
      this.selectedCluster.set(first);
      this.selectedKind.set(ks.kinds.find((k) => k.key === 'nodes') ?? ks.kinds[0] ?? null);
      if (first) {
        await this.loadNamespaces();
        await this.reload();
      }
    } catch (e) {
      this.loadError.set(e instanceof Error ? e.message : String(e));
    }
  }

  async selectCluster(name: string): Promise<void> {
    this.selectedCluster.set(name);
    this.selectedNamespace.set('');
    await this.loadNamespaces();
    await this.reload();
  }

  async selectKind(k: ResourceKind): Promise<void> {
    this.selectedKind.set(k);
    await this.reload();
  }

  async selectNamespace(ns: string): Promise<void> {
    this.selectedNamespace.set(ns);
    await this.reload();
  }

  private async loadNamespaces(): Promise<void> {
    const cluster = this.selectedCluster();
    if (!cluster) {
      this.namespaces.set([]);
      return;
    }
    try {
      const r = await this.gw.resources.listResources({ cluster, kind: 'namespaces' });
      this.namespaces.set(
        r.resources
          .map((x) => x.ref?.name ?? '')
          .filter(Boolean)
          .sort(),
      );
    } catch {
      this.namespaces.set([]);
    }
  }

  private async reload(): Promise<void> {
    const cluster = this.selectedCluster();
    const kind = this.selectedKind();
    if (!cluster || !kind) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const namespace = kind.namespaced ? this.selectedNamespace() : '';
      const r = await this.gw.resources.listResources({ cluster, kind: kind.key, namespace });
      this.resources.set(r.resources);
      this.error.set(r.error ?? null);
    } catch (e) {
      this.resources.set([]);
      this.error.set({
        cluster,
        message: e instanceof Error ? e.message : String(e),
      } as ClusterError);
    } finally {
      this.loading.set(false);
    }
  }

  key(r: Resource): string {
    return `${r.ref?.namespace ?? ''}/${r.ref?.name ?? ''}`;
  }

  cell(r: Resource, col: string): string {
    if (col === 'name') return r.ref?.name ?? '';
    if (col === 'namespace') return r.ref?.namespace ?? '';
    if (col === 'age') return this.age(r);
    return r.columns[col] ?? '';
  }

  private age(r: Resource): string {
    const sec = Number(r.createdAt?.seconds ?? 0n);
    if (!sec) return '—';
    const d = Math.max(0, Math.floor(Date.now() / 1000) - sec);
    if (d < 60) return `${d}s`;
    if (d < 3600) return `${Math.floor(d / 60)}m`;
    if (d < 86400) return `${Math.floor(d / 3600)}h`;
    return `${Math.floor(d / 86400)}d`;
  }
}
