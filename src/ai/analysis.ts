/**
 * Production-chain analysis for the AI (and the advisor): which end products can
 * a company make, what buildings it takes, how much capital it needs and what
 * monthly profit it may bring in a given city.
 *
 * Pure reads of the data registry + state; economy prices via ctx.services.
 * If the economy module exposes an analysis helper it can be plugged in with
 * setProfitEstimator() — otherwise the built-in estimate is used.
 */
import type { GameContext } from '../core/context';
import { cityPopulation } from '../core/entities';
import type { BuildingDef, RecipeDef } from '../data/defs';
import type { City, CityId, CompanyId, GameState, ProductId } from '../core/types';

export interface ChainInput {
  productId: ProductId;
  /** Units consumed per day by ONE consumer building at efficiency 1. */
  perDay: number;
  node: ChainNode;
}

export interface ChainNode {
  productId: ProductId;
  recipeId: string;
  buildingType: string;
  /** Units produced per day by one building at efficiency 1. */
  outPerDay: number;
  inputs: ChainInput[];
  /** Number of buildings of this node. */
  count: number;
  /** Effective total output per day (bottleneck-limited, all `count` buildings). */
  effPerDay: number;
  depth: number;
}

export interface ChainEstimate {
  productId: ProductId;
  cityId: CityId;
  shopType: string;
  root: ChainNode;
  /** Total buildings incl. shop. */
  buildingCount: number;
  /** Links (producer → consumer). */
  links: number;
  capital: number;
  monthlyRevenue: number;
  monthlyCost: number;
  profit: number;
  /** profit / capital (monthly). */
  roi: number;
  /** Units per month the city still wants. */
  unmet: number;
}

const DAYS_PER_MONTH = 30;
const DEFAULT_WAGE = 60;
const ROAD_COST_PER_LINK = 1500;

// ---------------------------------------------------------------- runtime caches (per game)
let depositCacheKey = '';
let depositTypesPresent = new Set<string>();

/** Deposit types with remaining amount on the map (cached; refreshed when key changes). */
export function presentDeposits(state: GameState): Set<string> {
  const key = `${state.meta.id}:${Math.floor(state.time.totalDays / 90)}`;
  if (key === depositCacheKey) return depositTypesPresent;
  const m = state.map;
  const found = new Set<string>();
  for (let i = 0; i < m.deposit.length; i++) {
    const d = m.deposit[i]!;
    if (d && m.depositAmount[i]! > 0) found.add(m.depositTypes[d] ?? '');
  }
  depositCacheKey = key;
  depositTypesPresent = found;
  return found;
}

export function resetAnalysisCache(): void {
  depositCacheKey = '';
}

// ---------------------------------------------------------------- unlock helpers
function unlocked(ctx: GameContext, companyId: CompanyId, kind: 'building' | 'recipe' | 'product' | 'vehicle', id: string): boolean {
  try {
    return ctx.services.economy.isUnlocked(companyId, kind, id);
  } catch {
    return false;
  }
}

function recipeUsable(ctx: GameContext, companyId: CompanyId, r: RecipeDef): boolean {
  if (r.requiresTech && !unlocked(ctx, companyId, 'recipe', r.id)) return false;
  return true;
}

function buildingUsable(ctx: GameContext, companyId: CompanyId, b: BuildingDef, state: GameState): boolean {
  if (!unlocked(ctx, companyId, 'building', b.id)) return false;
  if (b.requiresDeposit && !presentDeposits(state).has(b.requiresDeposit)) return false;
  if (b.requiresWater) return true; // placement decides
  return true;
}

/** Cheapest usable road vehicle (for cost/throughput estimates and purchases). */
export function bestVehicle(ctx: GameContext, companyId: CompanyId, mode: 'road' | 'rail' | 'water' = 'road'): string | null {
  let best: string | null = null;
  let bestScore = -Infinity;
  for (const v of ctx.data.vehicleList()) {
    if (v.mode !== mode || !unlocked(ctx, companyId, 'vehicle', v.id)) continue;
    // capacity × speed per zł of monthly upkeep+amortization
    const score = (v.capacity * Math.max(1, v.wagons?.min ?? 1) * v.speed) / (v.upkeep + v.cost / 60 + 1);
    if (score > bestScore) {
      bestScore = score;
      best = v.id;
    }
  }
  return best;
}

/** Shop building types able to sell a product. */
export function shopsFor(ctx: GameContext, companyId: CompanyId, productId: ProductId): BuildingDef[] {
  const list = ctx.data.buildingsIn('shop').filter((b) => unlocked(ctx, companyId, 'building', b.id));
  const explicit = list.filter((b) => b.sells?.includes(productId));
  if (explicit.length) return explicit.sort((a, b) => a.cost - b.cost);
  return list.filter((b) => !b.sells || b.sells.length === 0).sort((a, b) => a.cost - b.cost);
}

/** Products consumed by cities (end products). */
export function consumerProducts(ctx: GameContext): ProductId[] {
  return ctx.data
    .productList()
    .filter((p) => p.consumption && Object.values(p.consumption).some((v) => (v ?? 0) > 0) && !p.isWaste)
    .map((p) => p.id);
}

// ---------------------------------------------------------------- chain tree
/**
 * Build the cheapest usable production tree for a product (null if impossible).
 * `maxDepth` guards against cycles; raw recipes (no inputs) end the recursion.
 */
export function buildChain(ctx: GameContext, companyId: CompanyId, productId: ProductId, depth = 0, seen: string[] = []): ChainNode | null {
  if (depth > 6 || seen.includes(productId)) return null;
  const state = ctx.state;
  let best: ChainNode | null = null;
  let bestScore = Infinity;
  for (const r of ctx.data.recipesProducing(productId)) {
    if (!recipeUsable(ctx, companyId, r)) continue;
    const out = r.outputs.find((o) => o.product === productId);
    if (!out || r.days <= 0) continue;
    const bdefs = ctx.data.buildingsRunning(r.id).filter(
      (b) => (b.category === 'raw' || b.category === 'factory' || b.category === 'recycling' || b.category === 'energy') && buildingUsable(ctx, companyId, b, state),
    );
    if (!bdefs.length) continue;
    // Recycling needs waste inputs that normally come from others — skip for chain building.
    const bdef = bdefs.sort((a, b) => a.cost - b.cost)[0]!;
    if (bdef.category === 'recycling') continue;
    const inputs: ChainInput[] = [];
    let ok = true;
    for (const io of r.inputs) {
      const child = buildChain(ctx, companyId, io.product, depth + 1, [...seen, productId]);
      if (!child) {
        ok = false;
        break;
      }
      inputs.push({ productId: io.product, perDay: io.qty / r.days, node: child });
    }
    if (!ok) continue;
    const node: ChainNode = {
      productId,
      recipeId: r.id,
      buildingType: bdef.id,
      outPerDay: out.qty / r.days,
      inputs,
      count: 1,
      effPerDay: 0,
      depth,
    };
    // Score: prefer standard recipes and cheaper subtrees.
    const score = subtreeCost(ctx, node) * (r.alternative ? 1.15 : 1);
    if (score < bestScore) {
      bestScore = score;
      best = node;
    }
  }
  return best;
}

function subtreeCost(ctx: GameContext, n: ChainNode): number {
  let c = (ctx.data.buildings[n.buildingType]?.cost ?? 0) * n.count;
  for (const i of n.inputs) c += subtreeCost(ctx, i.node);
  return c;
}

/** Visit every node (pre-order). */
export function forEachNode(n: ChainNode, fn: (n: ChainNode, parent: ChainNode | null) => void, parent: ChainNode | null = null): void {
  fn(n, parent);
  for (const i of n.inputs) forEachNode(i.node, fn, n);
}

/**
 * Balance counts (more raw producers when they are the bottleneck) and compute
 * effective throughput bottom-up.
 */
export function balanceChain(n: ChainNode, balance: boolean, maxBuildings: number): void {
  // bottom-up effective rate with counts
  const compute = (node: ChainNode): number => {
    let ratio = 1;
    for (const i of node.inputs) {
      const supply = compute(i.node);
      const need = i.perDay * node.count;
      if (need > 0) ratio = Math.min(ratio, supply / need);
    }
    node.effPerDay = node.outPerDay * node.count * Math.min(1, ratio);
    return node.effPerDay;
  };
  compute(n);
  if (!balance) return;
  // Greedy: increase count of the tightest input node while it improves throughput.
  for (let iter = 0; iter < 6; iter++) {
    if (countBuildings(n) >= maxBuildings) break;
    let worst: ChainInput | null = null;
    let worstRatio = 0.8;
    forEachNode(n, (node) => {
      for (const i of node.inputs) {
        const need = i.perDay * node.count;
        const r = need > 0 ? i.node.effPerDay / need : 1;
        if (r < worstRatio && i.node.count < 3) {
          worstRatio = r;
          worst = i;
        }
      }
    });
    if (!worst) break;
    (worst as ChainInput).node.count++;
    compute(n);
  }
}

export function countBuildings(n: ChainNode): number {
  let c = 0;
  forEachNode(n, (node) => (c += node.count));
  return c;
}

// ---------------------------------------------------------------- demand
/** Units per month the city still wants (demand record or population estimate). */
export function unmetDemand(ctx: GameContext, city: City, productId: ProductId): number {
  const d = city.demand[productId];
  if (d) return Math.max(0, d.monthly * (1 - Math.min(1, d.satisfaction)));
  const p = ctx.data.products[productId];
  if (!p?.consumption) return 0;
  const c = p.consumption;
  return ((c.poor ?? 0) * city.population.poor + (c.middle ?? 0) * city.population.middle + (c.rich ?? 0) * city.population.rich) / 1000;
}

/** Share (0..1) of the city's supply of a product that belongs to companies other than `companyId`. */
export function rivalShare(city: City, productId: ProductId, companyId: CompanyId): number {
  const d = city.demand[productId];
  if (!d) return 0;
  let total = 0;
  let others = 0;
  for (const [k, v] of Object.entries(d.shareByCompany)) {
    total += v;
    if (Number(k) !== companyId) others += v;
  }
  return total > 0 ? others / total : 0;
}

// ---------------------------------------------------------------- estimate
export type ProfitEstimator = (ctx: GameContext, companyId: CompanyId, est: ChainEstimate) => ChainEstimate;
let externalEstimator: ProfitEstimator | null = null;
/** Let another module refine chain estimates (e.g. economy's balance model). */
export function setProfitEstimator(fn: ProfitEstimator | null): void {
  externalEstimator = fn;
}

function price(ctx: GameContext, productId: ProductId, cityId: CityId): number {
  try {
    const p = ctx.services.economy.price(productId, cityId);
    if (Number.isFinite(p) && p > 0) return p;
  } catch {
    /* fall through */
  }
  return ctx.data.products[productId]?.basePrice ?? 0;
}

/** Estimate a chain for `productId` sold in `city`. null = not buildable. */
export function estimateChain(
  ctx: GameContext,
  companyId: CompanyId,
  productId: ProductId,
  city: City,
  opts: { balance: boolean; maxBuildings: number },
): ChainEstimate | null {
  const shop = shopsFor(ctx, companyId, productId)[0];
  if (!shop) return null;
  const root = buildChain(ctx, companyId, productId);
  if (!root) return null;
  balanceChain(root, opts.balance, opts.maxBuildings - 1);
  const nb = countBuildings(root);
  if (nb + 1 > opts.maxBuildings) return null;

  const wage = city.labour?.wage || DEFAULT_WAGE;
  let capital = shop.cost;
  let monthlyCost = shop.upkeep + shop.workers * wage;
  forEachNode(root, (n) => {
    const def = ctx.data.buildings[n.buildingType]!;
    capital += def.cost * n.count;
    monthlyCost += (def.upkeep + def.workers * wage) * n.count;
  });
  const links = nb; // every building delivers to its consumer (root → shop)
  const vid = bestVehicle(ctx, companyId, 'road');
  const vdef = vid ? ctx.data.vehicles[vid] : undefined;
  if (vdef) {
    capital += (vdef.cost + ROAD_COST_PER_LINK) * links;
    monthlyCost += vdef.upkeep * links;
  } else {
    capital += ROAD_COST_PER_LINK * links;
  }
  const unmet = unmetDemand(ctx, city, productId);
  const soldPerMonth = Math.min(root.effPerDay * DAYS_PER_MONTH, unmet);
  const monthlyRevenue = soldPerMonth * price(ctx, productId, city.id);
  const profit = monthlyRevenue - monthlyCost;
  let est: ChainEstimate = {
    productId,
    cityId: city.id,
    shopType: shop.id,
    root,
    buildingCount: nb + 1,
    links,
    capital,
    monthlyRevenue,
    monthlyCost,
    profit,
    roi: capital > 0 ? profit / capital : 0,
    unmet,
  };
  if (externalEstimator) {
    try {
      est = externalEstimator(ctx, companyId, est);
    } catch {
      /* keep own estimate */
    }
  }
  return est;
}

/** Quick city ranking for a product: best unmet-demand value. */
export function citiesByOpportunity(ctx: GameContext, companyId: CompanyId, productId: ProductId): { city: City; value: number }[] {
  const out: { city: City; value: number }[] = [];
  for (const city of Object.values(ctx.state.cities)) {
    if (cityPopulation(city) <= 0) continue;
    const unmet = unmetDemand(ctx, city, productId);
    if (unmet <= 0) continue;
    out.push({ city, value: unmet * price(ctx, productId, city.id) });
  }
  return out.sort((a, b) => b.value - a.value);
}
