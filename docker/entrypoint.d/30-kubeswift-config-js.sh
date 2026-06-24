#!/bin/sh
# 30-kubeswift-config-js.sh
#
# Generate the runtime gateway-URL shim the SPA reads as
# window.__KUBESWIFT_GATEWAY_URL__ (see src/app/gateway.service.ts). Driven by
# the KUBESWIFT_GATEWAY_URL env var so the Helm chart can repoint the UI at the
# gateway with no image rebuild.
#
#   (empty)  -> leave the global unset; the SPA uses its built-in default
#               (a dev port-forward of the gateway on the page host, :18080).
#   @origin  -> same-origin reverse-proxy mode: the gateway is reachable on the
#               UI's own origin (nginx proxies it), so point at location.origin.
#   <url>    -> an absolute, browser-reachable gateway URL (its Ingress / LB).
set -eu

target="/usr/share/nginx/html/config.js"
url="${KUBESWIFT_GATEWAY_URL:-}"

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
        # JSON-escape backslash and double-quote so the value is a safe JS string.
        esc=$(printf '%s' "$url" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')
        printf 'window.__KUBESWIFT_GATEWAY_URL__ = "%s";\n' "$esc" > "$target"
        echo "kubeswift-ui: gateway URL = ${url}"
        ;;
esac
