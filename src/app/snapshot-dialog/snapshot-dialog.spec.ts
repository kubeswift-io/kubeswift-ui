import { TestBed } from '@angular/core/testing';
import { GatewayService } from '../gateway.service';
import { SnapshotDialog } from './snapshot-dialog';

type Obj = Record<string, any>;

function open(): { d: SnapshotDialog; sent: () => Obj | undefined } {
  let sent: Obj | undefined;
  const gw = {
    resources: {
      listResources: async () => ({ resources: [] }),
      applyResource: async (req: { yaml: string }) => {
        sent = JSON.parse(req.yaml);
        return {};
      },
    },
    guests: { listGuests: async () => ({ guests: [], errors: [] }) },
  };
  TestBed.configureTestingModule({
    imports: [SnapshotDialog],
    providers: [{ provide: GatewayService, useValue: gw }],
  });
  const f = TestBed.createComponent(SnapshotDialog);
  f.componentRef.setInput('cluster', 'c1');
  f.componentRef.setInput('namespace', 'team-a');
  f.componentRef.setInput('fixedGuest', 'web');
  f.detectChanges();
  return { d: f.componentInstance, sent: () => sent };
}

describe('SnapshotDialog', () => {
  it('a CSI snapshot is disk only and sends no resume setting', async () => {
    const { d, sent } = open();
    d.backend.set('csi-volume-snapshot');
    d.volumeSnapshotClass.set('fast');
    await d.save();
    const spec = sent()!['spec'];
    expect(spec['includeMemory']).toBe(false);
    expect(spec['resumeAfterSnapshot']).toBeUndefined();
    expect(spec['backend']).toEqual({ type: 'csi-volume-snapshot', csiVolumeSnapshot: { volumeSnapshotClassName: 'fast' } });
  });

  it('a memory snapshot can leave the guest paused', async () => {
    const { d, sent } = open();
    d.backend.set('local');
    d.resumeAfterSnapshot.set(false);
    await d.save();
    expect(sent()!['spec']['includeMemory']).toBe(true);
    expect(sent()!['spec']['resumeAfterSnapshot']).toBe(false);
  });

  it('s3 needs credentials, and a region unless an endpoint is set, as the webhook does', async () => {
    const { d, sent } = open();
    d.backend.set('s3');
    d.s3Bucket.set('backups');
    expect(d.canSave()).toBe(false);
    d.s3Secret.set('s3-creds');
    expect(d.canSave()).toBe(false);
    d.s3Region.set('eu-central-1');
    expect(d.canSave()).toBe(true);
    await d.save();
    expect(sent()!['spec']['backend']['s3']).toEqual({
      bucket: 'backups',
      region: 'eu-central-1',
      credentialsSecretRef: { name: 's3-creds' },
    });
    d.s3Region.set('');
    d.s3Endpoint.set('minio.example:9000');
    expect(d.canSave()).toBe(true);
  });
});

describe('SnapshotDialog oci', () => {
  function withLocations(): { d: SnapshotDialog; sent: () => Obj | undefined } {
    const r = open();
    r.d.locs.set({
      cluster: [{ kind: 'SwiftClusterStorageLocation', name: 'main', namespace: '', isDefault: true, repository: 'reg.example/k' } as any],
      namespaced: [],
      error: '',
    });
    return r;
  }

  it('takes the default location and says where the snapshot goes', async () => {
    const { d, sent } = withLocations();
    d.backend.set('oci');
    expect(d.ociTarget()).toEqual({ where: 'reg.example/k/team-a/snapshots', from: 'SwiftClusterStorageLocation/main', problem: '' });
    await d.save();
    expect(sent()!['spec']['backend']).toEqual({ type: 'oci' });
    expect(sent()!['spec']['resumeAfterSnapshot']).toBe(true);
  });

  it('names a chosen location, and a full-state capture sends no resume', async () => {
    const { d, sent } = withLocations();
    d.backend.set('oci');
    d.ociLocation.set('SwiftClusterStorageLocation/main');
    d.includeDisk.set(true);
    await d.save();
    const spec = sent()!['spec'];
    expect(spec['backend']).toEqual({ type: 'oci', locationRef: { kind: 'SwiftClusterStorageLocation', name: 'main' } });
    expect(spec['includeDisk']).toBe(true);
    expect(spec['resumeAfterSnapshot']).toBeUndefined();
  });

  it('will not create an oci snapshot with nowhere to go', () => {
    const { d } = open();
    d.backend.set('oci');
    expect(d.ociTarget().problem).toContain('NoStorageLocation');
    expect(d.canSave()).toBe(false);
  });
});
