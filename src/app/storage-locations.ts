import type { GatewayService } from './gateway.service';

/**
 * Storage locations (kubeswift storage.kubeswift.io): where KubeSwift keeps what
 * it pushes to a registry, set once for the cluster (SwiftClusterStorageLocation)
 * and overridable per namespace (SwiftStorageLocation). The controller resolves
 * a snapshot's location; these helpers only mirror that resolution so the UI
 * can show where a snapshot would go, never to decide it.
 */

export type LocationKind = 'SwiftClusterStorageLocation' | 'SwiftStorageLocation';

export const DEFAULT_CREDENTIALS_SECRET = 'kubeswift-registry';

/** Location is one storage location, as the UI needs it. */
export interface Location {
  kind: LocationKind;
  name: string;
  namespace: string; // '' for a cluster location
  isDefault: boolean;
  repository: string; // '' when it configures no registry
  insecure: boolean;
  anonymous: boolean;
  credentialsSecretName: string; // as written; see credentialsSecret()
  signingKeySecretName: string;
  hasCABundle: boolean;
  volumeSnapshotClassName: string;
  ready: string; // the Ready condition's status
  readyMessage: string;
  reachable: string; // cluster locations only
  reachableMessage: string;
}

/** source is how a snapshot's status.location names the location. */
export function source(l: Location): string {
  return `${l.kind}/${l.name}`;
}

/** credentialsSecret is the Secret a location's objects use; '' when anonymous. */
export function credentialsSecret(l: Location): string {
  if (l.anonymous) return '';
  return l.credentialsSecretName || DEFAULT_CREDENTIALS_SECRET;
}

/**
 * snapshotRepository is where a location stores a namespace's snapshots: a
 * cluster location adds the namespace, so each gets its own path.
 */
export function snapshotRepository(l: Location, namespace: string): string {
  const repo = l.repository.replace(/\/+$/, '');
  return l.kind === 'SwiftClusterStorageLocation' ? `${repo}/${namespace}/snapshots` : `${repo}/snapshots`;
}

type Obj = Record<string, any>;

function toLocation(kind: LocationKind, o: Obj): Location {
  const spec = (o['spec'] ?? {}) as Obj;
  const oci = (spec['oci'] ?? {}) as Obj;
  const conds = ((o['status'] ?? {})['conditions'] ?? []) as Obj[];
  const cond = (t: string) => conds.find((c) => c['type'] === t) ?? {};
  return {
    kind,
    name: String(o['metadata']?.['name'] ?? ''),
    namespace: String(o['metadata']?.['namespace'] ?? ''),
    isDefault: spec['default'] === true,
    repository: String(oci['repository'] ?? ''),
    insecure: oci['insecure'] === true,
    anonymous: oci['anonymous'] === true,
    credentialsSecretName: String(oci['credentialsSecretName'] ?? ''),
    signingKeySecretName: String(oci['signingKeySecretName'] ?? ''),
    hasCABundle: !!oci['caBundle'],
    volumeSnapshotClassName: String(spec['csi']?.['volumeSnapshotClassName'] ?? ''),
    ready: String(cond('Ready')['status'] ?? ''),
    readyMessage: String(cond('Ready')['message'] ?? ''),
    reachable: String(cond('Reachable')['status'] ?? ''),
    reachableMessage: String(cond('Reachable')['message'] ?? ''),
  };
}

/** Locations is a cluster's storage locations, and why a list failed, if one did. */
export interface Locations {
  cluster: Location[];
  namespaced: Location[];
  error: string;
}

/**
 * loadLocations reads every storage location on a cluster, as the signed-in
 * user. namespace narrows the namespaced ones; '' reads all the user can.
 */
export async function loadLocations(gw: GatewayService, cluster: string, namespace = ''): Promise<Locations> {
  const out: Locations = { cluster: [], namespaced: [], error: '' };
  if (!cluster) return out;
  const errors: string[] = [];
  const load = async (key: string, kind: LocationKind, ns: string): Promise<Location[]> => {
    try {
      const list = await gw.resources.listResources({ cluster, kind: key, namespace: ns });
      if (list.error?.message) errors.push(list.error.message);
      const objs = await Promise.all(
        list.resources.map((r) =>
          gw.resources.getResource({ cluster, kind: key, namespace: r.ref?.namespace ?? '', name: r.ref?.name ?? '' }),
        ),
      );
      return objs
        .map((r) => toLocation(kind, JSON.parse(r.json) as Obj))
        .sort((a, b) => (a.namespace + '/' + a.name).localeCompare(b.namespace + '/' + b.name));
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      return [];
    }
  };
  [out.cluster, out.namespaced] = await Promise.all([
    load('swiftclusterstoragelocations', 'SwiftClusterStorageLocation', ''),
    load('swiftstoragelocations', 'SwiftStorageLocation', namespace),
  ]);
  out.error = errors.join('; ');
  return out;
}

/** Resolution is what an oci snapshot in a namespace would be stored in. */
export interface Resolution {
  location: Location | null;
  // problem says why there is none: no location, or two defaults at one level.
  problem: string;
}

/**
 * resolveOCI mirrors the controller: the namespace's default, if it has a
 * registry, else the cluster's default. Two defaults at one level are never
 * picked between; the snapshot would wait.
 */
export function resolveOCI(locs: Locations, namespace: string): Resolution {
  const nsDefaults = locs.namespaced.filter((l) => l.namespace === namespace && l.isDefault);
  if (nsDefaults.length > 1) {
    return { location: null, problem: `Two defaults in ${namespace}: ${nsDefaults.map((l) => l.name).join(', ')}` };
  }
  if (nsDefaults.length === 1 && nsDefaults[0].repository) return { location: nsDefaults[0], problem: '' };
  const clDefaults = locs.cluster.filter((l) => l.isDefault);
  if (clDefaults.length > 1) {
    return { location: null, problem: `Two cluster defaults: ${clDefaults.map((l) => l.name).join(', ')}` };
  }
  if (clDefaults.length === 1 && clDefaults[0].repository) return { location: clDefaults[0], problem: '' };
  return { location: null, problem: 'No storage location: snapshots that name no registry wait (NoStorageLocation)' };
}

/** ociLocations lists the locations a namespace's oci snapshot may name. */
export function ociLocations(locs: Locations, namespace: string): Location[] {
  return [
    ...locs.namespaced.filter((l) => l.namespace === namespace && l.repository),
    ...locs.cluster.filter((l) => l.repository),
  ];
}
