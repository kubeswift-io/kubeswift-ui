import type { GatewayService } from './gateway.service';
import {
  type Location,
  type Locations,
  credentialsSecret,
  loadLocations,
  resolveOCI,
  snapshotRepository,
} from './storage-locations';

function loc(p: Partial<Location>): Location {
  return {
    kind: 'SwiftClusterStorageLocation', name: 'x', namespace: '', isDefault: false, repository: '',
    insecure: false, anonymous: false, credentialsSecretName: '', signingKeySecretName: '', hasCABundle: false,
    volumeSnapshotClassName: '', ready: '', readyMessage: '', reachable: '', reachableMessage: '', ...p,
  };
}

describe('storage-locations', () => {
  const cluster = loc({ name: 'main', isDefault: true, repository: 'reg.example/kubeswift' });

  it('stores a cluster location by namespace and a namespace location as written', () => {
    expect(snapshotRepository(cluster, 'team-a')).toBe('reg.example/kubeswift/team-a/snapshots');
    const ns = loc({ kind: 'SwiftStorageLocation', name: 'team', namespace: 'team-a', repository: 'reg.example/a/' });
    expect(snapshotRepository(ns, 'team-a')).toBe('reg.example/a/snapshots');
  });

  it('credentialsSecret defaults the name and is empty when anonymous', () => {
    expect(credentialsSecret(cluster)).toBe('kubeswift-registry');
    expect(credentialsSecret(loc({ credentialsSecretName: 'regcreds' }))).toBe('regcreds');
    expect(credentialsSecret(loc({ anonymous: true }))).toBe('');
  });

  it('resolves like the controller: namespace default, else cluster default', () => {
    const team = loc({ kind: 'SwiftStorageLocation', name: 'team', namespace: 'team-a', isDefault: true, repository: 'r/a' });
    const csiOnly = loc({ kind: 'SwiftStorageLocation', name: 'cls', namespace: 'team-b', isDefault: true, volumeSnapshotClassName: 'fast' });
    const locs: Locations = { cluster: [cluster], namespaced: [team, csiOnly], error: '' };
    expect(resolveOCI(locs, 'team-a').location?.name).toBe('team');
    // A namespace default without a registry leaves oci to the cluster default.
    expect(resolveOCI(locs, 'team-b').location?.name).toBe('main');
    expect(resolveOCI(locs, 'team-c').location?.name).toBe('main');
  });

  it('never picks between two defaults', () => {
    const two: Locations = { cluster: [cluster, loc({ name: 'other', isDefault: true, repository: 'r' })], namespaced: [], error: '' };
    const r = resolveOCI(two, 'team-a');
    expect(r.location).toBeNull();
    expect(r.problem).toContain('main, other');
    expect(resolveOCI({ cluster: [], namespaced: [], error: '' }, 'x').problem).toContain('NoStorageLocation');
  });

  it('loadLocations reads each location and its conditions', async () => {
    const objs: Record<string, object> = {
      'swiftclusterstoragelocations//main': {
        metadata: { name: 'main' },
        spec: { default: true, oci: { repository: 'reg.example/k', anonymous: true, caBundle: 'pem' } },
        status: { conditions: [{ type: 'Ready', status: 'True' }, { type: 'Reachable', status: 'False', message: 'x509' }] },
      },
      'swiftstoragelocations/team-a/team': {
        metadata: { name: 'team', namespace: 'team-a' },
        spec: { csi: { volumeSnapshotClassName: 'fast' } },
      },
    };
    const gw = {
      resources: {
        listResources: async (req: { kind: string }) => ({
          resources: Object.keys(objs)
            .filter((k) => k.startsWith(req.kind + '/'))
            .map((k) => ({ ref: { namespace: k.split('/')[1], name: k.split('/')[2] } })),
        }),
        getResource: async (req: { kind: string; namespace: string; name: string }) => ({
          json: JSON.stringify(objs[`${req.kind}/${req.namespace}/${req.name}`]),
        }),
      },
    } as unknown as GatewayService;
    const l = await loadLocations(gw, 'c1');
    expect(l.cluster[0]).toEqual(expect.objectContaining({ name: 'main', isDefault: true, anonymous: true, hasCABundle: true, ready: 'True', reachable: 'False', reachableMessage: 'x509' }));
    expect(l.namespaced[0]).toEqual(expect.objectContaining({ kind: 'SwiftStorageLocation', namespace: 'team-a', volumeSnapshotClassName: 'fast', repository: '' }));
  });
});
