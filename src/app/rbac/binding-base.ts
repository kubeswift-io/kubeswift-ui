import { Directive, signal } from '@angular/core';
import { ResourceForm } from '../resource-form';
import { listNames } from '../wizard-util';

type Obj = Record<string, unknown>;
export interface Subject {
  kind: string; // ServiceAccount | User | Group
  name: string;
  namespace: string;
}

/** BindingFormBase — shared logic + template for RoleBinding and ClusterRoleBinding. */
@Directive()
export abstract class BindingFormBase extends ResourceForm {
  readonly apiVersion = 'rbac.authorization.k8s.io/v1';
  abstract readonly label: string;
  abstract readonly allowRoleKind: boolean; // RoleBinding may target Role or ClusterRole

  readonly roleRefKind = signal('ClusterRole');
  readonly roleRefName = signal('');
  readonly subjects = signal<Subject[]>([{ kind: 'ServiceAccount', name: '', namespace: '' }]);
  readonly namespaces = signal<string[]>([]);

  protected override async onCluster(cluster: string): Promise<void> {
    if (this.namespaced) this.namespaces.set(await listNames(this.gw, cluster, 'namespaces'));
  }

  hydrate(obj: Obj): void {
    const rr = (obj['roleRef'] ?? {}) as Obj;
    this.roleRefKind.set(String(rr['kind'] ?? (this.allowRoleKind ? 'Role' : 'ClusterRole')));
    this.roleRefName.set(String(rr['name'] ?? ''));
    const subs = ((obj['subjects'] ?? []) as Obj[]).map((s) => ({
      kind: String(s['kind'] ?? 'ServiceAccount'),
      name: String(s['name'] ?? ''),
      namespace: String(s['namespace'] ?? ''),
    }));
    this.subjects.set(subs.length ? subs : [{ kind: 'ServiceAccount', name: '', namespace: '' }]);
  }

  build(base: Obj): Obj {
    base['roleRef'] = {
      apiGroup: 'rbac.authorization.k8s.io',
      kind: this.allowRoleKind ? this.roleRefKind() : 'ClusterRole',
      name: this.roleRefName().trim(),
    };
    base['subjects'] = this.subjects()
      .filter((s) => s.name.trim())
      .map((s) => {
        if (s.kind === 'ServiceAccount') {
          return {
            kind: 'ServiceAccount',
            name: s.name.trim(),
            namespace: s.namespace.trim() || (this.namespaced ? this.namespace() : 'default'),
          };
        }
        return { apiGroup: 'rbac.authorization.k8s.io', kind: s.kind, name: s.name.trim() };
      });
    return base;
  }

  canSave(): boolean {
    if (!this.cluster() || !this.name().trim() || !this.roleRefName().trim()) return false;
    if (this.namespaced && !this.namespace()) return false;
    return this.subjects().some((s) => s.name.trim());
  }

  addSubject(): void {
    this.subjects.update((s) => [...s, { kind: 'ServiceAccount', name: '', namespace: '' }]);
  }
  removeSubject(i: number): void {
    this.subjects.update((s) => s.filter((_, j) => j !== i));
  }
  setSubject(i: number, field: keyof Subject, v: string): void {
    this.subjects.update((s) => s.map((sub, j) => (j === i ? { ...sub, [field]: v } : sub)));
  }
}
