/**
 * Scenario setup (new-game step 'scenario') and the goals system: objective
 * progress, rewards, deadlines, victory/defeat detection.
 */
import type { GameContext } from '../core/context';
import { addMoney } from '../core/money';
import { notify } from '../core/notify';
import type { GameState, NewGameOptions, Objective } from '../core/types';
import { markCompleted } from './campaign';
import { evaluateObjective, formatProgress, resolveObjective } from './objectives';
import { recordStart, scenarioById, type ScenarioDef } from './scenarios';
import { gameExt } from './tracking';
import { setupTutorial } from './tutorial';

/** New-game step: objectives, starting conditions, tutorial. */
export function scenarioStep(state: GameState, options: NewGameOptions, ctx: GameContext): void {
  const ext = gameExt(state);
  state.goals.scenarioId = options.mode === 'campaign' ? options.scenarioId ?? null : null;
  state.goals.objectives = [];
  state.goals.status = 'playing';
  state.goals.endedDay = null;
  state.advisor.enabled = ctx.userSettings.advisorEnabled;
  state.advisor.tutorialStep = -1;
  const sc = scenarioById(state.goals.scenarioId);
  if (sc?.setup) {
    try {
      sc.setup(state, ctx);
    } catch (err) {
      console.error(`[game] scenario "${sc.id}" setup failed`, err);
    }
  }
  recordStart(state);
  if (!sc) return;
  state.meta.name = `${sc.icon} ${sc.name}`;
  for (const spec of sc.objectives) {
    const r = resolveObjective(ctx, state, spec, state.time.totalDays);
    if (!r) continue;
    state.goals.objectives.push(r.obj);
    ext.meta[r.obj.id] = r.meta;
  }
  if (sc.tutorial) setupTutorial(ctx, state);
}

export function currentScenario(state: GameState | null): ScenarioDef | undefined {
  return state ? scenarioById(state.goals.scenarioId) : undefined;
}

function complete(ctx: GameContext, state: GameState, o: Objective): void {
  o.done = true;
  o.progress = Math.max(o.progress, o.target);
  if (o.reward > 0) addMoney(ctx, state.playerCompanyId, o.reward, 'subsidy');
  ctx.bus.emit('goal:completed', { objectiveId: o.id });
  ctx.bus.emit('sfx', { id: 'success' });
  notify(ctx, {
    level: 'success',
    icon: '🎯',
    title: `Cel osiągnięty: ${o.title}`,
    text: o.reward > 0 ? `Nagroda: ${o.reward.toLocaleString('pl-PL')} zł.` : o.optional ? 'Cel dodatkowy zaliczony.' : '',
    category: 'goal',
  });
}

function fail(ctx: GameContext, o: Objective): void {
  o.failed = true;
  ctx.bus.emit('goal:failed', { objectiveId: o.id });
  notify(ctx, { level: o.optional ? 'warning' : 'danger', icon: '⌛', title: `Cel nieosiągnięty: ${o.title}`, text: `Postęp: ${formatProgress(o)}`, category: 'goal' });
}

/** Mark the scenario as won. */
export function winScenario(ctx: GameContext, reason: string): void {
  const state = ctx.tryState();
  if (!state || state.goals.status !== 'playing') return;
  state.goals.status = 'won';
  state.goals.endedDay = state.time.totalDays;
  const sc = currentScenario(state);
  if (sc) markCompleted(sc.id, state.time.totalDays - gameExt(state).startDay);
  ctx.bus.emit('game:won', { reason });
  ctx.bus.emit('sfx', { id: 'victory' });
  ctx.sim.setPaused(true);
  ctx.ui.openPanel('scenarioResult', { won: true, reason });
}

/** Mark the scenario as lost. */
export function loseScenario(ctx: GameContext, reason: string): void {
  const state = ctx.tryState();
  if (!state || state.goals.status !== 'playing') return;
  state.goals.status = 'lost';
  state.goals.endedDay = state.time.totalDays;
  ctx.bus.emit('game:lost', { reason });
  ctx.bus.emit('sfx', { id: 'defeat' });
  ctx.sim.setPaused(true);
  ctx.ui.openPanel('scenarioResult', { won: false, reason });
}

/** Update objective progress (also usable from UI for fresh numbers). */
export function updateObjectives(ctx: GameContext, state: GameState): void {
  const ext = gameExt(state);
  for (const o of state.goals.objectives) {
    if (o.done || o.failed) continue;
    try {
      o.progress = evaluateObjective(ctx, state, o, ext.meta[o.id]);
    } catch (err) {
      console.warn('[game] objective eval failed', o.id, err);
      continue;
    }
    if (o.progress >= o.target) complete(ctx, state, o);
    else if (o.deadlineDay !== null && state.time.totalDays > o.deadlineDay) fail(ctx, o);
  }
}

/** Daily goals system. */
export function goalsSystem(state: GameState, _dt: number, ctx: GameContext): void {
  const player = state.companies[state.playerCompanyId];
  if (!state.goals.objectives.length) return;
  updateObjectives(ctx, state);
  if (state.goals.status !== 'playing' || !state.goals.scenarioId) return;
  if (player?.bankrupt) {
    loseScenario(ctx, 'Twoja firma zbankrutowała.');
    return;
  }
  const required = state.goals.objectives.filter((o) => !o.optional);
  if (required.some((o) => o.failed)) {
    const f = required.find((o) => o.failed)!;
    loseScenario(ctx, `Nie udało się: ${f.title}.`);
  } else if (required.length && required.every((o) => o.done)) {
    winScenario(ctx, 'Wszystkie cele scenariusza zostały osiągnięte.');
  }
}
