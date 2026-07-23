import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';

interface RawSchedule {
  spec?: {
    schedule?: string;
    suspend?: boolean;
    concurrencyPolicy?: string;
    retention?: { keepLast?: number };
    template?: {
      spec?: {
        guestRef?: { name?: string };
        backend?: { type?: string };
        includeMemory?: boolean;
      };
    };
  };
  status?: {
    lastScheduleTime?: string;
    lastSuccessfulTime?: string;
    active?: string[];
  };
}

/**
 * ScheduleDrawer is the resource-aware detail drawer for a SwiftSnapshotSchedule,
 * opened from the Explorer's Snapshot Schedules kind. It shows the cron, the
 * retention (keepLast), the snapshot template (source guest + backend) and the
 * last/next-run status, and offers Suspend/Resume (patches spec.suspend via
 * ApplyResource) + Delete — as the signed-in user, RBAC-gated. Mirrors the
 * SandboxPool drawer.
 */
@Component({
  selector: 'app-schedule-drawer',
  imports: [MatIconModule],
  templateUrl: './schedule-drawer.html',
  styleUrl: './schedule-drawer.scss',
})
export class ScheduleDrawer implements OnInit {
  private readonly gw = inject(GatewayService);
  readonly cluster = input.required<string>();
  readonly namespace = input.required<string>();
  readonly name = input.required<string>();
  readonly closed = output<void>();
  readonly changed = output<void>();

  readonly schedule = signal('');
  readonly suspend = signal(false);
  readonly concurrency = signal('');
  readonly keepLast = signal<number | null>(null);
  readonly guest = signal('');
  readonly backend = signal('');
  readonly includeMemory = signal(false);
  readonly lastRun = signal('');
  readonly lastSuccess = signal('');
  readonly active = signal(0);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  async ngOnInit(): Promise<void> {
    try {
      const r = await this.gw.resources.getResource({
        cluster: this.cluster(),
        kind: 'swiftsnapshotschedules',
        namespace: this.namespace(),
        name: this.name(),
      });
      const o = JSON.parse(r.json) as RawSchedule;
      this.schedule.set(o.spec?.schedule ?? '');
      this.suspend.set(!!o.spec?.suspend);
      this.concurrency.set(o.spec?.concurrencyPolicy ?? 'Allow');
      this.keepLast.set(o.spec?.retention?.keepLast ?? null);
      this.guest.set(o.spec?.template?.spec?.guestRef?.name ?? '');
      this.backend.set(o.spec?.template?.spec?.backend?.type ?? '');
      this.includeMemory.set(!!o.spec?.template?.spec?.includeMemory);
      this.lastRun.set(o.status?.lastScheduleTime ?? '');
      this.lastSuccess.set(o.status?.lastSuccessfulTime ?? '');
      this.active.set(o.status?.active?.length ?? 0);
    } catch (e) {
      this.error.set(this.msg(e));
    }
  }

  fmt(iso: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString();
  }

  async toggleSuspend(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    const next = !this.suspend();
    const obj = {
      apiVersion: 'snapshot.kubeswift.io/v1alpha1',
      kind: 'SwiftSnapshotSchedule',
      metadata: { name: this.name(), namespace: this.namespace() },
      spec: { suspend: next },
    };
    try {
      await this.gw.resources.applyResource({
        cluster: this.cluster(),
        kind: 'swiftsnapshotschedules',
        namespace: this.namespace(),
        yaml: JSON.stringify(obj),
      });
      this.suspend.set(next);
      this.changed.emit();
    } catch (e) {
      this.error.set(this.msg(e));
    } finally {
      this.busy.set(false);
    }
  }

  async del(): Promise<void> {
    if (this.busy() || !confirm('Delete schedule "' + this.name() + '"? Existing snapshots are kept.'))
      return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.gw.resources.deleteResource({
        cluster: this.cluster(),
        kind: 'swiftsnapshotschedules',
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

  private msg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }
}
