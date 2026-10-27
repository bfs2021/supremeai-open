/**
 * WeatherApp — current + 7-day forecast (iOS-home-template)।
 * বাংলা: বাইরের কোনো API/কি নেই ($0 নীতি) — deterministic ডেমো ডেটা দিয়েই
 * পূর্ণ অভিজ্ঞতা; প্রতি ৪৫ সেকেন্ডে হালকা "refresh" ভ্যারিয়েশন widget-ও পালস করে।
 */

import { useEffect, useState } from 'react';
import { CloudRain, CloudSun, Cloudy, Sun, Wind, Droplets } from 'lucide-react';

interface Day {
  label: string;
  icon: typeof Sun;
  lo: number;
  hi: number;
}

const WEEK: Day[] = [
  { label: 'Today', icon: CloudSun, lo: 22, hi: 31 },
  { label: 'Tue', icon: Sun, lo: 23, hi: 33 },
  { label: 'Wed', icon: CloudSun, lo: 23, hi: 32 },
  { label: 'Thu', icon: Cloudy, lo: 22, hi: 30 },
  { label: 'Fri', icon: CloudRain, lo: 21, hi: 28 },
  { label: 'Sat', icon: CloudRain, lo: 21, hi: 27 },
  { label: 'Sun', icon: CloudSun, lo: 22, hi: 30 },
];

const CONDITIONS = ['Mostly Clear', 'Sunny', 'Partly Cloudy', 'Overcast', 'Light Rain'];

export function WeatherApp() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((v) => v + 1), 45_000);
    return () => window.clearInterval(t);
  }, []);
  const temp = 28 + (tick % 3);
  const condition = CONDITIONS[tick % CONDITIONS.length];

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto px-5 pb-6 pt-14 text-white">
      <header className="text-center">
        <p className="text-sm font-medium text-white/70">Dhaka</p>
        <p className="text-[4.2rem] font-extralight leading-none tracking-tight">{temp}°</p>
        <p className="text-sm text-white/80">{condition}</p>
        <p className="text-xs text-white/60">H: {WEEK[0].hi}° · L: {WEEK[0].lo}°</p>
      </header>

      <div className="grid grid-cols-5 gap-2 rounded-2xl bg-white/10 p-3 ring-1 ring-white/10">
        {[9, 12, 15, 18, 21].map((h, i) => (
          <div key={h} className="flex flex-col items-center gap-1.5 text-[11px] text-white/80">
            <span>{h}:00</span>
            {i % 2 === 0 ? <Sun size={16} className="text-amber-300" /> : <CloudSun size={16} className="text-cyan-200" />}
            <span className="font-semibold text-white">{temp + ((i * 7) % 3) - 1}°</span>
          </div>
        ))}
      </div>

      <section className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/10">
        <p className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-white/60">
          <Wind size={12} /> 7-day forecast
        </p>
        <ul className="flex flex-col divide-y divide-white/10">
          {WEEK.map((d, i) => {
            const lo = d.lo + (tick % 2);
            const hi = d.hi + (tick % 2);
            return (
              <li key={d.label} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-12 text-white/80">{d.label}</span>
                <d.icon size={18} className={d.icon === Sun ? 'text-amber-300' : 'text-cyan-200'} />
                <span className="ml-auto w-8 text-right text-white/60">{lo}°</span>
                <span className="h-1.5 w-20 overflow-hidden rounded-full bg-white/15">
                  <span
                    className="block h-full rounded-full bg-gradient-to-r from-cyan-300 to-amber-300"
                    style={{ width: `${((hi - 18) / 17) * 100}%`, opacity: 1 - i * 0.08 }}
                  />
                </span>
                <span className="w-8 text-right font-semibold">{hi}°</span>
              </li>
            );
          })}
        </ul>
      </section>

      <footer className="flex items-center justify-center gap-4 text-[11px] text-white/60">
        <span className="flex items-center gap-1"><Droplets size={12} /> Humidity 68%</span>
        <span className="flex items-center gap-1"><Wind size={12} /> 12 km/h</span>
      </footer>
    </div>
  );
}
