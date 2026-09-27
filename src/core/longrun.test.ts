/**
 * Long-run integration QA: every simulation module together (world, economy,
 * logistics, ai, game) over many game years, with a scripted "reasonable
 * player" (src/ai/scripted.ts) and 3 AI rivals.
 *
 * CI variant (always): 128×128 / 96×96 maps, ~30 game years in total incl.
 * calendar fast-forward through all 5 eras, save→load determinism, unlock
 * gating and a balance smoke check. ~25 s.
 *
 * Long variant (IG3_LONG=1 npx vitest run src/core/longrun): 256×256 game
 * 1850 → 2030 (180 years), balance matrix easy/normal/hard × 2 seeds and a
 * performance probe (≈300 vehicles). Several minutes.
 *
 * Invariants checked (see core/qa.ts): no exceptions (sim.throwOnError), no
 * NaN/Infinity anywhere in the state, no negative stock / quality outside 0..1,
 * dangling references, ledger == cash delta per closed month, vehicles never
 * stuck for a year, cities neither collapse nor explode, market prices within
 * sane bands of base × priceIndex.
 */
import { describe, expect, it } from 'vitest';
import { createScriptedPlayer, scriptedPlayerDay, type ScriptedPlayer } from '../ai/scripted';
import { BALANCE_TARGETS as T } from '../economy/balance';
import { PRICE_INDEX_BY_ERA } from '../economy/constants';
import type { GameContext } from './context';
import { cityPopulation } from './entities';
import { startLoadedGame, startNewGame } from './lifecycle';
import { checkLedgers, createSimContext, digest, scanState } from './qa';
import { deserializeState, serializeState } from './save';
import type { Difficulty, GameState } from './types';

const LONG = !!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.IG3_LONG;

interface Watch {
  /** vehicle id → [x, y, totalDelivered, day first seen in this position] */
  veh: Map<number, [number, number, number, number]>;
  pop0: Map<number, number>;
  problems: string[];
}

function watch(state: GameState): Watch {
  const w: Watch = { veh: new Map(), pop0: new Map(), problems: [] };
  for (const c of Object.values(state.cities)) w.pop0.set(c.id, cityPopulation(c));
  return w;
}

/** Monthly checks: stuck vehicles (same tile, nothing delivered, for a year). */
function checkVehicles(state: GameState, w: Watch): void {
  const today = state.time.totalDays;
  for (const v of Object.values(state.vehicles)) {
    const route = v.routeId ? state.routes[v.routeId] : undefined;
    const active = route && route.enabled && v.status !== 'idle' && v.status !== 'stopped' && v.status !== 'depot';
    const prev = w.veh.get(v.id);
    if (!active || !prev || prev[0] !== v.x || prev[1] !== v.y || prev[2] !== v.stats.totalDelivered) {
      w.veh.set(v.id, [v.x, v.y, v.stats.totalDelivered, today]);
      continue;
    }
    // a surplus vehicle waiting on a route that still moves goods is backpressure, not a bug
    const routeMoves = (route.stats.throughputHistory ?? []).slice(-12).some((u) => u > 0);
    if (today - prev[3] >= 360 && !routeMoves) {
      w.problems.push(`vehicle #${v.id} (${v.typeId}, owner ${v.owner}) stuck '${v.status}' at ${v.x},${v.y} since day ${prev[3]}`);
      w.veh.set(v.id, [v.x, v.y, v.stats.totalDelivered, today]); // report once per year
    }
  }
  for (const id of [...w.veh.keys()]) if (!state.vehicles[id]) w.veh.delete(id);
}

/** Yearly checks: structural invariants, ledgers, cities, prices. */
function checkYear(ctx: GameContext, state: GameState, w: Watch): void {
  const tag = `${state.time.year}-${state.time.month}`;
  for (const p of scanState(state)) w.problems.push(`${tag} ${p}`);
  for (const p of checkLedgers(state)) w.problems.push(`${tag} ${p}`);
  for (const c of Object.values(state.cities)) {
    const pop = cityPopulation(c);
    const p0 = w.pop0.get(c.id) ?? pop;
    if (pop < 50 || pop < p0 * 0.2) w.problems.push(`${tag} city ${c.name} collapsed: ${Math.round(p0)} → ${Math.round(pop)}`);
    if (pop > 2_000_000) w.problems.push(`${tag} city ${c.name} exploded: ${Math.round(pop)}`);
  }
  const pi = state.market.priceIndex;
  const ratios: number[] = [];
  for (const [id, m] of Object.entries(state.market.products)) {
    const base = ctx.data.products[id]?.basePrice ?? m.basePrice;
    const r = m.price / (base * pi);
    ratios.push(r);
    if (!(r >= T.priceBand[0] && r <= T.priceBand[1])) w.problems.push(`${tag} price of ${id} out of band: ${r.toFixed(2)}× base×index`);
  }
  ratios.sort((a, b) => a - b);
  const median = ratios[ratios.length >> 1] ?? 1;
  if (median < 0.6 || median > 1.5) w.problems.push(`${tag} median price ratio ${median.toFixed(2)}`);
  const errs = ctx.sim.systems().filter((s) => s.errors > 0);
  for (const s of errs) w.problems.push(`${tag} system ${s.name}: ${s.errors} errors`);
}

/** Advance `days` days with the scripted player acting daily and checks running. */
function run(ctx: GameContext, days: number, w: Watch, player: ScriptedPlayer | null): void {
  const state = ctx.state;
  for (let d = 0; d < days; d++) {
    ctx.sim.advanceDays(1);
    if (player) scriptedPlayerDay(ctx, player);
    if (state.time.day === 1) {
      checkVehicles(state, w);
      if (state.time.month === 1) checkYear(ctx, state, w);
    }
  }
}

const aiCompanies = (s: GameState) => Object.values(s.companies).filter((c) => c.ai);
const avgProfit = (months: { profit: number }[]): number => (months.length ? months.reduce((s, m) => s + m.profit, 0) / months.length : 0);

// ============================================================================
describe('long-run integration', () => {
  it('128×128, 3 rivals + scripted player, 8 years: invariants hold, economy alive', () => {
    const ctx = createSimContext();
    const state = startNewGame(ctx, { seed: 1234, mapWidth: 128, mapHeight: 128, rivals: 3, difficulty: 'normal' });
    const w = watch(state);
    const p = createScriptedPlayer(ctx, { maxChains: 6 });
    run(ctx, 8 * 360, w, p);
    expect(w.problems).toEqual([]);
    const player = state.companies[state.playerCompanyId]!;
    expect(player.bankrupt).toBe(false);
    expect(p.chains.length).toBeGreaterThanOrEqual(5);
    // every rival is still in business and actually built something
    for (const c of aiCompanies(state)) {
      expect(c.bankrupt, c.name).toBe(false);
      expect(Object.values(state.buildings).filter((b) => b.owner === c.id).length, c.name).toBeGreaterThan(4);
    }
    expect(Object.keys(state.vehicles).length).toBeGreaterThan(60);
  }, 60_000);

  it('fast-forward through all eras (1850 → 2020+) keeps every system sane', () => {
    const ctx = createSimContext();
    const state = startNewGame(ctx, { seed: 77, mapWidth: 96, mapHeight: 96, rivals: 3, difficulty: 'normal' });
    const w = watch(state);
    const p = createScriptedPlayer(ctx, { maxChains: 12, chainEveryMonths: 6 });
    const eras: string[] = [];
    ctx.bus.on('era:changed', ({ eraId }) => eras.push(eraId));
    run(ctx, 3 * 360, w, p);
    // jump the calendar to the eve of each new era (as if decades passed), then live 2 years in it
    for (const year of [1899, 1949, 1989, 2019]) {
      state.time.year = year;
      run(ctx, 2 * 360, w, p);
    }
    expect(eras).toEqual(['electric', 'mass', 'modern', 'digital']);
    expect(w.problems).toEqual([]);
    expect(state.market.priceIndex).toBeGreaterThan(PRICE_INDEX_BY_ERA[3]); // approaching the digital-era level
    const player = state.companies[state.playerCompanyId]!;
    expect(player.bankrupt).toBe(false);
    // later-era content is unlocked by the calendar (tech-gated content needs research time)
    expect(ctx.services.economy.isUnlocked(player.id, 'product', 'software')).toBe(true);
    expect(ctx.services.economy.isUnlocked(player.id, 'vehicle', 'truck_semi')).toBe(true);
    // everybody kept researching through the jumps
    for (const c of Object.values(state.companies)) expect(Object.keys(c.research.unlocked).length, c.name).toBeGreaterThanOrEqual(8);
  }, 60_000);

  it('save → load mid-game continues bit-identically', () => {
    const ctx = createSimContext();
    const state = startNewGame(ctx, { seed: 2024, mapWidth: 96, mapHeight: 96, rivals: 3, difficulty: 'hard' });
    ctx.sim.advanceDays(900.3); // mid-day save
    ctx.bus.emit('game:beforeSave', { state });
    const json = serializeState(state);
    const trace: string[] = [];
    for (let i = 0; i < 300; i++) {
      ctx.sim.advanceDays(1);
      trace.push(digest(state));
    }
    const ctx2 = createSimContext();
    const loaded = deserializeState(json);
    startLoadedGame(ctx2, loaded);
    let firstDiff = -1;
    for (let i = 0; i < 300; i++) {
      ctx2.sim.advanceDays(1);
      if (firstDiff < 0 && digest(loaded) !== trace[i]) firstDiff = i;
    }
    expect(firstDiff).toBe(-1);
    expect(serializeState(loaded).length).toBeGreaterThan(1000);
  }, 60_000);

  it('unlock gating: era/tech-locked vehicles, buildings and research are refused', () => {
    const ctx = createSimContext();
    const state = startNewGame(ctx, { seed: 5, mapWidth: 64, mapHeight: 64, rivals: 0 });
    const pid = state.playerCompanyId;
    const E = ctx.services.economy;
    expect(E.isUnlocked(pid, 'vehicle', 'horse_cart')).toBe(true);
    expect(E.isUnlocked(pid, 'vehicle', 'truck_diesel')).toBe(false); // mass era + tech
    expect(E.isUnlocked(pid, 'vehicle', 'steam_wagon')).toBe(false); // needs steam_power
    expect(E.isUnlocked(pid, 'building', 'car_factory')).toBe(false);
    expect(ctx.services.logistics.buyVehicle(pid, 'truck_diesel', null).ok).toBe(false);
    expect(E.startResearch(pid, 'robotics').ok).toBe(false); // prerequisites missing
    let placed = false;
    for (let y = 2; y < 60 && !placed; y += 4) for (let x = 2; x < 60 && !placed; x += 4) placed = E.build(pid, 'car_factory', x, y, 0).ok;
    expect(placed).toBe(false);
    // researching steam_power unlocks the steam wagon
    state.companies[pid]!.research.unlocked.steam_power = state.time.totalDays;
    ctx.bus.emit('research:completed', { companyId: pid, techId: 'steam_power' });
    ctx.bus.emit('era:changed', { eraId: state.time.eraId, previous: state.time.eraId });
    expect(E.isUnlocked(pid, 'vehicle', 'steam_wagon')).toBe(true);
  });

  it('balance (normal): first chain profitable within ~5 months; 5 chains out-earn the average rival by year 12 (company value)', () => {
    const r = balanceRun('normal', 1234, T.playerVsAverageRivalYear, 5);
    expect(r.firstProfitMonth).toBeGreaterThan(0);
    expect(r.firstProfitMonth).toBeLessThanOrEqual(T.firstChainProfitMonths);
    expect(r.playerBankrupt).toBe(false);
    expect(r.aiBankrupt).toEqual([]);
    // "out-earns" = more accumulated earnings (company value); monthly profit at least comparable
    expect(r.playerValue).toBeGreaterThan(r.aiAvgValue * 1.2);
    expect(r.playerProfit).toBeGreaterThan(r.aiAvgProfit * 0.8);
    // rivals are not passive: each keeps building (no 3-year pause) and makes money
    expect(r.maxAiIdleDays).toBeLessThan(T.maxRivalIdleDays);
    expect(r.aiAvgProfit).toBeGreaterThan(0);
    expect(r.problems).toEqual([]);
  }, 60_000);
});

// ============================================================================
interface BalanceResult {
  firstProfitMonth: number;
  playerProfit: number;
  playerValue: number;
  playerBankrupt: boolean;
  aiAvgProfit: number;
  aiBestProfit: number;
  aiAvgValue: number;
  aiBankrupt: string[];
  maxAiIdleDays: number;
  problems: string[];
}

/** Scripted player (maxChains) vs 3 rivals for `years`; profits = 24-month average at the end. */
function balanceRun(difficulty: Difficulty, seed: number, years: number, chains: number, size = 128): BalanceResult {
  const ctx = createSimContext();
  const state = startNewGame(ctx, { seed, mapWidth: size, mapHeight: size, rivals: 3, difficulty });
  const w = watch(state);
  const p = createScriptedPlayer(ctx, { maxChains: chains });
  const player = state.companies[state.playerCompanyId]!;
  const lastBuild: Record<number, number> = {};
  const aiBankrupt: string[] = [];
  let maxIdle = 0;
  let firstProfitMonth = -1;
  ctx.bus.on('building:built', ({ buildingId }) => {
    const b = state.buildings[buildingId];
    if (b) lastBuild[b.owner] = state.time.totalDays;
  });
  // expansions (building upgrades) count as activity too
  const levels: Record<number, number> = {};
  ctx.bus.on('building:changed', ({ buildingId }) => {
    const b = state.buildings[buildingId];
    if (!b) return;
    if (b.level > (levels[b.id] ?? 1)) lastBuild[b.owner] = state.time.totalDays;
    levels[b.id] = b.level;
  });
  ctx.bus.on('company:bankrupt', ({ companyId }) => {
    const c = state.companies[companyId];
    if (c?.ai) aiBankrupt.push(`${c.name} ${state.time.year}-${state.time.month}`);
  });
  for (let m = 0; m < years * 12; m++) {
    run(ctx, 30, w, p);
    if (firstProfitMonth < 0 && m > 0 && (player.finances.history.at(-1)?.profit ?? 0) > 0) firstProfitMonth = player.finances.history.length;
    for (const c of aiCompanies(state)) if (!c.bankrupt) maxIdle = Math.max(maxIdle, state.time.totalDays - (lastBuild[c.id] ?? 0));
  }
  const ais = aiCompanies(state);
  const profits = ais.map((c) => avgProfit(c.finances.history.slice(-24)));
  return {
    firstProfitMonth,
    playerProfit: avgProfit(player.finances.history.slice(-24)),
    playerValue: player.finances.valuation,
    playerBankrupt: player.bankrupt,
    aiAvgProfit: profits.reduce((s, v) => s + v, 0) / Math.max(1, profits.length),
    aiBestProfit: Math.max(...profits),
    aiAvgValue: ais.reduce((s, c) => s + c.finances.valuation, 0) / Math.max(1, ais.length),
    aiBankrupt,
    maxAiIdleDays: maxIdle,
    problems: w.problems,
  };
}

// ============================================================================
describe.skipIf(!LONG)('long-run (IG3_LONG=1)', () => {
  it('256×256 long game (1850 → 2030) with 3 rivals and a scripted player', () => {
    const ctx = createSimContext();
    const state = startNewGame(ctx, { seed: 31337, mapWidth: 256, mapHeight: 256, rivals: 3, difficulty: 'normal', cityCount: 8 });
    const w = watch(state);
    const p = createScriptedPlayer(ctx, { maxChains: 25, chainEveryMonths: 6 });
    const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
    const endYear = 1850 + Number(env.IG3_YEARS ?? 180);
    for (let y = 1850; y < endYear; y += 10) {
      const t0 = performance.now();
      run(ctx, 10 * 360, w, p);
      const pl = state.companies[state.playerCompanyId]!;
      console.log(
        `[longrun] ${state.time.year} ${state.time.eraId} ${((performance.now() - t0) / 3600).toFixed(2)} ms/day ` +
          `buildings ${Object.keys(state.buildings).length} vehicles ${Object.keys(state.vehicles).length} ` +
          `pop ${Math.round(Object.values(state.cities).reduce((s, c) => s + cityPopulation(c), 0))} priceIndex ${state.market.priceIndex} ` +
          `player ${Math.round(pl.cash)} (${Math.round(avgProfit(pl.finances.history.slice(-12)))}/m) ` +
          aiCompanies(state)
            .map((c) => `${c.ai!.personality}:${Math.round(c.cash)}${c.bankrupt ? '†' : ''}`)
            .join(' '),
      );
    }
    expect(w.problems.slice(0, 20)).toEqual([]);
    expect(state.time.year).toBeGreaterThanOrEqual(endYear);
  }, 1_800_000);

  it('balance matrix: easy / normal / hard × 2 seeds, 15 years', () => {
    for (const diff of ['easy', 'normal', 'hard'] as const)
      for (const seed of [1234, 99]) {
        const r = balanceRun(diff, seed, 15, 5);
        console.log(`[balance] ${diff} seed ${seed}`, JSON.stringify({ ...r, problems: r.problems.length }));
        expect(r.problems).toEqual([]);
        expect(r.playerBankrupt).toBe(false);
        expect(r.firstProfitMonth).toBeLessThanOrEqual(6);
        if (diff !== 'hard') expect(r.playerValue).toBeGreaterThan(r.aiAvgValue);
        if (diff === 'easy') expect(r.aiBestProfit).toBeLessThan(r.playerProfit);
        if (diff === 'hard') expect(r.aiBestProfit).toBeGreaterThan(r.playerProfit * 0.8); // competitive
      }
  }, 1_800_000);

  it('performance: 256×256, 12 cities, 3 rivals, ~300 vehicles — ms per tick', () => {
    const ctx = createSimContext();
    const state = startNewGame(ctx, { seed: 4321, mapWidth: 256, mapHeight: 256, rivals: 3, difficulty: 'hard', cityCount: 8 });
    const p = createScriptedPlayer(ctx, { maxChains: 30, chainEveryMonths: 2, maxVehiclesPerLink: 6, reserve: 10000 });
    state.companies[state.playerCompanyId]!.cash += 3_000_000; // fill the map quickly
    for (let d = 0; d < 360 * 12 && Object.keys(state.vehicles).length < 300; d++) {
      ctx.sim.advanceDays(1);
      scriptedPlayerDay(ctx, p);
    }
    const ticks: number[] = [];
    for (let d = 0; d < 180; d++) {
      for (let t = 0; t < 10; t++) {
        const a = performance.now();
        ctx.sim.step(1);
        ticks.push(performance.now() - a);
      }
      scriptedPlayerDay(ctx, p);
    }
    ticks.sort((a, b) => a - b);
    const avg = ticks.reduce((s, x) => s + x, 0) / ticks.length;
    console.log(
      `[perf] cities ${Object.keys(state.cities).length} vehicles ${Object.keys(state.vehicles).length} buildings ${Object.keys(state.buildings).length}: ` +
        `avg ${avg.toFixed(3)} ms/tick, p99 ${ticks[Math.floor(ticks.length * 0.99)]!.toFixed(2)}, max ${ticks.at(-1)!.toFixed(2)} ms`,
    );
    expect(Object.keys(state.vehicles).length).toBeGreaterThanOrEqual(250);
    expect(avg).toBeLessThan(T.msPerTickAvg);
    expect(ticks.at(-1)!).toBeLessThan(T.msPerTickMax);
  }, 1_800_000);
});
