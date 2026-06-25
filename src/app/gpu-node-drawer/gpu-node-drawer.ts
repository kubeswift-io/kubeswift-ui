import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';

interface GpuDevice {
  index: number;
  pciAddress: string;
  model: string;
  numaNode: number;
  driver: string;
  allocatedTo: string;
}
interface RawGpuNode {
  status?: {
    phase?: string;
    gpuCount?: number;
    freeGPUs?: number;
    gpuModel?: string;
    vfioReady?: boolean;
    fabricManager?: { running?: boolean };
    gpus?: {
      index?: number;
      pciAddress?: string;
      model?: string;
      numaNode?: number;
      driver?: string;
      allocatedTo?: string;
    }[];
  };
}

/**
 * GpuNodeDrawer is the resource-aware detail drawer for a SwiftGPUNode, opened
 * from the Explorer's GPU Nodes kind. It fetches the node's full status
 * (GetResource) and shows the model / free-total / vfio-ready / Fabric Manager
 * state plus the per-GPU table (index / PCI / model / NUMA / driver / who it's
 * allocated to). Read-only, as the signed-in user.
 */
@Component({
  selector: 'app-gpu-node-drawer',
  imports: [MatIconModule],
  templateUrl: './gpu-node-drawer.html',
  styleUrl: './gpu-node-drawer.scss',
})
export class GpuNodeDrawer implements OnInit {
  private readonly gw = inject(GatewayService);
  readonly cluster = input.required<string>();
  readonly name = input.required<string>();
  readonly closed = output<void>();

  readonly phase = signal('');
  readonly model = signal('');
  readonly free = signal(0);
  readonly total = signal(0);
  readonly vfioReady = signal(false);
  readonly fmRunning = signal(false);
  readonly gpus = signal<GpuDevice[]>([]);
  readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      const r = await this.gw.resources.getResource({
        cluster: this.cluster(),
        kind: 'swiftgpunodes',
        name: this.name(),
      });
      const st = (JSON.parse(r.json) as RawGpuNode).status ?? {};
      this.phase.set(st.phase ?? '');
      this.model.set(st.gpuModel ?? '');
      this.free.set(st.freeGPUs ?? 0);
      this.total.set(st.gpuCount ?? 0);
      this.vfioReady.set(!!st.vfioReady);
      this.fmRunning.set(!!st.fabricManager?.running);
      this.gpus.set(
        (st.gpus ?? []).map((g) => ({
          index: g.index ?? 0,
          pciAddress: g.pciAddress ?? '',
          model: g.model ?? '',
          numaNode: g.numaNode ?? 0,
          driver: g.driver ?? '',
          allocatedTo: g.allocatedTo ?? '',
        })),
      );
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }
}
