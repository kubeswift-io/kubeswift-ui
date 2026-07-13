import { Component, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';
import type { Cluster } from '../gen/kubeswift/v1/cluster_pb';

type Kind = 'sandbox' | 'pool';

/**
 * CreateSandbox is the right slide-in form for a new SwiftSandbox or
 * SwiftSandboxPool. It submits SandboxService.CreateSandbox /
 * CreateSandboxPool as the signed-in user, so the member RBAC + the admission
 * webhook gate the create; a denial surfaces in the banner, never a silent
 * success. A new sandbox appears in the table via the live WatchSandboxes
 * stream; a new pool is picked up by the parent's pool refresh.
 */
@Component({
  selector: 'app-create-sandbox',
  imports: [MatIconModule],
  templateUrl: './create-sandbox.html',
  styleUrl: './create-sandbox.scss',
})
export class CreateSandbox {
  private readonly gw = inject(GatewayService);
  readonly clusters = input.required<Cluster[]>();
  readonly created = output<void>();
  readonly closed = output<void>();

  readonly kind = signal<Kind>('sandbox');
  readonly cluster = signal('');
  readonly namespace = signal('default');
  readonly name = signal('');
  readonly image = signal('');
  readonly networkMode = signal('restricted');
  readonly cpu = signal(1);
  readonly memoryMib = signal(512);

  // Sandbox-only. command is whitespace-split (e.g. "sh -c"); argument is passed
  // as a single arg (e.g. the script for `sh -c`). Empty command = the image
  // entrypoint (cold path only; a pooled checkout needs a command).
  readonly command = signal('');
  readonly argument = signal('');
  readonly poolRef = signal('');

  // Pool-only.
  readonly minWarm = signal(2);
  readonly maxWarm = signal(0);

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  setKind(k: Kind): void {
    this.kind.set(k);
    this.error.set(null);
  }

  canCreate(): boolean {
    return (
      this.cluster() !== '' &&
      this.namespace().trim() !== '' &&
      this.name().trim() !== '' &&
      this.image().trim() !== ''
    );
  }

  async create(): Promise<void> {
    if (!this.canCreate() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      if (this.kind() === 'sandbox') {
        await this.gw.sandboxes.createSandbox({
          cluster: this.cluster(),
          namespace: this.namespace().trim(),
          name: this.name().trim(),
          image: this.image().trim(),
          command: splitWs(this.command()),
          args: this.argument().trim() ? [this.argument().trim()] : [],
          env: {},
          networkMode: this.networkMode(),
          cpu: this.cpu(),
          memoryMib: BigInt(this.memoryMib()),
          poolRef: this.poolRef().trim(),
        });
      } else {
        await this.gw.sandboxes.createSandboxPool({
          cluster: this.cluster(),
          namespace: this.namespace().trim(),
          name: this.name().trim(),
          image: this.image().trim(),
          minWarm: this.minWarm(),
          maxWarm: this.maxWarm(),
          cpu: this.cpu(),
          memoryMib: BigInt(this.memoryMib()),
          networkMode: this.networkMode(),
        });
      }
      this.created.emit();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }
}

function splitWs(s: string): string[] {
  const t = s.trim();
  return t ? t.split(/\s+/) : [];
}
