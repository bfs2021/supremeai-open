import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation } from 'react-router-dom';
import { useMobileNav } from '../../hooks/useMobileNav';

export interface DashboardLayoutProps {
  header?: React.ReactNode;
  sidebar?: React.ReactNode;
  children: React.ReactNode;
  isSidebarCollapsed?: boolean;
  /** P1 wave item 4 (2026-10-25 report): mobile-only bottom tab bar (md:hidden).
   *  Rendered by the shell for user context; admin keeps the drawer-only surface. */
  mobileTabBar?: React.ReactNode;
}

const SIDEBAR_SPRING = { type: 'spring', stiffness: 320, damping: 32 } as const;

export function DashboardLayout({ header, sidebar, children, isSidebarCollapsed = false, mobileTabBar }: DashboardLayoutProps) {
  // Issue #1526 (LOW): the sidebar used to render at a fixed 256px on every
  // viewport — on phones it swallowed most of the screen and the content
  // overlapped. Below md it now becomes an overlay drawer: closed by default,
  // opened from the header toggle, closed by backdrop tap, Escape, or route
  // change. Desktop (md+) keeps the exact collapse behavior it had.
  const { isMobileNavOpen, setMobileNavOpen } = useMobileNav();
  const location = useLocation();

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname, setMobileNavOpen]);

  useEffect(() => {
    if (!isMobileNavOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMobileNavOpen, setMobileNavOpen]);

  return (
    <div className="dashboard-live-shell surface-0 h-screen w-full flex flex-col overflow-hidden text-text font-sans">
      <div className="dashboard-live-orb dashboard-live-orb-one" aria-hidden="true" />
      <div className="dashboard-live-orb dashboard-live-orb-two" aria-hidden="true" />
      {header && (
        <header className="surface-1 z-shell shrink-0">
          {header}
        </header>
      )}

      {/* P1 item 4: fixed bottom chrome on phones. Rendered BEFORE the content row
          in DOM so the drawer backdrop (same z-shell, later in DOM) dims it while the
          drawer is open; the drawer itself (z-overlay) and CommandBar/modals (z-modal) stay
          above. Bottom padding on <main> keeps page footers/composers unobscured. */}
      {mobileTabBar}

      <div className="flex-1 flex overflow-hidden relative">
        {sidebar && (
          /* P2 tail of the 2026-10-25 report (Table 8 row 10, deferred by #1303):
             width->transform. The old width spring re-laid-out the whole flex
             row every frame (sidebar + main reflow x60/s). The rail width now
             flips once per toggle (w-16/w-64, single reflow) and the perceived
             motion is a compositor-only transform+opacity settle. Same 64/256
             endpoints, same spring-free feel on the mobile drawer (already x). */
          <motion.aside
            initial={false}
            animate={{ x: [isSidebarCollapsed ? -14 : 14, 0], opacity: [0.9, 1] }}
            transition={{ duration: 0.24, ease: 'easeOut' }}
            className={`surface-1 border-r border-border hidden md:flex flex-col z-20 shrink-0 overflow-hidden ${isSidebarCollapsed ? 'w-16' : 'w-64'}`}
          >
            {sidebar}
          </motion.aside>
        )}

        {/* Issue #1526: mobile overlay drawer — rendered only below md while open */}
        <AnimatePresence>
          {sidebar && isMobileNavOpen && (
            <>
              <motion.div
                key="mobile-nav-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                onClick={() => setMobileNavOpen(false)}
                className="fixed inset-0 z-shell bg-black/60 md:hidden"
                aria-hidden="true"
              />
              <motion.aside
                key="mobile-nav-drawer"
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={SIDEBAR_SPRING}
                className="surface-1 border-r border-border fixed inset-y-0 left-0 z-overlay flex flex-col w-64 max-w-[85vw] overflow-hidden md:hidden"
                aria-label="Navigation drawer"
              >
                {sidebar}
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        <main
          className={`flex-1 min-w-0 overflow-hidden relative z-10 flex flex-col ${
            mobileTabBar ? 'pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0' : ''
          }`}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
