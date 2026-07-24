import { Component, viewChild, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { FormShell } from '../form-shell/form-shell';
import { PodTemplate } from '../pod-template/pod-template';
import { ResourceForm } from '../resource-form';
import { listNames, deepClone } from '../wizard-util';
import { defaultPodSpec, extractPodTemplate, applyDeployTemplate } from '../workload-util';

type Obj = Record<string, unknown>;

/** CreateDeployment — an apps/v1 Deployment (replicas + strategy + pod template). */
@Component({
  selector: 'app-create-deployment',
  imports: [MatIconModule, FormShell, PodTemplate],
  templateUrl: './create-deployment.html',
  styleUrl: '../wizard.scss',
})
export class CreateDeployment extends ResourceForm {
  readonly kindKey = 'deployments';
  readonly apiVersion = 'apps/v1';
  readonly kindName = 'Deployment';
  readonly namespaced = true;

  readonly podTmpl = viewChild(PodTemplate);
  readonly podSpecInput = signal<Obj>(defaultPodSpec());
  readonly replicas = signal<number>(1);
  readonly strategy = signal('RollingUpdate');
  readonly namespaces = signal<string[]>([]);

  protected override async onCluster(cluster: string): Promise<void> {
    this.namespaces.set(await listNames(this.gw, cluster, 'namespaces'));
  }

  hydrate(obj: Obj): void {
    this.podSpecInput.set(deepClone(extractPodTemplate(obj)));
    const spec = (obj['spec'] ?? {}) as Obj;
    this.replicas.set(Number(spec['replicas'] ?? 1));
    this.strategy.set(String((spec['strategy'] as Obj)?.['type'] ?? 'RollingUpdate'));
  }

  build(base: Obj): Obj {
    const podSpec = this.podTmpl()?.snapshot() ?? this.podSpecInput();
    applyDeployTemplate(base, podSpec, this.name().trim());
    const spec = base['spec'] as Obj;
    spec['replicas'] = Math.max(0, Math.floor(this.replicas()));
    spec['strategy'] = { type: this.strategy() };
    return base;
  }

  canSave(): boolean {
    return !!(this.cluster() && this.namespace() && this.name().trim() && (this.podTmpl()?.valid() ?? false));
  }
}
