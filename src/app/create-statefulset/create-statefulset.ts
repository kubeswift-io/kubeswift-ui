import { Component, viewChild, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { FormShell } from '../form-shell/form-shell';
import { PodTemplate } from '../pod-template/pod-template';
import { ResourceForm } from '../resource-form';
import { listNames, deepClone } from '../wizard-util';
import { defaultPodSpec, extractPodTemplate, applyDeployTemplate } from '../workload-util';

type Obj = Record<string, unknown>;

/** CreateStatefulSet — apps/v1 StatefulSet (replicas + serviceName + template). */
@Component({
  selector: 'app-create-statefulset',
  imports: [MatIconModule, FormShell, PodTemplate],
  templateUrl: './create-statefulset.html',
  styleUrl: '../wizard.scss',
})
export class CreateStatefulSet extends ResourceForm {
  readonly kindKey = 'statefulsets';
  readonly apiVersion = 'apps/v1';
  readonly kindName = 'StatefulSet';
  readonly namespaced = true;

  readonly podTmpl = viewChild(PodTemplate);
  readonly podSpecInput = signal<Obj>(defaultPodSpec());
  readonly replicas = signal<number>(1);
  readonly serviceName = signal('');
  readonly updateStrategy = signal('RollingUpdate');
  readonly namespaces = signal<string[]>([]);

  protected override async onCluster(cluster: string): Promise<void> {
    this.namespaces.set(await listNames(this.gw, cluster, 'namespaces'));
  }
  hydrate(obj: Obj): void {
    this.podSpecInput.set(deepClone(extractPodTemplate(obj)));
    const spec = (obj['spec'] ?? {}) as Obj;
    this.replicas.set(Number(spec['replicas'] ?? 1));
    this.serviceName.set(String(spec['serviceName'] ?? ''));
    this.updateStrategy.set(String((spec['updateStrategy'] as Obj)?.['type'] ?? 'RollingUpdate'));
  }
  build(base: Obj): Obj {
    applyDeployTemplate(base, this.podTmpl()?.snapshot() ?? this.podSpecInput(), this.name().trim());
    const spec = base['spec'] as Obj;
    spec['replicas'] = Math.max(0, Math.floor(this.replicas()));
    spec['serviceName'] = this.serviceName().trim() || this.name().trim();
    spec['updateStrategy'] = { type: this.updateStrategy() };
    return base;
  }
  canSave(): boolean {
    return !!(this.cluster() && this.namespace() && this.name().trim() && (this.podTmpl()?.valid() ?? false));
  }
}
