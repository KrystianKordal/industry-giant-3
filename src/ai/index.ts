/**
 * ai module — rival companies. Owner: AI/game/audio agent.
 *
 *  - new-game step 'ai' (NewGameStepOrder.ai): creates `options.rivals` AI companies
 *  - system 'ai' (SystemOrder.ai, period 'day'): time-budgeted planner (competitor.ts)
 *  - ctx.services.ai: buildingPrice / buyBuilding (takeover.ts)
 *  - panels 'rivals' and 'takeover' + toolbar button (manage group)
 * AI acts only through ctx.services.* and never creates money.
 */
import type { GameContext } from '../core/context';
import { createCompany } from '../core/entities';
import { createRng, hashSeed, rng } from '../core/rng';
import { SystemOrder } from '../core/sim';
import { NewGameStepOrder, START_CASH } from '../core/state';
import type { AIPersonality, Difficulty, GameState, NewGameOptions } from '../core/types';
import { clamp } from '../core/util';
import { resetAnalysisCache } from './analysis';
import { liquidate, think } from './competitor';
import { rivalsPanel, takeoverPanel } from './panels';
import { DIFFICULTY, PERSONALITIES, PERSONALITY_POOL, RIVAL_COLORS, RIVAL_LOGOS, RIVAL_NAMES } from './profiles';
import { createAiService } from './takeover';

/** Real-time budget (ms) for AI thinking per game day. */
export const AI_BUDGET_MS = 8;

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export interface RivalSpec {
  name?: string;
  personality?: AIPersonality;
  difficulty?: Difficulty;
  cash?: number;
}

/** Create rival companies (new-game step). Scenarios may call it with explicit specs. */
export function createRivals(state: GameState, options: NewGameOptions, ctx: GameContext, specs?: RivalSpec[]): void {
  const count = specs ? specs.length : clamp(Math.round(options.rivals ?? 0), 0, 7);
  if (count <= 0) return;
  const r = rng(createRng(hashSeed(options.seed, 'ai-rivals')));
  const taken = new Set(Object.values(state.companies).map((c) => c.name));
  const names = r.shuffle(RIVAL_NAMES.filter((n) => !taken.has(n)));
  const usedColors = new Set(Object.values(state.companies).map((c) => c.color.toLowerCase()));
  const colors = RIVAL_COLORS.filter((c) => !usedColors.has(c.toLowerCase()));
  const logos = r.shuffle([...RIVAL_LOGOS]);
  const pool = r.shuffle([...PERSONALITY_POOL]);
  // Home regions: spread over the biggest cities.
  const cities = Object.values(state.cities).sort((a, b) => b.population.poor + b.population.middle + b.population.rich - (a.population.poor + a.population.middle + a.population.rich));
  for (let i = 0; i < count; i++) {
    const spec = specs?.[i] ?? {};
    const difficulty: Difficulty = spec.difficulty ?? options.difficulty ?? 'normal';
    const personality: AIPersonality = spec.personality ?? pool[i % pool.length]!;
    const cash = spec.cash ?? Math.round(START_CASH.normal * DIFFICULTY[difficulty].startCash);
    const home = cities.length ? cities[(i + 1) % cities.length]! : null;
    const c = createCompany(state, {
      name: spec.name ?? names[i % names.length] ?? `Rywal ${i + 1}`,
      color: colors[i % Math.max(1, colors.length)] ?? RIVAL_COLORS[i % RIVAL_COLORS.length]!,
      isPlayer: false,
      cash,
      logo: logos[i % logos.length],
      ai: {
        personality,
        difficulty,
        nextThinkDay: 2 + i * 3,
        focusProducts: [],
        plans: [],
        memory: { rng: hashSeed(options.seed, 'ai', i) },
      },
    });
    c.hq = home ? { x: home.x, y: home.y } : { x: Math.floor(state.map.width / 2), y: Math.floor(state.map.height / 2) };
    c.creditLimit = Math.round(cash * 0.8);
    ctx.bus.emit('company:created', { companyId: c.id });
  }
}

/** AI system: runs due companies within a real-time budget. */
export function aiSystem(state: GameState, _dt: number, ctx: GameContext): void {
  const t0 = now();
  const today = state.time.totalDays;
  for (const c of Object.values(state.companies)) {
    const ai = c.ai;
    if (!ai || c.isPlayer) continue;
    if (ai.nextThinkDay > today) continue;
    if (now() - t0 > AI_BUDGET_MS) break; // the rest thinks tomorrow
    const pers = PERSONALITIES[ai.personality] ?? PERSONALITIES.balanced;
    const diff = DIFFICULTY[ai.difficulty] ?? DIFFICULTY.normal;
    ai.nextThinkDay = today + Math.max(2, Math.round(diff.thinkDays * pers.tempo));
    try {
      think(ctx, c);
    } catch (err) {
      if (ctx.sim.throwOnError) throw err;
      console.error(`[ai] ${c.name}: planner failed`, err);
    }
  }
}

export function init(ctx: GameContext): void {
  ctx.newGame.register('ai', NewGameStepOrder.ai, (state, options, c) => createRivals(state, options, c));
  ctx.sim.registerSystem('ai', SystemOrder.ai, aiSystem, { period: 'day' });
  ctx.services.ai = createAiService(ctx);

  ctx.bus.on('game:started', () => resetAnalysisCache());
  ctx.bus.on('company:bankrupt', ({ companyId }) => {
    const st = ctx.tryState();
    const c = st?.companies[companyId];
    if (!c || c.isPlayer || !c.ai) return;
    c.bankrupt = true;
    try {
      liquidate(ctx, c);
    } catch (err) {
      console.error('[ai] liquidation failed', err);
    }
  });

  ctx.ui.registerPanel(takeoverPanel);
  ctx.ui.registerPanel(rivalsPanel);
  ctx.ui.registerToolbarButton({
    id: 'rivals',
    icon: '🏢',
    label: 'Rywale',
    group: 'manage',
    order: 60,
    tooltip: 'Konkurencja: firmy AI, ich budynki i przejęcia',
    onClick: (c) => c.ui.togglePanel('rivals'),
    isActive: (c) => c.ui.isPanelOpen('rivals'),
  });
}
