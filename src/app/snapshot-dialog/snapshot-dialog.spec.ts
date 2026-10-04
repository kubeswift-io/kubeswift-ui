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
    expect(spec['includeMemory']).toBeFalse();
    expect(spec['resumeAfterSnapshot']).toBeUndefined();
    expect(spec['backend']).toEqual({ type: 'csi-volume-snapshot', csiVolumeSnapshot: { volumeSnapshotClassName: 'fast' } });
  });

  it('a memory snapshot can leave the guest paused', async () => {
    const { d, sent } = open();
    d.backend.set('local');
    d.resumeAfterSnapshot.set(false);
    await d.save();
    expect(sent()!['spec']['includeMemory']).toBeTrue();
    expect(sent()!['spec']['resumeAfterSnapshot']).toBeFalse();
  });

  it('s3 needs credentials, and a region unless an endpoint is set, as the webhook does', async () => {
    const { d, sent } = open();
    d.backend.set('s3');
    d.s3Bucket.set('backups');
    expect(d.canSave()).toBeFalse();
    d.s3Secret.set('s3-creds');
    expect(d.canSave()).toBeFalse();
    d.s3Region.set('eu-central-1');
    expect(d.canSave()).toBeTrue();
    await d.save();
    expect(sent()!['spec']['backend']['s3']).toEqual({
      bucket: 'backups',
      region: 'eu-central-1',
      credentialsSecretRef: { name: 's3-creds' },
    });
    d.s3Region.set('');
    d.s3Endpoint.set('minio.example:9000');
    expect(d.canSave()).toBeTrue();
  });
});
