import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';
import { RestoreDialog } from '../restore-dialog/restore-dialog';

interface RawSnapshot {
  spec?: {
    guestRef?: { name?: string };
    backend?: { type?: string };
    includeMemory?: boolean;
    deletionPolicy?: string;
  };
  status?: {
    phase?: string;
    hypervisorVersion?: string;
    observedPauseWindowMs?: number;
    s3?: { uploadedBytes?: number };
  };
}

/**
 * SnapshotDetail is the resource-aware detail drawer for a SwiftSnapshot, opened
 * from the Explorer's Snapshots kind. It shows the source guest / backend /
 * phase / details and offers Restore (opens the restore dialog) + Delete — as
 * the signed-in user, RBAC-gated. A change emits `changed` so the table reloads.
 */
@Component({
  selector: 'app-snapshot-detail',
  imports: [MatIconModule, RestoreDialog],
  templateUrl: './snapshot-detail.html',
  styleUrl: './snapshot-detail.scss',
})
export class SnapshotDetail implements OnInit {
  private readonly gw = inject(GatewayService);
  readonly cluster = input.required<string>();
  readonly namespace = input.required<string>();
  readonly name = input.required<string>();
  readonly closed = output<void>();
  readonly changed = output<void>();

  readonly guest = signal('');
  readonly backend = signal('');
  readonly phase = signal('');
  readonly includeMemory = signal(false);
  readonly deletionPolicy = signal('');
  readonly hypervisor = signal('');
  readonly pauseMs = signal(0);
  readonly bytes = signal(0);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly showRestore = signal(false);

  async ngOnInit(): Promise<void> {
    try {
      const r = await this.gw.resources.getResource({
        cluster: this.cluster(),
        kind: 'swiftsnapshots',
        namespace: this.namespace(),
        name: this.name(),
      });
      const o = JSON.parse(r.json) as RawSnapshot;
      this.guest.set(o.spec?.guestRef?.name ?? '');
      this.backend.set(o.spec?.backend?.type ?? '');
      this.includeMemory.set(!!o.spec?.includeMemory);
      this.deletionPolicy.set(o.spec?.deletionPolicy ?? '');
      this.phase.set(o.status?.phase ?? '');
      this.hypervisor.set(o.status?.hypervisorVersion ?? '');
      this.pauseMs.set(o.status?.observedPauseWindowMs ?? 0);
      this.bytes.set(o.status?.s3?.uploadedBytes ?? 0);
    } catch (e) {
      this.error.set(this.msg(e));
    }
  }

  openRestore(): void {
    this.showRestore.set(true);
  }
  onRestored(): void {
    this.showRestore.set(false);
    this.changed.emit();
  }

  async del(): Promise<void> {
    if (this.busy() || !confirm(`Delete snapshot "${this.name()}"? This cannot be undone.`)) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.gw.resources.deleteResource({
        cluster: this.cluster(),
        kind: 'swiftsnapshots',
        namespace: this.namespace(),
        name: this.name(),
      });
      this.changed.emit();
      this.closed.emit();
    } catch (e) {
      this.error.set(this.msg(e));
      this.busy.set(false);
    }
  }

  humanBytes(b: number): string {
    if (!b) return '—';
    const u = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    let i = 0;
    let v = b;
    while (v >= 1024 && i < u.length - 1) {
      v /= 1024;
      i++;
    }
    return v.toFixed(i ? 1 : 0) + ' ' + u[i];
  }
  private msg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }
}
