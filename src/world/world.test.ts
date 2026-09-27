import { describe, expect, it } from 'vitest';
import { createContext, type GameContext } from '../core/context';
import { cityPopulation } from '../core/entities';
import { startNewGame } from '../core/lifecycle';
import { deserializeState, serializeState } from '../core/save';
import { createEmptyState, defaultNewGameOptions } from '../core/state';
import { Dir, Terrain, TileFlag, type MapPreset, type NewGameOptions } from '../core/types';
import { registry } from '../data/registry';
import { cityCountFor, updateCityMonthly } from './cities';
import { ChangeSet } from './changes';
import { DESTRUCTIVE_KINDS, DROUGHT_MIN_DAYS, GRACE_DAYS, rollWorldEvent } from './events';
import { essentialDeposits, FAIR_RADIUS } from './fairness';
import { generateMap } from './mapgen';
import { computeLandmasses, isWaterTerrain } from './mapinfo';
import { init } from './index';

function mapOnly(opts: Partial<NewGameOptions>) {
  const st = createEmptyState({ ...defaultNewGameOptions(), ...opts }, registry);
  generateMap(st, st.settings, registry);
  return st;
}

function game(opts: Partial<NewGameOptions> = {}): GameContext {
  const ctx = createContext({ headless: true });
  init(ctx);
  ctx.sim.throwOnError = true;
  startNewGame(ctx, { seed: 4242, mapWidth: 128, mapHeight: 128, ...opts });
  return ctx;
}

describe('mapgen', () => {
  it('is deterministic by seed', () => {
    const a = mapOnly({ seed: 777, mapWidth: 96, mapHeight: 80 });
    const b = mapOnly({ seed: 777, mapWidth: 96, mapHeight: 80 });
    const c = mapOnly({ seed: 778, mapWidth: 96, mapHeight: 80 });
    for (const k of ['terrain', 'elevation', 'fertility', 'forest', 'flags', 'deposit', 'depositAmount', 'depositQuality'] as const)
      expect(Array.from(a.map[k])).toEqual(Array.from(b.map[k]));
    expect(a.map.depositTypes).toEqual(b.map.depositTypes);
    expect(Array.from(a.map.terrain)).not.toEqual(Array.from(c.map.terrain));
  });

  it('generates 256×256 in under 300 ms', () => {
    mapOnly({ seed: 1, mapWidth: 128, mapHeight: 128 }); // warm-up (JIT)
    let best = Infinity;
    for (let k = 0; k < 2; k++) {
      const st = createEmptyState({ ...defaultNewGameOptions(), seed: 99 + k, mapWidth: 256, mapHeight: 256 }, registry);
      const t0 = performance.now();
      generateMap(st, st.settings, registry);
      best = Math.min(best, performance.now() - t0);
    }
    expect(best).toBeLessThan(300);
  });

  it('produces sensible terrain, rivers and deposits for every preset', () => {
    const presets: MapPreset[] = ['continent', 'islands', 'archipelago', 'coast', 'inland'];
    for (const preset of presets) {
      const st = mapOnly({ seed: 31, mapWidth: 96, mapHeight: 96, mapPreset: preset });
      const m = st.map;
      let land = 0;
      let water = 0;
      let river = 0;
      for (let i = 0; i < m.terrain.length; i++) {
        if (isWaterTerrain(m.terrain[i]!)) {
          water++;
          expect(m.elevation[i]!).toBeLessThan(m.seaLevel);
          expect(m.flags[i]! & TileFlag.River).toBe(0);
        } else {
          land++;
          expect(m.elevation[i]!).toBeGreaterThanOrEqual(m.seaLevel);
        }
        if (m.flags[i]! & TileFlag.River) river++;
        if (m.deposit[i]) {
          expect(m.depositAmount[i]!).toBeGreaterThan(0);
          expect(m.depositQuality[i]!).toBeGreaterThan(0);
        }
      }
      expect(land, preset).toBeGreaterThan(m.terrain.length * 0.2);
      expect(water, preset).toBeGreaterThan(0);
      expect(river, preset).toBeGreaterThan(0);
      for (const d of registry.depositList()) expect(m.depositTypes).toContain(d.id);
    }
  });
});

describe('cities', () => {
  it('places named cities on land with a street grid and houses', () => {
    const ctx = game();
    const st = ctx.state;
    const m = st.map;
    const W = m.width;
    const cities = Object.values(st.cities);
    expect(cities.length).toBe(cityCountFor(st.settings, W, m.height));
    expect(cities.length).toBeGreaterThanOrEqual(6);
    expect(cities.length).toBeLessThanOrEqual(14);
    expect(new Set(cities.map((c) => c.name)).size).toBe(cities.length);
    for (const c of cities) {
      const ci = c.y * W + c.x;
      expect(isWaterTerrain(m.terrain[ci]!)).toBe(false);
      expect(st.network.road[ci]!).toBeGreaterThan(0);
      expect(c.houses.length).toBeGreaterThan(0);
      for (const h of c.houses) {
        expect(m.house[h]!).toBeGreaterThan(0);
        expect(m.terrain[h]).toBe(Terrain.Urban);
        expect(st.network.road[h]).toBe(0);
        expect(m.city[h]).toBe(c.id);
      }
      expect(Object.keys(c.demand).length).toBeGreaterThan(0);
      for (const d of Object.values(c.demand)) {
        expect(d.monthly).toBeGreaterThan(0);
        expect(d.price).toBeGreaterThan(0);
      }
      expect(cityPopulation(c)).toBeGreaterThan(0);
      expect(c.labour.workforce).toBeGreaterThan(0);
    }
    // Road connection masks are symmetric.
    for (let i = 0; i < st.network.road.length; i++) {
      if (!st.network.road[i]) continue;
      const conn = st.network.roadConn[i]!;
      if (conn & Dir.E) expect(st.network.roadConn[i + 1]! & Dir.W).toBeTruthy();
      if (conn & Dir.S) expect(st.network.roadConn[i + W]! & Dir.N).toBeTruthy();
    }
  });

  it('guarantees essential deposits near cities (fairness)', () => {
    for (const seed of [1, 2, 3]) {
      const ctx = game({ seed, mapPreset: seed === 2 ? 'islands' : 'continent' });
      const st = ctx.state;
      const m = st.map;
      const lm = computeLandmasses(m);
      const cities = Object.values(st.cities);
      for (const def of essentialDeposits(ctx.data, ctx.data.eraIndex(st.time.eraId))) {
        const pal = m.depositTypes.indexOf(def.id);
        const near = cities.filter((c) => {
          for (let y = Math.max(0, c.y - FAIR_RADIUS); y <= Math.min(m.height - 1, c.y + FAIR_RADIUS); y++)
            for (let x = Math.max(0, c.x - FAIR_RADIUS); x <= Math.min(m.width - 1, c.x + FAIR_RADIUS); x++) {
              const i = y * m.width + x;
              if (m.deposit[i] === pal && Math.hypot(x - c.x, y - c.y) <= FAIR_RADIUS && (lm.id[i] === lm.id[c.y * m.width + c.x] || isWaterTerrain(m.terrain[i]!)))
                return true;
            }
          return false;
        }).length;
        expect(near, `${def.id} seed ${seed}`).toBeGreaterThanOrEqual(Math.min(2, cities.length));
      }
    }
  });

  it('growth reacts to satisfaction (supplied city outgrows an unsupplied one)', () => {
    const ctx = game({ seed: 5 });
    const st = ctx.state;
    const [a, b] = Object.values(st.cities);
    const pa = cityPopulation(a!);
    const pb = cityPopulation(b!);
    const housesA = a!.houses.length;
    // Simulated shops fully supply city A every month.
    ctx.bus.on('time:day', () => {
      for (const d of Object.values(a!.demand)) d.suppliedMonth = d.monthly;
    });
    ctx.sim.advanceDays(360 * 2);
    expect(a!.satisfaction).toBeGreaterThan(b!.satisfaction + 0.3);
    expect(a!.growthRate).toBeGreaterThan(0);
    expect(b!.growthRate).toBeLessThan(a!.growthRate);
    expect(cityPopulation(a!) / pa).toBeGreaterThan(cityPopulation(b!) / pb + 0.2);
    expect(a!.houses.length).toBeGreaterThan(housesA);
    expect(a!.history.population.length).toBe(24);
  });

  it('removes houses covered by player buildings and keeps them off later', () => {
    const ctx = game({ seed: 8 });
    const st = ctx.state;
    const c = Object.values(st.cities)[0]!;
    const h = c.houses[0]!;
    st.network.road[h] = 1; // e.g. logistics built a road over it
    ctx.bus.emit('network:changed', { kind: 'road', tiles: [h] });
    expect(st.map.house[h]).toBe(0);
    expect(c.houses).not.toContain(h);
    updateCityMonthly(ctx, st, c, new ChangeSet());
    expect(st.map.house[h]).toBe(0);
  });
});

describe('weather & events', () => {
  it('runs years of weather/events deterministically', () => {
    const run = () => {
      const ctx = game({ seed: 11, difficulty: 'hard' });
      ctx.sim.advanceDays(360 * 4);
      return ctx.state;
    };
    const a = run();
    const b = run();
    const kinds = (s: typeof a) => [...s.events.history, ...s.events.active].map((e) => `${e.kind}@${e.startDay}`);
    expect(kinds(a)).toEqual(kinds(b));
    expect(kinds(a).length).toBeGreaterThan(3);
    expect(a.weather.regions.length).toBeGreaterThan(0);
    for (const r of a.weather.regions) {
      expect(r.drought).toBeGreaterThanOrEqual(0);
      expect(r.drought).toBeLessThanOrEqual(1);
    }
  });

  it('storm blocks water transport via services.world.modifierAt', () => {
    const ctx = game({ seed: 12 });
    const ev = rollWorldEvent(ctx.state, ctx, 'storm');
    expect(ev).not.toBeNull();
    const { x, y } = ev!.area!;
    expect(ctx.services.world.modifierAt('speed.water', x, y)).toBe(0);
    expect(ctx.services.world.weatherAt(x, y)?.kind).toBe('storm');
  });

  it('earthquake damages infrastructure and notifies', () => {
    const ctx = game({ seed: 13 });
    const before = ctx.state.notifications.list.length;
    const ev = rollWorldEvent(ctx.state, ctx, 'earthquake');
    expect(ev?.kind).toBe('earthquake');
    expect(ctx.state.notifications.list.length).toBe(before + 1);
    ctx.sim.advanceDays(60);
    // Damaged roads are repaired automatically.
    let damaged = 0;
    for (const f of ctx.state.map.flags) if (f & TileFlag.Damaged) damaged++;
    expect(damaged).toBe(0);
  });
});

describe('disaster pacing', () => {
  const destructive = (s: GameContext['state']) =>
    [...s.events.history, ...s.events.active].filter((e) => (DESTRUCTIVE_KINDS as readonly string[]).includes(e.kind));

  it('no destructive disasters during the grace period (normal 12 / easy 24 / hard 6 months)', () => {
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      for (const seed of [1, 2, 3]) {
        const ctx = game({ seed, difficulty, mapWidth: 96, mapHeight: 96 });
        ctx.sim.advanceDays(GRACE_DAYS[difficulty] - 1);
        expect(destructive(ctx.state)).toEqual([]);
      }
    }
  });

  it('droughts last at least DROUGHT_MIN_DAYS and destructive events are rarer on normal than hard', () => {
    let normal = 0;
    let hard = 0;
    for (const seed of [5, 6]) {
      const n = game({ seed, difficulty: 'normal', mapWidth: 96, mapHeight: 96 });
      n.sim.advanceDays(360 * 6);
      const h = game({ seed, difficulty: 'hard', mapWidth: 96, mapHeight: 96 });
      h.sim.advanceDays(360 * 6);
      normal += destructive(n.state).length;
      hard += destructive(h.state).length;
      for (const st of [n.state, h.state])
        for (const e of st.events.history) if (e.kind === 'drought') expect(e.endDay - e.startDay).toBeGreaterThanOrEqual(DROUGHT_MIN_DAYS);
    }
    expect(normal).toBeLessThan(hard);
  });
});

describe('services & save', () => {
  it('world service helpers work', () => {
    const ctx = game({ seed: 21 });
    const st = ctx.state;
    const w = ctx.services.world;
    const c = Object.values(st.cities)[0]!;
    expect(w.nearestCity(c.x + 1, c.y)).toBe(c.id);
    expect(w.cityAt(c.x, c.y)).toBe(c.id);
    expect(w.isBuildableTile(c.x, c.y)).toBe(false); // road
    const h = c.houses[0]!;
    expect(w.isBuildableTile(h % st.map.width, Math.floor(h / st.map.width))).toBe(false);
    expect(w.tilesInRadius(10, 10, 2).length).toBe(13);
    const waterIdx = st.map.terrain.findIndex((t) => isWaterTerrain(t));
    expect(w.terrainCost(waterIdx % st.map.width, Math.floor(waterIdx / st.map.width), 'road')).toBe(Infinity);
    expect(w.terrainCost(c.x, c.y, 'road')).toBeGreaterThan(0);
  });

  it('state survives serialize → deserialize', () => {
    const ctx = game({ seed: 22 });
    ctx.sim.advanceDays(45);
    const back = deserializeState(serializeState(ctx.state));
    expect(Array.from(back.map.house)).toEqual(Array.from(ctx.state.map.house));
    expect(back.cities).toEqual(ctx.state.cities);
    expect(back.weather).toEqual(ctx.state.weather);
    expect(back.ext.world).toEqual(ctx.state.ext.world);
  });
});
