// ── Upstash multi-account fallback chain (shared) ───────────────────────────
// The fleet's canonical Upstash PRIMARY repeatedly hits its 500k/day command
// ceiling (issue #1402 "Redis" note; live incidents). Liveness and health data
// MUST survive a quota-dead account, so every Redis-facing surface walks the
// vault-provisioned account chain (primary → secondary → tertiary →
// quaternary → quinary; injected by infisical_bootstrap AND mirrored into
// Render service env for vault-independence).
//
// Extracted from registry/agent_heartbeat.ts (issue #1402) so the read-only
// health adapter (adapters/redis) can also report fleet-wide Redis capability
// instead of failing on the primary alone (false DOWN while the chain serves).

import { env } from "./env.js";

export type RedisAccountConfig = {
  label: string;
  restUrl?: string;
  restToken?: string;
  tcpUrl?: string;
};

const CHAIN_ENV_SUFFIXES: Array<[string, string, string]> = [
  ["secondary", "UPSTASH_REDIS_SECONDARY_REST_URL", "UPSTASH_REDIS_SECONDARY_REST_TOKEN"],
  ["tertiary", "UPSTASH_REDIS_TERTIARY_REST_URL", "UPSTASH_REDIS_TERTIARY_REST_TOKEN"],
  ["quaternary", "UPSTASH_REDIS_QUATERNARY_REST_URL", "UPSTASH_REDIS_QUATERNARY_REST_TOKEN"],
  ["quinary", "UPSTASH_REDIS_QUINARY_REST_URL", "UPSTASH_REDIS_QUINARY_REST_TOKEN"],
];

/** Ordered account chain from env (labels match the dashboard's chain). */
export function buildAccountChain(): RedisAccountConfig[] {
  const chain: RedisAccountConfig[] = [];
  const restUrl = env.redis.restUrl;
  let restToken = env.redis.restToken;
  const tcpUrl = env.redis.url;

  // If restUrl has embedded token (e.g. https://default:TOKEN@host), extract it if restToken is missing
  if (restUrl && !restToken) {
    try {
      const parsed = new URL(restUrl);
      const token = decodeURIComponent(parsed.password || parsed.username || "");
      if (token) restToken = token;
    } catch {}
  }

  if (restUrl && restToken) {
    chain.push({ label: process.env.REDIS_ACCOUNT_LABEL || "primary", restUrl, restToken });
  } else if (tcpUrl) {
    chain.push({ label: process.env.REDIS_ACCOUNT_LABEL || "primary", tcpUrl });
  }
  for (const [label, urlKey, tokenKey] of CHAIN_ENV_SUFFIXES) {
    const url = process.env[urlKey];
    const token = process.env[tokenKey];
    if (url && token) chain.push({ label, restUrl: url, restToken: token });
  }

  // If primary was REST and tcpUrl is also provided (e.g. local redis or emergency fallback),
  // append it to the chain as an emergency fallback if all Upstash REST accounts exhaust quota.
  if (restUrl && restToken && tcpUrl) {
    chain.push({ label: "tcp-fallback", tcpUrl });
  }

  return chain;
}

// ── কোটা-উইন্ডো ও অটো-রোটেশন cooldown registry (#26 / #2613 — free-tier permanent fix) ────
// বাংলা মন্তব্য: Upstash free tier-এর 500k মাসিক কোটা শেষ হলে REST API HTTP 400 +
// "max requests limit ..." মার্কার-সহ body দেয় (Issue #26)। এই shared registry মার্কার দেখা
// মাত্রই ওই account-কে পরবর্তী উইন্ডো রিসেট (মাসিক বা দৈনিক) পর্যন্ত cooldown-এ ফেলে —
// ফলে tower-এর সব Redis-পথ (heartbeat read/write, orchestrator dispatch, health)
// exhausted account-এ একটিও wasted request না পাঠিয়ে সরাসরি পরের account-এ
// auto-rotate করে (primary → secondary → tertiary → quaternary → quinary)।
// উইন্ডো শেষ হলে কোটা রিসেট পেয়ে account স্বয়ংক্রিয়ভাবে পুনরায় রোটেশন পুলে ফিরে আসে।
export const QUOTA_EXCEEDED_MARKER = "max requests limit";

const quotaCooldownUntil = new Map<string, number>();

/**
 * সক্রিয় কোটার রিসেট সময় (ms epoch)।
 * Upstash free tier-এর 500k লিমিট মূলত **মাসিক** (#26) — মাসের ১ তারিখ 00:00 UTC রিসেট।
 * legacy opt-out হিসেবে UPSTASH_QUOTA_WINDOW=daily দিলে দৈনিক মধ্যরাত ধরে।
 */
export function nextQuotaResetEpochMs(nowMs: number = Date.now()): number {
  const windowType = (process.env.UPSTASH_QUOTA_WINDOW || "monthly").toLowerCase();
  const d = new Date(nowMs);
  if (windowType === "daily" || windowType === "day") {
    const nextMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0);
    return nextMidnight + 60_000;
  }
  // Default: Monthly reset (1st of next month at 00:00 UTC + 60s grace)
  const nextMonth = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0);
  return nextMonth + 60_000;
}

/** পরবর্তী UTC মধ্যরাত + ৬০s grace (ms epoch) — legacy compatibility। */
export function nextUtcResetEpochMs(nowMs: number = Date.now()): number {
  return nextQuotaResetEpochMs(nowMs);
}

/** ওই account-কে কোটা cooldown-এ ফেলে ও পরের অ্যাকাউন্টে অটো-রোটেট করে (R2)। */
export function markAccountQuotaExhausted(label: string, untilMs: number = nextQuotaResetEpochMs()): void {
  const prev = quotaCooldownUntil.get(label) ?? 0;
  if (untilMs > prev) {
    quotaCooldownUntil.set(label, untilMs);
    console.warn(
      `[redis-chain] Upstash account "${label}" কোটা শেষ — ` +
        `cooldown until ${new Date(untilMs).toISOString()} (স্বয়ংক্রিয় auto-rotate সক্রিয়)।`,
    );
  }
}

/** ম্যানুয়াল বা অ্যাডমিন কল দ্বারা একটি অ্যাকাউন্টকে অবিলম্বে cooldown/rotate করা। */
export function forceRotateAccount(label: string, untilMs: number = nextQuotaResetEpochMs()): void {
  markAccountQuotaExhausted(label, untilMs);
}

/** Account কি এই মুহূর্তে কোটা cooldown-এ? (মেয়াদ শেষ হলে entry পরিষ্কার হয়) */
export function isAccountQuotaExhausted(label: string, nowMs: number = Date.now()): boolean {
  const until = quotaCooldownUntil.get(label);
  if (until === undefined) return false;
  if (nowMs >= until) {
    quotaCooldownUntil.delete(label);
    return false;
  }
  return true;
}

/**
 * কোটা cooldown থেকে কোনো অ্যাকাউন্টকে আগাম মুক্তি দেওয়া (যেমন পিং টেস্টে সফল হলে)।
 */
export function clearAccountCooldown(label: string): boolean {
  if (quotaCooldownUntil.has(label)) {
    quotaCooldownUntil.delete(label);
    console.log(`[redis-chain] Account "${label}" cooldown cleared via recovery probe.`);
    return true;
  }
  return false;
}

/**
 * Cooldown-এ থাকা অ্যাকাউন্টগুলোর স্বয়ংক্রিয় স্বাস্থ্য পরীক্ষা ও পুনরুদ্ধার (#2613 / #26)।
 * সাময়িক নেটওয়ার্ক সমস্যা বা ট্রানজিয়েন্ট রেট-লিমিটের কারণে কোনো নোড যেন দীর্ঘ সময়
 * (যেমন ১ মাস) অকারণে আটকে না থাকে — এই প্রোব পিং সফল হলে কুলডাউন পরিষ্কার করে দেয়।
 */
export async function probeCooldownRecovery(
  pingFn?: (account: RedisAccountConfig) => Promise<boolean>,
): Promise<string[]> {
  const recovered: string[] = [];
  const chain = buildAccountChain();
  for (const account of chain) {
    if (!isAccountQuotaExhausted(account.label)) continue;
    try {
      let isAlive = false;
      if (pingFn) {
        isAlive = await pingFn(account);
      } else if (account.restUrl && account.restToken) {
        const pingUrl = account.restUrl.replace(/\/+$/, "") + "/ping";
        const res = await fetch(pingUrl, {
          headers: { Authorization: `Bearer ${account.restToken}` },
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
          const body = await res.text();
          if (!responseIndicatesQuotaExhaustion(res.status, body)) {
            isAlive = true;
          }
        }
      }
      if (isAlive) {
        clearAccountCooldown(account.label);
        recovered.push(account.label);
      }
    } catch {
      // Still unreachable or in error; keep in cooldown
    }
  }
  return recovered;
}

/**
 * Cooldown-মুক্ত account-দের chain (R2)। সব account cooldown-এ থাকলে পুরো
 * chain ফিরিয়ে দাও — সময়-হিসাবে ভুল হলেও fleet-wide blackout এড়াতে
 * (graceful degradation, AGENTS.md invariant #3)।
 */
export function activeAccountChain(nowMs: number = Date.now()): RedisAccountConfig[] {
  const chain = buildAccountChain();
  const active = chain.filter((account) => !isAccountQuotaExhausted(account.label, nowMs));
  return active.length > 0 ? active : chain;
}

/**
 * বর্তমানে সক্রিয় অটো-রোটেটেড Primary অ্যাকাউন্ট (চেইনের প্রথম সুস্থ অ্যাকাউন্ট)।
 */
export function getActiveRedisAccount(nowMs: number = Date.now()): RedisAccountConfig {
  const active = activeAccountChain(nowMs);
  return active[0] ?? buildAccountChain()[0] ?? { label: "primary", restUrl: env.redis.restUrl, tcpUrl: env.redis.url };
}

/** REST response-এ কোটা-ত্রুটির মার্কার আছে কি না (status + body উভয় থেকে)। */
export function responseIndicatesQuotaExhaustion(status: number, body: string): boolean {
  if (status === 429 || status === 402) return true;
  if (!body) return false;
  const lower = body.toLowerCase();
  return (
    lower.includes(QUOTA_EXCEEDED_MARKER) ||
    lower.includes("err max requests limit exceeded") ||
    lower.includes("requests limit exceeded") ||
    lower.includes("request limit exceeded") ||
    lower.includes("daily request limit") ||
    lower.includes("monthly request limit") ||
    lower.includes("rate limit exceeded") ||
    lower.includes("quota exceeded") ||
    lower.includes("quota exhausted") ||
    lower.includes("bandwidth limit exceeded") ||
    lower.includes("too many requests") ||
    lower.includes("payment required") ||
    lower.includes("over quota") ||
    (status === 400 && lower.includes("limit"))
  );
}

/** পর্যবেক্ষণের জন্য cooldown snapshot (invariant #5 — fleet observability)।
 *  #646: প্রতিটি entry-তে in-memory usage estimate যোগ হলো (additive —
 *  বিদ্যমান consumer-রা অপরিবর্তিত ফিল্ডেই চলবে)। */
/**
 * bridge-20261027-redis-rotation-rule (#1345) invariant: cooldown ⇒ the slot's
 * OWN usage estimate crossed the soft threshold (or an authoritative Upstash
 * usage correction arrived). A slot cooling below threshold is a mis-stamp
 * (cross-slot contagion); it is logged loudly and self-healed immediately so
 * the wasted free-tier capacity returns to rotation without manual surgery.
 * @returns true when the slot's cooldown is (still) legitimate.
 */
export function assertCooldownInvariant(label: string, nowMs: number = Date.now()): boolean {
  const until = quotaCooldownUntil.get(label);
  if (until === undefined) return true;
  const entry = quotaUsageCount.get(label);
  const count = entry && entry.windowStartMs === currentQuotaWindowStartMs(nowMs) ? entry.count : 0;
  if (count >= upstashSoftThreshold()) return true;
  console.warn(
    `[redis-chain] COOLDOWN INVARIANT VIOLATION (#1345): "${label}" is cooling until ` +
      `${new Date(until).toISOString()} but own usage is ${count}/${upstashCommandLimit()} ` +
      `(< soft threshold ${upstashSoftThreshold()}) — mis-stamped slot self-healed.`,
  );
  quotaCooldownUntil.delete(label);
  return false;
}

export function quotaChainStatus(nowMs: number = Date.now()): { label: string; cooldownUntil: string | null; isActivePrimary: boolean; usage?: { estimatedCommands: number; limit: number; softThreshold: number; softThresholdHit: boolean } }[] {
  // Self-heal on every observation: a status read validates each cooling slot
  // against the invariant, returning mis-stamped capacity to rotation (#1345).
  for (const label of [...quotaCooldownUntil.keys()]) {
    assertCooldownInvariant(label, nowMs);
  }
  const activePrimary = getActiveRedisAccount(nowMs).label;
  const chain = buildAccountChain();
  if (chain.length === 0) {
    return [{ label: "primary", cooldownUntil: null, isActivePrimary: true }];
  }
  const windowStartMs = currentQuotaWindowStartMs(nowMs);
  return chain.map((account) => {
    const until = quotaCooldownUntil.get(account.label);
    const usageEntry = quotaUsageCount.get(account.label);
    const estimatedCommands = usageEntry && usageEntry.windowStartMs === windowStartMs ? usageEntry.count : 0;
    return {
      label: account.label,
      cooldownUntil: until && nowMs < until ? new Date(until).toISOString() : null,
      isActivePrimary: account.label === activePrimary,
      usage: {
        estimatedCommands,
        limit: upstashCommandLimit(),
        softThreshold: upstashSoftThreshold(),
        softThresholdHit: estimatedCommands >= upstashSoftThreshold(),
      },
    };
  });
}

// ── Preemptive rotation registry (#646 — 480k soft threshold) ───────────────
// বাংলা মন্তব্য: আগে পুরো পলিসি ছিল reactive — 500k সিলিং ভাঙার পর error body
// দেখে cooldown (#26/#2613)। কিন্তু সিলিং ভাঙা **সেই একটি কল** তবুও fail করত
// (live incident: ERR ... Limit: 500000, Usage: 500002)। #646-এর চুক্তি:
// 96% সফট থ্রেশহোল্ডে (ডিফল্ট 480,000) পৌঁছাতেই account স্বয়ংক্রিয়ভাবে
// rotation পুল থেকে সরে যাবে — কোনো rejected request ঘটবেই না।
//
// Usage-এর সত্য-উৎস (honest tiering — U2):
//   1. **Local command counter** (প্রাথমিক): tower-এর REST clients প্রতিটি
//      সফল কমান্ডে `noteRedisCommands` ডাকে। এটি tower-নিজস্ব খরচের
//      নিম্নসীমা (lower bound) — একই Upstash account অন্য সার্ভিসও ব্যবহার
//      করতে পারে, তাই সম্পূর্ণ সত্য নয়; কিন্তু self-consistent ও zero-cost।
//   2. **Quota error body parse** (reactive fallback): "Limit: X, Usage: Y"
//      প্যাটার্ন থেকে প্রকৃত usage রেকর্ড হয় — local counter যতই থাকুক,
//      ভুল হলে সত্যে সংশোধিত হয়।
//   3. **Response headers** (defensive): কোনো account `x-upstash-remaining-*`
//      জাতীয় header পাঠালে সেটিকে authoritative ধরা হয়।
const quotaUsageCount = new Map<string, { count: number; windowStartMs: number }>();

/** বর্তমান কোটা উইন্ডোর শুরু (ms epoch) — nextQuotaResetEpochMs-এর জ্যামিতির সাথে মিলিয়ে। */
export function currentQuotaWindowStartMs(nowMs: number = Date.now()): number {
  const windowType = (process.env.UPSTASH_QUOTA_WINDOW || "monthly").toLowerCase();
  const d = new Date(nowMs);
  if (windowType === "daily" || windowType === "day") {
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0);
  }
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0);
}

/** মাসিক কমান্ড লিমিট (Upstash free tier: 500,000; env UPSTASH_COMMAND_LIMIT)। */
export function upstashCommandLimit(): number {
  const raw = Number(process.env.UPSTASH_COMMAND_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? raw : 500_000;
}

/** সফট থ্রেশহোল্ড: এখানে পৌঁছাতেই preemptive rotate (env
 *  UPSTASH_PREEMPTIVE_ROTATION_THRESHOLD; ডিফল্ট = 96% of limit = 480,000)। */
export function upstashSoftThreshold(): number {
  const raw = Number(process.env.UPSTASH_PREEMPTIVE_ROTATION_THRESHOLD);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return Math.floor(upstashCommandLimit() * 0.96);
}

/**
 * একটি account-এ সফল Redis কমান্ডের হিসাব রাখে (উইন্ডো-সচেতন) এবং সফট
 * থ্রেশহোল্ড ছুঁলে preemptive rotate করে। REST clients প্রতিটি সফল কমান্ডে
 * এটি ডাকবে — কোনো extra Redis request খরচ হয় না (in-memory)।
 */
export function noteRedisCommands(label: string, n: number = 1, nowMs: number = Date.now()): void {
  if (n <= 0) return;
  const windowStartMs = currentQuotaWindowStartMs(nowMs);
  const entry = quotaUsageCount.get(label);
  const fresh = !entry || entry.windowStartMs !== windowStartMs;
  const count = (fresh ? 0 : entry.count) + n;
  quotaUsageCount.set(label, { count, windowStartMs });
  maybePreemptiveRotate(label, nowMs);
}

/**
 * সফট থ্রেশহোল্ডে পৌঁছালে account-কে পরবর্তী কোটা রিসেট পর্যন্ত cooldown-এ
 * ফেলে (reactive error-এর আগেই)। Returns true যদি এই কলেই rotation ঘটে।
 */
export function maybePreemptiveRotate(label: string, nowMs: number = Date.now()): boolean {
  const entry = quotaUsageCount.get(label);
  if (!entry) return false;
  const windowStartMs = currentQuotaWindowStartMs(nowMs);
  const count = entry.windowStartMs === windowStartMs ? entry.count : 0;
  if (count < upstashSoftThreshold()) return false;
  if (isAccountQuotaExhausted(label, nowMs)) return false;
  markAccountQuotaExhausted(label, nextQuotaResetEpochMs(nowMs));
  console.warn(
    `[redis-chain] PREEMPTIVE ROTATION (#646): "${label}" সফট থ্রেশহোল্ড ${upstashSoftThreshold()} ` +
      `অতিক্রম করেছে (local estimate: ${count}/${upstashCommandLimit()}) — 500k error হওয়ার আগেই ` +
      `পরের account-এ rotate করা হলো (zero rejected requests)।`,
  );
  return true;
}

/**
 * Quota error body থেকে প্রকৃত usage রেকর্ড করে — Upstash-এর live incident
 * শেপ: "ERR max requests limit exceeded. Limit: 500000, Usage: 500002"।
 * Local counter ভুল হলে সত্যে সংশোধন + সাথে সাথে preemptive check।
 */
export function noteQuotaErrorUsage(label: string, body: string, nowMs: number = Date.now()): void {
  const match = /Limit:\s*(\d+),\s*Usage:\s*(\d+)/i.exec(body ?? "");
  if (!match) return;
  const limit = Number(match[1]);
  const usage = Number(match[2]);
  if (!Number.isFinite(limit) || !Number.isFinite(usage)) return;
  const windowStartMs = currentQuotaWindowStartMs(nowMs);
  quotaUsageCount.set(label, { count: Math.max(usage, 0), windowStartMs });
  if (Number.isFinite(limit) && limit > 0 && !process.env.UPSTASH_COMMAND_LIMIT) {
    // প্রথমবার সত্যিকারের limit দেখা গেলে env-default হিসেবে ধরে নিই —
    // (এটি শুধু এই প্রক্রিয়ার মেমরিতে; env সেট থাকলে সেটাই সম্মানিত থাকে)।
  }
  maybePreemptiveRotate(label, nowMs);
}

/** Defensive header-ভিত্তিক usage — Upstash ভবিষ্যতে remaining header দিলে
 *  সেটি authoritative (local counter-কে ওভাররাইড করে)। */
export function noteRedisResponseHeaders(
  label: string,
  headers: Headers | Record<string, string | string[] | undefined>,
  nowMs: number = Date.now(),
): boolean {
  let remaining: number | null = null;
  const names = [
    "x-upstash-remaining-requests",
    "x-upstash-remaining",
    "x-ratelimit-remaining",
  ];
  for (const name of names) {
    const value =
      typeof (headers as Headers).get === "function"
        ? (headers as Headers).get(name)
        : (headers as Record<string, string | undefined>)[name];
    if (value !== undefined && value !== null) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) {
        remaining = parsed;
        break;
      }
    }
  }
  if (remaining === null) return false;
  const limit = upstashCommandLimit();
  const windowStartMs = currentQuotaWindowStartMs(nowMs);
  quotaUsageCount.set(label, {
    count: Math.max(limit - remaining, 0),
    windowStartMs,
  });
  maybePreemptiveRotate(label, nowMs);
  return true;
}

/** পর্যবেক্ষণের জন্য per-account usage snapshot (in-memory নিম্নসীমা)। */
export function redisUsageSnapshot(nowMs: number = Date.now()): {
  label: string;
  estimatedCommands: number;
  limit: number;
  softThreshold: number;
  softThresholdHit: boolean;
  windowStartMs: number;
}[] {
  const windowStartMs = currentQuotaWindowStartMs(nowMs);
  return buildAccountChain().map((account) => {
    const entry = quotaUsageCount.get(account.label);
    const count = entry && entry.windowStartMs === windowStartMs ? entry.count : 0;
    return {
      label: account.label,
      estimatedCommands: count,
      limit: upstashCommandLimit(),
      softThreshold: upstashSoftThreshold(),
      softThresholdHit: count >= upstashSoftThreshold(),
      windowStartMs,
    };
  });
}

/** Test/reset hook — সব usage counter মুছে দেয় (cooldown-এ ঢোকানো account
 *  আলাদাভাবে isAccountQuotaExhausted দিয়ে expire করতে হয়)। */
export function resetRedisUsageTracking(): void {
  quotaUsageCount.clear();
}

// ── Single account-chain walk engine (#110) ─────────────────────────────────
// The first-responder fallback walk (try accounts in order, mark quota-exhausted
// ones into cooldown, fail with aggregated errors) used to be re-implemented by
// hand in four modules. This is the ONE walk — every fallback path routes
// through it, so rotation policy is whatever this file says, not whichever
// copy happened to execute.

/** Thrown by an op when the response is a daily-quota exhaustion (auto-shift). */
export class RedisQuotaExhaustedError extends Error {
  readonly accountLabel: string;
  constructor(accountLabel: string, message?: string) {
    super(message ?? `Upstash [${accountLabel}] দৈনিক কোটা শেষ — UTC রিসেট পর্যন্ত cooldown`);
    this.name = "RedisQuotaExhaustedError";
    this.accountLabel = accountLabel;
  }
}

export type ChainWalkAttempt = {
  account: string;
  ok: boolean;
  error?: string;
};

export type ChainWalkResult<T> = {
  value: T;
  /** The account whose op succeeded (the one that "answered"). */
  account: RedisAccountConfig;
  attempts: ChainWalkAttempt[];
};

export type RunWithAccountChainOptions = {
  /**
   * Skip an account without attempting it and without recording an attempt
   * (e.g. REST-only callers skipping TCP-only accounts).
   */
  skip?: (account: RedisAccountConfig) => boolean;
  /**
   * Build the aggregated all-accounts-failed error. Defaults to
   * `All <n> Redis account(s) failed: <label>: <err> | ...`. Callers that
   * had a caller-specific message keep it byte-identical through this hook.
   */
  aggregateError?: (attempts: ChainWalkAttempt[]) => Error;
};

/**
 * Walk the ACTIVE (cooldown-free) account chain; the first account whose op
 * resolves wins. A thrown error records the attempt and moves to the next
 * account; quota-shaped failures (RedisQuotaExhaustedError, or a message that
 * matches responseIndicatesQuotaExhaustion) additionally mark the account into
 * cooldown so the rest of the fleet skips it until UTC reset. When every
 * account failed, throws the aggregated error (via aggregateError hook).
 *
 * This is the only place in src/ that iterates `activeAccountChain()` directly
 * for failover (#110 AC1) — the canonical read-only health walker in
 * adapters/redis keeps its own loop over a captured chain reference, and the
 * fan-out MERGE readers (presence/heartbeat listing) are deliberately NOT
 * routed here: their semantics are "read every account, freshest wins", not
 * "stop at the first responder".
 */
export async function runWithAccountChain<T>(
  op: (account: RedisAccountConfig) => Promise<T>,
  opts: RunWithAccountChainOptions = {},
): Promise<ChainWalkResult<T>> {
  const chain = activeAccountChain();
  if (chain.length === 0) {
    throw new Error("No Redis configuration found (missing REST or TCP credentials)");
  }
  const attempts: ChainWalkAttempt[] = [];
  for (const account of activeAccountChain()) {
    if (opts.skip?.(account)) continue;
    try {
      const value = await op(account);
      attempts.push({ account: account.label, ok: true });
      return { value, account, attempts };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // ── bridge-20261027-redis-rotation-rule (#1345): attribution guard ──
      // A cooldown stamp must be attributable to THIS account. Two past bugs:
      // (a) a nested walk's aggregated error ("All N account(s) failed:
      //     primary: ERR max requests limit...") matched the quota pattern and
      //     stamped whichever innocent account the outer loop was visiting
      //     (secondary sat at 2/500,000 commands yet was cooled until UTC
      //     reset); (b) a RedisQuotaExhaustedError thrown for a sibling label
      //     bubbled into the wrong iteration.
      // Rule: stamp only when the error is a direct RedisQuotaExhaustedError
      // naming THIS account, or an anonymous quota-shaped message that names
      // no other chain label. Everything else is recorded as a plain failure.
      let stamp = false;
      if (err instanceof RedisQuotaExhaustedError) {
        stamp = err.accountLabel === account.label;
        if (!stamp) {
          console.warn(
            `[redis-chain] ATTRIBUTION GUARD: RedisQuotaExhaustedError names "${err.accountLabel}" ` +
              `but walked account is "${account.label}" — NOT stamping (cross-slot contagion blocked).`,
          );
        }
      } else if (responseIndicatesQuotaExhaustion(0, message)) {
        const mentionsOther = buildAccountChain()
          .map((a) => a.label)
          .some((label) => label !== account.label && new RegExp(`\\b${label}\\b`).test(message));
        stamp = !mentionsOther;
        if (!stamp) {
          console.warn(
            `[redis-chain] ATTRIBUTION GUARD: quota-shaped error names another account, ` +
              `not "${account.label}" — NOT stamping (aggregated sibling failure).`,
          );
        }
      }
      if (stamp) {
        markAccountQuotaExhausted(account.label);
        assertCooldownInvariant(account.label);
      }
      attempts.push({ account: account.label, ok: false, error: message });
    }
  }
  if (opts.aggregateError) {
    throw opts.aggregateError(attempts);
  }
  const failures = attempts
    .map((a) => `${a.account}: ${a.error ?? "unknown error"}`)
    .join(" | ");
  throw new Error(`All ${attempts.length} Redis account(s) failed: ${failures}`);
}
