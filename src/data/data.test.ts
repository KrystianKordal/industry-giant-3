import { describe, expect, it } from 'vitest';
import type { ModPack } from './defs';
import exampleMod from './mods/example.json';
import { createRegistry } from './registry';

describe('base data', () => {
  const r = createRegistry();

  it('validates without errors', () => {
    expect(r.validate()).toEqual([]);
  });

  it('has 5 eras with the expected start years', () => {
    expect(r.eraList().map((e) => e.startYear)).toEqual([1850, 1900, 1950, 1990, 2020]);
    expect(r.eraForYear(1850).id).toBe('industrial');
    expect(r.eraForYear(2025).id).toBe('digital');
  });

  it('has ~50+ products, ~30+ techs and a full roster', () => {
    expect(r.productList().length).toBeGreaterThanOrEqual(50);
    expect(r.techList().length).toBeGreaterThanOrEqual(30);
    expect(r.buildingList().length).toBeGreaterThanOrEqual(50);
    for (const era of r.eraList()) expect(r.vehicleList().some((v) => v.era === era.id)).toBe(true);
    for (const mode of ['road', 'rail', 'water', 'air'] as const) expect(r.vehicleList().some((v) => v.mode === mode)).toBe(true);
  });

  it('every non-waste product has a producer, every consumable has a shop', () => {
    for (const p of r.productList()) {
      const producers = r.recipesProducing(p.id).filter((rec) => r.buildingsRunning(rec.id).length > 0);
      const byproduct = Object.values(r.recipes).some((rec) => rec.byproducts?.some((b) => b.product === p.id));
      expect(producers.length > 0 || byproduct, `producent dla ${p.id}`).toBe(true);
      if (p.consumption && p.category !== 'digital') {
        const shops = r.buildingsIn('shop').filter((s) => s.sells?.includes(p.id));
        expect(shops.length, `sklep dla ${p.id}`).toBeGreaterThan(0);
      }
    }
  });

  it('every recipe is used by a building and every non-final product is consumed somewhere', () => {
    for (const rec of Object.values(r.recipes)) expect(r.buildingsRunning(rec.id).length, rec.id).toBeGreaterThan(0);
    for (const p of r.productList()) {
      const used = Object.values(r.recipes).some((rec) => rec.inputs.some((i) => i.product === p.id));
      const sold = r.buildingsIn('shop').some((s) => s.sells?.includes(p.id)) || p.category === 'digital';
      expect(used || sold, `zbyt dla ${p.id}`).toBe(true);
    }
  });

  it('deposits map to raw products and mines', () => {
    for (const d of r.depositList()) {
      expect(r.product(d.product).isRaw).toBe(true);
      expect(r.buildingList().some((b) => b.requiresDeposit === d.id), d.id).toBe(true);
    }
  });

  it('tech tree is acyclic and prereqs are not from a later era', () => {
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (id: string): void => {
      if (done.has(id)) return;
      expect(visiting.has(id), `cykl w ${id}`).toBe(false);
      visiting.add(id);
      const t = r.tech(id);
      for (const p of t.prereqs) {
        expect(r.eraIndex(r.tech(p).era)).toBeLessThanOrEqual(r.eraIndex(t.era));
        visit(p);
      }
      visiting.delete(id);
      done.add(id);
    };
    for (const t of r.techList()) visit(t.id);
  });
});

describe('mods', () => {
  it('merges the example mod and extends shop assortments', () => {
    const r = createRegistry();
    const res = r.mergeMod(exampleMod as unknown as ModPack);
    expect(res.errors).toEqual([]);
    expect(res.added).toBe(6);
    expect(r.building('apiary').recipes).toEqual(['keep_bees']);
    expect(r.building('shop_food').sells).toContain('honey');
    expect(r.building('shop_luxury').sells).toContain('mead');
  });

  it('replaces defs with the same id', () => {
    const r = createRegistry();
    const res = r.mergeMod({ id: 'x', name: 'x', version: '1', products: [{ ...r.product('bread'), basePrice: 99 }] });
    expect(res.replaced).toBe(1);
    expect(r.product('bread').basePrice).toBe(99);
  });

  it('reports invalid references', () => {
    const r = createRegistry();
    const res = r.mergeMod({ id: 'bad', name: 'bad', version: '1', recipes: [{ id: 'r', name: 'r', inputs: [{ product: 'nope', qty: 1 }], outputs: [], days: 1, qualityModifier: 0 }] });
    expect(res.errors.some((e) => e.includes('nope'))).toBe(true);
  });
});
