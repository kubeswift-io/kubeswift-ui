import { Component, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { FormShell } from '../form-shell/form-shell';
import { ResourceForm } from '../resource-form';
import { listNames } from '../wizard-util';

type Obj = Record<string, unknown>;
type Boot = 'image' | 'kernel';
interface Port {
  name: string;
  port: number;
  targetPort: number;
  protocol: string;
}

/** CreateGuestPool — a SwiftGuestPool (N replicas of a guest template + rolling
 *  updates, node spread, optional selector Service). */
@Component({
  selector: 'app-create-guestpool',
  imports: [MatIconModule, FormShell],
  templateUrl: './create-guestpool.html',
  styleUrl: '../wizard.scss',
})
export class CreateGuestPool extends ResourceForm {
  readonly kindKey = 'swiftguestpools';
  readonly apiVersion = 'swift.kubeswift.io/v1alpha1';
  readonly kindName = 'SwiftGuestPool';
  readonly namespaced = true;

  readonly replicas = signal<number>(2);
  readonly spreadPolicy = signal('Pack');
  readonly boot = signal<Boot>('image');
  readonly imageRef = signal('');
  readonly kernelRef = signal('');
  readonly guestClass = signal('');
  readonly seedRef = signal('');
  readonly gpuRef = signal('');
  readonly runPolicy = signal('Running');
  readonly osType = signal('linux');
  readonly serviceEnabled = signal(false);
  readonly serviceType = signal('ClusterIP');
  readonly headless = signal(false);
  readonly ports = signal<Port[]>([{ name: 'http', port: 80, targetPort: 0, protocol: 'TCP' }]);

  readonly namespaces = signal<string[]>([]);
  readonly images = signal<string[]>([]);
  readonly kernels = signal<string[]>([]);
  readonly guestClasses = signal<string[]>([]);
  readonly seeds = signal<string[]>([]);
  readonly gpuProfiles = signal<string[]>([]);

  protected override async onCluster(cluster: string): Promise<void> {
    // guestclasses are cluster-scoped; the rest are namespace-scoped.
    const [gc, ns] = await Promise.all([
      listNames(this.gw, cluster, 'swiftguestclasses'),
      listNames(this.gw, cluster, 'namespaces'),
    ]);
    this.guestClasses.set(gc);
    this.namespaces.set(ns);
    await this.loadNamespaced(cluster, this.namespace());
  }

  async selectNamespace(ns: string): Promise<void> {
    this.namespace.set(ns);
    await this.loadNamespaced(this.cluster(), ns);
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

  hydrate(obj: Obj): void {
    const spec = (obj['spec'] ?? {}) as Obj;
    this.replicas.set(Number(spec['replicas'] ?? 2));
    this.spreadPolicy.set(String(spec['spreadPolicy'] ?? 'Pack'));
    const g = (((spec['template'] ?? {}) as Obj)['spec'] ?? {}) as Obj;
    this.guestClass.set(String(((g['guestClassRef'] ?? {}) as Obj)['name'] ?? ''));
    this.runPolicy.set(String(g['runPolicy'] ?? 'Running'));
    this.osType.set(String(g['osType'] ?? 'linux'));
    if (g['kernelRef']) {
      this.boot.set('kernel');
      this.kernelRef.set(String((g['kernelRef'] as Obj)['name'] ?? ''));
    } else {
      this.boot.set('image');
      this.imageRef.set(String(((g['imageRef'] ?? {}) as Obj)['name'] ?? ''));
      this.gpuRef.set(String(((g['gpuProfileRef'] ?? {}) as Obj)['name'] ?? ''));
    }
    this.seedRef.set(String(((g['seedProfileRef'] ?? {}) as Obj)['name'] ?? ''));
    const svc = spec['service'] as Obj | undefined;
    if (svc) {
      this.serviceEnabled.set(true);
      this.serviceType.set(String(svc['type'] ?? 'ClusterIP'));
      this.headless.set(!!svc['headless']);
      const ports = ((svc['ports'] ?? []) as Obj[]).map((p) => ({
        name: String(p['name'] ?? ''),
        port: Number(p['port'] ?? 0),
        targetPort: Number(p['targetPort'] ?? 0),
        protocol: String(p['protocol'] ?? 'TCP'),
      }));
      if (ports.length) this.ports.set(ports);
    } else {
      this.serviceEnabled.set(false);
    }
  }

  build(base: Obj): Obj {
    const spec = (base['spec'] = (base['spec'] ?? {}) as Obj) as Obj;
    const g: Obj = { guestClassRef: { name: this.guestClass() }, runPolicy: this.runPolicy() };
    if (this.boot() === 'image') {
      g['imageRef'] = { name: this.imageRef() };
      if (this.gpuRef()) g['gpuProfileRef'] = { name: this.gpuRef() };
      if (this.osType() !== 'linux') g['osType'] = this.osType();
    } else {
      g['kernelRef'] = { name: this.kernelRef() };
    }
    if (this.seedRef()) g['seedProfileRef'] = { name: this.seedRef() };

    spec['replicas'] = Math.floor(this.replicas());
    spec['spreadPolicy'] = this.spreadPolicy();
    spec['template'] = { spec: g };
    if (this.serviceEnabled()) {
      const ports = this.ports()
        .filter((p) => p.port > 0)
        .map((p) => {
          const o: Obj = { port: p.port };
          if (p.name.trim()) o['name'] = p.name.trim();
          if (p.targetPort > 0) o['targetPort'] = p.targetPort;
          if (p.protocol && p.protocol !== 'TCP') o['protocol'] = p.protocol;
          return o;
        });
      const svc: Obj = { type: this.serviceType(), ports };
      if (this.headless()) svc['headless'] = true;
      spec['service'] = svc;
    } else {
      delete spec['service'];
    }
    return base;
  }

  canSave(): boolean {
    if (!this.cluster() || !this.namespace() || !this.name().trim() || !this.guestClass())
      return false;
    if (this.replicas() < 0) return false;
    if (this.boot() === 'image' && !this.imageRef()) return false;
    if (this.boot() === 'kernel' && !this.kernelRef()) return false;
    if (this.serviceEnabled() && !this.ports().some((p) => p.port > 0)) return false;
    return true;
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
}
