import { Injectable, effect, signal } from '@angular/core';

type Theme = 'light' | 'dark';
const STORE = 'kubeswift.theme';

/**
 * ThemeService toggles light/dark by flipping the document's `color-scheme`.
 * The whole UI — Angular Material and our own components — is built on the
 * Material 3 `--mat-sys-*` system tokens, which resolve light/dark from
 * `color-scheme`, so nothing else has to change. The choice persists in
 * localStorage and defaults to the OS preference on first visit.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<Theme>(load());

  constructor() {
    effect(() => {
      const t = this.theme();
      document.documentElement.style.colorScheme = t;
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
