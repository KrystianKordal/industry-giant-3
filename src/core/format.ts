/**
 * Polish formatting helpers (money, numbers, dates). Use everywhere in UI text.
 */
import type { Season, TimeState } from './types';

export const MONTH_NAMES = [
  'styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec',
  'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień',
] as const;
/** Genitive month names ("5 marca 1850"). */
export const MONTH_NAMES_GEN = [
  'stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
  'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia',
] as const;
export const MONTH_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'] as const;

export const SEASON_NAMES: Record<Season, string> = {
  spring: 'Wiosna',
  summer: 'Lato',
  autumn: 'Jesień',
  winter: 'Zima',
};
export const SEASON_ICONS: Record<Season, string> = { spring: '🌱', summer: '☀️', autumn: '🍂', winter: '❄️' };

const nf0 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 });

/** "1 234" */
export const formatNumber = (v: number, digits = 0): string =>
  digits === 0 ? nf0.format(v) : new Intl.NumberFormat('pl-PL', { maximumFractionDigits: digits }).format(v);

/** "1 234 zł" or compact "1,2 mln zł". */
export function formatMoney(v: number, compact = false): string {
  if (compact) {
    const a = Math.abs(v);
    if (a >= 1e9) return `${nf1.format(v / 1e9)} mld zł`;
    if (a >= 1e6) return `${nf1.format(v / 1e6)} mln zł`;
    if (a >= 1e4) return `${nf1.format(v / 1e3)} tys. zł`;
  }
  return `${nf0.format(Math.round(v))} zł`;
}

/** 0.456 -> "46%" */
export const formatPercent = (v: number, digits = 0): string => `${(v * 100).toFixed(digits).replace('.', ',')}%`;

/** "5 marca 1850" */
export const formatDate = (t: Pick<TimeState, 'day' | 'month' | 'year'>): string =>
  `${t.day} ${MONTH_NAMES_GEN[t.month - 1]} ${t.year}`;

/** "mar 1850" — for chart labels. */
export const formatMonthShort = (month: number, year: number): string => `${MONTH_SHORT[month - 1]} ${year}`;

/** Signed value with + prefix: "+1 200 zł". */
export const formatSignedMoney = (v: number, compact = false): string => (v > 0 ? '+' : '') + formatMoney(v, compact);
