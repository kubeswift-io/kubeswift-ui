/**
 * Pure PodSpec <-> form-state conversion for the PodTemplate editor.
 *
 * The rule this module exists to enforce: **the editor is authoritative only for
 * the fields it models.** Everything else on the object it loaded has to survive
 * a Form-view save untouched — initContainers, envFrom, capabilities,
 * seccompProfile, affinity, topologySpreadConstraints, extended resources such
 * as nvidia.com/gpu, probe tuning, env valueFrom, volumeMount subPath, and
 * volume types the editor has no widget for.
 *
 * It lives outside the component because the merge is the part worth testing,
 * and it needs no Angular to exercise. See podspec.spec.ts.
 */

export type Obj = Record<string, unknown>;

export const arr = (o: unknown): Obj[] => (Array.isArray(o) ? (o as Obj[]) : []);
export const str = (o: unknown): string => (o == null ? '' : String(o));
export const words = (s: string): string[] => s.split(/\s+/).map((x) => x.trim()).filter(Boolean);

const clone = <T>(o: T): T => (o === undefined ? o : (structuredClone(o) as T));

/**
 * TriState models a Kubernetes optional boolean — unset / true / false — for the
 * fields where "absent" and "false" are NOT the same thing.
 */
export type TriState = '' | 'true' | 'false';

export interface EnvVar { name: string; value: string }
export interface Port { name: string; containerPort: string; protocol: string }
export interface Mount { name: string; mountPath: string; readOnly: boolean }
export interface Probe { type: string; path: string; port: string; command: string }
export interface Container {
  name: string; image: string; command: string; args: string;
  env: EnvVar[]; ports: Port[];
  cpuReq: string; memReq: string; cpuLim: string; memLim: string;
  mounts: Mount[]; liveness: Probe; readiness: Probe; startup: Probe;
  runAsUser: string; runAsNonRoot: boolean; readOnlyRootFs: boolean;
  privileged: boolean; allowPrivEsc: TriState;
  /**
   * raw is the object this row hydrated from — the carrier for every field the
   * editor does not model. undefined for a container added in the UI.
   */
  raw?: Obj;
}
export interface Volume { name: string; type: string; source: string; raw?: Obj }
export interface KV { key: string; value: string }
export interface Toleration { key: string; operator: string; value: string; effect: string }

export const newProbe = (): Probe => ({ type: 'none', path: '/', port: '', command: '' });
export const newContainer = (): Container => ({
  name: '', image: '', command: '', args: '', env: [], ports: [],
  cpuReq: '', memReq: '', cpuLim: '', memLim: '', mounts: [],
  liveness: newProbe(), readiness: newProbe(), startup: newProbe(),
  runAsUser: '', runAsNonRoot: false, readOnlyRootFs: false, privileged: false, allowPrivEsc: '',
});

/**
 * put writes v at key, or DELETES the key when v is "unset" — undefined, an
 * empty array, or an empty object.
 *
 * The delete half is the point. The editor is authoritative for what it models,
 * so clearing a field in the UI has to clear it on the object rather than
 * leaving the loaded value behind.
 */
export function put(o: Obj, key: string, v: unknown): void {
  const unset =
    v === undefined ||
    (Array.isArray(v) && v.length === 0) ||
    (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v as Obj).length === 0);
  if (unset) delete o[key];
  else o[key] = v;
}

// --- probes ---------------------------------------------------------------

const PROBE_HANDLERS = ['httpGet', 'tcpSocket', 'exec', 'grpc'];

export function probeIn(p: unknown): Probe {
  const o = (p ?? null) as Obj | null;
  if (!o) return newProbe();
  if (o['httpGet']) {
    const h = o['httpGet'] as Obj;
    return { type: 'httpGet', path: str(h['path'] || '/'), port: str(h['port']), command: '' };
  }
  if (o['tcpSocket']) return { type: 'tcpSocket', path: '', port: str((o['tcpSocket'] as Obj)['port']), command: '' };
  if (o['exec']) return { type: 'exec', path: '', port: '', command: ((o['exec'] as Obj)['command'] as string[] | undefined)?.join(' ') ?? '' };
  return newProbe();
}

function handlerOut(p: Probe): Obj | null {
  if (p.type === 'httpGet') return { httpGet: { path: p.path.trim() || '/', port: Number(p.port) || p.port.trim() } };
  if (p.type === 'tcpSocket') return { tcpSocket: { port: Number(p.port) || p.port.trim() } };
  if (p.type === 'exec') return words(p.command).length ? { exec: { command: words(p.command) } } : null;
  return null;
}

/**
 * probeOut swaps the handler while preserving the tuning the editor does not
 * model (initialDelaySeconds, periodSeconds, failureThreshold, timeoutSeconds).
 * Returns undefined for type 'none', which drops the probe.
 */
export function probeOut(raw: unknown, p: Probe): Obj | undefined {
  const h = handlerOut(p);
  if (!h) return undefined;
  const o = (clone(raw) ?? {}) as Obj;
  for (const k of PROBE_HANDLERS) delete o[k];
  return Object.assign(o, h);
}

// --- volumes --------------------------------------------------------------

/** The volume source types the editor has a widget for. */
const VOL_KINDS = ['configMap', 'secret', 'persistentVolumeClaim', 'hostPath', 'emptyDir'];
/** The single field inside each recognised source that the editor edits. */
const VOL_SOURCE_FIELD: Record<string, string> = {
  configMap: 'name',
  secret: 'secretName',
  persistentVolumeClaim: 'claimName',
  hostPath: 'path',
};

export function volumeIn(v: Obj): Volume {
  const name = str(v['name']);
  for (const k of VOL_KINDS) {
    if (v[k]) {
      const f = VOL_SOURCE_FIELD[k];
      return { name, type: k, source: f ? str((v[k] as Obj)[f]) : '', raw: v };
    }
  }
  // A source type the editor does not model: csi, projected, downwardAPI, nfs,
  // ephemeral, ... Carry it through verbatim. Rewriting it to emptyDir would
  // keep the name — so every volumeMount still resolves and the pod still
  // starts — while silently swapping real content for an empty tmpdir.
  const other = Object.keys(v).find((k) => k !== 'name');
  if (other) return { name, type: 'other', source: other, raw: v };
  return { name, type: 'emptyDir', source: '', raw: v };
}

export function volumeOut(v: Volume): Obj {
  const name = v.name.trim();
  const raw = (clone(v.raw) ?? {}) as Obj;
  if (v.type === 'other') {
    raw['name'] = name;
    return raw;
  }
  // Keep this source's sub-object so items / defaultMode / hostPath.type /
  // emptyDir.sizeLimit survive, and drop every other source key so that
  // changing the type in the dropdown actually sticks.
  const sub = (raw[v.type] ?? {}) as Obj;
  const f = VOL_SOURCE_FIELD[v.type];
  if (f) sub[f] = v.source.trim();
  return { name, [v.type]: sub };
}

// --- containers -----------------------------------------------------------

export function containerIn(c: Obj): Container {
  const res = (c['resources'] ?? {}) as Obj;
  const req = (res['requests'] ?? {}) as Obj;
  const lim = (res['limits'] ?? {}) as Obj;
  const sc = (c['securityContext'] ?? {}) as Obj;
  const ape = sc['allowPrivilegeEscalation'];
  return {
    name: str(c['name']),
    image: str(c['image']),
    command: (c['command'] as string[] | undefined)?.join(' ') ?? '',
    args: (c['args'] as string[] | undefined)?.join(' ') ?? '',
    env: arr(c['env']).map((e) => ({ name: str(e['name']), value: str(e['value']) })),
    ports: arr(c['ports']).map((p) => ({
      name: str(p['name']), containerPort: str(p['containerPort']), protocol: str(p['protocol'] || 'TCP'),
    })),
    cpuReq: str(req['cpu']), memReq: str(req['memory']),
    cpuLim: str(lim['cpu']), memLim: str(lim['memory']),
    mounts: arr(c['volumeMounts']).map((m) => ({
      name: str(m['name']), mountPath: str(m['mountPath']), readOnly: m['readOnly'] === true,
    })),
    liveness: probeIn(c['livenessProbe']),
    readiness: probeIn(c['readinessProbe']),
    startup: probeIn(c['startupProbe']),
    runAsUser: str(sc['runAsUser']),
    runAsNonRoot: sc['runAsNonRoot'] === true,
    readOnlyRootFs: sc['readOnlyRootFilesystem'] === true,
    privileged: sc['privileged'] === true,
    allowPrivEsc: ape === true ? 'true' : ape === false ? 'false' : '',
    raw: c,
  };
}

/**
 * envOut merges the edited name/value rows onto the loaded entries so that a var
 * sourced from a Secret or ConfigMap (valueFrom) is not replaced by an empty
 * literal. Typing a value deliberately replaces the reference; leaving the box
 * as loaded keeps it.
 */
function envOut(raw: Obj[], rows: EnvVar[]): Obj[] {
  return rows.filter((e) => e.name.trim()).map((e) => {
    const name = e.name.trim();
    const eo = (clone(raw.find((x) => str(x['name']) === name)) ?? {}) as Obj;
    eo['name'] = name;
    if (e.value !== '') {
      delete eo['valueFrom']; // value and valueFrom are mutually exclusive
      eo['value'] = e.value;
    } else if (eo['valueFrom'] === undefined) {
      eo['value'] = e.value;
    }
    return eo;
  });
}

/** portsOut preserves hostPort / hostIP on ports the editor round-trips. */
function portsOut(raw: Obj[], rows: Port[]): Obj[] {
  return rows.filter((p) => p.containerPort.trim()).map((p) => {
    const num = Number(p.containerPort) || 0;
    const po = (clone(raw.find((x) => Number(x['containerPort']) === num)) ?? {}) as Obj;
    po['containerPort'] = num;
    po['protocol'] = p.protocol || 'TCP';
    put(po, 'name', p.name.trim() || undefined);
    return po;
  });
}

/** mountsOut preserves subPath / mountPropagation, which change what is mounted. */
function mountsOut(raw: Obj[], rows: Mount[]): Obj[] {
  return rows.filter((m) => m.name.trim() && m.mountPath.trim()).map((m) => {
    const name = m.name.trim(), mountPath = m.mountPath.trim();
    const mo = (clone(raw.find((x) => str(x['name']) === name && str(x['mountPath']) === mountPath)) ?? {}) as Obj;
    mo['name'] = name;
    mo['mountPath'] = mountPath;
    put(mo, 'readOnly', m.readOnly || undefined);
    return mo;
  });
}

/**
 * resourcesOut merges cpu/memory onto the loaded maps. Extended resources —
 * nvidia.com/gpu, ephemeral-storage, hugepages-* — live in the same two maps and
 * are not modelled here, so they must not be rebuilt away.
 */
function resourcesOut(res: Obj, c: Container): Obj {
  const buckets: [string, string, string][] = [
    ['requests', c.cpuReq, c.memReq],
    ['limits', c.cpuLim, c.memLim],
  ];
  for (const [bucket, cpu, mem] of buckets) {
    const m = (res[bucket] ?? {}) as Obj;
    put(m, 'cpu', cpu.trim() || undefined);
    put(m, 'memory', mem.trim() || undefined);
    put(res, bucket, m);
  }
  return res;
}

function securityContextOut(sc: Obj, c: Container): Obj {
  put(sc, 'runAsUser', c.runAsUser.trim() ? Number(c.runAsUser) || 0 : undefined);
  put(sc, 'runAsNonRoot', c.runAsNonRoot || undefined);
  put(sc, 'readOnlyRootFilesystem', c.readOnlyRootFs || undefined);
  put(sc, 'privileged', c.privileged || undefined);
  // allowPrivilegeEscalation is TRI-STATE deliberately. It is the one field here
  // whose hardened value is `false` while its default when absent is `true`, so
  // treating "unchecked" as "omit" silently re-enables privilege escalation on
  // every save — and `false` is mandatory under the restricted Pod Security
  // Standard. The other three are safe to omit when off: their hardened value
  // is `true` and absent means the permissive default either way.
  put(sc, 'allowPrivilegeEscalation', c.allowPrivEsc === '' ? undefined : c.allowPrivEsc === 'true');
  return sc;
}

export function containerOut(c: Container): Obj {
  const o = (clone(c.raw) ?? {}) as Obj;
  o['name'] = c.name.trim() || 'main';
  o['image'] = c.image.trim();
  put(o, 'command', words(c.command));
  put(o, 'args', words(c.args));
  put(o, 'env', envOut(arr(o['env']), c.env));
  put(o, 'ports', portsOut(arr(o['ports']), c.ports));
  put(o, 'resources', resourcesOut((o['resources'] ?? {}) as Obj, c));
  put(o, 'volumeMounts', mountsOut(arr(o['volumeMounts']), c.mounts));
  put(o, 'livenessProbe', probeOut(o['livenessProbe'], c.liveness));
  put(o, 'readinessProbe', probeOut(o['readinessProbe'], c.readiness));
  put(o, 'startupProbe', probeOut(o['startupProbe'], c.startup));
  put(o, 'securityContext', securityContextOut((o['securityContext'] ?? {}) as Obj, c));
  return o;
}

// --- pod spec -------------------------------------------------------------

export interface PodParts {
  containers: Container[];
  volumes: Volume[];
  nodeSelector: KV[];
  tolerations: Toleration[];
  serviceAccountName: string;
  restartPolicy: string;
  imagePullSecrets: string[];
  fsGroup: string;
  podRunAsUser: string;
  podRunAsNonRoot: boolean;
}

/**
 * podSpecOut merges the edited fields onto the PodSpec the editor loaded. base
 * is that original spec; everything it holds that the editor does not model
 * rides through untouched.
 */
export function podSpecOut(base: Obj, p: PodParts): Obj {
  const spec = (clone(base) ?? {}) as Obj;

  const containers = p.containers.filter((c) => c.image.trim() || c.name.trim()).map(containerOut);
  spec['containers'] = containers.length ? containers : [{ name: 'main', image: '' }];

  put(spec, 'volumes', p.volumes.filter((v) => v.name.trim()).map(volumeOut));

  const nsel: Record<string, string> = {};
  for (const kv of p.nodeSelector) if (kv.key.trim()) nsel[kv.key.trim()] = kv.value;
  put(spec, 'nodeSelector', nsel);

  put(spec, 'tolerations', p.tolerations.filter((t) => t.key.trim() || t.operator === 'Exists').map((t) => ({
    ...(t.key.trim() ? { key: t.key.trim() } : {}), operator: t.operator,
    ...(t.value.trim() ? { value: t.value.trim() } : {}), ...(t.effect ? { effect: t.effect } : {}),
  })));

  put(spec, 'serviceAccountName', p.serviceAccountName.trim() || undefined);
  put(spec, 'restartPolicy', p.restartPolicy || undefined);
  put(spec, 'imagePullSecrets', p.imagePullSecrets.map((s) => s.trim()).filter(Boolean).map((name) => ({ name })));

  const psc = (spec['securityContext'] ?? {}) as Obj;
  put(psc, 'fsGroup', p.fsGroup.trim() ? Number(p.fsGroup) || 0 : undefined);
  put(psc, 'runAsUser', p.podRunAsUser.trim() ? Number(p.podRunAsUser) || 0 : undefined);
  put(psc, 'runAsNonRoot', p.podRunAsNonRoot || undefined);
  put(spec, 'securityContext', psc);

  return spec;
}
