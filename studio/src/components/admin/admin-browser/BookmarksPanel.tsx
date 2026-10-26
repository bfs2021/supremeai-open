import React, { type Dispatch, type SetStateAction } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Globe } from 'lucide-react';

import type { Bookmark } from './types';

// ════════════════════════════════════════════════════════════════════
// BOOKMARKS PANEL (Dropdown, left side)
// Extracted verbatim from the CrownJewelBrowser render tree.
// ════════════════════════════════════════════════════════════════════

interface BookmarksPanelProps {
  show: boolean;
  bookmarks: Bookmark[];
  navigateTo: (url: string) => void;
  setShowBookmarks: Dispatch<SetStateAction<boolean>>;
}

export const BookmarksPanel: React.FC<BookmarksPanelProps> = ({
  show,
  bookmarks,
  navigateTo,
  setShowBookmarks,
}) => {
  return (
    <AnimatePresence>
      {show && (
        /* P2 width->transform (2026-10-25 report Table 8 row 10, deferred by
           #1303): fixed 220px clip wrapper + transform slide from the left
           edge; scroll moves to the inner layer so the slide is compositor-
           only instead of animating the flex row's width. */
        <div className="w-[220px] shrink-0 overflow-hidden bg-[#0d1117] border-r border-cyan-500/20">
          <motion.div
            initial={{ x: -220, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -220, opacity: 0 }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
            className="h-full overflow-y-auto"
          >
          <div className="p-3">
            <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wider mb-3">Bookmarks</h4>

            {['service', 'tool', 'doc'].map(category => (
              <div key={category} className="mb-4">
                <h5 className="text-[10px] text-slate-500 uppercase mb-2">{category}s</h5>
                <div className="space-y-1">
                  {bookmarks
                    .filter(b => b.category === category)
                    .map(bookmark => (
                      <button
                        key={bookmark.id}
                        onClick={() => { navigateTo(bookmark.url); setShowBookmarks(false); }}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-800 text-left transition-colors"
                      >
                        {bookmark.icon || <Globe size={12} />}
                        <span className="text-xs text-slate-300 truncate">{bookmark.title}</span>
                      </button>
                    ))
                  }
                </div>
              </div>
            ))}
          </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
