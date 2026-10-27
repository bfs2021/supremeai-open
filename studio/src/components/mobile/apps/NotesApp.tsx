/**
 * NotesApp — localStorage-synced notes (iOS-home-template)।
 * বাংলা: launcherStore persist মিডলওয়্যারের মাধ্যমে সরাসরি localStorage-এ
 * সেভ হয় (key: supremeai_home_launcher_v1) — এই অ্যাপের মূল চাহিদা এটাই।
 */

import { useState } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import { useLauncher } from '../launcherStore';

export function NotesApp() {
  const notes = useLauncher((s) => s.notes);
  const addNote = useLauncher((s) => s.addNote);
  const updateNote = useLauncher((s) => s.updateNote);
  const deleteNote = useLauncher((s) => s.deleteNote);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');

  const startNew = () => {
    setEditingId('new');
    setDraftTitle('');
    setDraftBody('');
  };
  const startEdit = (id: string, title: string, body: string) => {
    setEditingId(id);
    setDraftTitle(title);
    setDraftBody(body);
  };
  const save = () => {
    if (editingId === 'new') addNote(draftTitle.trim() || 'Untitled note', draftBody);
    else if (editingId) updateNote(editingId, draftTitle.trim() || 'Untitled note', draftBody);
    setEditingId(null);
  };

  if (editingId) {
    return (
      <div className="flex h-full flex-col pt-14 text-white">
        <div className="flex items-center justify-between px-5 pb-3">
          <button type="button" onClick={() => setEditingId(null)} className="text-sm text-amber-300 transition active:scale-95">
            ← Notes
          </button>
          <button
            type="button"
            onClick={save}
            data-testid="notes-save"
            className="flex items-center gap-1 rounded-full bg-emerald-500/90 px-3 py-1.5 text-xs font-semibold text-white transition active:scale-95"
          >
            <Check size={13} /> Save
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-3 px-5 pb-8">
          <input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            placeholder="Title"
            data-testid="notes-title-input"
            className="rounded-xl bg-white/10 px-3 py-2.5 text-base font-semibold text-white outline-none ring-1 ring-white/15 placeholder:text-white/40 focus:ring-cyan-300/50"
          />
          <textarea
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            placeholder="Start writing… (auto-saved to this browser's localStorage on Save)"
            data-testid="notes-body-input"
            rows={12}
            className="flex-1 resize-none rounded-xl bg-white/10 px-3 py-2.5 text-sm leading-6 text-white outline-none ring-1 ring-white/15 placeholder:text-white/40 focus:ring-cyan-300/50"
          />
          <p className="text-center text-[10px] text-white/40">Synced to localStorage on save — survives reload.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col pt-14 text-white">
      <header className="flex items-center justify-between px-5 pb-3">
        <h1 className="text-2xl font-bold">Notes</h1>
        <button
          type="button"
          onClick={startNew}
          aria-label="New note"
          data-testid="notes-new"
          className="flex size-9 items-center justify-center rounded-full bg-amber-400/90 text-slate-900 transition active:scale-90"
        >
          <Plus size={18} />
        </button>
      </header>
      <ul className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 pb-8">
        {notes.length === 0 && (
          <li className="mt-16 text-center text-sm text-white/50">
            No notes yet — tap <span className="font-semibold text-amber-300">+</span> to write your first one.
          </li>
        )}
        {notes.map((n) => (
          <li key={n.id}>
            <div className="group flex items-stretch overflow-hidden rounded-2xl bg-white/10 ring-1 ring-white/10 transition hover:bg-white/[0.14]">
              <button type="button" onClick={() => startEdit(n.id, n.title, n.body)} className="min-w-0 flex-1 px-4 py-3 text-left">
                <p className="truncate text-sm font-semibold">{n.title}</p>
                <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-white/55">{n.body || 'No additional text'}</p>
                <p className="mt-1 text-[10px] text-white/35">{new Date(n.updatedAt).toLocaleString()}</p>
              </button>
              <button
                type="button"
                onClick={() => deleteNote(n.id)}
                aria-label={`Delete ${n.title}`}
                className="flex w-11 items-center justify-center text-white/35 transition hover:bg-rose-500/20 hover:text-rose-300"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
