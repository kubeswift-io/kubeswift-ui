#!/bin/sh
# 30-kubeswift-config-js.sh
#
# Generate the runtime config shim the SPA reads (see src/app/gateway.service.ts
# and src/app/auth.service.ts). Driven by env vars so the Helm chart can
# configure the UI with no image rebuild.
#
# window.__KUBESWIFT_GATEWAY_URL__  <- KUBESWIFT_GATEWAY_URL
#   (empty)  -> leave the global unset; the SPA uses its built-in default
#               (a dev port-forward of the gateway on the page host, :18080).
#   @origin  -> same-origin reverse-proxy mode: the gateway is reachable on the
#               UI's own origin (nginx proxies it), so point at location.origin.
#   <url>    -> an absolute, browser-reachable gateway URL (its Ingress / LB).
#
# window.__KUBESWIFT_OIDC_ISSUER__ / __KUBESWIFT_OIDC_CLIENT_ID__
#   <- KUBESWIFT_OIDC_ISSUER / KUBESWIFT_OIDC_CLIENT_ID. Set BOTH to turn on the
#   browser OIDC (Authorization Code + PKCE) login; the SPA then sends the ID
#   token to the gateway, which impersonates the user. Leave either empty and
#   auth is OFF (the SPA talks to the gateway with no token — pair with the
#   gateway's auth-mode=insecure for dev).
set -eu

target="/usr/share/nginx/html/config.js"
url="${KUBESWIFT_GATEWAY_URL:-}"
issuer="${KUBESWIFT_OIDC_ISSUER:-}"
client_id="${KUBESWIFT_OIDC_CLIENT_ID:-}"

# JS-escape backslash and double-quote so a value is a safe JS string literal.
jsesc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

# --- gateway URL (truncates/creates config.js) ---
case "$url" in
    "")
        printf '// kubeswift-ui: no gateway URL configured; using built-in default\n' > "$target"
        echo "kubeswift-ui: KUBESWIFT_GATEWAY_URL unset; SPA uses its built-in default"
        ;;
    "@origin")
        printf 'window.__KUBESWIFT_GATEWAY_URL__ = window.location.origin;\n' > "$target"
        echo "kubeswift-ui: gateway reached same-origin (nginx reverse-proxy)"
        ;;
    *)
        printf 'window.__KUBESWIFT_GATEWAY_URL__ = "%s";\n' "$(jsesc "$url")" > "$target"
        echo "kubeswift-ui: gateway URL = ${url}"
        ;;
esac

# --- OIDC login (optional; appends to config.js) ---
if [ -n "$issuer" ] && [ -n "$client_id" ]; then
    printf 'window.__KUBESWIFT_OIDC_ISSUER__ = "%s";\n' "$(jsesc "$issuer")" >> "$target"
    printf 'window.__KUBESWIFT_OIDC_CLIENT_ID__ = "%s";\n' "$(jsesc "$client_id")" >> "$target"
    echo "kubeswift-ui: OIDC login enabled (issuer=${issuer} clientId=${client_id})"
elif [ -n "$issuer" ] || [ -n "$client_id" ]; then
    # No silent half-config: enabling login needs BOTH. Warn loudly, stay auth-OFF.
    echo "kubeswift-ui: WARNING only one of KUBESWIFT_OIDC_ISSUER / KUBESWIFT_OIDC_CLIENT_ID is set; OIDC login NOT enabled (need both)" >&2
else
    echo "kubeswift-ui: OIDC not configured; auth is OFF (gateway must run auth-mode=insecure)"
fi
