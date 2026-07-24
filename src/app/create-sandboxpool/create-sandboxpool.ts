import { Component, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { FormShell } from '../form-shell/form-shell';
import { ResourceForm } from '../resource-form';
import { listNames } from '../wizard-util';

type Obj = Record<string, unknown>;

/** CreateSandboxPool — a SwiftSandboxPool (N pre-booted warm microVM slots).
 *  Optionally each slot holds a GPU (warm GPU pool) and/or a preloaded model. */
@Component({
  selector: 'app-create-sandboxpool',
  imports: [MatIconModule, FormShell],
  templateUrl: './create-sandboxpool.html',
  styleUrl: '../wizard.scss',
})
export class CreateSandboxPool extends ResourceForm {
  readonly kindKey = 'swiftsandboxpools';
  readonly apiVersion = 'sandbox.kubeswift.io/v1alpha1';
  readonly kindName = 'SwiftSandboxPool';
  readonly namespaced = true;

  readonly image = signal('');
  readonly cpu = signal<number>(1);
  readonly memory = signal('512Mi');
  readonly networkMode = signal('restricted');
  readonly rootfsMode = signal('');
  readonly minWarm = signal<number>(1);
  readonly maxWarm = signal<number>(0);
  readonly gpuProfileRef = signal('');
  readonly modelRef = signal('');
  readonly modelMount = signal('/model');
  readonly imagePullSecret = signal('');
  readonly namespaces = signal<string[]>([]);
  readonly gpuProfiles = signal<string[]>([]);

  protected override async onCluster(cluster: string): Promise<void> {
    const [ns, gpu] = await Promise.all([
      listNames(this.gw, cluster, 'namespaces'),
      listNames(this.gw, cluster, 'swiftgpuprofiles'),
    ]);
    this.namespaces.set(ns);
    this.gpuProfiles.set(gpu);
  }

  hydrate(obj: Obj): void {
    const spec = (obj['spec'] ?? {}) as Obj;
    this.image.set(String(spec['image'] ?? ''));
    this.cpu.set(Number(spec['cpu'] ?? 1));
    this.memory.set(String(spec['memory'] ?? '512Mi'));
    this.networkMode.set(String(((spec['network'] ?? {}) as Obj)['mode'] ?? 'restricted'));
    this.rootfsMode.set(String(spec['rootfsMode'] ?? ''));
    this.minWarm.set(Number(spec['minWarm'] ?? 1));
    this.maxWarm.set(Number(spec['maxWarm'] ?? 0));
    this.imagePullSecret.set(String(spec['imagePullSecret'] ?? ''));
    this.gpuProfileRef.set(String(((spec['gpuProfileRef'] ?? {}) as Obj)['name'] ?? ''));
    const model = (spec['model'] ?? {}) as Obj;
    this.modelRef.set(String(model['imageRef'] ?? ''));
    this.modelMount.set(String(model['mountPath'] ?? '/model'));
  }

  build(base: Obj): Obj {
    const spec = (base['spec'] = (base['spec'] ?? {}) as Obj) as Obj;
    spec['image'] = this.image().trim();
    spec['memory'] = this.memory().trim() || '512Mi';
    spec['minWarm'] = Math.floor(this.minWarm());
    if (this.cpu() > 0) spec['cpu'] = Math.floor(this.cpu());
    else delete spec['cpu'];
    if (this.networkMode()) spec['network'] = { mode: this.networkMode() };
    if (this.rootfsMode()) spec['rootfsMode'] = this.rootfsMode();
    else delete spec['rootfsMode'];
    if (this.maxWarm() > 0) spec['maxWarm'] = Math.floor(this.maxWarm());
    else delete spec['maxWarm'];
    if (this.imagePullSecret().trim()) spec['imagePullSecret'] = this.imagePullSecret().trim();
    else delete spec['imagePullSecret'];
    if (this.gpuProfileRef()) spec['gpuProfileRef'] = { name: this.gpuProfileRef() };
    else delete spec['gpuProfileRef'];
    const model = this.modelRef().trim();
    if (model) {
      const m: Obj = { imageRef: model };
      if (this.modelMount().trim()) m['mountPath'] = this.modelMount().trim();
      spec['model'] = m;
    } else {
      delete spec['model'];
    }
    return base;
  }

  canSave(): boolean {
    if (!this.cluster() || !this.namespace() || !this.name().trim() || !this.image().trim())
      return false;
    if (this.modelRef().trim() && !this.modelMount().trim()) return false;
    if (this.maxWarm() > 0 && this.maxWarm() < this.minWarm()) return false;
    return true;
  }
}
