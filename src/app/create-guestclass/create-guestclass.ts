import { Component, effect, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';
import type { Cluster } from '../gen/kubeswift/v1/cluster_pb';

/**
 * CreateGuestClass is the guided Create wizard for a SwiftGuestClass — the
 * cluster-scoped resource/storage template SwiftGuests reference. It submits the
 * built object via ResourceService.ApplyResource (as the signed-in user, so
 * member RBAC + the webhook gate the create; denials surface in the banner).
 * Cluster-scoped, so there is no namespace picker.
 */
@Component({
  selector: 'app-create-guestclass',
  imports: [MatIconModule],
  templateUrl: './create-guestclass.html',
  styleUrl: '../wizard.scss',
})
export class CreateGuestClass {
  private readonly gw = inject(GatewayService);
  readonly clusters = input.required<Cluster[]>();
  readonly initialCluster = input<string>('');
  readonly initialNamespace = input<string>('');
  readonly created = output<void>();
  readonly closed = output<void>();
  readonly advanced = output<void>();

  readonly cluster = signal('');
  readonly name = signal('');
  readonly cpu = signal<number>(2);
  readonly memory = signal('2Gi');
  readonly diskSize = signal('20Gi');
  readonly diskFormat = signal('raw');
  readonly coreScheduling = signal('off');
  // Storage defaults (all optional).
  readonly accessMode = signal('');
  readonly volumeMode = signal('');
  readonly storageClass = signal('');

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      const cs = this.clusters();
      if (this.cluster() || cs.length === 0) return;
      const first = this.initialCluster() || cs.find((c) => c.ready)?.name || cs[0]?.name || '';
      if (first) this.cluster.set(first);
    });
  }

  canCreate(): boolean {
    return !!(
      this.cluster() &&
      this.name().trim() &&
      this.cpu() > 0 &&
      this.memory().trim() &&
      this.diskSize().trim()
    );
  }

  async create(): Promise<void> {
    if (!this.canCreate() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);

    const spec: Record<string, unknown> = {
      cpu: String(Math.floor(this.cpu())),
      memory: this.memory().trim(),
      rootDisk: { size: this.diskSize().trim(), format: this.diskFormat() },
    };
    if (this.coreScheduling() && this.coreScheduling() !== 'off') {
      spec['coreScheduling'] = this.coreScheduling();
    }
    const storage: Record<string, unknown> = {};
    if (this.accessMode()) storage['accessMode'] = this.accessMode();
    if (this.volumeMode()) storage['volumeMode'] = this.volumeMode();
    if (this.storageClass().trim()) storage['storageClassName'] = this.storageClass().trim();
    if (Object.keys(storage).length) spec['storage'] = storage;

    const obj = {
      apiVersion: 'swift.kubeswift.io/v1alpha1',
      kind: 'SwiftGuestClass',
      metadata: { name: this.name().trim() },
      spec,
    };

    try {
      await this.gw.resources.applyResource({
        cluster: this.cluster(),
        kind: 'swiftguestclasses',
        namespace: '',
        yaml: JSON.stringify(obj),
      });
      this.created.emit();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }
}
