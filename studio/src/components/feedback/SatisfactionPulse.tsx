import React from 'react';
import { X } from 'lucide-react';
import {
  PULSE_DWELL_MS,
  markPulseSeen,
  recordSatisfaction,
  shouldPulse,
  type SatisfactionSurface,
} from '../../lib/satisfaction';

// Satisfaction pulse (P2, 2026-10-25 frontend research report §7/Table 8):
// a one-question CSAT micro-survey. বাংলা: অ্যাক্টিভ চ্যাট সারফেসে ৯০ সেকেন্ড
// থাকার পর একবার ভেসে ওঠে; ১৪ দিনে সর্বোচ্চ একবার (স্কোর দিলে বা বন্ধ করলে
// দুই ক্ষেত্রেই থ্রটল চালু হয়)। রিপোর্টের অ্যাক্সেসিবিলিটি স্তম্ভ মেনে ৪৪px
// টাচ-টার্গেট, দৃশ্যমান ফোকাস-রিং ও Esc-পথ রাখা হয়েছে। ডিফল্টে অফ — শুধুমাত্র
// যে হোস্ট স্পষ্টভাবে opt-in করে (admin ড্যাশবোর্ড এম্বেড পিক্সেল-অপরিবর্তিত
// থাকে, showDock-এর মতোই)।

const SCORE_LABELS: Record<number, string> = {
  1: 'Frustrating',
  2: 'Rough',
  3: 'Okay',
  4: 'Good',
  5: 'Excellent',
};

type Phase = 'waiting' | 'asking' | 'comment' | 'thanks';

export function SatisfactionPulse({ surface = 'chat' }: { surface?: SatisfactionSurface }) {
  const [phase, setPhase] = React.useState<Phase>('waiting');
  const [score, setScore] = React.useState<number | null>(null);
  const [comment, setComment] = React.useState('');
  const timerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    timerRef.current = window.setTimeout(() => {
      if (shouldPulse(surface)) setPhase('asking');
    }, PULSE_DWELL_MS);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [surface]);

  const dismiss = React.useCallback(() => {
    markPulseSeen(surface);
    setPhase('waiting');
  }, [surface]);

  React.useEffect(() => {
    if (phase !== 'asking' && phase !== 'comment') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, dismiss]);

  if (phase === 'waiting') return null;

  if (phase === 'thanks') {
    return (
      <div
        data-testid="satisfaction-pulse"
        role="status"
        className="pointer-events-none fixed bottom-24 right-4 z-30 rounded-2xl border border-white/10 bg-[var(--surface-glass,rgba(15,23,42,0.85))] px-4 py-3 text-sm text-slate-200 shadow-[var(--glow-accent,0_0_24px_rgba(168,85,247,0.15))] backdrop-blur-md sm:right-6"
      >
        Thanks — noted for the next release.
      </div>
    );
  }

  return (
    <div
      data-testid="satisfaction-pulse"
      role="dialog"
      aria-label="Rate your experience"
      className="fixed bottom-24 right-4 z-30 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-white/10 bg-[var(--surface-glass,rgba(15,23,42,0.85))] p-4 shadow-[var(--glow-accent,0_0_24px_rgba(168,85,247,0.15))] backdrop-blur-md sm:right-6"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-slate-100">How is SupremeAI working for you?</p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss survey"
          data-testid="satisfaction-dismiss"
          className="-mt-1 -mr-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--glow-accent-color,rgb(168,85,247))]"
        >
          <X size={16} />
        </button>
      </div>

      {phase === 'asking' ? (
        <div className="flex items-center justify-between gap-1.5">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => { setScore(value); setPhase('comment'); }}
              aria-label={`${value} — ${SCORE_LABELS[value]}`}
              title={`${value} — ${SCORE_LABELS[value]}`}
              data-testid={`satisfaction-score-${value}`}
              className="h-11 min-w-11 flex-1 rounded-xl border border-white/10 bg-slate-900/70 text-sm font-semibold text-slate-300 transition hover:border-fuchsia-400/50 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--glow-accent-color,rgb(168,85,247))]"
            >
              {value}
            </button>
          ))}
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (score === null) return;
            recordSatisfaction(score, surface, comment);
            setPhase('thanks');
            window.setTimeout(() => setPhase('waiting'), 2600);
          }}
          className="flex flex-col gap-2.5"
        >
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={280}
            rows={2}
            placeholder={`What earns the ${score}? (optional)`}
            aria-label="Optional comment"
            data-testid="satisfaction-comment"
            className="w-full resize-none rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-fuchsia-400/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--glow-accent-color,rgb(168,85,247))]"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-400">{score} — {score !== null ? SCORE_LABELS[score] : ''}</span>
            <button
              type="submit"
              data-testid="satisfaction-submit"
              className="h-11 rounded-xl border border-fuchsia-400/40 bg-fuchsia-500/10 px-4 text-sm font-semibold text-fuchsia-200 transition hover:bg-fuchsia-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--glow-accent-color,rgb(168,85,247))]"
            >
              Send
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default SatisfactionPulse;
