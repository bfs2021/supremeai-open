// JARVIS /help — static registry listing (free, zero dependencies).
// Auto-includes every registered intent, so future handlers (notify,
// runbooks, ...) appear here without touching this file.

import type { IntentContext, IntentResult } from '../registry';
import { jarvisRegistry } from '../registry';

function renderHelp(): IntentResult {
  const lines: string[] = [];
  lines.push('Jarvis local commands — these run on your device, instantly and free (no AI quota used):');
  lines.push('');
  for (const intent of jarvisRegistry) {
    lines.push(`  ${intent.usage} — ${intent.description}`);
  }
  lines.push('');
  lines.push('Everything else goes to the AI model as usual. Tip: /help always lists the latest commands.');
  return { text: lines.join('\n'), via: 'jarvis:help' };
}

export const helpIntent = {
  name: 'help',
  usage: '/help',
  description: 'List all Jarvis local commands',
  permission: 'read' as const,
  match: (raw: string): string | boolean | null => {
    const msg = raw.trim().toLowerCase().replace(/\s+/g, ' ');
    if (msg === '/help' || msg === 'help' || msg === 'commands' || msg === 'command' || msg === 'jarvis' || msg === 'what can you do' || msg === 'what can you do?') return true;
    return null;
  },
  handle: (_ctx: IntentContext): IntentResult => renderHelp(),
};
