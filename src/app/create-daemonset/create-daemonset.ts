import { Component, viewChild, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { FormShell } from '../form-shell/form-shell';
import { PodTemplate } from '../pod-template/pod-template';
import { ResourceForm } from '../resource-form';
import { listNames, deepClone } from '../wizard-util';
import { defaultPodSpec, extractPodTemplate, applyDeployTemplate } from '../workload-util';

type Obj = Record<string, unknown>;

/** CreateDaemonSet — apps/v1 DaemonSet (pod template + update strategy). */
@Component({
  selector: 'app-create-daemonset',
  imports: [MatIconModule, FormShell, PodTemplate],
  templateUrl: './create-daemonset.html',
  styleUrl: '../wizard.scss',
})
export class CreateDaemonSet extends ResourceForm {
  readonly kindKey = 'daemonsets';
  readonly apiVersion = 'apps/v1';
  readonly kindName = 'DaemonSet';
  readonly namespaced = true;

  readonly podTmpl = viewChild(PodTemplate);
  readonly podSpecInput = signal<Obj>(defaultPodSpec());
  readonly updateStrategy = signal('RollingUpdate');
  readonly namespaces = signal<string[]>([]);

  protected override async onCluster(cluster: string): Promise<void> {
    this.namespaces.set(await listNames(this.gw, cluster, 'namespaces'));
  }
  hydrate(obj: Obj): void {
    this.podSpecInput.set(deepClone(extractPodTemplate(obj)));
    const spec = (obj['spec'] ?? {}) as Obj;
    this.updateStrategy.set(String((spec['updateStrategy'] as Obj)?.['type'] ?? 'RollingUpdate'));
  }
  build(base: Obj): Obj {
    applyDeployTemplate(base, this.podTmpl()?.snapshot() ?? this.podSpecInput(), this.name().trim());
    (base['spec'] as Obj)['updateStrategy'] = { type: this.updateStrategy() };
    return base;
  }
  canSave(): boolean {
    return !!(this.cluster() && this.namespace() && this.name().trim() && (this.podTmpl()?.valid() ?? false));
  }
}
