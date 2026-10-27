/**
 * HomeShell render টেস্ট — launcher-এর মূল ইন্টারঅ্যাকশন যাচাই (jsdom)।
 * বাংলা: jsdom-এ ResizeObserver/matchMedia নেই — এই টেস্ট ফাইল নিজেই স্টাব
 * দেয় (প্রজেক্ট setup.ts স্পর্শ করে না)। যাচাই করা হয়: mount, dock/dots/
 * widget, status-bar pull → Notification Center, bottom strip → Control
 * Center toggle, long-press → wiggle, icon tap → app window।
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react';
import { HomeShell } from './HomeShell';
import { useLauncher } from './launcherStore';

beforeAll(() => {
  // বাংলা: jsdom-এ নেই এমন API-গুলোর স্টাব — HomeShell (ResizeObserver,
  // clientWidth/Height) ও framer-motion (matchMedia) যেগুলোতে নির্ভর করে।
  class ROStub implements ResizeObserver {
    observe = () => {};
    unobserve = () => {};
    disconnect = () => {};
  }
  vi.stubGlobal('ResizeObserver', ROStub);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
  // jsdom-এ কোনো layout ইঞ্জিন নেই — clientWidth/Height 0 ফেরত দেয়, তাতে
  // AppWindow (size.w > 0 গার্ড) কখনো মাউন্ট হয় না। ফোন-স্ক্রিনের মাপ দিই।
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 390 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 780 });
});

afterEach(() => {
  cleanup();
  useLauncher.setState({ openApp: null, panel: 'none', wiggle: false, page: 0, musicPlaying: false });
});

describe('HomeShell (iOS home launcher)', () => {
  it('mounts with status bar, dock icons, page dots and widgets', () => {
    render(<HomeShell />);
    expect(screen.getByTestId('home-launcher')).toBeInTheDocument();
    expect(screen.getByTestId('home-statusbar')).toBeInTheDocument();
    expect(screen.getByTestId('widget-weather')).toBeInTheDocument();
    expect(screen.getByTestId('widget-clock')).toBeInTheDocument();
    // Dock: photos, music, notes, settings — লেবেল দিয়েই খোঁজা যায়
    expect(screen.getByText('Photos')).toBeInTheDocument();
    expect(screen.getByText('Music')).toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    // Page dots (২ পেজ)
    expect(screen.getByRole('button', { name: 'Page 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page 2' })).toBeInTheDocument();
  });

  it('tapping an icon opens the app window (zoom-launch mount)', () => {
    render(<HomeShell />);
    fireEvent.pointerDown(screen.getByText('Weather'));
    fireEvent.pointerUp(screen.getByText('Weather'));
    expect(useLauncher.getState().openApp).toBe('weather');
    expect(screen.getByTestId('app-window-weather')).toBeInTheDocument();
    // Home বোতামে অ্যাপ বন্ধ
    fireEvent.click(screen.getByRole('button', { name: 'Close app and return home' }));
    expect(useLauncher.getState().openApp).toBeNull();
  });

  it('pull-down on status bar opens Notification Center with Clear', () => {
    render(<HomeShell />);
    const bar = screen.getByTestId('home-statusbar');
    fireEvent.pointerDown(bar, { clientY: 10 });
    fireEvent.pointerUp(bar, { clientY: 60 }); // নিচে টানা
    expect(screen.getByTestId('notification-center')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(screen.getByText('No new notifications')).toBeInTheDocument();
  });

  it('bottom strip opens Control Center and toggles Wi-Fi', () => {
    render(<HomeShell />);
    const strip = screen.getByTestId('home-indicator-strip');
    fireEvent.pointerDown(strip, { clientY: 700 });
    fireEvent.pointerUp(strip, { clientY: 640 }); // উপরে টানা
    expect(screen.getByTestId('control-center')).toBeInTheDocument();
    const wifi = screen.getByTestId('cc-wi-fi');
    const before = wifi.getAttribute('aria-pressed');
    fireEvent.click(wifi);
    expect(wifi.getAttribute('aria-pressed')).toBe(String(before !== 'true'));
  });

  it('long-press enters wiggle mode and Done exits', () => {
    vi.useFakeTimers();
    try {
      render(<HomeShell />);
      const icon = screen.getByText('Calendar');
      fireEvent.pointerDown(icon, { clientY: 300 });
      // বাংলা: টাইমার advance-এর ভেতরে act() — React re-render sync ফ্লাশ হয়,
      // নইলে DOM পুরনো অবস্থাতেই থেকে যায় (fake timer সিডিউলিং থামিয়ে রাখে)।
      act(() => {
        vi.advanceTimersByTime(500); // LONG_PRESS_MS = 450
      });
      expect(useLauncher.getState().wiggle).toBe(true);
      expect(screen.getByTestId('wiggle-done')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('wiggle-done'));
      expect(useLauncher.getState().wiggle).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
