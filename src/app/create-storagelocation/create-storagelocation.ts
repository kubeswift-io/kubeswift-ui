import { Component, Directive, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { FormShell } from '../form-shell/form-shell';
import { ResourceForm } from '../resource-form';
import { DEFAULT_CREDENTIALS_SECRET } from '../storage-locations';
import { listNames, listSnapshotClasses } from '../wizard-util';

type Obj = Record<string, unknown>;

/**
 * StorageLocationForm edits a storage location: the registry snapshots are
 * pushed to (oci), and/or the VolumeSnapshotClass csi snapshots use. A cluster
 * location is the admin's and adds each namespace to its path; a namespace's
 * own is used as written. Fields the form has no widget for survive an edit:
 * build() merges onto the loaded object.
 */
@Directive()
abstract class StorageLocationForm extends ResourceForm {
  readonly apiVersion = 'storage.kubeswift.io/v1alpha1';

  readonly isDefault = signal(false);
  readonly useOCI = signal(true);
  readonly repository = signal('');
  readonly insecure = signal(false);
  readonly caBundle = signal('');
  readonly anonymous = signal(false);
  readonly credentialsSecretName = signal(''); // '' = the default name
  readonly signingKeySecretName = signal('');
  readonly verifyKey = signal('');
  readonly useCSI = signal(false);
  readonly className = signal('');

  readonly namespaces = signal<string[]>([]);
  readonly snapshotClasses = signal<string[]>([]);
  readonly defaultSecret = DEFAULT_CREDENTIALS_SECRET;

  protected override async onCluster(cluster: string): Promise<void> {
    const [ns, vsc] = await Promise.all([
      this.namespaced ? listNames(this.gw, cluster, 'namespaces') : Promise.resolve([]),
      listSnapshotClasses(this.gw, cluster),
    ]);
    this.namespaces.set(ns);
    this.snapshotClasses.set(vsc.names);
  }

  /** pathExample shows where a namespace's snapshots would go. */
  pathExample(): string {
    const repo = this.repository().trim().replace(/\/+$/, '') || '<repository>';
    return this.namespaced ? `${repo}/snapshots` : `${repo}/<namespace>/snapshots`;
  }

  hydrate(obj: Obj): void {
    const spec = (obj['spec'] ?? {}) as Obj;
    this.isDefault.set(spec['default'] === true);
    const oci = spec['oci'] as Obj | undefined;
    this.useOCI.set(!!oci);
    if (oci) {
      this.repository.set(String(oci['repository'] ?? ''));
      this.insecure.set(oci['insecure'] === true);
      this.caBundle.set(String(oci['caBundle'] ?? ''));
      this.anonymous.set(oci['anonymous'] === true);
      this.credentialsSecretName.set(String(oci['credentialsSecretName'] ?? ''));
      this.signingKeySecretName.set(String(oci['signingKeySecretName'] ?? ''));
      this.verifyKey.set(String(oci['verifyKey'] ?? ''));
    }
    const csi = spec['csi'] as Obj | undefined;
    this.useCSI.set(!!csi);
    this.className.set(String(csi?.['volumeSnapshotClassName'] ?? ''));
  }

  build(base: Obj): Obj {
    const spec = (base['spec'] = (base['spec'] ?? {}) as Obj) as Obj;
    if (this.isDefault()) spec['default'] = true;
    else delete spec['default'];
    if (this.useOCI()) {
      const oci = ((spec['oci'] ?? {}) as Obj) as Obj;
      oci['repository'] = this.repository().trim();
      // Names are trimmed; pasted PEM is kept exactly as given.
      const set = (k: string, v: string | boolean) => {
        if (v) oci[k] = v;
        else delete oci[k];
      };
      set('insecure', this.insecure());
      set('caBundle', this.caBundle().trim() ? this.caBundle() : '');
      set('anonymous', this.anonymous());
      set('credentialsSecretName', this.anonymous() ? '' : this.credentialsSecretName().trim());
      set('signingKeySecretName', this.signingKeySecretName().trim());
      set('verifyKey', this.verifyKey().trim() ? this.verifyKey() : '');
      spec['oci'] = oci;
    } else {
      delete spec['oci'];
    }
    if (this.useCSI()) spec['csi'] = { volumeSnapshotClassName: this.className() };
    else delete spec['csi'];
    return base;
  }

  canSave(): boolean {
    if (!this.cluster() || !this.name().trim()) return false;
    if (this.namespaced && !this.namespace()) return false;
    if (!this.useOCI() && !this.useCSI()) return false;
    if (this.useOCI() && !this.repository().trim()) return false;
    if (this.useCSI() && !this.className()) return false;
    return true;
  }
}

/** CreateClusterStorageLocation — the cluster-wide kind (admin-managed). */
@Component({
  selector: 'app-create-clusterstoragelocation',
  imports: [MatIconModule, FormShell],
  templateUrl: './create-storagelocation.html',
  styleUrl: '../wizard.scss',
})
export class CreateClusterStorageLocation extends StorageLocationForm {
  readonly kindKey = 'swiftclusterstoragelocations';
  readonly kindName = 'SwiftClusterStorageLocation';
  readonly namespaced = false;
}

/** CreateStorageLocation — a namespace's own location (overrides the cluster's). */
@Component({
  selector: 'app-create-storagelocation',
  imports: [MatIconModule, FormShell],
  templateUrl: './create-storagelocation.html',
  styleUrl: '../wizard.scss',
})
export class CreateStorageLocation extends StorageLocationForm {
  readonly kindKey = 'swiftstoragelocations';
  readonly kindName = 'SwiftStorageLocation';
  readonly namespaced = true;
}
