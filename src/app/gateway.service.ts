import { Injectable, inject } from '@angular/core';
import { createClient, type Interceptor } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { AuthService } from './auth.service';
import { ClusterService } from './gen/kubeswift/v1/cluster_pb';
import { GuestService } from './gen/kubeswift/v1/guest_pb';
import { MigrationService } from './gen/kubeswift/v1/migration_pb';
import { TelemetryService } from './gen/kubeswift/v1/telemetry_pb';
import { ResourceService } from './gen/kubeswift/v1/resource_pb';
import { AccessService } from './gen/kubeswift/v1/access_pb';

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
  private readonly auth = inject(AuthService);
  readonly baseUrl = GATEWAY_URL;

  // When OIDC is enabled, every Connect call carries the user's bearer token so
  // the gateway impersonates them (auth-mode=oidc). When auth is off, freshToken
  // returns null and the header is omitted (insecure/dev mode) — unchanged.
  private readonly authInterceptor: Interceptor = (next) => async (req) => {
    const token = await this.auth.freshToken();
    if (token) req.header.set('Authorization', `Bearer ${token}`);
    return next(req);
  };

  private readonly transport = createConnectTransport({
    baseUrl: GATEWAY_URL,
    interceptors: [this.authInterceptor],
  });

  readonly clusters = createClient(ClusterService, this.transport);
  readonly guests = createClient(GuestService, this.transport);
  readonly migrations = createClient(MigrationService, this.transport);
  readonly telemetry = createClient(TelemetryService, this.transport);
  readonly resources = createClient(ResourceService, this.transport);
  readonly access = createClient(AccessService, this.transport);

  // The console plane is a raw WebSocket (not Connect), so build its URL by hand
  // off the gateway base (http→ws, https→wss). Browsers can't set a WS
  // Authorization header, so when OIDC is on the bearer rides the ?token= query
  // param; insecure mode (the dev default) needs none.
  consoleWsUrl(cluster: string, namespace: string, name: string): string {
    const base = GATEWAY_URL.replace(/^http/, 'ws');
    const q = new URLSearchParams({ cluster, namespace, name });
    const token = this.auth.token();
    if (token) q.set('token', token);
    return `${base}/console?${q.toString()}`;
  }

  // Sandbox logs ride the same raw-WS plane as the console (bearer on ?token=).
  sandboxLogsWsUrl(cluster: string, namespace: string, name: string, follow = true): string {
    const base = GATEWAY_URL.replace(/^http/, 'ws');
    const q = new URLSearchParams({ cluster, namespace, name, follow: String(follow) });
    const token = this.auth.token();
    if (token) q.set('token', token);
    return `${base}/sandbox-logs?${q.toString()}`;
  }

  // Interactive sandbox exec/attach over the same raw-WS plane.
  sandboxExecWsUrl(cluster: string, namespace: string, name: string, cmd = ''): string {
    const base = GATEWAY_URL.replace(/^http/, 'ws');
    const q = new URLSearchParams({ cluster, namespace, name });
    if (cmd) q.set('cmd', cmd);
    const token = this.auth.token();
    if (token) q.set('token', token);
    return `${base}/sandbox-exec?${q.toString()}`;
  }
}
