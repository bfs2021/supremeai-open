// JARVIS intent registry — vitest suite (jsdom provides localStorage).
// Covers: router matching + fall-through, help listing, memory roundtrip,
// todos CRUD, remind parsing, search fetch-mock and the status renderer.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { matchIntent, tryHandleIntent } from '../index';
import { jarvisRegistry } from '../registry';
import { clearMemory, listMemory, rememberFact } from '../handlers/memory';
import { addTodo, completeTodo, listTodos, parseInDuration, checkDueTodos } from '../handlers/todos';

beforeEach(() => {
  localStorage.clear();
  clearMemory();
});

describe('registry', () => {
  it('registers the eight Phase-A intents', () => {
    const names = jarvisRegistry.map((i) => i.name);
    expect(names).toEqual(expect.arrayContaining(['help', 'status', 'remember', 'recall', 'forget', 'todo', 'remind', 'search']));
    expect(names).toHaveLength(8);
  });

  it('leaves normal questions unmatched (fall through to LLM)', () => {
    expect(matchIntent('help me write an essay about mars')).toBeNull();
    expect(matchIntent('Remember the Titans is a great movie')).toBeNull();
    expect(matchIntent('search engines explained')).toBeNull();
    expect(matchIntent('remindfulness is not a word but contains remind me? no')).toBeNull();
    expect(matchIntent('')).toBeNull();
  });

  it('matches help variants', () => {
    expect(matchIntent('help')?.intent.name).toBe('help');
    expect(matchIntent('/help')?.intent.name).toBe('help');
    expect(matchIntent('What can you do?')?.intent.name).toBe('help');
    expect(matchIntent('jarvis')?.intent.name).toBe('help');
  });

  it('matches remember with natural phrase and captures the fact', () => {
    const m = matchIntent('remember that the deploy window is Sunday 2am');
    expect(m?.intent.name).toBe('remember');
    expect(m?.arg).toBe('the deploy window is Sunday 2am');
  });
});

describe('help', () => {
  it('lists every registered intent usage', async () => {
    const res = await tryHandleIntent('/help');
    expect(res?.via).toBe('jarvis:help');
    for (const intent of jarvisRegistry) {
      expect(res?.text).toContain(intent.usage);
    }
  });
});

describe('memory', () => {
  it('remember -> recall -> forget roundtrip', async () => {
    await tryHandleIntent('remember that the staging key rotates monthly');
    expect(listMemory()).toHaveLength(1);
    const recall = await tryHandleIntent('/recall staging');
    expect(recall?.text).toContain('staging key rotates monthly');
    const forgot = await tryHandleIntent('/forget staging');
    expect(forgot?.text).toContain('Forgot 1 fact');
    expect(listMemory()).toHaveLength(0);
  });

  it('deduplicates exact repeats', async () => {
    rememberFact('alpha');
    rememberFact('Alpha');
    expect(listMemory()).toHaveLength(1);
  });

  it('/forget all wipes memory', async () => {
    rememberFact('one');
    rememberFact('two');
    const res = await tryHandleIntent('/forget all');
    expect(res?.text).toContain('2 facts removed');
    expect(listMemory()).toHaveLength(0);
  });

  it('bare recall lists everything', async () => {
    rememberFact('fact A');
    rememberFact('fact B');
    const res = await tryHandleIntent('what do you remember?');
    expect(res?.via).toBe('jarvis:memory');
    expect(res?.text).toContain('fact A');
    expect(res?.text).toContain('fact B');
  });
});

describe('todos', () => {
  it('add, list, done roundtrip', async () => {
    await tryHandleIntent('todo buy milk');
    await tryHandleIntent('/todo ship the release');
    expect(listTodos()).toHaveLength(2);
    const list = await tryHandleIntent('/todo list');
    expect(list?.text).toContain('buy milk');
    const done = await tryHandleIntent('/todo done 1');
    expect(done?.text).toContain('ship the release');
    expect(listTodos().filter((t) => !t.done)).toHaveLength(1);
  });

  it('completeTodo works by id and clears done', async () => {
    const item = addTodo('task x');
    expect(completeTodo(item.id)?.text).toBe('task x');
    expect(completeTodo(item.id)).toBeNull();
    expect(addTodo('y')).toBeTruthy();
    expect(completeTodo('1')?.text).toBe('y');
  });

  it('parseInDuration handles minutes/hours/days', () => {
    const now = new Date('2026-10-25T10:00:00Z');
    expect(parseInDuration('in 10 minutes', now)?.getTime()).toBe(now.getTime() + 600_000);
    expect(parseInDuration('in 2 hrs', now)?.getTime()).toBe(now.getTime() + 7_200_000);
    expect(parseInDuration('in 1 day', now)?.getTime()).toBe(now.getTime() + 86_400_000);
    expect(parseInDuration('no time here', now)).toBeNull();
  });

  it('remind parses both shapes and stores due todo', async () => {
    const r1 = await tryHandleIntent('/remind me to check the deploy in 10 minutes');
    expect(r1?.via).toBe('jarvis:todos');
    expect(listTodos()[0].dueAt).toBeTruthy();
    const r2 = await tryHandleIntent('remind me in 5 minutes to stretch');
    expect(r2?.via).toBe('jarvis:todos');
    expect(listTodos()[0].text).toBe('stretch');
  });

  it('remind without a delay asks for one', async () => {
    const before = listTodos().length;
    const res = await tryHandleIntent('/remind me to call mom');
    expect(res?.text).toContain('I need a delay');
    expect(listTodos()).toHaveLength(before);
  });

  it('checkDueTodos fires and marks due reminders', () => {
    vi.useFakeTimers();
    try {
      const past = new Date(Date.now() - 60_000);
      addTodo('overdue', past);
      const fired = checkDueTodos(new Date());
      expect(fired).toHaveLength(1);
      expect(fired[0].text).toBe('overdue');
      expect(checkDueTodos(new Date())).toHaveLength(0); // not re-fired
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('status', () => {
  it('renders local status without network', async () => {
    const res = await tryHandleIntent('/status');
    expect(res?.via).toBe('jarvis:status');
    expect(res?.text).toContain('Local memory');
    expect(res?.text).toContain('Todos');
  });
});

describe('search', () => {
  it('shows usage when empty', async () => {
    const res = await tryHandleIntent('/search');
    expect(res?.text).toContain('/search issues');
  });

  it('hits GitHub issues API and formats results', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ items: [{ number: 1198, title: 'restore toolbar', state: 'closed', html_url: 'https://github.com/x/pull/1198' }] }),
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const res = await tryHandleIntent('/search issues toolbar');
      expect(res?.via).toBe('jarvis:search');
      expect(res?.text).toContain('#1198');
      expect(res?.text).toContain('restore toolbar');
      const called = String(fetchMock.mock.calls[0][0]);
      expect(called).toContain('api.github.com/search/issues');
      expect(called).toContain('repo:Supremeai-bd/supremeai');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('code search without token degrades gracefully', async () => {
    const res = await tryHandleIntent('/search code historyDepth');
    expect(res?.text).toContain('token');
    expect(res?.via).toBe('jarvis:search');
  });

  it('rate limit message on 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 403 })));
    try {
      const res = await tryHandleIntent('github: anything');
      expect(res?.text).toContain('rate limit');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
