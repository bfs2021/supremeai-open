/**
 * CalendarApp — read-only sample month (iOS-home-template)।
 * বাংলা: বাস্তব বর্তমান মাসের গ্রিড + নমুনা ইভেন্ট; সম্পাদনার সুবিধা নেই
 * (চাহিদা অনুযায়ী read-only) — দিনে ট্যাপ করলে শুধু সেদিনের ইভেন্ট দেখায়।
 */

import { useState } from 'react';
import { CalendarDays, MapPin } from 'lucide-react';

interface SampleEvent {
  day: number;
  time: string;
  title: string;
  place: string;
  tone: string;
}

const EVENTS: SampleEvent[] = [
  { day: 3, time: '10:00', title: 'Sprint planning', place: 'War room', tone: 'bg-cyan-400' },
  { day: 9, time: '13:30', title: 'Design review — Home launcher', place: 'Studio', tone: 'bg-violet-400' },
  { day: 14, time: '09:00', title: 'Bridge intake sync', place: 'Online', tone: 'bg-emerald-400' },
  { day: 18, time: '16:00', title: 'Mobile QA pass', place: 'Device lab', tone: 'bg-amber-400' },
  { day: 23, time: '11:00', title: 'Release cut', place: 'Ops', tone: 'bg-rose-400' },
];

export function CalendarApp() {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = new Date(year, month, 1).getDay(); // 0=Sun
  const [selectedDay, setSelectedDay] = useState(today.getDate());

  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const dayEvents = EVENTS.filter((e) => e.day === selectedDay);

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto px-5 pb-8 pt-14 text-white">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">
          {today.toLocaleString('en-US', { month: 'long' })} <span className="text-white/50">{year}</span>
        </h1>
        <CalendarDays size={20} className="text-rose-300" />
      </header>

      <div className="grid grid-cols-7 gap-1 rounded-2xl bg-white/10 p-2.5 ring-1 ring-white/10">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <span key={`${d}-${i}`} className="pb-1 text-center text-[10px] font-semibold uppercase tracking-wider text-white/50">{d}</span>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <span key={`pad-${i}`} />;
          const isToday = d === today.getDate();
          const isSelected = d === selectedDay;
          const hasEvent = EVENTS.some((e) => e.day === d);
          return (
            <button
              key={d}
              type="button"
              onClick={() => setSelectedDay(d)}
              className={`relative flex aspect-square items-center justify-center rounded-full text-xs transition ${
                isSelected ? 'bg-rose-500 font-bold text-white' : isToday ? 'text-rose-300 font-semibold' : 'text-white/80 hover:bg-white/10'
              }`}
            >
              {d}
              {hasEvent && !isSelected && <span className="absolute bottom-0.5 size-1 rounded-full bg-cyan-300" />}
            </button>
          );
        })}
      </div>

      <section className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/10">
        <p className="mb-2 text-[11px] uppercase tracking-wider text-white/60">
          {today.toLocaleString('en-US', { month: 'short' })} {selectedDay} — sample events
        </p>
        {dayEvents.length === 0 ? (
          <p className="py-3 text-center text-xs text-white/45">Nothing scheduled — read-only sample calendar.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {dayEvents.map((e) => (
              <li key={e.title} className="flex items-center gap-3 rounded-xl bg-white/[0.06] px-3 py-2">
                <span className={`h-8 w-1 rounded-full ${e.tone}`} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{e.title}</p>
                  <p className="flex items-center gap-1 text-[11px] text-white/55"><MapPin size={10} /> {e.place}</p>
                </div>
                <span className="ml-auto text-xs font-semibold text-white/75">{e.time}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="mt-auto text-center text-[10px] text-white/35">Read-only demo — events are sample data.</p>
    </div>
  );
}
