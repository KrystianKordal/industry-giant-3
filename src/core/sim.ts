/**
 * Fixed-step simulation loop + system registry + calendar.
 *
 *  - 1 tick = 1/TICKS_PER_DAY game day. At 1x speed, 1 game day ≈ MS_PER_DAY ms.
 *  - Systems are plain functions (state, dt, ctx) run in ascending `order`.
 *  - period 'tick'  → every tick, dt = 1/TICKS_PER_DAY (days)
 *    period 'day'   → once when a new day starts, dt = 1
 *    period 'month' → once when a new month starts, dt = DAYS_PER_MONTH
 *    period 'year'  → once when a new year starts, dt = DAYS_PER_YEAR
 *  - Per tick: calendar advances FIRST, then systems run (so day/month
 *    systems see the NEW date; "the month that just closed" is the previous one),
 *    then time events are emitted (time:tick, time:day, time:month, …).
 *  - Registering with an existing name replaces the previous system.
 *
 * Rendering is independent (rAF in render/renderer.ts) and may interpolate with `sim.alpha`.
 */
import { DAYS_PER_MONTH, DAYS_PER_YEAR, MAX_TICKS_PER_UPDATE, MONTHS_PER_YEAR, MS_PER_DAY, TICKS_PER_DAY } from './constants';
import type { GameContext } from './context';
import type { GameSpeed, GameState, Season, TimeState } from './types';

export type SystemPeriod = 'tick' | 'day' | 'month' | 'year';
export type SystemFn = (state: GameState, dt: number, ctx: GameContext) => void;

export interface SystemOptions {
  period?: SystemPeriod;
}

export interface SystemEntry {
  name: string;
  order: number;
  period: SystemPeriod;
  fn: SystemFn;
  enabled: boolean;
  /** Exponential moving average of run time (ms) — for the debug overlay. */
  avgMs: number;
  errors: number;
}

/**
 * Canonical system order (lower runs first). Use these (± small offsets) when
 * registering, e.g. registerSystem('production', SystemOrder.production, fn).
 */
export const SystemOrder = {
  era: 50, // core: era from calendar
  weather: 100, // world
  events: 150, // world: disasters & political events
  workforce: 200, // economy
  production: 300, // economy
  logistics: 400, // logistics: vehicles, loading, routes
  market: 500, // economy: prices
  cities: 550, // world: demand, growth, houses
  ecology: 600, // economy
  research: 700, // economy
  finance: 800, // economy: upkeep, loans, monthly close
  ai: 900, // ai
  goals: 1000, // game
  advisor: 1050, // game
  stats: 1100, // core/game: sample time series
} as const;

// ---------------------------------------------------------------- calendar
export function seasonOf(month: number): Season {
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

export interface CalendarChange {
  dayChanged: boolean;
  monthChanged: boolean;
  yearChanged: boolean;
  seasonChanged: boolean;
}

/** Advance the calendar by one tick (pure on TimeState). */
export function advanceCalendar(time: TimeState): CalendarChange {
  const ch: CalendarChange = { dayChanged: false, monthChanged: false, yearChanged: false, seasonChanged: false };
  time.tick++;
  const inDay = time.tick % TICKS_PER_DAY;
  time.dayFraction = inDay / TICKS_PER_DAY;
  if (inDay !== 0) return ch;
  ch.dayChanged = true;
  time.totalDays++;
  time.day++;
  if (time.day > DAYS_PER_MONTH) {
    time.day = 1;
    time.month++;
    ch.monthChanged = true;
    if (time.month > MONTHS_PER_YEAR) {
      time.month = 1;
      time.year++;
      ch.yearChanged = true;
    }
    const s = seasonOf(time.month);
    if (s !== time.season) {
      time.season = s;
      ch.seasonChanged = true;
    }
  }
  return ch;
}

// ---------------------------------------------------------------- sim
export class Sim {
  private list: SystemEntry[] = [];
  private acc = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastReal = 0;
  /** Fraction (0..1) of progress toward the next tick — for render interpolation. */
  alpha = 0;
  /** Rethrow system errors instead of logging (tests). */
  throwOnError = false;

  constructor(private readonly ctx: GameContext) {}

  // ------------------------------------------------------------ registry
  registerSystem(name: string, order: number, fn: SystemFn, opts: SystemOptions = {}): void {
    this.list = this.list.filter((s) => s.name !== name);
    this.list.push({ name, order, fn, period: opts.period ?? 'tick', enabled: true, avgMs: 0, errors: 0 });
    this.list.sort((a, b) => a.order - b.order);
  }
  unregisterSystem(name: string): void {
    this.list = this.list.filter((s) => s.name !== name);
  }
  setSystemEnabled(name: string, enabled: boolean): void {
    const s = this.list.find((e) => e.name === name);
    if (s) s.enabled = enabled;
  }
  systems(): readonly SystemEntry[] {
    return this.list;
  }

  // ------------------------------------------------------------ speed
  get paused(): boolean {
    return this.ctx.tryState()?.time.paused ?? true;
  }
  setSpeed(speed: GameSpeed): void {
    const st = this.ctx.tryState();
    if (!st) return;
    st.time.speed = speed;
    st.time.paused = false;
    this.ctx.bus.emit('time:speed', { speed, paused: false });
  }
  setPaused(paused: boolean): void {
    const st = this.ctx.tryState();
    if (!st || st.time.paused === paused) return;
    st.time.paused = paused;
    this.ctx.bus.emit('time:speed', { speed: st.time.speed, paused });
  }
  togglePause(): void {
    this.setPaused(!this.paused);
  }

  // ------------------------------------------------------------ driving
  /** Start the real-time driver (idempotent). */
  start(): void {
    if (this.timer) return;
    this.lastReal = now();
    this.acc = 0;
    this.timer = setInterval(() => {
      const t = now();
      const dt = t - this.lastReal;
      this.lastReal = t;
      this.update(dt);
    }, 1000 / 60);
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.acc = 0;
    this.alpha = 0;
  }
  get running(): boolean {
    return this.timer !== null;
  }

  /** Feed real elapsed milliseconds; runs as many ticks as speed requires. */
  update(realMs: number): void {
    const st = this.ctx.tryState();
    if (!st || st.time.paused) {
      this.alpha = 0;
      return;
    }
    realMs = Math.min(realMs, 250); // tab switch / breakpoint guard
    st.meta.playTimeSec += realMs / 1000;
    const msPerTick = MS_PER_DAY / TICKS_PER_DAY / st.time.speed;
    this.acc += realMs;
    let n = 0;
    while (this.acc >= msPerTick && n < MAX_TICKS_PER_UPDATE) {
      this.acc -= msPerTick;
      this.tick(st);
      n++;
      if (st.time.paused || this.ctx.tryState() !== st) break;
    }
    if (n >= MAX_TICKS_PER_UPDATE) this.acc = 0; // drop backlog
    this.alpha = Math.min(1, this.acc / msPerTick);
  }

  /** Run `n` ticks synchronously (ignores pause). For tests & fast-forward. */
  step(n = 1): void {
    const st = this.ctx.tryState();
    if (!st) throw new Error('Sim.step: brak aktywnej gry');
    for (let i = 0; i < n; i++) this.tick(st);
  }
  /** Run whole days synchronously. */
  advanceDays(days: number): void {
    this.step(Math.round(days * TICKS_PER_DAY));
  }

  private tick(st: GameState): void {
    const ch = advanceCalendar(st.time);
    for (const s of this.list) {
      if (!s.enabled) continue;
      let dt: number;
      switch (s.period) {
        case 'tick':
          dt = 1 / TICKS_PER_DAY;
          break;
        case 'day':
          if (!ch.dayChanged) continue;
          dt = 1;
          break;
        case 'month':
          if (!ch.monthChanged) continue;
          dt = DAYS_PER_MONTH;
          break;
        case 'year':
          if (!ch.yearChanged) continue;
          dt = DAYS_PER_YEAR;
          break;
      }
      const t0 = now();
      try {
        s.fn(st, dt, this.ctx);
      } catch (err) {
        s.errors++;
        if (this.throwOnError) throw err;
        if (s.errors <= 5) console.error(`[sim] system "${s.name}" failed`, err);
      }
      s.avgMs = s.avgMs * 0.95 + (now() - t0) * 0.05;
    }
    const bus = this.ctx.bus;
    const t = st.time;
    bus.emit('time:tick', { tick: t.tick });
    if (ch.dayChanged) bus.emit('time:day', { day: t.day, month: t.month, year: t.year, totalDays: t.totalDays });
    if (ch.monthChanged) bus.emit('time:month', { month: t.month, year: t.year });
    if (ch.yearChanged) bus.emit('time:year', { year: t.year });
    if (ch.seasonChanged) bus.emit('time:season', { season: t.season });
  }
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
