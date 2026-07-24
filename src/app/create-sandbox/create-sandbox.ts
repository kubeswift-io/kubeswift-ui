import { Component, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { FormShell } from '../form-shell/form-shell';
import { ResourceForm } from '../resource-form';
import { listNames } from '../wizard-util';

type Obj = Record<string, unknown>;
type Source = 'new' | 'pool';
type ScratchKind = '' | 'blank' | 'pvc';

/**
 * CreateSandbox — a SwiftSandbox microVM. Two sources: a standalone "New microVM"
 * (image + resources + network + GPU profile, model preload, scratch disk) or a
 * "Checkout from pool" that claims a warm slot (poolRef) and inherits the slot's
 * shape — GPU/poolRef are mutually exclusive, so GPU/model/scratch hide in pool mode.
 */
@Component({
  selector: 'app-create-sandbox',
  imports: [MatIconModule, FormShell],
  templateUrl: './create-sandbox.html',
  styleUrl: '../wizard.scss',
})
export class CreateSandbox extends ResourceForm {
  readonly kindKey = 'swiftsandboxes';
  readonly apiVersion = 'sandbox.kubeswift.io/v1alpha1';
  readonly kindName = 'SwiftSandbox';
  readonly namespaced = true;

  readonly source = signal<Source>('new');
  readonly image = signal('');
  readonly cpu = signal<number>(1);
  readonly memory = signal('512Mi');
  readonly networkMode = signal('restricted');
  readonly rootfsMode = signal(''); // '' -> controller default (block)
  readonly command = signal('');
  readonly poolRef = signal('');
  readonly gpuProfileRef = signal('');
  readonly modelRef = signal('');
  readonly modelMount = signal('/model');
  readonly scratchKind = signal<ScratchKind>('');
  readonly scratchSize = signal('1Gi');
  readonly scratchPvc = signal('');
  readonly scratchMount = signal('/scratch');

  readonly namespaces = signal<string[]>([]);
  readonly pools = signal<string[]>([]);
  readonly gpuProfiles = signal<string[]>([]);

  protected override async onCluster(cluster: string): Promise<void> {
    const [ns, pl, gpu] = await Promise.all([
      listNames(this.gw, cluster, 'namespaces'),
      listNames(this.gw, cluster, 'swiftsandboxpools'),
      listNames(this.gw, cluster, 'swiftgpuprofiles'),
    ]);
    this.namespaces.set(ns);
    this.pools.set(pl);
    this.gpuProfiles.set(gpu);
  }

  // Choosing a pool prefills the image from the pool's spec so the checkout is
  // rootfs-compatible; the field stays editable.
  async selectPool(name: string): Promise<void> {
    this.poolRef.set(name);
    if (!name) return;
    try {
      const r = await this.gw.resources.getResource({
        cluster: this.cluster(),
        kind: 'swiftsandboxpools',
        namespace: this.namespace(),
        name,
      });
      const o = JSON.parse(r.json) as { spec?: { image?: string } };
      if (o.spec?.image) this.image.set(o.spec.image);
    } catch {
      // leave image as-is; the user can type it.
    }
  }

  hydrate(obj: Obj): void {
    const spec = (obj['spec'] ?? {}) as Obj;
    this.image.set(String(spec['image'] ?? ''));
    this.cpu.set(Number(spec['cpu'] ?? 1));
    this.memory.set(String(spec['memory'] ?? '512Mi'));
    this.networkMode.set(String(((spec['network'] ?? {}) as Obj)['mode'] ?? 'restricted'));
    this.rootfsMode.set(String(spec['rootfsMode'] ?? ''));
    const cmd = spec['command'];
    this.command.set(Array.isArray(cmd) ? (cmd as string[]).join(' ') : '');
    if (spec['poolRef']) {
      this.source.set('pool');
      this.poolRef.set(String((spec['poolRef'] as Obj)['name'] ?? ''));
    } else {
      this.source.set('new');
      this.gpuProfileRef.set(String(((spec['gpuProfileRef'] ?? {}) as Obj)['name'] ?? ''));
      const model = (spec['model'] ?? {}) as Obj;
      this.modelRef.set(String(model['imageRef'] ?? ''));
      this.modelMount.set(String(model['mountPath'] ?? '/model'));
      const sd = (spec['scratchDisk'] ?? {}) as Obj;
      if (sd['blank']) {
        this.scratchKind.set('blank');
        this.scratchSize.set(String((sd['blank'] as Obj)['size'] ?? '1Gi'));
        this.scratchMount.set(String(sd['mountPath'] ?? '/scratch'));
      } else if (sd['pvcRef']) {
        this.scratchKind.set('pvc');
        this.scratchPvc.set(String((sd['pvcRef'] as Obj)['name'] ?? ''));
        this.scratchMount.set(String(sd['mountPath'] ?? '/scratch'));
      } else {
        this.scratchKind.set('');
      }
    }
  }

  build(base: Obj): Obj {
    const spec = (base['spec'] = (base['spec'] ?? {}) as Obj) as Obj;
    spec['image'] = this.image().trim();
    spec['memory'] = this.memory().trim() || '512Mi';
    if (this.cpu() > 0) spec['cpu'] = Math.floor(this.cpu());
    else delete spec['cpu'];
    if (this.networkMode()) spec['network'] = { mode: this.networkMode() };
    if (this.rootfsMode()) spec['rootfsMode'] = this.rootfsMode();
    else delete spec['rootfsMode'];
    const cmd = this.command().trim();
    if (cmd) spec['command'] = cmd.split(/\s+/);
    else delete spec['command'];

    if (this.source() === 'pool') {
      spec['poolRef'] = { name: this.poolRef() };
      delete spec['gpuProfileRef'];
      delete spec['model'];
      delete spec['scratchDisk'];
    } else {
      delete spec['poolRef'];
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
      if (this.scratchKind() === 'blank') {
        const sd: Obj = { blank: { size: this.scratchSize().trim() } };
        if (this.scratchMount().trim()) sd['mountPath'] = this.scratchMount().trim();
        spec['scratchDisk'] = sd;
      } else if (this.scratchKind() === 'pvc') {
        const sd: Obj = { pvcRef: { name: this.scratchPvc().trim() } };
        if (this.scratchMount().trim()) sd['mountPath'] = this.scratchMount().trim();
        spec['scratchDisk'] = sd;
      } else {
        delete spec['scratchDisk'];
      }
    }
    return base;
  }

  canSave(): boolean {
    if (!this.cluster() || !this.namespace() || !this.name().trim() || !this.image().trim())
      return false;
    if (this.source() === 'pool' && !this.poolRef()) return false;
    if (this.source() === 'new') {
      if (this.modelRef().trim() && !this.modelMount().trim()) return false;
      if (this.scratchKind() === 'blank' && !this.scratchSize().trim()) return false;
      if (this.scratchKind() === 'pvc' && !this.scratchPvc().trim()) return false;
    }
    return true;
  }
}
