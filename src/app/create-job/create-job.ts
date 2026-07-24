import { Component, viewChild, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { FormShell } from '../form-shell/form-shell';
import { PodTemplate } from '../pod-template/pod-template';
import { ResourceForm } from '../resource-form';
import { listNames, deepClone } from '../wizard-util';
import { defaultPodSpec, extractPodTemplate, applyDeployTemplate, intOrUndef } from '../workload-util';

type Obj = Record<string, unknown>;

/** CreateJob — a batch/v1 Job (completions/parallelism/backoffLimit + pod template). */
@Component({
  selector: 'app-create-job',
  imports: [MatIconModule, FormShell, PodTemplate],
  templateUrl: './create-job.html',
  styleUrl: '../wizard.scss',
})
export class CreateJob extends ResourceForm {
  readonly kindKey = 'jobs';
  readonly apiVersion = 'batch/v1';
  readonly kindName = 'Job';
  readonly namespaced = true;

  readonly podTmpl = viewChild(PodTemplate);
  readonly podSpecInput = signal<Obj>({ containers: [{ name: 'main', image: '' }], restartPolicy: 'Never' });
  readonly completions = signal('');
  readonly parallelism = signal('');
  readonly backoffLimit = signal('');
  readonly namespaces = signal<string[]>([]);

  protected override async onCluster(cluster: string): Promise<void> {
    this.namespaces.set(await listNames(this.gw, cluster, 'namespaces'));
  }
  hydrate(obj: Obj): void {
    const ps = deepClone(extractPodTemplate(obj));
    if (!ps['restartPolicy']) ps['restartPolicy'] = 'Never';
    this.podSpecInput.set(ps);
    const spec = (obj['spec'] ?? {}) as Obj;
    this.completions.set(spec['completions'] != null ? String(spec['completions']) : '');
    this.parallelism.set(spec['parallelism'] != null ? String(spec['parallelism']) : '');
    this.backoffLimit.set(spec['backoffLimit'] != null ? String(spec['backoffLimit']) : '');
  }
  build(base: Obj): Obj {
    const podSpec = this.podTmpl()?.snapshot() ?? this.podSpecInput();
    if (!podSpec['restartPolicy']) podSpec['restartPolicy'] = 'Never';
    applyDeployTemplate(base, podSpec, this.name().trim(), false);
    const spec = base['spec'] as Obj;
    const c = intOrUndef(this.completions()); if (c !== undefined) spec['completions'] = c; else delete spec['completions'];
    const p = intOrUndef(this.parallelism()); if (p !== undefined) spec['parallelism'] = p; else delete spec['parallelism'];
    const b = intOrUndef(this.backoffLimit()); if (b !== undefined) spec['backoffLimit'] = b; else delete spec['backoffLimit'];
    return base;
  }
  canSave(): boolean {
    return !!(this.cluster() && this.namespace() && this.name().trim() && (this.podTmpl()?.valid() ?? false));
  }
}
