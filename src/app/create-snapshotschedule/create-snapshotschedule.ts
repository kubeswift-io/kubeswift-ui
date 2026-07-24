import { Component, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { FormShell } from '../form-shell/form-shell';
import { ResourceForm } from '../resource-form';
import { listNames } from '../wizard-util';

type Obj = Record<string, unknown>;

/** CreateSnapshotSchedule — a SwiftSnapshotSchedule (cron snapshots + keep-N).
 *  local + CSI backends here; S3/OCI object backends route through the YAML toggle. */
@Component({
  selector: 'app-create-snapshotschedule',
  imports: [MatIconModule, FormShell],
  templateUrl: './create-snapshotschedule.html',
  styleUrl: '../wizard.scss',
})
export class CreateSnapshotSchedule extends ResourceForm {
  readonly kindKey = 'swiftsnapshotschedules';
  readonly apiVersion = 'snapshot.kubeswift.io/v1alpha1';
  readonly kindName = 'SwiftSnapshotSchedule';
  readonly namespaced = true;

  readonly guestRef = signal('');
  readonly schedule = signal('0 2 * * *');
  readonly backend = signal('local');
  readonly includeMemory = signal(true);
  readonly localHostPath = signal(''); // '' -> auto-derived under the required prefix
  readonly csiClass = signal('');
  readonly keepLast = signal<number>(7);
  readonly concurrency = signal('Forbid');
  readonly suspend = signal(false);
  readonly namespaces = signal<string[]>([]);
  readonly guests = signal<string[]>([]);

  protected override async onCluster(cluster: string): Promise<void> {
    const [ns, g] = await Promise.all([
      listNames(this.gw, cluster, 'namespaces'),
      listNames(this.gw, cluster, 'swiftguests', this.namespace()),
    ]);
    this.namespaces.set(ns);
    this.guests.set(g);
  }

  async selectNamespace(ns: string): Promise<void> {
    this.namespace.set(ns);
    this.guestRef.set('');
    this.guests.set(await listNames(this.gw, this.cluster(), 'swiftguests', ns));
  }

  hydrate(obj: Obj): void {
    const spec = (obj['spec'] ?? {}) as Obj;
    this.schedule.set(String(spec['schedule'] ?? '0 2 * * *'));
    this.concurrency.set(String(spec['concurrencyPolicy'] ?? 'Forbid'));
    this.suspend.set(!!spec['suspend']);
    this.keepLast.set(Number(((spec['retention'] ?? {}) as Obj)['keepLast'] ?? 0));
    const tspec = (((spec['template'] ?? {}) as Obj)['spec'] ?? {}) as Obj;
    this.guestRef.set(String(((tspec['guestRef'] ?? {}) as Obj)['name'] ?? ''));
    this.includeMemory.set(!!tspec['includeMemory']);
    const be = (tspec['backend'] ?? {}) as Obj;
    if (be['type'] === 'csi-volume-snapshot') {
      this.backend.set('csi-volume-snapshot');
      this.csiClass.set(
        String(((be['csiVolumeSnapshot'] ?? {}) as Obj)['volumeSnapshotClassName'] ?? ''),
      );
    } else {
      this.backend.set('local');
      this.localHostPath.set(String(((be['local'] ?? {}) as Obj)['hostPath'] ?? ''));
    }
  }

  build(base: Obj): Obj {
    const spec = (base['spec'] = (base['spec'] ?? {}) as Obj) as Obj;
    let backendObj: Obj;
    let includeMemory: boolean;
    if (this.backend() === 'csi-volume-snapshot') {
      const csi: Obj = {};
      if (this.csiClass().trim()) csi['volumeSnapshotClassName'] = this.csiClass().trim();
      backendObj = { type: 'csi-volume-snapshot', csiVolumeSnapshot: csi };
      includeMemory = false; // CSI is disk-only by definition
    } else {
      // The webhook requires backend.local.hostPath under a fixed prefix; derive
      // a per-schedule default when the operator leaves the field blank.
      const hp =
        this.localHostPath().trim() ||
        `/var/lib/kubeswift/snapshots/${this.namespace()}-${this.name().trim()}`;
      backendObj = { type: 'local', local: { hostPath: hp } };
      includeMemory = this.includeMemory();
    }
    spec['schedule'] = this.schedule().trim();
    spec['concurrencyPolicy'] = this.concurrency();
    spec['template'] = {
      spec: { guestRef: { name: this.guestRef() }, backend: backendObj, includeMemory },
    };
    if (this.suspend()) spec['suspend'] = true;
    else delete spec['suspend'];
    if (this.keepLast() > 0) spec['retention'] = { keepLast: Math.floor(this.keepLast()) };
    else delete spec['retention'];
    return base;
  }

  canSave(): boolean {
    return !!(
      this.cluster() &&
      this.namespace() &&
      this.name().trim() &&
      this.guestRef() &&
      this.schedule().trim()
    );
  }
}
