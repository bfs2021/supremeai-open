/**
 * SupremeAI Home Launcher — state store (#iOS-home-template, owner request 2026-10-27).
 *
 * বাংলা: Mobile Simulator-এর ফোনে এখন একটি iOS-ঘরানার Home Launcher থাকবে —
 * home screen, app icon, swipe page, widget, notification/control center।
 * Store convention: Zustand (কোডবেসের সব store-এর মতোই)।
 *
 * Persist নীতি (useMobilePreview-এর মন্তব্যের সাথে সামঞ্জস্যপূর্ণ): "UI অবস্থা"
 * (wiggle, কোন অ্যাপ খোলা, প্যানেল, music playback) persist নিষিদ্ধ; কিন্তু
 * **সেটিংস ও ব্যবহারকারীর ডেটা** (theme, icon layout, Notes) persist করা যায় —
 * Notes অ্যাপের মূল চাহিদাই ছিল localStorage sync।
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type ThemeId = 'aurora' | 'emerald' | 'sunset' | 'mono';

export type AppId = 'weather' | 'music' | 'photos' | 'notes' | 'calendar' | 'settings';

export interface Note {
  id: string;
  title: string;
  body: string;
  updatedAt: number;
}

/** ফোন-স্ক্রিনের ভেতরের স্থানাঙ্কে আইকনের rect — app-launch zoom অ্যানিমেশনের জন্য। */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PanelId = 'none' | 'notifications' | 'control';

export interface LauncherLayout {
  dock: AppId[];
  pages: AppId[][];
}

export const DEFAULT_LAYOUT: LauncherLayout = {
  dock: ['photos', 'music', 'notes', 'settings'],
  pages: [
    ['weather', 'calendar'],
    [],
  ],
};

/** Theme-প্রতি wallpaper gradient + accent — Settings অ্যাপ থেকে বদলানো যায়। */
export const THEMES: Record<ThemeId, { label: string; wallpaper: string; accent: string }> = {
  aurora: {
    label: 'Aurora',
    wallpaper:
      'radial-gradient(120% 90% at 18% 8%, rgba(34,211,238,0.34), transparent 55%),' +
      'radial-gradient(100% 80% at 85% 18%, rgba(139,92,246,0.30), transparent 58%),' +
      'radial-gradient(120% 100% at 50% 100%, rgba(16,185,129,0.22), transparent 60%),' +
      'linear-gradient(180deg, #060913 0%, #0a1020 48%, #05070f 100%)',
    accent: 'text-cyan-300',
  },
  emerald: {
    label: 'Emerald',
    wallpaper:
      'radial-gradient(120% 90% at 20% 10%, rgba(16,185,129,0.36), transparent 55%),' +
      'radial-gradient(100% 80% at 82% 20%, rgba(20,184,166,0.26), transparent 58%),' +
      'radial-gradient(120% 100% at 50% 100%, rgba(34,211,238,0.18), transparent 60%),' +
      'linear-gradient(180deg, #04120c 0%, #061a12 48%, #030a08 100%)',
    accent: 'text-emerald-300',
  },
  sunset: {
    label: 'Sunset',
    wallpaper:
      'radial-gradient(120% 90% at 18% 8%, rgba(251,146,60,0.32), transparent 55%),' +
      'radial-gradient(100% 80% at 85% 18%, rgba(244,63,94,0.28), transparent 58%),' +
      'radial-gradient(120% 100% at 50% 100%, rgba(168,85,247,0.20), transparent 60%),' +
      'linear-gradient(180deg, #140709 0%, #1c0b10 48%, #0b0507 100%)',
    accent: 'text-amber-300',
  },
  mono: {
    label: 'Mono',
    wallpaper:
      'radial-gradient(120% 90% at 20% 8%, rgba(148,163,184,0.24), transparent 55%),' +
      'radial-gradient(100% 80% at 82% 20%, rgba(100,116,139,0.20), transparent 58%),' +
      'linear-gradient(180deg, #0a0c10 0%, #12151b 48%, #06070a 100%)',
    accent: 'text-slate-200',
  },
};

/**
 * Pure helper — layout-এর যেকোনো দুটি slot (dock/page) swap করে।
 * বাংলা: wiggle mode-এ দুই আইকনের জায়গা বদল — আলাদা pure ফাংশন রাখা হয়েছে
 * যাতে ছোট vitest টেস্টে DOM ছাড়াই reorder-লজিক যাচাই করা যায়।
 */
export function swapInLayout(layout: LauncherLayout, a: AppId, b: AppId): LauncherLayout {
  if (a === b) return layout;
  const find = (id: AppId): { zone: 'dock' | 'page'; page: number; index: number } | null => {
    const di = layout.dock.indexOf(id);
    if (di >= 0) return { zone: 'dock', page: -1, index: di };
    for (let p = 0; p < layout.pages.length; p++) {
      const ii = layout.pages[p].indexOf(id);
      if (ii >= 0) return { zone: 'page', page: p, index: ii };
    }
    return null;
  };
  const pa = find(a);
  const pb = find(b);
  if (!pa || !pb) return layout;
  const next: LauncherLayout = {
    dock: [...layout.dock],
    pages: layout.pages.map((p) => [...p]),
  };
  const slotOf = (pos: { zone: 'dock' | 'page'; page: number; index: number }): AppId[] =>
    pos.zone === 'dock' ? next.dock : next.pages[pos.page];
  slotOf(pa)[pa.index] = b;
  slotOf(pb)[pb.index] = a;
  return next;
}

interface LauncherState {
  // ---- persisted: settings + user data ----
  theme: ThemeId;
  layout: LauncherLayout;
  notes: Note[];
  setTheme: (t: ThemeId) => void;
  cycleTheme: () => void;
  swapApps: (a: AppId, b: AppId) => void;
  resetLayout: () => void;
  addNote: (title: string, body: string) => void;
  updateNote: (id: string, title: string, body: string) => void;
  deleteNote: (id: string) => void;

  // ---- transient: UI state (persist নিষিদ্ধ) ----
  wiggle: boolean;
  setWiggle: (w: boolean) => void;
  openApp: AppId | null;
  launchRect: Rect | null;
  openAppWith: (app: AppId, rect: Rect) => void;
  closeApp: () => void;
  panel: PanelId;
  setPanel: (p: PanelId) => void;
  page: number;
  setPage: (p: number) => void;

  // ---- transient: control center toggles ----
  airplane: boolean;
  wifi: boolean;
  bluetooth: boolean;
  flashlight: boolean;
  brightness: number; // 0-100
  volume: number; // 0-100
  toggleControl: (key: 'airplane' | 'wifi' | 'bluetooth' | 'flashlight') => void;
  setBrightness: (v: number) => void;
  setVolume: (v: number) => void;

  // ---- transient: shared music state (widget + control center + app) ----
  musicPlaying: boolean;
  musicTrack: number;
  musicElapsed: number; // seconds within current track
  toggleMusic: () => void;
  setMusicTrack: (i: number) => void;
  musicTick: () => void;
}

export const useLauncher = create<LauncherState>()(
  persist(
    (set) => ({
      theme: 'aurora',
      layout: DEFAULT_LAYOUT,
      notes: [
        {
          id: 'note-welcome',
          title: 'Welcome to SupremeAI',
          body: 'এই Notes অ্যাপটি localStorage-এ sync হয় — লিখে রাখলে ফোন বন্ধ করলেও থাকবে।',
          updatedAt: Date.parse('2026-10-27T09:00:00Z'),
        },
      ],
      setTheme: (t) => set({ theme: t }),
      cycleTheme: () =>
        set((s) => {
          const order: ThemeId[] = ['aurora', 'emerald', 'sunset', 'mono'];
          return { theme: order[(order.indexOf(s.theme) + 1) % order.length] };
        }),
      swapApps: (a, b) => set((s) => ({ layout: swapInLayout(s.layout, a, b) })),
      resetLayout: () => set({ layout: DEFAULT_LAYOUT }),
      addNote: (title, body) =>
        set((s) => ({
          notes: [
            { id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, title, body, updatedAt: Date.now() },
            ...s.notes,
          ],
        })),
      updateNote: (id, title, body) =>
        set((s) => ({
          notes: s.notes.map((n) => (n.id === id ? { ...n, title, body, updatedAt: Date.now() } : n)),
        })),
      deleteNote: (id) => set((s) => ({ notes: s.notes.filter((n) => n.id !== id) })),

      wiggle: false,
      setWiggle: (w) => set({ wiggle: w }),
      openApp: null,
      launchRect: null,
      openAppWith: (app, rect) => set({ openApp: app, launchRect: rect, panel: 'none', wiggle: false }),
      closeApp: () => set({ openApp: null, launchRect: null }),
      panel: 'none',
      setPanel: (p) => set({ panel: p }),
      page: 0,
      setPage: (p) => set({ page: p }),

      airplane: false,
      wifi: true,
      bluetooth: false,
      flashlight: false,
      brightness: 85,
      volume: 60,
      toggleControl: (key) => set((s) => ({ [key]: !s[key] }) as Partial<LauncherState>),
      setBrightness: (v) => set({ brightness: Math.max(0, Math.min(100, v)) }),
      setVolume: (v) => set({ volume: Math.max(0, Math.min(100, v)) }),

      musicPlaying: false,
      musicTrack: 0,
      musicElapsed: 0,
      toggleMusic: () => set((s) => ({ musicPlaying: !s.musicPlaying })),
      setMusicTrack: (i) => set({ musicTrack: i, musicElapsed: 0 }),
      musicTick: () =>
        set((s) => ({ musicElapsed: (s.musicElapsed + 1) % TRACK_LENGTH_SECONDS })),
    }),
    {
      name: 'supremeai_home_launcher_v1',
      storage: createJSONStorage(() => localStorage),
      // বাংলা: শুধু settings + user data persist — UI/playback state নয়।
      partialize: (s) => ({ theme: s.theme, layout: s.layout, notes: s.notes }),
    },
  ),
);

/** ডেমো ট্র্যাকের দৈর্ঘ্য (সেকেন্ড) — MusicEngine এই দৈর্ঘ্যে loop করে। */
export const TRACK_LENGTH_SECONDS = 96;
