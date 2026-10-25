// JARVIS memory — /remember, /recall, /forget (localStorage, free).
// Owner request 2026-10-25: "Memory recall via local storage".
// Facts persist per-browser; the AI is never called, so remembering
// costs nothing and works offline.

import type { IntentContext, IntentResult } from '../registry';
import { jarvisReadJson, jarvisWriteJson } from '../registry';

const MEMORY_KEY = 'supremeai_jarvis_memory';
const MAX_FACTS = 200;

export interface MemoryEntry {
  text: string;
  at: string; // ISO timestamp
}

export function listMemory(): MemoryEntry[] {
  return jarvisReadJson<MemoryEntry[]>(MEMORY_KEY, []);
}

export function rememberFact(text: string): MemoryEntry {
  const entry: MemoryEntry = { text: text.trim(), at: new Date().toISOString() };
  const all = listMemory();
  // De-duplicate exact repeats (case-insensitive) — refresh timestamp instead.
  const dupeIdx = all.findIndex((m) => m.text.toLowerCase() === entry.text.toLowerCase());
  if (dupeIdx >= 0) all.splice(dupeIdx, 1);
  all.unshift(entry);
  if (all.length > MAX_FACTS) all.length = MAX_FACTS;
  jarvisWriteJson(MEMORY_KEY, all);
  return entry;
}

export function recallMemory(query: string): MemoryEntry[] {
  const all = listMemory();
  const q = query.trim().toLowerCase();
  if (!q) return all;
  return all.filter((m) => m.text.toLowerCase().includes(q));
}

export function forgetMemory(query: string): number {
  const all = listMemory();
  const q = query.trim().toLowerCase();
  const kept = q ? all.filter((m) => !m.text.toLowerCase().includes(q)) : [];
  const removed = all.length - kept.length;
  if (removed > 0) jarvisWriteJson(MEMORY_KEY, kept);
  return removed;
}

/** Full wipe (used by /forget all and tests). */
export function clearMemory(): void {
  jarvisWriteJson(MEMORY_KEY, []);
}

function fmt(entry: MemoryEntry, idx: number): string {
  const when = new Date(entry.at).toLocaleString();
  return `  ${idx + 1}. ${entry.text}  (saved ${when})`;
}

function handleRemember(ctx: IntentContext): IntentResult {
  const fact = ctx.arg.replace(/^(?:that|this)\s+/i, '').trim();
  if (!fact) {
    return {
      text: 'Usage: /remember <fact> — e.g. "/remember that the deploy window is Sunday 2am". I will store it on this device.',
      via: 'jarvis:memory',
    };
  }
  rememberFact(fact);
  const total = listMemory().length;
  return { text: `Stored. "${fact}" — ${total} fact${total === 1 ? '' : 's'} in local memory. Use /recall to list or /forget to remove.`, via: 'jarvis:memory' };
}

function handleRecall(ctx: IntentContext): IntentResult {
  const found = recallMemory(ctx.arg);
  if (found.length === 0) {
    return ctx.arg
      ? { text: `No saved facts match "${ctx.arg}". /recall with no query lists everything.`, via: 'jarvis:memory' }
      : { text: 'Local memory is empty. Save facts with /remember <fact>.', via: 'jarvis:memory' };
  }
  const shown = found.slice(0, 15);
  const lines = found.length > shown.length
    ? [`Local memory — ${found.length} match${found.length === 1 ? '' : 'es'}, showing first 15:`]
    : [`Local memory — ${found.length} fact${found.length === 1 ? '' : 's'}:`];
  shown.forEach((entry, i) => lines.push(fmt(entry, i)));
  return { text: lines.join('\n'), via: 'jarvis:memory' };
}

function handleForget(ctx: IntentContext): IntentResult {
  if (!ctx.arg) {
    return { text: 'Usage: /forget <text> — removes every saved fact containing that text. "/forget all" wipes memory.', via: 'jarvis:memory' };
  }
  if (ctx.arg.toLowerCase() === 'all') {
    const total = listMemory().length;
    clearMemory();
    return { text: `Local memory wiped — ${total} fact${total === 1 ? '' : 's'} removed.`, via: 'jarvis:memory' };
  }
  const removed = forgetMemory(ctx.arg);
  return removed > 0
    ? { text: `Forgot ${removed} fact${removed === 1 ? '' : 's'} matching "${ctx.arg}".`, via: 'jarvis:memory' }
    : { text: `Nothing matches "${ctx.arg}" — memory unchanged.`, via: 'jarvis:memory' };
}

export const rememberIntent = {
  name: 'remember',
  usage: '/remember <fact>',
  description: 'Save a fact to local memory (free, offline)',
  permission: 'write' as const,
  match: (raw: string): string | boolean | null => {
    if (raw.trim().toLowerCase().startsWith('/remember')) return raw.trim().slice('/remember'.length).trim();
    // Natural phrases REQUIRE "remember that/this" — a bare "remember X"
    // (e.g. "Remember the Titans is a great movie") must fall through to the LLM.
    const m = raw.trim().match(/^remember\s+(?:that|this)\s+(.+)$/i);
    return m ? m[1] : null;
  },
  handle: handleRemember,
};

export const recallIntent = {
  name: 'recall',
  usage: '/recall [query]',
  description: 'List or search saved local memories',
  permission: 'read' as const,
  match: (raw: string): string | boolean | null => {
    const msg = raw.trim();
    if (msg.toLowerCase().startsWith('/recall')) return msg.slice('/recall'.length).trim();
    const lower = msg.toLowerCase().replace(/\s+/g, ' ').replace(/\?+$/, '').trim();
    if (lower === 'what do you remember' || lower === 'what did i tell you' || lower === 'what do you know about me') return '';
    const m = msg.match(/^recall(?:\s+that)?\s+(.+)$/i);
    return m ? m[1] : null;
  },
  handle: handleRecall,
};

export const forgetIntent = {
  name: 'forget',
  usage: '/forget <text> | /forget all',
  description: 'Remove matching facts from local memory',
  permission: 'write' as const,
  match: (raw: string): string | boolean | null => {
    const msg = raw.trim();
    if (msg.toLowerCase().startsWith('/forget')) return msg.slice('/forget'.length).trim();
    const m = msg.match(/^forget(?:\s+about)?\s+(.+)$/i);
    return m ? m[1] : null;
  },
  handle: handleForget,
};
