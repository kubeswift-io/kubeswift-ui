import { describe, expect, it } from 'vitest';
import { terminalTheme } from './terminal-theme';

describe('terminalTheme', () => {
  it('reads the colours from the design tokens on the element', () => {
    const el = document.createElement('div');
    el.style.setProperty('--code-bg', '#000001');
    el.style.setProperty('--code-ink', '#000002');
    el.style.setProperty('--teal', '#000003');
    document.body.appendChild(el);
    const t = terminalTheme(el);
    expect(t.background).toBe('#000001');
    expect(t.foreground).toBe('#000002');
    expect(t.cursor).toBe('#000003');
    el.remove();
  });

  it('falls back to the dark token values when no tokens are set', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const t = terminalTheme(el);
    expect(t.background).toBe('#080D22');
    expect(t.foreground).toBe('#C9D2E8');
    el.remove();
  });
});
