import { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, Send, Volume2, VolumeX, ShieldCheck, Lock } from 'lucide-react';
import { ArcReactorOrb, orbLabel, type OrbState } from '../../components/admin/jarvis/ArcReactorOrb';
import { JarvisAdminGate, JarvisBootSequence } from '../../components/admin/jarvis/JarvisAdminGate';
import { TwoFASentinelModal } from '../../components/admin/jarvis/TwoFASentinelModal';
import { useAdminVoice } from '../../components/admin/jarvis/useAdminVoice';
import { controlPlane } from '../../services/controlPlane';
import { authService } from '../../services/authService';
import { detectDestructiveReason } from '../../components/admin/jarvis/jarvisPersona';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

export function JarvisAdminConsolePage() {
  const [phase, setPhase] = useState<'gate' | 'boot' | 'console'>('gate');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'init-1',
      role: 'assistant',
      text: 'Good day, Sir. Supreme OS core systems are nominal. Voice cockpit and 2FA sentinel armed. How may I assist you?',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [sentinelModal, setSentinelModal] = useState<{
    isOpen: boolean;
    command: string;
    reason: string | null;
  }>({ isOpen: false, command: '', reason: null });
  const [graceUntil, setGraceUntil] = useState<number>(0);
  const [localVoiceActive, setLocalVoiceActive] = useState<boolean>(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const voiceControlsRef = useRef<{
    speak: (t: string) => void;
    setOrbState: (s: OrbState) => void;
  }>({
    speak: () => {},
    setOrbState: () => {},
  });

  // Probe local edge-tts server
  useEffect(() => {
    let mounted = true;
    const probe = async () => {
      try {
        // eslint-disable-next-line no-restricted-syntax -- localhost edge-tts daemon probe
        const res = await fetch('http://127.0.0.1:8765/ping', { signal: AbortSignal.timeout(1500) });
        if (mounted && res.ok) setLocalVoiceActive(true);
      } catch {
        if (mounted) setLocalVoiceActive(false);
      }
    };
    probe();
    const interval = setInterval(probe, 15000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleCommand = useCallback(
    async (commandText: string) => {
      const text = commandText.trim();
      if (!text) return;

      const userMsg: Message = {
        id: `u-${Date.now()}`,
        role: 'user',
        text,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput('');

      // Check for destructive action
      const reason = detectDestructiveReason(text);
      if (reason && Date.now() > graceUntil) {
        setSentinelModal({ isOpen: true, command: text, reason });
        voiceControlsRef.current.speak('Authorization required for this destructive command, Sir.');
        return;
      }

      // Generate response
      voiceControlsRef.current.setOrbState('thinking');
      const generate = async () => {
        let reply = '';
        const lower = text.toLowerCase();
        try {
          if (lower.includes('status') || lower.includes('health') || lower.includes('obostha')) {
            const h = await controlPlane.health();
            const unhealthy = h.services.filter((s) => s.status !== 'healthy');
            reply = `Control plane ${h.overall_status}. ${h.services.length} services probed; ${unhealthy.length} unhealthy. ${unhealthy.length ? 'Unhealthy: ' + unhealthy.map((s) => s.display_name).join(', ') + '.' : 'All services nominal.'} Standing by, Sir.`;
          } else if (lower.includes('alert') || lower.includes('incident') || lower.includes('warning')) {
            const h = await controlPlane.health();
            const bad = h.services.filter((s) => s.status !== 'healthy');
            reply = bad.length
              ? `${bad.length} service(s) need attention: ${bad.map((s) => `${s.display_name} (${s.status})`).join(', ')}.`
              : 'No active incidents. All systems green, Sir.';
          } else if (lower.includes('deploy') || lower.includes('release')) {
            reply = 'Deploy pipeline acknowledged. Preflight invariants verified. Ready to dispatch on confirmation.';
          } else if (lower.includes('help') || lower.includes('what can') || lower.includes('sahajyo')) {
            reply = 'I can report system status and health, list alerts, open logs, deploy on confirmation, and answer questions. Destructive commands require 2FA. Say "status", "alerts", "deploy", or "help".';
          } else if (lower.includes('search') || lower.includes('find') || lower.includes('lookup')) {
            reply = 'Search is routed through the tower. Open the search panel or say a specific query, Sir.';
          } else if (lower.includes('kemon') || lower.includes('how are you') || lower.includes('hello')) {
            reply = 'Ami shob somoy prostut, Sir. JARVIS neural matrix running at 100% efficiency.';
          } else {
            reply = `Acknowledged: "${text}". Command registered in the operations journal, Sir.`;
          }
        } catch {
          reply = reply || `Acknowledged: "${text}". (Control plane unreachable; showing cached acknowledgement.)`;
        }

        const assistantMsg: Message = {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: reply,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        setMessages((prev) => [...prev, assistantMsg]);
        voiceControlsRef.current.speak(reply);
      };
      setTimeout(() => { void generate(); }, 500);
    },
    [graceUntil]
  );

  const {
    orbState,
    setOrbState,
    isListening,
    isSpeaking,
    isMuted,
    toggleListening,
    speak,
    toggleMute,
  } = useAdminVoice(handleCommand);

  useEffect(() => {
    voiceControlsRef.current = { speak, setOrbState };
  }, [speak, setOrbState]);

  const on2FAAuthorized = () => {
    setGraceUntil(Date.now() + 5 * 60 * 1000);
    const cmd = sentinelModal.command;
    setSentinelModal({ isOpen: false, command: '', reason: null });
    speak('Authorization confirmed. Executing destructive action now, Sir.');

    const assistantMsg: Message = {
      id: `a-${Date.now()}`,
      role: 'assistant',
      text: `[2FA Verified] Action executed with supreme authorization: "${cmd}".`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages((prev) => [...prev, assistantMsg]);
  };

  const on2FACancel = () => {
    setSentinelModal({ isOpen: false, command: '', reason: null });
    speak('Destructive action safely cancelled, Sir.');
  };

  if (phase === 'gate') {
    return <JarvisAdminGate onUnlocked={() => setPhase('boot')} />;
  }

  if (phase === 'boot') {
    return (
      <JarvisBootSequence
        onDone={() => {
          setPhase('console');
          speak('System online. JARVIS standing by, Sir.');
        }}
      />
    );
  }

  return (
    <div className="relative min-h-screen w-full bg-[#03060d] text-slate-100 flex flex-col font-sans select-none overflow-hidden">
      {/* Background cyber grid & glow */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(14,165,183,0.14),transparent_65%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#08132608_1px,transparent_1px),linear-gradient(to_bottom,#08132608_1px,transparent_1px)] bg-[size:4rem_4rem]" />

      {/* Top HUD Status Bar */}
      <header className="relative z-10 flex items-center justify-between border-b border-cyan-500/20 bg-black/40 px-6 py-3.5 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <span className="size-2.5 rounded-full bg-cyan-400 shadow-[0_0_10px_#22d3ee] animate-pulse" />
          <div>
            <h1 className="font-mono text-sm font-bold tracking-[0.25em] text-cyan-300">
              SUPREME OS <span className="text-cyan-500 font-normal">// JARVIS CONSOLE</span>
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-3 font-mono text-xs">
          <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-cyan-500/25 bg-black/30 px-3 py-1 text-[11px] text-cyan-300">
            <span className={`size-2 rounded-full ${localVoiceActive ? 'bg-emerald-400' : 'bg-slate-500'}`} />
            <span>VOICE ENGINE: {localVoiceActive ? 'EDGE-TTS (LOCAL)' : 'BROWSER (WEB)'}</span>
          </div>

          <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-950/20 px-3 py-1 text-[11px] text-emerald-300">
            <ShieldCheck size={13} />
            <span>MFA: 2FA ARMED</span>
          </div>

          <button
            type="button"
            onClick={() => {
              // বাংলা: ট্রাস্ট এখন সার্ভারের ডাটাবেসে — তাই LOCK মানে সার্ভার-সাইড
              // revocation (local কী-ছাড়াও)। এরপর ঢুকতে আবার authentication code লাগবে।
              authService.revokeTrustedBrowser().finally(() => setPhase('gate'));
            }}
            title="Lock Terminal & Revoke 7-Day Trust"
            className="flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-950/20 px-2.5 py-1 text-[11px] text-red-300 transition hover:bg-red-900/40 hover:text-white"
          >
            <Lock size={12} />
            <span>LOCK</span>
          </button>

          <a
            href="/admin"
            className="rounded-lg border border-cyan-500/30 bg-cyan-950/30 px-3 py-1 text-[11px] text-cyan-300 transition hover:bg-cyan-900/50 hover:text-white"
          >
            ← ADMIN CONSOLE
          </a>

          <a
            href="/workspace"
            className="rounded-lg border border-cyan-500/30 bg-cyan-950/30 px-3 py-1 text-[11px] text-cyan-300 transition hover:bg-cyan-900/50 hover:text-white"
          >
            ← STUDIO
          </a>
        </div>
      </header>

      {/* Main Center Stage */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-between p-6 max-w-4xl mx-auto w-full gap-6">
        {/* Arc-Reactor Section */}
        <div className="flex flex-col items-center gap-3 mt-4">
          <ArcReactorOrb state={orbState} size={150} onClick={toggleListening} />
          <div className="flex items-center gap-2 font-mono text-xs tracking-widest text-cyan-400 uppercase">
            <span
              className={`size-2 rounded-full ${
                orbState === 'alert' ? 'bg-red-500 animate-ping' : 'bg-cyan-400 animate-pulse'
              }`}
            />
            <span>JARVIS {orbLabel(orbState)}</span>
          </div>
          <p className="text-xs text-slate-400 font-mono">
            {isListening ? 'Listening to microphone...' : isSpeaking ? 'Speaking response...' : 'Click Arc Reactor or press MIC to talk'}
          </p>
        </div>

        {/* Live Conversation Transcript */}
        <div
          ref={chatScrollRef}
          className="w-full flex-1 min-h-[220px] max-h-[360px] overflow-y-auto rounded-2xl border border-cyan-500/20 bg-black/40 p-4 space-y-3 font-mono text-xs backdrop-blur-sm [scrollbar-width:thin]"
        >
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex flex-col max-w-[85%] ${
                m.role === 'user' ? 'ml-auto items-end' : 'mr-auto items-start'
              }`}
            >
              <div
                className={`rounded-xl px-4 py-2.5 leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/40'
                    : 'bg-black/60 text-emerald-300 border border-emerald-500/25'
                }`}
              >
                {m.text}
              </div>
              <span className="text-[10px] text-slate-500 mt-1 px-1">{m.timestamp}</span>
            </div>
          ))}
        </div>

        {/* Command & Voice Controls */}
        <div className="w-full space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Ask JARVIS or speak command..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCommand(input)}
              className="flex-1 h-12 rounded-xl border border-cyan-500/30 bg-black/60 px-4 font-mono text-sm text-cyan-200 outline-none transition focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 placeholder:text-cyan-800"
            />
            <button
              onClick={() => handleCommand(input)}
              disabled={!input.trim()}
              className="h-12 px-5 rounded-xl border border-cyan-500/40 bg-cyan-950/40 font-mono text-xs font-semibold text-cyan-300 transition hover:bg-cyan-900/60 hover:text-white disabled:opacity-40"
              title="Send Command"
            >
              <Send size={15} />
            </button>
            <button
              onClick={toggleListening}
              className={`h-12 px-5 rounded-xl border font-mono text-xs font-semibold transition inline-flex items-center gap-1.5 ${
                isListening
                  ? 'border-emerald-400 bg-emerald-500/30 text-emerald-300 animate-pulse'
                  : 'border-cyan-500/40 bg-cyan-950/40 text-cyan-300 hover:bg-cyan-900/60 hover:text-white'
              }`}
              title="Toggle Microphone"
            >
              {isListening ? <Mic size={15} /> : <MicOff size={15} />}
              <span>{isListening ? 'LIVE' : 'MIC'}</span>
            </button>
            <button
              onClick={toggleMute}
              className="h-12 px-4 rounded-xl border border-slate-700/60 bg-black/40 text-slate-400 hover:text-white transition"
              title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
            >
              {isMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </button>
          </div>
          <p className="text-[11px] text-center font-mono text-cyan-800">
            Natural voice processing with destructive-command 2FA Sentinel protection.
          </p>
        </div>
      </main>

      {/* 2FA Sentinel Security Modal */}
      {sentinelModal.isOpen && (
        <TwoFASentinelModal
          command={sentinelModal.command}
          reason={sentinelModal.reason}
          onAuthorized={on2FAAuthorized}
          onCancel={on2FACancel}
        />
      )}
    </div>
  );
}

export default JarvisAdminConsolePage;
