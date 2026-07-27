import {
  arr, containerIn, podSpecOut, str, volumeIn,
  type Obj, type PodParts,
} from './podspec';

/**
 * roundTrip mirrors what PodTemplate does: hydrate a PodSpec into form state,
 * optionally edit a field the way an operator would, then save. Every test here
 * asserts on what a Form-view save actually sends to the apiserver.
 */
function roundTrip(spec: Obj, edit: (p: PodParts) => void = () => undefined): Obj {
  const sc = (spec['securityContext'] ?? {}) as Obj;
  const parts: PodParts = {
    containers: arr(spec['containers']).map(containerIn),
    volumes: arr(spec['volumes']).map(volumeIn),
    nodeSelector: Object.entries((spec['nodeSelector'] ?? {}) as Obj).map(([key, value]) => ({ key, value: str(value) })),
    tolerations: arr(spec['tolerations']).map((t) => ({
      key: str(t['key']), operator: str(t['operator'] || 'Equal'), value: str(t['value']), effect: str(t['effect']),
    })),
    serviceAccountName: str(spec['serviceAccountName']),
    restartPolicy: str(spec['restartPolicy']),
    imagePullSecrets: arr(spec['imagePullSecrets']).map((s) => str(s['name'])),
    fsGroup: str(sc['fsGroup']),
    podRunAsUser: str(sc['runAsUser']),
    podRunAsNonRoot: sc['runAsNonRoot'] === true,
  };
  edit(parts);
  return podSpecOut(spec, parts);
}

const c0 = (spec: Obj): Obj => arr(spec['containers'])[0];
const sc0 = (spec: Obj): Obj => (c0(spec)['securityContext'] ?? {}) as Obj;

describe('podspec: allowPrivilegeEscalation is tri-state', () => {
  // This is the one securityContext field whose HARDENED value is `false` and
  // whose default when absent is `true`. Collapsing it to "emit only when true"
  // silently re-enabled escalation on every save.
  it('preserves an explicit false through an unrelated edit', () => {
    const spec: Obj = {
      containers: [{ name: 'app', image: 'app:1', securityContext: { allowPrivilegeEscalation: false } }],
    };
    const out = roundTrip(spec, (p) => { p.containers[0].image = 'app:2'; });
    expect(sc0(out)['allowPrivilegeEscalation']).toBe(false);
    expect(c0(out)['image']).toBe('app:2');
  });

  it('can author false on a container that had no securityContext', () => {
    const spec: Obj = { containers: [{ name: 'app', image: 'app:1' }] };
    const out = roundTrip(spec, (p) => { p.containers[0].allowPrivEsc = 'false'; });
    expect(sc0(out)['allowPrivilegeEscalation']).toBe(false);
  });

  it('emits nothing when left unset', () => {
    const spec: Obj = { containers: [{ name: 'app', image: 'app:1' }] };
    const out = roundTrip(spec);
    expect(sc0(out)['allowPrivilegeEscalation']).toBeUndefined();
  });

  it('preserves an explicit true', () => {
    const spec: Obj = {
      containers: [{ name: 'app', image: 'app:1', securityContext: { allowPrivilegeEscalation: true } }],
    };
    expect(sc0(roundTrip(spec))['allowPrivilegeEscalation']).toBe(true);
  });
});

describe('podspec: unmodelled fields survive a Form-view save', () => {
  it('keeps pod-level hardening the editor has no widget for', () => {
    const spec: Obj = {
      automountServiceAccountToken: false,
      priorityClassName: 'system-cluster-critical',
      initContainers: [{ name: 'bootstrap', image: 'init:1' }],
      affinity: { nodeAffinity: { requiredDuringSchedulingIgnoredDuringExecution: {} } },
      topologySpreadConstraints: [{ maxSkew: 1, topologyKey: 'zone' }],
      securityContext: { seccompProfile: { type: 'RuntimeDefault' }, fsGroup: 2000 },
      containers: [{ name: 'app', image: 'app:1' }],
    };
    const out = roundTrip(spec, (p) => { p.containers[0].image = 'app:2'; });
    expect(out['automountServiceAccountToken']).toBe(false);
    expect(out['priorityClassName']).toBe('system-cluster-critical');
    expect(arr(out['initContainers']).length).toBe(1);
    expect(out['affinity']).toBeDefined();
    expect(arr(out['topologySpreadConstraints']).length).toBe(1);
    expect(((out['securityContext'] as Obj)['seccompProfile'] as Obj)['type']).toBe('RuntimeDefault');
    expect((out['securityContext'] as Obj)['fsGroup']).toBe(2000);
  });

  it('keeps container-level hardening and lifecycle', () => {
    const spec: Obj = {
      containers: [{
        name: 'app', image: 'app:1',
        imagePullPolicy: 'Always',
        workingDir: '/srv',
        envFrom: [{ secretRef: { name: 'app-config' } }],
        lifecycle: { preStop: { exec: { command: ['/bin/drain'] } } },
        securityContext: {
          capabilities: { drop: ['ALL'] },
          seccompProfile: { type: 'RuntimeDefault' },
        },
      }],
    };
    const out = roundTrip(spec, (p) => { p.containers[0].image = 'app:2'; });
    const c = c0(out);
    expect(c['imagePullPolicy']).toBe('Always');
    expect(c['workingDir']).toBe('/srv');
    expect(arr(c['envFrom']).length).toBe(1);
    expect(c['lifecycle']).toBeDefined();
    expect(((sc0(out)['capabilities'] as Obj)['drop'] as string[])).toEqual(['ALL']);
    expect((sc0(out)['seccompProfile'] as Obj)['type']).toBe('RuntimeDefault');
  });

  it('keeps extended resources that share the requests/limits maps', () => {
    const spec: Obj = {
      containers: [{
        name: 'app', image: 'app:1',
        resources: {
          limits: { 'nvidia.com/gpu': 1, memory: '4Gi' },
          requests: { 'ephemeral-storage': '2Gi', cpu: '500m' },
        },
      }],
    };
    const out = roundTrip(spec, (p) => { p.containers[0].memLim = '8Gi'; });
    const res = c0(out)['resources'] as Obj;
    expect((res['limits'] as Obj)['nvidia.com/gpu']).toBe(1);
    expect((res['limits'] as Obj)['memory']).toBe('8Gi');
    expect((res['requests'] as Obj)['ephemeral-storage']).toBe('2Gi');
  });

  it('keeps an env var sourced from a Secret instead of blanking it', () => {
    const spec: Obj = {
      containers: [{
        name: 'app', image: 'app:1',
        env: [
          { name: 'DB_PASSWORD', valueFrom: { secretKeyRef: { name: 'db', key: 'password' } } },
          { name: 'LOG_LEVEL', value: 'info' },
        ],
      }],
    };
    const out = roundTrip(spec, (p) => { p.containers[0].image = 'app:2'; });
    const env = arr(c0(out)['env']);
    expect(env[0]['valueFrom']).toBeDefined();
    expect(env[0]['value']).toBeUndefined();
    expect(env[1]['value']).toBe('info');
  });

  it('lets a typed value deliberately replace a valueFrom reference', () => {
    const spec: Obj = {
      containers: [{ name: 'app', image: 'app:1', env: [{ name: 'MODE', valueFrom: { fieldRef: { fieldPath: 'metadata.name' } } }] }],
    };
    const out = roundTrip(spec, (p) => { p.containers[0].env[0].value = 'literal'; });
    const env = arr(c0(out)['env']);
    expect(env[0]['value']).toBe('literal');
    expect(env[0]['valueFrom']).toBeUndefined();
  });

  it('keeps volumeMount subPath, which decides what is actually mounted', () => {
    const spec: Obj = {
      containers: [{
        name: 'app', image: 'app:1',
        volumeMounts: [{ name: 'cfg', mountPath: '/etc/app/config.yaml', subPath: 'config.yaml' }],
      }],
    };
    const out = roundTrip(spec, (p) => { p.containers[0].image = 'app:2'; });
    expect(arr(c0(out)['volumeMounts'])[0]['subPath']).toBe('config.yaml');
  });

  it('keeps probe tuning when the handler is edited', () => {
    const spec: Obj = {
      containers: [{
        name: 'app', image: 'app:1',
        livenessProbe: {
          httpGet: { path: '/healthz', port: 8080 },
          initialDelaySeconds: 30, periodSeconds: 15, failureThreshold: 6,
        },
      }],
    };
    const out = roundTrip(spec, (p) => { p.containers[0].liveness.path = '/livez'; });
    const lp = c0(out)['livenessProbe'] as Obj;
    expect((lp['httpGet'] as Obj)['path']).toBe('/livez');
    expect(lp['initialDelaySeconds']).toBe(30);
    expect(lp['periodSeconds']).toBe(15);
    expect(lp['failureThreshold']).toBe(6);
  });
});

describe('podspec: volumes', () => {
  it('does not rewrite an unmodelled volume type to emptyDir', () => {
    // The dangerous shape: the name survives so every volumeMount still
    // resolves and the pod starts clean — with an empty tmpdir where the
    // credentials used to be.
    const spec: Obj = {
      containers: [{ name: 'app', image: 'app:1' }],
      volumes: [
        { name: 'creds', csi: { driver: 'secrets-store.csi.k8s.io', volumeAttributes: { secretProviderClass: 'vault' } } },
        { name: 'token', projected: { sources: [{ serviceAccountToken: { path: 'token' } }] } },
      ],
    };
    const out = roundTrip(spec, (p) => { p.containers[0].image = 'app:2'; });
    const vols = arr(out['volumes']);
    expect((vols[0]['csi'] as Obj)['driver']).toBe('secrets-store.csi.k8s.io');
    expect(vols[0]['emptyDir']).toBeUndefined();
    expect(vols[1]['projected']).toBeDefined();
    expect(vols[1]['emptyDir']).toBeUndefined();
  });

  it('keeps sub-fields of a recognised volume source', () => {
    const spec: Obj = {
      containers: [{ name: 'app', image: 'app:1' }],
      volumes: [
        { name: 'cfg', configMap: { name: 'app-cfg', items: [{ key: 'a', path: 'a.conf' }], defaultMode: 420 } },
        { name: 'hp', hostPath: { path: '/data', type: 'Directory' } },
        { name: 'scratch', emptyDir: { medium: 'Memory', sizeLimit: '1Gi' } },
      ],
    };
    const out = roundTrip(spec);
    const vols = arr(out['volumes']);
    expect(arr((vols[0]['configMap'] as Obj)['items']).length).toBe(1);
    expect((vols[0]['configMap'] as Obj)['defaultMode']).toBe(420);
    expect((vols[1]['hostPath'] as Obj)['type']).toBe('Directory');
    expect((vols[2]['emptyDir'] as Obj)['medium']).toBe('Memory');
  });

  it('drops the old source key when the type is changed', () => {
    const spec: Obj = {
      containers: [{ name: 'app', image: 'app:1' }],
      volumes: [{ name: 'v', configMap: { name: 'cfg' } }],
    };
    const out = roundTrip(spec, (p) => { p.volumes[0].type = 'secret'; p.volumes[0].source = 'sec'; });
    const v = arr(out['volumes'])[0];
    expect(v['configMap']).toBeUndefined();
    expect((v['secret'] as Obj)['secretName']).toBe('sec');
  });
});

describe('podspec: the editor stays authoritative for what it models', () => {
  it('deletes a field the operator cleared', () => {
    const spec: Obj = {
      serviceAccountName: 'app-sa',
      containers: [{ name: 'app', image: 'app:1', resources: { limits: { memory: '4Gi' } } }],
    };
    const out = roundTrip(spec, (p) => {
      p.serviceAccountName = '';
      p.containers[0].memLim = '';
    });
    expect(out['serviceAccountName']).toBeUndefined();
    expect(c0(out)['resources']).toBeUndefined();
  });

  it('removes a volume the operator deleted', () => {
    const spec: Obj = {
      containers: [{ name: 'app', image: 'app:1' }],
      volumes: [{ name: 'a', emptyDir: {} }, { name: 'b', emptyDir: {} }],
    };
    const out = roundTrip(spec, (p) => { p.volumes = p.volumes.filter((v) => v.name !== 'a'); });
    expect(arr(out['volumes']).length).toBe(1);
    expect(arr(out['volumes'])[0]['name']).toBe('b');
  });

  it('drops a probe switched to none, and unchecking readOnly sticks', () => {
    const spec: Obj = {
      containers: [{
        name: 'app', image: 'app:1',
        livenessProbe: { httpGet: { path: '/', port: 80 }, initialDelaySeconds: 5 },
        volumeMounts: [{ name: 'v', mountPath: '/m', readOnly: true }],
      }],
    };
    const out = roundTrip(spec, (p) => {
      p.containers[0].liveness.type = 'none';
      p.containers[0].mounts[0].readOnly = false;
    });
    expect(c0(out)['livenessProbe']).toBeUndefined();
    expect(arr(c0(out)['volumeMounts'])[0]['readOnly']).toBeUndefined();
  });

  it('does not mutate the spec it was given', () => {
    const spec: Obj = { containers: [{ name: 'app', image: 'app:1' }] };
    roundTrip(spec, (p) => { p.containers[0].image = 'app:2'; });
    expect(c0(spec)['image']).toBe('app:1');
  });
});
