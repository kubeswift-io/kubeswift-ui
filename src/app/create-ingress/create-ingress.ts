import { Component, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { FormShell } from '../form-shell/form-shell';
import { ResourceForm } from '../resource-form';
import { listNames } from '../wizard-util';

type Obj = Record<string, unknown>;
interface Path {
  path: string;
  pathType: string;
  service: string;
  port: string;
}
interface Rule {
  host: string;
  paths: Path[];
}

/** CreateIngress — a networking.k8s.io Ingress (class + host/path rules + TLS). */
@Component({
  selector: 'app-create-ingress',
  imports: [MatIconModule, FormShell],
  templateUrl: './create-ingress.html',
  styleUrl: '../wizard.scss',
})
export class CreateIngress extends ResourceForm {
  readonly kindKey = 'ingresses';
  readonly apiVersion = 'networking.k8s.io/v1';
  readonly kindName = 'Ingress';
  readonly namespaced = true;

  readonly className = signal('');
  readonly rules = signal<Rule[]>([{ host: '', paths: [this.newPath()] }]);
  readonly tlsSecret = signal('');
  readonly tlsHosts = signal('');
  readonly namespaces = signal<string[]>([]);

  private newPath(): Path {
    return { path: '/', pathType: 'Prefix', service: '', port: '80' };
  }

  protected override async onCluster(cluster: string): Promise<void> {
    this.namespaces.set(await listNames(this.gw, cluster, 'namespaces'));
  }

  hydrate(obj: Obj): void {
    const spec = (obj['spec'] ?? {}) as Obj;
    this.className.set(String(spec['ingressClassName'] ?? ''));
    const rules = ((spec['rules'] ?? []) as Obj[]).map((r) => {
      const http = (r['http'] ?? {}) as Obj;
      const paths = ((http['paths'] ?? []) as Obj[]).map((p) => {
        const be = ((p['backend'] as Obj)?.['service'] ?? {}) as Obj;
        return {
          path: String(p['path'] ?? '/'),
          pathType: String(p['pathType'] ?? 'Prefix'),
          service: String(be['name'] ?? ''),
          port: String(((be['port'] as Obj)?.['number'] ?? (be['port'] as Obj)?.['name']) ?? ''),
        };
      });
      return { host: String(r['host'] ?? ''), paths: paths.length ? paths : [this.newPath()] };
    });
    this.rules.set(rules.length ? rules : [{ host: '', paths: [this.newPath()] }]);
    const tls = ((spec['tls'] ?? []) as Obj[])[0] as Obj | undefined;
    this.tlsSecret.set(String(tls?.['secretName'] ?? ''));
    this.tlsHosts.set(((tls?.['hosts'] ?? []) as string[]).join(','));
  }

  build(base: Obj): Obj {
    const spec = (base['spec'] = (base['spec'] ?? {}) as Obj) as Obj;
    if (this.className().trim()) spec['ingressClassName'] = this.className().trim();
    else delete spec['ingressClassName'];
    spec['rules'] = this.rules().map((r) => ({
      ...(r.host.trim() ? { host: r.host.trim() } : {}),
      http: {
        paths: r.paths
          .filter((p) => p.service.trim())
          .map((p) => {
            const portNum = Number(p.port);
            const port = Number.isFinite(portNum) && String(portNum) === p.port.trim() ? { number: portNum } : { name: p.port.trim() };
            return {
              path: p.path.trim() || '/',
              pathType: p.pathType,
              backend: { service: { name: p.service.trim(), port } },
            };
          }),
      },
    }));
    if (this.tlsSecret().trim()) {
      const hosts = this.tlsHosts().split(',').map((h) => h.trim()).filter(Boolean);
      spec['tls'] = [{ secretName: this.tlsSecret().trim(), ...(hosts.length ? { hosts } : {}) }];
    } else {
      delete spec['tls'];
    }
    return base;
  }

  canSave(): boolean {
    return !!(
      this.cluster() && this.namespace() && this.name().trim() &&
      this.rules().some((r) => r.paths.some((p) => p.service.trim()))
    );
  }

  addRule(): void {
    this.rules.update((r) => [...r, { host: '', paths: [this.newPath()] }]);
  }
  removeRule(i: number): void {
    this.rules.update((r) => r.filter((_, j) => j !== i));
  }
  setHost(i: number, v: string): void {
    this.rules.update((r) => r.map((rule, j) => (j === i ? { ...rule, host: v } : rule)));
  }
  addPath(ri: number): void {
    this.rules.update((r) => r.map((rule, j) => (j === ri ? { ...rule, paths: [...rule.paths, this.newPath()] } : rule)));
  }
  removePath(ri: number, pi: number): void {
    this.rules.update((r) => r.map((rule, j) => (j === ri ? { ...rule, paths: rule.paths.filter((_, k) => k !== pi) } : rule)));
  }
  setPath(ri: number, pi: number, field: keyof Path, v: string): void {
    this.rules.update((r) =>
      r.map((rule, j) =>
        j === ri ? { ...rule, paths: rule.paths.map((p, k) => (k === pi ? { ...p, [field]: v } : p)) } : rule,
      ),
    );
  }
}
