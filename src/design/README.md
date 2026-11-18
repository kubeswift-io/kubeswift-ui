# KubeSwift design tokens (vendored)

Copied from [kubeswift-io/design](https://github.com/kubeswift-io/design) at the revision in `DESIGN_REVISION`. Do not edit these files here: change `tokens/tokens.json` in the design repo, then run `scripts/sync-design.sh /path/to/design` and commit.

- `tokens/tokens.css`: CSS custom properties for colour (light and dark), spacing, radius and type, and `@font-face` rules.
- `fonts/`: Space Grotesk, IBM Plex Mono and Architects Daughter, each under its SIL Open Font License.

The console maps Angular Material's `--mat-sys-*` variables onto these tokens in `src/styles.scss`.
