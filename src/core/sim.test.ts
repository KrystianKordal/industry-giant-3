import { describe, expect, it } from 'vitest';
import { DAYS_PER_MONTH, TICKS_PER_DAY } from './constants';
import { createContext } from './context';
import { startNewGame } from './lifecycle';
import { advanceCalendar, seasonOf } from './sim';
import type { TimeState } from './types';

const time = (): TimeState => ({
  tick: 0, totalDays: 0, dayFraction: 0, day: 1, month: 1, year: 1850,
  season: 'winter', speed: 1, paused: false, eraId: 'industrial', startYear: 1850,
});

describe('calendar', () => {
  it('advances a day every TICKS_PER_DAY ticks', () => {
    const t = time();
    for (let i = 0; i < TICKS_PER_DAY - 1; i++) expect(advanceCalendar(t).dayChanged).toBe(false);
    expect(advanceCalendar(t).dayChanged).toBe(true);
    expect(t.day).toBe(2);
    expect(t.totalDays).toBe(1);
    expect(t.dayFraction).toBe(0);
  });

  it('rolls months, years and seasons', () => {
    const t = time();
    let months = 0;
    let years = 0;
    let seasons = 0;
    for (let i = 0; i < TICKS_PER_DAY * DAYS_PER_MONTH * 12; i++) {
      const c = advanceCalendar(t);
      if (c.monthChanged) months++;
      if (c.yearChanged) years++;
      if (c.seasonChanged) seasons++;
    }
    expect(months).toBe(12);
    expect(years).toBe(1);
    expect(seasons).toBe(4);
    expect(t).toMatchObject({ day: 1, month: 1, year: 1851, totalDays: 360, season: 'winter' });
    expect(seasonOf(4)).toBe('spring');
    expect(seasonOf(7)).toBe('summer');
    expect(seasonOf(10)).toBe('autumn');
  });
});

describe('sim', () => {
  it('runs systems by period and order, emits time events', () => {
    const ctx = createContext({ headless: true });
    ctx.sim.throwOnError = true;
    startNewGame(ctx, { seed: 1, mapWidth: 32, mapHeight: 32 });
    const log: string[] = [];
    let ticks = 0;
    ctx.sim.registerSystem('b', 20, () => log.push('b'), { period: 'day' });
    ctx.sim.registerSystem('a', 10, () => log.push('a'), { period: 'day' });
    ctx.sim.registerSystem('t', 5, () => ticks++);
    ctx.sim.registerSystem('m', 30, () => log.push('m'), { period: 'month' });
    let monthEvents = 0;
    ctx.bus.on('time:month', () => monthEvents++);
    ctx.sim.advanceDays(DAYS_PER_MONTH);
    expect(ticks).toBe(DAYS_PER_MONTH * TICKS_PER_DAY);
    expect(log.slice(0, 2)).toEqual(['a', 'b']);
    expect(log.filter((x) => x === 'm')).toHaveLength(1);
    expect(monthEvents).toBe(1);
    expect(ctx.state.time.month).toBe(2);
  });

  it('real-time update respects speed and pause', () => {
    const ctx = createContext({ headless: true });
    startNewGame(ctx, { seed: 2, mapWidth: 32, mapHeight: 32 });
    ctx.sim.setSpeed(2);
    for (let i = 0; i < 10; i++) ctx.sim.update(100); // 1 s real at 2x → 2 days
    expect(ctx.state.time.totalDays).toBe(2);
    ctx.sim.setPaused(true);
    ctx.sim.update(200);
    expect(ctx.state.time.totalDays).toBe(2);
  });
});
