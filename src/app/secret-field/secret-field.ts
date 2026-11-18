import { Component, computed, input, output } from '@angular/core';
import { SecretList, secretWarning } from '../wizard-util';

let seq = 0;

/**
 * SecretField names a Secret in the object's namespace: free text, so a name
 * the user cannot list (or a Secret still to be created) can be typed, with
 * the namespace's matching Secrets offered as suggestions and a warning when
 * the typed one is missing or of the wrong type.
 */
@Component({
  selector: 'app-secret-field',
  template: `
    <label class="field">
      <span>{{ label() }}</span>
      <input
        [attr.list]="listId"
        [placeholder]="placeholder()"
        [value]="value()"
        (input)="valueChange.emit($any($event.target).value)"
      />
      <datalist [id]="listId">
        @for (n of offered(); track n) {
          <option [value]="n"></option>
        }
      </datalist>
    </label>
    @if (warning()) {
      <p class="hint warn">{{ warning() }}</p>
    }
  `,
  styleUrl: '../wizard.scss',
})
export class SecretField {
  readonly label = input.required<string>();
  readonly value = input<string>('');
  readonly secrets = input<SecretList | null>(null);
  /** registry: kubernetes.io/dockerconfigjson Secrets; any: every Secret. */
  readonly kind = input<'registry' | 'any'>('registry');
  readonly placeholder = input<string>('');
  readonly valueChange = output<string>();

  readonly listId = `secret-field-${++seq}`;
  readonly offered = computed(() => {
    const s = this.secrets();
    if (!s) return [];
    return this.kind() === 'registry' ? s.registry : [...s.registry, ...s.other].sort();
  });
  readonly warning = computed(() => secretWarning(this.value(), this.secrets(), this.kind()));
}
