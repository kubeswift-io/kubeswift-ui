import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';
import {
  type Location,
  type Locations,
  loadLocations,
  ociLocations,
  resolveOCI,
  snapshotRepository,
  source,
} from '../storage-locations';
import { listGuestNames, listSnapshotClasses } from '../wizard-util';

/**
 * SnapshotDialog creates a SwiftSnapshot of a guest. Reused from the Fleet
 * drawer (guest fixed) and the Snapshots screen (guest picked). It builds the
 * object and applies it via ResourceService.ApplyResource (the gateway parses
 * the JSON as YAML) AS THE SIGNED-IN USER — RBAC + the snapshot webhook gate it;
 * a denial renders inline. Native form controls (no Material animations engine).
 */
@Component({
  selector: 'app-snapshot-dialog',
  imports: [MatIconModule],
  templateUrl: './snapshot-dialog.html',
  styleUrl: './snapshot-dialog.scss',
})
export class SnapshotDialog implements OnInit {
  private readonly gw = inject(GatewayService);
  readonly cluster = input.required<string>();
  readonly namespace = input<string>('default');
  readonly fixedGuest = input<string>(''); // set when opened from a guest drawer
  readonly saved = output<void>();
  readonly closed = output<void>();

  readonly guests = signal<string[]>([]);
  readonly guest = signal('');
  readonly name = signal('');
  readonly backend = signal('local'); // local | csi-volume-snapshot | s3 | oci
  readonly resumeAfterSnapshot = signal(true);
  readonly deletionPolicy = signal('Delete');
  readonly volumeSnapshotClass = signal('');
  readonly snapshotClasses = signal<string[]>([]);
  readonly defaultClasses = signal<string[]>([]);
  readonly s3Bucket = signal('');
  readonly s3Region = signal('');
  readonly s3Endpoint = signal('');
  readonly s3Prefix = signal('');
  readonly s3Insecure = signal(false);
  readonly s3Secret = signal('');
  // oci: '' = the default location (the namespace's, else the cluster's), or
  // the source ("<Kind>/<name>") of a named one.
  readonly ociLocation = signal('');
  readonly includeDisk = signal(false);
  readonly locs = signal<Locations>({ cluster: [], namespaced: [], error: '' });

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    void loadLocations(this.gw, this.cluster(), this.namespace()).then((l) => this.locs.set(l));
    void listSnapshotClasses(this.gw, this.cluster()).then((l) => {
      this.snapshotClasses.set(l.names);
      this.defaultClasses.set(l.defaults);
    });
    const fixed = this.fixedGuest();
    if (fixed) {
      this.guest.set(fixed);
      this.name.set(`${fixed}-snap`);
      return;
    }
    void listGuestNames(this.gw, this.cluster(), this.namespace()).then((l) => {
      this.guests.set(l.names);
      if (l.names.length && !this.guest()) this.selectGuest(l.names[0]);
    });
  }

  /** ociChoices are the locations an oci snapshot here may name. */
  ociChoices(): Location[] {
    return ociLocations(this.locs(), this.namespace());
  }

  /** ociTarget is where an oci snapshot would be stored, or why it could not be. */
  ociTarget(): { where: string; from: string; problem: string } {
    const chosen = this.ociChoices().find((l) => source(l) === this.ociLocation());
    const loc = this.ociLocation() ? chosen : resolveOCI(this.locs(), this.namespace()).location;
    if (!loc) {
      return { where: '', from: '', problem: resolveOCI(this.locs(), this.namespace()).problem };
    }
    return { where: snapshotRepository(loc, this.namespace()), from: source(loc), problem: '' };
  }

  /** capturesMemory: local, s3 and oci always capture memory, csi never does. */
  capturesMemory(): boolean {
    return this.backend() !== 'csi-volume-snapshot';
  }

  selectGuest(g: string): void {
    this.guest.set(g);
    if (!this.name() || this.name().endsWith('-snap')) this.name.set(`${g}-snap`);
  }

  canSave(): boolean {
    if (!this.guest() || !this.name().trim()) return false;
    if (this.backend() === 's3') {
      // The webhook requires credentials, and a region unless an endpoint is set.
      if (!this.s3Bucket().trim() || !this.s3Secret().trim()) return false;
      if (!this.s3Region().trim() && !this.s3Endpoint().trim()) return false;
    }
    // An oci snapshot with nowhere to go would only wait (NoStorageLocation).
    if (this.backend() === 'oci' && this.ociTarget().problem) return false;
    return true;
  }

  async save(): Promise<void> {
    if (!this.canSave() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    const backend: Record<string, unknown> = { type: this.backend() };
    if (this.backend() === 'csi-volume-snapshot' && this.volumeSnapshotClass().trim()) {
      backend['csiVolumeSnapshot'] = { volumeSnapshotClassName: this.volumeSnapshotClass().trim() };
    }
    if (this.backend() === 's3') {
      const s3: Record<string, unknown> = { bucket: this.s3Bucket().trim() };
      if (this.s3Region().trim()) s3['region'] = this.s3Region().trim();
      if (this.s3Endpoint().trim()) s3['endpoint'] = this.s3Endpoint().trim();
      if (this.s3Prefix().trim()) s3['prefix'] = this.s3Prefix().trim();
      if (this.s3Insecure()) s3['insecure'] = true;
      s3['credentialsSecretRef'] = { name: this.s3Secret().trim() };
      backend['s3'] = s3;
    }
    if (this.backend() === 'oci' && this.ociLocation()) {
      // No oci block: the registry comes from the location, which the
      // controller resolves and records in status.location.
      const [kind, name] = this.ociLocation().split('/');
      backend['locationRef'] = { kind, name };
    }
    const fullState = this.backend() === 'oci' && this.includeDisk();
    const obj = {
      apiVersion: 'snapshot.kubeswift.io/v1alpha1',
      kind: 'SwiftSnapshot',
      metadata: { name: this.name().trim(), namespace: this.namespace() },
      spec: {
        guestRef: { name: this.guest() },
        backend,
        // What the backend captures: a checkbox here changed nothing (the API
        // documents includeMemory=false as a no-op), so none is offered.
        includeMemory: this.capturesMemory(),
        ...(fullState ? { includeDisk: true } : {}),
        // A full-state capture stops the guest; there is nothing to resume.
        ...(this.capturesMemory() && !fullState ? { resumeAfterSnapshot: this.resumeAfterSnapshot() } : {}),
        deletionPolicy: this.deletionPolicy(),
      },
    };
    try {
      await this.gw.resources.applyResource({
        cluster: this.cluster(),
        kind: 'swiftsnapshots',
        namespace: this.namespace(),
        yaml: JSON.stringify(obj),
      });
      this.saved.emit();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }
}
