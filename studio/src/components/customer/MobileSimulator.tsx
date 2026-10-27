import { useEffect, useState } from 'react';
import { Card, Badge } from '../ui';
import { Smartphone, Tablet, RefreshCw } from 'lucide-react';
import { getApiBaseUrl } from '../../utils/api';
import { getAuthHeaders } from '../../services/apiClient';
import { HomeShell } from '../mobile/HomeShell';

// Issue #1669 (CRITICAL): JWT কখনো iframe URL-এ যায় না। প্রতিটি external
// render-এর আগে header-auth দিয়ে POST /api/browser/render-ticket কল হয়;
// ফেরত পাওয়া এক-ব্যবহারযোগ্য 60s-TTL টিকেটই iframe src-তে যায় — URL-এ
// JWT/history/log-leak-এর কোনো পথ নেই।
const fetchRenderTicket = async (): Promise<string | null> => {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${getApiBaseUrl()}/api/browser/render-ticket`, {
      method: 'POST',
      headers,
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const t = (data as { ticket?: unknown })?.ticket;
    return typeof t === 'string' && t.length > 0 ? t : null;
  } catch {
    return null;
  }
};

interface MobileSimulatorProps {
  html?: string;
  url?: string;
}

const DEVICES = [
  { id: 'iphone', name: 'iPhone 15', width: 390, height: 844, icon: Smartphone },
  { id: 'pixel', name: 'Pixel 8', width: 412, height: 915, icon: Smartphone },
  { id: 'ipad', name: 'iPad Pro', width: 1024, height: 1366, icon: Tablet },
];

type Orientation = 'portrait' | 'landscape';

export function MobileSimulator({ html, url = '' }: MobileSimulatorProps) {
  const [selectedDevice, setSelectedDevice] = useState(DEVICES[0]);
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [ticket, setTicket] = useState<string | null>(null);
  // MOBILE DUAL-PATH (owner request 2026-10-25): the simulator is now a live
  // mirror of Browser Preview — Sync re-fetches the render ticket and re-mounts
  // the iframe so the phone shows the latest page the agent/user navigated to.
  const [reloadKey, setReloadKey] = useState(0);

  const needsProxy = /^https?:\/\//i.test(url.trim()) && !html;
  // HOME LAUNCHER (owner request 2026-10-27, iOS-home-template): URL/HTML কিছু
  // না থাকলে ফোন আর dead-end ফাঁকা স্ক্রিন দেখায় না — এখন একটি পূর্ণ
  // iOS-ঘরানার Home Launcher (icons, swipe pages, widgets, notification/
  // control center, wiggle reorder, app-launch zoom) স্ক্রিনে থাকে। Mirror ও
  // agent-build path আগের মতোই অক্ষত।
  const showLauncher = !html && !needsProxy;

  useEffect(() => {
    if (!needsProxy) {
      setTicket(null);
      return;
    }
    let cancelled = false;
    setTicket(null);
    fetchRenderTicket().then(t => {
      if (!cancelled) setTicket(t);
    });
    return () => {
      cancelled = true;
    };
  }, [needsProxy, url, reloadKey]);

  const currentWidth = orientation === 'portrait' ? selectedDevice.width : selectedDevice.height;
  const currentHeight = orientation === 'portrait' ? selectedDevice.height : selectedDevice.width;

  return (
    <div className="flex-grow p-6 overflow-y-auto bg-[#030508]">
      <div className="flex items-center justify-between mb-6 pb-2 border-b border-[#00f3ff]/15">
        <h2 className="text-lg font-bold font-['Space_Grotesk'] tracking-widest text-[#00f3ff] uppercase">
          📱 Mobile Simulator
        </h2>
        {url && (
          <div className="flex min-w-0 items-center gap-2" data-testid="mobile-simulator-url">
            <span className="max-w-[16rem] truncate font-mono text-[10px] text-slate-500" title={url}>{url}</span>
            <button
              onClick={() => setReloadKey(k => k + 1)}
              className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-800 px-2 py-1 font-mono text-[10px] text-slate-400 transition-colors hover:border-[#00f3ff]/40 hover:text-white"
              title="Re-render the mirrored page on the phone"
            >
              <RefreshCw size={12} /> Sync
            </button>
          </div>
        )}
      </div>

      <div className="flex gap-2 mb-6">
        {DEVICES.map(device => (
          <button
            key={device.id}
            onClick={() => setSelectedDevice(device)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-mono transition-all ${
              selectedDevice.id === device.id
                ? 'border-[#00f3ff]/50 bg-[#00f3ff]/10 text-[#00f3ff]'
                : 'border-slate-800 text-slate-400 hover:border-slate-700'
            }`}
          >
            <device.icon size={14} />
            {device.name}
          </button>
        ))}
        <button
          onClick={() => setOrientation(o => (o === 'portrait' ? 'landscape' : 'portrait'))}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-800 text-slate-400 hover:text-white text-xs font-mono transition-colors"
        >
          <RefreshCw size={14} /> Rotate
        </button>
      </div>

      <Card>
        <div className="flex justify-center">
          <div
            className="border-4 border-slate-700 rounded-[2.5rem] p-2 bg-slate-900 shadow-2xl transition-all duration-300"
            style={{
              width: Math.min(currentWidth / 3, 400),
              height: Math.min(currentHeight / 3, 700),
            }}
          >
            <div className="w-full h-full rounded-[2rem] overflow-hidden bg-white relative">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/3 h-6 bg-slate-900 rounded-b-xl z-10" />
              {html ? (
                <iframe key={reloadKey} srcDoc={html} title={selectedDevice.name} className="w-full h-full" sandbox="allow-scripts allow-forms" />
              ) : ticket ? (
                <iframe
                  key={reloadKey}
                  src={`${getApiBaseUrl()}/api/browser/render?url=${encodeURIComponent(url)}&ticket=${ticket}`}
                  title={selectedDevice.name}
                  className="w-full h-full"
                  sandbox="allow-scripts allow-forms"
                />
              ) : showLauncher ? (
                // বাংলা: ফাঁকা অবস্থায় এখন আসল হোম-স্ক্রিন — নিচের হোম-বার ট্যাপ/
                // উপরে-টানলে অ্যাপ বন্ধ, উপরে টানলে Notification Center।
                <div className="absolute inset-0 z-0" data-testid="mobile-home-launcher">
                  <HomeShell />
                </div>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500 font-mono">
                  Preparing secure render session…
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <Badge variant="info">{selectedDevice.name}</Badge>
          <span className="text-[10px] text-slate-400 font-mono">
            {showLauncher ? 'Home Launcher · demo OS' : `${currentWidth} x ${currentHeight} • ${orientation}`}
          </span>
        </div>
      </Card>
    </div>
  );
}
