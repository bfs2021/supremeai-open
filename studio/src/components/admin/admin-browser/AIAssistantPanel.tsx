import React, { type Dispatch, type SetStateAction } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, Loader2, Send, X, FileText, Code, Globe, AlertTriangle } from 'lucide-react';

import type { AIBrowserAction } from './types';

// ════════════════════════════════════════════════════════════════════
// AI ASSISTANT PANEL (right side)
// Extracted verbatim from the CrownJewelBrowser render tree.
// ════════════════════════════════════════════════════════════════════

interface AIAssistantPanelProps {
  show: boolean;
  setShowAIPanel: Dispatch<SetStateAction<boolean>>;
  handleAIAction: (action: AIBrowserAction) => Promise<void>;
  aiResponse: string;
  isAIProcessing: boolean;
  aiInput: string;
  setAiInput: Dispatch<SetStateAction<string>>;
}

export const AIAssistantPanel: React.FC<AIAssistantPanelProps> = ({
  show,
  setShowAIPanel,
  handleAIAction,
  aiResponse,
  isAIProcessing,
  aiInput,
  setAiInput,
}) => {
  return (
    <AnimatePresence>
      {show && (
        /* P2 width->transform (2026-10-25 report Table 8 row 10, deferred by
           #1303): the wrapper owns a fixed 320px column (one reflow on mount/
           unmount) and the inner panel slides in via transform - no per-frame
           width layout of the browser viewport row. */
        <div className="w-[320px] shrink-0 overflow-hidden bg-gradient-to-b from-[#0d1117] to-[#161b22] border-l border-purple-500/30 flex flex-col">
          <motion.div
            initial={{ x: 320, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 320, opacity: 0 }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
            className="flex h-full min-h-0 flex-col"
          >
          {/* AI Header */}
          <div className="p-3 border-b border-purple-500/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bot size={16} className="text-purple-400 animate-pulse" />
                <span className="text-sm font-bold text-purple-300">AI Assistant</span>
              </div>
              <button onClick={() => setShowAIPanel(false)} className="p-1 hover:bg-slate-800 rounded">
                <X size={12} className="text-slate-400" />
              </button>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="p-3 border-b border-slate-800">
            <div className="grid grid-cols-2 gap-2">
              {[
                { action: 'summarize' as const, label: 'Summarize', icon: <FileText size={12} /> },
                { action: 'explain' as const, label: 'Explain', icon: <Code size={12} /> },
                { action: 'extract_links' as const, label: 'Links', icon: <Globe size={12} /> },
                { action: 'find_issues' as const, label: 'Issues', icon: <AlertTriangle size={12} /> },
              ].map(({ action, label, icon }) => (
                <button
                  key={action}
                  onClick={() => handleAIAction({ type: action })}
                  disabled={isAIProcessing}
                  className="flex items-center gap-2 px-2 py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-xs text-slate-300 transition-colors disabled:opacity-50"
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Chat Interface */}
          <div className="flex-1 flex flex-col p-3 overflow-hidden">
            <div className="flex-1 overflow-y-auto space-y-3 mb-3">
              {aiResponse && (
                <div className="bg-purple-900/20 rounded-lg p-3 text-xs text-slate-200 leading-relaxed">
                  {aiResponse.split('\n').map((line, i) => (
                    <p key={i} className="mb-1">{line}</p>
                  ))}
                </div>
              )}
              {!aiResponse && !isAIProcessing && (
                <div className="text-center text-slate-500 text-xs py-8">
                  <Bot size={24} className="mx-auto mb-2 opacity-50" />
                  <p>Select an action or ask me anything about this page.</p>
                </div>
              )}
              {isAIProcessing && (
                <div className="flex items-center gap-2 text-xs text-purple-400">
                  <Loader2 size={12} className="animate-spin" />
                  Analyzing page...
                </div>
              )}
            </div>

            {/* Input */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && aiInput.trim()) {
                    handleAIAction({ type: 'interact', payload: { question: aiInput } });
                    setAiInput('');
                  }
                }}
                placeholder="Ask about this page..."
                className="flex-1 bg-slate-800 rounded-lg px-3 py-2 text-xs text-white outline-none placeholder:text-slate-500"
              />
              <button
                onClick={() => {
                  if (aiInput.trim()) {
                    handleAIAction({ type: 'interact', payload: { question: aiInput } });
                    setAiInput('');
                  }
                }}
                disabled={!aiInput.trim() || isAIProcessing}
                className="p-2 bg-purple-600 hover:bg-purple-500 rounded-lg disabled:opacity-50 transition-colors"
              >
                <Send size={12} />
              </button>
            </div>
          </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
