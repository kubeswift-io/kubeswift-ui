import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import type { Guest } from '../gen/kubeswift/v1/guest_pb';
import type { Node } from '../gen/kubeswift/v1/cluster_pb';
import { GatewayService } from '../gateway.service';

/**
 * MigrateDialog creates a SwiftMigration for one guest. It loads the member's
 * schedulable nodes (minus the current one) for the target picker, then calls
 * MigrateGuest. A webhook denial (e.g. allowIPChange required) renders inline.
 * Uses native form controls so it needs no Angular Material animations engine.
 */
@Component({
  selector: 'app-migrate-dialog',
  imports: [MatIconModule, MatButtonModule],
  templateUrl: './migrate-dialog.html',
  styleUrl: './migrate-dialog.scss',
})
export class MigrateDialog implements OnInit {
  private readonly gw = inject(GatewayService);
  readonly guest = input.required<Guest>();
  readonly closed = output<void>();

  readonly nodes = signal<Node[]>([]);
  readonly target = signal('');
  readonly mode = signal('auto');
  readonly allowIp = signal(true);
  readonly migrating = signal(false);
  readonly error = signal<string | null>(null);
  readonly loadError = signal<string | null>(null);

  ngOnInit(): void {
    const cluster = this.guest().ref?.cluster ?? '';
    void this.gw.clusters
      .listNodes({ cluster })
      .then((res) => {
        if (res.error) {
          this.loadError.set(res.error.message);
          return;
        }
        const here = this.guest().nodeName;
        const cands = res.nodes.filter((n) => n.schedulable && n.name !== here);
        this.nodes.set(cands);
        if (cands.length) this.target.set(cands[0].name);
      })
      .catch((e: unknown) => this.loadError.set(e instanceof Error ? e.message : String(e)));
  }

  migrate(): void {
    const ref = this.guest().ref;
    if (!ref || !this.target() || this.migrating()) return;
    this.migrating.set(true);
    this.error.set(null);
    void this.gw.guests
      .migrateGuest({
        ref,
        targetNode: this.target(),
        mode: this.mode(),
        allowIpChange: this.allowIp(),
      })
      .then(() => this.closed.emit()) // the live Watch then shows the guest moving
      .catch((e: unknown) => {
        this.error.set(e instanceof Error ? e.message : String(e));
        this.migrating.set(false);
      });
  }

  pick(v: string): void {
    this.target.set(v);
  }
  setMode(v: string): void {
    this.mode.set(v);
  }
}
