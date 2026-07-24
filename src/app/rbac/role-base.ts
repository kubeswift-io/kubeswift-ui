import { Directive, signal } from '@angular/core';
import { ResourceForm } from '../resource-form';
import { listNames } from '../wizard-util';

type Obj = Record<string, unknown>;
export interface PolicyRule {
  apiGroups: string;
  resources: string;
  verbs: string;
  resourceNames: string;
}

const csv = (s: string): string[] => s.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);

/** RoleFormBase — shared logic + template for Role and ClusterRole. */
@Directive()
export abstract class RoleFormBase extends ResourceForm {
  readonly apiVersion = 'rbac.authorization.k8s.io/v1';
  abstract readonly label: string;

  readonly rules = signal<PolicyRule[]>([{ apiGroups: '', resources: '', verbs: '', resourceNames: '' }]);
  readonly namespaces = signal<string[]>([]);

  protected override async onCluster(cluster: string): Promise<void> {
    if (this.namespaced) this.namespaces.set(await listNames(this.gw, cluster, 'namespaces'));
  }

  hydrate(obj: Obj): void {
    const rules = ((obj['rules'] ?? []) as Obj[]).map((r) => ({
      apiGroups: ((r['apiGroups'] ?? []) as string[]).join(', '),
      resources: ((r['resources'] ?? []) as string[]).join(', '),
      verbs: ((r['verbs'] ?? []) as string[]).join(', '),
      resourceNames: ((r['resourceNames'] ?? []) as string[]).join(', '),
    }));
    this.rules.set(rules.length ? rules : [{ apiGroups: '', resources: '', verbs: '', resourceNames: '' }]);
  }

  build(base: Obj): Obj {
    base['rules'] = this.rules()
      .filter((r) => csv(r.verbs).length && csv(r.resources).length)
      .map((r) => {
        const ag = csv(r.apiGroups);
        const rn = csv(r.resourceNames);
        return {
          apiGroups: ag.length ? ag : [''], // blank = core group
          resources: csv(r.resources),
          verbs: csv(r.verbs),
          ...(rn.length ? { resourceNames: rn } : {}),
        };
      });
    return base;
  }

  canSave(): boolean {
    if (!this.cluster() || !this.name().trim()) return false;
    if (this.namespaced && !this.namespace()) return false;
    return this.rules().some((r) => csv(r.verbs).length && csv(r.resources).length);
  }

  addRule(): void {
    this.rules.update((r) => [...r, { apiGroups: '', resources: '', verbs: '', resourceNames: '' }]);
  }
  removeRule(i: number): void {
    this.rules.update((r) => r.filter((_, j) => j !== i));
  }
  setRule(i: number, field: keyof PolicyRule, v: string): void {
    this.rules.update((r) => r.map((rule, j) => (j === i ? { ...rule, [field]: v } : rule)));
  }
}
