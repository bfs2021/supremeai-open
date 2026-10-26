import { useState, useRef, useEffect } from 'react';
import {
  ShieldCheck,
  Lock,
  KeyRound,
  ShieldAlert,
  Fingerprint,
  ArrowRight,
} from 'lucide-react';

// বাংলা: code-only admin gate — user dashboard থেকে admin dashboard-এ ঢুকতে
// শুধুই ৬-ডিজিট authentication code। প্রথমবার code দেওয়া বাধ্যতামূলক;
// "Fast-Pass Bypass" জাতীয় কোনো শর্টকাট আর নেই। ৭-দিন "browser মনে রাখো"
// চালু করলে ব্রাউজার সার্ভারের ডাটাবেসে সেভ হয় — নির্দিষ্ট সময়ের মধ্যে
// বার বার code দিতে হয় না (tryTrustedBrowser নীরবে যাচাই করে)।

interface LoginViewProps {
  adminError: string;
  handleAdminLogin: () => void;
  adminOtp: string;
  setAdminOtp: (val: string) => void;
  rememberBrowser: boolean;
  setRememberBrowser: (val: boolean) => void;
}

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

export function LoginView({
  adminError,
  handleAdminLogin,
  adminOtp,
  setAdminOtp,
  rememberBrowser,
  setRememberBrowser,
}: LoginViewProps) {
  const [localError, setLocalError] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const lockoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);
  const lastServerErrorRef = useRef<string>('');

  const [currentTime, setCurrentTime] = useState(() => Date.now());

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (lockedUntil !== null) {
      interval = setInterval(() => setCurrentTime(Date.now()), 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [lockedUntil]);

  const isLocked = lockedUntil !== null && currentTime < lockedUntil;
  const lockoutRemaining = lockedUntil ? Math.max(0, Math.ceil((lockedUntil - currentTime) / 1000)) : 0;

  // বাংলা: সার্ভার-সাইড ব্যর্থতা (নতুন error স্ট্রিং) প্রতিটি lockout কাউন্টারে
  // গোনা হয় — ৫ বার ভুল হলে ১৫ মিনিটের জন্য gate লক হয়ে যায়।
  useEffect(() => {
    if (adminError && adminError !== lastServerErrorRef.current) {
      lastServerErrorRef.current = adminError;
      const next = attemptsRef.current + 1;
      if (next >= MAX_ATTEMPTS) {
        attemptsRef.current = 0;
        setAttempts(0);
        const lockUntil = Date.now() + LOCKOUT_MS;
        setLockedUntil(lockUntil);
        if (lockoutTimerRef.current) clearTimeout(lockoutTimerRef.current);
        lockoutTimerRef.current = setTimeout(() => setLockedUntil(null), LOCKOUT_MS);
      } else {
        attemptsRef.current = next;
        setAttempts(next);
      }
    } else if (!adminError) {
      lastServerErrorRef.current = '';
    }
  }, [adminError]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isLocked) {
      setLocalError(`Too many failed attempts. Please wait ${lockoutRemaining} seconds.`);
      return;
    }

    if (!/^\d{6}$/.test(adminOtp.trim())) {
      setLocalError('Authentication code must be exactly 6 digits.');
      return;
    }

    setLocalError('');
    setIsSubmitting(true);

    try {
      // বাংলা: সার্ভারই একমাত্র যাচাইকারী — store ভেতরে error সেট করে;
      // ব্যর্থতা উপরের effect-এ গুনে lockout হয়।
      await handleAdminLogin();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-[85vh] w-full flex items-center justify-center p-4 sm:p-6 overflow-hidden select-none">
      {/* Background radial glow & cyber grid */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(14,165,233,0.15),transparent_70%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_80%_80%,rgba(168,85,247,0.12),transparent_60%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#08132612_1px,transparent_1px),linear-gradient(to_bottom,#08132612_1px,transparent_1px)] bg-[size:3.5rem_3.5rem]" />

      {/* Main Security Console Card */}
      <div className="relative z-10 w-full max-w-md rounded-3xl border border-cyan-500/25 bg-[#030712]/90 p-6 sm:p-8 shadow-[0_0_50px_rgba(8,145,178,0.2)] backdrop-blur-2xl transition-all">
        {/* Top Glowing Laser Rim */}
        <div className="absolute -top-[1px] left-10 right-10 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_#22d3ee]" />

        {/* Security Header & Biometric Shield */}
        <div className="text-center flex flex-col items-center gap-3 mb-6">
          <div className="relative flex items-center justify-center">
            <div className="absolute size-16 rounded-full bg-cyan-500/20 blur-xl animate-pulse" />
            <div className="relative size-14 rounded-2xl border border-cyan-400/40 bg-gradient-to-br from-cyan-950/60 to-purple-950/60 p-3 shadow-[0_0_20px_rgba(34,211,238,0.25)] flex items-center justify-center">
              <Fingerprint className="size-8 text-cyan-300 animate-pulse" />
            </div>
          </div>

          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-950/40 px-3 py-1 font-mono text-[10px] tracking-widest text-cyan-300 uppercase">
            <span className="size-1.5 rounded-full bg-cyan-400 animate-ping" />
            <span>QUANTUM SECURE // OPERATOR GATE</span>
          </div>

          <h2 className="font-mono text-xl sm:text-2xl font-bold tracking-tight text-white">
            Supreme OS <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400">Security Gate</span>
          </h2>
          <p className="text-slate-400 text-xs font-mono max-w-xs leading-relaxed">
            Enter your 6-digit authentication code. First entry is mandatory — there is no bypass.
          </p>
        </div>

        {/* Form Container */}
        <form
          className="flex flex-col gap-4 font-mono"
          onSubmit={handleSubmit}
          aria-label="Admin authentication form"
        >
          {/* 6-Digit Authentication Code (the only credential) */}
          <div className="space-y-2 text-left">
            <label htmlFor="admin-otp" className="block text-xs uppercase tracking-wider text-slate-300 font-semibold text-center">
              Enter 6-Digit Authentication Code
            </label>
            <div className="relative flex items-center">
              <KeyRound className="absolute left-3.5 size-4 text-cyan-400/60" />
              <input
                id="admin-otp"
                data-testid="otp-input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="000000"
                value={adminOtp}
                onChange={(e) => setAdminOtp(e.target.value.replace(/\D/g, ''))}
                className="w-full text-center text-xl font-bold tracking-[0.5em] rounded-xl border border-cyan-400/40 bg-black/70 py-3 pl-10 pr-4 text-cyan-300 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-400/30 outline-none transition"
                required
                autoComplete="one-time-code"
                aria-required="true"
                aria-invalid={localError || adminError ? 'true' : 'false'}
              />
            </div>
          </div>

          {/* 7-Day Trusted Browser (DB-backed remember) */}
          <label className="flex items-center justify-center gap-2.5 text-xs text-slate-300 cursor-pointer select-none py-1">
            <input
              type="checkbox"
              checked={rememberBrowser}
              onChange={(e) => setRememberBrowser(e.target.checked)}
              className="size-4 rounded border-cyan-500/40 bg-black/60 text-cyan-500 focus:ring-cyan-400 focus:ring-offset-0"
            />
            <span className="flex items-center gap-1.5 text-slate-300">
              <ShieldCheck className="size-3.5 text-emerald-400" />
              Trust this browser for 7 days (saved in database)
            </span>
          </label>

          {/* Error Message */}
          {(adminError || localError) && (
            <div className="flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-950/30 p-3 text-xs text-rose-300" role="alert">
              <ShieldAlert className="size-4 shrink-0 text-rose-400" />
              <span>
                {localError
                  ? typeof localError === 'string'
                    ? localError
                    : JSON.stringify(localError)
                  : typeof adminError === 'string'
                  ? adminError
                  : JSON.stringify(adminError)}
              </span>
            </div>
          )}

          {/* Locked Countdown */}
          {isLocked && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-950/30 p-3 text-xs text-amber-300" role="alert">
              <Lock className="size-4 shrink-0 text-amber-400" />
              <span>Security lockout active. Retry in {lockoutRemaining}s.</span>
            </div>
          )}

          {/* Submit Action Button */}
          <button
            type="submit"
            data-testid="otp-submit"
            disabled={isSubmitting || isLocked}
            className="group relative flex items-center justify-center gap-2 w-full rounded-xl bg-gradient-to-r from-cyan-500 via-indigo-600 to-purple-600 py-3.5 px-6 font-mono text-sm font-bold tracking-widest text-white uppercase shadow-[0_0_25px_rgba(6,182,212,0.35)] transition-all hover:shadow-[0_0_35px_rgba(6,182,212,0.55)] hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
          >
            <span>{isSubmitting ? 'Verifying Authentication Code...' : 'Verify Authentication Code'}</span>
            {!isSubmitting && <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />}
          </button>
        </form>

        {/* Footer Info */}
        <div className="mt-6 pt-4 border-t border-cyan-500/10 flex items-center justify-between font-mono text-[10px] text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            Zero-Firebase Native Auth
          </span>
          <span>Supreme OS v3.0</span>
        </div>
      </div>
    </div>
  );
}

export default LoginView;
