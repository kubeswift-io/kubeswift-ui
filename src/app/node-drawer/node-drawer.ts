import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import type { MetricSeries } from '../gen/kubeswift/v1/telemetry_pb';
import { GatewayService } from '../gateway.service';
import { Sparkline } from '../sparkline/sparkline';

interface NodeCondition {
  type: string;
  status: string;
  reason?: string;
  message?: string;
}

interface NodeObject {
  metadata?: { labels?: Record<string, string> };
  spec?: { unschedulable?: boolean };
  status?: {
    conditions?: NodeCondition[];
    addresses?: { type: string; address: string }[];
    capacity?: Record<string, string>;
    allocatable?: Record<string, string>;
    nodeInfo?: { kubeletVersion?: string; osImage?: string; containerRuntimeVersion?: string };
  };
}

export type Health = 'green' | 'amber' | 'red';

/**
 * Computes a node's health dot colour: red if not Ready, amber if cordoned or
 * under resource pressure, else green. Shared with the Explorer's node rows.
 */
export function nodeHealth(obj: NodeObject | null): Health {
  if (!obj) return 'amber';
  const conds = obj.status?.conditions ?? [];
  if (conds.find((c) => c.type === 'Ready')?.status !== 'True') return 'red';
  const pressure = ['MemoryPressure', 'DiskPressure', 'PIDPressure'].some(
    (t) => conds.find((c) => c.type === t)?.status === 'True',
  );
  return pressure || obj.spec?.unschedulable ? 'amber' : 'green';
}

/**
 * NodeDrawer is the right slide-in for one node: health, roles/version/IP,
 * capacity vs allocatable, live CPU/MEM/Net/GPU sparklines (GetNodeMetrics —
 * GPU is empty where DCGM isn't installed), and the node conditions. The object
 * comes from GetResource; metrics are polled while the drawer is open. Both run
 * as the signed-in user.
 */
@Component({
  selector: 'app-node-drawer',
  imports: [MatIconModule, Sparkline],
  templateUrl: './node-drawer.html',
  styleUrl: './node-drawer.scss',
})
export class NodeDrawer {
  private readonly gw = inject(GatewayService);
  readonly cluster = input.required<string>();
  readonly node = input.required<string>();
  readonly closed = output<void>();

  readonly obj = signal<NodeObject | null>(null);
  readonly loadError = signal<string | null>(null);
  readonly metrics = signal<MetricSeries[]>([]);
  readonly metricsError = signal<string | null>(null);

  constructor() {
    // Reload + (re)start the metrics poll whenever the node identity changes.
    effect((onCleanup) => {
      const cluster = this.cluster();
      const node = this.node();
      this.obj.set(null);
      this.loadError.set(null);
      this.metrics.set([]);
      this.metricsError.set(null);
      let stopped = false;

      this.gw.resources
        .getResource({ cluster, kind: 'nodes', name: node })
        .then((r) => {
          if (!stopped) this.obj.set(JSON.parse(r.json) as NodeObject);
        })
        .catch((e: unknown) => {
          if (!stopped) this.loadError.set(e instanceof Error ? e.message : String(e));
        });

      const poll = async () => {
        try {
          const res = await this.gw.telemetry.getNodeMetrics({
            cluster,
            node,
            windowSeconds: 900,
            stepSeconds: 30,
          });
          if (stopped) return;
          if (res.error) {
            this.metricsError.set(res.error.message);
            this.metrics.set([]);
          } else {
            this.metricsError.set(null);
            this.metrics.set(res.series);
          }
        } catch (e: unknown) {
          if (!stopped) this.metricsError.set(e instanceof Error ? e.message : String(e));
        }
      };
      void poll();
      const id = setInterval(() => void poll(), 15000);
      onCleanup(() => {
        stopped = true;
        clearInterval(id);
      });
    });
  }

  seriesValues(kind: string): number[] {
    return (
      this.metrics()
        .find((s) => s.kind === kind)
        ?.points.map((p) => p.value) ?? []
    );
  }

  readonly health = computed<Health>(() => nodeHealth(this.obj()));
  readonly conditions = computed<NodeCondition[]>(() => this.obj()?.status?.conditions ?? []);
  readonly version = computed(() => this.obj()?.status?.nodeInfo?.kubeletVersion ?? '—');
  readonly osImage = computed(() => this.obj()?.status?.nodeInfo?.osImage ?? '—');
  readonly internalIP = computed(
    () =>
      (this.obj()?.status?.addresses ?? []).find((a) => a.type === 'InternalIP')?.address ?? '—',
  );
  readonly roles = computed<string>(() => {
    const labels = this.obj()?.metadata?.labels ?? {};
    const r = Object.keys(labels)
      .filter((k) => k.startsWith('node-role.kubernetes.io/'))
      .map((k) => k.slice('node-role.kubernetes.io/'.length))
      .filter(Boolean);
    return r.length ? r.join(', ') : '<none>';
  });
  readonly capEntries = computed(() => {
    const cap = this.obj()?.status?.capacity ?? {};
    const alloc = this.obj()?.status?.allocatable ?? {};
    return ['cpu', 'memory', 'pods', 'nvidia.com/gpu']
      .filter((k) => cap[k] !== undefined)
      .map((k) => ({ k, cap: String(cap[k]), alloc: String(alloc[k] ?? cap[k]) }));
  });

  // The GPU series is present (possibly empty) only when DCGM is scraped.
  readonly hasGpu = computed(() => this.metrics().some((s) => s.kind === 'gpu_util'));
  gpuHasData(): boolean {
    return this.seriesValues('gpu_util').length > 0;
  }
}
