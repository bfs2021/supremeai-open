/**
 * SettingsApp — theme switching + launcher settings (iOS-home-template)।
 * বাংলা: ৪টি wallpaper theme (Aurora/Emerald/Sunset/Mono) — পছন্দ persist হয়;
 * brightness slider Control Center-এর সাথে একই store state শেয়ার করে।
 */

import { Check, Moon, RotateCcw, Sun } from 'lucide-react';
import { THEMES, useLauncher } from '../launcherStore';
import type { ThemeId } from '../launcherStore';

const THEME_ORDER: ThemeId[] = ['aurora', 'emerald', 'sunset', 'mono'];
/** Settings-এর swatch-প্রিভিউ — পূর্ণ wallpaper স্ট্রিং ছোট কার্ডে দেখানোর জন্য। */
const SWATCH: Record<ThemeId, string> = {
  aurora: 'linear-gradient(135deg, #22d3ee, #8b5cf6 55%, #0a1020)',
  emerald: 'linear-gradient(135deg, #34d399, #14b8a6 55%, #04120c)',
  sunset: 'linear-gradient(135deg, #fb923c, #f43f5e 55%, #140709)',
  mono: 'linear-gradient(135deg, #cbd5e1, #64748b 55%, #0a0c10)',
};

export function SettingsApp() {
  const theme = useLauncher((s) => s.theme);
  const setTheme = useLauncher((s) => s.setTheme);
  const resetLayout = useLauncher((s) => s.resetLayout);
  const brightness = useLauncher((s) => s.brightness);
  const setBrightness = useLauncher((s) => s.setBrightness);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto px-5 pb-8 pt-14 text-white">
      <h1 className="text-2xl font-bold">Settings</h1>

      <section className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/10">
        <p className="mb-3 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-white/60">
          <Sun size={12} /> Wallpaper theme
        </p>
        <div className="grid grid-cols-2 gap-2.5">
          {THEME_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTheme(id)}
              aria-pressed={theme === id}
              data-testid={`theme-${id}`}
              className={`relative overflow-hidden rounded-xl p-2 text-left ring-1 transition active:scale-[0.97] ${
                theme === id ? 'ring-2 ring-cyan-300' : 'ring-white/15 hover:ring-white/30'
              }`}
            >
              <span className="block h-12 w-full rounded-lg" style={{ background: SWATCH[id] }} />
              <span className="mt-1.5 flex items-center gap-1 text-xs font-medium">
                {THEMES[id].label}
                {theme === id && <Check size={12} className="text-cyan-300" />}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/10">
        <p className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-white/60">
          <Moon size={12} /> Brightness
        </p>
        <input
          type="range"
          min={10}
          max={100}
          value={brightness}
          onChange={(e) => setBrightness(Number(e.target.value))}
          className="w-full accent-cyan-300"
          aria-label="Screen brightness"
        />
        <p className="text-[10px] text-white/45">{brightness}% — synced with Control Center</p>
      </section>

      <section className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/10">
        <p className="text-[11px] uppercase tracking-wider text-white/60">Home screen</p>
        <button
          type="button"
          onClick={resetLayout}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl bg-white/10 py-2 text-xs font-medium text-white/85 transition hover:bg-white/15 active:scale-[0.98]"
        >
          <RotateCcw size={13} /> Reset icon layout
        </button>
        <p className="mt-2 text-[10px] leading-4 text-white/45">
          Long-press any icon for wiggle mode, then drag to rearrange. Layout is saved in this browser.
        </p>
      </section>

      <footer className="mt-auto rounded-2xl bg-white/[0.06] p-4 text-center ring-1 ring-white/10">
        <p className="text-sm font-semibold">SupremeAI Home</p>
        <p className="text-[10px] text-white/45">Launcher v1 · demo apps run fully in-browser · $0 external cost</p>
      </footer>
    </div>
  );
}
