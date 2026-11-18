import { Injectable, effect, signal } from '@angular/core';

type Theme = 'light' | 'dark';
const STORE = 'kubeswift.theme';

/**
 * ThemeService toggles light/dark on the document root: `color-scheme` for
 * Angular Material's own light-dark() values, and `data-theme` for the
 * KubeSwift design tokens (src/design/tokens/tokens.css), which the
 * `--mat-sys-*` overrides in styles.scss point at. The choice persists in
 * localStorage and defaults to the OS preference on first visit.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<Theme>(load());

  constructor() {
    effect(() => {
      const t = this.theme();
      document.documentElement.style.colorScheme = t;
      document.documentElement.dataset['theme'] = t;
      localStorage.setItem(STORE, t);
    });
  }

  toggle(): void {
    this.theme.set(this.theme() === 'dark' ? 'light' : 'dark');
  }
}

function load(): Theme {
  const saved = localStorage.getItem(STORE);
  if (saved === 'light' || saved === 'dark') return saved;
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
