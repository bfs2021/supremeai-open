/**
 * AppWindow — app-launch zoom অ্যানিমেশন (iOS-home-template)।
 * বাংলা: চাহিদা ছিল "app-launch animation zooms from the icon's position with
 * a smooth scale" — আইকনের rect (ফোন-স্ক্রিনের স্থানাঙ্কে) থেকে spring দিয়ে
 * পুরো স্ক্রিনে মুহূর্তে বড় হয়; বন্ধ করলে একই rect-এ ফিরে যায়।
 * App screen একটু দেরিতে fade-in করে যাতে জুম মাঝপথেই কনটেন্ট স্পষ্ট হয়।
 */

import { motion } from 'framer-motion';
import { useLauncher } from './launcherStore';
import type { AppId, Rect } from './launcherStore';
import { APP_REGISTRY } from './registry';

export function AppWindow({ appId, rect, full }: {
  appId: AppId;
  rect: Rect;
  full: { w: number; h: number };
}) {
  const closeApp = useLauncher((s) => s.closeApp);
  const def = APP_REGISTRY[appId];
  const Screen = def.screen;

  return (
    <motion.div
      className="absolute inset-0 z-30 overflow-hidden bg-black"
      initial={{
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        borderRadius: Math.min(rect.width, rect.height) * 0.28, opacity: 0.6,
      }}
      animate={{ x: 0, y: 0, width: full.w, height: full.h, borderRadius: 0, opacity: 1 }}
      exit={{
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        borderRadius: Math.min(rect.width, rect.height) * 0.28, opacity: 0,
      }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      data-testid={`app-window-${appId}`}
    >
      <motion.div
        className="size-full overflow-hidden"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ delay: 0.09, duration: 0.16 }}
      >
        <Screen />
      </motion.div>
      {/* বাংলা: অ্যাপের ভেতরেও উপরের status bar স্পষ্ট থাকে — HomeShell-এর
          status bar z-40-এ এর উপরেই থাকে; নিচের স্ট্রিপ ট্যাপ করলে home। */}
      <button
        type="button"
        onClick={closeApp}
        aria-label="Close app and return home"
        className="absolute right-3 top-12 z-10 rounded-full bg-black/45 px-3 py-1 text-[10px] font-semibold text-white/85 backdrop-blur transition active:scale-95"
      >
        Home
      </button>
    </motion.div>
  );
}
