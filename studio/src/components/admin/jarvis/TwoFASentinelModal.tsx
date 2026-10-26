import { useState } from 'react';
import { ShieldAlert, KeyRound, X, CheckCircle2 } from 'lucide-react';
import { ArcReactorOrb } from './ArcReactorOrb';
import { authService } from '../../../services/authService';

// বাংলা: destructive Jarvis কমান্ডের 2FA Sentinel — এখন শুধুই সার্ভার-যাচাইকৃত
// ৬-ডিজিট authentication code। আগের ৩টি bypass সম্পূর্ণ বাদ (literal ইচ্ছা করেই
// নথিতে রাখা হয়নি যেন সিক্রেট-স্ক্যান কখনো বৈধ credential মনে করে):
//   1. সোর্সে হার্ডকোডেড ডিফল্ট অ্যাডমিন টোকেন
//   2. হার্ডকোডেড ৪-ডিজিট ইমার্জেন্সি PIN
//   3. লোকাল biometric assertion (সার্ভার-যাচাই ছাড়াই onAuthorized)
// কোনো শর্টকাট নেই — সার্ভার প্রত্যাখ্যান করলে কমান্ড চলবে না।

interface TwoFASentinelModalProps {
  command: string;
  reason?: string | null;
  onAuthorized: () => void;
  onCancel: () => void;
}

export function TwoFASentinelModal({
  command,
  reason,
  onAuthorized,
  onCancel,
}: TwoFASentinelModalProps) {
  const [tokenInput, setTokenInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const handleTokenSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    const cleaned = tokenInput.trim();

    if (!cleaned) {
      setError('Please enter your 6-digit authentication code.');
      return;
    }

    if (!/^\d{6}$/.test(cleaned)) {
      setError('Authentication code must be exactly 6 digits.');
      return;
    }

    setVerifying(true);
    try {
      // সার্ভারই একমাত্র যাচাইকারী (remember চালু নয় — প্রতি কমান্ডে code লাগবে)
      const data = await authService.adminTotpVerify(cleaned, false);
      if (data && data.token) {
        onAuthorized();
        return;
      }
      setError('Invalid authentication code.');
      setTokenInput('');
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : 'Invalid authentication code.';
      setError(message);
      setTokenInput('');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/80 backdrop-blur-md px-4"
    >
      <div className="relative w-full max-w-md rounded-2xl border border-red-500/40 bg-[#090d16] p-6 shadow-2xl shadow-red-950/40 text-left">
        {/* Close Button */}
        <button
          type="button"
          onClick={onCancel}
          className="absolute right-4 top-4 text-slate-400 hover:text-white p-1 rounded-lg transition"
          aria-label="Cancel authorization"
        >
          <X size={18} />
        </button>

        {/* Header with Alert Orb */}
        <div className="flex items-center gap-4 border-b border-red-500/20 pb-4">
          <ArcReactorOrb state="alert" size={60} />
          <div>
            <div className="flex items-center gap-1.5 text-xs font-mono font-semibold tracking-wider uppercase text-red-400">
              <ShieldAlert size={15} /> 2FA Sentinel Guard
            </div>
            <h2 className="text-lg font-bold text-white tracking-tight">
              Authorization Required
            </h2>
          </div>
        </div>

        {/* Flagged Command Info */}
        <div className="mt-4 rounded-xl border border-red-500/20 bg-red-950/20 p-3 text-xs">
          <p className="text-slate-400 font-mono text-[11px] uppercase tracking-wider">
            Flagged Destructive Action:
          </p>
          <p className="mt-1 font-mono text-red-200 font-medium break-all">
            "{command}"
          </p>
          {reason && (
            <p className="mt-1 text-[10px] text-red-400/80">
              Matched trigger pattern: <span className="font-mono">{reason}</span>
            </p>
          )}
        </div>

        {/* Auth Method: server-verified authentication code only */}
        <div className="mt-5 space-y-4">
          <form onSubmit={handleTokenSubmit} className="space-y-3">
            <div className="relative">
              <KeyRound size={15} className="absolute left-3 top-3 text-slate-400" />
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="Enter 6-digit authentication code"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                autoFocus
                autoComplete="one-time-code"
                className="w-full rounded-xl border border-slate-700 bg-black/40 pl-9 pr-4 py-2.5 text-xs text-slate-200 font-mono placeholder:text-slate-500 outline-none focus:border-cyan-400/50"
              />
            </div>

            {error && (
              <p className="text-xs text-red-400 font-mono" role="alert">
                {error}
              </p>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 rounded-xl border border-slate-700 bg-slate-900/40 py-2.5 text-xs font-semibold text-slate-400 hover:text-slate-200 transition"
              >
                Abort Action
              </button>
              <button
                type="submit"
                disabled={verifying || tokenInput.length !== 6}
                className="flex-1 rounded-xl border border-red-500/40 bg-red-600/20 hover:bg-red-600/30 py-2.5 text-xs font-semibold text-red-200 transition flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <CheckCircle2 size={14} /> {verifying ? 'Verifying...' : 'Authorize & Run'}
              </button>
            </div>
          </form>
        </div>

        <p className="mt-4 text-center text-[10px] text-slate-500">
          Server-verified clearance only — no PIN or bypass shortcut exists.
        </p>
      </div>
    </div>
  );
}
