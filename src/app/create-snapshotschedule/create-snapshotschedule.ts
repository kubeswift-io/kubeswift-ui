import { Component, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { FormShell } from '../form-shell/form-shell';
import { ResourceForm } from '../resource-form';
import {
  type Locations,
  loadLocations,
  ociLocations,
  resolveOCI,
  snapshotRepository,
  source,
} from '../storage-locations';
import {
  deepClone,
  keepIfListed,
  listGuestNames,
  listNames,
  listSnapshotClasses,
  pickerErrors,
} from '../wizard-util';

type Obj = Record<string, unknown>;

/** CreateSnapshotSchedule — a SwiftSnapshotSchedule (cron snapshots + keep-N).
 *  local, CSI and oci-through-a-storage-location backends have widgets here; an
 *  s3 backend, or an oci one naming its registry itself, on a loaded schedule is
 *  preserved as-is and edited through the YAML toggle. */
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
  readonly csiClass = signal('');
  readonly snapshotClasses = signal<string[]>([]);
  readonly defaultClasses = signal<string[]>([]);
  readonly keepLast = signal<number>(7);
  readonly concurrency = signal('Forbid');
  readonly suspend = signal(false);
  readonly namespaces = signal<string[]>([]);
  readonly guests = signal<string[]>([]);
  // oci: '' = the default location, or the source ("<Kind>/<name>") of one.
  readonly ociLocation = signal('');
  readonly locs = signal<Locations>({ cluster: [], namespaced: [], error: '' });
  readonly source = source;
  /** The loaded backend, kept verbatim for s3/oci which have no widget here. */
  readonly rawBackend = signal<Obj>({});

  /** backendType is the loaded backend's type, for the preserved-backend notice. */
  backendType(): string {
    return String(this.rawBackend()['type'] ?? '');
  }

  protected override async onCluster(cluster: string): Promise<void> {
    const [ns, vsc] = await Promise.all([
      listNames(this.gw, cluster, 'namespaces'),
      listSnapshotClasses(this.gw, cluster),
    ]);
    this.namespaces.set(ns);
    this.snapshotClasses.set(vsc.names);
    this.defaultClasses.set(vsc.defaults);
    await this.onNamespace(cluster, this.namespace());
  }

  // SwiftGuests have their own view, not a catalog entry, so they are listed
  // through GuestService; listing them as a catalog kind always came back
  // empty and left a schedule unsaveable from the form.
  protected override async onNamespace(cluster: string, ns: string): Promise<void> {
    const [g, locs] = await Promise.all([listGuestNames(this.gw, cluster, ns), loadLocations(this.gw, cluster, ns)]);
    if (this.isStale(cluster, ns)) return;
    this.locs.set(locs);
    this.guests.set(g.names);
    this.guestRef.set(keepIfListed(this.guestRef(), g.names));
    this.pickerError.set(pickerErrors({ guests: g }));
  }

  ociChoices() {
    return ociLocations(this.locs(), this.namespace());
  }

  /** ociNow says where a snapshot made now would go; each resolves at its own creation. */
  ociNow(): string {
    const chosen = this.ociChoices().find((l) => source(l) === this.ociLocation());
    const r = resolveOCI(this.locs(), this.namespace());
    const loc = this.ociLocation() ? chosen : r.location;
    return loc ? `${snapshotRepository(loc, this.namespace())} (from ${source(loc)})` : '';
  }
  ociProblem(): string {
    return this.ociLocation() ? '' : resolveOCI(this.locs(), this.namespace()).problem;
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
    this.rawBackend.set(be);
    const type = String(be['type'] ?? '');
    if (type === 'csi-volume-snapshot') {
      this.backend.set('csi-volume-snapshot');
      this.csiClass.set(
        String(((be['csiVolumeSnapshot'] ?? {}) as Obj)['volumeSnapshotClassName'] ?? ''),
      );
    } else if (type === 'oci' && !be['oci']) {
      // oci through a storage location (no oci block of its own).
      this.backend.set('oci');
      const ref = be['locationRef'] as Obj | undefined;
      this.ociLocation.set(ref ? `${String(ref['kind'] ?? 'SwiftStorageLocation')}/${String(ref['name'] ?? '')}` : '');
    } else if (type && type !== 'local') {
      // s3 / oci — the object backends, which exist precisely to get snapshots
      // OFF the node. They have no widget here, so keep the loaded backend
      // verbatim: falling through to 'local' silently redirected a production
      // offsite schedule to node-local disk, and it kept reporting success.
      this.backend.set('other');
    } else {
      // A template hostPath is no longer accepted (each scheduled snapshot is
      // captured into a directory derived from its own name), so one loaded
      // from an older schedule is dropped on save.
      this.backend.set('local');
    }
  }

  build(base: Obj): Obj {
    const spec = (base['spec'] = (base['spec'] ?? {}) as Obj) as Obj;
    let backendObj: Obj;
    let includeMemory: boolean;
    if (this.backend() === 'other') {
      backendObj = deepClone(this.rawBackend());
      includeMemory = this.includeMemory();
    } else if (this.backend() === 'oci') {
      backendObj = { type: 'oci' };
      if (this.ociLocation()) {
        const [kind, name] = this.ociLocation().split('/');
        backendObj['locationRef'] = { kind, name };
      }
      includeMemory = true;
    } else if (this.backend() === 'csi-volume-snapshot') {
      const csi: Obj = {};
      if (this.csiClass().trim()) csi['volumeSnapshotClassName'] = this.csiClass().trim();
      backendObj = { type: 'csi-volume-snapshot', csiVolumeSnapshot: csi };
      includeMemory = false; // CSI is disk-only by definition
    } else {
      // No hostPath: the webhook refuses one on a template, since every
      // snapshot of the schedule would share the directory.
      backendObj = { type: 'local' };
      includeMemory = this.includeMemory();
    }
    spec['schedule'] = this.schedule().trim();
    spec['concurrencyPolicy'] = this.concurrency();
    // Merge into the template rather than replacing it, so template.metadata and
    // any template.spec field with no widget here survive the edit.
    const tmpl = (spec['template'] = (spec['template'] ?? {}) as Obj) as Obj;
    const tspec = (tmpl['spec'] = (tmpl['spec'] ?? {}) as Obj) as Obj;
    tspec['guestRef'] = { name: this.guestRef() };
    tspec['backend'] = backendObj;
    tspec['includeMemory'] = includeMemory;
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
