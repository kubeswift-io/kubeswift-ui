import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { timestampDate } from '@bufbuild/protobuf/wkt';
import type { Guest } from '../gen/kubeswift/v1/guest_pb';
import type { MetricSeries } from '../gen/kubeswift/v1/telemetry_pb';
import { GatewayService } from '../gateway.service';
import { Sparkline } from '../sparkline/sparkline';
import { Console } from '../console/console';

/**
 * GuestDetail is the right slide-in drawer for one VM. It opens instantly from
 * the inventory row's data; the Fleet page then refreshes it via GetGuestDetail
 * so it auto-enriches once the backend aggregation (pod / events / gpu /
 * storage) lands on that RPC.
 *
 * The Start/Stop buttons patch the guest's runPolicy via the gateway write
 * plane (StartGuest/StopGuest). They don't mutate local state — the live
 * WatchGuests stream carries the resulting phase change back into this drawer.
 */
@Component({
  selector: 'app-guest-detail',
  imports: [MatIconModule, MatButtonModule, MatProgressBarModule, Sparkline, Console],
  templateUrl: './guest-detail.html',
  styleUrl: './guest-detail.scss',
})
export class GuestDetail {
  private readonly gw = inject(GatewayService);
  readonly guest = input.required<Guest>();
  readonly closed = output<void>();

  readonly acting = signal(false);
  readonly actionError = signal<string | null>(null);
  readonly showConsole = signal(false);

  // Telemetry: range series polled from the gateway while the drawer is open.
  readonly metrics = signal<MetricSeries[]>([]);
  readonly metricsError = signal<string | null>(null);

  // Identity key — the poll restarts only when a DIFFERENT guest is shown, not
  // on every live-Watch field update of the same guest.
  private readonly refKey = computed(() => {
    const r = this.guest().ref;
    return r ? `${r.cluster}/${r.namespace}/${r.name}` : '';
  });

  constructor() {
    effect((onCleanup) => {
      const key = this.refKey(); // tracked: re-runs on guest identity change
      this.metrics.set([]);
      this.metricsError.set(null);
      if (!key) return;
      const ref = untracked(() => this.guest().ref); // untracked: not on field updates
      if (!ref) return;
      let stopped = false;
      const poll = async () => {
        try {
          const res = await this.gw.telemetry.getGuestMetrics({ ref, windowSeconds: 900, stepSeconds: 30 });
          if (stopped) return;
          if (res.error) {
            this.metricsError.set(res.error.message);
            this.metrics.set([]);
          } else {
            this.metricsError.set(null);
            this.metrics.set(res.series);
          }
        } catch (e: unknown) {
          if (!stopped) this.metricsError.set(e instanceof Error ? e.message : String(e));
        }
      };
      void poll();
      const id = setInterval(() => void poll(), 15000);
      onCleanup(() => {
        stopped = true;
        clearInterval(id);
      });
    });
  }

  // values for one metric kind (empty until the first poll lands).
  seriesValues(kind: string): number[] {
    return this.metrics().find((s) => s.kind === kind)?.points.map((p) => p.value) ?? [];
  }

  created(): string {
    const ts = this.guest().createdAt;
    return ts ? timestampDate(ts).toLocaleString() : '—';
  }

  labelEntries(): { k: string; v: string }[] {
    return Object.entries(this.guest().labels ?? {}).map(([k, v]) => ({ k, v }));
  }

  // A guest with nothing to stop (already Stopped) hides Stop; one that is
  // running/coming-up hides Start. Unknown phases allow both — the member
  // RBAC + controller are the real guard.
  canStart(): boolean {
    const p = this.guest().phase;
    return p !== 'Running' && p !== 'Pending' && p !== 'Scheduling';
  }
  canStop(): boolean {
    return this.guest().phase !== 'Stopped';
  }
  // The serial socket exists only while the VM is running.
  canConsole(): boolean {
    return this.guest().phase === 'Running';
  }

  openConsole(): void {
    this.showConsole.set(true);
  }
  closeConsole(): void {
    this.showConsole.set(false);
  }

  start(): void {
    void this.act((ref) => this.gw.guests.startGuest({ ref }));
  }
  stop(): void {
    void this.act((ref) => this.gw.guests.stopGuest({ ref }));
  }

  private async act(call: (ref: NonNullable<Guest['ref']>) => Promise<unknown>): Promise<void> {
    const ref = this.guest().ref;
    if (!ref || this.acting()) return;
    this.acting.set(true);
    this.actionError.set(null);
    try {
      await call(ref);
      // Success is observed, not asserted: the controller acts on the runPolicy
      // change and the live Watch updates this drawer's phase.
    } catch (e: unknown) {
      this.actionError.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.acting.set(false);
    }
  }
}
