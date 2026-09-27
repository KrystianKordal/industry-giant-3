/**
 * Smaller panels: notifications log, blueprints, keyboard help.
 */
import { DAYS_PER_MONTH, DAYS_PER_YEAR } from '../../core/constants';
import type { GameContext } from '../../core/context';
import { formatMoney, MONTH_SHORT } from '../../core/format';
import type { Notification } from '../../core/types';
import { InputManager } from '../../input/input';
import { button, chip, confirmDialog, emptyState, promptDialog } from '../components';
import { h, setChildren } from '../dom';
import { NOTIF_CATEGORY_LABEL, plural } from '../fmt';
import { focusTarget } from '../ui';
import type { PanelDef } from '../types';

function dayLabel(ctx: GameContext, day: number): string {
  const t = ctx.state.time;
  const nowAbs = t.year * DAYS_PER_YEAR + (t.month - 1) * DAYS_PER_MONTH + (t.day - 1);
  const abs = nowAbs - (t.totalDays - day);
  const y = Math.floor(abs / DAYS_PER_YEAR);
  const m = Math.floor((abs % DAYS_PER_YEAR) / DAYS_PER_MONTH);
  const d = (abs % DAYS_PER_MONTH) + 1;
  return `${d} ${MONTH_SHORT[m] ?? ''} ${y}`;
}

// ---------------------------------------------------------------- notifications
export const notificationsPanel: PanelDef = {
  id: 'notifications',
  title: 'Powiadomienia',
  icon: '🔔',
  width: 420,
  height: 520,
  position: 'right',
  refreshMs: 1000,
  create(p, ctx) {
    let filter = 'all';
    const bar = h('div', { class: 'ig-chips' });
    const list = h('div', { class: 'ig-notif-list' });
    p.body.append(
      bar,
      list,
      h(
        'div',
        { class: 'ig-row ig-row-end', style: { marginTop: '8px' } },
        button('Oznacz wszystkie jako przeczytane', () => {
          for (const n of ctx.state.notifications.list) n.read = true;
          sig = '';
          render();
        }, { small: true, icon: '✔' }),
      ),
    );
    let sig = '';
    const visible = (n: Notification): boolean => n.companyId === 0 || n.companyId === ctx.state.playerCompanyId;
    const render = (): void => {
      const all = ctx.state.notifications.list.filter(visible);
      const s = `${filter}|${all.length}|${all[all.length - 1]?.id}|${all.filter((n) => !n.read).length}`;
      if (s === sig) return;
      sig = s;
      const cats = [...new Set(all.map((n) => n.category))];
      setChildren(
        bar,
        chip(`Wszystkie (${all.length})`, { active: filter === 'all', onClick: () => ((filter = 'all'), (sig = ''), render()) }),
        chip('⚠ Ważne', { active: filter === 'important', onClick: () => ((filter = 'important'), (sig = ''), render()) }),
        cats.map((c) => chip(NOTIF_CATEGORY_LABEL[c] ?? c, { active: filter === c, onClick: () => ((filter = c), (sig = ''), render()) })),
      );
      const shown = all
        .filter((n) => filter === 'all' || (filter === 'important' ? n.level === 'danger' || n.level === 'warning' : n.category === filter))
        .slice()
        .reverse();
      setChildren(
        list,
        shown.length === 0
          ? emptyState('📭', 'Brak powiadomień.')
          : shown.map((n) =>
              h(
                'div',
                {
                  class: `ig-notif ig-notif-${n.level}${n.read ? '' : ' unread'}${n.target ? ' ig-clickable' : ''}`,
                  onclick: () => {
                    n.read = true;
                    if (n.target) focusTarget(ctx, n.target);
                    sig = '';
                    render();
                  },
                },
                h('div', { class: 'ig-notif-icon' }, n.icon),
                h(
                  'div',
                  { class: 'ig-grow' },
                  h('div', { class: 'ig-notif-title' }, n.title),
                  n.text ? h('div', { class: 'ig-notif-text' }, n.text) : null,
                  h('div', { class: 'ig-notif-meta' }, `${dayLabel(ctx, n.day)} · ${NOTIF_CATEGORY_LABEL[n.category] ?? n.category}${n.target ? ' · pokaż →' : ''}`),
                ),
              ),
            ),
      );
    };
    p.onUpdate = render;
    // opening the log marks messages as read after a moment
    const t = setTimeout(() => {
      if (!ctx.hasGame) return;
      for (const n of ctx.state.notifications.list) if (visible(n) && n.level !== 'danger') n.read = true;
    }, 1500);
    p.onClose = () => clearTimeout(t);
  },
};

// ---------------------------------------------------------------- blueprints
export const blueprintsPanel: PanelDef = {
  id: 'blueprints',
  title: 'Blueprinty',
  icon: '📐',
  width: 420,
  position: 'left',
  refreshMs: 1000,
  create(p, ctx) {
    const list = h('div', { class: 'ig-list' });
    p.body.append(
      h('div', { class: 'ig-muted ig-small' }, 'Zapisuj sprawdzone układy (np. farma + młyn + piekarnia + drogi) i wklejaj je w innych miejscach.'),
      h('div', { class: 'ig-row', style: { margin: '8px 0' } }, button('Nowy — zaznacz obszar', () => ctx.input.setTool('blueprint', { mode: 'select' }), { icon: '⬚', variant: 'primary', small: true })),
      list,
    );
    let sig = '';
    const render = (): void => {
      const bps = Object.values(ctx.state.blueprints);
      const s = bps.map((b) => `${b.id}:${b.name}`).join(',');
      if (s === sig) return;
      sig = s;
      setChildren(
        list,
        bps.length === 0
          ? emptyState('📐', 'Brak zapisanych blueprintów.')
          : bps.map((bp) => {
              const cost = bp.items.reduce((a, it) => a + (ctx.data.buildings[it.typeId]?.cost ?? 0), 0);
              const icons = bp.items
                .slice(0, 8)
                .map((it) => ctx.data.buildings[it.typeId]?.icon ?? '?')
                .join('');
              return h(
                'div',
                { class: 'ig-list-item' },
                h(
                  'div',
                  { class: 'ig-grow' },
                  h('div', { class: 'ig-strong' }, bp.name),
                  h('div', { class: 'ig-muted ig-small' }, `${icons} · ${bp.items.length} bud., ${plural(bp.network.length, 'pole', 'pola', 'pól')} sieci · ${bp.w}×${bp.h} · ~${formatMoney(cost, true)}`),
                ),
                button('Wklej', () => ctx.input.setTool('blueprint', { mode: 'paste', blueprintId: bp.id }), { small: true, variant: 'primary', icon: '📋' }),
                button('', async () => {
                  if (!ctx.ui.root) return;
                  const name = await promptDialog(ctx.ui.root, 'Zmień nazwę', 'Nowa nazwa blueprintu:', bp.name, 'Zapisz');
                  if (name) {
                    bp.name = name;
                    sig = '';
                    render();
                  }
                }, { small: true, variant: 'ghost', icon: '✏️', title: 'Zmień nazwę' }),
                button('', async () => {
                  if (!ctx.ui.root) return;
                  const ans = await confirmDialog(ctx.ui.root, 'Usunąć blueprint?', bp.name, [
                    { id: 'no', label: 'Anuluj', variant: 'ghost' },
                    { id: 'yes', label: 'Usuń', variant: 'danger' },
                  ]);
                  if (ans === 'yes') {
                    delete ctx.state.blueprints[bp.id];
                    sig = '';
                    render();
                  }
                }, { small: true, variant: 'ghost', icon: '🗑', title: 'Usuń' }),
              );
            }),
      );
    };
    p.onUpdate = render;
  },
};

// ---------------------------------------------------------------- help
const KEY_LABEL = (k: string): string =>
  k
    .split('+')
    .map((x) => ({ space: 'Spacja', ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt', escape: 'Esc', '=': '+' })[x] ?? x.toUpperCase())
    .join(' + ');

export const helpPanel: PanelDef = {
  id: 'help',
  title: 'Pomoc i skróty klawiszowe',
  icon: '❔',
  width: 560,
  refreshMs: 0,
  create(p, ctx) {
    const hot = ctx.input instanceof InputManager ? [...ctx.input.hotkeyList()] : [];
    hot.sort((a, b) => a.key.localeCompare(b.key));
    const row = (k: string, d: string): HTMLElement => h('div', { class: 'ig-help-row' }, h('kbd', null, k), h('span', null, d));
    p.body.append(
      h(
        'div',
        { class: 'ig-grid2' },
        h(
          'div',
          null,
          h('div', { class: 'ig-section-title' }, 'Mysz'),
          row('LPM', 'wybierz obiekt / użyj narzędzia'),
          row('LPM + przeciągnij', 'przesuń mapę (inspekcja)'),
          row('PPM / ŚPM + przeciągnij', 'przesuń mapę'),
          row('PPM', 'anuluj narzędzie / odznacz'),
          row('Kółko', 'przybliż / oddal'),
          h('div', { class: 'ig-section-title' }, 'Kamera i czas'),
          row('W A S D / strzałki', 'przesuń mapę (Shift = szybciej)'),
          row('Spacja', 'pauza'),
          row('1 / 2 / 3', 'prędkość ×1 / ×2 / ×4'),
          row('Esc', 'anuluj · zamknij okno · menu gry'),
          h('div', { class: 'ig-section-title' }, 'Wskazówki'),
          h(
            'ul',
            { class: 'ig-help-tips' },
            h('li', null, 'Zacznij od surowców blisko miasta, potem fabryka i sklep w mieście.'),
            h('li', null, 'W inspektorze budynku użyj „Połącz z…” — droga, trasa i pojazd powstaną automatycznie.'),
            h('li', null, 'Czerwone miasta na nakładce „Popyt” czekają na towary.'),
            h('li', null, 'Widok łańcuchów [J] pokazuje wąskie gardła na czerwono.'),
          ),
        ),
        h('div', null, h('div', { class: 'ig-section-title' }, 'Klawisze'), hot.map((k) => row(KEY_LABEL(k.key), k.description))),
      ),
    );
  },
};
