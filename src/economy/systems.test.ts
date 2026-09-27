import { describe, expect, it } from 'vitest';
import { DAYS_PER_MONTH } from '../core/constants';
import { addMoney } from '../core/money';
import { deserializeState, serializeState } from '../core/save';
import { addStock } from '../core/util';
import { pnlSummary } from './analysis';
import { createHarness, findNaN } from './testing';

const month = (h: ReturnType<typeof createHarness>, n = 1) => h.ctx.sim.advanceDays(n * DAYS_PER_MONTH);

describe('finance', () => {
  it('closes months into history with cashEnd, valuation and credit limit', () => {
    const h = createHarness();
    const p = h.state.companies[h.state.playerCompanyId]!;
    month(h, 2);
    expect(p.finances.history).toHaveLength(2);
    expect(p.finances.history[0]!.cashEnd).toBeGreaterThan(0);
    expect(p.finances.valuation).toBeGreaterThan(0);
    expect(p.creditLimit).toBeGreaterThan(0);
    expect(h.ctx.services.economy.companyValue(p.id)).toBeGreaterThan(0);
    const s = pnlSummary(p);
    expect(s.lastGroups.length).toBeGreaterThan(0);
  });

  it('loans: take, monthly instalments with interest, early repayment, limit', () => {
    const h = createHarness();
    const eco = h.ctx.services.economy;
    const p = h.state.companies[h.state.playerCompanyId]!;
    const cash0 = p.cash;
    const r = eco.takeLoan(p.id, 50_000, 24);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(p.cash).toBe(cash0 + 50_000);
    expect(p.finances.current.ledger.loanIn).toBe(50_000);
    expect(p.finances.current.profit).toBe(0); // financing is not revenue
    const loan = p.loans[0]!;
    expect(loan.monthlyPayment).toBeGreaterThan(50_000 / 24);
    month(h);
    expect(loan.remaining).toBeLessThan(50_000);
    expect(p.finances.history[0]!.ledger.interest).toBeLessThan(0);
    expect(eco.takeLoan(p.id, 10_000_000, 24).ok).toBe(false);
    const rep = eco.repayLoan(p.id, loan.id);
    expect(rep.ok).toBe(true);
    expect(p.loans).toHaveLength(0);
  });

  it('charges corporate tax on a profitable month', () => {
    const h = createHarness();
    const p = h.state.companies[h.state.playerCompanyId]!;
    addMoney(h.ctx, p.id, 10_000, 'sales');
    month(h);
    const m = p.finances.history[0]!;
    expect(m.ledger.taxes).toBeCloseTo(-10_000 * 0.19, 0);
  });

  it('goes bankrupt after 3 month-closes with negative cash (with warnings)', () => {
    const h = createHarness();
    const p = h.state.companies[h.state.playerCompanyId]!;
    let bankrupt = 0;
    h.ctx.bus.on('company:bankrupt', () => bankrupt++);
    addMoney(h.ctx, p.id, -(p.cash + 50_000), 'otherExpense');
    month(h, 2);
    expect(p.monthsInDebt).toBe(2);
    expect(p.bankrupt).toBe(false);
    expect(h.state.notifications.list.some((n) => n.title.includes('bankructwa'))).toBe(true);
    month(h);
    expect(p.bankrupt).toBe(true);
    expect(bankrupt).toBe(1);
    expect(h.ctx.services.economy.build(p.id, 'farm_grain', 40, 40, 0).ok).toBe(false);
  });
});

describe('research', () => {
  it('researches with budget + labs, applies modifiers, era tech advances the world era', () => {
    const h = createHarness({ difficulty: 'easy' });
    const eco = h.ctx.services.economy;
    const p = h.state.companies[h.state.playerCompanyId]!;
    expect(eco.startResearch(p.id, 'era_electric').ok).toBe(false); // prereqs missing
    expect(eco.startResearch(p.id, 'crop_rotation').ok).toBe(true);
    eco.setResearchBudget!(p.id, 4000); // 100 pts/month
    month(h, 2);
    expect(p.research.unlocked.crop_rotation).toBeDefined();
    expect(p.modifiers['efficiency.farm']).toBeCloseTo(1.15);
    expect(p.finances.history[0]!.ledger.research).toBeLessThan(0);

    // queue everything up to the next era
    const q = eco.queueResearch!(p.id, 'era_electric');
    expect(q.ok).toBe(true);
    expect(eco.isUnlocked(p.id, 'building', 'refinery')).toBe(false);
    expect(eco.isUnlocked(p.id, 'building', 'train_station')).toBe(false);
    let era = '';
    h.ctx.bus.on('era:changed', ({ eraId }) => (era = eraId));
    eco.setResearchBudget!(p.id, 40_000);
    for (let i = 0; i < 12; i++) month(h);
    // era techs open at most ERA_EARLY_YEARS (20) before the era's calendar start (1900)
    expect(p.research.unlocked.bessemer_process).toBeDefined();
    expect(p.research.unlocked.era_electric).toBeUndefined();
    expect(eco.startResearch(p.id, 'era_electric').ok).toBe(false);
    h.state.time.year = 1880;
    for (let i = 0; i < 24 && !p.research.unlocked.era_electric; i++) month(h);
    expect(p.research.unlocked.railways).toBeDefined();
    expect(eco.isUnlocked(p.id, 'building', 'train_station')).toBe(true);
    expect(p.research.unlocked.era_electric).toBeDefined();
    expect(era).toBe('electric');
    expect(h.state.time.eraId).toBe('electric');
    expect(eco.isUnlocked(p.id, 'building', 'glassworks')).toBe(true);
    expect(eco.isUnlocked(p.id, 'building', 'refinery')).toBe(false); // needs 'refining'
    expect(p.unlocks.buildings.glassworks).toBe(true);
  });

  it('keeps partial progress when switching techs', () => {
    const h = createHarness();
    const eco = h.ctx.services.economy;
    const p = h.state.companies[h.state.playerCompanyId]!;
    eco.startResearch(p.id, 'steam_power');
    month(h);
    const prog = p.research.progress;
    expect(prog).toBeGreaterThan(0);
    eco.startResearch(p.id, 'accounting');
    expect(p.research.progress).toBe(0);
    eco.startResearch(p.id, 'steam_power');
    expect(p.research.progress).toBeCloseTo(prog);
  });
});

describe('placement & services', () => {
  it('rejects locked buildings, duplicate HQ and denied permits; demolish refunds', () => {
    const h = createHarness();
    const eco = h.ctx.services.economy;
    const pid = h.state.playerCompanyId;
    expect(eco.checkPlacement(pid, 'train_station', 40, 40, 0).ok).toBe(false);
    expect(eco.checkPlacement(pid, 'car_factory', 40, 40, 0).reason).toContain('epoce');
    expect(eco.build(pid, 'headquarters', 40, 40, 0).ok).toBe(true);
    expect(eco.checkPlacement(pid, 'headquarters', 45, 45, 0).reason).toBe('Firma ma już siedzibę');
    h.city.permits[pid] = 'restricted';
    expect(eco.checkPlacement(pid, 'steel_mill', 19, 19, 0).ok).toBe(false);
    expect(eco.checkPlacement(pid, 'shop_food', 22, 22, 0).ok).toBe(true);
    h.city.permits[pid] = 'denied';
    expect(eco.checkPlacement(pid, 'shop_food', 22, 22, 0).ok).toBe(false);
    const farm = eco.build(pid, 'farm_grain', 50, 50, 0);
    expect(farm.ok).toBe(true);
    if (!farm.ok) return;
    const cash = h.state.companies[pid]!.cash;
    const d = eco.demolish(farm.id);
    expect(d.ok && d.cost < 0).toBe(true);
    expect(h.state.companies[pid]!.cash).toBeGreaterThan(cash);
  });

  it('setRecipe moves unused inputs to output, upgrades and shop price work', () => {
    const h = createHarness();
    const eco = h.ctx.services.economy;
    const pid = h.state.playerCompanyId;
    const r = eco.build(pid, 'bakery', 40, 40, 0);
    if (!r.ok) throw new Error(r.reason);
    const b = h.state.buildings[r.id]!;
    addStock(b.input, 'milk', 10, 0.5);
    expect(eco.setRecipe(r.id, 'bake_bread_milk')).toBe(true);
    expect(b.input.milk?.qty).toBe(10);
    expect(eco.setRecipe(r.id, 'bake_bread')).toBe(true);
    expect(b.input.milk).toBeUndefined();
    expect(b.output.milk?.qty).toBe(10);
    expect(eco.upgradeBuilding!(r.id, 'expand').ok).toBe(false); // under construction
    month(h);
    expect(eco.upgradeBuilding!(r.id, 'expand').ok).toBe(true);
    expect(eco.upgradeBuilding!(r.id, 'machines').ok).toBe(false); // needs assembly_line
    const s = eco.build(pid, 'shop_food', 22, 22, 0);
    if (!s.ok) throw new Error(s.reason);
    expect(eco.setShopPrice!(s.id, 3)).toBe(true);
    expect(h.state.buildings[s.id]!.shop!.priceFactor).toBe(2);
  });
});

describe('market, sales, ecology', () => {
  it('competing shops split demand; cheaper/better shop sells more', () => {
    const h = createHarness({ population: 8000 });
    const eco = h.ctx.services.economy;
    const pid = h.state.playerCompanyId;
    const a = eco.build(pid, 'shop_food', 22, 22, 0);
    const b = eco.build(pid, 'shop_food', 18, 22, 0);
    if (!a.ok || !b.ok) throw new Error('build');
    month(h); // construction
    const A = h.state.buildings[a.id]!;
    const B = h.state.buildings[b.id]!;
    B.shop!.priceFactor = 1.4;
    for (let d = 0; d < 20; d++) {
      addStock(A.input, 'bread', 20, 0.5);
      addStock(B.input, 'bread', 20, 0.5);
      h.ctx.sim.advanceDays(1);
    }
    expect(A.stats.soldMonth.bread ?? 0).toBeGreaterThan((B.stats.soldMonth.bread ?? 0) * 1.3);
    expect(h.city.demand.bread!.shareByCompany[pid]).toBeGreaterThan(0);
  });

  it('export center sells storage at export price; digital output sells without transport', () => {
    const h = createHarness();
    const eco = h.ctx.services.economy;
    const pid = h.state.playerCompanyId;
    const ex = eco.build(pid, 'export_center', 40, 40, 0);
    if (!ex.ok) throw new Error(ex.reason);
    month(h);
    const E = h.state.buildings[ex.id]!;
    addStock(E.storage, 'steel', 100, 0.5);
    h.ctx.sim.advanceDays(3);
    expect(E.storage.steel?.qty ?? 0).toBeLessThan(100);
    const p = h.state.companies[pid]!;
    expect(p.finances.current.ledger.export).toBeGreaterThan(0);

    // digital: fake a software studio output (needs the digital era for demand)
    h.state.time.eraId = 'digital';
    const s = eco.build(pid, 'warehouse', 50, 50, 0); // any building can hold output for the test
    if (!s.ok) throw new Error(s.reason);
    const S = h.state.buildings[s.id]!;
    h.city.demand.software = { monthly: 300, suppliedMonth: 0, satisfaction: 0, price: 400, shareByCompany: {}, history: [] };
    addStock(S.output, 'software', 50, 0.5);
    h.ctx.sim.advanceDays(2);
    expect(S.output.software?.qty ?? 0).toBeLessThan(50);
    expect(h.city.demand.software.suppliedMonth).toBeGreaterThan(0);
  });

  it('market prices react to scarcity/oversupply and stay finite', () => {
    const h = createHarness();
    const mp = h.state.market.products.grain!;
    const base = mp.price;
    mp.current.supply = 100_000; // flood the market
    month(h);
    expect(mp.price).toBeLessThan(base);
    expect(mp.priceHistory.length).toBe(1);
    const bread = h.state.market.products.bread!;
    month(h, 3); // cities want bread, nobody sells → scarce
    expect(bread.price).toBeGreaterThan(h.ctx.data.product('bread').basePrice * bread.seasonal * 0.99);
    for (const p of Object.values(h.state.market.products)) {
      expect(Number.isFinite(p.price) && p.price > 0).toBe(true);
      expect(Number.isFinite(p.exportPrice)).toBe(true);
    }
  });

  it('pollution spreads around a steel mill, emission tax and eco rating react', () => {
    const h = createHarness({ difficulty: 'easy' });
    const eco = h.ctx.services.economy;
    const pid = h.state.playerCompanyId;
    const r = eco.build(pid, 'steel_mill', 30, 30, 0);
    if (!r.ok) throw new Error(r.reason);
    const b = h.state.buildings[r.id]!;
    h.state.ecology.carbonTax = 5;
    const p = h.state.companies[pid]!;
    const clean = createHarness({ difficulty: 'easy' });
    clean.ctx.sim.advanceDays(90);
    for (let d = 0; d < 90; d++) {
      addStock(b.input, 'iron_ore', 40, 0.6);
      addStock(b.input, 'coal', 20, 0.6);
      b.output = {};
      h.ctx.sim.advanceDays(1);
    }
    const i = 31 * h.state.map.width + 31;
    expect(h.state.map.pollution[i]).toBeGreaterThan(20);
    expect(h.state.map.pollution[5]).toBe(0);
    expect(p.emissionsHistory.at(-1)).toBeGreaterThan(10);
    expect(p.finances.history.at(-1)!.ledger.emissionTax).toBeLessThan(0);
    expect(p.ecoRating).toBeLessThan(clean.state.companies[clean.state.playerCompanyId]!.ecoRating - 3);
    expect(b.stats.producedMonth.slag ?? b.stats.profitHistory.length).toBeGreaterThan(0);
  });
});

describe('save / load', () => {
  it('economy state survives serialize → deserialize and keeps running', () => {
    const h = createHarness();
    const eco = h.ctx.services.economy;
    const pid = h.state.playerCompanyId;
    eco.build(pid, 'farm_grain', 30, 10, 0);
    eco.startResearch(pid, 'accounting');
    eco.takeLoan(pid, 20_000, 12);
    month(h, 2);
    const copy = deserializeState(serializeState(h.state));
    expect(copy.ext.economy).toEqual(h.state.ext.economy);
    expect(copy.companies[pid]!.loans).toEqual(h.state.companies[pid]!.loans);
    expect(findNaN(copy)).toEqual([]);
  });
});
