import { describe, expect, it } from 'vitest';
import { createContext, type GameContext } from '../core/context';
import { installCore, startNewGame } from '../core/lifecycle';
import type { Objective } from '../core/types';
import { init as initAi } from '../ai';
import { analyse, advisorSystem } from './advisor';
import { isUnlocked, loadCampaign } from './campaign';
import { init as initGame } from './index';
import { evaluateObjective, resolveObjective } from './objectives';
import { SCENARIOS, scenarioInfo } from './scenarios';
import { gameExt } from './tracking';

function makeCtx(): GameContext {
  const ctx = createContext({ headless: true });
  ctx.sim.throwOnError = true;
  installCore(ctx);
  initAi(ctx);
  initGame(ctx);
  return ctx;
}

const objective = (o: Partial<Objective>): Objective => ({
  id: 'x', kind: 'cash', title: 't', description: '', productId: null, cityId: 0, techId: null, target: 1,
  progress: 0, deadlineDay: null, optional: false, done: false, failed: false, reward: 0, ...o,
});

describe('objectives', () => {
  it('evaluates basic kinds', () => {
    const ctx = makeCtx();
    startNewGame(ctx, { seed: 1, mapWidth: 32, mapHeight: 32, rivals: 0 });
    const s = ctx.state;
    const p = s.companies[s.playerCompanyId]!;
    expect(evaluateObjective(ctx, s, objective({ kind: 'cash' }))).toBe(p.cash);
    const ext = gameExt(s);
    ctx.bus.emit('sale', { companyId: p.id, buildingId: 1, cityId: 3, productId: 'bread', qty: 40, revenue: 800 });
    ctx.bus.emit('sale', { companyId: 99, buildingId: 2, cityId: 3, productId: 'bread', qty: 60, revenue: 800 });
    expect(ext.sold.bread).toBe(40);
    expect(evaluateObjective(ctx, s, objective({ kind: 'deliver', productId: 'bread' }))).toBe(40);
    expect(evaluateObjective(ctx, s, objective({ kind: 'deliver', productId: 'bread', cityId: 3 }))).toBe(40);
    expect(evaluateObjective(ctx, s, objective({ kind: 'deliver', productId: 'bread', cityId: 4 }))).toBe(0);
    expect(evaluateObjective(ctx, s, objective({ kind: 'marketShare', productId: 'bread' }))).toBeCloseTo(0.4);
    expect(evaluateObjective(ctx, s, objective({ kind: 'vehicles' }))).toBe(0);
    expect(evaluateObjective(ctx, s, objective({ kind: 'research' }))).toBe(0);
  });

  it('resolves product candidates and falls back', () => {
    const ctx = makeCtx();
    startNewGame(ctx, { seed: 2, mapWidth: 32, mapHeight: 32, rivals: 0 });
    const ok = resolveObjective(ctx, ctx.state, { id: 'a', kind: 'deliver', title: 'Sprzedaj {product}', products: ['nope', 'bread'], target: 5 });
    expect(ok?.obj.productId).toBe('bread');
    expect(ok?.obj.title).toContain(ctx.data.products.bread!.name);
    const fb = resolveObjective(ctx, ctx.state, { id: 'b', kind: 'deliver', title: 'x', products: ['nope'], target: 5, fallback: { kind: 'cash', title: 'Gotówka', target: 10 } });
    expect(fb?.obj).toMatchObject({ id: 'b', kind: 'cash', target: 10 });
    expect(resolveObjective(ctx, ctx.state, { id: 'c', kind: 'deliver', title: 'x', products: ['nope'], target: 5 })).toBeNull();
  });
});

describe('campaign', () => {
  it('every scenario starts headless with resolved objectives', () => {
    for (const sc of SCENARIOS) {
      const ctx = makeCtx();
      const opts = { ...scenarioInfo(sc).options, mapWidth: 48, mapHeight: 48 };
      startNewGame(ctx, opts);
      const s = ctx.state;
      expect(s.goals.scenarioId).toBe(sc.id);
      expect(s.goals.objectives.length).toBeGreaterThanOrEqual(3);
      expect(s.goals.objectives.some((o) => !o.optional)).toBe(true);
      expect(Object.values(s.companies).filter((c) => c.ai).length).toBe(sc.options.rivals ?? 0);
      if (sc.tutorial) expect(s.advisor.tutorialStep).toBe(0);
      ctx.sim.advanceDays(10);
    }
  });

  it('completes objectives, pays rewards, wins and unlocks the next scenario', () => {
    const ctx = makeCtx();
    const events: string[] = [];
    ctx.bus.on('goal:completed', (e) => events.push(`done:${e.objectiveId}`));
    ctx.bus.on('game:won', () => events.push('won'));
    startNewGame(ctx, scenarioInfo(SCENARIOS[0]!).options);
    const s = ctx.state;
    const player = s.companies[s.playerCompanyId]!;
    const cash0 = player.cash;
    ctx.bus.emit('sale', { companyId: player.id, buildingId: 1, cityId: 0, productId: 'bread', qty: 500, revenue: 0 });
    ctx.sim.advanceDays(1);
    const sold = s.goals.objectives.find((o) => o.id === 'bread_sold')!;
    expect(sold.done).toBe(true);
    expect(player.cash).toBe(cash0 + sold.reward);
    expect(s.goals.status).toBe('playing');
    // profit objective: fake a closed month with profit
    player.finances.history.push({ year: 1850, month: 1, ledger: {}, revenue: 5000, expenses: 1000, profit: 4000, cashEnd: 0 });
    ctx.sim.advanceDays(1);
    expect(s.goals.status).toBe('won');
    expect(events).toContain('won');
    expect(events).toContain('done:bread_profit');
    expect(isUnlocked(loadCampaign(), 'rail')).toBe(true);
  });

  it('fails a required objective after its deadline → defeat', () => {
    const ctx = makeCtx();
    let lost = false;
    ctx.bus.on('game:lost', () => (lost = true));
    startNewGame(ctx, scenarioInfo(SCENARIOS[1]!).options);
    const s = ctx.state;
    const o = s.goals.objectives.find((x) => x.deadlineDay !== null && !x.optional)!;
    o.deadlineDay = s.time.totalDays + 1;
    ctx.sim.advanceDays(3);
    expect(o.failed).toBe(true);
    expect(s.goals.status).toBe('lost');
    expect(lost).toBe(true);
  });
});

describe('milestones & advisor', () => {
  it('awards milestones and gives start tips', () => {
    const ctx = makeCtx();
    const ms: string[] = [];
    const tips: string[] = [];
    ctx.bus.on('milestone', (m) => ms.push(m.id));
    ctx.bus.on('advisor:tip', (t) => tips.push(t.id));
    startNewGame(ctx, { seed: 3, mapWidth: 48, mapHeight: 48, rivals: 0 });
    const s = ctx.state;
    expect(analyse(ctx, { ...s, time: { ...s.time, totalDays: 10 } }).some((t) => t.id === 'start')).toBe(true);
    ctx.sim.advanceDays(6);
    expect(tips).toContain('start');
    // build something for the player
    let built = false;
    for (let y = 1; y < 40 && !built; y += 2)
      for (let x = 1; x < 40 && !built; x += 2) built = ctx.services.economy.build(s.playerCompanyId, 'shop_food', x, y, 0).ok || built;
    expect(built).toBe(true);
    ctx.sim.advanceDays(6);
    expect(ms).toContain('first_building');
    expect(s.goals.milestones.first_building).toBeGreaterThan(0);
    // advisor respects the toggle
    ctx.userSettings.advisorEnabled = false;
    const before = tips.length;
    s.advisor.lastTipDay = 0;
    s.advisor.tipsShown = {};
    advisorSystem(s, 1, ctx);
    expect(tips.length).toBe(before);
  });

  it('tutorial advances when the player builds a grain farm', () => {
    const ctx = makeCtx();
    startNewGame(ctx, scenarioInfo(SCENARIOS[0]!).options);
    const s = ctx.state;
    s.advisor.tutorialStep = 2; // "build a farm"
    const farm = ctx.data.buildingList().find((b) => b.recipes.some((r) => ctx.data.recipes[r]?.outputs.some((o) => o.product === 'grain')));
    if (!farm) return;
    let ok = false;
    for (let y = 1; y < s.map.height - 4 && !ok; y++)
      for (let x = 1; x < s.map.width - 4 && !ok; x++) ok = ctx.services.economy.build(s.playerCompanyId, farm.id, x, y, 0).ok;
    if (!ok) return; // no fertile land on this map
    expect(s.advisor.tutorialStep).toBe(3);
  });
});
