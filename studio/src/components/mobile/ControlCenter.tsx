/**
 * ControlCenter — bottom থেকে pull-up (iOS-home-template)।
 * বাংলা: toggle-যোগ্য নিয়ন্ত্রণ — connectivity (airplane/wifi/bluetooth),
 * theme cycle, flashlight, brightness + volume slider, music mini-control।
 * সব state launcherStore-এ — HomeShell (brightness dim, flashlight glow) ও
 * MusicEngine একই state থেকে চলে।
 */

import { motion } from 'framer-motion';
import {
  Bluetooth, Flashlight, Music2, Moon, Pause, Plane, Play, Sun, Volume2, Wifi, WifiOff,
} from 'lucide-react';
import { THEMES, useLauncher } from './launcherStore';
import { TRACKS } from './apps/MusicApp';

function RoundToggle({ on, onClick, label, children, onClass = 'bg-cyan-400/90 text-slate-900' }: {
  on: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
  onClass?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      title={label}
      data-testid={`cc-${label.toLowerCase().replace(/\s+/g, '-')}`}
      className={`flex size-12 items-center justify-center rounded-full ring-1 transition active:scale-90 ${
        on ? `${onClass} ring-white/30` : 'bg-white/10 text-white/80 ring-white/15 hover:bg-white/15'
      }`}
    >
      {children}
    </button>
  );
}

function Slider({ value, onChange, icon, label }: {
  value: number;
  onChange: (v: number) => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div className="relative flex h-28 w-12 flex-col items-center justify-end overflow-hidden rounded-full bg-white/10 ring-1 ring-white/15">
      {/* বাংলা: fill নিচ থেকে উপরে — iOS-এর উল্লম্ব স্লাইডার অনুকরণ। */}
      <div className="absolute inset-x-0 bottom-0 bg-white/80" style={{ height: `${value}%` }} />
      <span className="relative z-10 pb-2 text-slate-700 mix-blend-difference invert">{icon}</span>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      />
    </div>
  );
}

export function ControlCenter() {
  const s = useLauncher();
  const track = TRACKS[s.musicTrack % TRACKS.length];

  return (
    <div className="absolute inset-0 z-50" data-testid="control-center">
      <button
        type="button"
        aria-label="Close control center"
        onClick={() => s.setPanel('none')}
        className="absolute inset-0 size-full cursor-default bg-black/40 backdrop-blur-2xl"
      />
      <motion.div
        className="relative flex flex-col gap-3 px-4 pb-8 pt-10"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
      >
        <div className="flex items-start justify-between gap-3">
          {/* Connectivity block */}
          <div className="grid grid-cols-2 gap-3 rounded-3xl bg-white/10 p-3.5 ring-1 ring-white/15">
            <RoundToggle on={s.airplane} onClick={() => s.toggleControl('airplane')} label="Airplane" onClass="bg-amber-400/90 text-slate-900">
              <Plane size={19} />
            </RoundToggle>
            <RoundToggle on={s.wifi && !s.airplane} onClick={() => s.toggleControl('wifi')} label="Wi-Fi">
              {s.wifi && !s.airplane ? <Wifi size={19} /> : <WifiOff size={19} />}
            </RoundToggle>
            <RoundToggle on={s.bluetooth} onClick={() => s.toggleControl('bluetooth')} label="Bluetooth" onClass="bg-cyan-400/90 text-slate-900">
              <Bluetooth size={19} />
            </RoundToggle>
            <RoundToggle on={s.flashlight} onClick={() => s.toggleControl('flashlight')} label="Flashlight" onClass="bg-white text-slate-900">
              <Flashlight size={19} />
            </RoundToggle>
          </div>

          {/* Sliders + theme */}
          <div className="flex flex-col items-center gap-2">
            <div className="flex gap-2">
              <Slider value={s.brightness} onChange={s.setBrightness} icon={<Sun size={16} />} label="Brightness" />
              <Slider value={s.volume} onChange={s.setVolume} icon={<Volume2 size={16} />} label="Volume" />
            </div>
            <button
              type="button"
              onClick={s.cycleTheme}
              aria-label={`Switch theme (current: ${THEMES[s.theme].label})`}
              className="flex items-center gap-1.5 rounded-2xl bg-white/10 px-3 py-2 text-[11px] font-medium text-white ring-1 ring-white/15 transition active:scale-95"
            >
              <Moon size={13} className="text-violet-300" /> {THEMES[s.theme].label}
            </button>
          </div>
        </div>

        {/* Music mini-control */}
        <div className="flex items-center gap-3 rounded-3xl bg-white/10 p-3.5 ring-1 ring-white/15">
          <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${track.art}`}>
            <Music2 size={16} className="text-white" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-white">{track.name}</p>
            <p className="truncate text-[10px] text-white/60">{track.artist}</p>
          </div>
          <button
            type="button"
            onClick={s.toggleMusic}
            aria-label={s.musicPlaying ? 'Pause' : 'Play'}
            data-testid="cc-music-toggle"
            className="flex size-10 items-center justify-center rounded-full bg-white/20 text-white transition active:scale-90"
          >
            {s.musicPlaying ? <Pause size={16} /> : <Play size={16} className="translate-x-px" />}
          </button>
        </div>

        <p className="text-center text-[10px] uppercase tracking-wider text-white/45">Control Center</p>
      </motion.div>
    </div>
  );
}
