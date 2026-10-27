/**
 * NotificationCenter — top থেকে pull-down (iOS-home-template)।
 * বাংলা: frosted blur (backdrop-blur-2xl) প্যানেল; নমুনা notification-এ
 * SupremeAI-এর build/sync ইভেন্ট — Clear চাপলে তালিকা খালি হয়।
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Bell, CheckCheck, Music2, Smartphone, Sparkles } from 'lucide-react';
import { useLauncher } from './launcherStore';

interface Item {
  id: number;
  icon: typeof Bell;
  title: string;
  body: string;
  time: string;
}

const SAMPLES: Item[] = [
  { id: 1, icon: Sparkles, title: 'SupremeAI build ready', body: 'Preview is available on the Browser tab.', time: '2m ago' },
  { id: 2, icon: Music2, title: 'Now playing', body: 'Aurora Drift — WebAudio synth demo track.', time: '9m ago' },
  { id: 3, icon: Smartphone, title: 'Mobile Simulator synced', body: 'Browser mirror re-rendered via secure ticket.', time: '22m ago' },
];

export function NotificationCenter() {
  const setPanel = useLauncher((s) => s.setPanel);
  const [items, setItems] = useState(SAMPLES);
  const now = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="absolute inset-0 z-50" data-testid="notification-center">
      {/* বাংলা: ব্যাকড্রপ ট্যাপ করলেই প্যানেল বন্ধ — বাইরে ক্লিক লিক না করার সহজ পথ। */}
      <button
        type="button"
        aria-label="Close notifications"
        onClick={() => setPanel('none')}
        className="absolute inset-0 size-full cursor-default bg-black/40 backdrop-blur-2xl"
      />
      <motion.div
        className="relative flex max-h-full flex-col px-4 pt-12"
        initial={{ y: '-100%' }}
        animate={{ y: 0 }}
        exit={{ y: '-100%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
      >
        <p className="px-2 pb-3 text-center text-xs font-medium text-white/70">{now}</p>
        <ul className="flex flex-col gap-2 overflow-y-auto pb-4">
          {items.length === 0 && (
            <li className="rounded-2xl bg-white/10 px-4 py-6 text-center text-xs text-white/60 ring-1 ring-white/15">
              No new notifications
            </li>
          )}
          {items.map((n) => (
            <li key={n.id} className="rounded-2xl bg-white/[0.14] p-3.5 ring-1 ring-white/20">
              <div className="flex items-start gap-3 text-white">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-white/15">
                  <n.icon size={15} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{n.title}</p>
                  <p className="text-xs leading-5 text-white/75">{n.body}</p>
                </div>
                <span className="ml-auto shrink-0 text-[10px] text-white/50">{n.time}</span>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between px-2 pb-6">
          <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-white/50">
            <Bell size={11} /> Notification Center
          </span>
          <button
            type="button"
            onClick={() => setItems([])}
            className="flex items-center gap-1 rounded-full bg-white/15 px-3 py-1.5 text-[11px] font-medium text-white transition active:scale-95"
          >
            <CheckCheck size={12} /> Clear
          </button>
        </div>
      </motion.div>
    </div>
  );
}
