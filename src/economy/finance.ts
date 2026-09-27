/**
 * Finance.
 *
 * Daily ('finance' system, SystemOrder.finance): building upkeep, wages and
 * grid electricity are charged per company (one ledger entry per category per
 * day). Vehicle and road/rail upkeep are charged by LOGISTICS, not here.
 *
 * Month close (economy.monthClose, runs first in the new month's tick):
 * loan instalments (interest + principal), corporate tax on a positive
 * monthly profit, the open ledger month → finances.history (cashEnd set),
 * valuation + creditLimit, per-building monthly stats → history, bankruptcy
 * (BANKRUPTCY_MONTHS closes in a row with negative cash → company.bankrupt,
 * 'company:bankrupt'; the game module turns that into a loss for the player).
 */
import type { GameContext } from '../core/context';
import { DAYS_PER_MONTH, HISTORY_MONTHS } from '../core/constants';
import { emptyFinanceMonth } from '../core/entities';
import { addMoney } from '../core/money';
import { notify } from '../core/notify';
import type { ActionResult } from '../core/services';
import type { Company, CompanyId, GameState, Loan, LoanId } from '../core/types';
import { clamp, newId, pushHistory } from '../core/util';
import {
  BANKRUPTCY_MONTHS,
  CREDIT_FLOOR,
  CREDIT_VALUATION_SHARE,
  DISABLED_UPKEEP,
  GRID_PRICE,
  GRID_SELL_PRICE,
  LOAN_MIN,
  TAX_RATE,
} from './constants';
import { econExt } from './ext';
import { buildingMod, companyMod } from './modifiers';

const round2 = (v: number): number => Math.round(v * 100) / 100;

// ---------------------------------------------------------------- daily costs
interface DayCosts {
  upkeep: number;
  wages: number;
  consumed: number;
  produced: number;
}

export function financeDailySystem(state: GameState, _dt: number, ctx: GameContext): void {
  const costs = new Map<CompanyId, DayCosts>();
  for (const id in state.buildings) {
    const b = state.buildings[id]!;
    if (!b.owner || b.constructionProgress < 1) continue;
    const company = state.companies[b.owner];
    if (!company || company.bankrupt) continue;
    const def = ctx.data.buildings[b.typeId];
    if (!def) continue;
    let c = costs.get(b.owner);
    if (!c) costs.set(b.owner, (c = { upkeep: 0, wages: 0, consumed: 0, produced: 0 }));
    const upkeep = ((def.upkeep * buildingMod(state, b, def, 'upkeep')) / DAYS_PER_MONTH) * (b.enabled ? 1 : DISABLED_UPKEEP);
    const wages = (b.workers.employed * b.workers.wage) / DAYS_PER_MONTH;
    c.upkeep += upkeep;
    c.wages += wages;
    b.stats.costMonth += upkeep + wages;
    const power = def.power ?? 0;
    if (power !== 0 && b.enabled && b.status === 'ok') {
      const eff = clamp(b.efficiency, 0, 1.5);
      if (power > 0) c.produced += power * eff;
      else c.consumed += -power * Math.min(1, eff);
    }
  }
  for (const [owner, c] of [...costs.entries()].sort((a, z) => a[0] - z[0])) {
    const company = state.companies[owner]!;
    if (c.upkeep > 0) addMoney(ctx, owner, -round2(c.upkeep), 'buildingUpkeep');
    if (c.wages > 0) addMoney(ctx, owner, -round2(c.wages), 'wages');
    company.energy.produced += c.produced;
    company.energy.consumed += c.consumed;
    const net = c.produced - c.consumed;
    const priceMul = companyMod(company, 'energyPrice', ['all']);
    if (net < 0) addMoney(ctx, owner, -round2((-net * GRID_PRICE * priceMul) / DAYS_PER_MONTH), 'energy');
    else if (net > 0) addMoney(ctx, owner, round2((net * GRID_SELL_PRICE) / DAYS_PER_MONTH), 'otherIncome');
  }
}

// ---------------------------------------------------------------- valuation & credit
/** Book value of company assets (buildings, vehicles, goods). */
export function assetValue(ctx: GameContext, companyId: CompanyId): number {
  const state = ctx.state;
  let v = 0;
  const goods = (s: Record<string, { qty: number; quality: number }>): number => {
    let t = 0;
    for (const p in s) t += s[p]!.qty * (state.market.products[p]?.price ?? 0) * 0.5;
    return t;
  };
  for (const id in state.buildings) {
    const b = state.buildings[id]!;
    if (b.owner !== companyId) continue;
    const def = ctx.data.buildings[b.typeId];
    const cost = def?.cost ?? 0;
    v += b.constructionProgress < 1 ? cost * b.constructionProgress * 0.7 : cost * (0.3 + 0.4 * b.condition);
    v += goods(b.input) + goods(b.output) + goods(b.storage);
  }
  for (const id in state.vehicles) {
    const veh = state.vehicles[id]!;
    if (veh.owner !== companyId) continue;
    const def = ctx.data.vehicles[veh.typeId];
    v += (def?.cost ?? 0) * (0.2 + 0.4 * veh.condition) + goods(veh.cargo);
  }
  return v;
}

export function debtOf(company: Company): number {
  return company.loans.reduce((s, l) => s + l.remaining, 0);
}

/** Valuation = cash + assets − debt + goodwill (half a year of average recent profit). */
export function computeValuation(ctx: GameContext, company: Company): number {
  const hist = company.finances.history.slice(-6);
  const avgProfit = hist.length ? hist.reduce((s, m) => s + m.profit, 0) / hist.length : 0;
  const goodwill = Math.max(0, avgProfit) * 6;
  const v = company.cash + assetValue(ctx, company.id) - debtOf(company) + goodwill;
  return Number.isFinite(v) ? Math.round(v) : 0;
}

export function computeCreditLimit(company: Company): number {
  if (company.bankrupt) return 0;
  const base = Math.max(CREDIT_FLOOR, company.finances.valuation * CREDIT_VALUATION_SHARE);
  return Math.round(base * (0.5 + clamp(company.reputation, 0, 100) / 100));
}

// ---------------------------------------------------------------- loans
/** Annual rate offered to a company (base rate + risk premium) × `interest.all`. */
export function loanRate(ctx: GameContext, company: Company): number {
  const base = ctx.state.market.interestRate || 0.07;
  const debt = debtOf(company);
  const leverage = company.creditLimit > 0 ? debt / company.creditLimit : 1;
  const risk = 0.02 * clamp(leverage, 0, 1.5) + (0.02 * (50 - clamp(company.reputation, 0, 100))) / 50 + (company.monthsInDebt > 0 ? 0.03 : 0);
  return Math.round(Math.max(0.01, (base + risk) * companyMod(company, 'interest', ['all'])) * 10000) / 10000;
}

export function annuityPayment(principal: number, annualRate: number, months: number): number {
  const r = annualRate / 12;
  if (r <= 0) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

export function takeLoan(ctx: GameContext, companyId: CompanyId, amount: number, termMonths: number): ActionResult<{ loanId: LoanId }> {
  const state = ctx.state;
  const c = state.companies[companyId];
  if (!c) return { ok: false, reason: 'Nieznana firma' };
  if (c.bankrupt) return { ok: false, reason: 'Firma jest bankrutem' };
  if (!Number.isFinite(amount) || amount < LOAN_MIN) return { ok: false, reason: `Minimalna kwota kredytu to ${LOAN_MIN} zł` };
  const term = Math.round(termMonths);
  if (!Number.isFinite(term) || term < 6 || term > 240) return { ok: false, reason: 'Okres kredytu: 6–240 miesięcy' };
  const available = c.creditLimit - debtOf(c);
  if (amount > available + 1e-6) return { ok: false, reason: `Przekroczony limit kredytowy (dostępne: ${Math.max(0, Math.floor(available))} zł)` };
  const rate = loanRate(ctx, c);
  const loan: Loan = {
    id: newId(state, 'loan'),
    principal: Math.round(amount),
    remaining: Math.round(amount),
    annualRate: rate,
    monthlyPayment: round2(annuityPayment(Math.round(amount), rate, term)),
    termMonths: term,
    takenDay: state.time.totalDays,
  };
  c.loans.push(loan);
  addMoney(ctx, companyId, loan.principal, 'loanIn');
  ctx.bus.emit('sfx', { id: 'cash' });
  return { ok: true, cost: -loan.principal, loanId: loan.id };
}

export function repayLoan(ctx: GameContext, companyId: CompanyId, loanId: LoanId, amount?: number): ActionResult {
  const c = ctx.state.companies[companyId];
  if (!c) return { ok: false, reason: 'Nieznana firma' };
  const loan = c.loans.find((l) => l.id === loanId);
  if (!loan) return { ok: false, reason: 'Nie ma takiego kredytu' };
  const pay = round2(Math.min(loan.remaining, amount === undefined ? loan.remaining : Math.max(0, amount)));
  if (pay <= 0) return { ok: false, reason: 'Nieprawidłowa kwota' };
  if (c.cash < pay) return { ok: false, reason: 'Brak środków' };
  addMoney(ctx, companyId, -pay, 'loanRepayment');
  loan.remaining = round2(loan.remaining - pay);
  if (loan.remaining <= 0.01) c.loans = c.loans.filter((l) => l.id !== loanId);
  else {
    // keep the end date: recompute the instalment over the remaining months
    const monthsPassed = Math.floor((ctx.state.time.totalDays - loan.takenDay) / DAYS_PER_MONTH);
    const left = Math.max(1, loan.termMonths - monthsPassed);
    loan.monthlyPayment = round2(annuityPayment(loan.remaining, loan.annualRate, left));
  }
  return { ok: true, cost: pay };
}

// ---------------------------------------------------------------- month close
function closeBuildingsMonth(state: GameState): void {
  const ext = econExt(state);
  for (const id in state.buildings) {
    const b = state.buildings[id]!;
    const s = b.stats;
    pushHistory(s.profitHistory, round2(s.revenueMonth - s.costMonth));
    const u = ext.util[b.id];
    pushHistory(s.utilizationHistory, u && u[1] > 0 ? Math.round((u[0] / u[1]) * 1000) / 1000 : 0);
    s.producedMonth = {};
    s.consumedMonth = {};
    s.soldMonth = {};
    s.revenueMonth = 0;
    s.costMonth = 0;
  }
  ext.util = {};
}

function payLoans(ctx: GameContext, c: Company): void {
  for (const loan of [...c.loans]) {
    const interest = round2((loan.remaining * loan.annualRate) / 12);
    const principal = round2(Math.min(loan.remaining, Math.max(0, loan.monthlyPayment - interest)));
    if (interest > 0) addMoney(ctx, c.id, -interest, 'interest');
    if (principal > 0) addMoney(ctx, c.id, -principal, 'loanRepayment');
    loan.remaining = round2(loan.remaining - principal);
    if (loan.remaining <= 0.01) c.loans = c.loans.filter((l) => l.id !== loan.id);
  }
}

function checkBankruptcy(ctx: GameContext, c: Company): void {
  if (c.bankrupt) return;
  if (c.cash >= 0) {
    c.monthsInDebt = 0;
    return;
  }
  c.monthsInDebt++;
  const left = BANKRUPTCY_MONTHS - c.monthsInDebt;
  if (left <= 0) {
    c.bankrupt = true;
    c.creditLimit = 0;
    ctx.bus.emit('company:bankrupt', { companyId: c.id });
    return;
  }
  notify(ctx, {
    level: 'danger',
    icon: '💸',
    title: 'Ujemne saldo — groźba bankructwa',
    text: `Firma ma ${Math.round(c.cash)} zł. Jeśli za ${left} ${left === 1 ? 'miesiąc' : 'miesiące'} saldo nadal będzie ujemne, ogłosisz bankructwo. Weź kredyt, sprzedaj majątek albo ogranicz koszty.`,
    target: { kind: 'company', id: c.id },
    companyId: c.id,
    category: 'finance',
  });
}

/** Finance part of the month close. Must run BEFORE anything books into the new month. */
export function closeFinanceMonth(state: GameState, ctx: GameContext): void {
  const companies = Object.values(state.companies).sort((a, z) => a.id - z.id);
  for (const c of companies) {
    if (!c.bankrupt) {
      payLoans(ctx, c);
      c.finances.taxRate = c.finances.taxRate > 0 ? c.finances.taxRate : TAX_RATE[state.settings.difficulty] ?? 0.19;
      const cur = c.finances.current;
      if (cur.profit > 0) addMoney(ctx, c.id, -round2(cur.profit * c.finances.taxRate), 'taxes');
    }
    const m = c.finances.current;
    m.revenue = round2(m.revenue);
    m.expenses = round2(m.expenses);
    m.profit = round2(m.profit);
    m.cashEnd = round2(c.cash);
    c.finances.history.push(m);
    if (c.finances.history.length > HISTORY_MONTHS) c.finances.history.splice(0, c.finances.history.length - HISTORY_MONTHS);
    c.finances.lifetimeRevenue = round2(c.finances.lifetimeRevenue + m.revenue);
    c.finances.lifetimeProfit = round2(c.finances.lifetimeProfit + m.profit);
    c.finances.current = emptyFinanceMonth(state.time.year, state.time.month);
    pushHistory((state.stats.monthly[`company.${c.id}.profit`] ??= []), m.profit);
    pushHistory((state.stats.monthly[`company.${c.id}.revenue`] ??= []), m.revenue);
    c.energy = { produced: 0, consumed: 0 };
    checkBankruptcy(ctx, c);
    c.finances.valuation = computeValuation(ctx, c);
    pushHistory(c.finances.valuationHistory, c.finances.valuation);
    c.creditLimit = computeCreditLimit(c);
  }
  closeBuildingsMonth(state);
}

/** Refresh valuation & credit limit now (new game / load / after big changes). */
export function refreshCompanyFinance(ctx: GameContext, c: Company): void {
  c.finances.valuation = computeValuation(ctx, c);
  c.creditLimit = computeCreditLimit(c);
}
