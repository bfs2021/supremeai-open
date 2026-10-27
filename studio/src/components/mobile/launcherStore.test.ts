/**
 * launcherStore টেস্ট — reorder/notes/theme লজিক (jsdom)।
 * বাংলা: swapInLayout pure ফাংশন + persist-চিহ্নিত actions-এর আচরণ যাচাই;
 * UI অবস্থা (wiggle/panel) persist হয় না — partialize-এর সাথে সামঞ্জস্য।
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_LAYOUT, THEMES, swapInLayout, useLauncher,
} from './launcherStore';
import type { LauncherLayout } from './launcherStore';

const clone = (l: LauncherLayout): LauncherLayout => ({ dock: [...l.dock], pages: l.pages.map((p) => [...p]) });

describe('swapInLayout (wiggle reorder core)', () => {
  it('swaps two icons on the same page', () => {
    const layout = clone(DEFAULT_LAYOUT); // pages[0] = [weather, calendar]
    const next = swapInLayout(layout, 'weather', 'calendar');
    expect(next.pages[0]).toEqual(['calendar', 'weather']);
  });

  it('swaps an icon between page and dock', () => {
    const layout = clone(DEFAULT_LAYOUT); // dock[0] = photos
    const next = swapInLayout(layout, 'weather', 'photos');
    expect(next.dock).toContain('weather');
    expect(next.pages[0]).toContain('photos');
    expect(next.pages[0][0]).toBe('photos');
  });

  it('is a no-op for the same app or unknown app', () => {
    const layout = clone(DEFAULT_LAYOUT);
    expect(swapInLayout(layout, 'weather', 'weather')).toBe(layout);
    expect(swapInLayout(layout, 'weather', 'nope' as never)).toBe(layout);
  });

  it('does not mutate the input layout', () => {
    const layout = clone(DEFAULT_LAYOUT);
    const before = clone(layout);
    swapInLayout(layout, 'photos', 'calendar');
    expect(layout).toEqual(before);
  });
});

describe('useLauncher store', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useLauncher.setState({ layout: clone(DEFAULT_LAYOUT), notes: [], wiggle: false, panel: 'none', openApp: null });
  });

  it('swapApps action mirrors swapInLayout', () => {
    useLauncher.getState().swapApps('weather', 'calendar');
    expect(useLauncher.getState().layout.pages[0]).toEqual(['calendar', 'weather']);
  });

  it('addNote/updateNote/deleteNote keep the list consistent', () => {
    const s = useLauncher.getState();
    s.addNote('Test note', 'body');
    const added = useLauncher.getState().notes[0];
    expect(added.title).toBe('Test note');
    useLauncher.getState().updateNote(added.id, 'Renamed', 'new body');
    expect(useLauncher.getState().notes[0].title).toBe('Renamed');
    useLauncher.getState().deleteNote(added.id);
    expect(useLauncher.getState().notes).toHaveLength(0);
  });

  it('cycleTheme walks all four themes in order', () => {
    useLauncher.setState({ theme: 'aurora' });
    useLauncher.getState().cycleTheme();
    expect(useLauncher.getState().theme).toBe('emerald');
    useLauncher.getState().cycleTheme();
    useLauncher.getState().cycleTheme();
    expect(useLauncher.getState().theme).toBe('mono');
  });

  it('toggleControl flips boolean toggles only', () => {
    const before = useLauncher.getState().wifi;
    useLauncher.getState().toggleControl('wifi');
    expect(useLauncher.getState().wifi).toBe(!before);
  });

  it('openAppWith closes panels and wiggle; closeApp resets rect', () => {
    useLauncher.setState({ wiggle: true, panel: 'control' });
    useLauncher.getState().openAppWith('weather', { x: 1, y: 2, width: 50, height: 50 });
    expect(useLauncher.getState().openApp).toBe('weather');
    expect(useLauncher.getState().wiggle).toBe(false);
    expect(useLauncher.getState().panel).toBe('none');
    useLauncher.getState().closeApp();
    expect(useLauncher.getState().openApp).toBeNull();
    expect(useLauncher.getState().launchRect).toBeNull();
  });

  it('defines all four themes with wallpaper + accent', () => {
    expect(Object.keys(THEMES)).toEqual(['aurora', 'emerald', 'sunset', 'mono']);
    for (const t of Object.values(THEMES)) {
      expect(t.wallpaper).toContain('gradient');
      expect(t.accent).toMatch(/^text-/);
    }
  });
});
