import { Component, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { timestampDate } from '@bufbuild/protobuf/wkt';
import type { Guest } from '../gen/kubeswift/v1/guest_pb';
import { GatewayService } from '../gateway.service';

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
  imports: [MatIconModule, MatButtonModule, MatProgressBarModule],
  templateUrl: './guest-detail.html',
  styleUrl: './guest-detail.scss',
})
export class GuestDetail {
  private readonly gw = inject(GatewayService);
  readonly guest = input.required<Guest>();
  readonly closed = output<void>();

  readonly acting = signal(false);
  readonly actionError = signal<string | null>(null);

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
