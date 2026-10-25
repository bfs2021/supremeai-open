// JARVIS /status — instant local device + session status (no network).
// Reports what Jarvis can actually see: connectivity, storage pressure,
// local memory/todo counts and which relay targets are configured.

import type { IntentContext, IntentResult } from '../registry';
import { listMemory } from './memory';
import { listTodos } from './todos';

function bytesLabel(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function storagePressure(): { used: number; label: string } {
  let used = 0;
  if (typeof localStorage !== 'undefined') {
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (!k) continue;
        used += k.length + (localStorage.getItem(k)?.length ?? 0);
      }
    } catch {
      /* private mode */
    }
  }
  // 5 MB is the classic localStorage budget; report characters as bytes (UTF-16 worst case is 2x, close enough for a status line).
  return { used, label: `${bytesLabel(used * 2)} / ~5 MB` };
}

function relayTargets(): string {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env || {};
  const webhook = env.VITE_STEALTH_WEBHOOK_URL || env.VITE_WEBHOOK_URL || '';
  const api = env.VITE_SUPREMEAI_API_URL || 'https://supremeai-api-ulw0.onrender.com';
  return webhook ? `webhook + ${api}` : api;
}

export function renderStatus(_ctx?: IntentContext): IntentResult {
  const memoryCount = listMemory().length;
  const todos = listTodos();
  const openTodos = todos.filter((t) => !t.done).length;
  const storage = storagePressure();
  const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
  const now = new Date();
  const lines = [
    `Jarvis status — ${now.toLocaleString()}`,
    `  Network: ${online ? 'online' : 'OFFLINE (commands still work, AI relay needs a connection)'}`,
    `  AI relay: ${relayTargets()}`,
    `  Local memory: ${memoryCount} fact${memoryCount === 1 ? '' : 's'} stored (/recall to view)`,
    `  Todos: ${openTodos} open / ${todos.length} total (/todo list)`,
    `  Local storage: ${storage.label} used`,
    '  All Jarvis commands run locally — zero AI quota used.',
  ];
  return { text: lines.join('\n'), via: 'jarvis:status' };
}

export const statusIntent = {
  name: 'status',
  usage: '/status',
  description: 'Show local device, storage, memory and relay status',
  permission: 'read' as const,
  match: (raw: string): string | boolean | null => {
    const msg = raw.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[?.!]+$/, '');
    if (msg === '/status' || msg === 'status' || msg === 'system status' || msg === 'health check' || msg === 'jarvis status') return true;
    return null;
  },
  handle: (ctx: IntentContext): IntentResult => renderStatus(ctx),
};
