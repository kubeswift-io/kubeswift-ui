import { describeSource } from './image-drawer';

describe('ImageDrawer describeSource', () => {
  it('shows an HTTP URL', () => {
    expect(describeSource({ http: { url: 'https://x/img.qcow2' } }, 'ns')).toBe('HTTP: https://x/img.qcow2');
  });

  it('shows an OCI source by tag or digest, and how it is pulled', () => {
    expect(describeSource({ oci: { repository: 'r.example/vm', tag: 'v1' } }, 'ns')).toBe('OCI: r.example/vm:v1');
    expect(
      describeSource(
        {
          oci: {
            repository: 'r.example/vm',
            digest: 'sha256:abc',
            insecure: true,
            credentialsSecretRef: { name: 'regcreds' },
            verifyKeySecretRef: { name: 'cosign-pub' },
          },
        },
        'ns',
      ),
    ).toBe('OCI: r.example/vm@sha256:abc (signature verified with cosign-pub, credentials regcreds, plain HTTP)');
  });

  it('does not invent a tag the import would not use', () => {
    expect(describeSource({ oci: { repository: 'r.example/vm' } }, 'ns')).toContain('no tag or digest');
  });

  it('shows a PVC clone by the API fields, defaulting to the image namespace', () => {
    expect(describeSource({ pvcClone: { name: 'base' } }, 'team-a')).toBe('PVC clone: team-a/base');
    expect(describeSource({ pvcClone: { name: 'base', namespace: 'golden' } }, 'team-a')).toBe('PVC clone: golden/base');
  });

  it('shows a dash for no source', () => {
    expect(describeSource(undefined, 'ns')).toBe('—');
  });
});
