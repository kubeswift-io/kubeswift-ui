#!/usr/bin/env bash
# Assert the production build is loadable under the CSP the container serves.
#
# Why this exists: the CSP sets `script-src 'self'` with no 'unsafe-inline', so
# the browser refuses to run ANY inline script -- including an inline event
# handler attribute. Angular's `inlineCritical` optimisation emits exactly that:
#
#   <link rel="stylesheet" href="styles-X.css" media="print" onload="this.media='all'">
#
# The sheet loads as media="print" (inert on screen) and the inline onload is
# supposed to flip it to "all". Under our CSP that handler never runs, the flip
# never happens, and every rule in that file is silently dropped. The app still
# renders, because the "critical" subset is inlined into a <style> block and
# style-src does allow 'unsafe-inline' -- so ONLY the non-critical CSS vanishes.
#
# That is what makes this worth a build-time gate rather than a code review: the
# failure is partial and looks like a styling bug in one component. It shipped
# once as a bare white <textarea> in the serial console, because the rule hiding
# xterm's helper textarea lives in the deferred sheet.
#
# Usage: scripts/check-csp-safe-build.sh [dist-dir]
set -euo pipefail

DIST="${1:-dist/kubeswift-ui/browser}"
INDEX="$DIST/index.html"

[ -f "$INDEX" ] || { echo "FAIL: $INDEX not found (build first)" >&2; exit 1; }

rc=0

# 1. Inline event-handler attributes. `script-src 'self'` blocks these outright.
if grep -qiE '<[^>]+ on[a-z]+=' "$INDEX"; then
    echo "FAIL: inline event handler in index.html -- blocked by script-src 'self':" >&2
    grep -oiE '<[^>]+ on[a-z]+="[^"]*"' "$INDEX" | sed 's/^/    /' >&2
    echo "  Fix: set optimization.styles.inlineCritical=false in angular.json." >&2
    rc=1
fi

# 2. A stylesheet parked at media="print" outside <noscript> never applies. This
#    is the actual user-visible symptom of (1), caught independently in case a
#    future Angular emits the deferral without an inline handler.
if grep -v '<noscript>' "$INDEX" | grep -qiE '<link[^>]+rel="stylesheet"[^>]+media="print"'; then
    echo "FAIL: stylesheet deferred with media=\"print\" -- it will never apply on screen." >&2
    rc=1
fi

# 3. Inline <script> bodies (a <script> with no src). Also blocked. config.js is
#    a separate same-origin file precisely so it does not land here.
if grep -oE '<script[^>]*>' "$INDEX" | grep -v 'src=' | grep -q '<script'; then
    echo "FAIL: inline <script> in index.html -- blocked by script-src 'self':" >&2
    grep -oE '<script[^>]*>' "$INDEX" | grep -v 'src=' | sed 's/^/    /' >&2
    rc=1
fi

if [ "$rc" -eq 0 ]; then
    echo "ok: index.html is loadable under script-src 'self'"
fi
exit "$rc"
