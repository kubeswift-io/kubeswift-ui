import { Component, effect, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';
import type { ResourceKind } from '../gen/kubeswift/v1/resource_pb';

/**
 * YamlEditor is the right slide-in for viewing/editing/creating one object.
 * Edit loads the YAML via GetResource (managedFields stripped, Secret values
 * redacted); Create starts from a minimal skeleton. Save runs ApplyResource
 * (server-side apply) AS THE SIGNED-IN USER — a permission denial surfaces in
 * the banner, never a silent success. No editor library: a monospace textarea,
 * matching the project's no-heavy-deps style.
 */
@Component({
  selector: 'app-yaml-editor',
  imports: [MatIconModule],
  templateUrl: './yaml-editor.html',
  styleUrl: './yaml-editor.scss',
})
export class YamlEditor {
  private readonly gw = inject(GatewayService);
  readonly cluster = input.required<string>();
  readonly kind = input.required<ResourceKind>();
  readonly namespace = input<string>('');
  readonly name = input<string>(''); // '' = create
  readonly saved = output<void>();
  readonly closed = output<void>();

  readonly text = signal<string>('');
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  isCreate(): boolean {
    return !this.name();
  }

  constructor() {
    // Load on open / when the target changes: fetch for edit, skeleton for create.
    effect(() => {
      const cluster = this.cluster();
      const kind = this.kind();
      const name = this.name();
      const ns = this.namespace();
      this.error.set(null);
      if (name) {
        this.loading.set(true);
        this.gw.resources
          .getResource({ cluster, kind: kind.key, namespace: ns, name })
          .then((r) => this.text.set(r.yaml))
          .catch((e: unknown) => this.error.set(this.msg(e)))
          .finally(() => this.loading.set(false));
      } else {
        const apiVersion = kind.group ? `${kind.group}/${kind.version}` : kind.version;
        const nsLine = kind.namespaced ? `\n  namespace: ${ns}` : '';
        this.text.set(
          `apiVersion: ${apiVersion}\nkind: # e.g. ${guessKind(kind.displayName)}\nmetadata:\n  name: ${nsLine}\nspec: {}\n`,
        );
      }
    });
  }

  async save(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.gw.resources.applyResource({
        cluster: this.cluster(),
        kind: this.kind().key,
        namespace: this.namespace(),
        yaml: this.text(),
      });
      this.saved.emit();
    } catch (e: unknown) {
      this.error.set(this.msg(e));
    } finally {
      this.saving.set(false);
    }
  }

  private msg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }
}

// guessKind offers a best-effort singular Kind hint for the create skeleton from
// the catalog display name (e.g. "ConfigMaps" -> "ConfigMap"); it's only a
// comment hint — the user sets the real kind and the gateway validates it.
function guessKind(displayName: string): string {
  const one = displayName.replace(/\s+/g, '');
  if (one.endsWith('ies')) return one.slice(0, -3) + 'y';
  if (one.endsWith('ses')) return one.slice(0, -2);
  if (one.endsWith('s')) return one.slice(0, -1);
  return one;
}
