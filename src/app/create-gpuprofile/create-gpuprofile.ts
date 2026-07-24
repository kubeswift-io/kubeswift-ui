import { Component, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { FormShell } from '../form-shell/form-shell';
import { ResourceForm } from '../resource-form';
import { listNames } from '../wizard-util';

type Obj = Record<string, unknown>;

/** CreateGPUProfile — a SwiftGPUProfile (count / model / tier / partition mode).
 *  NUMA + Fabric Manager tuning stay a YAML-toggle escape hatch. */
@Component({
  selector: 'app-create-gpuprofile',
  imports: [MatIconModule, FormShell],
  templateUrl: './create-gpuprofile.html',
  styleUrl: '../wizard.scss',
})
export class CreateGPUProfile extends ResourceForm {
  readonly kindKey = 'swiftgpuprofiles';
  readonly apiVersion = 'gpu.kubeswift.io/v1alpha1';
  readonly kindName = 'SwiftGPUProfile';
  readonly namespaced = true;

  readonly count = signal<number>(1);
  readonly model = signal('');
  readonly tier = signal('pcie');
  readonly partitionMode = signal('isolated');
  readonly hugepages = signal('');
  readonly vcpuPinning = signal(false);
  readonly gpuDirectClique = signal<number>(0);
  readonly noMmap = signal(false);
  readonly namespaces = signal<string[]>([]);

  protected override async onCluster(cluster: string): Promise<void> {
    this.namespaces.set(await listNames(this.gw, cluster, 'namespaces'));
  }

  // hgx tiers need the PCIe hierarchy; nudge partitionMode when the operator
  // picks one (still editable).
  selectTier(t: string): void {
    this.tier.set(t);
    if (t === 'hgx-shared') this.partitionMode.set('shared');
    else if (t === 'hgx-full') this.partitionMode.set('full');
    else this.partitionMode.set('isolated');
  }

  hydrate(obj: Obj): void {
    const spec = (obj['spec'] ?? {}) as Obj;
    this.count.set(Number(spec['count'] ?? 1));
    this.model.set(String(spec['model'] ?? ''));
    this.tier.set(String(spec['tier'] ?? 'pcie'));
    this.partitionMode.set(String(spec['partitionMode'] ?? 'isolated'));
    this.hugepages.set(String(spec['hugepages'] ?? ''));
    this.vcpuPinning.set(!!spec['vcpuPinning']);
    const pcie = (spec['pcieTopology'] ?? {}) as Obj;
    this.gpuDirectClique.set(Number(pcie['gpuDirectClique'] ?? 0));
    this.noMmap.set(!!pcie['noMmap']);
  }

  build(base: Obj): Obj {
    const spec = (base['spec'] = (base['spec'] ?? {}) as Obj) as Obj;
    spec['count'] = Math.floor(this.count());
    spec['tier'] = this.tier();
    spec['partitionMode'] = this.partitionMode();
    spec['vcpuPinning'] = this.vcpuPinning();
    if (this.model().trim()) spec['model'] = this.model().trim();
    else delete spec['model'];
    if (this.hugepages()) spec['hugepages'] = this.hugepages();
    else delete spec['hugepages'];
    const pcie: Obj = {};
    if (this.gpuDirectClique() > 0) pcie['gpuDirectClique'] = Math.floor(this.gpuDirectClique());
    if (this.noMmap()) pcie['noMmap'] = true;
    if (this.tier() !== 'pcie') pcie['rootPortPerDevice'] = true;
    if (Object.keys(pcie).length) spec['pcieTopology'] = pcie;
    else delete spec['pcieTopology'];
    return base;
  }

  canSave(): boolean {
    return !!(this.cluster() && this.namespace() && this.name().trim() && this.count() > 0);
  }
}
