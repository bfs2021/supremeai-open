/**
 * Home-screen widgets (iOS-home-template)।
 * বাংলা: প্রতিটি widget লাইভ — ঘড়ি প্রতি মিনিটে, weather প্রতি ৪৫ সেকেন্ডে
 * refresh হয়; আপডেটের মুহূর্তে `pulseKey` বদলে motion.div-এর হালকা
 * scale-pulse ট্রিগার হয় (চাহিদা: "widgets refresh visibly with a subtle pulse")।
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { CloudSun, Play, Pause, Sparkles } from 'lucide-react';
import { useLauncher } from './launcherStore';
import { TRACKS } from './apps/MusicApp';

/** আপডেটে হালকা pulse — key বদলালে framer-motion অ্যানিমেশন নতুন করে চলে। */
function Pulse({ pulseKey, children }: { pulseKey: string | number; children: React.ReactNode }) {
  return (
    <motion.div
      key={pulseKey}
      initial={{ scale: 1 }}
      animate={{ scale: [1, 1.035, 1] }}
      transition={{ duration: 0.55, ease: 'easeOut' }}
      className="size-full"
    >
      {children}
    </motion.div>
  );
}

const widgetShell =
  'rounded-3xl bg-white/10 p-4 ring-1 ring-white/15 backdrop-blur-md shadow-lg shadow-black/20';

export function WeatherWidget() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((v) => v + 1), 45_000);
    return () => window.clearInterval(t);
  }, []);
  const hi = 31 + (tick % 2);
  const lo = 22 - (tick % 2);
  return (
    <div className={widgetShell} data-testid="widget-weather">
      <Pulse pulseKey={tick}>
        <div className="flex items-start justify-between text-white">
          <div>
            <p className="text-xs font-medium text-white/70">Dhaka</p>
            <p className="text-3xl font-light leading-none">{28 + (tick % 3)}°</p>
            <p className="mt-1 text-[11px] text-white/65">H:{hi}° L:{lo}°</p>
          </div>
          <CloudSun size={30} className="text-amber-200" />
        </div>
        <div className="mt-3 flex justify-between text-[10px] text-white/70">
          {['Today', 'Tue', 'Wed', 'Thu'].map((d, i) => (
            <span key={d} className="flex flex-col items-center gap-1">
              <span>{d}</span>
              <CloudSun size={13} className={i > 1 ? 'text-cyan-200' : 'text-amber-200'} />
              <span>{30 - i}°</span>
            </span>
          ))}
        </div>
      </Pulse>
    </div>
  );
}

export function ClockWidget() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(t);
  }, []);
  const hhmm = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  return (
    <div className={`${widgetShell} flex flex-col justify-between`} data-testid="widget-clock">
      <Pulse pulseKey={hhmm}>
        <p className="text-4xl font-extralight leading-none text-white">{hhmm}</p>
        <p className="mt-2 text-[11px] text-white/65">
          {now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
        </p>
      </Pulse>
    </div>
  );
}

export function MusicWidget() {
  const playing = useLauncher((s) => s.musicPlaying);
  const toggle = useLauncher((s) => s.toggleMusic);
  const trackIndex = useLauncher((s) => s.musicTrack);
  const elapsed = useLauncher((s) => s.musicElapsed);
  const track = TRACKS[trackIndex % TRACKS.length];
  return (
    <div className={widgetShell} data-testid="widget-music">
      <div className="flex items-center gap-3">
        <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${track.art}`}>
          {playing ? <Pause size={17} className="text-white" /> : <Play size={17} className="translate-x-px text-white" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{track.name}</p>
          <p className="truncate text-[10px] text-white/60">{playing ? 'Playing · WebAudio synth' : 'Paused · tap play'}</p>
        </div>
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? 'Pause music' : 'Play music'}
          data-testid="widget-music-toggle"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/20 text-white transition active:scale-90"
        >
          {playing ? <Pause size={15} /> : <Play size={15} className="translate-x-px" />}
        </button>
      </div>
      <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/15">
        <div className="h-full rounded-full bg-cyan-300/90 transition-[width] duration-1000 ease-linear" style={{ width: `${(elapsed / 96) * 100}%` }} />
      </div>
    </div>
  );
}

/** SupremeAI status widget — আমাদের প্ল্যান অনুযায়ী নিজের প্রোডাক্টের টাই। */
export function SystemWidget() {
  return (
    <div className={widgetShell} data-testid="widget-system">
      <Pulse pulseKey="static">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-cyan-200">
          <Sparkles size={12} /> SupremeAI
        </p>
        <ul className="mt-2 flex flex-col gap-1.5 text-[11px] text-white/75">
          <li className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-emerald-400" /> Agent: online</li>
          <li className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-cyan-300" /> Model: configured</li>
          <li className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-violet-300" /> Bridge: ready</li>
        </ul>
      </Pulse>
    </div>
  );
}
