import { Component, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import type { Cluster } from '../gen/kubeswift/v1/cluster_pb';

type View = 'form' | 'yaml';

/**
 * FormShell is the shared drawer chrome for every guided create/edit form: the
 * header (title + cluster selector + close), the error banner, the Form⇄YAML
 * toggle, the YAML textarea (when toggled), and the Save/Cancel actions. The
 * form's fields are projected into the body and shown in Form view. Purely
 * presentational — it emits intents; the ResourceForm owns the object logic.
 */
@Component({
  selector: 'app-form-shell',
  imports: [MatIconModule],
  templateUrl: './form-shell.html',
  styleUrl: '../wizard.scss',
})
export class FormShell {
  readonly title = input('');
  readonly sub = input('');
  readonly clusters = input<Cluster[]>([]);
  readonly cluster = input('');
  readonly edit = input(false); // edit mode locks the cluster selector
  readonly view = input<View>('form');
  readonly yaml = input('');
  readonly error = input<string | null>(null);
  readonly canWrite = input(true);
  readonly busy = input(false);
  readonly canSave = input(false);
  readonly saveLabel = input('Create');
  readonly clusterChange = output<string>();
  readonly viewChange = output<View>();
  readonly yamlChange = output<string>();
  readonly save = output<void>();
  readonly close = output<void>();
}
