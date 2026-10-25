// JARVIS /search — GitHub public API search (free, rate-limited, CORS OK).
// Owner request 2026-10-25 #1 recommendation: "Search (code/docs/issues)
// — GitHub public API (free, rate-limited)".
//
// Scopes:
//   /search issues <q>   -> issues+PRs in Supremeai-bd/supremeai (unauth OK)
//   /search repos <q>    -> public repositories (unauth OK)
//   /search code <q>     -> code search (needs a token: VITE_GITHUB_TOKEN
//                           or localStorage 'supremeai_github_token')
//   /search <q>          -> defaults to issues
//   github: <q>          -> alias for issues search
//
// Unauthenticated search limit is ~10 req/min — a friendly rate-limit
// message is shown on 403/429. 8s timeout so the chat never hangs.

import type { IntentContext, IntentResult } from '../registry';

const REPO = 'Supremeai-bd/supremeai';
const TIMEOUT_MS = 8000;

interface SearchHit {
  title?: string;
  name?: string;
  path?: string;
  html_url: string;
  description?: string | null;
  state?: string;
  number?: number;
  repository?: { full_name?: string };
}

function githubToken(): string {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env || {};
  if (env.VITE_GITHUB_TOKEN) return env.VITE_GITHUB_TOKEN;
  if (typeof localStorage !== 'undefined') {
    try { return localStorage.getItem('supremeai_github_token') || ''; } catch { return ''; }
  }
  return '';
}

async function ghFetch(url: string): Promise<{ status: number; items: SearchHit[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const token = githubToken();
    const res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
    });
    if (!res.ok) return { status: res.status, items: [] };
    const data = (await res.json()) as { items?: SearchHit[] };
    return { status: res.status, items: data.items || [] };
  } finally {
    clearTimeout(timer);
  }
}

function rateLimitText(): string {
  return 'GitHub search rate limit reached (free tier: ~10 searches/min unauthenticated). Wait a minute and retry, or set a free GitHub token in VITE_GITHUB_TOKEN / localStorage "supremeai_github_token" for 30 req/min.';
}

async function searchIssues(q: string): Promise<IntentResult> {
  if (!q) return { text: 'Usage: /search issues <query> — searches Supremeai-bd/supremeai issues and PRs.', via: 'jarvis:search' };
  const url = `https://api.github.com/search/issues?q=${encodeURIComponent(q)}+repo:${REPO}&per_page=5&sort=updated`;
  const { status, items } = await ghFetch(url);
  if (status === 403 || status === 429) return { text: rateLimitText(), via: 'jarvis:search' };
  if (status === 401) return { text: 'GitHub rejected the configured token (401). Clear localStorage "supremeai_github_token" or fix VITE_GITHUB_TOKEN.', via: 'jarvis:search' };
  if (status !== 200) return { text: `GitHub search failed (HTTP ${status}).`, via: 'jarvis:search' };
  if (items.length === 0) return { text: `No issues/PRs match "${q}" in ${REPO}.`, via: 'jarvis:search' };
  const lines = [`Issues/PRs matching "${q}" (${items.length} shown):`];
  for (const it of items) {
    const kind = it.html_url.includes('/pull/') ? 'PR' : 'Issue';
    const state = it.state || 'open';
    lines.push(`  #${it.number} [${kind}/${state}] ${it.title}\n      ${it.html_url}`);
  }
  return { text: lines.join('\n'), via: 'jarvis:search' };
}

async function searchRepos(q: string): Promise<IntentResult> {
  if (!q) return { text: 'Usage: /search repos <query> — searches public GitHub repositories.', via: 'jarvis:search' };
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=5`;
  const { status, items } = await ghFetch(url);
  if (status === 403 || status === 429) return { text: rateLimitText(), via: 'jarvis:search' };
  if (status !== 200) return { text: `GitHub search failed (HTTP ${status}).`, via: 'jarvis:search' };
  if (items.length === 0) return { text: `No public repos match "${q}".`, via: 'jarvis:search' };
  const lines = [`Public repos matching "${q}":`];
  for (const it of items) {
    lines.push(`  ${it.repository?.full_name || it.html_url}${it.description ? ` — ${it.description}` : ''}\n      ${it.html_url}`);
  }
  return { text: lines.join('\n'), via: 'jarvis:search' };
}

async function searchCode(q: string): Promise<IntentResult> {
  if (!q) return { text: 'Usage: /search code <query> — code search (token required, free GitHub PAT works).', via: 'jarvis:search' };
  if (!githubToken()) {
    return {
      text: 'Code search needs a (free) GitHub token — GitHub requires auth for the code search API. Add VITE_GITHUB_TOKEN or run localStorage.setItem("supremeai_github_token", "ghp_...") once. Meanwhile /search issues and /search repos work without a token.',
      via: 'jarvis:search',
    };
  }
  const url = `https://api.github.com/search/code?q=${encodeURIComponent(q)}+repo:${REPO}&per_page=5`;
  const { status, items } = await ghFetch(url);
  if (status === 403 || status === 429) return { text: rateLimitText(), via: 'jarvis:search' };
  if (status === 401) return { text: 'GitHub rejected the configured token (401). Replace localStorage "supremeai_github_token" with a fresh PAT.', via: 'jarvis:search' };
  if (status !== 200) return { text: `GitHub code search failed (HTTP ${status}).`, via: 'jarvis:search' };
  if (items.length === 0) return { text: `No code matches "${q}" in ${REPO}.`, via: 'jarvis:search' };
  const lines = [`Code matching "${q}" (${items.length} shown):`];
  for (const it of items) {
    lines.push(`  ${it.path}\n      ${it.html_url}`);
  }
  return { text: lines.join('\n'), via: 'jarvis:search' };
}

function usage(): IntentResult {
  return {
    text: [
      'Jarvis search (GitHub public API, free):',
      '  /search issues <query>   — SupremeAI issues & PRs',
      '  /search repos <query>    — public repositories',
      '  /search code <query>     — SupremeAI code (needs free token)',
      '  /search <query>          — same as issues',
      '  github: <query>          — shortcut for issues',
    ].join('\n'),
    via: 'jarvis:search',
  };
}

export const searchIntent = {
  name: 'search',
  usage: '/search [issues|repos|code] <query>',
  description: 'Search GitHub issues, repos or code (free API)',
  permission: 'read' as const,
  match: (raw: string): string | boolean | null => {
    const msg = raw.trim();
    if (msg.toLowerCase().startsWith('/search')) return msg.slice('/search'.length).trim();
    const gh = msg.match(/^github[:\s]\s*(.+)$/i);
    if (gh) return `issues ${gh[1]}`;
    return null;
  },
  handle: async (ctx: IntentContext): Promise<IntentResult> => {
    const arg = ctx.arg.trim();
    if (!arg) return usage();
    const scope = arg.match(/^(issues?|repos?|repositories|code|docs?)\s+(.+)$/i);
    if (!scope) return searchIssues(arg);
    const kind = scope[1].toLowerCase();
    const q = scope[2].trim();
    if (kind.startsWith('repo')) return searchRepos(q);
    if (kind === 'code') return searchCode(q);
    if (kind.startsWith('doc')) {
      // Docs = code search scoped to markdown.
      return searchCode(`${q} extension:md`);
    }
    return searchIssues(q);
  },
};
