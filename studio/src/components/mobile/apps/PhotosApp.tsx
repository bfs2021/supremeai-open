/**
 * PhotosApp — starter gallery (iOS-home-template)।
 * বাংলা: কোনো বাইরের image ডাউনলোড নেই ($0 + offline-safe) — প্রতিটি "ছবি"
 * একটি deterministic CSS gradient artwork; ট্যাপ করলে fullscreen viewer খোলে।
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';

interface Artwork {
  id: number;
  title: string;
  css: string;
}

const ARTWORKS: Artwork[] = [
  { id: 1, title: 'Aurora Reef', css: 'linear-gradient(135deg, #22d3ee, #8b5cf6 60%, #101020)' },
  { id: 2, title: 'Emerald Dawn', css: 'linear-gradient(160deg, #34d399, #0f766e 55%, #05201a)' },
  { id: 3, title: 'Solar Drift', css: 'linear-gradient(140deg, #fbbf24, #f43f5e 60%, #1c0509)' },
  { id: 4, title: 'Tidal Glass', css: 'linear-gradient(200deg, #67e8f9, #0369a1 55%, #06121f)' },
  { id: 5, title: 'Violet Ember', css: 'linear-gradient(120deg, #c084fc, #7c3aed 55%, #150825)' },
  { id: 6, title: 'Amber Field', css: 'linear-gradient(150deg, #fcd34d, #d97706 60%, #1d1204)' },
  { id: 7, title: 'Neon Grid', css: 'linear-gradient(90deg, #2dd4bf, #6366f1 50%, #0b1026)' },
  { id: 8, title: 'Rose Signal', css: 'linear-gradient(170deg, #fb7185, #be123c 55%, #20060d)' },
  { id: 9, title: 'Deep Orbit', css: 'radial-gradient(120% 120% at 25% 20%, #38bdf8, #1e1b4b 60%, #050510)' },
  { id: 10, title: 'Copper Dusk', css: 'linear-gradient(130deg, #f59e0b, #9a3412 60%, #170a04)' },
  { id: 11, title: 'Mint Circuit', css: 'linear-gradient(180deg, #a7f3d0, #059669 55%, #03150e)' },
  { id: 12, title: 'Slate Moon', css: 'linear-gradient(210deg, #e2e8f0, #475569 55%, #0a0d14)' },
];

export function PhotosApp() {
  const [selected, setSelected] = useState<Artwork | null>(null);

  return (
    <div className="flex h-full flex-col pt-14 text-white">
      <header className="flex items-baseline justify-between px-5 pb-3">
        <h1 className="text-2xl font-bold">Gallery</h1>
        <p className="text-xs text-white/60">{ARTWORKS.length} artworks · gradient starter set</p>
      </header>
      <div className="grid flex-1 grid-cols-3 content-start gap-1.5 overflow-y-auto px-3 pb-8">
        {ARTWORKS.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setSelected(a)}
            className="aspect-square overflow-hidden rounded-lg ring-1 ring-white/10 transition active:scale-95"
            aria-label={`Open ${a.title}`}
          >
            <span className="block size-full" style={{ background: a.css }} />
          </button>
        ))}
      </div>

      {selected && (
        <motion.div
          className="absolute inset-0 z-20 flex flex-col bg-black/90 backdrop-blur-md"
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        >
          <div className="flex items-center justify-between px-5 pt-14 pb-3 text-white">
            <div>
              <p className="text-base font-semibold">{selected.title}</p>
              <p className="text-[11px] text-white/50">SupremeAI starter gallery</p>
            </div>
            <button type="button" onClick={() => setSelected(null)} aria-label="Close viewer" className="rounded-full bg-white/10 p-2 transition active:scale-90">
              <X size={18} />
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center p-5">
            <div className="aspect-[3/4] w-full rounded-2xl shadow-2xl ring-1 ring-white/20" style={{ background: selected.css }} />
          </div>
        </motion.div>
      )}
    </div>
  );
}
