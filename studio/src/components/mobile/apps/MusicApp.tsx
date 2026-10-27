/**
 * MusicApp — playable demo tracks (iOS-home-template)।
 *
 * বাংলা: বাইরের audio ফাইল/স্ট্রিম নেই ($0 নীতি + sandbox-এ CORS ঝামেলা নেই) —
 * WebAudio API দিয়ে সিন্থেসাইজ করা ছোট chord-loop-ই "ডেমো ট্র্যাক"।
 * Playback state launcherStore-এ শেয়ার্ড — widget ও Control Center-ও নিয়ন্ত্রণ করতে পারে।
 * MusicEngine: HomeShell-এ সবসময় mounted থাকে, তাই home-এ ফিরে গেলেও গান বাজতে থাকে (iOS feel)।
 */

import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Music2, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useLauncher, TRACK_LENGTH_SECONDS } from '../launcherStore';

export interface DemoTrack {
  name: string;
  artist: string;
  bpm: number;
  /** হার্টজ — প্রতি বিটে পরপর বাজানো ৪টি নোট (chord tones)। */
  notes: number[];
  art: string;
}

export const TRACKS: DemoTrack[] = [
  {
    name: 'Aurora Drift',
    artist: 'SupremeAI Synth',
    bpm: 92,
    notes: [220.0, 277.18, 329.63, 415.3],
    art: 'from-cyan-400/80 via-teal-500/70 to-violet-600/80',
  },
  {
    name: 'Neon Dhaka',
    artist: 'SupremeAI Synth',
    bpm: 124,
    notes: [196.0, 246.94, 293.66, 392.0],
    art: 'from-fuchsia-400/80 via-rose-500/70 to-amber-500/80',
  },
  {
    name: 'Moonlit Terminal',
    artist: 'SupremeAI Synth',
    bpm: 72,
    notes: [174.61, 220.0, 261.63, 349.23],
    art: 'from-slate-300/70 via-cyan-300/60 to-emerald-500/70',
  },
];

/**
 * MusicEngine — store-এর musicPlaying/musicTrack/musicVolume অনুযায়ী WebAudio
 * chord-loop বাজায়; প্রতি সেকেন্ডে musicTick() দিয়ে progress এগিয়ে দেয়।
 */
export function MusicEngine() {
  const playing = useLauncher((s) => s.musicPlaying);
  const trackIndex = useLauncher((s) => s.musicTrack);
  const volume = useLauncher((s) => s.volume);
  const tick = useLauncher((s) => s.musicTick);

  useEffect(() => {
    if (!playing) return;
    const track = TRACKS[trackIndex % TRACKS.length];
    type Ctor = typeof AudioContext;
    const AC: Ctor | undefined =
      typeof window !== 'undefined'
        ? window.AudioContext ??
          (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext
        : undefined;
    if (!AC) return;
    const ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = (volume / 100) * 0.22;
    master.connect(ctx.destination);

    let step = 0;
    const beatMs = 60000 / track.bpm;
    const playNote = (freq: number, dur: number, gainScale: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(gainScale, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain).connect(master);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    };
    const sequencer = window.setInterval(() => {
      playNote(track.notes[step % track.notes.length], 0.34, 0.9);
      if (step % 4 === 0) playNote(track.notes[0] / 2, 0.5, 0.7); // bass
      if (step % 8 === 6) playNote(track.notes[3] * 2, 0.18, 0.35); // sparkle
      step += 1;
    }, beatMs);
    const progress = window.setInterval(tick, 1000);
    return () => {
      window.clearInterval(sequencer);
      window.clearInterval(progress);
      void ctx.close();
    };
  }, [playing, trackIndex, volume, tick]);

  return null;
}

export function MusicApp() {
  const playing = useLauncher((s) => s.musicPlaying);
  const toggleMusic = useLauncher((s) => s.toggleMusic);
  const trackIndex = useLauncher((s) => s.musicTrack);
  const setTrack = useLauncher((s) => s.setMusicTrack);
  const elapsed = useLauncher((s) => s.musicElapsed);
  const track = TRACKS[trackIndex % TRACKS.length];
  const barRef = useRef<HTMLDivElement>(null);

  const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  const progress = Math.min(100, (elapsed / TRACK_LENGTH_SECONDS) * 100);

  return (
    <div className="flex h-full flex-col items-center gap-5 px-6 pb-8 pt-16 text-white">
      <p className="text-xs uppercase tracking-[0.2em] text-white/60">Now Playing</p>
      <div
        className={`relative flex aspect-square w-full max-w-[16rem] items-center justify-center rounded-3xl bg-gradient-to-br ${track.art} shadow-2xl shadow-black/50 ring-1 ring-white/20`}
      >
        <Music2 size={64} className="text-white/80" />
        {/* বাংলা: বাজার অবস্থায় আলবার্ট আর্ট হালকা নিঃশ্বাসের মতো পালস করে (live feel)। */}
        {playing && (
          <motion.div
            key={`pulse-${elapsed === 0 ? 'start' : 'run'}-${trackIndex}`}
            className="absolute inset-0 rounded-3xl bg-white/10"
            initial={{ opacity: 0.35, scale: 1 }}
            animate={{ opacity: 0, scale: 1.04 }}
            transition={{ repeat: Infinity, duration: 1.6, ease: 'easeOut' }}
          />
        )}
      </div>
      <div className="text-center">
        <p className="text-lg font-semibold">{track.name}</p>
        <p className="text-sm text-white/60">{track.artist} · {track.bpm} BPM · WebAudio synth</p>
      </div>
      <div className="w-full">
        <div ref={barRef} className="h-1.5 w-full overflow-hidden rounded-full bg-white/15">
          <div className="h-full rounded-full bg-white/80 transition-[width] duration-1000 ease-linear" style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-white/50">
          <span>{fmt(elapsed)}</span>
          <span>{fmt(TRACK_LENGTH_SECONDS)}</span>
        </div>
      </div>
      <div className="flex items-center gap-7">
        <button type="button" aria-label="Previous track" onClick={() => setTrack((trackIndex + TRACKS.length - 1) % TRACKS.length)} className="text-white/80 transition hover:text-white active:scale-90">
          <SkipBack size={30} />
        </button>
        <button
          type="button"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={toggleMusic}
          data-testid="music-play-toggle"
          className="flex size-16 items-center justify-center rounded-full bg-white text-slate-900 shadow-lg transition active:scale-90"
        >
          {playing ? <Pause size={28} /> : <Play size={28} className="translate-x-0.5" />}
        </button>
        <button type="button" aria-label="Next track" onClick={() => setTrack((trackIndex + 1) % TRACKS.length)} className="text-white/80 transition hover:text-white active:scale-90">
          <SkipForward size={30} />
        </button>
      </div>
      <ul className="mt-auto w-full rounded-2xl bg-white/10 p-2 text-xs ring-1 ring-white/10">
        {TRACKS.map((t, i) => (
          <li key={t.name}>
            <button
              type="button"
              onClick={() => setTrack(i)}
              className={`flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition ${i === trackIndex % TRACKS.length ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/5'}`}
            >
              <span className={`size-6 shrink-0 rounded-md bg-gradient-to-br ${t.art}`} />
              <span className="truncate font-medium">{t.name}</span>
              {i === trackIndex % TRACKS.length && <span className="ml-auto text-[10px] text-cyan-200">{playing ? '▶ Playing' : 'Selected'}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
