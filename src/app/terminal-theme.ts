import type { ITheme } from '@xterm/xterm';

/**
 * xterm draws on a canvas, so it needs literal colours rather than CSS
 * variables. Read them from the KubeSwift design tokens on the element: the
 * terminal panels set data-theme="dark", so the tokens resolve to their dark
 * values in both console themes. The fallbacks are those same token values,
 * for environments without computed styles (unit tests).
 */
export function terminalTheme(el: Element): ITheme {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    background: v('--code-bg', '#080D22'),
    foreground: v('--code-ink', '#C9D2E8'),
    cursor: v('--teal', '#1ED7C9'),
    cursorAccent: v('--code-bg', '#080D22'),
    selectionBackground: 'rgba(30, 215, 201, 0.25)',
  };
}

/** The terminal font: IBM Plex Mono from the design tokens, then system monospace. */
export const TERMINAL_FONT = "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace";
