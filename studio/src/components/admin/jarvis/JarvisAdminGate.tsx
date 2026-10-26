import { useState, useEffect, useRef, useCallback } from 'react';
import { ShieldCheck } from 'lucide-react';
import { ArcReactorOrb } from './ArcReactorOrb';
import { authService } from '../../../services/authService';
import { getTrustedBrowserToken } from '../../../services/tokenStorage';

// বাংলা: JARVIS admin gate — সার্ভার-যাচাইকৃত ৬-ডিজিট authentication code
// ছাড়া প্রবেশ নেই। আগের সংস্করণে ৩টি bypass ছিল, সব বাদ (literal ইচ্ছা করেই
// নথিতে রাখা হয়নি যেন সিক্রেট-স্ক্যান কখনো বৈধ credential মনে করে):
//   1. UI-তেই প্রিন্ট করা হার্ডকোডেড ইমার্জেন্সি মাস্টার PIN
//   2. localStorage-seed দিয়ে লোকাল TOTP যাচাই (যে কেউ নিজের seed বসাতে পারত)
//   3. ক্লায়েন্ট-সাইড trust timestamp (forgeable) — এখন ৭-দিন ট্রাস্ট সার্ভারের
//      ডাটাবেসে থাকে; মেয়াদের মধ্যে নীরব পুনঃপ্রবেশ, মেয়াদ শেষে আবার code।

interface JarvisAdminGateProps {
  onUnlocked: () => void;
}

export function JarvisAdminGate({ onUnlocked }: JarvisAdminGateProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(true);

  // Fast-path: DB-backed trusted browser (7-day remember) — সার্ভারই যাচাই করে।
  const trustedProbeDoneRef = useRef(false);
  useEffect(() => {
    if (trustedProbeDoneRef.current) return;
    trustedProbeDoneRef.current = true;
    const trusted = getTrustedBrowserToken();
    if (!trusted) return;
    authService
      .adminTrustedBrowserLogin(trusted)
      .then((data) => {
        if (data.status === 'trusted_browser') {
          onUnlocked();
        }
      })
      .catch(() => {
        // মেয়াদোত্তীর্ণ/অবৈধ — gate থাকবে; ব্যবহারকারী নতুন code দেবে।
      });
  }, [onUnlocked]);

  const recordSuccess = useCallback(() => {
    // বাংলা: rememberDevice চালু থাকলে authService.adminTotpVerify সার্ভারের
    // trusted_browser_token ডাটাবেস-চুক্তি অনুযায়ী সংরণ করেছে — এখানে আর
    // কোনো ক্লায়েন্ট-সাইড trust লেখা হয় না।
    onUnlocked();
  }, [onUnlocked]);

  const submit = useCallback(
    async (codeToVerify?: string) => {
      const target = (codeToVerify ?? code).trim().replace(/\s+/g, '');
      if (!target || busy) return;

      setBusy(true);
      setError(null);

      try {
        // সার্ভারই একমাত্র যাচাইকারী — লোকাল TOTP/PIN শর্টকাট নেই।
        const data = await authService.adminTotpVerify(target, rememberDevice);
        if (data && data.token) {
          setBusy(false);
          recordSuccess();
          return;
        }
        setError('Invalid Authenticator code.');
        setCode('');
      } catch (err) {
        const message = err instanceof Error && err.message ? err.message : 'Access denied. Incorrect Authenticator code.';
        setError(message);
        setCode('');
      } finally {
        setBusy(false);
      }
    },
    [code, busy, rememberDevice, recordSuccess]
  );

  // Auto-submit when user enters 6 digits
  const handleInputChange = (val: string) => {
    const sanitized = val.replace(/[^\d]/g, '').slice(0, 6);
    setCode(sanitized);
    if (sanitized.length === 6) {
      submit(sanitized);
    }
  };

  return (
    <div className="fixed inset-0 z-modal flex flex-col items-center justify-center gap-6 bg-[#04070f] px-6 text-slate-100 select-none">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(14,165,183,0.12),transparent_70%)]" />

      {/* Brand Header */}
      <div className="relative flex flex-col items-center gap-3">
        <ArcReactorOrb state="idle" size={140} />
        <h1 className="mt-3 font-mono text-xl tracking-[0.35em] text-cyan-300 font-bold">
          SUPREME OS
        </h1>
        <p className="flex items-center gap-1.5 font-mono text-[11px] tracking-[0.25em] text-cyan-500 uppercase">
          <ShieldCheck size={14} className="text-cyan-400" /> Google Authenticator Protected
        </p>
      </div>

      {/* Input Box Card */}
      <div className="relative w-full max-w-sm space-y-3.5">
        <div className="space-y-1">
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="000 000"
            value={code}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            className="h-14 w-full rounded-xl border border-cyan-500/30 bg-black/60 px-4 text-center font-mono text-2xl tracking-[0.4em] text-cyan-200 outline-none transition placeholder:text-cyan-950 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400"
            autoFocus
            autoComplete="one-time-code"
          />
          <p className="text-center font-mono text-[10px] text-cyan-600">
            Enter 6-digit authentication code — first entry is mandatory, no bypass
          </p>
        </div>

        {error && (
          <p className="text-center font-mono text-xs text-red-400 bg-red-950/20 py-1.5 px-3 rounded-lg border border-red-500/20">
            {error}
          </p>
        )}

        {/* 7-Day Remember Checkbox */}
        <label className="flex items-center justify-center gap-2 cursor-pointer pt-1 font-mono text-xs text-cyan-300/80 hover:text-cyan-200 transition">
          <input
            type="checkbox"
            checked={rememberDevice}
            onChange={(e) => setRememberDevice(e.target.checked)}
            className="size-4 rounded border-cyan-500/40 bg-black/50 text-cyan-500 focus:ring-0 focus:ring-offset-0 accent-cyan-500"
          />
          <span>Remember this browser for 7 days (saved in database)</span>
        </label>

        {/* Submit Button */}
        <button
          onClick={() => submit()}
          disabled={busy || !code.trim()}
          className="h-12 w-full rounded-xl border border-cyan-500/40 bg-cyan-950/40 font-mono text-sm tracking-[0.25em] text-cyan-300 font-semibold transition hover:bg-cyan-900/60 hover:text-white disabled:opacity-40"
        >
          {busy ? 'VERIFYING...' : 'AUTHENTICATE'}
        </button>

        <p className="text-center font-mono text-[10px] text-cyan-800 pt-2 border-t border-cyan-500/15">
          Server-verified access only — the authentication code cannot be skipped.
        </p>
      </div>
    </div>
  );
}

const BOOT_LINES = [
  'SUPREME OS v0.2 — ULTIMATE CONTROL CENTER (ADMIN TRIAL)',
  '> ARC REACTOR ................. ONLINE',
  '> VOICE PIPELINE (ASR/TTS) .... READY',
  '> NEURAL CASCADE .............. ACTIVE (EDGE-TTS / BROWSER)',
  '> 2FA SENTINEL (T2/T3) ........ ARMED',
  '> PERSONALITY CORE ............ CLASSIC J.',
];

export function JarvisBootSequence({ onDone }: { onDone: () => void }) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (shown >= BOOT_LINES.length) {
      const t = setTimeout(onDone, 600);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setShown((s) => s + 1), 300);
    return () => clearTimeout(t);
  }, [shown, onDone]);

  return (
    <div className="fixed inset-0 z-overlay flex flex-col items-center justify-center bg-[#04070f] px-6 text-slate-100 select-none">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(14,165,183,0.1),transparent_70%)]" />
      <div className="relative w-full max-w-lg space-y-1.5 font-mono text-[13px] text-cyan-400">
        {BOOT_LINES.slice(0, shown).map((l, i) => (
          <p key={i} className={i === 0 ? 'mb-4 tracking-[0.2em] text-cyan-300 font-bold' : ''}>
            {l}
          </p>
        ))}
        <span className="inline-block h-4 w-2 animate-pulse bg-cyan-400" />
      </div>
      <div className="relative mt-10">
        <ArcReactorOrb state="boot" size={130} />
      </div>
    </div>
  );
}
