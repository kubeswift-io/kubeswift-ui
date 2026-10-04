import { TestBed } from '@angular/core/testing';
import { GatewayService } from '../gateway.service';
import { Settings } from './settings';

/** fakeGateway serves a cluster with a cluster default and one namespace override. */
function fakeGateway(secretsForbidden = false) {
  const objs: Record<string, object> = {
    'swiftclusterstoragelocations//main': {
      metadata: { name: 'main' },
      spec: { default: true, oci: { repository: 'reg.example/k' } },
      status: { conditions: [{ type: 'Ready', status: 'True' }] },
    },
    'swiftstoragelocations/team-b/own': {
      metadata: { name: 'own', namespace: 'team-b' },
      spec: { default: true, oci: { repository: 'reg.example/b', anonymous: true } },
    },
  };
  const secrets = [
    { ref: { namespace: 'team-a', name: 'kubeswift-registry' }, columns: { type: 'kubernetes.io/dockerconfigjson' } },
    { ref: { namespace: 'team-c', name: 'kubeswift-registry' }, columns: { type: 'Opaque' } },
  ];
  return {
    clusters: { listClusters: async () => ({ clusters: [{ name: 'c1', ready: true }] }) },
    resources: {
      listResources: async (req: { kind: string }) => {
        if (req.kind === 'namespaces') {
          return { resources: ['team-a', 'team-b', 'team-c', 'team-d'].map((n) => ({ ref: { name: n } })) };
        }
        if (req.kind === 'secrets') {
          return secretsForbidden ? { resources: [], error: { message: 'forbidden' } } : { resources: secrets };
        }
        return {
          resources: Object.keys(objs)
            .filter((k) => k.startsWith(req.kind + '/'))
            .map((k) => ({ ref: { namespace: k.split('/')[1], name: k.split('/')[2] } })),
        };
      },
      getResource: async (req: { kind: string; namespace: string; name: string }) => ({
        json: JSON.stringify(objs[`${req.kind}/${req.namespace}/${req.name}`]),
      }),
      canI: async () => ({ decisions: [{ allowed: true }, { allowed: true }, { allowed: true }] }),
    },
  };
}

async function settings(secretsForbidden = false): Promise<Settings> {
  TestBed.configureTestingModule({
    imports: [Settings],
    providers: [{ provide: GatewayService, useValue: fakeGateway(secretsForbidden) }],
  });
  const s = TestBed.createComponent(Settings).componentInstance;
  await s.ngOnInit();
  return s;
}

describe('Settings', () => {
  it('shows where each namespace stores snapshots and whether its Secret is there', async () => {
    const s = await settings();
    expect(s.clusterDefault()?.name).toBe('main');
    const rows = Object.fromEntries(s.rows().map((r) => [r.namespace, r]));
    expect(rows['team-a']).toEqual(jasmine.objectContaining({ repository: 'reg.example/k/team-a/snapshots', secret: 'kubeswift-registry', secretState: 'ok' }));
    expect(rows['team-b']).toEqual(jasmine.objectContaining({ repository: 'reg.example/b/snapshots', secret: '', secretState: 'none' }));
    expect(rows['team-c'].secretState).toBe('wrong-type');
    expect(rows['team-d'].secretState).toBe('missing');
  });

  it('says it cannot check a Secret it may not list, instead of calling it missing', async () => {
    const s = await settings(true);
    const rows = Object.fromEntries(s.rows().map((r) => [r.namespace, r]));
    expect(rows['team-d'].secretState).toBe('unknown');
  });
});
