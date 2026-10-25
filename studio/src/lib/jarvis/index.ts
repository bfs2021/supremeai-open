// JARVIS assembly — registration order matters (first match wins).
// help -> status -> memory (remember/recall/forget) -> todos (todo/remind)
// -> search last (its bare-/search and github: alias must not shadow).
//
// Importing this module registers every intent exactly once. UnifiedChatPanel
// imports tryHandleIntent from here; future surfaces (admin voice cockpit,
// Telegram bridge) can reuse the same registry.

import { registerIntent } from './registry';
import { helpIntent } from './handlers/help';
import { statusIntent } from './handlers/status';
import { forgetIntent, recallIntent, rememberIntent } from './handlers/memory';
import { remindIntent, todoIntent } from './handlers/todos';
import { searchIntent } from './handlers/search';

let registered = false;

/** Idempotent — safe to import from multiple entry points. */
export function ensureJarvisIntents(): void {
  if (registered) return;
  registered = true;
  registerIntent(helpIntent);
  registerIntent(statusIntent);
  registerIntent(rememberIntent);
  registerIntent(recallIntent);
  registerIntent(forgetIntent);
  registerIntent(todoIntent);
  registerIntent(remindIntent);
  registerIntent(searchIntent);
}

ensureJarvisIntents();

export { jarvisRegistry, matchIntent, tryHandleIntent } from './registry';
export { listMemory, rememberFact, recallMemory, forgetMemory, clearMemory } from './handlers/memory';
export { listTodos, addTodo, completeTodo, clearDoneTodos, checkDueTodos, parseInDuration } from './handlers/todos';
