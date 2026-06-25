import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';

/**
 * RestoreDialog creates a SwiftRestore from a snapshot. Target guest == source =
 * in-place (requires overwrite); a different name = clone. Builds the object and
 * applies it via ResourceService.ApplyResource (JSON-as-YAML) as the signed-in
 * user; RBAC + the restore webhook gate it, denial renders inline.
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
  readonly sourceGuest = input<string>(''); // pre-fills the target (in-place)
  readonly saved = output<void>();
  readonly closed = output<void>();

  readonly name = signal('');
  readonly targetGuest = signal('');
  readonly overwrite = signal(false);
  readonly targetNode = signal('');
  readonly regen = signal(true); // regenerate identity on a clone
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.targetGuest.set(this.sourceGuest());
    this.name.set(`${this.snapshot()}-restore`);
  }

  isInPlace(): boolean {
    return !!this.sourceGuest() && this.targetGuest().trim() === this.sourceGuest();
  }

  canSave(): boolean {
    if (!this.name().trim() || !this.targetGuest().trim()) return false;
    if (this.isInPlace() && !this.overwrite()) return false; // in-place must overwrite
    return true;
  }

  async save(): Promise<void> {
    if (!this.canSave() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    const spec: Record<string, unknown> = {
      snapshotRef: { name: this.snapshot() },
      targetGuest: { name: this.targetGuest().trim(), overwriteExisting: this.overwrite() },
    };
    if (this.targetNode().trim()) spec['targetNode'] = this.targetNode().trim();
    if (!this.isInPlace() && this.regen()) {
      spec['identity'] = { regenerate: ['hostname', 'machineId', 'sshHostKeys', 'macAddresses'] };
    }
    const obj = {
      apiVersion: 'snapshot.kubeswift.io/v1alpha1',
      kind: 'SwiftRestore',
      metadata: { name: this.name().trim(), namespace: this.namespace() },
      spec,
    };
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
