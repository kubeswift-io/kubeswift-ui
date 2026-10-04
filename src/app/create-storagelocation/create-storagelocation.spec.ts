import { TestBed } from '@angular/core/testing';
import { GatewayService } from '../gateway.service';
import { CreateClusterStorageLocation, CreateStorageLocation } from './create-storagelocation';

type Obj = Record<string, any>;

function make<T>(c: new (...a: any[]) => T): T {
  TestBed.configureTestingModule({ imports: [c as any], providers: [{ provide: GatewayService, useValue: {} }] });
  return TestBed.createComponent(c as any).componentInstance as T;
}

describe('storage location forms', () => {
  it('builds a cluster default registry with a named Secret, CA and signing key', () => {
    const f = make(CreateClusterStorageLocation);
    f.name.set('registry');
    f.isDefault.set(true);
    f.repository.set('reg.example/kubeswift');
    f.credentialsSecretName.set('regcreds');
    f.caBundle.set('-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----\n');
    f.signingKeySecretName.set('cosign-key');
    expect(f.canSave()).toBeFalse(); // no cluster yet
    f.cluster.set('c1');
    expect(f.canSave()).toBeTrue();
    const out = f.build({ spec: {} }) as Obj;
    expect(out['spec']).toEqual({
      default: true,
      oci: {
        repository: 'reg.example/kubeswift',
        caBundle: '-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----\n',
        credentialsSecretName: 'regcreds',
        signingKeySecretName: 'cosign-key',
      },
    });
    expect(f.pathExample()).toBe('reg.example/kubeswift/<namespace>/snapshots');
  });

  it('an anonymous registry names no Secret, and the default name is not written', () => {
    const f = make(CreateStorageLocation);
    f.repository.set('reg.example/team');
    f.anonymous.set(true);
    f.credentialsSecretName.set('ignored');
    expect((f.build({ spec: {} }) as Obj)['spec']['oci']).toEqual({ repository: 'reg.example/team', anonymous: true });
    f.anonymous.set(false);
    f.credentialsSecretName.set('');
    expect((f.build({ spec: {} }) as Obj)['spec']['oci']).toEqual({ repository: 'reg.example/team' });
    expect(f.pathExample()).toBe('reg.example/team/snapshots');
  });

  it('a csi-only location, and an edit that keeps what the form has no widget for', () => {
    const f = make(CreateStorageLocation);
    f.hydrate({ spec: { oci: { repository: 'r/x', futureField: 1 }, csi: { volumeSnapshotClassName: 'fast' } } });
    expect(f.useOCI()).toBeTrue();
    expect(f.className()).toBe('fast');
    const kept = f.build({ spec: { oci: { repository: 'r/x', futureField: 1 } } }) as Obj;
    expect(kept['spec']['oci']['futureField']).toBe(1);
    f.useOCI.set(false);
    const out = f.build({ spec: { oci: { repository: 'r/x' } } }) as Obj;
    expect(out['spec']).toEqual({ csi: { volumeSnapshotClassName: 'fast' } });
  });

  it('needs a registry or a class', () => {
    const f = make(CreateStorageLocation);
    f.cluster.set('c1');
    f.namespace.set('team-a');
    f.name.set('x');
    f.useOCI.set(false);
    expect(f.canSave()).toBeFalse();
    f.useCSI.set(true);
    expect(f.canSave()).toBeFalse(); // no class chosen
    f.className.set('fast');
    expect(f.canSave()).toBeTrue();
  });
});
