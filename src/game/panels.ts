/**
 * Game panels: 'campaign' (main menu), 'scenarioBriefing', 'objectives',
 * 'scenarioResult' (victory/defeat), 'tutorial'. Browser only.
 */
import type { GameContext } from '../core/context';
import { formatDate, formatMoney } from '../core/format';
import { endGame, startNewGame } from '../core/lifecycle';
import type { Objective } from '../core/types';
import { button, progressBar, section } from '../ui/components';
import { h, setChildren } from '../ui/dom';
import type { PanelDef } from '../ui/types';
import { isUnlocked, loadCampaign, nextScenarioId } from './campaign';
import { currentScenario, updateObjectives } from './goals';
import { milestoneList } from './milestones';
import { formatProgress, objectiveRatio, type ObjectiveSpec } from './objectives';
import { SCENARIOS, scenarioById, scenarioInfo, type ScenarioDef } from './scenarios';
import { gameExt } from './tracking';
import { advanceTutorial, currentStep, skipTutorial, TUTORIAL_STEPS } from './tutorial';

const stars = (n: number): string => '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));

export function startScenario(ctx: GameContext, id: string): void {
  const sc = scenarioById(id);
  if (!sc) return;
  try {
    ctx.services.audio.unlock();
  } catch {
    /* ignore */
  }
  ctx.ui.closePanel('campaign');
  startNewGame(ctx, scenarioInfo(sc).options);
}

/** "🔒 requires research" note when the objective's product is not unlocked yet. */
function lockNote(ctx: GameContext | undefined, o: Objective): HTMLElement | null {
  if (!ctx || !o.productId || o.done || !ctx.hasGame) return null;
  let unlocked = true;
  try {
    unlocked = ctx.services.economy.isUnlocked(ctx.state.playerCompanyId, 'product', o.productId);
  } catch {
    unlocked = true;
  }
  if (unlocked) return null;
  const tech = ctx.data.products[o.productId]?.requiresTech;
  const name = tech ? (ctx.data.techs[tech]?.name ?? tech) : null;
  return h('div', { class: 'ig-small ig-warn' }, `🔒 ${name ? `Wymaga badania: ${name}` : 'Produkt dostępny w późniejszej epoce'} (🔬 Badania)`);
}

function objectiveRow(o: Objective, state: { time: { totalDays: number } } | null, ctx?: GameContext): HTMLElement {
  const bar = progressBar(objectiveRatio(o), { label: formatProgress(o), color: o.failed ? 'var(--danger)' : o.done ? 'var(--success)' : undefined });
  const status = o.done ? '✅' : o.failed ? '❌' : o.optional ? '⭐' : '🎯';
  let deadline = '';
  if (o.deadlineDay !== null && state && !o.done && !o.failed) {
    const left = o.deadlineDay - state.time.totalDays;
    deadline = left >= 360 ? `pozostało ${Math.floor(left / 360)} l. ${Math.floor((left % 360) / 30)} mies.` : `pozostało ${Math.max(0, Math.floor(left / 30))} mies.`;
  } else if (o.deadlineDay !== null && !state) {
    deadline = 'z terminem';
  }
  return h(
    'div',
    { class: `ig-goal${o.done ? ' done' : ''}${o.failed ? ' failed' : ''}` },
    h('div', { class: 'ig-row' }, h('span', null, status), h('span', { class: 'ig-grow ig-strong' }, o.title), o.optional ? h('span', { class: 'ig-small ig-muted' }, 'dodatkowy') : null),
    o.description ? h('div', { class: 'ig-small ig-muted' }, o.description) : null,
    lockNote(ctx, o),
    bar.el,
    h(
      'div',
      { class: 'ig-row ig-small ig-muted' },
      deadline ? h('span', null, `⌛ ${deadline}`) : null,
      o.reward > 0 ? h('span', { class: 'ig-grow', style: { textAlign: 'right' } }, `Nagroda: ${formatMoney(o.reward, true)}`) : null,
    ),
  );
}

// ---------------------------------------------------------------- campaign
/** Objective title for the briefing / campaign list (before the map exists). */
function previewTitle(ctx: GameContext, o: ObjectiveSpec): string {
  const pid = o.products?.find((p) => ctx.data.products[p]);
  if (o.products && !pid && o.fallback) return o.fallback.title;
  const pName = pid ? (ctx.data.products[pid]?.name ?? pid) : 'towar';
  const tech = o.techs?.map((t) => ctx.data.techs[t]?.name).find(Boolean) ?? '';
  return o.title
    .replaceAll('{product}', pName)
    .replace(/w mieście \{city\}/g, 'w największym mieście')
    .replaceAll('{city}', 'wybranym mieście')
    .replaceAll('{tech}', tech);
}

export const campaignPanel: PanelDef = {
  id: 'campaign',
  title: 'Kampania',
  icon: '🎖',
  width: 720,
  refreshMs: 0,
  create(p, ctx) {
    const progress = loadCampaign();
    let selected: ScenarioDef = SCENARIOS.find((s) => isUnlocked(progress, s.id) && !progress.completed[s.id]) ?? SCENARIOS[0]!;
    const list = h('div', { class: 'ig-campaign-list' });
    const detail = h('div', { class: 'ig-campaign-detail' });
    p.body.append(h('div', { class: 'ig-campaign' }, list, detail));
    const render = (): void => {
      setChildren(
        list,
        SCENARIOS.map((s, i) => {
          const unlocked = isUnlocked(progress, s.id);
          const done = !!progress.completed[s.id];
          return h(
            'div',
            {
              class: `ig-campaign-card${s === selected ? ' active' : ''}${unlocked ? '' : ' locked'}`,
              onclick: () => {
                selected = s;
                ctx.bus.emit('sfx', { id: 'click' });
                render();
              },
            },
            h('div', { class: 'ig-campaign-icon' }, unlocked ? s.icon : '🔒'),
            h(
              'div',
              { class: 'ig-grow' },
              h('div', { class: 'ig-strong' }, `${i + 1}. ${s.name}`),
              h('div', { class: 'ig-small ig-muted' }, `${s.year} · ${stars(s.difficulty)}`),
            ),
            done ? h('span', { title: 'Ukończony' }, '✅') : null,
          );
        }),
      );
      const s = selected;
      const unlocked = isUnlocked(progress, s.id);
      const done = progress.completed[s.id];
      setChildren(
        detail,
        h('div', { class: 'ig-campaign-title' }, `${s.icon} ${s.name}`),
        h('div', { class: 'ig-small ig-muted' }, `Rok ${s.year} · trudność ${stars(s.difficulty)}${s.tutorial ? ' · samouczek' : ''}`),
        s.intro.map((t) => h('p', { class: 'ig-campaign-intro' }, t)),
        section(
          'Cele',
          h(
            'ul',
            { class: 'ig-campaign-goals' },
            s.objectives.map((o) => h('li', { class: o.optional ? 'ig-muted' : '' }, `${o.optional ? '⭐' : '🎯'} ${previewTitle(ctx, o)}`)),
          ),
        ),
        done ? h('div', { class: 'ig-small ig-pos' }, `Ukończono w ${Math.round(done.days / 30)} mies. gry.`) : null,
        h(
          'div',
          { class: 'ig-row ig-row-end' },
          unlocked ? null : h('span', { class: 'ig-small ig-muted ig-grow' }, 'Ukończ poprzedni scenariusz, aby odblokować.'),
          button(done ? 'Zagraj ponownie' : 'Rozpocznij', () => startScenario(ctx, s.id), { variant: 'primary', icon: '▶', disabled: !unlocked }),
        ),
      );
    };
    render();
  },
};

// ---------------------------------------------------------------- briefing
export const briefingPanel: PanelDef = {
  id: 'scenarioBriefing',
  title: 'Odprawa',
  icon: '📜',
  width: 520,
  refreshMs: 0,
  create(p, ctx) {
    const st = ctx.tryState();
    const sc = currentScenario(st);
    if (!st || !sc) {
      p.body.append(h('div', { class: 'ig-muted' }, 'Brak scenariusza.'));
      return;
    }
    p.setTitle(`${sc.icon} ${sc.name}`);
    const go = (): void => {
      p.close();
    };
    setChildren(
      p.body,
      h('div', { class: 'ig-small ig-muted' }, formatDate(st.time)),
      sc.intro.map((t) => h('p', { class: 'ig-campaign-intro' }, t)),
      section('Cele', st.goals.objectives.map((o) => objectiveRow(o, st, ctx))),
      h('div', { class: 'ig-row ig-row-end' }, button('Do dzieła!', go, { variant: 'primary', icon: '▶' })),
    );
    p.onClose = () => {
      ctx.sim.setPaused(false);
      if (st.advisor.tutorialStep >= 0) ctx.ui.openPanel('tutorial');
    };
  },
};

// ---------------------------------------------------------------- objectives
export const objectivesPanel: PanelDef = {
  id: 'objectives',
  title: 'Cele i osiągnięcia',
  icon: '🎯',
  width: 420,
  position: 'right',
  refreshMs: 1000,
  create(p, ctx) {
    p.onUpdate = () => {
      const st = ctx.tryState();
      if (!st) return;
      if (st.goals.status === 'playing') updateObjectives(ctx, st);
      const sc = currentScenario(st);
      const ms = milestoneList(ctx, st);
      const reached = ms.filter((m) => m.day !== null);
      setChildren(
        p.body,
        sc ? h('div', { class: 'ig-strong' }, `${sc.icon} ${sc.name}`) : h('div', { class: 'ig-muted ig-small' }, 'Tryb swobodny — kamienie milowe pojawiają się same.'),
        st.goals.status !== 'playing' ? h('div', { class: st.goals.status === 'won' ? 'ig-pos' : 'ig-neg' }, st.goals.status === 'won' ? '🏆 Scenariusz wygrany' : '💀 Scenariusz przegrany') : null,
        st.goals.objectives.length ? section('Cele scenariusza', st.goals.objectives.map((o) => objectiveRow(o, st, ctx))) : null,
        section(
          `Kamienie milowe (${reached.length}/${ms.length})`,
          h(
            'div',
            { class: 'ig-milestones' },
            ms.map((m) =>
              h('div', { class: `ig-milestone${m.day !== null ? ' done' : ''}`, title: m.text }, h('span', { class: 'ig-milestone-icon' }, m.day !== null ? m.icon : '◻️'), h('span', null, m.title)),
            ),
          ),
        ),
      );
    };
  },
};

// ---------------------------------------------------------------- result
export const resultPanel: PanelDef = {
  id: 'scenarioResult',
  title: 'Koniec scenariusza',
  icon: '🏁',
  width: 460,
  refreshMs: 0,
  create(p, ctx) {
    const args = (p.args ?? {}) as { won?: boolean; reason?: string };
    const st = ctx.tryState();
    const sc = currentScenario(st);
    const won = !!args.won;
    p.setTitle(won ? 'Zwycięstwo!' : 'Porażka');
    const player = st?.companies[st.playerCompanyId];
    const days = st ? st.time.totalDays - gameExt(st).startDay : 0;
    const next = sc ? nextScenarioId(sc.id) : null;
    const nextSc = next ? scenarioById(next) : undefined;
    setChildren(
      p.body,
      h('div', { class: `ig-result ${won ? 'won' : 'lost'}` }, h('div', { class: 'ig-result-icon' }, won ? '🏆' : '💀'), h('div', { class: 'ig-result-title' }, won ? 'Scenariusz ukończony!' : 'Scenariusz nieudany')),
      h('p', null, sc ? (won ? sc.victoryText : sc.defeatText) : args.reason ?? ''),
      args.reason ? h('div', { class: 'ig-small ig-muted' }, args.reason) : null,
      player
        ? section(
            'Podsumowanie',
            h('div', { class: 'ig-small' }, `Czas gry: ${Math.floor(days / 360)} l. ${Math.floor((days % 360) / 30)} mies.`),
            h('div', { class: 'ig-small' }, `Gotówka: ${formatMoney(player.cash)}`),
            h('div', { class: 'ig-small' }, `Wartość firmy: ${formatMoney(ctx.services.economy.companyValue(player.id))}`),
            h('div', { class: 'ig-small' }, `Kamienie milowe: ${Object.keys(st!.goals.milestones).length}`),
          )
        : null,
      h(
        'div',
        { class: 'ig-row ig-row-end', style: { flexWrap: 'wrap' } },
        button('Menu główne', () => {
          p.close();
          endGame(ctx);
        }, { variant: 'ghost' }),
        !won && sc ? button('Spróbuj ponownie', () => startScenario(ctx, sc.id), { icon: '↻' }) : null,
        won ? button('Graj dalej', () => {
          p.close();
          ctx.sim.setPaused(false);
        }) : null,
        won && nextSc ? button(`Dalej: ${nextSc.name}`, () => startScenario(ctx, nextSc.id), { variant: 'primary', icon: '▶' }) : null,
      ),
    );
  },
};

// ---------------------------------------------------------------- tutorial
export const tutorialPanel: PanelDef = {
  id: 'tutorial',
  title: 'Samouczek',
  icon: '🧑‍🏫',
  width: 340,
  position: 'left',
  refreshMs: 1000,
  create(p, ctx) {
    let shown = -2;
    p.onUpdate = () => {
      const st = ctx.tryState();
      const step = currentStep(st);
      if (!st || !step) {
        p.close();
        return;
      }
      if (shown === st.advisor.tutorialStep) return;
      shown = st.advisor.tutorialStep;
      const n = st.advisor.tutorialStep;
      setChildren(
        p.body,
        h('div', { class: 'ig-small ig-muted' }, `Krok ${n + 1} z ${TUTORIAL_STEPS.length}`),
        progressBar(n / (TUTORIAL_STEPS.length - 1)).el,
        h('div', { class: 'ig-tut-title' }, step.title),
        h('p', { class: 'ig-tut-text' }, step.text),
        step.done ? h('div', { class: 'ig-small ig-muted' }, '⏳ Krok zaliczy się automatycznie po wykonaniu zadania.') : null,
        h(
          'div',
          { class: 'ig-row ig-row-end' },
          button('Pomiń samouczek', () => skipTutorial(ctx), { variant: 'ghost', small: true }),
          step.target
            ? button('Pokaż', () => {
                const t = step.target!(ctx, st);
                if (t) ctx.bus.emit('camera:focus', { x: t.x, y: t.y, zoom: 1.5 });
              }, { small: true })
            : null,
          !step.done ? button(n === TUTORIAL_STEPS.length - 1 ? 'Zakończ' : 'Dalej', () => advanceTutorial(ctx), { variant: 'primary', small: true }) : null,
        ),
      );
    };
  },
};
