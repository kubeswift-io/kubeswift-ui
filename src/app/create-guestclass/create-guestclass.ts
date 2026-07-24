import { Component, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { FormShell } from '../form-shell/form-shell';
import { ResourceForm } from '../resource-form';

type Obj = Record<string, unknown>;

/** CreateGuestClass — a SwiftGuestClass (cluster-scoped resource/storage template). */
@Component({
  selector: 'app-create-guestclass',
  imports: [MatIconModule, FormShell],
  templateUrl: './create-guestclass.html',
  styleUrl: '../wizard.scss',
})
export class CreateGuestClass extends ResourceForm {
  readonly kindKey = 'swiftguestclasses';
  readonly apiVersion = 'swift.kubeswift.io/v1alpha1';
  readonly kindName = 'SwiftGuestClass';
  readonly namespaced = false;

  readonly cpu = signal('2');
  readonly memory = signal('2Gi');
  readonly diskSize = signal('20Gi');
  readonly diskFormat = signal('raw');
  readonly coreScheduling = signal('off');
  readonly accessMode = signal('');
  readonly volumeMode = signal('');
  readonly storageClass = signal('');

  hydrate(obj: Obj): void {
    const spec = (obj['spec'] ?? {}) as Obj;
    this.cpu.set(String(spec['cpu'] ?? '2'));
    this.memory.set(String(spec['memory'] ?? '2Gi'));
    const rd = (spec['rootDisk'] ?? {}) as Obj;
    this.diskSize.set(String(rd['size'] ?? '20Gi'));
    this.diskFormat.set(String(rd['format'] ?? 'raw'));
    this.coreScheduling.set(String(spec['coreScheduling'] ?? 'off'));
    const st = (spec['storage'] ?? {}) as Obj;
    this.accessMode.set(String(st['accessMode'] ?? ''));
    this.volumeMode.set(String(st['volumeMode'] ?? ''));
    this.storageClass.set(String(st['storageClassName'] ?? ''));
  }

  build(base: Obj): Obj {
    const spec = (base['spec'] = (base['spec'] ?? {}) as Obj) as Obj;
    spec['cpu'] = String(this.cpu()).trim() || '2';
    spec['memory'] = this.memory().trim();
    spec['rootDisk'] = { size: this.diskSize().trim(), format: this.diskFormat() };
    if (this.coreScheduling() && this.coreScheduling() !== 'off')
      spec['coreScheduling'] = this.coreScheduling();
    else delete spec['coreScheduling'];
    const storage: Obj = {};
    if (this.accessMode()) storage['accessMode'] = this.accessMode();
    if (this.volumeMode()) storage['volumeMode'] = this.volumeMode();
    if (this.storageClass().trim()) storage['storageClassName'] = this.storageClass().trim();
    if (Object.keys(storage).length) spec['storage'] = storage;
    else delete spec['storage'];
    return base;
  }

  canSave(): boolean {
    return !!(
      this.cluster() &&
      this.name().trim() &&
      String(this.cpu()).trim() &&
      this.memory().trim() &&
      this.diskSize().trim()
    );
  }
}
