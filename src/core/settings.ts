/**
 * User preferences (volume, UI scale, autosave…) persisted in localStorage,
 * separate from saves. After changing ctx.userSettings call saveUserSettings()
 * and emit 'settings:changed'.
 */
import { STORAGE_PREFIX } from './constants';
import type { UserSettings } from './types';

export const DEFAULT_USER_SETTINGS: UserSettings = {
  masterVolume: 0.8,
  musicVolume: 0.5,
  sfxVolume: 0.8,
  ambientVolume: 0.5,
  muted: false,
  uiScale: 1,
  edgeScroll: false,
  scrollSpeed: 1,
  autosaveMonths: 3,
  showGrid: false,
  dayNightCycle: true,
  tiltShift: false,
  showFps: false,
  reducedMotion: false,
  advisorEnabled: true,
  language: 'pl',
};

const KEY = `${STORAGE_PREFIX}settings`;

export function loadUserSettings(): UserSettings {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (raw) return { ...DEFAULT_USER_SETTINGS, ...(JSON.parse(raw) as Partial<UserSettings>) };
  } catch {
    /* ignore corrupt settings */
  }
  return { ...DEFAULT_USER_SETTINGS };
}

export function saveUserSettings(s: UserSettings): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage full / blocked */
  }
}
