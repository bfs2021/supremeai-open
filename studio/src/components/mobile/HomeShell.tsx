/**
 * HomeShell — SupremeAI Home Launcher-এর মূল শেল (iOS-home-template)।
 *
 * বাংলা: ফোন-স্ক্রিনের ভেতরে চলা সম্পূর্ণ হোম-স্ক্রিন অভিজ্ঞতা —
 * - blurred wallpaper + page swipe-এ parallax (wallpaper 0.35× গতিতে সরে);
 * - বাঁয়ে/ডানে swipe → page snap (spring) + page dots;
 * - status bar-এর ঘড়ি লাইভ, উপরে pull-down → Notification Center (frosted);
 * - নিচে pull-up/tap → Control Center; অ্যাপ খোলা থাকলে সেটিই "home" বোতাম;
 * - আইকন ট্যাপ → আইকনের জায়গা থেকে zoom করে অ্যাপ খোলে (AppWindow);
 * - long-press → wiggle mode (rearrange), "Done" চাপলে শেষ;
 * - brightness overlay + flashlight glow Control Center-এর state থেকে।
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  animate, AnimatePresence, motion, useMotionValue, useTransform,
} from 'framer-motion';
import { BatteryFull, Signal, Wifi } from 'lucide-react';
import { THEMES, useLauncher } from './launcherStore';
import { APP_REGISTRY } from './registry';
import { AppIcon } from './AppIcon';
import { AppWindow } from './AppWindow';
import { NotificationCenter } from './NotificationCenter';
import { ControlCenter } from './ControlCenter';
import { ClockWidget, MusicWidget, SystemWidget, WeatherWidget } from './Widgets';
import { MusicEngine } from './apps/MusicApp';

function StatusBar({ onPullDown }: { onPullDown: (dy: number) => void }) {
  const [clock, setClock] = useState(() =>
    new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }));
  useEffect(() => {
    const t = window.setInterval(
      () => setClock(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })),
      30_000);
    return () => window.clearInterval(t);
  }, []);
  const startY = useRef<number | null>(null);
  return (
    <div
      className="absolute inset-x-0 top-0 z-40 flex h-11 items-center justify-between px-6 text-white"
      data-testid="home-statusbar"
      onPointerDown={(e) => { startY.current = e.clientY; }}
      onPointerUp={(e) => {
        if (startY.current === null) return;
        onPullDown(e.clientY - startY.current);
        startY.current = null;
      }}
      onPointerCancel={() => { startY.current = null; }}
    >
      <span className="text-xs font-semibold tracking-wide">{clock}</span>
      <span className="flex items-center gap-1.5">
        <Signal size={13} />
        <Wifi size={13} />
        <BatteryFull size={16} />
      </span>
    </div>
  );
}

export function HomeShell() {
  const theme = useLauncher((s) => s.theme);
  const layout = useLauncher((s) => s.layout);
  const page = useLauncher((s) => s.page);
  const setPage = useLauncher((s) => s.setPage);
  const wiggle = useLauncher((s) => s.wiggle);
  const setWiggle = useLauncher((s) => s.setWiggle);
  const openApp = useLauncher((s) => s.openApp);
  const launchRect = useLauncher((s) => s.launchRect);
  const closeApp = useLauncher((s) => s.closeApp);
  const panel = useLauncher((s) => s.panel);
  const setPanel = useLauncher((s) => s.setPanel);
  const brightness = useLauncher((s) => s.brightness);
  const flashlight = useLauncher((s) => s.flashlight);

  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const measure = () => {
      const el = rootRef.current;
      if (el) setSize({ w: el.clientWidth, h: el.clientHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (rootRef.current) ro.observe(rootRef.current);
    return () => ro.disconnect();
  }, []);

  const pageCount = layout.pages.length || 1;
  // বাংলা: page বদলালে spring দিয়ে snap; drag চলাকালীন এই motionValue-ই
  // wallpaper-এর parallax চালায় (0.35× — পেছনে ধীরে সরে, iOS-এর মতো)।
  const x = useMotionValue(0);
  const wallpaperX = useTransform(x, (v) => v * 0.35);
  useEffect(() => {
    if (!size.w) return;
    const controls = animate(x, -page * size.w, { type: 'spring', stiffness: 320, damping: 34 });
    return () => controls.stop();
  }, [page, size.w, x]);

  const onPagesDragEnd = (_: unknown, info: { offset: { x: number }; velocity: { x: number } }) => {
    const t = size.w * 0.28;
    if (info.offset.x < -t || info.velocity.x < -500) setPage(Math.min(pageCount - 1, page + 1));
    else if (info.offset.x > t || info.velocity.x > 500) setPage(Math.max(0, page - 1));
  };

  const bottomStartY = useRef<number | null>(null);
  const onBottomGesture = (dy: number) => {
    // বাংলা: dy = startY - endY → ধনাত্মক মানে উপরে-টানা, ০-এর কাছে মানে ট্যাপ।
    if (openApp) {
      // অ্যাপ খোলা থাকলে এই স্ট্রিপই "home" — ট্যাপ বা উপরে-টানলে বন্ধ;
      // নিচের দিকে টানলে বন্ধ হয় না (অনিচ্ছাকৃত ক্লিক এড়াতে)।
      if (dy > 24 || Math.abs(dy) < 6) closeApp();
      return;
    }
    if (dy > -6) setPanel('control');
  };

  const renderIcon = (id: (typeof APP_REGISTRY)[keyof typeof APP_REGISTRY]['id']) => {
    const def = APP_REGISTRY[id];
    return (
      <AppIcon key={id} appId={def.id} label={def.name} gradient={def.gradient}>
        <def.icon size={30} className="text-white drop-shadow" />
      </AppIcon>
    );
  };

  return (
    <div
      ref={rootRef}
      data-phone-screen
      className="relative size-full select-none overflow-hidden bg-black font-sans text-white"
      data-testid="home-launcher"
    >
      {/* Blurred wallpaper — parallax সহ (x = 0.35 × pages x) */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-[-20%] w-[140%]"
        style={{ x: wallpaperX, background: THEMES[theme].wallpaper, filter: 'blur(2px) saturate(1.15)' }}
      />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-black/10 backdrop-blur-[1px]" />

      {/* Brightness + flashlight overlay */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[45] bg-black transition-opacity duration-300"
        style={{ opacity: (100 - brightness) / 160 }}
      />
      {flashlight && <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-[45] bg-white/[0.07]" />}

      <StatusBar onPullDown={(dy) => { if (dy > 28 || Math.abs(dy) < 6) setPanel('notifications'); }} />

      {/* Pages — swipe/snap + drag */}
      <div className="absolute inset-0 overflow-hidden">
        <motion.div
          className="flex h-full"
          style={{ x }}
          drag="x"
          dragDirectionLock
          dragMomentum={false}
          dragElastic={0.06}
          dragConstraints={{ left: -(pageCount - 1) * size.w, right: 0 }}
          onDragEnd={onPagesDragEnd}
          data-testid="home-pages"
        >
          {layout.pages.map((apps, pi) => (
            <div key={pi} className="flex h-full w-full shrink-0 flex-col gap-4 px-5 pb-28 pt-14">
              {pi === 0 && (
                <div className="grid shrink-0 grid-cols-2 items-stretch gap-3">
                  <WeatherWidget />
                  <ClockWidget />
                </div>
              )}
              {pi === 1 && (
                <div className="flex shrink-0 flex-col gap-3">
                  <MusicWidget />
                  <SystemWidget />
                </div>
              )}
              <div className="flex flex-wrap items-start justify-around gap-y-4">
                {apps.map(renderIcon)}
              </div>
            </div>
          ))}
        </motion.div>
      </div>

      {/* Wiggle mode "Done" chip */}
      <AnimatePresence>
        {wiggle && (
          <motion.button
            type="button"
            onClick={() => setWiggle(false)}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="absolute left-1/2 top-12 z-40 -translate-x-1/2 rounded-full bg-white/90 px-4 py-1.5 text-xs font-bold text-slate-900 shadow-lg transition active:scale-95"
            data-testid="wiggle-done"
          >
            Done
          </motion.button>
        )}
      </AnimatePresence>

      {/* Page dots + dock */}
      <div className="absolute inset-x-0 bottom-[7.2rem] z-20 flex justify-center gap-1.5">
        {layout.pages.map((_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Page ${i + 1}`}
            onClick={() => setPage(i)}
            className={`size-1.5 rounded-full transition ${i === page ? 'bg-white' : 'bg-white/35'}`}
          />
        ))}
      </div>
      <div className="absolute inset-x-4 bottom-12 z-20 flex items-center justify-around rounded-[1.6rem] bg-white/10 px-2 py-3 ring-1 ring-white/15 backdrop-blur-xl">
        {layout.dock.map(renderIcon)}
      </div>

      {/* Home indicator + bottom gesture strip — অ্যাপ খোলা থাকলে এটিই "home" */}
      <div
        className="absolute inset-x-0 bottom-0 z-40 flex h-8 items-end justify-center pb-1.5"
        onPointerDown={(e) => { bottomStartY.current = e.clientY; }}
        onPointerUp={(e) => {
          if (bottomStartY.current === null) return;
          onBottomGesture(bottomStartY.current - e.clientY);
          bottomStartY.current = null;
        }}
        onPointerCancel={() => { bottomStartY.current = null; }}
        data-testid="home-indicator-strip"
      >
        <span className="h-1 w-24 rounded-full bg-white/80" />
      </div>

      {/* App window — আইকনের rect থেকে fullscreen zoom */}
      <AnimatePresence>
        {openApp && launchRect && size.w > 0 && (
          <AppWindow key={openApp} appId={openApp} rect={launchRect} full={{ w: size.w, h: size.h }} />
        )}
      </AnimatePresence>

      {/* Panels */}
      <AnimatePresence>
        {panel === 'notifications' && <NotificationCenter key="nc" />}
        {panel === 'control' && <ControlCenter key="cc" />}
      </AnimatePresence>

      {/* Music engine — সবসময় mounted: home-এ ফিরে গেলেও গান বাজে */}
      <MusicEngine />
    </div>
  );
}
