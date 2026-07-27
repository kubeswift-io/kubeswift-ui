import { Component, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { FormShell } from '../form-shell/form-shell';
import { ResourceForm } from '../resource-form';
import { deepClone, listNames } from '../wizard-util';

type Obj = Record<string, unknown>;
// 'other' = a source variant with no widget here (spec.source.upload), kept verbatim.
type Src = 'http' | 'oci' | 'pvcClone' | 'other';

/** CreateImage — a SwiftImage VM disk (HTTP / OCI golden / PVC clone → raw runtime disk). */
@Component({
  selector: 'app-create-image',
  imports: [MatIconModule, FormShell],
  templateUrl: './create-image.html',
  styleUrl: '../wizard.scss',
})
export class CreateImage extends ResourceForm {
  readonly kindKey = 'swiftimages';
  readonly apiVersion = 'image.kubeswift.io/v1alpha1';
  readonly kindName = 'SwiftImage';
  readonly namespaced = true;

  readonly src = signal<Src>('http');
  readonly url = signal('');
  readonly ociRepo = signal('');
  readonly ociTag = signal('');
  readonly ociInsecure = signal(false);
  readonly pvcName = signal('');
  readonly pvcNamespace = signal('');
  readonly format = signal('qcow2');
  readonly osType = signal('linux');
  readonly diskSize = signal('');
  readonly namespaces = signal<string[]>([]);
  /** The loaded spec.source, so unmodelled variants and oci sub-fields survive. */
  readonly rawSource = signal<Obj>({});

  protected override async onCluster(cluster: string): Promise<void> {
    this.namespaces.set(await listNames(this.gw, cluster, 'namespaces'));
  }

  // Golden OCI images are already raw; default the source-artifact format to raw
  // when the operator picks the OCI source, qcow2 (cloud images) otherwise.
  selectSrc(s: Src): void {
    this.src.set(s);
    this.format.set(s === 'oci' ? 'raw' : 'qcow2');
  }

  hydrate(obj: Obj): void {
    const spec = (obj['spec'] ?? {}) as Obj;
    const source = (spec['source'] ?? {}) as Obj;
    this.rawSource.set(source);
    if (source['oci']) {
      this.src.set('oci');
      const oci = source['oci'] as Obj;
      this.ociRepo.set(String(oci['repository'] ?? ''));
      this.ociTag.set(String(oci['tag'] ?? ''));
      this.ociInsecure.set(!!oci['insecure']);
    } else if (source['pvcClone']) {
      this.src.set('pvcClone');
      const pvc = source['pvcClone'] as Obj;
      this.pvcName.set(String(pvc['name'] ?? ''));
      this.pvcNamespace.set(String(pvc['namespace'] ?? ''));
    } else if (!source['http'] && Object.keys(source).length) {
      // A source variant with no widget here (spec.source.upload). Falling
      // through to 'http' rewrote it to an empty URL on save.
      this.src.set('other');
    } else {
      this.src.set('http');
      this.url.set(String(((source['http'] ?? {}) as Obj)['url'] ?? ''));
    }
    this.format.set(String(spec['format'] ?? 'qcow2'));
    this.osType.set(String(spec['osType'] ?? 'linux'));
    this.diskSize.set(String(((spec['rootDisk'] ?? {}) as Obj)['size'] ?? ''));
  }

  build(base: Obj): Obj {
    const spec = (base['spec'] = (base['spec'] ?? {}) as Obj) as Obj;
    let source: Obj;
    if (this.src() === 'other') {
      source = deepClone(this.rawSource());
    } else if (this.src() === 'http') {
      source = { http: { url: this.url().trim() } };
    } else if (this.src() === 'oci') {
      // Merge onto the loaded oci block: digest (the pin), credentialsSecretRef
      // and above all verifyKeySecretRef (cosign verify-on-pull) have no widget
      // here, and rebuilding the block silently disabled signature verification.
      const oci = deepClone((this.rawSource()['oci'] ?? {}) as Obj);
      oci['repository'] = this.ociRepo().trim();
      if (this.ociTag().trim()) oci['tag'] = this.ociTag().trim();
      else delete oci['tag'];
      if (this.ociInsecure()) oci['insecure'] = true;
      else delete oci['insecure'];
      source = { oci };
    } else {
      const pvc: Obj = { name: this.pvcName().trim() };
      if (this.pvcNamespace().trim()) pvc['namespace'] = this.pvcNamespace().trim();
      source = { pvcClone: pvc };
    }
    spec['source'] = source;
    spec['format'] = this.format();
    if (this.osType() && this.osType() !== 'linux') spec['osType'] = this.osType();
    else delete spec['osType'];
    if (this.diskSize().trim()) spec['rootDisk'] = { size: this.diskSize().trim() };
    else delete spec['rootDisk'];
    return base;
  }

  canSave(): boolean {
    if (!this.cluster() || !this.namespace() || !this.name().trim()) return false;
    if (this.src() === 'other') return true; // preserved as loaded
    if (this.src() === 'http') return !!this.url().trim();
    if (this.src() === 'oci') return !!this.ociRepo().trim();
    return !!this.pvcName().trim();
  }
}
