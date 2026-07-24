# kubeswift-ui

Web console for [KubeSwift](https://github.com/kubeswift-io/kubeswift) — a
multi-cluster fleet view of VMs, built on the `kubeswift-gateway` Connect API.

- **Angular 20** (standalone) + **Material 3** + RxJS, static-asset build (no SSR).
- Talks to the gateway over **Connect / gRPC-Web** (`@connectrpc/connect-web`),
  with the TypeScript client generated from the `kubeswift.v1` proto.

## Run against a live gateway

1. **Deploy the gateway** on a hub cluster (the KubeSwift chart,
   `gateway.enabled=true`) and port-forward it:

   ```bash
   kubectl -n kubeswift-system port-forward svc/kubeswift-gateway 18080:8080
   ```

2. **Dev server:**

   ```bash
   npm install
   npm start          # ng serve → http://localhost:4200
   ```

The app calls the gateway at `http://localhost:18080` by default (the gateway's
CORS allows the dev origin). Override at runtime with
`window.__KUBESWIFT_GATEWAY_URL__`, or edit `src/app/gateway.service.ts`.

## Build

```bash
npm run build        # → dist/kubeswift-ui/browser (static assets)
```

## Container image

A multi-stage [`Dockerfile`](Dockerfile) builds the app (`npm ci && ng build`)
and serves `dist/kubeswift-ui/browser` from an unprivileged (non-root) nginx on
port **8080**. CI publishes it to `ghcr.io/kubeswift-io/kubeswift-ui`
(`:sha-<short>` + `:latest` on `main`, `:vX.Y.Z` on tags — see
[`.github/workflows/release.yml`](.github/workflows/release.yml)).

The gateway URL is injected at **runtime** (no rebuild) via the
`KUBESWIFT_GATEWAY_URL` env var, which the entrypoint turns into the
`window.__KUBESWIFT_GATEWAY_URL__` shim the app reads (`config.js`):

| `KUBESWIFT_GATEWAY_URL` | Behaviour |
| --- | --- |
| _(unset)_ | SPA falls back to its built-in default (`<page-host>:18080`) |
| `@origin` | Same-origin: nginx **reverse-proxies** the gateway's Connect RPCs (`/kubeswift.v1.*`) and the `/console` WebSocket to `KUBESWIFT_GATEWAY_UPSTREAM` (default `kubeswift-gateway:8080`) |
| an absolute URL | The browser calls the gateway **directly** at that URL (its Ingress/LB; the gateway's CORS must allow the UI origin) |

```bash
docker build -t kubeswift-ui:dev .
# Same-origin proxy to a gateway reachable at host.docker.internal:18080:
docker run --rm -p 8080:8080 \
  -e KUBESWIFT_GATEWAY_UPSTREAM=host.docker.internal:18080 \
  kubeswift-ui:dev
# → http://localhost:8080
```

## Deploy with the KubeSwift chart

The KubeSwift Helm chart ships an opt-in `ui` block (paired with `gateway`):

```bash
helm upgrade --install kubeswift oci://ghcr.io/kubeswift-io/charts/kubeswift \
  -n kubeswift-system --create-namespace \
  --set gateway.enabled=true \
  --set ui.enabled=true \
  --set ui.image.tag=<published-kubeswift-ui-tag>
```

By default the UI nginx reverse-proxies the in-cluster `kubeswift-gateway`
Service (`ui.gateway.mode=proxy`), so the browser only needs to reach the UI.
Set `ui.gateway.mode=url` + `ui.gateway.url=<gateway-ingress-url>` to have the
browser call the gateway directly instead. See the chart's `values.yaml`
`ui:` block.

## Regenerating the proto client

The TypeScript client under `src/app/gen/` is generated from the proto in
`proto/` (copied from the KubeSwift repo). To refresh after a contract change:

```bash
cp ../kubeswift/proto/kubeswift/v1/*.proto proto/kubeswift/v1/
PATH="$PWD/node_modules/.bin:$PATH" buf generate
```

## Layout

- `src/app/gateway.service.ts` — Connect transport + typed `ClusterService` / `GuestService` clients.
- `src/app/fleet/` — the landing page: cluster summary + fleet inventory table + the per-cluster error surface.
- `src/app/gen/` — generated proto client (do not edit by hand).
- `proto/`, `buf.yaml`, `buf.gen.yaml` — the contract + codegen config.
