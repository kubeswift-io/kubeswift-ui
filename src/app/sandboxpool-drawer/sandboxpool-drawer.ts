import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';

interface RawSandboxPool {
  spec?: {
    image?: string;
    minWarm?: number;
    maxWarm?: number;
    rootfsMode?: string;
    network?: { mode?: string };
    verifyKeySecretRef?: { name?: string };
  };
  status?: {
    phase?: string;
    warmReplicas?: number;
    claimedReplicas?: number;
  };
}

/**
 * SandboxPoolDrawer is the resource-aware detail drawer for a SwiftSandboxPool,
 * opened from the Explorer's Sandbox Pools kind. It shows warm/claimed slot
 * counts and the spec, plus a scale control that patches spec.minWarm via
 * ApplyResource (SSA — the scale subresource's field) as the signed-in user, and
 * a Delete. Mirrors PoolDrawer (which scales SwiftGuestPool.spec.replicas).
 */
@Component({
  selector: 'app-sandboxpool-drawer',
  imports: [MatIconModule],
  templateUrl: './sandboxpool-drawer.html',
  styleUrl: './sandboxpool-drawer.scss',
})
export class SandboxPoolDrawer implements OnInit {
  private readonly gw = inject(GatewayService);
  readonly cluster = input.required<string>();
  readonly namespace = input.required<string>();
  readonly name = input.required<string>();
  readonly closed = output<void>();
  readonly changed = output<void>();

  readonly phase = signal('');
  readonly image = signal('');
  readonly rootfsMode = signal('');
  readonly network = signal('');
  readonly verifyKey = signal('');
  readonly warm = signal(0);
  readonly claimed = signal(0);
  readonly maxWarm = signal(0);
  readonly minWarm = signal(0); // desired
  readonly target = signal(0);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  async ngOnInit(): Promise<void> {
    try {
      const r = await this.gw.resources.getResource({
        cluster: this.cluster(),
        kind: 'swiftsandboxpools',
        namespace: this.namespace(),
        name: this.name(),
      });
      const o = JSON.parse(r.json) as RawSandboxPool;
      this.phase.set(o.status?.phase ?? '');
      this.image.set(o.spec?.image ?? '');
      this.rootfsMode.set(o.spec?.rootfsMode ?? 'block');
      this.network.set(o.spec?.network?.mode ?? 'restricted');
      this.verifyKey.set(o.spec?.verifyKeySecretRef?.name ?? '');
      this.warm.set(o.status?.warmReplicas ?? 0);
      this.claimed.set(o.status?.claimedReplicas ?? 0);
      this.maxWarm.set(o.spec?.maxWarm ?? 0);
      this.minWarm.set(o.spec?.minWarm ?? 0);
      this.target.set(o.spec?.minWarm ?? 0);
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
    return this.target() !== this.minWarm();
  }

  async scale(): Promise<void> {
    if (this.busy() || !this.dirty()) return;
    this.busy.set(true);
    this.error.set(null);
    const obj = {
      apiVersion: 'sandbox.kubeswift.io/v1alpha1',
      kind: 'SwiftSandboxPool',
      metadata: { name: this.name(), namespace: this.namespace() },
      spec: { minWarm: this.target() },
    };
    try {
      await this.gw.resources.applyResource({
        cluster: this.cluster(),
        kind: 'swiftsandboxpools',
        namespace: this.namespace(),
        yaml: JSON.stringify(obj),
      });
      this.minWarm.set(this.target());
      this.changed.emit();
    } catch (e) {
      this.error.set(this.msg(e));
    } finally {
      this.busy.set(false);
    }
  }

  async del(): Promise<void> {
    if (this.busy() || !confirm(`Delete pool "${this.name()}"? Its warm slots are removed.`))
      return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.gw.resources.deleteResource({
        cluster: this.cluster(),
        kind: 'swiftsandboxpools',
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
