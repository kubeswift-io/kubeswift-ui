import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';
import { SandboxLogs } from '../sandbox-logs/sandbox-logs';

interface RawSandbox {
  spec?: {
    image?: string;
    command?: string[];
    args?: string[];
    rootfsMode?: string;
    network?: { mode?: string };
    poolRef?: { name?: string };
    gpuProfileRef?: { name?: string };
    gpuResourceClaim?: { resourceClaimName?: string; resourceClaimTemplateName?: string };
    model?: { imageRef?: string; mountPath?: string };
    scratchDisk?: { blank?: { size?: string }; pvcRef?: { name?: string }; mountPath?: string };
    verifyKeySecretRef?: { name?: string };
    workingDir?: string;
  };
  status?: {
    phase?: string;
    nodeName?: string;
    network?: { primaryIP?: string };
    exitCode?: number;
    rootfs?: { digest?: string };
    message?: string;
  };
}

/**
 * SandboxDrawer is the resource-aware detail drawer for a SwiftSandbox, opened
 * from the Explorer's Sandboxes kind (row-click). It shows the phase/exit code,
 * the spec (image, command, rootfs mode, network, pool/verify-key) and the
 * runtime (node, IP, digest), plus a Delete that runs as the signed-in user via
 * the generic ResourceService — mirrors PoolDrawer / SnapshotDetail.
 */
@Component({
  selector: 'app-sandbox-drawer',
  imports: [MatIconModule, SandboxLogs],
  templateUrl: './sandbox-drawer.html',
  styleUrl: './sandbox-drawer.scss',
})
export class SandboxDrawer implements OnInit {
  private readonly gw = inject(GatewayService);
  readonly cluster = input.required<string>();
  readonly namespace = input.required<string>();
  readonly name = input.required<string>();
  readonly closed = output<void>();
  readonly changed = output<void>();

  readonly phase = signal('');
  readonly image = signal('');
  readonly node = signal('');
  readonly ip = signal('');
  readonly rootfsMode = signal('');
  readonly network = signal('');
  readonly command = signal('');
  readonly workingDir = signal('');
  readonly poolRef = signal('');
  readonly gpu = signal('');
  readonly model = signal('');
  readonly scratch = signal('');
  readonly verifyKey = signal('');
  readonly exitCode = signal<number | null>(null);
  readonly digest = signal('');
  readonly message = signal('');
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly showLogs = signal(false);

  async ngOnInit(): Promise<void> {
    try {
      const r = await this.gw.resources.getResource({
        cluster: this.cluster(),
        kind: 'swiftsandboxes',
        namespace: this.namespace(),
        name: this.name(),
      });
      const o = JSON.parse(r.json) as RawSandbox;
      this.phase.set(o.status?.phase ?? '');
      this.image.set(o.spec?.image ?? '');
      this.node.set(o.status?.nodeName ?? '');
      this.ip.set(o.status?.network?.primaryIP ?? '');
      this.rootfsMode.set(o.spec?.rootfsMode ?? 'block');
      this.network.set(o.spec?.network?.mode ?? 'restricted');
      this.command.set([...(o.spec?.command ?? []), ...(o.spec?.args ?? [])].join(' '));
      this.workingDir.set(o.spec?.workingDir ?? '');
      this.poolRef.set(o.spec?.poolRef?.name ?? '');
    this.gpu.set(
      o.spec?.gpuProfileRef?.name ??
        (o.spec?.gpuResourceClaim
          ? 'DRA: ' +
            (o.spec.gpuResourceClaim.resourceClaimName ??
              o.spec.gpuResourceClaim.resourceClaimTemplateName ??
              'claim')
          : ''),
    );
    this.model.set(
      o.spec?.model?.imageRef
        ? o.spec.model.imageRef + ' \u2192 ' + (o.spec.model.mountPath ?? '/model')
        : '',
    );
    const sd = o.spec?.scratchDisk;
    this.scratch.set(
      sd
        ? (sd.blank?.size ? 'blank ' + sd.blank.size : 'pvc ' + (sd.pvcRef?.name ?? '')) +
            ' \u2192 ' +
            (sd.mountPath ?? '/scratch')
        : '',
    );
      this.verifyKey.set(o.spec?.verifyKeySecretRef?.name ?? '');
      this.exitCode.set(o.status?.exitCode ?? null);
      this.digest.set(o.status?.rootfs?.digest ?? '');
      this.message.set(o.status?.message ?? '');
    } catch (e) {
      this.error.set(this.msg(e));
    }
  }

  terminal(): boolean {
    return this.phase() === 'Completed' || this.phase() === 'Failed';
  }

  async del(): Promise<void> {
    if (this.busy() || !confirm(`Delete sandbox "${this.name()}"? This cannot be undone.`)) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.gw.resources.deleteResource({
        cluster: this.cluster(),
        kind: 'swiftsandboxes',
        namespace: this.namespace(),
        name: this.name(),
      });
      this.changed.emit();
      this.closed.emit();
    } catch (e) {
      this.error.set(this.msg(e));
      this.busy.set(false);
    }
  }

  private msg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }
}
