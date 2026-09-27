/**
 * Economy-private persistent data in state.ext.economy (plain data, saved).
 */
import type { CompanyId, GameState, ProductId, TechId } from '../core/types';
import type { ProductionRuntimeDump } from './production';

export interface EconomyExt {
  /** Paused research progress per company/tech (restored when resumed). */
  researchPartial: Record<CompanyId, Record<TechId, number>>;
  /** Units exported per product this month / last month (export price saturation). */
  exportMonth: Record<ProductId, number>;
  exportLast: Record<ProductId, number>;
  /** Per-building month accumulators: utilization samples (sum of daily running fraction, days). */
  util: Record<number, [number, number]>;
  /** Per-company month accumulators for reputation: [units sold to customers, sum of qty × quality]. */
  salesQ: Record<CompanyId, [number, number]>;
  /** Emission-cap baselines: regulation id → company id → baseline emissions/month. */
  capBaseline: Record<string, Record<CompanyId, number>>;
  /** Runtime caches captured on game:beforeSave (site factors, pending emissions); consumed on load. */
  runtime?: ProductionRuntimeDump;
  version: number;
}

export function econExt(state: GameState): EconomyExt {
  let e = state.ext.economy as EconomyExt | undefined;
  if (!e || typeof e !== 'object') {
    e = { researchPartial: {}, exportMonth: {}, exportLast: {}, util: {}, salesQ: {}, capBaseline: {}, version: 1 };
    state.ext.economy = e;
  }
  e.researchPartial ??= {};
  e.exportMonth ??= {};
  e.exportLast ??= {};
  e.util ??= {};
  e.salesQ ??= {};
  e.capBaseline ??= {};
  return e;
}
