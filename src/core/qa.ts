/**
 * Simulation QA helpers (tests / debugging only — not imported by the game).
 *
 *  - createSimContext(): headless context with every SIMULATION module
 *    (world, economy, logistics, ai, game) initialised like main.ts does.
 *  - scanState(state): deep invariant scanner (NaN/Infinity anywhere, negative
 *    stock, quality outside 0..1, dangling entity references, map index sync).
 *  - checkLedgers(state): money conservation per closed month
 *    (Σ ledger == cashEnd − previous cashEnd).
 *  - snapshot(state): order-independent digest for determinism checks.
 */
import { init as initAi } from '../ai';
import { init as initEconomy } from '../economy';
import { init as initGame } from '../game';
import { init as initLogistics } from '../logistics';
import { init as initWorld } from '../world';
import { createContext, type GameContext } from './context';
import { installCore } from './lifecycle';
import type { GameState, Stock } from './types';

export function createSimContext(opts: { throwOnError?: boolean } = {}): GameContext {
  const ctx = createContext({ headless: true });
  ctx.sim.throwOnError = opts.throwOnError ?? true;
  installCore(ctx);
  initWorld(ctx);
  initEconomy(ctx);
  initLogistics(ctx);
  initAi(ctx);
  initGame(ctx);
  return ctx;
}

// ---------------------------------------------------------------- deep scan
/** Every non-finite number anywhere in the state (incl. typed arrays). */
export function findNonFinite(v: unknown, path = 'state', out: string[] = [], limit = 30): string[] {
  if (out.length >= limit) return out;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) out.push(`${path}=${v}`);
    return out;
  }
  if (!v || typeof v !== 'object') return out;
  if (ArrayBuffer.isView(v)) {
    if (v instanceof Float32Array || v instanceof Float64Array) {
      for (let i = 0; i < v.length && out.length < limit; i++) if (!Number.isFinite(v[i]!)) out.push(`${path}[${i}]=${v[i]}`);
    }
    return out;
  }
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length && out.length < limit; i++) findNonFinite(v[i], `${path}[${i}]`, out, limit);
    return out;
  }
  for (const k in v as Record<string, unknown>) {
    if (out.length >= limit) break;
    findNonFinite((v as Record<string, unknown>)[k], `${path}.${k}`, out, limit);
  }
  return out;
}

function scanStock(s: Stock, path: string, out: string[]): void {
  for (const p in s) {
    const e = s[p]!;
    if (e.qty < -1e-6) out.push(`${path}.${p}.qty=${e.qty} (negative)`);
    if (e.quality < -1e-6 || e.quality > 1 + 1e-6) out.push(`${path}.${p}.quality=${e.quality} (outside 0..1)`);
  }
}

/** Structural invariants. Returns a list of human-readable problems (empty = OK). */
export function scanState(state: GameState): string[] {
  const out = findNonFinite(state);
  const W = state.map.width;
  for (const id in state.buildings) {
    const b = state.buildings[id]!;
    scanStock(b.input, `building#${id}.input`, out);
    scanStock(b.output, `building#${id}.output`, out);
    scanStock(b.storage, `building#${id}.storage`, out);
    if (b.owner && !state.companies[b.owner]) out.push(`building#${id}: unknown owner ${b.owner}`);
    if (state.map.building[b.y * W + b.x] !== b.id) out.push(`building#${id}: map.building out of sync`);
    if (b.condition < -1e-6 || b.condition > 1 + 1e-6) out.push(`building#${id}.condition=${b.condition}`);
    if (b.workers.employed < -1e-6) out.push(`building#${id}.workers.employed=${b.workers.employed}`);
  }
  for (let i = 0; i < state.map.building.length; i++) {
    const id = state.map.building[i]!;
    if (id && !state.buildings[id]) {
      out.push(`map.building[${i}] -> missing building ${id}`);
      break;
    }
  }
  for (const id in state.vehicles) {
    const v = state.vehicles[id]!;
    scanStock(v.cargo, `vehicle#${id}.cargo`, out);
    if (!state.companies[v.owner]) out.push(`vehicle#${id}: unknown owner ${v.owner}`);
    if (v.routeId && !state.routes[v.routeId]) out.push(`vehicle#${id}: missing route ${v.routeId}`);
    let load = 0;
    for (const p in v.cargo) load += v.cargo[p]!.qty;
    if (load > v.capacity + 1e-3) out.push(`vehicle#${id}: cargo ${load} > capacity ${v.capacity}`);
  }
  for (const id in state.routes) {
    const r = state.routes[id]!;
    for (const vid of r.vehicleIds) if (!state.vehicles[vid]) out.push(`route#${id}: missing vehicle ${vid}`);
  }
  for (const id in state.cities) {
    const c = state.cities[id]!;
    for (const k of ['poor', 'middle', 'rich'] as const) if (c.population[k] < 0) out.push(`city#${id}.population.${k}=${c.population[k]}`);
    for (const p in c.demand) if (c.demand[p]!.monthly < 0) out.push(`city#${id}.demand.${p}.monthly<0`);
  }
  for (const p in state.market.products) {
    const m = state.market.products[p]!;
    if (m.price <= 0) out.push(`market.${p}.price=${m.price}`);
  }
  for (let i = 0; i < state.map.pollution.length; i++) {
    if (state.map.pollution[i]! < -1e-3) {
      out.push(`map.pollution[${i}]=${state.map.pollution[i]}`);
      break;
    }
  }
  return out;
}

/** Money conservation: for consecutive closed months Σ ledger == Δ cashEnd (± rounding). */
export function checkLedgers(state: GameState, tolerance = 1): string[] {
  const out: string[] = [];
  for (const c of Object.values(state.companies)) {
    const h = c.finances.history;
    for (let i = 1; i < h.length; i++) {
      const m = h[i]!;
      let sum = 0;
      for (const k in m.ledger) sum += m.ledger[k as keyof typeof m.ledger] ?? 0;
      const delta = m.cashEnd - h[i - 1]!.cashEnd;
      if (Math.abs(sum - delta) > tolerance + Math.abs(delta) * 1e-9)
        out.push(`${c.name} ${m.year}-${m.month}: ledger ${sum.toFixed(2)} != Δcash ${delta.toFixed(2)}`);
    }
  }
  return out;
}

/** Compact digest of the state (for determinism / save-load continuation checks). */
export function digest(state: GameState): string {
  const parts: string[] = [`t${state.time.tick}`, `r${state.rng.s}`];
  for (const c of Object.values(state.companies).sort((a, b) => a.id - b.id)) parts.push(`c${c.id}:${c.cash.toFixed(2)}`);
  parts.push(`b${Object.keys(state.buildings).length}`, `v${Object.keys(state.vehicles).length}`, `rt${Object.keys(state.routes).length}`);
  for (const v of Object.values(state.vehicles).sort((a, b) => a.id - b.id)) parts.push(`${v.id}@${v.x.toFixed(3)},${v.y.toFixed(3)}`);
  for (const c of Object.values(state.cities).sort((a, b) => a.id - b.id))
    parts.push(`city${c.id}:${(c.population.poor + c.population.middle + c.population.rich).toFixed(2)}`);
  return parts.join('|');
}
