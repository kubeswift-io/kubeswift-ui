# kubeswift-ui

Web console for [KubeSwift](https://github.com/projectbeskar/kubeswift) — a
multi-cluster fleet view of VMs, built on the `kubeswift-gateway` Connect API.

- **Angular 20** (standalone) + **Material 3** + RxJS, static-asset build (no SSR).
- Talks to the gateway over **Connect / gRPC-Web** (`@connectrpc/connect-web`),
  with the TypeScript client generated from the `kubeswift.v1` proto.

> Status: **P0** — the cluster selector + a live, fleet-merged VM inventory.
> Backend design: `kubeswift/docs/design/ui-backend-enablement.md`.

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
npm run build        # → dist/kubeswift-ui (static assets)
```

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
