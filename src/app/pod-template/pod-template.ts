import { Component, computed, effect, input, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import {
  arr, containerIn, newContainer, podSpecOut, str, volumeIn,
  type Container, type EnvVar, type KV, type Mount, type Obj, type Port, type Probe,
  type Toleration, type Volume,
} from './podspec';

/**
 * PodTemplate is the rich, presentational editor for a Kubernetes PodSpec — the
 * shared body of every workload form (Deployment/STS/DS/RS/Job/CronJob). It
 * hydrates from a PodSpec via [value] and exposes snapshot() (the current
 * PodSpec) + valid() to the host form, which threads it in/out at the kind's
 * template path.
 *
 * snapshot() MERGES onto the spec it loaded rather than rebuilding one, so
 * fields with no widget here survive a save. The conversion lives in podspec.ts;
 * this class is signals and row editors only.
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
    const cs = arr(spec['containers']).map(containerIn);
    this.containers.set(cs.length ? cs : [newContainer()]);
    this.volumes.set(arr(spec['volumes']).map(volumeIn));
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

  /** snapshot returns the edited PodSpec, merged onto the one that was loaded. */
  snapshot(): Obj {
    return podSpecOut(this.value(), {
      containers: this.containers(),
      volumes: this.volumes(),
      nodeSelector: this.nodeSelector(),
      tolerations: this.tolerations(),
      serviceAccountName: this.serviceAccountName(),
      restartPolicy: this.restartPolicy(),
      imagePullSecrets: this.imagePullSecrets(),
      fsGroup: this.fsGroup(),
      podRunAsUser: this.podRunAsUser(),
      podRunAsNonRoot: this.podRunAsNonRoot(),
    });
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
  setVol(i: number, f: 'name' | 'type' | 'source', v: string): void {
    this.volumes.update((vs) => vs.map((vol, j) => (j === i ? { ...vol, [f]: v } : vol)));
  }
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
