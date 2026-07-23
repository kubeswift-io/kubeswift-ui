import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';
import type { ResourceKind, Resource } from '../gen/kubeswift/v1/resource_pb';
import type { Cluster } from '../gen/kubeswift/v1/cluster_pb';
import type { ClusterError } from '../gen/kubeswift/v1/common_pb';
import { NodeDrawer } from '../node-drawer/node-drawer';
import { GpuNodeDrawer } from '../gpu-node-drawer/gpu-node-drawer';
import { SnapshotDetail } from '../snapshot-detail/snapshot-detail';
import { PoolDrawer } from '../pool-drawer/pool-drawer';
import { ImageDrawer } from '../image-drawer/image-drawer';
import { SandboxDrawer } from '../sandbox-drawer/sandbox-drawer';
import { SandboxPoolDrawer } from '../sandboxpool-drawer/sandboxpool-drawer';
import { CreateSandbox } from '../create-sandbox/create-sandbox';
import { YamlEditor } from '../yaml-editor/yaml-editor';

// Kinds that open a resource-aware detail drawer on row-click (instead of the
// generic Edit/Delete row buttons). Everything else is browsed in the table.
const DRAWER_KINDS = new Set([
  'nodes',
  'swiftgpunodes',
  'swiftsnapshots',
  'swiftguestpools',
  'swiftimages',
  'swiftsandboxes',
  'swiftsandboxpools',
]);

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
  imports: [
    MatIconModule,
    NodeDrawer,
    GpuNodeDrawer,
    SnapshotDetail,
    PoolDrawer,
    ImageDrawer,
    SandboxDrawer,
    SandboxPoolDrawer,
    CreateSandbox,
    YamlEditor,
  ],
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
  // Kind-aware detail drawer: row-click opens the right drawer for the kind.
  readonly detail = signal<{ kind: string; name: string; namespace: string } | null>(null);
  readonly editorOpen = signal(false); // YAML editor (create/edit)
  readonly sandboxCreateOpen = signal(false); // guided SwiftSandbox create wizard
  readonly editorName = signal(''); // '' = create
  readonly editorNs = signal('');
  readonly actionError = signal<string | null>(null); // delete/apply denials, surfaced

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

  isNodesKind(): boolean {
    return this.selectedKind()?.key === 'nodes';
  }
  // Rows of a drawer-bearing kind are clickable -> the kind's detail drawer.
  hasDrawer(): boolean {
    return DRAWER_KINDS.has(this.selectedKind()?.key ?? '');
  }
  openRow(r: Resource): void {
    if (!this.hasDrawer()) return;
    this.detail.set({
      kind: this.selectedKind()?.key ?? '',
      name: r.ref?.name ?? '',
      namespace: r.ref?.namespace ?? '',
    });
  }
  closeDetail(): void {
    this.detail.set(null);
  }
  // A drawer action changed the resource (e.g. a restore was created): refresh.
  onDrawerChanged(): void {
    void this.reload();
  }
  // Health-dot colour from a node's projected status string.
  nodeDot(status: string): 'green' | 'amber' | 'red' {
    if (status.includes('NotReady')) return 'red';
    if (status.includes('SchedulingDisabled') || status.includes('Pressure')) return 'amber';
    return status.includes('Ready') ? 'green' : 'amber';
  }

  // --- CRUD (RBAC-gated; the gateway impersonates the user, so denials surface
  // in the action banner — never a silent no-op). ---
  openCreate(): void {
    this.actionError.set(null);
    // Sandboxes get a guided wizard (image + the v0.12 GPU/model/scratch shapes);
    // every other kind uses the generic YAML editor.
    if (this.selectedKind()?.key === 'swiftsandboxes') {
      this.sandboxCreateOpen.set(true);
      return;
    }
    this.editorName.set(''); // '' -> create
    this.editorNs.set(this.selectedKind()?.namespaced ? this.selectedNamespace() : '');
    this.editorOpen.set(true);
  }
  openEdit(r: Resource, ev: Event): void {
    ev.stopPropagation(); // don't also trigger a node-row click
    this.editorName.set(r.ref?.name ?? '');
    this.editorNs.set(r.ref?.namespace ?? '');
    this.actionError.set(null);
    this.editorOpen.set(true);
  }
  closeEditor(): void {
    this.editorOpen.set(false);
  }
  closeSandboxCreate(): void {
    this.sandboxCreateOpen.set(false);
  }
  async onSandboxCreated(): Promise<void> {
    this.sandboxCreateOpen.set(false);
    await this.reload();
  }
  async onSaved(): Promise<void> {
    this.editorOpen.set(false);
    await this.reload();
  }
  async deleteRow(r: Resource, ev: Event): Promise<void> {
    ev.stopPropagation();
    const name = r.ref?.name ?? '';
    if (
      !name ||
      !confirm(`Delete ${this.selectedKind()?.displayName} "${name}"? This cannot be undone.`)
    ) {
      return;
    }
    this.actionError.set(null);
    try {
      await this.gw.resources.deleteResource({
        cluster: this.selectedCluster(),
        kind: this.selectedKind()?.key ?? '',
        namespace: r.ref?.namespace ?? '',
        name,
      });
      await this.reload();
    } catch (e) {
      this.actionError.set(e instanceof Error ? e.message : String(e));
    }
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
