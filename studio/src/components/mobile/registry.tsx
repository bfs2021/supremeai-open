/**
 * App registry — launcher-এর অ্যাপ তালিকা (iOS-home-template)।
 * বাংলা: AppId → নাম, lucide icon, gradient, পূর্ণ-স্ক্রিন কম্পোনেন্ট।
 * নতুন অ্যাপ যোগ করতে হলে শুধু এখানে এন্ট্রি + launcherStore-এর AppId union
 * আপডেট করলেই হবে।
 */

import { CalendarDays, CloudSun, Image, Music2, Settings, StickyNote } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AppId } from './launcherStore';
import { WeatherApp } from './apps/WeatherApp';
import { MusicApp } from './apps/MusicApp';
import { PhotosApp } from './apps/PhotosApp';
import { NotesApp } from './apps/NotesApp';
import { CalendarApp } from './apps/CalendarApp';
import { SettingsApp } from './apps/SettingsApp';

export interface AppDef {
  id: AppId;
  name: string;
  icon: LucideIcon;
  gradient: string;
  screen: React.ComponentType;
}

export const APP_REGISTRY: Record<AppId, AppDef> = {
  weather: { id: 'weather', name: 'Weather', icon: CloudSun, gradient: 'from-sky-400/90 to-cyan-600/90', screen: WeatherApp },
  music: { id: 'music', name: 'Music', icon: Music2, gradient: 'from-rose-400/90 to-fuchsia-600/90', screen: MusicApp },
  photos: { id: 'photos', name: 'Photos', icon: Image, gradient: 'from-amber-300/90 to-orange-500/90', screen: PhotosApp },
  notes: { id: 'notes', name: 'Notes', icon: StickyNote, gradient: 'from-yellow-200/90 to-amber-400/90', screen: NotesApp },
  calendar: { id: 'calendar', name: 'Calendar', icon: CalendarDays, gradient: 'from-slate-100/90 to-slate-400/90', screen: CalendarApp },
  settings: { id: 'settings', name: 'Settings', icon: Settings, gradient: 'from-slate-400/90 to-slate-600/90', screen: SettingsApp },
};
