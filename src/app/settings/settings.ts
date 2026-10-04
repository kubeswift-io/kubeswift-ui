import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';
import type { Cluster } from '../gen/kubeswift/v1/cluster_pb';
import { CreateSecret } from '../create-secret/create-secret';
import {
  CreateClusterStorageLocation,
  CreateStorageLocation,
} from '../create-storagelocation/create-storagelocation';
import {
  type Location,
  type Locations,
  credentialsSecret,
  loadLocations,
  resolveOCI,
  snapshotRepository,
  source,
} from '../storage-locations';

/** NamespaceRow is where one namespace's oci snapshots go, and whether its Secret is there. */
interface NamespaceRow {
  namespace: string;
  location: Location | null;
  problem: string;
  repository: string;
  secret: string; // '' when the location needs none
  // secretState: 'ok' | 'missing' | 'wrong-type' | 'unknown' (could not list Secrets) | 'none'
  secretState: string;
}

type FormKind = '' | 'cluster' | 'namespace' | 'secret';

/**
 * Settings shows and edits, per cluster, where KubeSwift stores what it pushes
 * to a registry (storage locations): the cluster's default and the
 * namespaces' own. For each namespace it shows where its oci snapshots would
 * go and whether the credentials Secret the location names is there; that
 * check runs as the signed-in user, so the gateway never lists Secrets across
 * namespaces itself. Everything is gated by the user's own RBAC.
 */
@Component({
  selector: 'app-settings',
  imports: [MatIconModule, CreateClusterStorageLocation, CreateStorageLocation, CreateSecret],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings implements OnInit {
  private readonly gw = inject(GatewayService);

  readonly clusters = signal<Cluster[]>([]);
  readonly selectedCluster = signal('');
  readonly locs = signal<Locations>({ cluster: [], namespaced: [], error: '' });
  readonly namespaces = signal<string[]>([]);
  // dockerconfigjson Secret names per namespace; null when they could not be listed.
  readonly registrySecrets = signal<Map<string, Set<string>> | null>(null);
  readonly otherSecrets = signal<Map<string, Set<string>>>(new Map());
  readonly perms = signal({ cluster: false, namespace: false, secret: false });
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  // The open form.
  readonly form = signal<FormKind>('');
  readonly formExisting = signal('');
  readonly formNamespace = signal('');
  readonly secretPreset = signal('');

  readonly clusterDefault = computed(() => {
    const d = this.locs().cluster.filter((l) => l.isDefault);
    return d.length === 1 ? d[0] : null;
  });
  readonly clusterDefaultProblem = computed(() => {
    const d = this.locs().cluster.filter((l) => l.isDefault);
    if (d.length > 1) return `Two cluster defaults (${d.map((l) => l.name).join(', ')}): snapshots that need the default wait until only one is left.`;
    if (d.length === 0) return 'No cluster default: an oci snapshot that names no registry, in a namespace without its own default, waits (NoStorageLocation).';
    return '';
  });

  readonly rows = computed<NamespaceRow[]>(() => {
    const locs = this.locs();
    const secrets = this.registrySecrets();
    return this.namespaces().map((ns) => {
      const r = resolveOCI(locs, ns);
      const row: NamespaceRow = {
        namespace: ns,
        location: r.location,
        problem: r.problem,
        repository: r.location ? snapshotRepository(r.location, ns) : '',
        secret: r.location ? credentialsSecret(r.location) : '',
        secretState: 'none',
      };
      if (row.secret) {
        if (!secrets) row.secretState = 'unknown';
        else if (secrets.get(ns)?.has(row.secret)) row.secretState = 'ok';
        else if (this.otherSecrets().get(ns)?.has(row.secret)) row.secretState = 'wrong-type';
        else row.secretState = 'missing';
      }
      return row;
    });
  });

  readonly source = source;

  async ngOnInit(): Promise<void> {
    try {
      const cl = await this.gw.clusters.listClusters({});
      this.clusters.set(cl.clusters);
      const first = cl.clusters.find((c) => c.ready)?.name ?? cl.clusters[0]?.name ?? '';
      this.selectedCluster.set(first);
      if (first) await this.refresh();
    } catch (e) {
      this.error.set(this.msg(e));
    }
  }

  async selectCluster(name: string): Promise<void> {
    this.selectedCluster.set(name);
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const cluster = this.selectedCluster();
    if (!cluster) return;
    this.error.set(null);
    const [locs, ns] = await Promise.all([
      loadLocations(this.gw, cluster),
      this.gw.resources.listResources({ cluster, kind: 'namespaces', namespace: '' }).catch(() => null),
      this.loadSecrets(cluster),
      this.loadPerms(cluster),
    ]);
    this.locs.set(locs);
    this.namespaces.set((ns?.resources ?? []).map((r) => r.ref?.name ?? '').filter(Boolean).sort());
    if (locs.error) this.error.set('Could not read every storage location: ' + locs.error);
  }

  // loadSecrets lists Secret NAMES and types (the gateway never returns values),
  // as the signed-in user, to tell whether each namespace has the credentials
  // Secret its location names.
  private async loadSecrets(cluster: string): Promise<void> {
    try {
      const r = await this.gw.resources.listResources({ cluster, kind: 'secrets', namespace: '' });
      if (r.error?.message) {
        this.registrySecrets.set(null);
        return;
      }
      const reg = new Map<string, Set<string>>();
      const other = new Map<string, Set<string>>();
      for (const s of r.resources) {
        const ns = s.ref?.namespace ?? '';
        const name = s.ref?.name ?? '';
        const isReg = s.columns['type'] === 'kubernetes.io/dockerconfigjson';
        const m = isReg ? reg : other;
        if (!m.has(ns)) m.set(ns, new Set());
        m.get(ns)!.add(name);
      }
      this.registrySecrets.set(reg);
      this.otherSecrets.set(other);
    } catch {
      this.registrySecrets.set(null);
    }
  }

  private async loadPerms(cluster: string): Promise<void> {
    try {
      const r = await this.gw.resources.canI({
        cluster,
        checks: [
          { kind: 'swiftclusterstoragelocations', verb: 'create', namespace: '' },
          { kind: 'swiftstoragelocations', verb: 'create', namespace: '' },
          { kind: 'secrets', verb: 'create', namespace: '' },
        ],
      });
      const d = r.decisions;
      this.perms.set({ cluster: !!d[0]?.allowed, namespace: !!d[1]?.allowed, secret: !!d[2]?.allowed });
    } catch {
      this.perms.set({ cluster: false, namespace: false, secret: false });
    }
  }

  newLocation(kind: 'cluster' | 'namespace', namespace = ''): void {
    this.formExisting.set('');
    this.formNamespace.set(namespace);
    this.form.set(kind);
  }

  async editLocation(l: Location): Promise<void> {
    try {
      const r = await this.gw.resources.getResource({
        cluster: this.selectedCluster(),
        kind: l.kind === 'SwiftClusterStorageLocation' ? 'swiftclusterstoragelocations' : 'swiftstoragelocations',
        namespace: l.namespace,
        name: l.name,
      });
      this.formExisting.set(r.json);
      this.formNamespace.set(l.namespace);
      this.form.set(l.kind === 'SwiftClusterStorageLocation' ? 'cluster' : 'namespace');
    } catch (e) {
      this.error.set(this.msg(e));
    }
  }

  async deleteLocation(l: Location): Promise<void> {
    if (!confirm(`Delete ${source(l)}? Snapshots already stored through it keep their recorded location.`)) return;
    this.busy.set(true);
    try {
      await this.gw.resources.deleteResource({
        cluster: this.selectedCluster(),
        kind: l.kind === 'SwiftClusterStorageLocation' ? 'swiftclusterstoragelocations' : 'swiftstoragelocations',
        namespace: l.namespace,
        name: l.name,
      });
      await this.refresh();
    } catch (e) {
      this.error.set(this.msg(e));
    } finally {
      this.busy.set(false);
    }
  }

  createSecret(row: NamespaceRow): void {
    this.formNamespace.set(row.namespace);
    this.secretPreset.set(row.secret);
    this.formExisting.set('');
    this.form.set('secret');
  }

  closeForm(): void {
    this.form.set('');
    this.formExisting.set('');
  }

  async onSaved(): Promise<void> {
    this.closeForm();
    await this.refresh();
  }

  private msg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }
}
