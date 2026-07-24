import { Component, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { FormShell } from '../form-shell/form-shell';
import { ResourceForm } from '../resource-form';
import { listNames } from '../wizard-util';

type Obj = Record<string, unknown>;

/** CreateKernel — a SwiftKernel (per-node OCI kernel artifact: bzImage + initramfs).
 *  A tag change alone won't re-pull an existing kernel (pull Job keyed on name+node). */
@Component({
  selector: 'app-create-kernel',
  imports: [MatIconModule, FormShell],
  templateUrl: './create-kernel.html',
  styleUrl: '../wizard.scss',
})
export class CreateKernel extends ResourceForm {
  readonly kindKey = 'swiftkernels';
  readonly apiVersion = 'kernel.kubeswift.io/v1alpha1';
  readonly kindName = 'SwiftKernel';
  readonly namespaced = true;

  readonly image = signal('');
  readonly profile = signal('');
  readonly cmdline = signal('');
  readonly pullSecret = signal('');
  readonly namespaces = signal<string[]>([]);

  protected override async onCluster(cluster: string): Promise<void> {
    this.namespaces.set(await listNames(this.gw, cluster, 'namespaces'));
  }

  hydrate(obj: Obj): void {
    const spec = (obj['spec'] ?? {}) as Obj;
    const ociRef = (spec['ociRef'] ?? {}) as Obj;
    this.image.set(String(ociRef['image'] ?? ''));
    this.pullSecret.set(String(ociRef['pullSecret'] ?? ''));
    this.profile.set(String(spec['profile'] ?? ''));
    this.cmdline.set(String(spec['kernelCmdline'] ?? ''));
  }

  build(base: Obj): Obj {
    const spec = (base['spec'] = (base['spec'] ?? {}) as Obj) as Obj;
    const ociRef: Obj = { image: this.image().trim() };
    if (this.pullSecret().trim()) ociRef['pullSecret'] = this.pullSecret().trim();
    spec['ociRef'] = ociRef;
    if (this.profile().trim()) spec['profile'] = this.profile().trim();
    else delete spec['profile'];
    if (this.cmdline().trim()) spec['kernelCmdline'] = this.cmdline().trim();
    else delete spec['kernelCmdline'];
    return base;
  }

  canSave(): boolean {
    return !!(this.cluster() && this.namespace() && this.name().trim() && this.image().trim());
  }
}
