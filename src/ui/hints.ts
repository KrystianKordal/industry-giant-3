/**
 * Contextual help layer:
 *  - tool hint bar above the toolbar (active tool name + ToolDef.hint),
 *  - tool info card following the cursor (ToolDef.status),
 *  - advisor/mentor bubble: shows 'advisor:tip' events and the periodic
 *    ctx.services.game.currentHint() (respects userSettings.advisorEnabled).
 */
import type { GameContext } from '../core/context';
import { saveUserSettings } from '../core/settings';
import type { EntityRef } from '../core/types';
import { InputManager } from '../input/input';
import type { ToolStatus } from '../input/types';
import { button } from './components';
import { h, setChildren, setText } from './dom';
import { focusTarget, uiScale, type UiManager } from './ui';

interface Tip {
  id: string;
  text: string;
  target: EntityRef | null;
  /** Game day when the tip was raised (stale tips are dropped). */
  day?: number;
}

/** Tips older than this (game days) are skipped / auto-dismissed — they may no longer be true. */
const TIP_STALE_DAYS = 45;

export function installHints(ctx: GameContext, ui: UiManager): void {
  const input = ctx.input instanceof InputManager ? ctx.input : null;

  // ---------------------------------------------------------------- tool hint bar
  const hintText = h('span', { class: 'ig-toolhint-text' });
  const hintBar = h(
    'div',
    { class: 'ig-toolhint' },
    hintText,
    h('button', { class: 'ig-toolhint-x', title: 'Zakończ narzędzie [Esc]', onclick: () => ctx.input.setTool(null) }, '✕'),
  );
  hintBar.style.display = 'none';
  ui.root.append(hintBar);

  // ---------------------------------------------------------------- tool card
  const card = h('div', { class: 'ig-toolcard' });
  card.style.display = 'none';
  ui.root.append(card);
  let lastSig = '';
  const renderCard = (s: ToolStatus): void => {
    const sig = JSON.stringify(s);
    if (sig === lastSig) return;
    lastSig = sig;
    card.className = `ig-toolcard${s.ok === true ? ' ok' : s.ok === false ? ' bad' : ''}`;
    setChildren(
      card,
      h('div', { class: 'ig-toolcard-head' }, s.icon ? h('span', { class: 'ig-toolcard-icon' }, s.icon) : null, h('span', null, s.title)),
      s.message ? h('div', { class: 'ig-toolcard-msg' }, s.message) : null,
      s.lines?.length
        ? h(
            'div',
            { class: 'ig-toolcard-lines' },
            s.lines.map((l) => h('div', { class: 'ig-toolcard-line' }, h('span', { class: 'ig-muted' }, l.label), h('span', { class: l.tone ? `ig-${l.tone}` : '' }, l.value))),
          )
        : null,
      s.footer ? h('div', { class: 'ig-toolcard-foot' }, s.footer) : null,
    );
  };

  const tick = (): void => {
    if (!ctx.hasGame || !input) {
      hintBar.style.display = 'none';
      card.style.display = 'none';
      return;
    }
    const tool = input.activeTool;
    const isDefault = input.activeToolId === 'inspect';
    if (!tool || isDefault) hintBar.style.display = 'none';
    else {
      hintBar.style.display = '';
      let text = '';
      try {
        text = tool.hint?.(ctx) ?? '';
      } catch {
        text = '';
      }
      setText(hintText, text || `${tool.icon ?? ''} ${tool.name}`);
    }
    let status: ToolStatus | null = null;
    if (tool?.status && input.pointer.inside) {
      try {
        status = tool.status(ctx);
      } catch (err) {
        console.error('[ui] tool status failed', err);
      }
    }
    if (!status) {
      card.style.display = 'none';
      return;
    }
    renderCard(status);
    card.style.display = '';
    const sc = uiScale();
    const vw = window.innerWidth / sc;
    const vh = window.innerHeight / sc;
    const cw = card.offsetWidth || 260;
    const chh = card.offsetHeight || 120;
    let x = input.pointer.sx / sc + 22;
    let y = input.pointer.sy / sc + 22;
    if (x + cw > vw - 8) x = input.pointer.sx / sc - cw - 18;
    if (y + chh > vh - 120) y = input.pointer.sy / sc - chh - 18;
    card.style.left = `${Math.max(6, x)}px`;
    card.style.top = `${Math.max(50, y)}px`;
  };
  setInterval(tick, 110);
  ctx.bus.on('tool:changed', () => {
    lastSig = '';
    tick();
  });

  // ---------------------------------------------------------------- advisor bubble
  const bubble = h('div', { class: 'ig-advisor' });
  bubble.style.display = 'none';
  ui.root.append(bubble);
  const queue: Tip[] = [];
  let current: Tip | null = null;
  const dismissed = new Set<string>();
  let lastHint = '';

  const show = (): void => {
    if (!ctx.userSettings.advisorEnabled || !ctx.hasGame) {
      bubble.style.display = 'none';
      return;
    }
    const today = ctx.state.time.totalDays;
    while (queue.length && today - (queue[0]!.day ?? today) > TIP_STALE_DAYS) queue.shift();
    current = queue.shift() ?? null;
    if (!current) {
      bubble.classList.add('ig-advisor-out');
      setTimeout(() => {
        if (!current) bubble.style.display = 'none';
      }, 200);
      return;
    }
    const tip = current;
    bubble.classList.remove('ig-advisor-out');
    bubble.style.display = '';
    setChildren(
      bubble,
      h('div', { class: 'ig-advisor-avatar' }, '🧑‍💼'),
      h(
        'div',
        { class: 'ig-advisor-body' },
        h('div', { class: 'ig-advisor-name' }, 'Doradca', queue.length ? h('span', { class: 'ig-muted' }, ` · jeszcze ${queue.length}`) : null),
        h('div', { class: 'ig-advisor-text' }, tip.text),
        h(
          'div',
          { class: 'ig-row ig-advisor-actions' },
          tip.target ? button('Pokaż', () => focusTarget(ctx, tip.target!), { small: true, icon: '📍' }) : null,
          button(queue.length ? 'Dalej' : 'Rozumiem', () => next(), { small: true, variant: 'primary' }),
          h('span', { class: 'ig-grow' }),
          button(
            '',
            () => {
              ctx.userSettings.advisorEnabled = false;
              saveUserSettings(ctx.userSettings);
              ctx.bus.emit('settings:changed', {});
              queue.length = 0;
              show();
              ctx.ui.toast({ title: 'Podpowiedzi wyłączone', text: 'Włączysz je ponownie w Ustawieniach.', icon: '🔕', durationMs: 3000 });
            },
            { small: true, variant: 'ghost', icon: '🔕', title: 'Wyłącz podpowiedzi doradcy' },
          ),
        ),
      ),
    );
    ctx.bus.emit('sfx', { id: 'notify' });
  };
  const next = (): void => {
    if (current) dismissed.add(current.id);
    show();
  };
  const push = (tip: Tip): void => {
    if (!ctx.userSettings.advisorEnabled) return;
    if (dismissed.has(tip.id) || current?.id === tip.id || queue.some((q) => q.id === tip.id)) return;
    tip.day ??= ctx.tryState()?.time.totalDays;
    queue.push(tip);
    while (queue.length > 5) queue.shift();
    if (!current) show();
  };

  ctx.bus.on('advisor:tip', (t) => {
    // the advisor usually also logs a notify() toast — show the tip only once (in the bubble)
    if (ctx.userSettings.advisorEnabled) queueMicrotask(() => ui.dismissToastsMatching(t.text));
    push({ id: t.id, text: t.text, target: t.target });
  });
  setInterval(() => {
    if (!ctx.hasGame || !ctx.userSettings.advisorEnabled) return;
    let hint: string | null = null;
    try {
      hint = ctx.services.game.currentHint();
    } catch {
      hint = null;
    }
    if (hint && hint !== lastHint) {
      lastHint = hint;
      push({ id: `hint:${hint}`, text: hint, target: null });
    }
  }, 5000);
  // auto-dismiss a tip that has been on screen for a long (game) time
  setInterval(() => {
    const st = ctx.tryState();
    if (!st || !current || current.day === undefined) return;
    if (st.time.totalDays - current.day > TIP_STALE_DAYS) show();
  }, 2000);
  ctx.bus.on('game:ended', () => {
    queue.length = 0;
    dismissed.clear();
    current = null;
    lastHint = '';
    bubble.style.display = 'none';
  });
  ctx.bus.on('settings:changed', () => {
    if (!ctx.userSettings.advisorEnabled) {
      queue.length = 0;
      current = null;
      bubble.style.display = 'none';
    }
  });
}
