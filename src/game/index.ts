/**
 * game module — campaign scenarios, objectives, milestones, advisor + tutorial.
 * Owner: AI/game/audio agent.
 *
 *  - new-game step 'scenario' (NewGameStepOrder.scenario)
 *  - systems 'goals' (SystemOrder.goals, day) and 'advisor' (SystemOrder.advisor, day)
 *  - ctx.services.game = { scenarios, currentHint }
 *  - panels: campaign, scenarioBriefing, objectives, scenarioResult, tutorial
 *  - HUD item 'goals', toolbar buttons 'objectives' & 'advisor' (manage group)
 */
import './game.css';
import type { GameContext } from '../core/context';
import { notify } from '../core/notify';
import { saveUserSettings } from '../core/settings';
import { SystemOrder } from '../core/sim';
import { NewGameStepOrder } from '../core/state';
import { advisorSystem, currentHint, onEraChanged, resetAdvisor } from './advisor';
import { goalsSystem, loseScenario, scenarioStep } from './goals';
import { checkMilestones, eraMilestone } from './milestones';
import { briefingPanel, campaignPanel, objectivesPanel, resultPanel, tutorialPanel } from './panels';
import { SCENARIOS, scenarioInfo } from './scenarios';
import { gameExt, installTracking } from './tracking';
import { checkTutorial, clearHighlights, installTutorialLayer } from './tutorial';

export { startScenario } from './panels';

export function init(ctx: GameContext): void {
  ctx.newGame.register('scenario', NewGameStepOrder.scenario, scenarioStep);
  ctx.sim.registerSystem('goals', SystemOrder.goals, goalsSystem, { period: 'day' });
  ctx.sim.registerSystem(
    'goals.milestones',
    SystemOrder.goals + 5,
    (s, _dt, c) => {
      if (s.time.totalDays % 5 === 0) checkMilestones(c, s);
    },
    { period: 'day' },
  );
  ctx.sim.registerSystem('advisor', SystemOrder.advisor, advisorSystem, { period: 'day' });
  ctx.sim.registerSystem('advisor.tutorial', SystemOrder.advisor + 5, (_s, _dt, c) => checkTutorial(c), { period: 'day' });

  Object.assign(ctx.services.game, {
    scenarios: () => SCENARIOS.map(scenarioInfo),
    currentHint: () => (ctx.hasGame ? currentHint() : null),
  });

  installTracking(ctx);

  // ------------------------------------------------------------ lifecycle
  ctx.bus.on('game:started', () => {
    resetAdvisor();
    clearHighlights();
  });
  ctx.bus.on('game:ended', () => clearHighlights());
  ctx.bus.on('game:new', ({ state }) => {
    if (ctx.headless) return;
    const ext = gameExt(state);
    if (state.goals.scenarioId && !ext.briefed) {
      ext.briefed = true;
      // Pause after the sim starts (startNewGame starts it right after game:started).
      setTimeout(() => {
        ctx.sim.setPaused(true);
        ctx.ui.openPanel('scenarioBriefing');
      }, 0);
    }
  });
  ctx.bus.on('game:loaded', ({ state }) => {
    if (!ctx.headless && state.advisor.tutorialStep >= 0) setTimeout(() => ctx.ui.openPanel('tutorial'), 0);
  });

  // ------------------------------------------------------------ reactions
  ctx.bus.on('era:changed', ({ eraId }) => {
    const st = ctx.tryState();
    if (!st) return;
    eraMilestone(ctx, st, eraId);
    onEraChanged(ctx, eraId);
  });
  ctx.bus.on('company:bankrupt', ({ companyId }) => {
    const st = ctx.tryState();
    if (!st || companyId !== st.playerCompanyId) return;
    if (st.goals.scenarioId) loseScenario(ctx, 'Twoja firma zbankrutowała.');
    else notify(ctx, { level: 'danger', icon: '💀', title: 'Bankructwo', text: 'Twoja firma zbankrutowała.', category: 'goal' });
  });
  const tut = (): void => {
    const st = ctx.tryState();
    if (st && st.advisor.tutorialStep >= 0) checkTutorial(ctx);
  };
  ctx.bus.on('building:built', tut);
  ctx.bus.on('route:created', tut);
  ctx.bus.on('vehicle:bought', tut);
  ctx.bus.on('route:changed', tut);
  ctx.bus.on('sale', ({ companyId }) => {
    const st = ctx.tryState();
    if (st && companyId === st.playerCompanyId) tut();
  });
  ctx.bus.on('settings:changed', () => {
    const st = ctx.tryState();
    if (st) st.advisor.enabled = ctx.userSettings.advisorEnabled;
  });

  // ------------------------------------------------------------ UI
  ctx.ui.registerPanel(campaignPanel);
  ctx.ui.registerPanel(briefingPanel);
  ctx.ui.registerPanel(objectivesPanel);
  ctx.ui.registerPanel(resultPanel);
  ctx.ui.registerPanel(tutorialPanel);
  installTutorialLayer(ctx);

  ctx.ui.registerToolbarButton({
    id: 'objectives',
    icon: '🎯',
    label: 'Cele',
    group: 'manage',
    order: 50,
    tooltip: 'Cele scenariusza i kamienie milowe',
    onClick: (c) => c.ui.togglePanel('objectives'),
    isActive: (c) => c.ui.isPanelOpen('objectives'),
  });
  ctx.ui.registerToolbarButton({
    id: 'advisor',
    icon: '🧑‍💼',
    label: 'Doradca',
    group: 'manage',
    order: 55,
    tooltip: 'Włącz/wyłącz podpowiedzi doradcy',
    onClick: (c) => {
      c.userSettings.advisorEnabled = !c.userSettings.advisorEnabled;
      saveUserSettings(c.userSettings);
      c.bus.emit('settings:changed', {});
      const hint = c.services.game.currentHint();
      c.ui.toast({
        level: 'info',
        icon: '🧑‍💼',
        title: c.userSettings.advisorEnabled ? 'Doradca włączony' : 'Doradca wyłączony',
        text: c.userSettings.advisorEnabled && hint ? hint : undefined,
      });
    },
    isActive: (c) => c.userSettings.advisorEnabled,
  });
  ctx.ui.registerHudItem({
    id: 'goals',
    side: 'left',
    order: 80,
    create(el, c) {
      el.classList.add('ig-hud-goals');
      el.addEventListener('click', () => c.ui.togglePanel('objectives'));
    },
    update(el, c) {
      const st = c.tryState();
      const list = st?.goals.objectives ?? [];
      const req = list.filter((o) => !o.optional);
      if (!st || !req.length) {
        el.style.display = 'none';
        return;
      }
      el.style.display = '';
      const done = req.filter((o) => o.done).length;
      const text = st.goals.status === 'won' ? '🏆 Wygrana' : st.goals.status === 'lost' ? '💀 Porażka' : `🎯 ${done}/${req.length}`;
      if (el.textContent !== text) el.textContent = text;
      el.title = req.map((o) => `${o.done ? '✅' : '▫️'} ${o.title}`).join('\n');
    },
  });
}
