import { TestBed } from '@angular/core/testing';
import { GatewayService } from '../gateway.service';
import { CreateImage } from './create-image';

type Obj = Record<string, any>;

function make(): CreateImage {
  TestBed.configureTestingModule({
    imports: [CreateImage],
    providers: [{ provide: GatewayService, useValue: {} }],
  });
  return TestBed.createComponent(CreateImage).componentInstance;
}

describe('image form OCI source', () => {
  it('writes digest, credentials and verify key, and clears them when emptied', () => {
    const f = make();
    f.cluster.set('c1');
    f.name.set('noble');
    f.selectSrc('oci');
    f.ociRepo.set('reg.example/golden');
    f.ociDigest.set('sha256:' + 'a'.repeat(64));
    f.ociCredentials.set('regcreds');
    f.ociVerifyKey.set('cosign-pub');
    expect(f.canSave()).toBe(true);
    expect((f.build({ spec: {} }) as Obj)['spec']['source']).toEqual({
      oci: {
        repository: 'reg.example/golden',
        digest: 'sha256:' + 'a'.repeat(64),
        credentialsSecretRef: { name: 'regcreds' },
        verifyKeySecretRef: { name: 'cosign-pub' },
      },
    });
    f.ociDigest.set('');
    f.ociCredentials.set('');
    f.ociVerifyKey.set('');
    f.ociTag.set('v1');
    expect((f.build({ spec: {} }) as Obj)['spec']['source']).toEqual({
      oci: { repository: 'reg.example/golden', tag: 'v1' },
    });
  });

  it('round-trips a loaded OCI source, keeping fields it does not model', () => {
    const f = make();
    const oci = {
      repository: 'reg.example/golden',
      digest: 'sha256:' + 'b'.repeat(64),
      credentialsSecretRef: { name: 'regcreds' },
      verifyKeySecretRef: { name: 'cosign-pub' },
      futureField: 'kept',
    };
    f.hydrate({ spec: { source: { oci }, format: 'raw' } });
    expect(f.ociDigest()).toBe(oci.digest);
    expect(f.ociVerifyKey()).toBe('cosign-pub');
    expect((f.build({ spec: {} }) as Obj)['spec']['source']).toEqual({ oci });
  });

  it('refuses what admission refuses: tag with digest, verify key over plaintext', () => {
    const f = make();
    f.cluster.set('c1');
    f.name.set('noble');
    f.selectSrc('oci');
    f.ociRepo.set('reg.example/golden');
    f.ociTag.set('v1');
    f.ociDigest.set('sha256:' + 'c'.repeat(64));
    expect(f.canSave()).toBe(false);
    f.ociTag.set('');
    expect(f.canSave()).toBe(true);
    f.ociVerifyKey.set('cosign-pub');
    f.ociInsecure.set(true);
    expect(f.ociProblem()).toContain('TLS registry');
    expect(f.canSave()).toBe(false);
    f.ociInsecure.set(false);
    f.ociDigest.set('not-a-digest');
    expect(f.canSave()).toBe(false);
  });
});
