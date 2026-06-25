import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GatewayService } from '../gateway.service';
import type { Cluster } from '../gen/kubeswift/v1/cluster_pb';

interface GpuDevice {
  index: number;
  pciAddress: string;
  model: string;
  numaNode: number;
  driver: string;
  allocated: boolean;
  allocatedTo: string;
}
interface GpuNode {
  name: string;
  phase: string;
  gpuCount: number;
  freeGPUs: number;
  gpuModel: string;
  vfioReady: boolean;
  fmRunning: boolean;
  gpus: GpuDevice[];
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
      allocated?: boolean;
      allocatedTo?: string;
    }[];
  };
}

/**
 * Gpu is the GPU inventory dashboard. It lists the member's SwiftGPUNodes
 * (cluster-scoped) and fetches each one's full status for the per-GPU detail
 * (model / PCI / NUMA / driver / who it's allocated to), plus the node's
 * vfio-ready + Fabric Manager state. Read-only; runs as the signed-in user.
 */
@Component({
  selector: 'app-gpu',
  imports: [MatIconModule],
  templateUrl: './gpu.html',
  styleUrl: './gpu.scss',
})
export class Gpu implements OnInit, OnDestroy {
  private readonly gw = inject(GatewayService);
  readonly clusters = signal<Cluster[]>([]);
  readonly selectedCluster = signal('');
  readonly nodes = signal<GpuNode[]>([]);
  readonly error = signal<string | null>(null);
  readonly loaded = signal(false);
  private timer?: ReturnType<typeof setInterval>;

  async ngOnInit(): Promise<void> {
    try {
      const cl = await this.gw.clusters.listClusters({});
      this.clusters.set(cl.clusters);
      this.selectedCluster.set(
        cl.clusters.find((c) => c.ready)?.name ?? cl.clusters[0]?.name ?? '',
      );
    } catch (e) {
      this.error.set(this.msg(e));
    }
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), 10000);
  }
  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async selectCluster(name: string): Promise<void> {
    this.selectedCluster.set(name);
    this.loaded.set(false);
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    const cluster = this.selectedCluster();
    if (!cluster) return;
    try {
      const list = await this.gw.resources.listResources({ cluster, kind: 'swiftgpunodes' });
      if (list.error) {
        this.error.set(list.error.message);
        this.nodes.set([]);
        this.loaded.set(true);
        return;
      }
      const names = list.resources.map((r) => r.ref?.name ?? '').filter(Boolean);
      const nodes = await Promise.all(names.map((n) => this.fetchNode(cluster, n)));
      this.nodes.set(nodes);
      this.error.set(null);
    } catch (e) {
      this.error.set(this.msg(e));
    } finally {
      this.loaded.set(true);
    }
  }

  private async fetchNode(cluster: string, name: string): Promise<GpuNode> {
    try {
      const r = await this.gw.resources.getResource({ cluster, kind: 'swiftgpunodes', name });
      const st = (JSON.parse(r.json) as RawGpuNode).status ?? {};
      return {
        name,
        phase: st.phase ?? '',
        gpuCount: st.gpuCount ?? 0,
        freeGPUs: st.freeGPUs ?? 0,
        gpuModel: st.gpuModel ?? '',
        vfioReady: !!st.vfioReady,
        fmRunning: !!st.fabricManager?.running,
        gpus: (st.gpus ?? []).map((g) => ({
          index: g.index ?? 0,
          pciAddress: g.pciAddress ?? '',
          model: g.model ?? '',
          numaNode: g.numaNode ?? 0,
          driver: g.driver ?? '',
          allocated: !!g.allocated,
          allocatedTo: g.allocatedTo ?? '',
        })),
      };
    } catch {
      return {
        name,
        phase: 'error',
        gpuCount: 0,
        freeGPUs: 0,
        gpuModel: '',
        vfioReady: false,
        fmRunning: false,
        gpus: [],
      };
    }
  }

  private msg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }
}
