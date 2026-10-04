import { TestBed } from '@angular/core/testing';
import { GatewayService } from '../gateway.service';
import { Access } from './access';

describe('Access outdated roles', () => {
  it('counts outdated roles and updates one through SyncRole, then reloads', async () => {
    const synced: unknown[] = [];
    let outdated = true;
    const gw = {
      clusters: { listClusters: async () => ({ clusters: [{ name: 'c1', ready: true }] }) },
      resources: { listResources: async () => ({ resources: [] }) },
      access: {
        listCapabilities: async () => ({ capabilities: [] }),
        listAssignments: async () => ({ assignments: [] }),
        listRoles: async () => ({
          roles: [
            { name: 'kubeswift-viewer', predefined: true, capabilities: [], outdated: false, outdatedReason: '' },
            {
              name: 'team-console',
              predefined: false,
              capabilities: ['console'],
              outdated,
              outdatedReason: outdated ? 'grants rules its capabilities no longer include: pods/exec (create)' : '',
            },
          ],
        }),
        syncRole: async (req: unknown) => {
          synced.push(req);
          outdated = false;
          return {};
        },
      },
    };
    TestBed.configureTestingModule({ imports: [Access], providers: [{ provide: GatewayService, useValue: gw }] });
    const a = TestBed.createComponent(Access).componentInstance;
    await a.ngOnInit();
    expect(a.outdatedCount()).toBe(1);
    await a.updateRole(a.roles()[1]);
    expect(synced).toEqual([{ cluster: 'c1', name: 'team-console' }]);
    expect(a.outdatedCount()).toBe(0);
    expect(a.error()).toBeNull();
  });
});
