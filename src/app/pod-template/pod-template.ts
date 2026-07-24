import { Component, computed, effect, input, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

type Obj = Record<string, unknown>;
const arr = (o: unknown): Obj[] => (Array.isArray(o) ? (o as Obj[]) : []);
const str = (o: unknown): string => (o == null ? '' : String(o));
const csv = (s: string): string[] => s.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
const words = (s: string): string[] => s.split(/\s+/).map((x) => x.trim()).filter(Boolean);

interface EnvVar { name: string; value: string }
interface Port { name: string; containerPort: string; protocol: string }
interface Mount { name: string; mountPath: string; readOnly: boolean }
interface Probe { type: string; path: string; port: string; command: string }
interface Container {
  name: string; image: string; command: string; args: string;
  env: EnvVar[]; ports: Port[];
  cpuReq: string; memReq: string; cpuLim: string; memLim: string;
  mounts: Mount[]; liveness: Probe; readiness: Probe; startup: Probe;
  runAsUser: string; runAsNonRoot: boolean; readOnlyRootFs: boolean;
  privileged: boolean; allowPrivEsc: boolean;
}
interface Volume { name: string; type: string; source: string }
interface KV { key: string; value: string }
interface Toleration { key: string; operator: string; value: string; effect: string }

const newProbe = (): Probe => ({ type: 'none', path: '/', port: '', command: '' });
const newContainer = (): Container => ({
  name: '', image: '', command: '', args: '', env: [], ports: [],
  cpuReq: '', memReq: '', cpuLim: '', memLim: '', mounts: [],
  liveness: newProbe(), readiness: newProbe(), startup: newProbe(),
  runAsUser: '', runAsNonRoot: false, readOnlyRootFs: false, privileged: false, allowPrivEsc: false,
});

/**
 * PodTemplate is the rich, presentational editor for a Kubernetes PodSpec — the
 * shared body of every workload form (Deployment/STS/DS/RS/Job/CronJob). It
 * hydrates from a PodSpec via [value] and exposes snapshot() (the current
 * PodSpec) + valid() to the host form, which threads it in/out at the kind's
 * template path. Anything it doesn't model rides along via the Form/YAML toggle.
 */
@Component({
  selector: 'app-pod-template',
  imports: [MatIconModule],
  templateUrl: './pod-template.html',
  styleUrl: '../wizard.scss',
})
export class PodTemplate {
  readonly value = input<Obj>({});

  readonly containers = signal<Container[]>([newContainer()]);
  readonly volumes = signal<Volume[]>([]);
  readonly nodeSelector = signal<KV[]>([]);
  readonly tolerations = signal<Toleration[]>([]);
  readonly serviceAccountName = signal('');
  readonly restartPolicy = signal('');
  readonly imagePullSecrets = signal<string[]>([]);
  readonly fsGroup = signal('');
  readonly podRunAsUser = signal('');
  readonly podRunAsNonRoot = signal(false);

  readonly valid = computed(() => this.containers().some((c) => c.image.trim()));

  constructor() {
    // Re-hydrate whenever the host swaps in a new PodSpec (edit load, YAML→Form).
    effect(() => this.hydrate(this.value()));
  }

  private hydrate(spec: Obj): void {
    const cs = arr(spec['containers']).map((c): Container => {
      const res = (c['resources'] ?? {}) as Obj;
      const req = (res['requests'] ?? {}) as Obj;
      const lim = (res['limits'] ?? {}) as Obj;
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
        liveness: this.probeIn(c['livenessProbe']),
        readiness: this.probeIn(c['readinessProbe']),
        startup: this.probeIn(c['startupProbe']),
        runAsUser: str((c['securityContext'] as Obj)?.['runAsUser']),
        runAsNonRoot: (c['securityContext'] as Obj)?.['runAsNonRoot'] === true,
        readOnlyRootFs: (c['securityContext'] as Obj)?.['readOnlyRootFilesystem'] === true,
        privileged: (c['securityContext'] as Obj)?.['privileged'] === true,
        allowPrivEsc: (c['securityContext'] as Obj)?.['allowPrivilegeEscalation'] === true,
      };
    });
    this.containers.set(cs.length ? cs : [newContainer()]);
    this.volumes.set(arr(spec['volumes']).map((v) => this.volumeIn(v)));
    const ns = (spec['nodeSelector'] ?? {}) as Record<string, unknown>;
    this.nodeSelector.set(Object.entries(ns).map(([key, value]) => ({ key, value: str(value) })));
    this.tolerations.set(arr(spec['tolerations']).map((t) => ({
      key: str(t['key']), operator: str(t['operator'] || 'Equal'), value: str(t['value']), effect: str(t['effect']),
    })));
    this.serviceAccountName.set(str(spec['serviceAccountName']));
    this.restartPolicy.set(str(spec['restartPolicy']));
    this.imagePullSecrets.set(arr(spec['imagePullSecrets']).map((s) => str(s['name'])));
    const sc = (spec['securityContext'] ?? {}) as Obj;
    this.fsGroup.set(str(sc['fsGroup']));
    this.podRunAsUser.set(str(sc['runAsUser']));
    this.podRunAsNonRoot.set(sc['runAsNonRoot'] === true);
  }

  private probeIn(p: unknown): Probe {
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
  private volumeIn(v: Obj): Volume {
    if (v['configMap']) return { name: str(v['name']), type: 'configMap', source: str((v['configMap'] as Obj)['name']) };
    if (v['secret']) return { name: str(v['name']), type: 'secret', source: str((v['secret'] as Obj)['secretName']) };
    if (v['persistentVolumeClaim']) return { name: str(v['name']), type: 'persistentVolumeClaim', source: str((v['persistentVolumeClaim'] as Obj)['claimName']) };
    if (v['hostPath']) return { name: str(v['name']), type: 'hostPath', source: str((v['hostPath'] as Obj)['path']) };
    return { name: str(v['name']), type: 'emptyDir', source: '' };
  }

  /** snapshot builds the current PodSpec; empty fields are omitted. */
  snapshot(): Obj {
    const containers = this.containers()
      .filter((c) => c.image.trim() || c.name.trim())
      .map((c) => {
        const o: Obj = { name: c.name.trim() || 'main', image: c.image.trim() };
        if (words(c.command).length) o['command'] = words(c.command);
        if (words(c.args).length) o['args'] = words(c.args);
        const env = c.env.filter((e) => e.name.trim()).map((e) => ({ name: e.name.trim(), value: e.value }));
        if (env.length) o['env'] = env;
        const ports = c.ports.filter((p) => p.containerPort.trim()).map((p) => {
          const po: Obj = { containerPort: Number(p.containerPort) || 0, protocol: p.protocol || 'TCP' };
          if (p.name.trim()) po['name'] = p.name.trim();
          return po;
        });
        if (ports.length) o['ports'] = ports;
        const req: Obj = {}, lim: Obj = {};
        if (c.cpuReq.trim()) req['cpu'] = c.cpuReq.trim();
        if (c.memReq.trim()) req['memory'] = c.memReq.trim();
        if (c.cpuLim.trim()) lim['cpu'] = c.cpuLim.trim();
        if (c.memLim.trim()) lim['memory'] = c.memLim.trim();
        const res: Obj = {};
        if (Object.keys(req).length) res['requests'] = req;
        if (Object.keys(lim).length) res['limits'] = lim;
        if (Object.keys(res).length) o['resources'] = res;
        const mounts = c.mounts.filter((m) => m.name.trim() && m.mountPath.trim()).map((m) => ({
          name: m.name.trim(), mountPath: m.mountPath.trim(), ...(m.readOnly ? { readOnly: true } : {}),
        }));
        if (mounts.length) o['volumeMounts'] = mounts;
        const lp = this.probeOut(c.liveness); if (lp) o['livenessProbe'] = lp;
        const rp = this.probeOut(c.readiness); if (rp) o['readinessProbe'] = rp;
        const sp = this.probeOut(c.startup); if (sp) o['startupProbe'] = sp;
        const sc: Obj = {};
        if (c.runAsUser.trim()) sc['runAsUser'] = Number(c.runAsUser) || 0;
        if (c.runAsNonRoot) sc['runAsNonRoot'] = true;
        if (c.readOnlyRootFs) sc['readOnlyRootFilesystem'] = true;
        if (c.privileged) sc['privileged'] = true;
        if (c.allowPrivEsc) sc['allowPrivilegeEscalation'] = true;
        if (Object.keys(sc).length) o['securityContext'] = sc;
        return o;
      });
    const spec: Obj = { containers: containers.length ? containers : [{ name: 'main', image: '' }] };
    const vols = this.volumes().filter((v) => v.name.trim()).map((v) => this.volumeOut(v));
    if (vols.length) spec['volumes'] = vols;
    const nsel: Record<string, string> = {};
    for (const kv of this.nodeSelector()) if (kv.key.trim()) nsel[kv.key.trim()] = kv.value;
    if (Object.keys(nsel).length) spec['nodeSelector'] = nsel;
    const tols = this.tolerations().filter((t) => t.key.trim() || t.operator === 'Exists').map((t) => ({
      ...(t.key.trim() ? { key: t.key.trim() } : {}), operator: t.operator,
      ...(t.value.trim() ? { value: t.value.trim() } : {}), ...(t.effect ? { effect: t.effect } : {}),
    }));
    if (tols.length) spec['tolerations'] = tols;
    if (this.serviceAccountName().trim()) spec['serviceAccountName'] = this.serviceAccountName().trim();
    if (this.restartPolicy()) spec['restartPolicy'] = this.restartPolicy();
    const ips = this.imagePullSecrets().map((s) => s.trim()).filter(Boolean);
    if (ips.length) spec['imagePullSecrets'] = ips.map((name) => ({ name }));
    const psc: Obj = {};
    if (this.fsGroup().trim()) psc['fsGroup'] = Number(this.fsGroup()) || 0;
    if (this.podRunAsUser().trim()) psc['runAsUser'] = Number(this.podRunAsUser()) || 0;
    if (this.podRunAsNonRoot()) psc['runAsNonRoot'] = true;
    if (Object.keys(psc).length) spec['securityContext'] = psc;
    return spec;
  }
  private probeOut(p: Probe): Obj | null {
    if (p.type === 'httpGet') return { httpGet: { path: p.path.trim() || '/', port: Number(p.port) || p.port.trim() } };
    if (p.type === 'tcpSocket') return { tcpSocket: { port: Number(p.port) || p.port.trim() } };
    if (p.type === 'exec') return words(p.command).length ? { exec: { command: words(p.command) } } : null;
    return null;
  }
  private volumeOut(v: Volume): Obj {
    const name = v.name.trim();
    if (v.type === 'configMap') return { name, configMap: { name: v.source.trim() } };
    if (v.type === 'secret') return { name, secret: { secretName: v.source.trim() } };
    if (v.type === 'persistentVolumeClaim') return { name, persistentVolumeClaim: { claimName: v.source.trim() } };
    if (v.type === 'hostPath') return { name, hostPath: { path: v.source.trim() } };
    return { name, emptyDir: {} };
  }

  // --- container editors ---
  addContainer(): void { this.containers.update((c) => [...c, newContainer()]); }
  removeContainer(i: number): void { this.containers.update((c) => c.filter((_, j) => j !== i)); }
  setC<K extends keyof Container>(i: number, field: K, val: Container[K]): void {
    this.containers.update((cs) => cs.map((c, j) => (j === i ? { ...c, [field]: val } : c)));
  }
  addEnv(ci: number): void { this.setC(ci, 'env', [...this.containers()[ci].env, { name: '', value: '' }]); }
  removeEnv(ci: number, ei: number): void { this.setC(ci, 'env', this.containers()[ci].env.filter((_, j) => j !== ei)); }
  setEnv(ci: number, ei: number, f: keyof EnvVar, v: string): void {
    this.setC(ci, 'env', this.containers()[ci].env.map((e, j) => (j === ei ? { ...e, [f]: v } : e)));
  }
  addPort(ci: number): void { this.setC(ci, 'ports', [...this.containers()[ci].ports, { name: '', containerPort: '', protocol: 'TCP' }]); }
  removePort(ci: number, pi: number): void { this.setC(ci, 'ports', this.containers()[ci].ports.filter((_, j) => j !== pi)); }
  setPort(ci: number, pi: number, f: keyof Port, v: string): void {
    this.setC(ci, 'ports', this.containers()[ci].ports.map((p, j) => (j === pi ? { ...p, [f]: v } : p)));
  }
  addMount(ci: number): void { this.setC(ci, 'mounts', [...this.containers()[ci].mounts, { name: '', mountPath: '', readOnly: false }]); }
  removeMount(ci: number, mi: number): void { this.setC(ci, 'mounts', this.containers()[ci].mounts.filter((_, j) => j !== mi)); }
  setMount(ci: number, mi: number, f: keyof Mount, v: string | boolean): void {
    this.setC(ci, 'mounts', this.containers()[ci].mounts.map((m, j) => (j === mi ? { ...m, [f]: v } : m)));
  }
  setProbe(ci: number, which: 'liveness' | 'readiness' | 'startup', f: keyof Probe, v: string): void {
    this.setC(ci, which, { ...this.containers()[ci][which], [f]: v });
  }

  // --- pod-level editors ---
  addVolume(): void { this.volumes.update((v) => [...v, { name: '', type: 'emptyDir', source: '' }]); }
  removeVolume(i: number): void { this.volumes.update((v) => v.filter((_, j) => j !== i)); }
  setVol(i: number, f: keyof Volume, v: string): void { this.volumes.update((vs) => vs.map((vol, j) => (j === i ? { ...vol, [f]: v } : vol))); }
  addNsel(): void { this.nodeSelector.update((n) => [...n, { key: '', value: '' }]); }
  removeNsel(i: number): void { this.nodeSelector.update((n) => n.filter((_, j) => j !== i)); }
  setNsel(i: number, f: keyof KV, v: string): void { this.nodeSelector.update((n) => n.map((kv, j) => (j === i ? { ...kv, [f]: v } : kv))); }
  addTol(): void { this.tolerations.update((t) => [...t, { key: '', operator: 'Equal', value: '', effect: '' }]); }
  removeTol(i: number): void { this.tolerations.update((t) => t.filter((_, j) => j !== i)); }
  setTol(i: number, f: keyof Toleration, v: string): void { this.tolerations.update((t) => t.map((tol, j) => (j === i ? { ...tol, [f]: v } : tol))); }
  addIps(): void { this.imagePullSecrets.update((s) => [...s, '']); }
  removeIps(i: number): void { this.imagePullSecrets.update((s) => s.filter((_, j) => j !== i)); }
  setIps(i: number, v: string): void { this.imagePullSecrets.update((s) => s.map((x, j) => (j === i ? v : x))); }
}
