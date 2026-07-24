import { Component, viewChild, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { FormShell } from '../form-shell/form-shell';
import { PodTemplate } from '../pod-template/pod-template';
import { ResourceForm } from '../resource-form';
import { listNames, deepClone } from '../wizard-util';
import { defaultPodSpec, extractPodTemplate, applyDeployTemplate } from '../workload-util';

type Obj = Record<string, unknown>;

/** CreateReplicaSet — apps/v1 ReplicaSet (replicas + pod template). */
@Component({
  selector: 'app-create-replicaset',
  imports: [MatIconModule, FormShell, PodTemplate],
  templateUrl: './create-replicaset.html',
  styleUrl: '../wizard.scss',
})
export class CreateReplicaSet extends ResourceForm {
  readonly kindKey = 'replicasets';
  readonly apiVersion = 'apps/v1';
  readonly kindName = 'ReplicaSet';
  readonly namespaced = true;

  readonly podTmpl = viewChild(PodTemplate);
  readonly podSpecInput = signal<Obj>(defaultPodSpec());
  readonly replicas = signal<number>(1);
  readonly namespaces = signal<string[]>([]);

  protected override async onCluster(cluster: string): Promise<void> {
    this.namespaces.set(await listNames(this.gw, cluster, 'namespaces'));
  }
  hydrate(obj: Obj): void {
    this.podSpecInput.set(deepClone(extractPodTemplate(obj)));
    this.replicas.set(Number(((obj['spec'] ?? {}) as Obj)['replicas'] ?? 1));
  }
  build(base: Obj): Obj {
    applyDeployTemplate(base, this.podTmpl()?.snapshot() ?? this.podSpecInput(), this.name().trim());
    (base['spec'] as Obj)['replicas'] = Math.max(0, Math.floor(this.replicas()));
    return base;
  }
  canSave(): boolean {
    return !!(this.cluster() && this.namespace() && this.name().trim() && (this.podTmpl()?.valid() ?? false));
  }
}
