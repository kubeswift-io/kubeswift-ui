// Runtime gateway-URL shim, read by src/app/gateway.service.ts as
// window.__KUBESWIFT_GATEWAY_URL__.
//
// This source copy is a PLACEHOLDER: it intentionally leaves the global unset
// so `ng serve` / a bare static build falls back to the app's built-in default
// (a dev port-forward of the gateway on the page host, port 18080).
//
// In the container image this file is regenerated at startup from the
// KUBESWIFT_GATEWAY_URL env var (see docker/entrypoint.d/30-kubeswift-config-js.sh),
// so the Helm chart can point the UI at the gateway without rebuilding.
