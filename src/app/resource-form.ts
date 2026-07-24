import { Directive, effect, inject, input, output, signal } from '@angular/core';
import { GatewayService } from './gateway.service';
import { toYaml, fromYaml, deepClone } from './wizard-util';
import type { Cluster } from './gen/kubeswift/v1/cluster_pb';

type View = 'form' | 'yaml';
type Obj = Record<string, unknown>;

/**
 * ResourceForm is the shared base for every guided create/edit form. It owns the
 * cluster/namespace/name identity, the Form⇄YAML toggle, and the save flow — so
 * a concrete form only supplies its fields plus three hooks:
 *
 *   - kind metadata (kindKey / apiVersion / kindName / namespaced)
 *   - hydrate(obj): populate the field signals from a loaded object (edit mode)
 *   - build(base):  MERGE the fields onto `base` and return it — never rebuild.
 *     `base` is the loaded object in edit mode (a deep clone), so any field the
 *     form does not model is preserved. In create mode it's a minimal skeleton.
 *
 * Edit mode is entered by passing `existing` (the object's JSON). The Form⇄YAML
 * toggle round-trips through build()/hydrate(), and YAML remains the source of
 * truth for anything the form doesn't model. Every apply runs as the signed-in
 * user (ResourceService.ApplyResource) — a denial surfaces in the banner.
 */
@Directive()
export abstract class ResourceForm {
  protected readonly gw = inject(GatewayService);

  readonly clusters = input.required<Cluster[]>();
  readonly initialCluster = input<string>('');
  readonly initialNamespace = input<string>('');
  readonly existing = input<string>(''); // JSON of the loaded object; '' = create
  readonly canWrite = input<boolean>(true);
  readonly saved = output<void>();
  readonly closed = output<void>();

  readonly cluster = signal('');
  readonly namespace = signal('default');
  readonly name = signal('');
  readonly view = signal<View>('form');
  readonly yamlText = signal('');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  // The loaded object in edit mode (null in create). build() merges onto a clone.
  protected base: Obj | null = null;

  // Concrete-form contract.
  abstract readonly kindKey: string; // catalog key for ApplyResource
  abstract readonly apiVersion: string;
  abstract readonly kindName: string;
  abstract readonly namespaced: boolean;
  abstract hydrate(obj: Obj): void;
  abstract build(base: Obj): Obj;
  abstract canSave(): boolean;

  isEdit(): boolean {
    return !!this.existing();
  }

  constructor() {
    effect(() => {
      const cs = this.clusters();
      if (this.cluster() || cs.length === 0) return;
      const first = this.initialCluster() || cs.find((c) => c.ready)?.name || cs[0]?.name || '';
      if (!first) return;
      this.cluster.set(first);
      const ex = this.existing();
      if (ex) {
        const obj = JSON.parse(ex) as Obj;
        this.base = obj;
        const md = (obj['metadata'] ?? {}) as Obj;
        this.name.set(String(md['name'] ?? ''));
        this.namespace.set(String(md['namespace'] ?? this.initialNamespace() ?? 'default'));
        this.hydrate(obj);
      } else if (this.initialNamespace()) {
        this.namespace.set(this.initialNamespace());
      }
      void this.onCluster(first);
    });
  }

  // Forms override to (re)load their pickers when the cluster changes.
  protected async onCluster(_cluster: string): Promise<void> {}

  async selectCluster(c: string): Promise<void> {
    this.cluster.set(c);
    await this.onCluster(c);
  }

  private skeleton(): Obj {
    const metadata: Obj = { name: this.name().trim() };
    if (this.namespaced) metadata['namespace'] = this.namespace();
    return { apiVersion: this.apiVersion, kind: this.kindName, metadata };
  }

  protected currentBase(): Obj {
    return this.base ? deepClone(this.base) : this.skeleton();
  }

  /** The object the form currently represents: fields merged onto the base. */
  buildObject(): Obj {
    const b = this.build(this.currentBase());
    const md = (b['metadata'] = (b['metadata'] ?? {}) as Obj) as Obj;
    md['name'] = this.name().trim();
    if (this.namespaced) md['namespace'] = this.namespace();
    else delete md['namespace'];
    b['apiVersion'] = this.apiVersion;
    b['kind'] = this.kindName;
    return b;
  }

  setView(v: View): void {
    if (v === this.view()) return;
    if (v === 'yaml') {
      this.yamlText.set(toYaml(this.buildObject()));
    } else {
      try {
        const obj = fromYaml(this.yamlText());
        this.base = obj;
        const md = (obj['metadata'] ?? {}) as Obj;
        if (md['name']) this.name.set(String(md['name']));
        this.hydrate(obj);
        this.error.set(null);
      } catch (e) {
        this.error.set('Invalid YAML: ' + (e instanceof Error ? e.message : String(e)));
        return;
      }
    }
    this.view.set(v);
  }

  async save(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const yaml = this.view() === 'yaml' ? this.yamlText() : toYaml(this.buildObject());
      await this.gw.resources.applyResource({
        cluster: this.cluster(),
        kind: this.kindKey,
        namespace: this.namespace(),
        yaml,
      });
      this.saved.emit();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }
}
