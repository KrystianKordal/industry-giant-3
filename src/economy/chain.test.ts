import { describe, expect, it } from 'vitest';
import { DAYS_PER_MONTH } from '../core/constants';
import { addMoney } from '../core/money';
import { planChain } from './analysis';
import { addTransport, createHarness, findNaN } from './testing';

/** Build the first chain (farm → mill → bakery → shop) next to the test city. */
function buildBreadChain(h: ReturnType<typeof createHarness>) {
  const eco = h.ctx.services.economy;
  const pid = h.state.playerCompanyId;
  const farm = eco.build(pid, 'farm_grain', 30, 10, 0);
  const mill = eco.build(pid, 'mill', 30, 15, 0);
  const bakery = eco.build(pid, 'bakery', 26, 15, 0);
  const shop = eco.build(pid, 'shop_food', 24, 20, 0);
  for (const r of [farm, mill, bakery, shop]) expect(r.ok, r.ok ? '' : r.reason).toBe(true);
  if (!farm.ok || !mill.ok || !bakery.ok || !shop.ok) throw new Error('build failed');
  // transport: 3 links served by 2 horse carts each (~2×20 units per ~3-day round trip)
  addTransport(h, [
    { from: farm.id, to: mill.id, perDay: 13 },
    { from: mill.id, to: bakery.id, perDay: 13 },
    { from: bakery.id, to: shop.id, perDay: 13 },
  ], 2 * 40);
  // vehicles + roads the player would pay for (logistics is stubbed)
  addMoney(h.ctx, pid, -(6 * 800 + 3000), 'vehiclePurchase');
  return { farm: farm.id, mill: mill.id, bakery: bakery.id, shop: shop.id };
}

describe('first chain: farm → mill → bakery → shop', () => {
  it('is clearly profitable within ~5 game minutes (10 months) on normal difficulty', () => {
    const h = createHarness({ difficulty: 'normal' });
    const player = h.state.companies[h.state.playerCompanyId]!;
    const startCash = player.cash;
    expect(startCash).toBe(150_000);
    buildBreadChain(h);
    const afterInvest = player.cash;
    const investment = startCash - afterInvest;
    h.ctx.sim.advanceDays(10 * DAYS_PER_MONTH);

    const hist = player.finances.history;
    const profits = hist.map((m) => Math.round(m.profit));
    // eslint-disable-next-line no-console
    console.log('[bread chain] investment', investment, 'monthly profit', profits, 'cash', Math.round(player.cash));
    // after ramp-up every month is clearly in the black
    for (const p of profits.slice(1)) expect(p).toBeGreaterThan(2500);
    // operating profit after construction repays most of the investment in 10 months
    const operating = player.cash - afterInvest;
    expect(operating).toBeGreaterThan(investment * 0.6);
    // …and by month 10 the whole investment (buildings, carts, roads) is back
    expect(player.cash).toBeGreaterThan(startCash);
    // bread was actually sold to the city
    expect(Object.values(h.state.buildings).some((b) => (b.stats.profitHistory.at(-1) ?? 0) !== 0)).toBe(true);
    expect(h.city.demand.bread!.satisfaction).toBeGreaterThan(0.3);
    expect(player.bankrupt).toBe(false);
    expect(findNaN(h.state)).toEqual([]);
    expect(h.state.map.pollution.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('analysis predicts a fast payback for the bread chain and positive steady-state profit for all chains', () => {
    const h = createHarness();
    const bread = planChain(h.ctx, 'bread', { prices: 'base' })!;
    expect(bread.monthlyProfit).toBeGreaterThan(3000);
    expect(bread.paybackMonths).toBeLessThan(9);
    const wages = [55, 80, 130, 220, 340];
    for (const p of h.ctx.data.productList()) {
      if (!p.consumption) continue;
      const plan = planChain(h.ctx, p.id, { prices: 'base', wage: wages[h.ctx.data.eraIndex(p.era)] });
      expect(plan, `plan ${p.id}`).not.toBeNull();
      expect(plan!.monthlyProfit, `profit ${p.id}`).toBeGreaterThan(0);
      expect(plan!.paybackMonths, `payback ${p.id}`).toBeLessThan(40);
    }
  });

  it('later chains are more profitable (absolute) but need more capital', () => {
    const h = createHarness();
    const wages = [55, 80, 130, 220, 340];
    const plan = (id: string) => planChain(h.ctx, id, { prices: 'base', wage: wages[h.ctx.data.eraIndex(h.ctx.data.product(id).era)] })!;
    const bread = plan('bread');
    const cars = plan('cars');
    const phones = plan('smartphones');
    expect(cars.monthlyProfit).toBeGreaterThan(bread.monthlyProfit);
    expect(phones.monthlyProfit).toBeGreaterThan(cars.monthlyProfit);
    expect(cars.investment).toBeGreaterThan(bread.investment * 3);
    expect(phones.investment).toBeGreaterThan(cars.investment);
  });
});
