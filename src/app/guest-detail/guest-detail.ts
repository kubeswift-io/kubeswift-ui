import { Component, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { timestampDate } from '@bufbuild/protobuf/wkt';
import type { Guest } from '../gen/kubeswift/v1/guest_pb';

/**
 * GuestDetail is the right slide-in drawer for one VM. It opens instantly from
 * the inventory row's data; the Fleet page then refreshes it via GetGuestDetail
 * so it auto-enriches once the backend aggregation (pod / events / gpu /
 * storage) lands on that RPC.
 */
@Component({
  selector: 'app-guest-detail',
  imports: [MatIconModule, MatButtonModule],
  templateUrl: './guest-detail.html',
  styleUrl: './guest-detail.scss',
})
export class GuestDetail {
  readonly guest = input.required<Guest>();
  readonly closed = output<void>();

  created(): string {
    const ts = this.guest().createdAt;
    return ts ? timestampDate(ts).toLocaleString() : '—';
  }

  labelEntries(): { k: string; v: string }[] {
    return Object.entries(this.guest().labels ?? {}).map(([k, v]) => ({ k, v }));
  }
}
