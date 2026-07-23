import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';

interface RawKernel {
  spec?: { ociRef?: { image?: string }; profile?: string; kernelCmdline?: string };
  status?: {
    phase?: string;
    kernelDigest?: string;
    initramfsDigest?: string;
    nodeStatuses?: { nodeName?: string; phase?: string }[];
  };
}

/**
 * KernelDrawer is the resource-aware detail drawer for a SwiftKernel, opened from
 * the Explorer's Kernels kind. It shows the OCI ref / profile / cmdline / digests
 * and a per-node pull-status table, plus Delete. Read-only otherwise, as the
 * signed-in user. Mirrors the Schedule/SandboxPool drawers.
 */
@Component({
  selector: 'app-kernel-drawer',
  imports: [MatIconModule],
  templateUrl: './kernel-drawer.html',
  styleUrl: './kernel-drawer.scss',
})
export class KernelDrawer implements OnInit {
  private readonly gw = inject(GatewayService);
  readonly cluster = input.required<string>();
  readonly namespace = input.required<string>();
  readonly name = input.required<string>();
  readonly closed = output<void>();
  readonly changed = output<void>();

  readonly phase = signal('');
  readonly image = signal('');
  readonly profile = signal('');
  readonly cmdline = signal('');
  readonly kernelDigest = signal('');
  readonly initramfsDigest = signal('');
  readonly nodes = signal<{ node: string; phase: string }[]>([]);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  async ngOnInit(): Promise<void> {
    try {
      const r = await this.gw.resources.getResource({
        cluster: this.cluster(),
        kind: 'swiftkernels',
        namespace: this.namespace(),
        name: this.name(),
      });
      const o = JSON.parse(r.json) as RawKernel;
      this.phase.set(o.status?.phase ?? '');
      this.image.set(o.spec?.ociRef?.image ?? '');
      this.profile.set(o.spec?.profile ?? '');
      this.cmdline.set(o.spec?.kernelCmdline ?? '');
      this.kernelDigest.set(o.status?.kernelDigest ?? '');
      this.initramfsDigest.set(o.status?.initramfsDigest ?? '');
      this.nodes.set(
        (o.status?.nodeStatuses ?? []).map((n) => ({
          node: n.nodeName ?? '',
          phase: n.phase ?? '',
        })),
      );
    } catch (e) {
      this.error.set(this.msg(e));
    }
  }

  async del(): Promise<void> {
    if (this.busy() || !confirm('Delete kernel "' + this.name() + '"?')) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.gw.resources.deleteResource({
        cluster: this.cluster(),
        kind: 'swiftkernels',
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
