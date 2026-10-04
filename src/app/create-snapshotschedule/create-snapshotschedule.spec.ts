import { TestBed } from '@angular/core/testing';
import { GatewayService } from '../gateway.service';
import { CreateSnapshotSchedule } from './create-snapshotschedule';

type Obj = Record<string, any>;

describe('CreateSnapshotSchedule', () => {
  function form(): CreateSnapshotSchedule {
    TestBed.configureTestingModule({
      imports: [CreateSnapshotSchedule],
      providers: [{ provide: GatewayService, useValue: {} }],
    });
    return TestBed.createComponent(CreateSnapshotSchedule).componentInstance;
  }

  // The schedule webhook refuses a template hostPath: every snapshot of the
  // schedule would share the directory.
  it('a local backend sends no hostPath, even one loaded from an older schedule', () => {
    const f = form();
    f.hydrate({
      spec: {
        schedule: '0 2 * * *',
        template: { spec: { guestRef: { name: 'web' }, backend: { type: 'local', local: { hostPath: '/var/lib/kubeswift/snapshots/a-b' } } } },
      },
    });
    const out = f.build({ spec: {} }) as Obj;
    expect(out['spec']['template']['spec']['backend']).toEqual({ type: 'local' });
    expect(out['spec']['template']['spec']['guestRef']).toEqual({ name: 'web' });
  });

  it('keeps an s3 backend it has no editor for', () => {
    const f = form();
    const be = { type: 's3', s3: { bucket: 'b', region: 'eu-central-1', credentialsSecretRef: { name: 'c' } } };
    f.hydrate({ spec: { template: { spec: { guestRef: { name: 'web' }, backend: be } } } });
    const out = f.build({ spec: {} }) as Obj;
    expect(out['spec']['template']['spec']['backend']).toEqual(be);
  });
});

describe('CreateSnapshotSchedule oci', () => {
  function form(): CreateSnapshotSchedule {
    TestBed.configureTestingModule({
      imports: [CreateSnapshotSchedule],
      providers: [{ provide: GatewayService, useValue: {} }],
    });
    return TestBed.createComponent(CreateSnapshotSchedule).componentInstance;
  }

  it('edits an oci schedule that stores through a location', () => {
    const f = form();
    f.hydrate({ spec: { template: { spec: { guestRef: { name: 'web' }, backend: { type: 'oci', locationRef: { kind: 'SwiftStorageLocation', name: 'team' } } } } } });
    expect(f.backend()).toBe('oci');
    expect(f.ociLocation()).toBe('SwiftStorageLocation/team');
    f.ociLocation.set('');
    const out = f.build({ spec: {} }) as Obj;
    expect(out['spec']['template']['spec']['backend']).toEqual({ type: 'oci' });
    expect(out['spec']['template']['spec']['includeMemory']).toBe(true);
  });

  it('still preserves an oci backend that names its own registry', () => {
    const f = form();
    const be = { type: 'oci', oci: { repository: 'reg.example/vm' } };
    f.hydrate({ spec: { template: { spec: { guestRef: { name: 'web' }, backend: be } } } });
    expect(f.backend()).toBe('other');
    expect((f.build({ spec: {} }) as Obj)['spec']['template']['spec']['backend']).toEqual(be);
  });
});
