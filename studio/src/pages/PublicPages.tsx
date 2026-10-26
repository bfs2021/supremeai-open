import React from 'react';
import { Link } from 'react-router-dom';
import { FileText, History, Menu, Search, Sparkles, WandSparkles, Wrench, X, Zap } from 'lucide-react';
import { UnifiedChatBubble } from '../components/chat/UnifiedChatBubble';
import { brandFrom, brandTooltip, TIER_CLASS, type Brand } from '../lib/brandLabel';

// ROOT-CAUSE RESTYLE (Refs #878 / bridge-20261023-frontend-guestchat-cosmic):
// বাংলা মন্তব্য: গেস্ট চ্যাট আগে legacy slate/cyan প্যালেট ব্যবহার করত ও নিজের
// ফর্কড বাবল রেন্ডার করত — অন্য ট��যাবগুলোর Cosmic ডিজাইনের সাথে মিলত না।
// এখন Cosmic aurora green/purple প্যালেট + শেয়ারড UnifiedChatBubble
// (Refs #861) ব্যবহার করা হচ্ছে; চ্যাট লজিক / webhook-only ম্যান্ডেট অপরিবর্তিত।

export const publicLinks = [
  // ROOT-CAUSE FIX (guest nav misdirection, 2026-10-23): 'Chat' pointed at '/'
  // (the landing page) and Models/Features/Pricing/Docs pointed at duplicate
  // GuestChat alias pages — every nav item dumped guests into the same chat.
  // Chat now targets /chat; the duplicate alias links are removed from the nav
  // (their routes remain for direct URLs / backward compatibility).
  { to: '/chat', label: 'Chat' },
  { to: '/about', label: 'About' },
];

export const capabilityItems = [
  { title: 'History', text: 'Save and revisit conversations', icon: History, href: '/login' },
  { title: 'Files', text: 'Bring your own context', icon: FileText, href: '/login' },
  { title: 'Tools', text: 'Connect actions and workflows', icon: Wrench, href: '/login' },
  { title: 'Runs', text: 'Turn ideas into repeatable work', icon: Zap, href: '/login' },
  { title: 'Workspace', text: 'Keep projects and context together', icon: Sparkles, href: '/login' },
];

export function CapabilityStrip({ onProtected }: { onProtected: (feature: string) => void }) {
  // Issue #1460: protected capability chips used to navigate straight to
  // /login (or /register), destroying the guest's in-progress chat. They now
  // raise an in-page auth prompt instead — no navigation, state intact.
  return <nav className="relative z-10 mx-auto flex w-full max-w-7xl gap-2 overflow-x-auto px-4 pt-16 sm:pt-20 sm:px-8" aria-label="SupremeAI capabilities">
    <Link to="/chat" className="shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-300">Chat</Link>
    {capabilityItems.map(({ title, icon: Icon }) => <button key={title} type="button" onClick={() => onProtected(title)} className="flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-slate-500 transition hover:border-purple-500/40 hover:text-slate-200"><Icon size={13} aria-hidden="true" />{title}</button>)}
  </nav>;
}

export function AuthPromptModal({ feature, onClose }: { feature: string; onClose: () => void }) {
  // Issue #1460: "Sign in to access [Feature]" without navigating away.
  return <div className="fixed inset-0 z-modal flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`Sign in to access ${feature}`} onClick={onClose}>
    <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-[var(--surface-glass,rgba(15,23,42,0.9))] p-7 shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-medium text-slate-100">Sign in to access {feature.toLowerCase()}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-slate-200"><X size={16} /></button>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-500">Your conversation stays right here — create an account or sign in when you are ready, and this page will keep your state.</p>
      <div className="mt-6 flex flex-col gap-2">
        <Link to="/login" className="rounded-full bg-gradient-to-r from-emerald-500 to-purple-600 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-md shadow-emerald-500/20 transition hover:opacity-95">Sign in</Link>
        <Link to="/register" className="rounded-full border border-white/15 px-4 py-2.5 text-center text-sm font-medium text-slate-200 transition hover:border-purple-400/40">Create account</Link>
      </div>
    </div>
  </div>;
}

import { UnifiedChatPanel } from '../components/chat/UnifiedChatPanel';

export function PublicHeader() {
  const [menuOpen, setMenuOpen] = React.useState(false);
  return <header className="absolute inset-x-0 top-0 z-20 border-b border-white/[0.06] px-4 py-4 sm:px-8 sm:py-5">
    <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
      <Link to="/" aria-label="SupremeAI home" className="flex shrink-0 items-center gap-3 text-sm font-semibold tracking-[0.18em] text-slate-100"><span className="flex size-8 items-center justify-center rounded-xl bg-gradient-to-tr from-emerald-400 via-indigo-500 to-purple-600 font-mono text-sm font-bold text-white shadow-lg shadow-purple-500/20">S</span><span className="hidden sm:inline">SUPREMEAI</span></Link>
      <nav className="hidden items-center gap-4 md:flex lg:gap-6" aria-label="Public navigation">{publicLinks.map((link) => <Link key={link.to} to={link.to} className="text-sm text-slate-500 transition hover:text-slate-100">{link.label}</Link>)}</nav>
      <div className="flex items-center gap-2 sm:gap-3"><span className="hidden items-center gap-2 text-xs text-slate-600 lg:flex"><span className="size-1.5 rounded-full bg-emerald-400" />Guest mode</span><Link to="/login" className="hidden text-sm text-slate-400 transition hover:text-slate-100 sm:block">Sign in</Link><Link to="/register" className="rounded-full bg-gradient-to-r from-emerald-500 to-purple-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-emerald-500/20 transition hover:opacity-95">Get started</Link><button type="button" onClick={() => setMenuOpen((open) => !open)} className="rounded-lg p-2 text-slate-400 md:hidden" aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen}>{menuOpen ? <X size={18} /> : <Menu size={18} />}</button></div>
    </div>
    {menuOpen && <nav className="mx-auto mt-3 flex max-w-7xl flex-col gap-1 rounded-2xl border border-white/10 bg-slate-900/95 p-3 md:hidden" aria-label="Mobile navigation">{publicLinks.map((link) => <Link key={link.to} to={link.to} onClick={() => setMenuOpen(false)} className="rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-white/5">{link.label}</Link>)}<Link to="/login" className="rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-white/5">Sign in</Link></nav>}
  </header>;
}

export function PublicLayout({ children }: { children: React.ReactNode }) { return <div className="min-h-screen bg-slate-950 text-[var(--sa-ink,#f8fafc)]">{children}</div>; }

// UNIFIED CHAT (Phase 1, 2026-10-24): engine + panel UI moved to
// components/chat/UnifiedChatPanel; re-exported here for compatibility.
export { callLiveAI, responseFor, ThinkingIndicator } from '../components/chat/UnifiedChatPanel';

// UNIFIED CHAT (Phase 1): the shared panel lives in
// components/chat/UnifiedChatPanel; GuestChat is now a thin wrapper.
// RC-3 docked bar (report §6.4/Table 8 P1): guest dock = Jarvis mini-orb
// (moved from the model row into the dock) + honest in-app Apps menu — every
// entry is a real route, nothing fabricated.
const GUEST_DOCK_APPS = [
  { id: 'tools', label: 'Dev Tools', to: '/tools', description: 'Free browser-native developer tools — no sign-up.' },
  { id: 'academies', label: 'Academies', to: '/academies', description: 'Interactive lessons with saved progress.' },
  { id: 'knowledge', label: 'Knowledge', to: '/knowledge', description: 'Browse the public knowledge base.' },
  { id: 'models', label: 'Models', to: '/models', description: 'Meet the relay models and pick a tone.' },
  { id: 'jarvis', label: 'Jarvis HUD', to: '/jarvis', description: 'Full-screen voice cockpit experience.' },
];

export function GuestChat() {
  // P2 satisfaction measurement (2026-10-25 report §7/Table 8): guest chat
  // opts in to the one-question CSAT pulse; self-throttled, dismiss-safe.
  return <UnifiedChatPanel showDock dockApps={GUEST_DOCK_APPS} showSatisfactionPulse />;
}


export const GuestChatPage = GuestChat;
export const AboutPage = GuestChat;

// ROOT-CAUSE FIX (public info aliases, 2026-10-24): /models, /pricing,
// /docs, /features and /contact previously aliased GuestChat, so every
// marketing link dumped visitors into the same chat. These are now real,
// honest content pages (no fabricated prices, specs or dates); the guest
// chat stays one click away via the links below.

const infoCard = 'rounded-2xl border border-white/10 bg-slate-900/40 p-6 backdrop-blur-md';
const infoCta = 'inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/20 hover:opacity-95 transition-opacity';

export const ModelsPage: React.FC = () => (
  <div className="space-y-8 text-slate-300">
    <header className="space-y-2">
      <h1 className="text-3xl font-bold text-white">Models</h1>
      <p className="text-sm leading-relaxed">Pick a tone, the federation handles the rest. Every reply is relayed through the SupremeAI mesh with automatic provider substitution if an engine goes dark.</p>
    </header>
    <div className="grid gap-4 sm:grid-cols-3">
      <div className={infoCard}>
        <h2 className="text-lg font-bold text-white">Fast Chat</h2>
        <p className="mt-2 text-sm leading-relaxed">Snappy everyday answers for quick questions, drafting and brainstorming.</p>
      </div>
      <div className={infoCard}>
        <h2 className="text-lg font-bold text-white">Supreme Auto</h2>
        <p className="mt-2 text-sm leading-relaxed">The balanced default. Chooses the right depth automatically.</p>
      </div>
      <div className={infoCard}>
        <h2 className="text-lg font-bold text-white">Reasoning Pro</h2>
        <p className="mt-2 text-sm leading-relaxed">Step-by-step analysis for planning, code review and anything that needs thinking, not typing.</p>
      </div>
    </div>
    <Link to="/chat" className={infoCta}>Try them in the guest chat</Link>
  </div>
);

export const PricingPage: React.FC = () => (
  <div className="space-y-8 text-slate-300">
    <header className="space-y-2">
      <h1 className="text-3xl font-bold text-white">Pricing</h1>
      <p className="text-sm leading-relaxed">Honest answer: everything is free while SupremeAI is in early access.</p>
    </header>
    <div className="grid gap-4 sm:grid-cols-2">
      <div className={infoCard}>
        <h2 className="text-lg font-bold text-white">Guest - Free</h2>
        <p className="mt-2 text-sm leading-relaxed">Full guest chat at /chat. No account, no card, no limits during early access.</p>
        <Link to="/chat" className={`${infoCta} mt-4`}>Start chatting</Link>
      </div>
      <div className={infoCard}>
        <h2 className="text-lg font-bold text-white">Account - Free (early access)</h2>
        <p className="mt-2 text-sm leading-relaxed">History, personalization and the workspace - free while we scale the mesh. Paid tiers have not been announced yet; this page changes the day they are.</p>
        <Link to="/register" className={`${infoCta} mt-4`}>Create free account</Link>
      </div>
    </div>
  </div>
);

export const FeaturesPage: React.FC = () => (
  <div className="space-y-8 text-slate-300">
    <header className="space-y-2">
      <h1 className="text-3xl font-bold text-white">Features</h1>
      <p className="text-sm leading-relaxed">Three pillars of the federated architecture.</p>
    </header>
    <div className="space-y-4">
      <div className={infoCard}>
        <h2 className="text-lg font-bold text-white">Understands your entire federation</h2>
        <p className="mt-2 text-sm leading-relaxed">Single-door public ingress with automated slice dispatch across satellite repositories.</p>
      </div>
      <div className={infoCard}>
        <h2 className="text-lg font-bold text-white">Multi-model consensus and auto-healing</h2>
        <p className="mt-2 text-sm leading-relaxed">Dynamic routing across LLM providers with automatic substitution and fail-closed security.</p>
      </div>
      <div className={infoCard}>
        <h2 className="text-lg font-bold text-white">Zero admin overhead</h2>
        <p className="mt-2 text-sm leading-relaxed">Autonomous CI gates, pre-push verification and automated landing pipelines run 24/7.</p>
      </div>
    </div>
    <Link to="/chat" className={infoCta}>See it live</Link>
  </div>
);

export const DocsPage: React.FC = () => (
  <div className="space-y-8 text-slate-300">
    <header className="space-y-2">
      <h1 className="text-3xl font-bold text-white">Docs</h1>
      <p className="text-sm leading-relaxed">Three steps, no setup.</p>
    </header>
    <ol className="space-y-4 text-sm leading-relaxed">
      <li className={infoCard}><strong className="text-white">1. Chat as a guest.</strong> Open /chat and ask anything - no account needed.</li>
      <li className={infoCard}><strong className="text-white">2. Create a free account.</strong> Register to keep history, personalize replies and unlock the workspace.</li>
      <li className={infoCard}><strong className="text-white">3. Open the workspace.</strong> Your conversations, tools and settings live together at /workspace.</li>
    </ol>
    <div className="flex flex-wrap gap-3">
      <Link to="/chat" className={infoCta}>Open guest chat</Link>
      <a href="https://github.com/Supremeai-bd/supremeai-open/issues" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/80 px-5 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-800 transition-colors">Report an issue on GitHub</a>
    </div>
  </div>
);

export function PublicInfoPage(_props: { kind?: string }) {
  return (
    <div className="space-y-8 text-slate-300">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-white">Contact</h1>
        <p className="text-sm leading-relaxed">Fastest way to reach us: guest chat for quick questions, GitHub issues for anything the team must see.</p>
      </header>
      <div className="flex flex-wrap gap-3">
        <Link to="/chat" className={infoCta}>Chat with SupremeAI</Link>
        <a href="https://github.com/Supremeai-bd/supremeai-open/issues" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/80 px-5 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-800 transition-colors">Open a GitHub issue</a>
      </div>
    </div>
  );
}

export default GuestChat;
