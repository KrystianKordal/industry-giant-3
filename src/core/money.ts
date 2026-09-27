/**
 * The ONLY way to change company cash. Records the amount in the company's
 * open ledger month and emits 'cash:changed'.
 *
 *   addMoney(ctx, companyId, -cost, 'construction');   // expense (negative)
 *   addMoney(ctx, companyId, revenue, 'sales');         // income (positive)
 *
 * Monthly closing (moving `current` into `history`, taxes, valuation) is done
 * by the economy finance system.
 */
import type { GameContext } from './context';
import { NON_OPERATING_CATEGORIES, type CompanyId, type FinanceCategory, type FinanceMonth } from './types';

/** Record a signed amount into a ledger month (pure helper). */
export function recordLedger(m: FinanceMonth, amount: number, category: FinanceCategory): void {
  m.ledger[category] = (m.ledger[category] ?? 0) + amount;
  if (NON_OPERATING_CATEGORIES.includes(category)) return;
  if (amount >= 0) m.revenue += amount;
  else m.expenses += -amount;
  m.profit = m.revenue - m.expenses;
}

/** Apply a signed cash change. Returns the new cash (NaN if company unknown). */
export function addMoney(ctx: GameContext, companyId: CompanyId, amount: number, category: FinanceCategory): number {
  const c = ctx.state.companies[companyId];
  if (!c || !Number.isFinite(amount) || amount === 0) return c?.cash ?? NaN;
  c.cash += amount;
  recordLedger(c.finances.current, amount, category);
  ctx.bus.emit('cash:changed', { companyId, cash: c.cash, amount, category });
  return c.cash;
}

/** Try to pay; returns false (and changes nothing) when cash is insufficient. */
export function trySpend(ctx: GameContext, companyId: CompanyId, cost: number, category: FinanceCategory): boolean {
  const c = ctx.state.companies[companyId];
  if (!c || c.cash < cost) return false;
  addMoney(ctx, companyId, -cost, category);
  return true;
}

export const canAfford = (ctx: GameContext, companyId: CompanyId, cost: number): boolean =>
  (ctx.state.companies[companyId]?.cash ?? -Infinity) >= cost;
