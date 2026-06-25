import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';

interface RawPool {
  spec?: {
    replicas?: number;
    template?: {
      spec?: {
        imageRef?: { name?: string };
        kernelRef?: { name?: string };
        cloneFromSnapshot?: { snapshotRef?: { name?: string } };
        guestClassRef?: { name?: string };
      };
    };
  };
  status?: {
    replicas?: number;
    readyReplicas?: number;
    availableReplicas?: number;
    failedReplicas?: number;
    serviceRef?: string;
  };
}

/**
 * PoolDrawer is the resource-aware detail drawer for a SwiftGuestPool, opened
 * from the Explorer's Pools kind. It shows replica counts, the template summary
 * and the load-balanced Service, plus a scale control that patches spec.replicas
 * via ApplyResource (SSA — only the replicas field) as the signed-in user.
 */
@Component({
  selector: 'app-pool-drawer',
  imports: [MatIconModule],
  templateUrl: './pool-drawer.html',
  styleUrl: './pool-drawer.scss',
})
export class PoolDrawer implements OnInit {
  private readonly gw = inject(GatewayService);
  readonly cluster = input.required<string>();
  readonly namespace = input.required<string>();
  readonly name = input.required<string>();
  readonly closed = output<void>();
  readonly changed = output<void>();

  readonly desired = signal(0);
  readonly ready = signal(0);
  readonly available = signal(0);
  readonly failed = signal(0);
  readonly guestClass = signal('');
  readonly bootSource = signal('');
  readonly serviceRef = signal('');
  readonly target = signal(0);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  async ngOnInit(): Promise<void> {
    try {
      const r = await this.gw.resources.getResource({
        cluster: this.cluster(),
        kind: 'swiftguestpools',
        namespace: this.namespace(),
        name: this.name(),
      });
      const o = JSON.parse(r.json) as RawPool;
      this.desired.set(o.spec?.replicas ?? 0);
      this.target.set(o.spec?.replicas ?? 0);
      this.ready.set(o.status?.readyReplicas ?? 0);
      this.available.set(o.status?.availableReplicas ?? 0);
      this.failed.set(o.status?.failedReplicas ?? 0);
      this.serviceRef.set(o.status?.serviceRef ?? '');
      this.guestClass.set(o.spec?.template?.spec?.guestClassRef?.name ?? '');
      const ts = o.spec?.template?.spec;
      this.bootSource.set(
        ts?.imageRef?.name
          ? 'image: ' + ts.imageRef.name
          : ts?.kernelRef?.name
            ? 'kernel: ' + ts.kernelRef.name
            : ts?.cloneFromSnapshot?.snapshotRef?.name
              ? 'clone: ' + ts.cloneFromSnapshot.snapshotRef.name
              : '—',
      );
    } catch (e) {
      this.error.set(this.msg(e));
    }
  }

  inc(): void {
    this.target.update((v) => v + 1);
  }
  dec(): void {
    this.target.update((v) => Math.max(0, v - 1));
  }
  dirty(): boolean {
    return this.target() !== this.desired();
  }

  async scale(): Promise<void> {
    if (this.busy() || !this.dirty()) return;
    this.busy.set(true);
    this.error.set(null);
    const obj = {
      apiVersion: 'swift.kubeswift.io/v1alpha1',
      kind: 'SwiftGuestPool',
      metadata: { name: this.name(), namespace: this.namespace() },
      spec: { replicas: this.target() },
    };
    try {
      await this.gw.resources.applyResource({
        cluster: this.cluster(),
        kind: 'swiftguestpools',
        namespace: this.namespace(),
        yaml: JSON.stringify(obj),
      });
      this.desired.set(this.target());
      this.changed.emit();
    } catch (e) {
      this.error.set(this.msg(e));
    } finally {
      this.busy.set(false);
    }
  }

  private msg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }
}
