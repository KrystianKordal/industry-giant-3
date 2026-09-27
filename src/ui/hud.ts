/**
 * HUD: top bar (company, era, date/season, speed, reputation, cash with delta
 * animation, notifications bell, help, menu) + bottom toolbar.
 * Everything is registry-driven: add items with ctx.ui.registerHudItem and
 * buttons with ctx.ui.registerToolbarButton.
 */
import type { GameContext } from '../core/context';
import { formatDate, formatMoney, formatSignedMoney, SEASON_ICONS, SEASON_NAMES } from '../core/format';
import type { GameSpeed } from '../core/types';
import { h, setChildren, setText } from './dom';
import { tooltip } from './tooltip';
import type { ToolbarButtonDef } from './types';
import type { UiManager } from './ui';

/** Polish labels for toolbar groups (unknown groups show their id). */
export const TOOLBAR_GROUP_LABELS: Record<string, string> = {
  build: 'Budowa',
  raw: 'Surowce',
  factory: 'Fabryki',
  shop: 'Handel',
  logistics: 'Logistyka',
  transport: 'Transport',
  special: 'Specjalne',
  manage: 'Zarządzanie',
  view: 'Widok',
};
const GROUP_ORDER = ['build', 'raw', 'factory', 'shop', 'logistics', 'transport', 'special', 'manage', 'view'];

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
            try {
              it.create(el, ctx);
            } catch (err) {
              console.error(`[ui] HUD item "${it.id}" create failed`, err);
            }
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
      return (ia < 0 ? 50 : ia) - (ib < 0 ? 50 : ib);
    });
    setChildren(
      toolbar,
      ids.map((gid) =>
        h(
          'div',
          { class: `ig-toolbar-group ig-toolbar-group-${gid}` },
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
                  {
                    class: 'ig-toolbar-btn',
                    dataset: { btn: def.id, id: def.id, toolbarId: def.id },
                    onclick: (e: MouseEvent) => {
                      try {
                        def.onClick(ctx, e);
                      } catch (err) {
                        console.error(`[ui] toolbar "${def.id}" failed`, err);
                      }
                      ctx.bus.emit('sfx', { id: 'click' });
                      update();
                    },
                  },
                  h('span', { class: 'ig-toolbar-icon' }, def.icon),
                  h('span', { class: 'ig-toolbar-label' }, def.label),
                );
                tooltip(el, () => `${def.tooltip ?? def.label}${def.hotkey ? `  [${def.hotkey}]` : ''}`);
                toolbarBtns.set(def.id, { def, el });
                return el;
              }),
          ),
        ),
      ),
    );
    update();
  };

  let queued = false;
  ui.onRegistryChange = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      renderHud();
      renderToolbar();
      for (const fn of ui.registryListeners) {
        try {
          fn();
        } catch (err) {
          console.error('[ui] registry listener failed', err);
        }
      }
    });
  };

  const update = (): void => {
    document.body.classList.toggle('in-game', ctx.hasGame);
    if (!ctx.hasGame) return;
    for (const it of ui.hudItems) {
      const el = itemEls.get(it.id);
      if (!el || !it.update) continue;
      try {
        it.update(el, ctx);
      } catch (err) {
        console.error(`[ui] HUD item "${it.id}" update failed`, err);
      }
    }
    for (const { def, el } of toolbarBtns.values()) {
      let active = false;
      try {
        active = !!def.isActive?.(ctx);
      } catch {
        active = false;
      }
      el.classList.toggle('active', active);
    }
  };
  setInterval(update, 250);
  ctx.bus.on('game:started', update);
  ctx.bus.on('game:ended', update);
  ctx.bus.on('time:speed', update);
  ctx.bus.on('tool:changed', update);
  ctx.bus.on('panel:opened', update);
  ctx.bus.on('panel:closed', update);

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
    create(el, c) {
      el.classList.add('ig-clickable');
      el.append(h('span', { class: 'ig-logo' }, 'IG3'), h('span', { class: 'ig-company-dot' }), h('span', { class: 'ig-company-name' }));
      el.addEventListener('click', () => c.ui.togglePanel('dashboard'));
      tooltip(el, 'Twoja firma — otwórz panel CEO [C]');
    },
    update(el, c) {
      const p = c.state.companies[c.state.playerCompanyId];
      setText(el.querySelector('.ig-company-name')!, p ? `${p.logo} ${p.name}` : '');
      (el.querySelector('.ig-company-dot') as HTMLElement).style.background = p?.color ?? 'var(--accent)';
    },
  });

  ui.registerHudItem({
    id: 'era',
    side: 'left',
    order: 20,
    create(el) {
      el.append(h('span', { class: 'ig-era-icon' }), h('span', { class: 'ig-era-name' }));
      tooltip(el, () => {
        const st = ctx.state;
        const era = ctx.data.eras[st.time.eraId];
        const list = ctx.data.eraList();
        const next = list.find((e) => e.index === (era?.index ?? 0) + 1);
        return `${era?.name ?? st.time.eraId}\n${era?.description ?? ''}${next ? `\n\nNastępna epoka: ${next.icon} ${next.name} (${next.startYear} r.)` : ''}`;
      });
    },
    update(el, c) {
      const era = c.data.eras[c.state.time.eraId];
      setText(el.querySelector('.ig-era-icon')!, era?.icon ?? '⏳');
      setText(el.querySelector('.ig-era-name')!, era?.name ?? c.state.time.eraId);
      el.style.setProperty('--era-color', era?.color ?? 'var(--accent)');
    },
  });

  ui.registerHudItem({
    id: 'date',
    side: 'center',
    order: 10,
    create(el) {
      el.append(h('span', { class: 'ig-season' }), h('span', { class: 'ig-date' }), h('div', { class: 'ig-day-progress' }, h('div', { class: 'ig-day-progress-fill' })));
      tooltip(el, () => {
        const t = ctx.state.time;
        return `${SEASON_NAMES[t.season]} · dzień ${t.day}/30\nGra trwa ${Math.floor(t.totalDays / 360)} lat ${Math.floor((t.totalDays % 360) / 30)} mies.`;
      });
    },
    update(el, c) {
      const t = c.state.time;
      setText(el.querySelector('.ig-season')!, SEASON_ICONS[t.season]);
      setText(el.querySelector('.ig-date')!, formatDate(t));
      (el.querySelector('.ig-day-progress-fill') as HTMLElement).style.width = `${((t.day - 1 + t.dayFraction) / 30) * 100}%`;
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
      el.classList.toggle('paused', t.paused);
      for (const b of el.querySelectorAll<HTMLElement>('.ig-speed-btn')) {
        const s = b.dataset.speed;
        b.classList.toggle('active', s === 'pause' ? t.paused : !t.paused && Number(s) === (t.speed as GameSpeed));
      }
    },
  });

  ui.registerHudItem({
    id: 'reputation',
    side: 'right',
    order: 5,
    create(el, c) {
      el.classList.add('ig-clickable');
      el.append(h('span', null, '⭐'), h('span', { class: 'ig-rep' }), h('span', { class: 'ig-eco' }));
      el.addEventListener('click', () => c.ui.openPanel('dashboard', { tab: 'overview' }));
      tooltip(el, () => {
        const p = ctx.state.companies[ctx.state.playerCompanyId];
        if (!p) return '';
        return `Reputacja: ${Math.round(p.reputation)}/100\nOcena ekologiczna: ${Math.round(p.ecoRating)}/100\nWysoka reputacja zwiększa sprzedaż i ułatwia pozwolenia.`;
      });
    },
    update(el, c) {
      const p = c.state.companies[c.state.playerCompanyId];
      setText(el.querySelector('.ig-rep')!, String(Math.round(p?.reputation ?? 0)));
      setText(el.querySelector('.ig-eco')!, `🌿${Math.round(p?.ecoRating ?? 0)}`);
    },
  });

  // ---------------------------------------------------------------- cash with delta animation
  ui.registerHudItem({
    id: 'cash',
    side: 'right',
    order: 10,
    create(el, c) {
      const cash = h('span', { class: 'ig-cash' });
      const deltas = h('div', { class: 'ig-cash-deltas' });
      el.classList.add('ig-clickable');
      el.append(h('span', { class: 'ig-cash-icon' }, '💰'), cash, deltas);
      el.addEventListener('click', () => c.ui.openPanel('dashboard', { tab: 'finance' }));
      tooltip(el, () => {
        const p = ctx.state.companies[ctx.state.playerCompanyId];
        if (!p) return '';
        const m = p.finances.current;
        const last = p.finances.history[p.finances.history.length - 1];
        return (
          `Ten miesiąc:\n  przychody ${formatMoney(m.revenue)}\n  koszty ${formatMoney(m.expenses)}\n  wynik ${formatSignedMoney(m.profit)}` +
          (last ? `\nPoprzedni miesiąc: ${formatSignedMoney(last.profit)}` : '') +
          `\nKredyty: ${formatMoney(p.loans.reduce((a, l) => a + l.remaining, 0))}`
        );
      });
      let acc = 0;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let first = 0;
      const flush = (): void => {
        timer = null;
        const v = acc;
        acc = 0;
        if (Math.abs(v) < 1) return;
        const d = h('div', { class: `ig-cash-delta ${v >= 0 ? 'pos' : 'neg'}` }, formatSignedMoney(v, true));
        deltas.append(d);
        while (deltas.children.length > 4) deltas.firstElementChild?.remove();
        setTimeout(() => d.remove(), 1800);
        cash.classList.remove('flash-pos', 'flash-neg');
        void cash.offsetWidth;
        cash.classList.add(v >= 0 ? 'flash-pos' : 'flash-neg');
      };
      c.bus.on('cash:changed', ({ companyId, amount }) => {
        if (!c.hasGame || companyId !== c.state.playerCompanyId) return;
        acc += amount;
        const now = performance.now();
        if (!timer) first = now;
        if (timer) clearTimeout(timer);
        // big single transactions show immediately-ish; trickles are batched (max 1.5 s)
        timer = setTimeout(flush, Math.abs(amount) >= 1000 ? 120 : Math.max(0, Math.min(700, 1500 - (now - first))));
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
    id: 'bell',
    side: 'right',
    order: 900,
    create(el, c) {
      const b = h('button', { class: 'ig-icon-btn ig-bell', onclick: () => c.ui.togglePanel('notifications') }, '🔔', h('span', { class: 'ig-bell-count' }));
      tooltip(b, 'Powiadomienia [N]');
      el.append(b);
    },
    update(el, c) {
      const st = c.state;
      let unread = 0;
      let danger = false;
      for (const n of st.notifications.list) {
        if (n.read || (n.companyId !== 0 && n.companyId !== st.playerCompanyId)) continue;
        unread++;
        if (n.level === 'danger' || n.level === 'warning') danger = true;
      }
      const cnt = el.querySelector<HTMLElement>('.ig-bell-count')!;
      setText(cnt, unread ? (unread > 99 ? '99+' : String(unread)) : '');
      cnt.classList.toggle('danger', danger);
      cnt.style.display = unread ? '' : 'none';
    },
  });

  ui.registerHudItem({
    id: 'help',
    side: 'right',
    order: 950,
    create(el, c) {
      const b = h('button', { class: 'ig-icon-btn', onclick: () => c.ui.togglePanel('help') }, '❔');
      tooltip(b, 'Pomoc i skróty klawiszowe [F1 / H]');
      el.append(b);
    },
  });

  ui.registerHudItem({
    id: 'menu',
    side: 'right',
    order: 1000,
    create(el, c) {
      const b = h('button', { class: 'ig-icon-btn', onclick: () => c.ui.togglePanel('gameMenu') }, '☰');
      tooltip(b, 'Menu gry [Esc]');
      el.append(b);
    },
  });
}
