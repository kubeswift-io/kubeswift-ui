import { Injectable } from '@angular/core';
import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { ClusterService } from './gen/kubeswift/v1/cluster_pb';
import { GuestService } from './gen/kubeswift/v1/guest_pb';

// The kubeswift-gateway endpoint. Defaults to the dev port-forward
// (kubectl -n kubeswift-system port-forward svc/kubeswift-gateway 18080:8080);
// a production build can inject window.__KUBESWIFT_GATEWAY_URL__ at runtime.
const GATEWAY_URL: string =
  (globalThis as unknown as { __KUBESWIFT_GATEWAY_URL__?: string }).__KUBESWIFT_GATEWAY_URL__ ??
  'http://localhost:18080';

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
}
