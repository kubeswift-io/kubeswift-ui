#!/usr/bin/env bash
# Copy the KubeSwift design tokens and fonts from a checkout of
# https://github.com/kubeswift-io/design into src/design/.
#
# The console never edits these files: change tokens in the design repo, then
# re-run this script and commit the result.
#
# Usage: scripts/sync-design.sh /path/to/kubeswift-io/design
set -euo pipefail

SRC="${1:?usage: $0 /path/to/kubeswift-io/design}"
DST="$(cd "$(dirname "$0")/.." && pwd)/src/design"

[ -f "$SRC/tokens/tokens.css" ] || { echo "not a kubeswift-io/design checkout: $SRC" >&2; exit 1; }

mkdir -p "$DST/tokens" "$DST/fonts"
cp "$SRC/tokens/tokens.css" "$SRC/tokens/tokens.json" "$DST/tokens/"
cp "$SRC"/fonts/*.woff2 "$SRC"/fonts/OFL-*.txt "$DST/fonts/"
cp "$SRC/assets/logos/kubeswift-mark-azure.svg" "$(dirname "$DST")/../public/favicon.svg"
rev="$(git -C "$SRC" rev-parse --short HEAD 2>/dev/null || echo unknown)"
printf '%s\n' "$rev" > "$DST/DESIGN_REVISION"
echo "synced src/design from kubeswift-io/design@$rev"
