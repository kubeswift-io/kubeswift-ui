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
//
// OIDC login (auth.service.ts): set BOTH of these to require a browser login
// against your IdP (Keycloak/Dex) — the UI then attaches the user's token to
// every gateway call (pair with the gateway's auth-mode=oidc). Leave them unset
// for the insecure/dev mode (no login, no token). Example:
//
//   window.__KUBESWIFT_OIDC_ISSUER__ = 'https://keycloak.example.com/realms/kubeswift';
//   window.__KUBESWIFT_OIDC_CLIENT_ID__ = 'kubeswift-gateway';
