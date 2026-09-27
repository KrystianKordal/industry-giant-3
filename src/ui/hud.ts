/**
 * HUD: top bar (company, date, speed, cash, menu) + bottom toolbar.
 * Everything is registry-driven: add items with ctx.ui.registerHudItem and
 * buttons with ctx.ui.registerToolbarButton.
 */
import type { GameContext } from '../core/context';
import { formatDate, formatMoney, SEASON_ICONS, SEASON_NAMES } from '../core/format';
import type { GameSpeed } from '../core/types';
import { h, setChildren, setText } from './dom';
import { tooltip } from './tooltip';
import type { ToolbarButtonDef } from './types';
import type { UiManager } from './ui';

/** Polish labels for toolbar groups (unknown groups show their id). */
export const TOOLBAR_GROUP_LABELS: Record<string, string> = {
  raw: 'Surowce',
  factory: 'Fabryki',
  shop: 'Handel',
  logistics: 'Logistyka',
  transport: 'Transport',
  special: 'Specjalne',
  manage: 'Zarządzanie',
  view: 'Widok',
};
const GROUP_ORDER = ['raw', 'factory', 'shop', 'logistics', 'transport', 'special', 'manage', 'view'];

export function installHud(ctx: GameContext, ui: UiManager): void {
  const left = h('div', { class: 'ig-hud-slot ig-hud-left' });
  const center = h('div', { class: 'ig-hud-slot ig-hud-center' });
  const right = h('div', { class: 'ig-hud-slot ig-hud-right' });
  const top = h('div', { class: 'ig-topbar' }, left, center, right);
  const toolbar = h('div', { class: 'ig-toolbar' });
  ui.root.prepend(top, toolbar);

  const itemEls = new Map<string, HTMLElement>();
  const toolbarBtns = new Map<string, { def: ToolbarButtonDef; el: HTMLElement }>();

  const renderHud = (): void => {
    for (const [side, slot] of [
      ['left', left],
      ['center', center],
      ['right', right],
    ] as const) {
      const items = ui.hudItems.filter((i) => i.side === side).sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
      setChildren(
        slot,
        items.map((it) => {
          let el = itemEls.get(it.id);
          if (!el) {
            el = h('div', { class: `ig-hud-item ig-hud-${it.id}` });
            it.create(el, ctx);
            itemEls.set(it.id, el);
          }
          return el;
        }),
      );
    }
  };

  const renderToolbar = (): void => {
    toolbarBtns.clear();
    const groups = new Map<string, ToolbarButtonDef[]>();
    for (const b of ui.toolbarButtons) {
      if (!groups.has(b.group)) groups.set(b.group, []);
      groups.get(b.group)!.push(b);
    }
    const ids = [...groups.keys()].sort((a, b) => {
      const ia = GROUP_ORDER.indexOf(a);
      const ib = GROUP_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    setChildren(
      toolbar,
      ids.map((gid) =>
        h(
          'div',
          { class: 'ig-toolbar-group' },
          h('div', { class: 'ig-toolbar-group-label' }, TOOLBAR_GROUP_LABELS[gid] ?? gid),
          h(
            'div',
            { class: 'ig-toolbar-buttons' },
            groups
              .get(gid)!
              .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
              .map((def) => {
                const el = h(
                  'button',
                  { class: 'ig-toolbar-btn', onclick: (e: MouseEvent) => def.onClick(ctx, e) },
                  h('span', { class: 'ig-toolbar-icon' }, def.icon),
                  h('span', { class: 'ig-toolbar-label' }, def.label),
                );
                tooltip(el, `${def.tooltip ?? def.label}${def.hotkey ? ` [${def.hotkey}]` : ''}`);
                toolbarBtns.set(def.id, { def, el });
                return el;
              }),
          ),
        ),
      ),
    );
  };

  let queued = false;
  ui.onRegistryChange = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      renderHud();
      renderToolbar();
    });
  };

  const update = (): void => {
    document.body.classList.toggle('in-game', ctx.hasGame);
    if (!ctx.hasGame) return;
    for (const it of ui.hudItems) {
      const el = itemEls.get(it.id);
      if (el && it.update) it.update(el, ctx);
    }
    for (const { def, el } of toolbarBtns.values()) el.classList.toggle('active', !!def.isActive?.(ctx));
  };
  setInterval(update, 250);
  ctx.bus.on('game:started', update);
  ctx.bus.on('game:ended', update);
  ctx.bus.on('time:speed', update);
  ctx.bus.on('cash:changed', ({ companyId }) => {
    if (ctx.hasGame && companyId === ctx.state.playerCompanyId) update();
  });

  registerDefaultHudItems(ctx, ui);
  renderHud();
  renderToolbar();
  update();
}

function registerDefaultHudItems(ctx: GameContext, ui: UiManager): void {
  ui.registerHudItem({
    id: 'company',
    side: 'left',
    order: 10,
    create(el) {
      el.append(h('span', { class: 'ig-logo' }, 'IG3'), h('span', { class: 'ig-company-name' }));
    },
    update(el, c) {
      const p = c.state.companies[c.state.playerCompanyId];
      const name = el.querySelector('.ig-company-name')!;
      setText(name, p ? `${p.logo} ${p.name}` : '');
    },
  });

  ui.registerHudItem({
    id: 'date',
    side: 'center',
    order: 10,
    create(el) {
      el.append(h('span', { class: 'ig-season' }), h('span', { class: 'ig-date' }));
    },
    update(el, c) {
      const t = c.state.time;
      const season = el.querySelector<HTMLElement>('.ig-season')!;
      setText(season, SEASON_ICONS[t.season]);
      season.title = SEASON_NAMES[t.season];
      setText(el.querySelector('.ig-date')!, formatDate(t));
    },
  });

  ui.registerHudItem({
    id: 'speed',
    side: 'center',
    order: 20,
    create(el, c) {
      const mk = (label: string, title: string, fn: () => void, data: string): HTMLButtonElement => {
        const b = h('button', { class: 'ig-speed-btn', dataset: { speed: data }, onclick: fn }, label);
        tooltip(b, title);
        return b;
      };
      el.append(
        mk('⏸', 'Pauza [Spacja]', () => c.sim.togglePause(), 'pause'),
        mk('▶', 'Normalna prędkość [1]', () => c.sim.setSpeed(1), '1'),
        mk('▶▶', 'Szybko [2]', () => c.sim.setSpeed(2), '2'),
        mk('▶▶▶', 'Bardzo szybko [3]', () => c.sim.setSpeed(4), '4'),
      );
    },
    update(el, c) {
      const t = c.state.time;
      for (const b of el.querySelectorAll<HTMLElement>('.ig-speed-btn')) {
        const s = b.dataset.speed;
        b.classList.toggle('active', s === 'pause' ? t.paused : !t.paused && Number(s) === (t.speed as GameSpeed));
      }
    },
  });

  ui.registerHudItem({
    id: 'cash',
    side: 'right',
    order: 10,
    create(el) {
      el.append(h('span', { class: 'ig-cash-icon' }, '💰'), h('span', { class: 'ig-cash' }));
      tooltip(el, () => {
        const p = ctx.state.companies[ctx.state.playerCompanyId];
        if (!p) return '';
        const m = p.finances.current;
        return `Ten miesiąc: przychody ${formatMoney(m.revenue)}, koszty ${formatMoney(m.expenses)}, wynik ${formatMoney(m.profit)}`;
      });
    },
    update(el, c) {
      const p = c.state.companies[c.state.playerCompanyId];
      const cash = el.querySelector<HTMLElement>('.ig-cash')!;
      setText(cash, formatMoney(p?.cash ?? 0));
      cash.classList.toggle('negative', (p?.cash ?? 0) < 0);
    },
  });

  ui.registerHudItem({
    id: 'menu',
    side: 'right',
    order: 1000,
    create(el, c) {
      const b = h('button', { class: 'ig-icon-btn', onclick: () => c.ui.togglePanel('gameMenu') }, '☰');
      tooltip(b, 'Menu gry');
      el.append(b);
    },
  });
}
