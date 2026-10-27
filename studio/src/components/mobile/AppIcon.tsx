/**
 * AppIcon — squircle হোম-স্ক্রিন আইকন (iOS-home-template)।
 *
 * বাংলা: একটি আইকনে তিনটি ব্যবহার —
 * ১) সাধারণ ট্যাপ → আইকনের অবস্থান থেকে zoom করে অ্যাপ খোলা (launchRect store-এ);
 * ২) long-press (~৪৫০ms) → wiggle mode (আইকন কাঁপে, iOS-এর মতো);
 * ৩) wiggle mode-এ drag → যে আইকনের উপর ছাড়া হয় তার সাথে জায়গা swap।
 * Swap হিট-টেস্ট DOM query দিয়ে হয় (data-app-icon attribute) — ছোট, নির্ভরযোগ্য।
 */

import { useRef } from 'react';
import { motion } from 'framer-motion';
import type { AppId, Rect } from './launcherStore';
import { useLauncher } from './launcherStore';

const LONG_PRESS_MS = 450;

export function AppIcon({ appId, label, gradient, children }: {
  appId: AppId;
  label: string;
  gradient: string;
  children: React.ReactNode;
}) {
  const wiggle = useLauncher((s) => s.wiggle);
  const setWiggle = useLauncher((s) => s.setWiggle);
  const openAppWith = useLauncher((s) => s.openAppWith);
  const swapApps = useLauncher((s) => s.swapApps);
  const pressTimer = useRef<number | null>(null);
  const draggedRef = useRef(false);

  const clearTimer = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  // বাংলা: rect ফোন-স্ক্রিনের স্থানাঙ্কে দরকার — কাছের [data-phone-screen] ancestor থেকে মাপি।
  const rectRelativeToScreen = (el: HTMLElement): Rect => {
    const screen = el.closest('[data-phone-screen]');
    const icon = el.closest('[data-icon-hitbox]') ?? el;
    const r = icon.getBoundingClientRect();
    const s = (screen ?? icon).getBoundingClientRect();
    return { x: r.left - s.left, y: r.top - s.top, width: r.width, height: r.height };
  };

  return (
    <motion.div
      data-icon-hitbox
      className="flex w-[19%] min-w-14 flex-col items-center gap-1.5 select-none"
      // বাংলা: wiggle mode-এই শুধু drag চালু — সাধারণ অবস্থায় পাতার swipe-এর সাথে সংঘর্ষ এড়াতে।
      drag={wiggle}
      dragMomentum={false}
      dragElastic={0.12}
      whileDrag={{ scale: 1.12, zIndex: 40 }}
      onDragEnd={(_, info) => {
        if (draggedRef.current) {
          draggedRef.current = false;
          const el = document.elementFromPoint(info.point.x, info.point.y) as HTMLElement | null;
          const target = el?.closest<HTMLElement>('[data-app-icon]');
          const targetId = target?.dataset.appIcon as AppId | undefined;
          if (targetId && targetId !== appId) swapApps(appId, targetId);
        }
      }}
      onPointerDown={() => {
        draggedRef.current = false;
        clearTimer();
        pressTimer.current = window.setTimeout(() => {
          setWiggle(true);
          pressTimer.current = null;
        }, LONG_PRESS_MS);
      }}
      onPointerMove={(e) => {
        // বাংলা: একটু টেনে নিলেই long-press বাতিল — অনিচ্ছাকৃত wiggle আটকায়।
        if (e.movementX !== 0 || e.movementY !== 0) {
          if (!wiggle) clearTimer();
        }
      }}
      onPointerUp={() => {
        clearTimer();
        if (!wiggle) {
          const el = document.querySelector<HTMLElement>('[data-phone-screen]');
          if (el) openAppWith(appId, rectRelativeToScreen(el));
        } else {
          draggedRef.current = true;
        }
      }}
      onPointerLeave={clearTimer}
    >
      <div data-app-icon={appId} className="relative">
        <motion.div
          animate={wiggle ? { rotate: [-2.4, 2.4, -2.4] } : { rotate: 0 }}
          transition={wiggle ? { repeat: Infinity, duration: 0.42, ease: 'easeInOut' } : { duration: 0.18 }}
          whileTap={wiggle ? undefined : { scale: 0.9 }}
          className={`flex size-[3.4rem] items-center justify-center rounded-[1.05rem] bg-gradient-to-br ${gradient} shadow-lg shadow-black/40 ring-1 ring-white/15`}
        >
          {children}
        </motion.div>
        {wiggle && (
          <span
            className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-white text-[13px] font-bold leading-none text-slate-900 shadow"
            aria-hidden="true"
          >
            ×
          </span>
        )}
      </div>
      <span className="max-w-full truncate text-[10px] font-medium text-white/90 drop-shadow">{label}</span>
    </motion.div>
  );
}
