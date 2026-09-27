import { describe, expect, it } from 'vitest';
import { startNewGame } from '../core/lifecycle';
import { addMoney } from '../core/money';
import { checkLedgers, createSimContext, scanState } from '../core/qa';
import { monopolyStatus } from '../game/milestones';
import { buyCompany, companyTakeoverQuote } from './takeover';

describe('hostile takeover of a whole company', () => {
  it('transfers all assets, stops the rival and counts towards "Monopolista"', () => {
    const ctx = createSimContext();
    startNewGame(ctx, { seed: 31, mapWidth: 96, mapHeight: 96, rivals: 2, difficulty: 'normal' });
    const st = () => ctx.state;
    const pid = st().playerCompanyId;
    const rivals = Object.values(st().companies).filter((c) => c.ai);
    expect(rivals).toHaveLength(2);

    // too early: a rival can be taken over only a year after it was founded
    expect(companyTakeoverQuote(ctx, pid, rivals[0]!.id)?.blocked).toBeTruthy();
    expect(buyCompany(ctx, pid, rivals[0]!.id).ok).toBe(false);

    ctx.sim.advanceDays(400);
    const target = rivals[0]!;
    const q = companyTakeoverQuote(ctx, pid, target.id)!;
    expect(q.blocked).toBeNull();
    expect(q.price).toBeGreaterThan(0);
    // not enough cash → refused, nothing changes
    const poor = buyCompany(ctx, pid, target.id);
    if (st().companies[pid]!.cash < q.price) expect(poor.ok).toBe(false);

    addMoney(ctx, pid, q.price * 3 + 1_000_000, 'otherIncome');
    const own = (id: number) => ({
      b: Object.values(st().buildings).filter((b) => b.owner === id).length,
      v: Object.values(st().vehicles).filter((v) => v.owner === id).length,
      r: Object.values(st().routes).filter((r) => r.owner === id).length,
    });
    const before = own(pid);
    const theirs = own(target.id);
    expect(theirs.b).toBeGreaterThan(0);
    const cashBefore = st().companies[pid]!.cash;
    const targetCash = target.cash;
    const res = buyCompany(ctx, pid, target.id);
    expect(res.ok).toBe(true);
    expect(own(target.id)).toEqual({ b: 0, v: 0, r: 0 });
    expect(own(pid)).toEqual({ b: before.b + theirs.b, v: before.v + theirs.v, r: before.r + theirs.r });
    expect(Array.from(st().network.owner).includes(target.id)).toBe(false);
    expect(st().companies[pid]!.cash).toBeCloseTo(cashBefore - q.price + targetCash, 0);
    expect(target.acquiredBy).toBe(pid);
    expect(target.bankrupt).toBe(true);
    expect(target.cash).toBe(0);
    expect(target.loans).toHaveLength(0);
    expect(buyCompany(ctx, pid, target.id).ok).toBe(false); // already taken over

    // the simulation carries on; the acquired company never acts again
    ctx.sim.advanceDays(95);
    expect(own(target.id)).toEqual({ b: 0, v: 0, r: 0 });
    expect(scanState(st())).toEqual([]);
    expect(checkLedgers(st())).toEqual([]);
    expect(st().goals.milestones.monopolist).toBeUndefined();

    // take over the second rival → sandbox victory milestone
    const second = rivals[1]!;
    const q2 = companyTakeoverQuote(ctx, pid, second.id)!;
    addMoney(ctx, pid, q2.price + 1_000_000, 'otherIncome');
    expect(buyCompany(ctx, pid, second.id).ok).toBe(true);
    expect(monopolyStatus(ctx, st()).rivalsLeft).toBe(0);
    ctx.sim.advanceDays(6);
    expect(st().goals.milestones.monopolist).toBeDefined();
  });
});
