import { Component, viewChild, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { FormShell } from '../form-shell/form-shell';
import { PodTemplate } from '../pod-template/pod-template';
import { ResourceForm } from '../resource-form';
import { listNames, deepClone } from '../wizard-util';
import { defaultPodSpec } from '../workload-util';

type Obj = Record<string, unknown>;

/** CreateCronJob — a batch/v1 CronJob (schedule + jobTemplate/pod template). */
@Component({
  selector: 'app-create-cronjob',
  imports: [MatIconModule, FormShell, PodTemplate],
  templateUrl: './create-cronjob.html',
  styleUrl: '../wizard.scss',
})
export class CreateCronJob extends ResourceForm {
  readonly kindKey = 'cronjobs';
  readonly apiVersion = 'batch/v1';
  readonly kindName = 'CronJob';
  readonly namespaced = true;

  readonly podTmpl = viewChild(PodTemplate);
  readonly podSpecInput = signal<Obj>({ containers: [{ name: 'main', image: '' }], restartPolicy: 'OnFailure' });
  readonly schedule = signal('*/5 * * * *');
  readonly concurrency = signal('Allow');
  readonly suspend = signal(false);
  readonly namespaces = signal<string[]>([]);

  protected override async onCluster(cluster: string): Promise<void> {
    this.namespaces.set(await listNames(this.gw, cluster, 'namespaces'));
  }
  private extract(obj: Obj): Obj {
    const jt = ((obj['spec'] as Obj)?.['jobTemplate'] ?? {}) as Obj;
    const tmpl = ((jt['spec'] as Obj)?.['template'] ?? {}) as Obj;
    return ((tmpl['spec'] ?? {}) as Obj) || {};
  }
  hydrate(obj: Obj): void {
    const ps = deepClone(this.extract(obj));
    if (!ps['restartPolicy']) ps['restartPolicy'] = 'OnFailure';
    this.podSpecInput.set(ps);
    const spec = (obj['spec'] ?? {}) as Obj;
    this.schedule.set(String(spec['schedule'] ?? '*/5 * * * *'));
    this.concurrency.set(String(spec['concurrencyPolicy'] ?? 'Allow'));
    this.suspend.set(spec['suspend'] === true);
  }
  build(base: Obj): Obj {
    const podSpec = this.podTmpl()?.snapshot() ?? this.podSpecInput();
    if (!podSpec['restartPolicy']) podSpec['restartPolicy'] = 'OnFailure';
    const spec = (base['spec'] = (base['spec'] ?? {}) as Obj) as Obj;
    spec['schedule'] = this.schedule().trim();
    spec['concurrencyPolicy'] = this.concurrency();
    if (this.suspend()) spec['suspend'] = true; else delete spec['suspend'];
    const jt = (spec['jobTemplate'] = (spec['jobTemplate'] ?? {}) as Obj) as Obj;
    const jspec = (jt['spec'] = (jt['spec'] ?? {}) as Obj) as Obj;
    const tmpl = (jspec['template'] = (jspec['template'] ?? {}) as Obj) as Obj;
    tmpl['spec'] = podSpec;
    return base;
  }
  canSave(): boolean {
    return !!(this.cluster() && this.namespace() && this.name().trim() && this.schedule().trim() && (this.podTmpl()?.valid() ?? false));
  }
}
