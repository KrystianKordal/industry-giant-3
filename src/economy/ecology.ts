/**
 * Ecology.
 *
 * Daily ('ecology' system): emissions queued by production are spread onto
 * map.pollution around each building (radius POLLUTION_RADIUS), then the whole
 * map decays by ecology.pollutionDecay.
 *
 * Monthly (economy month close, BEFORE cities reset their accumulators):
 *  - emission tax: (ecology.carbonTax + active 'carbonTax' regulations + event
 *    effect "carbonTax") × company.emissionsMonth → 'emissionTax'
 *  - emission cap regulations → 'fines' for the excess
 *  - company.ecoRating (emissions vs green buildings/products), company.reputation
 *    (eco rating, product quality, shop supply, debt, HQ)
 *  - city.opinion[company] (jobs, supply share, nearby pollution, eco rating) and
 *    city.permits[company]: opinion < −40 → 'denied', < −10 or reputation < 20 → 'restricted'
 *    (restricted = only buildings with pollution ≤ 2 inside the city area; see service checkPlacement)
 *  - emissionsHistory, ecology.co2History, awareness
 */
import type { GameContext } from '../core/context';
import { addMoney } from '../core/money';
import { notify } from '../core/notify';
import type { Company, GameState } from '../core/types';
import { clamp, pushHistory } from '../core/util';
import { POLLUTION_RADIUS, POLLUTION_SCALE } from './constants';
import { econExt } from './ext';
import { policyAdditive, regulationActive } from './modifiers';
import { pendingEmissions } from './production';

// ---------------------------------------------------------------- daily
export function ecologyDailySystem(state: GameState, _dt: number, _ctx: GameContext): void {
  const map = state.map;
  const W = map.width;
  const H = map.height;
  for (const [bid, e] of pendingEmissions) {
    const b = state.buildings[bid];
    if (!b || e <= 0) continue;
    const cx = b.x + (b.w - 1) / 2;
    const cy = b.y + (b.h - 1) / 2;
    const R = POLLUTION_RADIUS + Math.max(b.w, b.h) / 2;
    const x0 = Math.max(0, Math.floor(cx - R));
    const x1 = Math.min(W - 1, Math.ceil(cx + R));
    const y0 = Math.max(0, Math.floor(cy - R));
    const y1 = Math.min(H - 1, Math.ceil(cy + R));
    let wsum = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= R) wsum += 1 / (1 + d * d * 0.5);
    }
    if (wsum <= 0) continue;
    const amount = e * POLLUTION_SCALE * 20; // steel mill (25/mo) → ~130 at its center at equilibrium (decay 1%/day)
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > R) continue;
      const i = y * W + x;
      map.pollution[i] = Math.min(1000, map.pollution[i]! + (amount * (1 / (1 + d * d * 0.5))) / wsum);
    }
  }
  pendingEmissions.clear();
  const keep = 1 - clamp(state.ecology.pollutionDecay, 0, 1);
  const p = map.pollution;
  for (let i = 0; i < p.length; i++) {
    const v = p[i]!;
    if (v === 0) continue;
    const n = v * keep;
    p[i] = n < 0.01 ? 0 : n;
  }
}

// ---------------------------------------------------------------- monthly
/**
 * Allowed monthly emissions for a company under active 'emissionCap' rules
 * (null = no cap). Values < 5 are relative to the company's baseline (average of
 * the 6 months before the rule started, remembered in ext), otherwise absolute units.
 */
function emissionCapFor(state: GameState, c: Company): number | null {
  const ext = econExt(state);
  let cap: number | null = null;
  for (const r of state.ecology.regulations ?? []) {
    if (r.kind !== 'emissionCap' || !regulationActive(state, r) || !Number.isFinite(r.value)) continue;
    let allowed: number;
    if (r.value < 5) {
      const base = (ext.capBaseline[r.id] ??= {});
      if (base[c.id] === undefined) {
        const h = c.emissionsHistory.slice(-6);
        base[c.id] = h.length ? h.reduce((a, v) => a + v, 0) / h.length : c.emissionsMonth;
      }
      allowed = r.value * base[c.id]!;
    } else allowed = r.value;
    cap = cap === null ? allowed : Math.min(cap, allowed);
  }
  return cap;
}

/** Carbon tax (zł per emission unit) for a company: ecology.carbonTax + regulations/events. */
export function carbonTaxRate(state: GameState, companyId = 0): number {
  return Math.max(0, (state.ecology.carbonTax || 0) + policyAdditive(state, 'carbonTax', 'carbonTax', null, companyId));
}

function greenScore(ctx: GameContext, company: Company): number {
  let s = 0;
  for (const id in ctx.state.buildings) {
    const b = ctx.state.buildings[id]!;
    if (b.owner !== company.id || b.constructionProgress < 1 || !b.enabled) continue;
    const def = ctx.data.buildings[b.typeId];
    if (!def?.green) continue;
    s += def.category === 'energy' ? 6 : 4;
  }
  return s;
}

/** Month close: taxes/fines booked into the closing month, ratings, permits. */
export function closeEcologyMonth(state: GameState, ctx: GameContext): void {
  const eco = state.ecology;
  const ext = econExt(state);
  const eraIdx = Math.max(0, ctx.data.eraIndex(state.time.eraId));
  const companies = Object.values(state.companies).sort((a, z) => a.id - z.id);

  for (const c of companies) {
    const em = c.emissionsMonth;
    // taxes & fines
    const rate = carbonTaxRate(state, c.id);
    if (rate > 0 && em > 0 && !c.bankrupt) addMoney(ctx, c.id, -Math.round(em * rate * 100) / 100, 'emissionTax');
    const cap = emissionCapFor(state, c);
    if (cap !== null && em > cap + 0.5 && !c.bankrupt) {
      const fine = Math.round((em - cap) * 10 * 100) / 100;
      addMoney(ctx, c.id, -fine, 'fines');
      notify(ctx, { level: 'warning', icon: '🏭', title: 'Kara za przekroczenie norm emisji', text: `Przekroczono limit emisji o ${Math.round(em - cap)} jedn.`, companyId: c.id, category: 'finance' });
    }
    // eco rating
    const green = greenScore(ctx, c);
    const pollutionPenalty = 18 * Math.log10(1 + em / 8) * (0.6 + eco.awareness);
    const ecoTarget = clamp(75 - pollutionPenalty + Math.min(25, green), 0, 100);
    c.ecoRating = Math.round((c.ecoRating + (ecoTarget - c.ecoRating) * 0.25) * 10) / 10;

    // reputation
    const sq = ext.salesQ[c.id];
    const avgQ = sq && sq[0] > 0 ? sq[1] / sq[0] : 0.5;
    let shops = 0;
    let stocked = 0;
    let hq = false;
    let prestige = 0;
    for (const id in state.buildings) {
      const b = state.buildings[id]!;
      if (b.owner !== c.id || b.constructionProgress < 1) continue;
      const def = ctx.data.buildings[b.typeId];
      if (def?.category === 'shop') {
        shops++;
        if (b.status === 'ok') stocked++;
      }
      if (def?.category === 'hq' && !def.prestige) hq = true;
      if (def?.prestige) prestige += def.prestige;
    }
    const supply = shops > 0 ? stocked / shops : 0.5;
    const repTarget = clamp(
      45 + (15 * (c.ecoRating - 50)) / 50 + (avgQ - 0.5) * 40 + (supply - 0.5) * 20 - c.monthsInDebt * 6 + (hq ? 6 : 0) + prestige,
      0,
      100,
    );
    c.reputation = Math.round((c.reputation + (repTarget - c.reputation) * 0.2) * 10) / 10;

    pushHistory(c.emissionsHistory, Math.round(em * 10) / 10);
  }

  // opinions & permits
  for (const city of Object.values(state.cities)) {
    const workforce = Math.max(1, city.labour.workforce);
    let totalSupplied = 0;
    const suppliedBy: Record<number, number> = {};
    for (const d of Object.values(city.demand)) {
      for (const [k, v] of Object.entries(d.shareByCompany)) {
        suppliedBy[Number(k)] = (suppliedBy[Number(k)] ?? 0) + v;
        totalSupplied += v;
      }
    }
    for (const c of companies) {
      let jobs = 0;
      let nearbyPollution = 0;
      for (const id in state.buildings) {
        const b = state.buildings[id]!;
        if (b.owner !== c.id) continue;
        if (b.workers.sourceCityId === city.id) jobs += b.workers.employed;
        const def = ctx.data.buildings[b.typeId];
        if (!def?.pollution || b.status !== 'ok') continue;
        const d = Math.hypot(b.x + b.w / 2 - city.x, b.y + b.h / 2 - city.y) - city.radius;
        if (d < 12) nearbyPollution += def.pollution * (1 - Math.max(0, d) / 12);
      }
      const involved = jobs > 0 || nearbyPollution > 0 || (suppliedBy[c.id] ?? 0) > 0 || city.opinion[c.id] !== undefined;
      if (!involved) continue;
      const jobsScore = Math.min(25, (100 * jobs) / workforce);
      const supplyScore = totalSupplied > 0 ? 25 * ((suppliedBy[c.id] ?? 0) / totalSupplied) : 0;
      const pollScore = -Math.min(70, nearbyPollution * (0.8 + city.greenPreference));
      const ecoScore = (c.ecoRating - 50) * 0.3;
      const target = clamp(10 + jobsScore + supplyScore + pollScore + ecoScore, -100, 100);
      const prev = city.opinion[c.id] ?? 0;
      const next = Math.round((prev + (target - prev) * 0.3) * 10) / 10;
      city.opinion[c.id] = next;
      const before = city.permits[c.id] ?? 'granted';
      const permit = next < -40 ? 'denied' : next < -10 || c.reputation < 20 ? 'restricted' : 'granted';
      if (permit === 'granted') delete city.permits[c.id];
      else city.permits[c.id] = permit;
      if (permit !== before && c.isPlayer) {
        if (permit === 'denied')
          notify(ctx, { level: 'danger', icon: '🚫', title: `${city.name} odmawia pozwoleń`, text: 'Opinia mieszkańców jest bardzo zła (zanieczyszczenia). Nie zbudujesz tu nic nowego.', target: { kind: 'city', id: city.id }, companyId: c.id, category: 'city' });
        else if (permit === 'restricted')
          notify(ctx, { level: 'warning', icon: '⚠️', title: `${city.name} ogranicza pozwolenia`, text: 'W obrębie miasta możesz stawiać tylko nieuciążliwe budynki.', target: { kind: 'city', id: city.id }, companyId: c.id, category: 'city' });
        else notify(ctx, { level: 'success', icon: '✅', title: `${city.name} znów wydaje pozwolenia`, companyId: c.id, category: 'city' });
      }
    }
  }

  // global
  pushHistory(eco.co2History, Math.round(eco.co2Month * 10) / 10);
  const awarenessTarget = clamp(0.05 + 0.15 * eraIdx + Math.min(0.2, eco.co2Month / 20000), 0, 1);
  eco.awareness = Math.round((eco.awareness + (awarenessTarget - eco.awareness) * 0.05) * 1000) / 1000;
  for (const id of Object.keys(ext.capBaseline)) if (!(eco.regulations ?? []).some((r) => r.id === id)) delete ext.capBaseline[id];
  eco.co2Month = 0;
  for (const c of companies) c.emissionsMonth = 0;
  ext.salesQ = {};
}
