/**
 * Economic analysis helpers (pure reads) for AI, advisor and UI:
 *
 *  - buildingEconomics(ctx, typeId, recipeId?)  monthly flows + value added of one building at efficiency 1
 *  - planChain(ctx, productId, opts)            full production tree for a product with balanced building
 *                                               counts, investment, monthly profit and payback
 *  - rankChains(ctx, companyId, opts)           all sellable products the company can make, best first
 *  - pnlSummary(company)                        grouped P&L of the open and last closed month (UI)
 *
 * Prices: market (default) or base. Wages: average city wage (or era fallback).
 * Transport is approximated (one cheapest unlocked road vehicle per link + road
 * cost per link); real results depend on distances and logistics.
 */
import type { GameContext } from '../core/context';
import { DAYS_PER_MONTH } from '../core/constants';
import type { Company, CompanyId, FinanceCategory, FinanceMonth, ProductAmounts, ProductId } from '../core/types';
import { NON_OPERATING_CATEGORIES } from '../core/types';
import type { BuildingDef, RecipeDef } from '../data/defs';
import { GRID_PRICE, WHOLESALE } from './constants';
import { companyEraIndex, isUnlockedFor } from './unlocks';
import { baseWage } from './workforce';

export interface AnalysisOptions {
  /** 'market' (default) = current market prices, 'base' = ProductDef.basePrice. */
  prices?: 'market' | 'base';
  /** Monthly wage per worker (default: average city wage or era fallback). */
  wage?: number;
  /** Only unlocked content for this company (default: no filter). */
  companyId?: CompanyId;
  /** Road cost per producer→consumer link (default 1500 zł ≈ 25 tiles of dirt road). */
  roadCostPerLink?: number;
  /** Price level multiplier applied to 'base' prices (e.g. PRICE_INDEX_BY_ERA[era]); default 1. */
  priceIndex?: number;
  /** Workforce multiplier (automation research, e.g. 0.8); default 1. */
  workersMul?: number;
}

export interface BuildingEconomics {
  typeId: string;
  recipeId: string | null;
  cyclesPerMonth: number;
  inputs: ProductAmounts;
  outputs: ProductAmounts;
  byproducts: ProductAmounts;
  /** Market value of inputs / main outputs per month. */
  inputCost: number;
  outputValue: number;
  upkeep: number;
  wages: number;
  energy: number;
  /** outputValue − inputCost − upkeep − wages − energy. */
  valueAdded: number;
}

export interface ChainNode {
  productId: ProductId;
  typeId: string;
  recipeId: string;
  /** Buildings needed (fractional, balanced to feed the parent). */
  count: number;
  /** Units of productId produced per month by ONE building. */
  outPerBuilding: number;
  inputs: ChainNode[];
  depth: number;
  requiresDeposit?: string;
}

export interface ChainPlan {
  productId: ProductId;
  root: ChainNode;
  /** Every node flattened (root first). */
  nodes: ChainNode[];
  shopTypeId: string | null;
  /** Units of the final product per month. */
  unitsPerMonth: number;
  /** Buildings (whole numbers) incl. shop. */
  buildings: number;
  /** Steady-state investment / costs / profit: suppliers counted proportionally (shared between chains). */
  investment: number;
  monthlyRevenue: number;
  monthlyCost: number;
  monthlyProfit: number;
  /** Building everything from scratch for this chain only (suppliers rounded up to whole buildings). */
  standaloneInvestment: number;
  standaloneProfit: number;
  /** investment / monthlyProfit (Infinity when not profitable). */
  paybackMonths: number;
  deposits: string[];
  /** Everything in the chain is unlocked for opts.companyId (true when no company given). */
  unlocked: boolean;
}

// ---------------------------------------------------------------- helpers
function priceOf(ctx: GameContext, p: ProductId, opts: AnalysisOptions): number {
  const base = ctx.data.products[p]?.basePrice ?? 0;
  if (opts.prices === 'base') return base * (opts.priceIndex ?? 1);
  const st = ctx.tryState();
  const m = st?.market.products[p]?.price;
  return m !== undefined && Number.isFinite(m) && m > 0 ? m : base;
}

function wageOf(ctx: GameContext, opts: AnalysisOptions): number {
  if (opts.wage !== undefined) return opts.wage;
  const st = ctx.tryState();
  if (!st) return 55;
  const cities = Object.values(st.cities);
  if (cities.length) {
    const avg = cities.reduce((s, c) => s + (c.labour.wage || 0), 0) / cities.length;
    if (avg > 0) return avg;
  }
  return baseWage(ctx, st);
}

function unlocked(ctx: GameContext, opts: AnalysisOptions, kind: 'building' | 'recipe' | 'vehicle', id: string): boolean {
  if (!opts.companyId) return true;
  const st = ctx.tryState();
  if (!st) return true;
  return isUnlockedFor(st, ctx.data, st.companies[opts.companyId], kind, id);
}

/** Monthly economics of one building running `recipeId` at efficiency 1. */
export function buildingEconomics(ctx: GameContext, typeId: string, recipeId?: string, opts: AnalysisOptions = {}): BuildingEconomics {
  const def = ctx.data.building(typeId);
  const r = recipeId ? ctx.data.recipe(recipeId) : def.recipes[0] ? ctx.data.recipe(def.recipes[0]) : null;
  const cycles = r ? DAYS_PER_MONTH / r.days : 0;
  const inputs: ProductAmounts = {};
  const outputs: ProductAmounts = {};
  const byproducts: ProductAmounts = {};
  let inputCost = 0;
  let outputValue = 0;
  if (r) {
    for (const io of r.inputs) {
      inputs[io.product] = io.qty * cycles;
      inputCost += io.qty * cycles * priceOf(ctx, io.product, opts);
    }
    for (const io of r.outputs) {
      outputs[io.product] = io.qty * cycles;
      outputValue += io.qty * cycles * priceOf(ctx, io.product, opts);
    }
    for (const io of r.byproducts ?? []) byproducts[io.product] = io.qty * cycles;
  }
  const upkeep = def.upkeep;
  const wages = (def.workers > 0 ? Math.max(1, Math.round(def.workers * (opts.workersMul ?? 1))) : 0) * wageOf(ctx, opts);
  const energy = def.power && def.power < 0 ? -def.power * GRID_PRICE : 0;
  return {
    typeId,
    recipeId: r?.id ?? null,
    cyclesPerMonth: cycles,
    inputs,
    outputs,
    byproducts,
    inputCost,
    outputValue,
    upkeep,
    wages,
    energy,
    valueAdded: outputValue - inputCost - upkeep - wages - energy,
  };
}

/** Candidate producers of a product, best first: standard recipes, no waste inputs, fewest inputs, cheapest building. */
export function producersOf(ctx: GameContext, productId: ProductId, opts: AnalysisOptions = {}): { def: BuildingDef; recipe: RecipeDef }[] {
  const recipes = ctx.data.recipesProducing(productId).filter((r) => unlocked(ctx, opts, 'recipe', r.id));
  const wasteIn = (r: RecipeDef): number => r.inputs.filter((i) => ctx.data.products[i.product]?.isWaste).length;
  recipes.sort((a, b) => wasteIn(a) - wasteIn(b) || Number(!!a.alternative) - Number(!!b.alternative) || a.inputs.length - b.inputs.length);
  const out: { def: BuildingDef; recipe: RecipeDef }[] = [];
  for (const r of recipes) {
    const buildings = ctx.data.buildingsRunning(r.id).filter((b) => unlocked(ctx, opts, 'building', b.id));
    buildings.sort((a, b) => a.cost - b.cost);
    if (buildings[0]) out.push({ def: buildings[0], recipe: r });
  }
  return out;
}

/** Preferred (standard, unlocked) producer of a product. */
export function producerOf(ctx: GameContext, productId: ProductId, opts: AnalysisOptions = {}): { def: BuildingDef; recipe: RecipeDef } | null {
  return producersOf(ctx, productId, opts)[0] ?? null;
}

/** Cheapest unlocked shop selling a product (null = none). */
export function shopFor(ctx: GameContext, productId: ProductId, opts: AnalysisOptions = {}): BuildingDef | null {
  const shops = ctx.data
    .buildingsIn('shop')
    .filter((s) => s.sells?.includes(productId) && unlocked(ctx, opts, 'building', s.id))
    .sort((a, b) => a.cost - b.cost);
  return shops[0] ?? null;
}

function buildNode(ctx: GameContext, productId: ProductId, need: number | null, depth: number, seen: string[], opts: AnalysisOptions): ChainNode | null {
  if (depth > 8 || seen.includes(productId)) return null;
  for (const { def, recipe } of producersOf(ctx, productId, opts)) {
    const cycles = DAYS_PER_MONTH / recipe.days;
    const out = (recipe.outputs.find((o) => o.product === productId)?.qty ?? 0) * cycles;
    if (out <= 0) continue;
    const count = need === null ? 1 : need / out;
    const node: ChainNode = { productId, typeId: def.id, recipeId: recipe.id, count, outPerBuilding: out, inputs: [], depth, requiresDeposit: def.requiresDeposit };
    let ok = true;
    for (const io of recipe.inputs) {
      const child = buildNode(ctx, io.product, io.qty * cycles * count, depth + 1, [...seen, productId], opts);
      if (!child) {
        ok = false;
        break;
      }
      node.inputs.push(child);
    }
    if (ok) return node;
  }
  return null;
}

function flatten(n: ChainNode, out: ChainNode[] = []): ChainNode[] {
  out.push(n);
  for (const c of n.inputs) flatten(c, out);
  return out;
}

/**
 * Plan a full chain producing `productId` (root = one final-stage building,
 * suppliers balanced to feed it). Returns null if some input has no producer.
 */
export function planChain(ctx: GameContext, productId: ProductId, opts: AnalysisOptions = {}): ChainPlan | null {
  const root = buildNode(ctx, productId, null, 0, [], opts);
  if (!root) return null;
  const nodes = flatten(root);
  const shop = shopFor(ctx, productId, opts);
  const isDigital = ctx.data.products[productId]?.category === 'digital';
  const vehicles = ctx.data
    .vehicleList()
    .filter((v) => v.mode === 'road' && unlocked(ctx, opts, 'vehicle', v.id))
    .sort((a, b) => a.cost - b.cost);
  const truck = vehicles[0];
  const links = nodes.length - 1 + (shop && !isDigital ? 1 : 0);
  const roadCost = opts.roadCostPerLink ?? 1500;

  // steady state: supplier buildings are counted proportionally (they can be shared between
  // chains); standalone: every supplier rounded up to whole buildings.
  let investment = 0;
  let monthlyCost = 0;
  let standaloneInvestment = 0;
  let standaloneCost = 0;
  let buildings = 0;
  for (const n of nodes) {
    const def = ctx.data.building(n.typeId);
    const whole = Math.max(1, Math.ceil(n.count - 0.15));
    buildings += whole;
    const econ = buildingEconomics(ctx, n.typeId, n.recipeId, opts);
    const fixed = econ.upkeep + econ.wages + econ.energy;
    investment += n.count * def.cost;
    monthlyCost += n.count * fixed;
    standaloneInvestment += whole * def.cost;
    standaloneCost += whole * fixed;
  }
  let extraInv = 0;
  let extraCost = 0;
  if (shop && !isDigital) {
    buildings += 1;
    extraInv += shop.cost;
    extraCost += shop.upkeep + (shop.workers > 0 ? Math.max(1, Math.round(shop.workers * (opts.workersMul ?? 1))) : 0) * wageOf(ctx, opts);
  }
  if (truck) {
    extraInv += links * (truck.cost + roadCost);
    extraCost += links * truck.upkeep;
  }
  investment += extraInv;
  monthlyCost += extraCost;
  standaloneInvestment += extraInv;
  standaloneCost += extraCost;
  const units = root.outPerBuilding * root.count;
  // co-products (e.g. leather next to meat, chemicals next to fuel) valued at export-ish 60% of price
  let coproducts = 0;
  for (const n of nodes) {
    const r = ctx.data.recipe(n.recipeId);
    const cycles = DAYS_PER_MONTH / r.days;
    for (const o of r.outputs) if (o.product !== n.productId) coproducts += o.qty * cycles * n.count * priceOf(ctx, o.product, opts) * 0.6;
  }
  const monthlyRevenue = units * priceOf(ctx, productId, opts) + coproducts;
  const monthlyProfit = monthlyRevenue - monthlyCost;
  const deposits = [...new Set(nodes.map((n) => n.requiresDeposit).filter((d): d is string => !!d))];
  let allUnlocked = true;
  if (opts.companyId) {
    for (const n of nodes) if (!unlocked(ctx, opts, 'building', n.typeId) || !unlocked(ctx, opts, 'recipe', n.recipeId)) allUnlocked = false;
    if (!isDigital && !shop) allUnlocked = false;
  }
  return {
    productId,
    root,
    nodes,
    shopTypeId: shop?.id ?? null,
    unitsPerMonth: units,
    buildings,
    investment: Math.round(investment),
    monthlyRevenue: Math.round(monthlyRevenue),
    monthlyCost: Math.round(monthlyCost),
    monthlyProfit: Math.round(monthlyProfit),
    standaloneInvestment: Math.round(standaloneInvestment),
    standaloneProfit: Math.round(monthlyRevenue - standaloneCost),
    paybackMonths: monthlyProfit > 0 ? Math.round((investment / monthlyProfit) * 10) / 10 : Infinity,
    deposits,
    unlocked: allUnlocked,
  };
}

/**
 * All chains a company can build now (unlocked, sellable to cities or online),
 * sorted by monthly profit per invested zł. `maxInvestment` filters by budget.
 */
export function rankChains(ctx: GameContext, companyId: CompanyId, opts: AnalysisOptions & { maxInvestment?: number } = {}): ChainPlan[] {
  const st = ctx.tryState();
  const o: AnalysisOptions = { ...opts, companyId };
  const eraIdx = st ? companyEraIndex(st, ctx.data, st.companies[companyId]) : 0;
  const plans: ChainPlan[] = [];
  for (const p of ctx.data.productList()) {
    if (!p.consumption || ctx.data.eraIndex(p.era) > eraIdx) continue;
    const plan = planChain(ctx, p.id, o);
    if (!plan || !plan.unlocked || plan.monthlyProfit <= 0) continue;
    if (opts.maxInvestment !== undefined && plan.investment > opts.maxInvestment) continue;
    plans.push(plan);
  }
  return plans.sort((a, b) => b.monthlyProfit / b.investment - a.monthlyProfit / a.investment);
}

// ---------------------------------------------------------------- P&L for UI
export interface PnlGroup {
  label: string;
  categories: FinanceCategory[];
  amount: number;
}

const GROUPS: { label: string; categories: FinanceCategory[] }[] = [
  { label: 'Sprzedaż', categories: ['sales', 'trade', 'export'] },
  { label: 'Dotacje i inne przychody', categories: ['subsidy', 'assetSale', 'otherIncome'] },
  { label: 'Płace', categories: ['wages'] },
  { label: 'Utrzymanie budynków', categories: ['buildingUpkeep', 'energy'] },
  { label: 'Transport i infrastruktura', categories: ['vehicleUpkeep', 'infraUpkeep'] },
  { label: 'Inwestycje', categories: ['construction', 'demolition', 'vehiclePurchase'] },
  { label: 'Zakupy towarów', categories: ['purchases'] },
  { label: 'Badania', categories: ['research'] },
  { label: 'Podatki, odsetki i kary', categories: ['taxes', 'interest', 'emissionTax', 'fines'] },
  { label: 'Inne koszty', categories: ['disaster', 'otherExpense'] },
  { label: 'Kredyty (finansowanie)', categories: [...NON_OPERATING_CATEGORIES] },
];

export const FINANCE_CATEGORY_NAMES: Record<FinanceCategory, string> = {
  sales: 'Sprzedaż w sklepach',
  trade: 'Sprzedaż firmom',
  export: 'Eksport',
  subsidy: 'Dotacje',
  assetSale: 'Sprzedaż majątku',
  loanIn: 'Wpływy z kredytów',
  otherIncome: 'Inne przychody',
  construction: 'Budowa',
  demolition: 'Rozbiórka',
  vehiclePurchase: 'Zakup pojazdów',
  buildingUpkeep: 'Utrzymanie budynków',
  vehicleUpkeep: 'Utrzymanie pojazdów',
  infraUpkeep: 'Utrzymanie dróg i torów',
  wages: 'Płace',
  purchases: 'Zakupy towarów',
  energy: 'Energia',
  research: 'Badania i rozwój',
  interest: 'Odsetki',
  loanRepayment: 'Spłata kredytów',
  taxes: 'Podatek dochodowy',
  emissionTax: 'Opłata emisyjna',
  fines: 'Kary',
  disaster: 'Katastrofy',
  otherExpense: 'Inne koszty',
};

export function pnlGroups(m: FinanceMonth): PnlGroup[] {
  return GROUPS.map((g) => ({ ...g, amount: Math.round(g.categories.reduce((s, c) => s + (m.ledger[c] ?? 0), 0)) }));
}

export interface PnlSummary {
  current: FinanceMonth;
  last: FinanceMonth | null;
  currentGroups: PnlGroup[];
  lastGroups: PnlGroup[];
  /** Profit of the last up to 12 closed months (oldest first). */
  profitTrend: number[];
  debt: number;
  valuation: number;
}

export function pnlSummary(company: Company): PnlSummary {
  const f = company.finances;
  const last = f.history[f.history.length - 1] ?? null;
  return {
    current: f.current,
    last,
    currentGroups: pnlGroups(f.current),
    lastGroups: last ? pnlGroups(last) : [],
    profitTrend: f.history.slice(-12).map((m) => m.profit),
    debt: company.loans.reduce((s, l) => s + l.remaining, 0),
    valuation: f.valuation,
  };
}

/** Wholesale value of a stock of goods (for inspectors). */
export function stockValue(ctx: GameContext, s: Record<string, { qty: number }>): number {
  let v = 0;
  for (const p in s) v += s[p]!.qty * priceOf(ctx, p, {}) * WHOLESALE;
  return Math.round(v);
}
