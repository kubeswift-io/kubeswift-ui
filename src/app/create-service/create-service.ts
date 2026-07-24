import { Component, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { FormShell } from '../form-shell/form-shell';
import { ResourceForm } from '../resource-form';
import { listNames } from '../wizard-util';

type Obj = Record<string, unknown>;
interface KV {
  key: string;
  value: string;
}
interface Port {
  name: string;
  port: number;
  targetPort: number;
  protocol: string;
}

/**
 * CreateService is the guided create/edit form for a core Service — type, a
 * label selector, and a ports table (or an ExternalName alias). Extends
 * ResourceForm; merge-on-edit preserves other spec fields (clusterIP, etc.).
 */
@Component({
  selector: 'app-create-service',
  imports: [MatIconModule, FormShell],
  templateUrl: './create-service.html',
  styleUrl: '../wizard.scss',
})
export class CreateService extends ResourceForm {
  readonly kindKey = 'services';
  readonly apiVersion = 'v1';
  readonly kindName = 'Service';
  readonly namespaced = true;

  readonly svcType = signal('ClusterIP');
  readonly externalName = signal('');
  readonly selector = signal<KV[]>([{ key: 'app', value: '' }]);
  readonly ports = signal<Port[]>([{ name: 'http', port: 80, targetPort: 0, protocol: 'TCP' }]);
  readonly namespaces = signal<string[]>([]);

  protected override async onCluster(cluster: string): Promise<void> {
    this.namespaces.set(await listNames(this.gw, cluster, 'namespaces'));
  }

  isExternalName(): boolean {
    return this.svcType() === 'ExternalName';
  }

  hydrate(obj: Obj): void {
    const spec = (obj['spec'] ?? {}) as Obj;
    this.svcType.set(String(spec['type'] ?? 'ClusterIP'));
    this.externalName.set(String(spec['externalName'] ?? ''));
    const sel = (spec['selector'] ?? {}) as Record<string, unknown>;
    const kv = Object.entries(sel).map(([key, value]) => ({ key, value: String(value) }));
    this.selector.set(kv.length ? kv : [{ key: 'app', value: '' }]);
    const ports = (spec['ports'] ?? []) as Obj[];
    const ps = ports.map((p) => ({
      name: String(p['name'] ?? ''),
      port: Number(p['port'] ?? 0),
      targetPort: Number(p['targetPort'] ?? 0) || 0,
      protocol: String(p['protocol'] ?? 'TCP'),
    }));
    this.ports.set(ps.length ? ps : [{ name: 'http', port: 80, targetPort: 0, protocol: 'TCP' }]);
  }

  build(base: Obj): Obj {
    const spec = (base['spec'] = (base['spec'] ?? {}) as Obj) as Obj;
    spec['type'] = this.svcType();
    if (this.isExternalName()) {
      spec['externalName'] = this.externalName().trim();
      delete spec['selector'];
      delete spec['ports'];
    } else {
      delete spec['externalName'];
      const sel: Record<string, string> = {};
      for (const s of this.selector()) if (s.key.trim()) sel[s.key.trim()] = s.value;
      spec['selector'] = sel;
      spec['ports'] = this.ports()
        .filter((p) => p.port > 0)
        .map((p) => {
          const o: Obj = { port: p.port, protocol: p.protocol || 'TCP' };
          if (p.name.trim()) o['name'] = p.name.trim();
          if (p.targetPort > 0) o['targetPort'] = p.targetPort;
          return o;
        });
    }
    return base;
  }

  canSave(): boolean {
    if (!this.cluster() || !this.namespace() || !this.name().trim()) return false;
    if (this.isExternalName()) return !!this.externalName().trim();
    return this.ports().some((p) => p.port > 0);
  }

  addSel(): void {
    this.selector.update((s) => [...s, { key: '', value: '' }]);
  }
  removeSel(i: number): void {
    this.selector.update((s) => s.filter((_, j) => j !== i));
  }
  setSel(i: number, field: keyof KV, val: string): void {
    this.selector.update((s) => s.map((kv, j) => (j === i ? { ...kv, [field]: val } : kv)));
  }
  addPort(): void {
    this.ports.update((p) => [...p, { name: '', port: 0, targetPort: 0, protocol: 'TCP' }]);
  }
  removePort(i: number): void {
    this.ports.update((p) => p.filter((_, j) => j !== i));
  }
  setPort(i: number, field: keyof Port, val: string): void {
    this.ports.update((p) =>
      p.map((pt, j) =>
        j === i ? { ...pt, [field]: field === 'name' || field === 'protocol' ? val : +val || 0 } : pt,
      ),
    );
  }
}
