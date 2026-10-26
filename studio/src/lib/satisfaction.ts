// SupremeAI — Satisfaction pulse telemetry (P2 item, 2026-10-25 frontend
// research report §7 / Table 8: "satisfaction measurement — task completion,
// SUS/CSAT survey").
//
// বাংলা: জিরো-কস্ট স্থানীয় টেলিমেট্রি। সব রেকর্ড localStorage-এ ('sa-csat-v1')
// থাকে — কোনো নেটওয়ার্ক কল, ব্যাকএন্ড বা নতুন ডিপেন্ডেন্সি নেই। এটি পরবর্তী
// সংস্করণের প্রমাণ-ভিত্তি: getSatisfactionStats() দিয়ে যেকোনো ভবিষ্যৎ admin
// টাইল বা রিপোর্ট এই ডেটা পড়তে পারবে। CSAT-5 এখন স্কোপে; ১০-প্রশ্নের SUS
// ইনস্ট্রুমেন্ট ইচ্ছাকৃতভাবে পরে (smallest-safe-change — এক প্রশ্নের পালস
// সার্ভে রেসপন্স-রেট বেশি পায়, NN/g microsurvey গাইড)।
//
// থ্রটল পলিসি: প্রতি সারফেসে সর্বোচ্চ ১৪ দিনে একবার। স্কোর সাবমিট এবং
// ডিসমিস — দুটোই একই থ্রটল জানালা সেট করে, তাই ইউজারকে ধাওয়া করা হয় না।

export type SatisfactionSurface = 'chat';

export interface SatisfactionRecord {
  /** CSAT score 1..5 (5 = best). */
  score: number;
  surface: SatisfactionSurface;
  /** Optional free-text reason, trimmed to 280 chars. */
  comment?: string;
  /** ISO-8601 timestamp of submission. */
  at: string;
}

export interface SatisfactionStats {
  total: number;
  /** Arithmetic mean of scores, 1 decimal place (null when empty). */
  avg: number | null;
  /** Score -> count map for 1..5. */
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
  lastAt: string | null;
}

const STORAGE_KEY = 'sa-csat-v1';
const THROTTLE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const MAX_RECORDS = 500;
const MAX_COMMENT_CHARS = 280;
/** Minimum on-surface dwell before a pulse may appear (caller mounts the
 * component; this module owns the gate). */
export const PULSE_DWELL_MS = 90_000;

interface StoredState {
  records: SatisfactionRecord[];
  /** surface -> last pulse interaction (submit OR dismiss), epoch ms. */
  lastPulse: Record<string, number>;
}

function emptyState(): StoredState {
  return { records: [], lastPulse: {} };
}

function readState(): StoredState {
  if (typeof localStorage === 'undefined') return emptyState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<StoredState>;
    return {
      records: Array.isArray(parsed.records) ? parsed.records.filter((r) => r && typeof r.score === 'number') : [],
      lastPulse: parsed.lastPulse && typeof parsed.lastPulse === 'object' ? parsed.lastPulse : {},
    };
  } catch {
    return emptyState();
  }
}

function writeState(state: StoredState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage full/blocked — telemetry must never break the UI */
  }
}

/** True when the surface is allowed to ask right now (14-day window free). */
export function shouldPulse(surface: SatisfactionSurface, now = Date.now()): boolean {
  const last = readState().lastPulse[surface];
  return typeof last !== 'number' || now - last >= THROTTLE_MS;
}

/** Record a dismissal (no score) — starts the same throttle window. */
export function markPulseSeen(surface: SatisfactionSurface, now = Date.now()): void {
  const state = readState();
  state.lastPulse[surface] = now;
  writeState(state);
}

/** Persist one CSAT response. Score is clamped to 1..5; comment to 280 chars. */
export function recordSatisfaction(
  score: number,
  surface: SatisfactionSurface,
  comment?: string,
  now = Date.now(),
): SatisfactionRecord {
  const clamped = Math.min(5, Math.max(1, Math.round(score)));
  const record: SatisfactionRecord = {
    score: clamped,
    surface,
    at: new Date(now).toISOString(),
  };
  const trimmed = (comment ?? '').trim().slice(0, MAX_COMMENT_CHARS);
  if (trimmed) record.comment = trimmed;
  const state = readState();
  state.records.push(record);
  if (state.records.length > MAX_RECORDS) {
    state.records = state.records.slice(-MAX_RECORDS);
  }
  state.lastPulse[surface] = now;
  writeState(state);
  return record;
}

/** Local analytics read-out — the evidence base for the next version. */
export function getSatisfactionStats(surface?: SatisfactionSurface): SatisfactionStats {
  const { records } = readState();
  const scoped = surface ? records.filter((r) => r.surface === surface) : records;
  const distribution: SatisfactionStats['distribution'] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of scoped) {
    const s = Math.min(5, Math.max(1, Math.round(r.score))) as keyof typeof distribution;
    distribution[s] += 1;
  }
  const total = scoped.length;
  const sum = scoped.reduce((acc, r) => acc + r.score, 0);
  return {
    total,
    avg: total ? Math.round((sum / total) * 10) / 10 : null,
    distribution,
    lastAt: total ? scoped[scoped.length - 1].at : null,
  };
}
