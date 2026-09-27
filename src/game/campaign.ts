/**
 * Campaign progress (unlocked / completed scenarios), persisted in localStorage
 * under 'ig3.campaign' — independent from save games.
 */
import { STORAGE_PREFIX } from '../core/constants';
import { SCENARIOS } from './scenarios';

export interface CampaignProgress {
  /** scenarioId -> completion record. */
  completed: Record<string, { days: number; date: string }>;
}

const KEY = `${STORAGE_PREFIX}campaign`;
let memoryFallback: CampaignProgress = { completed: {} };

export function loadCampaign(): CampaignProgress {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<CampaignProgress>;
      return { completed: p.completed && typeof p.completed === 'object' ? p.completed : {} };
    }
  } catch {
    /* corrupt / blocked */
  }
  return { completed: { ...memoryFallback.completed } };
}

export function saveCampaign(p: CampaignProgress): void {
  memoryFallback = p;
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage blocked */
  }
}

/** Scenario i is unlocked when it is the first one or the previous one is completed. */
export function isUnlocked(p: CampaignProgress, scenarioId: string): boolean {
  const i = SCENARIOS.findIndex((s) => s.id === scenarioId);
  if (i <= 0) return i === 0;
  return !!p.completed[SCENARIOS[i - 1]!.id];
}

export function markCompleted(scenarioId: string, days: number): CampaignProgress {
  const p = loadCampaign();
  const prev = p.completed[scenarioId];
  if (!prev || days < prev.days) p.completed[scenarioId] = { days, date: new Date().toISOString() };
  saveCampaign(p);
  return p;
}

export function nextScenarioId(scenarioId: string): string | null {
  const i = SCENARIOS.findIndex((s) => s.id === scenarioId);
  return i >= 0 && i + 1 < SCENARIOS.length ? SCENARIOS[i + 1]!.id : null;
}
