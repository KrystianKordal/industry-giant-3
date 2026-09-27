/**
 * World events (daily system 'events'): natural disasters and political /
 * economic events. Events are written to state.events.active (WorldEvent) with
 * `effects` that other modules read (see docs/CONTRACTS.md "Świat — API"):
 *
 *   multiplicative (1 = neutral):
 *     efficiency.farm | efficiency.all   production efficiency in scope (strike: companyId + cityId)
 *     speed.water | speed.road | speed.rail | speed.air   (0 = blocked)
 *     demand.all | demand.<productId> | demand.<category> (applied by world to city demand)
 *     price.all | price.<productId>      market price multiplier (economy)
 *     economy                            global economic climate (economy may fold into market.economyFactor)
 *     growth, wages.all                  city growth / wages (applied by world)
 *     emissionCap                        allowed emissions multiplier (economy/ecology)
 *   additive:
 *     satisfaction                       city satisfaction delta (world)
 *     carbonTax                          zł per CO2 unit (economy); also mirrored as a Regulation
 *     subsidy.<productId>                fraction of sale revenue paid as subsidy (economy)
 *
 * Direct damage (earthquake/flood/fire): building.condition lowered (+ building:changed),
 * road tiles get TileFlag.Damaged until auto-repair (ext.world.repairs), forests burn.
 */
import type { GameContext } from '../core/context';
import { MAX_EVENT_HISTORY } from '../core/constants';
import { cityPopulation } from '../core/entities';
import { notify } from '../core/notify';
import { rng, type Rng } from '../core/rng';
import {
  Terrain,
  TileFlag,
  type Building,
  type City,
  type Difficulty,
  type GameState,
  type Regulation,
  type WorldEvent,
  type WorldEventKind,
} from '../core/types';
import { clamp, newId } from '../core/util';
import { ChangeSet } from './changes';
import { refreshCityDemand } from './cities';
import { worldExt } from './ext';
import { isWaterTerrain } from './mapinfo';

const FREQ: Record<Difficulty, number> = { easy: 0.7, normal: 1, hard: 1.4 };
const SEVERITY: Record<Difficulty, number> = { easy: 0.75, normal: 1, hard: 1.25 };

/**
 * Destructive disasters (damage, crop loss, casualties). None during the grace
 * period at the start of a game (months: easy 24 / normal 12 / hard 6) and, on
 * easy/normal, rarer than other events (roll kept with DESTRUCTIVE_FREQ,
 * cooldowns stretched by 1 / DESTRUCTIVE_FREQ).
 */
export const DESTRUCTIVE_KINDS: readonly WorldEventKind[] = ['storm', 'flood', 'earthquake', 'fire', 'drought', 'epidemic'];
export const GRACE_DAYS: Record<Difficulty, number> = { easy: 24 * 30, normal: 12 * 30, hard: 6 * 30 };
export const DESTRUCTIVE_FREQ: Record<Difficulty, number> = { easy: 0.5, normal: 0.55, hard: 1 };
/** A drought lasts at least this many days (no "Susza" + "Koniec: Susza" a few days apart). */
export const DROUGHT_MIN_DAYS = 20;

const isDestructive = (kind: WorldEventKind): boolean => DESTRUCTIVE_KINDS.includes(kind);
/** True while destructive disasters are suppressed (start of the game). */
export function inGracePeriod(state: GameState): boolean {
  return state.time.totalDays < (GRACE_DAYS[state.settings.difficulty] ?? GRACE_DAYS.normal);
}

const COOLDOWN: Partial<Record<WorldEventKind, number>> = {
  storm: 60,
  flood: 180,
  earthquake: 360,
  fire: 90,
  heatwave: 300,
  blizzard: 300,
  drought: 240,
  strike: 120,
  boom: 720,
  recession: 720,
  priceShock: 120,
  subsidy: 240,
  carbonTax: 1080,
  emissionNorm: 1080,
  epidemic: 360,
  festival: 90,
};

type Category = 'disaster' | 'political';

interface Template {
  kind: WorldEventKind;
  category: Category;
  weight(state: GameState, ctx: GameContext): number;
  /** Create & apply; return null if not applicable right now. */
  create(state: GameState, ctx: GameContext, r: Rng): WorldEvent | null;
}

// ============================================================================
// helpers
// ============================================================================

function baseEvent(state: GameState, kind: WorldEventKind, days: number, p: Partial<WorldEvent>): WorldEvent {
  return {
    id: newId(state, 'event'),
    kind,
    title: '',
    description: '',
    icon: '⚠️',
    startDay: state.time.totalDays,
    endDay: state.time.totalDays + Math.max(1, Math.round(days)),
    area: null,
    regionIds: [],
    cityId: 0,
    productId: null,
    companyId: 0,
    magnitude: 1,
    effects: {},
    ...p,
  };
}

const eraIdx = (state: GameState, ctx: GameContext): number => Math.max(0, ctx.data.eraIndex(state.time.eraId));
const cityList = (state: GameState): City[] => Object.values(state.cities).sort((a, b) => a.id - b.id);
const isActive = (state: GameState, kind: WorldEventKind): boolean => state.events.active.some((e) => e.kind === kind);

function nearestCityName(state: GameState, x: number, y: number): string {
  let best: City | null = null;
  let bd = Infinity;
  for (const c of Object.values(state.cities)) {
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best ? best.name : 'nieznanej okolicy';
}

function regionOf(state: GameState, x: number, y: number): number {
  const w = state.weather;
  return Math.min(w.rows - 1, Math.max(0, Math.floor(y / w.regionSize))) * w.cols + Math.min(w.cols - 1, Math.max(0, Math.floor(x / w.regionSize)));
}

function buildingsInRadius(state: GameState, x: number, y: number, radius: number): Building[] {
  return Object.values(state.buildings)
    .filter((b) => Math.hypot(b.x + b.w / 2 - x, b.y + b.h / 2 - y) <= radius + Math.max(b.w, b.h) / 2)
    .sort((a, b) => a.id - b.id);
}

/** Lower building condition; emits building:changed. */
function damageBuilding(ctx: GameContext, b: Building, amount: number): void {
  b.condition = Math.round(clamp(b.condition - amount, 0.05, 1) * 1000) / 1000;
  ctx.bus.emit('building:changed', { buildingId: b.id });
}

/** Damage road/rail tiles (TileFlag.Damaged) until `repairDays` later. Returns count. */
function damageNetwork(state: GameState, tiles: number[], repairDays: number, cs: ChangeSet): number {
  const ext = worldExt(state);
  const W = state.map.width;
  let n = 0;
  for (const i of tiles) {
    if (!state.network.road[i] && !state.network.rail[i]) continue;
    if (state.map.flags[i]! & TileFlag.Damaged) continue;
    state.map.flags[i]! |= TileFlag.Damaged;
    ext.repairs.push({ idx: i, day: state.time.totalDays + repairDays });
    cs.roads.push(i);
    cs.touch(i % W, (i / W) | 0);
    n++;
  }
  if (n) state.network.version++;
  return n;
}

function tilesInDisk(state: GameState, x: number, y: number, radius: number): number[] {
  const out: number[] = [];
  const W = state.map.width;
  const H = state.map.height;
  for (let ty = Math.max(0, Math.floor(y - radius)); ty <= Math.min(H - 1, Math.ceil(y + radius)); ty++)
    for (let tx = Math.max(0, Math.floor(x - radius)); tx <= Math.min(W - 1, Math.ceil(x + radius)); tx++)
      if (Math.hypot(tx - x, ty - y) <= radius) out.push(ty * W + tx);
  return out;
}

function addRegulation(state: GameState, ev: WorldEvent, reg: Omit<Regulation, 'id' | 'sinceDay' | 'untilDay'>): void {
  state.ecology.regulations.push({ ...reg, id: `ev-${ev.id}`, sinceDay: ev.startDay, untilDay: ev.endDay });
}

const days = (n: number): string => `${n} ${n === 1 ? 'dzień' : 'dni'}`;

// ============================================================================
// templates
// ============================================================================

const TEMPLATES: Template[] = [
  {
    kind: 'storm',
    category: 'disaster',
    weight: (s) => (s.time.season === 'autumn' || s.time.season === 'winter' ? 1 : 0.6),
    create(state, ctx, r) {
      // Pick a region with enough water.
      const w = state.weather;
      const map = state.map;
      const cands: { rid: number; x: number; y: number }[] = [];
      for (let rid = 0; rid < w.regions.length; rid++) {
        const rx = (rid % w.cols) * w.regionSize;
        const ry = Math.floor(rid / w.cols) * w.regionSize;
        let water = 0;
        let sx = 0;
        let sy = 0;
        for (let y = ry; y < Math.min(map.height, ry + w.regionSize); y += 2)
          for (let x = rx; x < Math.min(map.width, rx + w.regionSize); x += 2)
            if (isWaterTerrain(map.terrain[y * map.width + x]!)) {
              water++;
              sx += x;
              sy += y;
            }
        if (water >= 12) cands.push({ rid, x: Math.round(sx / water), y: Math.round(sy / water) });
      }
      if (!cands.length) return null;
      const c = r.pick(cands);
      const dur = r.int(3, 7);
      const radius = Math.round(w.regionSize * r.range(0.8, 1.3));
      const region = w.regions[c.rid]!;
      region.kind = 'storm';
      region.daysLeft = dur;
      ctx.bus.emit('weather:changed', {});
      return baseEvent(state, 'storm', dur, {
        title: 'Sztorm',
        icon: '🌊',
        description: `Silny sztorm w pobliżu: ${nearestCityName(state, c.x, c.y)}. Żegluga i loty wstrzymane na ${days(dur)}.`,
        area: { x: c.x, y: c.y, radius },
        regionIds: [c.rid],
        magnitude: r.range(0.6, 1),
        effects: { 'speed.water': 0, 'speed.air': 0, 'speed.road': 0.8 },
      });
    },
  },
  {
    kind: 'flood',
    category: 'disaster',
    weight: (s) => (s.time.season === 'spring' ? 1.1 : s.time.season === 'autumn' ? 0.7 : 0.3),
    create(state, ctx, r) {
      const map = state.map;
      const W = map.width;
      const rivers: number[] = [];
      for (let i = 0; i < map.flags.length; i += 3) if (map.flags[i]! & TileFlag.River) rivers.push(i);
      if (!rivers.length) return null;
      // Prefer river tiles near cities.
      const cities = cityList(state);
      const near = rivers.filter((i) => cities.some((c) => Math.hypot(c.x - (i % W), c.y - ((i / W) | 0)) < 14));
      const i0 = r.pick(near.length ? near : rivers);
      const x = i0 % W;
      const y = (i0 / W) | 0;
      const sev = SEVERITY[state.settings.difficulty];
      const radius = Math.round(r.range(5, 9) * sev);
      const dur = r.int(10, 20);
      const cs = new ChangeSet();
      const tiles = tilesInDisk(state, x, y, radius).filter((t) => {
        const tx = t % W;
        const ty = (t / W) | 0;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            const nx = tx + dx;
            const ny = ty + dy;
            if (nx >= 0 && ny >= 0 && nx < W && ny < map.height && map.flags[ny * W + nx]! & TileFlag.River) return r.chance(0.35 * sev);
          }
        return false;
      });
      const dmg = damageNetwork(state, tiles, r.int(15, 30), cs);
      const hit = buildingsInRadius(state, x, y, radius);
      for (const b of hit) damageBuilding(ctx, b, r.range(0.08, 0.22) * sev);
      cs.flush(ctx);
      return baseEvent(state, 'flood', dur, {
        title: 'Powódź',
        icon: '🌊',
        description: `Rzeka wylała koło: ${nearestCityName(state, x, y)}. Uszkodzone drogi/tory: ${dmg}, budynki: ${hit.length}. Farmy w okolicy tracą plony.`,
        area: { x, y, radius },
        regionIds: [regionOf(state, x, y)],
        magnitude: sev,
        effects: { 'efficiency.farm': 0.5, 'speed.road': 0.7 },
      });
    },
  },
  {
    kind: 'earthquake',
    category: 'disaster',
    weight: () => 0.3,
    create(state, ctx, r) {
      const cities = cityList(state);
      const map = state.map;
      const W = map.width;
      let x: number;
      let y: number;
      if (cities.length && r.chance(0.7)) {
        const c = r.pick(cities);
        x = clamp(c.x + r.int(-8, 8), 0, W - 1);
        y = clamp(c.y + r.int(-8, 8), 0, map.height - 1);
      } else {
        x = r.int(0, W - 1);
        y = r.int(0, map.height - 1);
      }
      const sev = SEVERITY[state.settings.difficulty];
      const radius = Math.round(r.range(5, 9) * sev);
      const cs = new ChangeSet();
      const tiles = tilesInDisk(state, x, y, radius);
      const dmg = damageNetwork(state, tiles.filter(() => r.chance(0.22 * sev)), r.int(20, 40), cs);
      // Buildings: up to 3 random ones in range take heavy damage.
      const hit = r.shuffle(buildingsInRadius(state, x, y, radius)).slice(0, r.int(1, 3));
      for (const b of hit) damageBuilding(ctx, b, r.range(0.3, 0.6) * sev);
      // Houses crack.
      let houses = 0;
      for (const t of tiles)
        if (map.house[t]! > 1 && r.chance(0.3)) {
          map.house[t] = map.house[t]! - 1;
          houses++;
          cs.touch(t % W, (t / W) | 0);
        }
      cs.flush(ctx);
      const where = nearestCityName(state, x, y);
      const names = hit.map((b) => b.name ?? ctx.data.buildings[b.typeId]?.name ?? 'budynek');
      const text =
        dmg + hit.length + houses === 0
          ? `Wstrząsy odczuwalne w okolicy: ${where}. Brak większych szkód.`
          : `Wstrząsy koło: ${where}. Uszkodzone: ${names.length ? names.join(', ') + ', ' : ''}odcinki dróg/torów: ${dmg}, domy: ${houses}.`;
      return baseEvent(state, 'earthquake', 2, {
        title: 'Trzęsienie ziemi',
        icon: '🌋',
        description: text,
        area: { x, y, radius },
        regionIds: [regionOf(state, x, y)],
        companyId: 0,
        magnitude: sev,
      });
    },
  },
  {
    kind: 'fire',
    category: 'disaster',
    weight: (s) => {
      const dry = s.weather.regions.some((rg) => rg.drought > 0.4);
      return s.time.season === 'summer' && dry ? 1.2 : dry ? 0.3 : 0;
    },
    create(state, ctx, r) {
      const map = state.map;
      const W = map.width;
      const cands: number[] = [];
      for (let i = 0; i < map.forest.length; i += 2) {
        if (map.forest[i]! < 120) continue;
        const rg = state.weather.regions[regionOf(state, i % W, (i / W) | 0)];
        if (rg && rg.drought > 0.4) cands.push(i);
      }
      if (!cands.length) return null;
      const i0 = r.pick(cands);
      const x = i0 % W;
      const y = (i0 / W) | 0;
      const radius = r.int(3, 6);
      const cs = new ChangeSet();
      let burnt = 0;
      for (const t of tilesInDisk(state, x, y, radius)) {
        if (map.forest[t]! < 40 || !r.chance(0.8)) continue;
        map.forest[t] = r.int(0, 25);
        if (map.terrain[t] === Terrain.Forest) map.terrain[t] = Terrain.Grass;
        burnt++;
        cs.touch(t % W, (t / W) | 0);
      }
      for (const b of buildingsInRadius(state, x, y, radius)) damageBuilding(ctx, b, r.range(0.1, 0.3));
      cs.flush(ctx);
      return baseEvent(state, 'fire', 3, {
        title: 'Pożar lasu',
        icon: '🔥',
        description: `Pożar strawił ${burnt} ha lasu w pobliżu: ${nearestCityName(state, x, y)}.`,
        area: { x, y, radius },
        regionIds: [regionOf(state, x, y)],
      });
    },
  },
  {
    kind: 'heatwave',
    category: 'disaster',
    weight: (s) => (s.time.season === 'summer' ? 1 : 0),
    create(state, ctx, r) {
      const n = state.weather.regions.length;
      const ids = r.shuffle([...Array(n).keys()]).slice(0, Math.max(1, Math.round(n * r.range(0.3, 0.6))));
      const dur = r.int(10, 20);
      for (const id of ids) {
        const rg = state.weather.regions[id]!;
        if (rg.climate === 'arctic') continue;
        rg.kind = 'heat';
        rg.daysLeft = dur;
        rg.temperature += 6;
      }
      ctx.bus.emit('weather:changed', {});
      return baseEvent(state, 'heatwave', dur, {
        title: 'Fala upałów',
        icon: '🥵',
        description: `Upały przez ${days(dur)}. Farmy plonują słabiej, pracownicy są mniej wydajni.`,
        regionIds: ids.sort((a, b) => a - b),
        effects: { 'efficiency.farm': 0.8, 'efficiency.all': 0.95 },
      });
    },
  },
  {
    kind: 'blizzard',
    category: 'disaster',
    weight: (s) => (s.time.season === 'winter' && s.map.climate !== 'tropical' ? 1 : 0),
    create(state, ctx, r) {
      const cands = state.weather.regions.map((rg, i) => ({ rg, i })).filter((o) => o.rg.climate !== 'tropical' && o.rg.climate !== 'arid');
      if (!cands.length) return null;
      const ids = r.shuffle(cands).slice(0, Math.max(1, Math.round(cands.length * r.range(0.25, 0.5)))).map((o) => o.i);
      const dur = r.int(3, 8);
      for (const id of ids) {
        const rg = state.weather.regions[id]!;
        rg.kind = 'snow';
        rg.daysLeft = dur;
        rg.temperature = Math.min(rg.temperature, -5);
      }
      ctx.bus.emit('weather:changed', {});
      return baseEvent(state, 'blizzard', dur, {
        title: 'Śnieżyca',
        icon: '🌨️',
        description: `Zamiecie śnieżne przez ${days(dur)} — transport drogowy i kolejowy zwalnia.`,
        regionIds: ids.sort((a, b) => a - b),
        effects: { 'speed.road': 0.6, 'speed.rail': 0.8, 'speed.air': 0.3 },
      });
    },
  },
  {
    kind: 'strike',
    category: 'political',
    weight: (s, ctx) => (eraIdx(s, ctx) >= 1 ? 1 : 0.4),
    create(state, ctx, r) {
      // A company employing people from a city.
      const pairs: { cityId: number; companyId: number }[] = [];
      const seen = new Set<string>();
      for (const b of Object.values(state.buildings).sort((a, b2) => a.id - b2.id)) {
        const cityId = b.workers.sourceCityId || b.cityId;
        if (!b.owner || !cityId || b.workers.employed <= 0) continue;
        const key = `${cityId}:${b.owner}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({ cityId, companyId: b.owner });
      }
      if (!pairs.length) return null;
      const p = r.pick(pairs);
      const city = state.cities[p.cityId];
      const company = state.companies[p.companyId];
      if (!city || !company) return null;
      const dur = r.int(10, 25);
      return baseEvent(state, 'strike', dur, {
        title: 'Strajk',
        icon: '✊',
        description: `Pracownicy firmy ${company.name} z miasta ${city.name} strajkują (${days(dur)}). Wydajność zakładów spada.`,
        cityId: city.id,
        companyId: company.id,
        effects: { 'efficiency.all': 0.4, 'wages.all': 1.05 },
      });
    },
  },
  {
    kind: 'boom',
    category: 'political',
    weight: (s) => (isActive(s, 'recession') || isActive(s, 'boom') ? 0 : 0.6),
    create(state, _ctx, r) {
      const dur = r.int(180, 360);
      return baseEvent(state, 'boom', dur, {
        title: 'Boom gospodarczy',
        icon: '📈',
        description: 'Koniunktura kwitnie: mieszkańcy kupują więcej, ceny rosną.',
        magnitude: r.range(0.8, 1.2),
        effects: { 'demand.all': 1.15, economy: 1.2, 'price.all': 1.05 },
      });
    },
  },
  {
    kind: 'recession',
    category: 'political',
    weight: (s) => (isActive(s, 'recession') || isActive(s, 'boom') ? 0 : 0.5),
    create(state, _ctx, r) {
      const dur = r.int(180, 360);
      return baseEvent(state, 'recession', dur, {
        title: 'Recesja',
        icon: '📉',
        description: 'Kryzys gospodarczy: popyt spada, ceny słabną.',
        magnitude: r.range(0.8, 1.2),
        effects: { 'demand.all': 0.85, economy: 0.8, 'price.all': 0.93 },
      });
    },
  },
  {
    kind: 'priceShock',
    category: 'political',
    weight: () => 1,
    create(state, ctx, r) {
      const e = eraIdx(state, ctx);
      const raws = ctx.data.productList().filter((p) => p.isRaw && ctx.data.eraIndex(p.era) <= e).sort((a, b) => (a.id < b.id ? -1 : 1));
      if (!raws.length) return null;
      const p = r.pick(raws);
      const up = r.chance(0.6);
      const mult = up ? r.range(1.4, 1.8) : r.range(0.6, 0.75);
      const dur = r.int(60, 120);
      return baseEvent(state, 'priceShock', dur, {
        title: up ? `Skok cen: ${p.name}` : `Załamanie cen: ${p.name}`,
        icon: up ? '💹' : '🔻',
        description: `Cena ${p.icon} ${p.name} ${up ? 'rośnie' : 'spada'} o ok. ${Math.round(Math.abs(mult - 1) * 100)}% na ${days(dur)}.`,
        productId: p.id,
        effects: { [`price.${p.id}`]: Math.round(mult * 100) / 100 },
      });
    },
  },
  {
    kind: 'subsidy',
    category: 'political',
    weight: () => 0.8,
    create(state, ctx, r) {
      const e = eraIdx(state, ctx);
      const prods = ctx.data
        .productList()
        .filter((p) => ctx.data.eraIndex(p.era) <= e && (p.consumption || p.green || p.category === 'food' || p.category === 'energy'))
        .sort((a, b) => (a.id < b.id ? -1 : 1));
      if (!prods.length) return null;
      const p = r.pick(prods);
      const rate = Math.round(r.range(0.1, 0.25) * 100) / 100;
      const dur = r.int(180, 360);
      const ev = baseEvent(state, 'subsidy', dur, {
        title: `Dotacje: ${p.name}`,
        icon: '🏛️',
        description: `Rząd dopłaca ${Math.round(rate * 100)}% do sprzedaży ${p.icon} ${p.name} przez ${days(dur)}.`,
        productId: p.id,
        effects: { [`subsidy.${p.id}`]: rate },
      });
      addRegulation(state, ev, { kind: 'subsidy', title: ev.title, description: ev.description, productId: p.id, category: null, value: rate });
      return ev;
    },
  },
  {
    kind: 'carbonTax',
    category: 'political',
    weight: (s, ctx) => (eraIdx(s, ctx) >= 2 || s.ecology.awareness > 0.25 ? 0.6 : 0),
    create(state, _ctx, r) {
      const value = Math.round(r.range(2, 6) * (1 + state.ecology.awareness));
      const dur = r.int(360, 1080);
      const ev = baseEvent(state, 'carbonTax', dur, {
        title: 'Podatek emisyjny',
        icon: '🏭',
        description: `Wprowadzono opłatę ${value} zł za każdą jednostkę emisji CO₂.`,
        effects: { carbonTax: value },
      });
      addRegulation(state, ev, { kind: 'carbonTax', title: ev.title, description: ev.description, productId: null, category: null, value });
      return ev;
    },
  },
  {
    kind: 'emissionNorm',
    category: 'political',
    weight: (s, ctx) => (eraIdx(s, ctx) >= 3 ? 0.5 : 0),
    create(state, _ctx, r) {
      const cap = Math.round(r.range(0.7, 0.9) * 100) / 100;
      const dur = r.int(360, 1080);
      const ev = baseEvent(state, 'emissionNorm', dur, {
        title: 'Normy emisji',
        icon: '📜',
        description: `Nowe normy: emisje zakładów muszą spaść do ${Math.round(cap * 100)}% dotychczasowego poziomu, inaczej grożą kary.`,
        effects: { emissionCap: cap },
      });
      addRegulation(state, ev, { kind: 'emissionCap', title: ev.title, description: ev.description, productId: null, category: null, value: cap });
      return ev;
    },
  },
  {
    kind: 'epidemic',
    category: 'disaster',
    weight: () => 0.4,
    create(state, _ctx, r) {
      const cities = cityList(state);
      if (!cities.length) return null;
      const c = r.pick(cities);
      const loss = r.range(0.01, 0.03) * SEVERITY[state.settings.difficulty];
      for (const k of ['poor', 'middle', 'rich'] as const) c.population[k] = Math.round(c.population[k] * (1 - loss * (k === 'poor' ? 1.3 : 0.7)));
      const dur = r.int(30, 60);
      return baseEvent(state, 'epidemic', dur, {
        title: `Epidemia w mieście ${c.name}`,
        icon: '🦠',
        description: `Choroba zabrała ok. ${Math.round(loss * 100)}% mieszkańców. Miasto rośnie wolniej przez ${days(dur)}.`,
        cityId: c.id,
        effects: { satisfaction: -0.1, growth: 0.5 },
      });
    },
  },
  {
    kind: 'festival',
    category: 'political',
    weight: (s) => (s.time.season === 'summer' ? 1 : 0.5),
    create(state, _ctx, r) {
      const cities = cityList(state);
      if (!cities.length) return null;
      const c = r.pick(cities);
      const dur = r.int(5, 10);
      return baseEvent(state, 'festival', dur, {
        title: `Festyn: ${c.name}`,
        icon: '🎉',
        description: `Mieszkańcy świętują — większy popyt na żywność i dobra luksusowe przez ${days(dur)}.`,
        cityId: c.id,
        effects: { 'demand.food': 1.3, 'demand.luxury': 1.5, satisfaction: 0.05 },
      });
    },
  },
];

// ============================================================================
// start / end
// ============================================================================

const LEVEL: Partial<Record<WorldEventKind, 'info' | 'success' | 'warning' | 'danger'>> = {
  earthquake: 'danger',
  flood: 'danger',
  fire: 'warning',
  storm: 'warning',
  drought: 'warning',
  heatwave: 'warning',
  blizzard: 'warning',
  strike: 'warning',
  recession: 'warning',
  epidemic: 'warning',
  boom: 'success',
  subsidy: 'success',
  festival: 'info',
};

const END_TEXT: Partial<Record<WorldEventKind, string>> = {
  boom: 'Koniunktura wróciła do normy.',
  recession: 'Gospodarka odbija — popyt wraca do normy.',
  carbonTax: 'Opłata emisyjna została zniesiona.',
  strike: 'Pracownicy wrócili do pracy.',
  drought: 'Deszcze zakończyły suszę.',
};

function hasDemandEffects(ev: WorldEvent): boolean {
  return Object.keys(ev.effects).some((k) => k.startsWith('demand.'));
}

function refreshAffectedDemand(state: GameState, ctx: GameContext, ev: WorldEvent): void {
  if (!hasDemandEffects(ev)) return;
  for (const c of Object.values(state.cities)) if (!ev.cityId || ev.cityId === c.id) refreshCityDemand(state, ctx.data, c);
}

/** Register an already-created event: push to active, cooldown, notify, events. */
export function startEvent(state: GameState, ctx: GameContext, ev: WorldEvent): void {
  state.events.active.push(ev);
  let cd = COOLDOWN[ev.kind] ?? 90;
  if (isDestructive(ev.kind)) cd = Math.round(cd / (DESTRUCTIVE_FREQ[state.settings.difficulty] ?? 1));
  state.events.cooldowns[ev.kind] = state.time.totalDays + cd;
  refreshAffectedDemand(state, ctx, ev);
  ctx.bus.emit('worldEvent:started', { eventId: ev.id });
  const level = LEVEL[ev.kind] ?? 'info';
  if (level === 'danger' || level === 'warning') ctx.bus.emit('sfx', { id: 'warning', ...(ev.area ? { x: ev.area.x, y: ev.area.y } : {}) });
  const target = ev.cityId ? { kind: 'city' as const, id: ev.cityId } : ev.area ? { kind: 'tile' as const, x: ev.area.x, y: ev.area.y } : null;
  notify(ctx, { level, icon: ev.icon, title: ev.title, text: ev.description, target, companyId: ev.companyId, category: 'event' });
}

export function endEvent(state: GameState, ctx: GameContext, ev: WorldEvent): void {
  state.events.active = state.events.active.filter((e) => e !== ev);
  state.events.history.push(ev);
  if (state.events.history.length > MAX_EVENT_HISTORY) state.events.history.splice(0, state.events.history.length - MAX_EVENT_HISTORY);
  state.ecology.regulations = state.ecology.regulations.filter((r) => r.id !== `ev-${ev.id}`);
  refreshAffectedDemand(state, ctx, ev);
  ctx.bus.emit('worldEvent:ended', { eventId: ev.id });
  if (ev.kind === 'boom' || ev.kind === 'recession' || ev.kind === 'carbonTax' || ev.kind === 'strike' || ev.kind === 'drought')
    notify(ctx, { level: 'info', icon: ev.icon, title: `Koniec: ${ev.title}`, text: END_TEXT[ev.kind] ?? 'Sytuacja wróciła do normy.', companyId: ev.companyId, category: 'event', silent: ev.kind === 'strike' });
}

// ============================================================================
// daily system
// ============================================================================

function droughtEvents(state: GameState, ctx: GameContext): void {
  const regions = state.weather.regions;
  const active = state.events.active.filter((e) => e.kind === 'drought');
  for (const ev of active) {
    const worst = Math.max(...ev.regionIds.map((id) => regions[id]?.drought ?? 0));
    const lasted = state.time.totalDays - ev.startDay;
    if ((worst < 0.45 && lasted >= DROUGHT_MIN_DAYS) || ev.endDay <= state.time.totalDays) {
      ev.endDay = state.time.totalDays;
      endEvent(state, ctx, ev);
    }
  }
  if (!state.settings.disasters || inGracePeriod(state)) return;
  if ((state.events.cooldowns.drought ?? 0) > state.time.totalDays) return;
  const covered = new Set(state.events.active.filter((e) => e.kind === 'drought').flatMap((e) => e.regionIds));
  const ids: number[] = [];
  regions.forEach((rg, i) => {
    if (rg.climate !== 'arid' && rg.drought > 0.8 && !covered.has(i)) ids.push(i);
  });
  if (!ids.length) return;
  const w = state.weather;
  const x = Math.round(((ids[0]! % w.cols) + 0.5) * w.regionSize);
  const y = Math.round((Math.floor(ids[0]! / w.cols) + 0.5) * w.regionSize);
  const ev = baseEvent(state, 'drought', 180, {
    title: 'Susza',
    icon: '🏜️',
    description: `Długotrwały brak opadów w okolicy: ${nearestCityName(state, x, y)}. Plony farm spadają, dopóki nie spadnie deszcz.`,
    regionIds: ids,
    effects: { 'efficiency.farm': 0.85 },
  });
  startEvent(state, ctx, ev);
}

function repairDamaged(state: GameState, ctx: GameContext): void {
  const ext = worldExt(state);
  if (!ext.repairs.length) return;
  const today = state.time.totalDays;
  const cs = new ChangeSet();
  const W = state.map.width;
  ext.repairs = ext.repairs.filter((r) => {
    if (r.day > today) return true;
    if (state.map.flags[r.idx]! & TileFlag.Damaged) {
      state.map.flags[r.idx]! &= ~TileFlag.Damaged;
      cs.roads.push(r.idx);
      cs.touch(r.idx % W, (r.idx / W) | 0);
    }
    return false;
  });
  if (cs.roads.length) state.network.version++;
  cs.flush(ctx);
}

/** Roll one random event now (exported for tests/debug). Returns the event or null. */
export function rollWorldEvent(state: GameState, ctx: GameContext, forceKind?: WorldEventKind): WorldEvent | null {
  const r = rng(worldExt(state).rng);
  const today = state.time.totalDays;
  let pool = TEMPLATES;
  if (forceKind) pool = TEMPLATES.filter((t) => t.kind === forceKind);
  else {
    const cats: Category[] = [];
    if (state.settings.disasters) cats.push('disaster');
    if (state.settings.politicalEvents) cats.push('political');
    if (!cats.length) return null;
    const cat = r.pick(cats);
    const grace = inGracePeriod(state);
    pool = TEMPLATES.filter((t) => t.category === cat && (state.events.cooldowns[t.kind] ?? 0) <= today && !(grace && isDestructive(t.kind)));
  }
  const t = r.weighted(pool, (tp) => tp.weight(state, ctx));
  if (!t) return null;
  // Destructive disasters are rarer on easy/normal (the roll is simply skipped).
  if (!forceKind && isDestructive(t.kind) && !r.chance(DESTRUCTIVE_FREQ[state.settings.difficulty] ?? 1)) return null;
  const ev = t.create(state, ctx, r);
  if (!ev) return null;
  startEvent(state, ctx, ev);
  return ev;
}

export function eventsDailySystem(state: GameState, ctx: GameContext): void {
  const today = state.time.totalDays;
  for (const ev of state.events.active.slice()) if (ev.kind !== 'drought' && ev.endDay <= today) endEvent(state, ctx, ev);
  droughtEvents(state, ctx);
  repairDamaged(state, ctx);
  if (today < state.events.nextRollDay) return;
  const r = rng(worldExt(state).rng);
  const freq = FREQ[state.settings.difficulty] ?? 1;
  state.events.nextRollDay = today + Math.max(5, Math.round(r.int(40, 80) / freq));
  rollWorldEvent(state, ctx);
}

/** City population sum helper re-exported for UI convenience. */
export const totalPopulation = (state: GameState): number => Object.values(state.cities).reduce((s, c) => s + cityPopulation(c), 0);
