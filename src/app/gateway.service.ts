import { Injectable } from '@angular/core';
import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { ClusterService } from './gen/kubeswift/v1/cluster_pb';
import { GuestService } from './gen/kubeswift/v1/guest_pb';
import { TelemetryService } from './gen/kubeswift/v1/telemetry_pb';

// The kubeswift-gateway endpoint. By default it targets the gateway on the
// SAME host that serves the UI, port 18080 — so a dev port-forward on that host
// (kubectl -n kubeswift-system port-forward --address 0.0.0.0 svc/kubeswift-gateway 18080:8080)
// works whether you open the UI at localhost:4200 or dome:4200, with no manual
// config. A production build can inject window.__KUBESWIFT_GATEWAY_URL__.
const GATEWAY_URL: string =
  (globalThis as unknown as { __KUBESWIFT_GATEWAY_URL__?: string }).__KUBESWIFT_GATEWAY_URL__ ??
  `${location.protocol}//${location.hostname}:18080`;

/**
 * GatewayService holds the Connect transport + typed clients for the
 * kubeswift.v1 read plane (the hub fronting the KubeSwift fleet).
 */
@Injectable({ providedIn: 'root' })
export class GatewayService {
  readonly baseUrl = GATEWAY_URL;
  private readonly transport = createConnectTransport({ baseUrl: GATEWAY_URL });

  readonly clusters = createClient(ClusterService, this.transport);
  readonly guests = createClient(GuestService, this.transport);
  readonly telemetry = createClient(TelemetryService, this.transport);
}
