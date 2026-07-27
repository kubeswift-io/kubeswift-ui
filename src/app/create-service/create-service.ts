import { Component, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { FormShell } from '../form-shell/form-shell';
import { ResourceForm } from '../resource-form';
import { deepClone, listNames } from '../wizard-util';

type Obj = Record<string, unknown>;
interface KV {
  key: string;
  value: string;
}
interface Port {
  name: string;
  port: number;
  /** IntOrString: a number, or a named container port ("http"). Kept as text. */
  targetPort: string;
  protocol: string;
  /** The loaded entry, so nodePort / appProtocol survive an edit here. */
  raw?: Obj;
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
  readonly ports = signal<Port[]>([{ name: 'http', port: 80, targetPort: '', protocol: 'TCP' }]);
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
    // Only seed the placeholder row when creating. A Service loaded WITHOUT a
    // selector is deliberate (manual Endpoints, ExternalName) — stamping
    // `selector: {app: ""}` onto it would detach its Endpoints.
    this.selector.set(kv.length ? kv : this.isEdit() ? [] : [{ key: 'app', value: '' }]);
    const ports = (spec['ports'] ?? []) as Obj[];
    const ps = ports.map((p) => ({
      name: String(p['name'] ?? ''),
      port: Number(p['port'] ?? 0),
      targetPort: p['targetPort'] == null ? '' : String(p['targetPort']),
      protocol: String(p['protocol'] ?? 'TCP'),
      raw: p,
    }));
    this.ports.set(ps.length ? ps : [{ name: 'http', port: 80, targetPort: '', protocol: 'TCP' }]);
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
      if (Object.keys(sel).length) spec['selector'] = sel;
      else delete spec['selector'];
      spec['ports'] = this.ports()
        .filter((p) => p.port > 0)
        .map((p) => {
          // Merge onto the loaded entry: a pinned nodePort (which external LBs
          // and firewall rules reference) and appProtocol are not modelled here,
          // and rebuilding the entry made the apiserver reallocate the nodePort.
          const o = (p.raw ? deepClone(p.raw) : {}) as Obj;
          o['port'] = p.port;
          o['protocol'] = p.protocol || 'TCP';
          if (p.name.trim()) o['name'] = p.name.trim();
          else delete o['name'];
          const tp = p.targetPort.trim();
          if (tp) o['targetPort'] = Number(tp) || tp; // numeric, else a named port
          else delete o['targetPort'];
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
    this.ports.update((p) => [...p, { name: '', port: 0, targetPort: '', protocol: 'TCP' }]);
  }
  removePort(i: number): void {
    this.ports.update((p) => p.filter((_, j) => j !== i));
  }
  setPort(i: number, field: 'name' | 'port' | 'targetPort' | 'protocol', val: string): void {
    this.ports.update((p) =>
      p.map((pt, j) => (j === i ? { ...pt, [field]: field === 'port' ? +val || 0 : val } : pt)),
    );
  }
}
