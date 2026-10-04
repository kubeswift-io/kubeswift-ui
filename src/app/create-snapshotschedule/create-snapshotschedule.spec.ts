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

  it('keeps an s3 or oci backend it has no editor for', () => {
    const f = form();
    const be = { type: 'oci', locationRef: { name: 'team' } };
    f.hydrate({ spec: { template: { spec: { guestRef: { name: 'web' }, backend: be } } } });
    const out = f.build({ spec: {} }) as Obj;
    expect(out['spec']['template']['spec']['backend']).toEqual(be);
  });
});
