import { describe, expect, it } from 'vitest';
import { createContext } from './context';
import { startNewGame } from './lifecycle';
import { deserializeState, listSlots, loadFromSlot, registerMigration, saveToSlot, serializeState, setSaveStorage, type StorageLike } from './save';
import { SAVE_VERSION } from './constants';
import { Terrain } from './types';

function memoryStorage(): StorageLike {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

function game() {
  const ctx = createContext({ headless: true });
  ctx.sim.throwOnError = true;
  startNewGame(ctx, { seed: 99, mapWidth: 48, mapHeight: 40, companyName: 'Test S.A.' });
  const pid = ctx.state.playerCompanyId;
  let spot = { x: 0, y: 0 };
  outer: for (let y = 0; y < 38; y++)
    for (let x = 0; x < 46; x++)
      if (ctx.services.economy.checkPlacement(pid, 'warehouse', x, y, 0).ok) {
        spot = { x, y };
        break outer;
      }
  const res = ctx.services.economy.build(pid, 'warehouse', spot.x, spot.y, 0);
  ctx.sim.advanceDays(3);
  return { ctx, built: res };
}

describe('save', () => {
  it('roundtrips a full state including typed arrays', () => {
    const { ctx } = game();
    const st = ctx.state;
    st.map.pollution[10] = 12.5;
    st.map.depositAmount[20] = 1234.25;
    const json = serializeState(st);
    const back = deserializeState(json);
    expect(back.map.terrain).toBeInstanceOf(Uint8Array);
    expect(back.map.pollution).toBeInstanceOf(Float32Array);
    expect(back.map.building).toBeInstanceOf(Uint32Array);
    expect(Array.from(back.map.terrain)).toEqual(Array.from(st.map.terrain));
    expect(back.map.pollution[10]).toBeCloseTo(12.5);
    expect(back.map.depositAmount[20]).toBeCloseTo(1234.25);
    expect(back.time).toEqual(st.time);
    expect(back.rng).toEqual(st.rng);
    expect(back.companies).toEqual(st.companies);
    expect(back.buildings).toEqual(st.buildings);
    // second roundtrip is byte-identical (stable encoding)
    expect(serializeState(back).replace(/"savedAt":"[^"]*"/g, '')).toBe(json.replace(/"savedAt":"[^"]*"/g, ''));
  });

  it('generated map has water and land; building placed via default service', () => {
    const { ctx, built } = game();
    expect(built.ok).toBe(true);
    const t = Array.from(ctx.state.map.terrain);
    expect(t.some((x) => x <= Terrain.Water)).toBe(true);
    expect(t.some((x) => x > Terrain.Water)).toBe(true);
  });

  it('saves to and loads from a storage slot (compressed)', async () => {
    setSaveStorage(memoryStorage());
    const { ctx } = game();
    await saveToSlot(ctx.state, 'slot1');
    expect(listSlots().map((s) => s.slot)).toEqual(['slot1']);
    const loaded = await loadFromSlot('slot1');
    expect(loaded.meta.id).toBe(ctx.state.meta.id);
    expect(Array.from(loaded.map.elevation)).toEqual(Array.from(ctx.state.map.elevation));
    setSaveStorage(null);
  });

  it('rejects foreign files and runs migrations for old versions', () => {
    expect(() => deserializeState('{"hello":1}')).toThrow();
    const { ctx } = game();
    const env = JSON.parse(serializeState(ctx.state));
    env.state.version = SAVE_VERSION - 1;
    delete env.state.ext;
    registerMigration(SAVE_VERSION - 1, (s) => {
      s.ext = { migrated: true };
    });
    const back = deserializeState(JSON.stringify(env));
    expect(back.version).toBe(SAVE_VERSION);
    expect(back.ext).toEqual({ migrated: true });
  });
});
