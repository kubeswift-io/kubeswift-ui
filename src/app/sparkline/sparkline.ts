import { Component, computed, input } from '@angular/core';

/**
 * Sparkline draws a compact inline-SVG line chart for one metric series, with
 * the latest value formatted by unit. No chart library — a scaled polyline over
 * a fixed viewBox, stretched by the container width.
 *
 * Each sparkline is one series named by its own label, so every line uses the
 * same colour, the design system's accent (azure on light, teal on dark;
 * 11.4:1 and 8.7:1 on the card). Status colours are reserved for state and are
 * never used for a series. The colour is bound as a style so CSS variables
 * resolve in every browser.
 */
@Component({
  selector: 'app-sparkline',
  template: `
    <div class="spark">
      <div class="lbl">
        <span class="name">{{ label() }}</span>
        <span class="val">{{ latest() }}</span>
      </div>
      <svg viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
        @if (path()) {
          <polyline
            [attr.points]="path()"
            fill="none"
            [style.stroke]="color()"
            stroke-width="1.5"
            vector-effect="non-scaling-stroke"
          />
        } @else {
          <line
            x1="0"
            y1="27"
            x2="100"
            y2="27"
            style="stroke: var(--mat-sys-outline-variant)"
            stroke-width="1"
            vector-effect="non-scaling-stroke"
          />
        }
      </svg>
    </div>
  `,
  styles: [
    `
      .spark {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .lbl {
        display: flex;
        justify-content: space-between;
        font-size: 12px;
      }
      .name {
        color: var(--mat-sys-on-surface-variant);
      }
      .val {
        font-weight: 500;
        font-variant-numeric: tabular-nums;
      }
      svg {
        width: 100%;
        height: 28px;
        background: var(--mat-sys-surface-container-low);
        border-radius: 4px;
      }
    `,
  ],
})
export class Sparkline {
  readonly label = input.required<string>();
  readonly values = input.required<number[]>();
  readonly unit = input<string>('');
  readonly color = input<string>('var(--accent)');

  // polyline points scaled to the data range over a 100x28 viewBox (1px top/bottom pad).
  readonly path = computed(() => {
    const v = this.values();
    if (v.length < 2) return '';
    const min = Math.min(...v);
    const max = Math.max(...v);
    const span = max - min || 1;
    const n = v.length;
    return v
      .map((y, i) => {
        const x = (i / (n - 1)) * 100;
        const yy = 27 - ((y - min) / span) * 26;
        return `${x.toFixed(1)},${yy.toFixed(1)}`;
      })
      .join(' ');
  });

  readonly latest = computed(() => {
    const v = this.values();
    return v.length ? formatValue(v[v.length - 1], this.unit()) : '—';
  });
}

function formatValue(v: number, unit: string): string {
  switch (unit) {
    case 'cores':
      return v.toFixed(3) + ' cores';
    case 'bytes':
      return humanBytes(v);
    case 'bytes/sec':
      return humanBytes(v) + '/s';
    case 'ratio':
      return (v * 100).toFixed(1) + '%';
    default:
      return v.toFixed(2);
  }
}

function humanBytes(v: number): string {
  const u = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return v.toFixed(i === 0 ? 0 : 1) + ' ' + u[i];
}
