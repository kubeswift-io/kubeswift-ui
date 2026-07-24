import { Component, effect, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';
import { listNames } from '../wizard-util';
import type { Cluster } from '../gen/kubeswift/v1/cluster_pb';

type Boot = 'image' | 'kernel';
interface Port {
  name: string;
  port: number;
  targetPort: number;
  protocol: string;
}

/**
 * CreateGuestPool is the guided Create wizard for a SwiftGuestPool — N replicas
 * of a guest template with rolling updates, node spread, and an optional selector
 * Service. The template is a SwiftGuest spec (boot source, guest class, seed,
 * GPU); pool-level service ports are injected into each replica by the pool
 * controller. Submits via ResourceService.ApplyResource as the signed-in user.
 */
@Component({
  selector: 'app-create-guestpool',
  imports: [MatIconModule],
  templateUrl: './create-guestpool.html',
  styleUrl: '../wizard.scss',
})
export class CreateGuestPool {
  private readonly gw = inject(GatewayService);
  readonly clusters = input.required<Cluster[]>();
  readonly initialCluster = input<string>('');
  readonly initialNamespace = input<string>('');
  readonly created = output<void>();
  readonly closed = output<void>();
  readonly advanced = output<void>();

  readonly cluster = signal('');
  readonly namespace = signal('default');
  readonly name = signal('');
  readonly replicas = signal<number>(2);
  readonly spreadPolicy = signal('Pack');
  // Guest template.
  readonly boot = signal<Boot>('image');
  readonly imageRef = signal('');
  readonly kernelRef = signal('');
  readonly guestClass = signal('');
  readonly seedRef = signal('');
  readonly gpuRef = signal('');
  readonly runPolicy = signal('Running');
  readonly osType = signal('linux');
  // Optional selector Service.
  readonly serviceEnabled = signal(false);
  readonly serviceType = signal('ClusterIP');
  readonly headless = signal(false);
  readonly ports = signal<Port[]>([{ name: 'http', port: 80, targetPort: 0, protocol: 'TCP' }]);

  // Pickers.
  readonly namespaces = signal<string[]>([]);
  readonly images = signal<string[]>([]);
  readonly kernels = signal<string[]>([]);
  readonly guestClasses = signal<string[]>([]);
  readonly seeds = signal<string[]>([]);
  readonly gpuProfiles = signal<string[]>([]);

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      const cs = this.clusters();
      if (this.cluster() || cs.length === 0) return;
      const first = this.initialCluster() || cs.find((c) => c.ready)?.name || cs[0]?.name || '';
      if (first) {
        this.cluster.set(first);
        if (this.initialNamespace()) this.namespace.set(this.initialNamespace());
        void this.loadPickers(first);
      }
    });
  }

  async selectCluster(c: string): Promise<void> {
    this.cluster.set(c);
    await this.loadPickers(c);
  }
  async selectNamespace(ns: string): Promise<void> {
    this.namespace.set(ns);
    await this.loadNamespaced(this.cluster(), ns);
  }
  private async loadPickers(cluster: string): Promise<void> {
    // guestclasses are cluster-scoped; the rest are namespace-scoped.
    const gc = listNames(this.gw, cluster, 'swiftguestclasses');
    const ns = listNames(this.gw, cluster, 'namespaces');
    await Promise.all([gc.then((v) => this.guestClasses.set(v)), ns.then((v) => this.namespaces.set(v))]);
    await this.loadNamespaced(cluster, this.namespace());
  }
  private async loadNamespaced(cluster: string, ns: string): Promise<void> {
    const [img, krn, seed, gpu] = await Promise.all([
      listNames(this.gw, cluster, 'swiftimages', ns),
      listNames(this.gw, cluster, 'swiftkernels', ns),
      listNames(this.gw, cluster, 'swiftseedprofiles', ns),
      listNames(this.gw, cluster, 'swiftgpuprofiles', ns),
    ]);
    this.images.set(img);
    this.kernels.set(krn);
    this.seeds.set(seed);
    this.gpuProfiles.set(gpu);
  }

  addPort(): void {
    this.ports.update((ps) => [...ps, { name: '', port: 0, targetPort: 0, protocol: 'TCP' }]);
  }
  removePort(i: number): void {
    this.ports.update((ps) => ps.filter((_, j) => j !== i));
  }
  setPort(i: number, key: keyof Port, val: string): void {
    this.ports.update((ps) =>
      ps.map((p, j) =>
        j === i ? { ...p, [key]: key === 'name' || key === 'protocol' ? val : +val || 0 } : p,
      ),
    );
  }

  canCreate(): boolean {
    if (!this.cluster() || !this.namespace() || !this.name().trim() || !this.guestClass()) {
      return false;
    }
    if (this.replicas() < 0) return false;
    if (this.boot() === 'image' && !this.imageRef()) return false;
    if (this.boot() === 'kernel' && !this.kernelRef()) return false;
    if (this.serviceEnabled() && !this.ports().some((p) => p.port > 0)) return false;
    return true;
  }

  async create(): Promise<void> {
    if (!this.canCreate() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);

    const gspec: Record<string, unknown> = {
      guestClassRef: { name: this.guestClass() },
      runPolicy: this.runPolicy(),
    };
    if (this.boot() === 'image') {
      gspec['imageRef'] = { name: this.imageRef() };
      if (this.gpuRef()) gspec['gpuProfileRef'] = { name: this.gpuRef() };
    } else {
      gspec['kernelRef'] = { name: this.kernelRef() };
    }
    if (this.seedRef()) gspec['seedProfileRef'] = { name: this.seedRef() };
    if (this.osType() !== 'linux') gspec['osType'] = this.osType();

    const spec: Record<string, unknown> = {
      replicas: Math.floor(this.replicas()),
      spreadPolicy: this.spreadPolicy(),
      template: { spec: gspec },
    };
    if (this.serviceEnabled()) {
      const ports = this.ports()
        .filter((p) => p.port > 0)
        .map((p) => {
          const o: Record<string, unknown> = { port: p.port };
          if (p.name.trim()) o['name'] = p.name.trim();
          if (p.targetPort > 0) o['targetPort'] = p.targetPort;
          if (p.protocol && p.protocol !== 'TCP') o['protocol'] = p.protocol;
          return o;
        });
      const svc: Record<string, unknown> = { type: this.serviceType(), ports };
      if (this.headless()) svc['headless'] = true;
      spec['service'] = svc;
    }

    const obj = {
      apiVersion: 'swift.kubeswift.io/v1alpha1',
      kind: 'SwiftGuestPool',
      metadata: { name: this.name().trim(), namespace: this.namespace() },
      spec,
    };

    try {
      await this.gw.resources.applyResource({
        cluster: this.cluster(),
        kind: 'swiftguestpools',
        namespace: this.namespace(),
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
