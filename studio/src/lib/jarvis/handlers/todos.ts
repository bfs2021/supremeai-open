// JARVIS todos + reminders — /todo, /remind (localStorage + Notification).
// Owner request 2026-10-25: "Todos/reminders via local storage" (free).
// Reminders use setTimeout while the tab is open — the honest free-tier
// limitation is stated in the reply. A due-check export is provided so a
// later cycle can wire it into app boot for catch-up notifications.

import type { IntentContext, IntentResult } from '../registry';
import { jarvisReadJson, jarvisWriteJson } from '../registry';

const TODO_KEY = 'supremeai_jarvis_todos';
const MAX_TODOS = 100;

export interface TodoItem {
  id: string;
  text: string;
  createdAt: string;
  /** ISO due time for reminders; undefined for plain todos. */
  dueAt?: string;
  reminded?: boolean;
  done: boolean;
}

export function listTodos(): TodoItem[] {
  return jarvisReadJson<TodoItem[]>(TODO_KEY, []);
}

function saveTodos(items: TodoItem[]): void {
  jarvisWriteJson(TODO_KEY, items.slice(0, MAX_TODOS));
}

export function addTodo(text: string, dueAt?: Date): TodoItem {
  const item: TodoItem = {
    id: `todo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text: text.trim(),
    createdAt: new Date().toISOString(),
    ...(dueAt ? { dueAt: dueAt.toISOString() } : {}),
    done: false,
  };
  const all = listTodos();
  all.unshift(item);
  saveTodos(all);
  return item;
}

export function completeTodo(idOrIndex: string): TodoItem | null {
  const all = listTodos();
  let target: TodoItem | undefined;
  const asIndex = Number.parseInt(idOrIndex, 10);
  if (Number.isFinite(asIndex) && String(asIndex) === idOrIndex.trim()) {
    const open = all.filter((t) => !t.done);
    target = open[asIndex - 1];
  }
  if (!target) target = all.find((t) => t.id === idOrIndex || t.text.toLowerCase() === idOrIndex.toLowerCase());
  if (!target || target.done) return null;
  target.done = true;
  saveTodos(all);
  return target;
}

export function clearDoneTodos(): number {
  const all = listTodos();
  const kept = all.filter((t) => !t.done);
  const removed = all.length - kept.length;
  if (removed > 0) saveTodos(kept);
  return removed;
}

/** Fires due reminders; safe to call repeatedly (marks items reminded). */
export function checkDueTodos(now: Date = new Date()): TodoItem[] {
  const all = listTodos();
  const fired: TodoItem[] = [];
  let changed = false;
  for (const t of all) {
    if (t.done || t.reminded || !t.dueAt) continue;
    if (new Date(t.dueAt).getTime() <= now.getTime()) {
      t.reminded = true;
      fired.push(t);
      changed = true;
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try { new Notification('Jarvis reminder', { body: t.text }); } catch { /* best effort */ }
      }
    }
  }
  if (changed) saveTodos(all);
  return fired;
}

/** Parses "in 10 minutes|hours|days" returns a Date, or null. */
export function parseInDuration(text: string, now: Date = new Date()): Date | null {
  const m = text.match(/\bin\s+(\d+)\s*(minutes?|mins?|m|hours?|hrs?|h|days?|d)\b/i);
  if (!m) return null;
  const amount = Number.parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  const ms = unit.startsWith('m') ? 60_000
    : unit.startsWith('h') ? 3_600_000
      : 86_400_000;
  return new Date(now.getTime() + amount * ms);
}

function humanDelay(dueAt: Date, now: Date): string {
  const secs = Math.max(1, Math.round((dueAt.getTime() - now.getTime()) / 1000));
  if (secs < 120) return `${secs}s`;
  if (secs < 7200) return `${Math.round(secs / 60)}min`;
  if (secs < 172800) return `${Math.round(secs / 3600)}h`;
  return `${Math.round(secs / 86400)}d`;
}

function handleTodo(ctx: IntentContext): IntentResult {
  const arg = ctx.arg.trim();
  if (!arg || arg === 'list') {
    const open = listTodos().filter((t) => !t.done);
    if (open.length === 0) return { text: 'No open todos. Add one with: /todo <text> or "todo buy milk".', via: 'jarvis:todos' };
    const lines = [`Open todos (${open.length}):`];
    open.forEach((t, i) => {
      const due = t.dueAt ? ` — due in ${humanDelay(new Date(t.dueAt), ctx.now)}` : '';
      lines.push(`  ${i + 1}. ${t.text}${due}`);
    });
    lines.push('Complete with: /todo done <number>.');
    return { text: lines.join('\n'), via: 'jarvis:todos' };
  }
  const doneMatch = arg.match(/^done\s+(?:#)?(\d+)$/i);
  if (doneMatch) {
    const item = completeTodo(doneMatch[1]);
    return item
      ? { text: `Done: "${item.text}". ${listTodos().filter((t) => !t.done).length} open left.`, via: 'jarvis:todos' }
      : { text: `Couldn't find open todo #${doneMatch[1]}. Check /todo list.`, via: 'jarvis:todos' };
  }
  if (arg.toLowerCase() === 'clear') {
    const removed = clearDoneTodos();
    return { text: `Cleared ${removed} completed todo${removed === 1 ? '' : 's'}.`, via: 'jarvis:todos' };
  }
  const stripped = arg.replace(/^add\s+/i, '');
  const item = addTodo(stripped);
  return { text: `Todo added: "${item.text}". /todo list to see it.`, via: 'jarvis:todos' };
}

async function handleRemind(ctx: IntentContext): Promise<IntentResult> {
  const arg = ctx.arg.trim();
  if (!arg) {
    return { text: 'Usage: /remind me to <task> in 10 minutes|hours|days', via: 'jarvis:todos' };
  }
  // Two accepted shapes: "me to X in 10m" and "in 10m to X".
  let task = '';
  let due: Date | null = null;
  const a = arg.match(/^me\s+(?:to\s+)?(.+?)\s+in\s+(\d+)\s*(minutes?|mins?|hours?|hrs?|days?)\s*$/i);
  const b = arg.match(/^in\s+(\d+)\s*(minutes?|mins?|hours?|hrs?|days?)\s+(?:to\s+)?(.+)$/i);
  if (a) {
    task = a[1].trim();
    due = parseInDuration(`in ${a[2]} ${a[3]}`, ctx.now);
  } else if (b) {
    task = b[3].trim();
    due = parseInDuration(`in ${b[1]} ${b[2]}`, ctx.now);
  } else {
    task = arg.replace(/^me\s+(?:to\s+)?/i, '').trim();
  }
  if (!due) {
    return { text: `I need a delay for that: "/remind me to ${task} in 10 minutes". Supported units: minutes, hours, days.`, via: 'jarvis:todos' };
  }
  // Request notification permission lazily (browser only, never blocks).
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    try { void Notification.requestPermission(); } catch { /* best effort */ }
  }
  const item = addTodo(task, due);
  checkDueTodos(ctx.now); // fire anything already due
  if (typeof setTimeout === 'function') {
    const delay = Math.max(0, due.getTime() - ctx.now.getTime());
    setTimeout(() => { checkDueTodos(); }, delay + 250);
  }
  return {
    text: `Reminder set: "${item.text}" in ${humanDelay(due, ctx.now)}. I will fire a browser notification (keep this tab open — free-tier honesty).`,
    via: 'jarvis:todos',
  };
}

export const todoIntent = {
  name: 'todo',
  usage: '/todo <text> | /todo list | /todo done <n> | /todo clear',
  description: 'Local todo list (free, offline)',
  permission: 'write' as const,
  match: (raw: string): string | boolean | null => {
    const msg = raw.trim();
    if (msg.toLowerCase().startsWith('/todo')) return msg.slice('/todo'.length).trim();
    const m = msg.match(/^todos?\s+(?:add\s+)?(.+)$/i);
    if (m) return m[1];
    const m2 = msg.match(/^add\s+todos?\s+(.+)$/i);
    return m2 ? m2[1] : null;
  },
  handle: handleTodo,
};

export const remindIntent = {
  name: 'remind',
  usage: '/remind me to <task> in <n> minutes|hours|days',
  description: 'Set a local reminder (browser notification)',
  permission: 'write' as const,
  match: (raw: string): string | boolean | null => {
    const msg = raw.trim();
    if (msg.toLowerCase().startsWith('/remind')) return msg.slice('/remind'.length).trim();
    const m = msg.match(/^remind\s+me\s+(.+)$/i);
    return m ? m[1] : null;
  },
  handle: handleRemind,
};
