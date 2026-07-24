import { Component, effect, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';
import { listNames } from '../wizard-util';
import type { Cluster } from '../gen/kubeswift/v1/cluster_pb';

type Src = 'http' | 'oci' | 'pvcClone';

/**
 * CreateImage is the guided Create wizard for a SwiftImage — a VM disk artifact
 * imported from HTTP, an OCI golden image, or a PVC clone, converted to a raw
 * runtime disk. Submits via ResourceService.ApplyResource as the signed-in user.
 */
@Component({
  selector: 'app-create-image',
  imports: [MatIconModule],
  templateUrl: './create-image.html',
  styleUrl: '../wizard.scss',
})
export class CreateImage {
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
  readonly src = signal<Src>('http');
  // http
  readonly url = signal('');
  // oci
  readonly ociRepo = signal('');
  readonly ociTag = signal('');
  readonly ociInsecure = signal(false);
  // pvcClone
  readonly pvcName = signal('');
  readonly pvcNamespace = signal('');
  // common
  readonly format = signal('qcow2');
  readonly osType = signal('linux');
  readonly diskSize = signal('');

  readonly namespaces = signal<string[]>([]);
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
        void this.loadNamespaces(first);
      }
    });
  }

  async selectCluster(c: string): Promise<void> {
    this.cluster.set(c);
    await this.loadNamespaces(c);
  }
  private async loadNamespaces(cluster: string): Promise<void> {
    this.namespaces.set(await listNames(this.gw, cluster, 'namespaces'));
  }

  // Golden OCI images are already raw; default the source-artifact format to raw
  // when the operator picks the OCI source, qcow2 (cloud images) otherwise.
  selectSrc(s: Src): void {
    this.src.set(s);
    this.format.set(s === 'oci' ? 'raw' : 'qcow2');
  }

  canCreate(): boolean {
    if (!this.cluster() || !this.namespace() || !this.name().trim()) return false;
    if (this.src() === 'http') return !!this.url().trim();
    if (this.src() === 'oci') return !!this.ociRepo().trim();
    if (this.src() === 'pvcClone') return !!this.pvcName().trim();
    return false;
  }

  async create(): Promise<void> {
    if (!this.canCreate() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);

    let source: Record<string, unknown>;
    if (this.src() === 'http') {
      source = { http: { url: this.url().trim() } };
    } else if (this.src() === 'oci') {
      const oci: Record<string, unknown> = { repository: this.ociRepo().trim() };
      if (this.ociTag().trim()) oci['tag'] = this.ociTag().trim();
      if (this.ociInsecure()) oci['insecure'] = true;
      source = { oci };
    } else {
      const pvc: Record<string, unknown> = { name: this.pvcName().trim() };
      if (this.pvcNamespace().trim()) pvc['namespace'] = this.pvcNamespace().trim();
      source = { pvcClone: pvc };
    }

    const spec: Record<string, unknown> = { source, format: this.format() };
    if (this.osType() && this.osType() !== 'linux') spec['osType'] = this.osType();
    if (this.diskSize().trim()) spec['rootDisk'] = { size: this.diskSize().trim() };

    const obj = {
      apiVersion: 'image.kubeswift.io/v1alpha1',
      kind: 'SwiftImage',
      metadata: { name: this.name().trim(), namespace: this.namespace() },
      spec,
    };

    try {
      await this.gw.resources.applyResource({
        cluster: this.cluster(),
        kind: 'swiftimages',
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
