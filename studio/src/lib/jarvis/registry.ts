// ============================================================
// SUPREMEAI JARVIS — Shared Intent Registry & Router (Phase A)
// Zero-cost local command layer for the unified chat.
// Owner request 2026-10-25: "Search + Help + Notify intents add korum
// (free APIs)" + memory recall + todos — all resolving LOCALLY so chat
// commands never burn relay/LLM quota.
//
// Design notes:
// - Handlers live in ./handlers/* and self-register via registerIntent.
// - index.ts owns registration order (help first, search last) so
//   matchers never shadow each other.
// - matchers are ANCHORED (^...) and conservative: a normal question
//   like "help me write an essay" must fall through to the LLM.
// - The admin voice cockpit (components/admin/jarvis) keeps its own
//   persona; this registry is the shared hands layer both can use.
// ============================================================

export type IntentPermission = 'read' | 'write';

export interface IntentContext {
  /** Everything after the command token (trimmed). May be ''. */
  arg: string;
  /** The full original message, trimmed. */
  raw: string;
  now: Date;
}

export interface IntentResult {
  text: string;
  /** Shown as the bubble's via badge, e.g. 'jarvis:help'. */
  via: string;
}

export interface JarvisIntent {
  /** Registry id, e.g. 'help'. */
  name: string;
  /** Short usage string shown by /help, e.g. '/remember <fact>'. */
  usage: string;
  /** One-line description shown by /help. */
  description: string;
  /** 'write' intents mutate local state (memory/todos); 'read' ones do not. */
  permission: IntentPermission;
  /**
   * Return null to pass, true for "matched, no argument",
   * or a string for "matched, argument = ...".
   */
  match: (raw: string) => string | boolean | null;
  handle: (ctx: IntentContext) => IntentResult | Promise<IntentResult>;
}

/** Live registry — populated at app start by index.ts. */
export const jarvisRegistry: JarvisIntent[] = [];

export function registerIntent(intent: JarvisIntent): void {
  const existing = jarvisRegistry.findIndex((i) => i.name === intent.name);
  if (existing >= 0) jarvisRegistry[existing] = intent;
  else jarvisRegistry.push(intent);
}

export interface IntentMatch {
  intent: JarvisIntent;
  arg: string;
}

/** First registered match wins. Null when no intent claims the message. */
export function matchIntent(raw: string): IntentMatch | null {
  const msg = raw.trim();
  if (!msg) return null;
  for (const intent of jarvisRegistry) {
    let hit: string | boolean | null = null;
    try {
      hit = intent.match(msg);
    } catch {
      hit = null;
    }
    if (hit === null || hit === false) continue;
    return { intent, arg: typeof hit === 'string' ? hit.trim() : '' };
  }
  return null;
}

/**
 * Router used by UnifiedChatPanel: resolves a local intent or returns
 * null so the caller proceeds with the normal relay/LLM path. Handler
 * failures are swallowed into a jarvis:error result (chat must never
 * break because a local command misfired).
 */
export async function tryHandleIntent(raw: string): Promise<IntentResult | null> {
  const match = matchIntent(raw);
  if (!match) return null;
  try {
    return await match.intent.handle({ arg: match.arg, raw: raw.trim(), now: new Date() });
  } catch (e) {
    return {
      text: `Jarvis command "/${match.intent.name}" failed: ${e instanceof Error ? e.message : String(e)}. The message was not sent to the model.`,
      via: 'jarvis:error',
    };
  }
}

// ------------------------------------------------------------
// localStorage helpers (guarded — SSR/jsdom/non-browser safe)
// ------------------------------------------------------------

export function jarvisReadJson<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return fallback;
    return JSON.parse(stored) as T;
  } catch {
    return fallback;
  }
}

export function jarvisWriteJson(key: string, value: unknown): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota/private-mode: memory commands degrade gracefully */
  }
}
