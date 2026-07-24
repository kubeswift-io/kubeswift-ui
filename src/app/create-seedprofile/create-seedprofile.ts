import { Component, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { FormShell } from '../form-shell/form-shell';
import { ResourceForm } from '../resource-form';
import { listNames } from '../wizard-util';

type Obj = Record<string, unknown>;

/** CreateSeedProfile — a SwiftSeedProfile (cloud-init NoCloud seed). Inline data;
 *  secret/configMap refs are an "Edit as YAML" escape hatch (the toggle). */
@Component({
  selector: 'app-create-seedprofile',
  imports: [MatIconModule, FormShell],
  templateUrl: './create-seedprofile.html',
  styleUrl: '../wizard.scss',
})
export class CreateSeedProfile extends ResourceForm {
  readonly kindKey = 'swiftseedprofiles';
  readonly apiVersion = 'seed.kubeswift.io/v1alpha1';
  readonly kindName = 'SwiftSeedProfile';
  readonly namespaced = true;

  readonly userData = signal('#cloud-config\n');
  readonly metaData = signal('');
  readonly networkData = signal('');
  readonly namespaces = signal<string[]>([]);

  protected override async onCluster(cluster: string): Promise<void> {
    this.namespaces.set(await listNames(this.gw, cluster, 'namespaces'));
  }

  hydrate(obj: Obj): void {
    const spec = (obj['spec'] ?? {}) as Obj;
    this.userData.set(String(spec['userData'] ?? '#cloud-config\n'));
    this.metaData.set(String(spec['metaData'] ?? ''));
    this.networkData.set(String(spec['networkData'] ?? ''));
  }

  build(base: Obj): Obj {
    const spec = (base['spec'] = (base['spec'] ?? {}) as Obj) as Obj;
    spec['datasource'] = 'NoCloud';
    spec['userData'] = this.userData();
    if (this.metaData().trim()) spec['metaData'] = this.metaData();
    else delete spec['metaData'];
    if (this.networkData().trim()) spec['networkData'] = this.networkData();
    else delete spec['networkData'];
    return base;
  }

  canSave(): boolean {
    return !!(this.cluster() && this.namespace() && this.name().trim() && this.userData().trim());
  }
}
