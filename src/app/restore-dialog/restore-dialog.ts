import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';

type Mode = 'new' | 'inplace';

/** The annotation that lets an in-place memory restore proceed over a disk that has moved on. */
const ACCEPT_DIVERGENCE = 'snapshot.kubeswift.io/accept-disk-divergence';

/**
 * RestoreDialog creates a SwiftRestore from a snapshot, as the signed-in user
 * (RBAC and the restore webhook gate it; a denial renders inline). It knows the
 * snapshot's backend, so it offers only restores that can succeed:
 *
 *  - into a NEW guest (the default): any backend. A memory snapshot's clone
 *    must regenerate MAC addresses (the webhook refuses it otherwise), so
 *    that is always included.
 *  - IN PLACE over the source guest: memory snapshots only. A CSI snapshot
 *    cannot restore over an existing guest (OverwriteUnsupported). A memory
 *    snapshot holds RAM, not the disk, so if the guest ran on after the
 *    capture the restore is refused (DiskDiverged) unless the user explicitly
 *    accepts resuming old memory over the newer disk.
 */
@Component({
  selector: 'app-restore-dialog',
  imports: [MatIconModule],
  templateUrl: './restore-dialog.html',
  styleUrl: './restore-dialog.scss',
})
export class RestoreDialog implements OnInit {
  private readonly gw = inject(GatewayService);
  readonly cluster = input.required<string>();
  readonly namespace = input<string>('default');
  readonly snapshot = input.required<string>();
  readonly sourceGuest = input<string>('');
  readonly backend = input<string>('');
  // resumedAfterCapture: the snapshot's resumeAfterSnapshot (default true), so
  // the guest ran on after the capture and an in-place restore diverges.
  readonly resumedAfterCapture = input<boolean>(true);
  // fullState: an includeDisk capture carries the disk, so it never diverges.
  readonly fullState = input<boolean>(false);
  readonly saved = output<void>();
  readonly closed = output<void>();

  readonly mode = signal<Mode>('new');
  readonly name = signal('');
  readonly targetGuest = signal('');
  readonly targetNode = signal('');
  readonly nodes = signal<string[]>([]);
  readonly regenOther = signal(true); // hostname, machine-id, SSH host keys
  readonly resumeAfterRestore = signal(true);
  readonly acceptDivergence = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.name.set(`${this.snapshot()}-restore`);
    this.targetGuest.set(`${this.sourceGuest() || this.snapshot()}-clone`);
    if (this.usesTargetNode()) {
      void this.gw.clusters
        .listNodes({ cluster: this.cluster() })
        .then((r) => this.nodes.set(r.nodes.map((n) => n.name).filter(Boolean).sort()))
        .catch(() => this.nodes.set([]));
    }
  }

  isCSI(): boolean {
    return this.backend() === 'csi-volume-snapshot';
  }
  /** memory: local, s3 and oci snapshots capture RAM and device state. */
  isMemory(): boolean {
    return !!this.backend() && !this.isCSI();
  }
  /** usesTargetNode: an s3 or oci restore downloads onto a chosen node. */
  usesTargetNode(): boolean {
    return this.backend() === 's3' || this.backend() === 'oci';
  }
  canRestoreInPlace(): boolean {
    return this.isMemory() && !!this.sourceGuest();
  }
  /** divergesInPlace: an in-place restore would be refused unless accepted. */
  divergesInPlace(): boolean {
    return this.isMemory() && !this.fullState() && this.resumedAfterCapture();
  }

  setMode(m: Mode): void {
    this.mode.set(m);
    if (m === 'inplace') this.targetGuest.set(this.sourceGuest());
    else if (this.targetGuest() === this.sourceGuest()) this.targetGuest.set(`${this.sourceGuest()}-clone`);
  }

  /** targetProblem says why the target cannot be used, or '' when it can. */
  targetProblem(): string {
    const t = this.targetGuest().trim();
    if (!t) return 'Name the guest to restore into.';
    if (t === this.snapshot()) return 'The target guest must not have the same name as the snapshot.';
    if (this.mode() === 'new' && t === this.sourceGuest()) {
      return 'That is the source guest: choose "Over the source guest" to restore in place, or another name.';
    }
    return '';
  }

  canSave(): boolean {
    if (!this.name().trim() || this.targetProblem()) return false;
    if (this.mode() === 'inplace') {
      if (!this.canRestoreInPlace()) return false;
      if (this.divergesInPlace() && !this.acceptDivergence()) return false;
    } else if (this.usesTargetNode() && !this.targetNode()) {
      return false; // a new guest has no node of its own to fall back to
    }
    return true;
  }

  async save(): Promise<void> {
    if (!this.canSave() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    const inPlace = this.mode() === 'inplace';
    const spec: Record<string, unknown> = {
      snapshotRef: { name: this.snapshot() },
      targetGuest: { name: this.targetGuest().trim(), overwriteExisting: inPlace },
    };
    if (this.usesTargetNode() && this.targetNode()) spec['targetNode'] = this.targetNode();
    if (this.isMemory()) {
      spec['resumeAfterRestore'] = this.resumeAfterRestore();
      if (!inPlace) {
        const regenerate = ['macAddresses'];
        if (this.regenOther()) regenerate.unshift('hostname', 'machineId', 'sshHostKeys');
        spec['identity'] = { regenerate };
      }
    }
    const metadata: Record<string, unknown> = { name: this.name().trim(), namespace: this.namespace() };
    if (inPlace && this.acceptDivergence()) metadata['annotations'] = { [ACCEPT_DIVERGENCE]: 'true' };
    const obj = { apiVersion: 'snapshot.kubeswift.io/v1alpha1', kind: 'SwiftRestore', metadata, spec };
    try {
      await this.gw.resources.applyResource({
        cluster: this.cluster(),
        kind: 'swiftrestores',
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
