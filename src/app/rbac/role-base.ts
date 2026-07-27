import { Directive, signal } from '@angular/core';
import { ResourceForm } from '../resource-form';
import { deepClone, listNames } from '../wizard-util';

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
  /**
   * Rules the editor cannot represent, carried through verbatim. A
   * nonResourceURLs rule (/metrics, /healthz, /version) has no `resources`, so
   * both the row mapping and the save-time filter would drop it — silently
   * revoking a scrape or health-probe grant on an unrelated edit.
   */
  readonly passthroughRules = signal<Obj[]>([]);

  protected override async onCluster(cluster: string): Promise<void> {
    if (this.namespaced) this.namespaces.set(await listNames(this.gw, cluster, 'namespaces'));
  }

  hydrate(obj: Obj): void {
    const all = (obj['rules'] ?? []) as Obj[];
    this.passthroughRules.set(all.filter((r) => !!r['nonResourceURLs']));
    const rules = all
      .filter((r) => !r['nonResourceURLs'])
      .map((r) => ({
        apiGroups: ((r['apiGroups'] ?? []) as string[]).join(', '),
        resources: ((r['resources'] ?? []) as string[]).join(', '),
        verbs: ((r['verbs'] ?? []) as string[]).join(', '),
        resourceNames: ((r['resourceNames'] ?? []) as string[]).join(', '),
      }));
    this.rules.set(rules.length ? rules : [{ apiGroups: '', resources: '', verbs: '', resourceNames: '' }]);
  }

  build(base: Obj): Obj {
    const edited = this.rules()
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
    base['rules'] = [...edited, ...deepClone(this.passthroughRules())];
    return base;
  }

  canSave(): boolean {
    if (!this.cluster() || !this.name().trim()) return false;
    if (this.namespaced && !this.namespace()) return false;
    // Preserved non-resource rules count: a ClusterRole made up ONLY of
    // nonResourceURLs grants is otherwise unsavable here, since it has no row
    // the editor can represent.
    if (this.passthroughRules().length) return true;
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
