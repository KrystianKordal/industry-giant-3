/**
 * AI-related UI panels: 'rivals' (list of competitors with their buildings and
 * takeover offers) and 'takeover' ({ buildingId } → buy a rival building).
 * Built with the shared UI kit (ui/dom, ui/components) — browser only.
 */
import type { GameContext } from '../core/context';
import { formatMoney } from '../core/format';
import type { Building, BuildingId, Company } from '../core/types';
import { button, section, statRow } from '../ui/components';
import { h, setChildren } from '../ui/dom';
import type { PanelDef } from '../ui/types';
import { aiSummary } from './competitor';
import { PERSONALITIES } from './profiles';

const DIFF_LABEL = { easy: 'łatwy', normal: 'normalny', hard: 'trudny' } as const;

function focusBuilding(ctx: GameContext, b: Building): void {
  ctx.bus.emit('camera:focus', { x: b.x + b.w / 2, y: b.y + b.h / 2 });
  ctx.bus.emit('select', { kind: 'building', id: b.id });
}

export const takeoverPanel: PanelDef = {
  id: 'takeover',
  title: 'Przejęcie budynku',
  icon: '🤝',
  width: 340,
  refreshMs: 1000,
  create(p, ctx) {
    const args = (p.args ?? {}) as { buildingId?: BuildingId };
    const id = args.buildingId ?? 0;
    const info = h('div', { class: 'ig-col' });
    const msg = h('div', { class: 'ig-small ig-muted' });
    p.body.append(info, msg);
    p.onUpdate = () => {
      const state = ctx.tryState();
      const b = state?.buildings[id];
      if (!state || !b) {
        setChildren(info, h('div', { class: 'ig-muted' }, 'Budynek już nie istnieje.'));
        return;
      }
      const def = ctx.data.buildings[b.typeId];
      const owner = state.companies[b.owner];
      const player = state.companies[state.playerCompanyId]!;
      const price = ctx.services.ai.buildingPrice(player.id, id);
      const profit = b.stats.profitHistory.slice(-6);
      const avg = profit.length ? profit.reduce((s, v) => s + v, 0) / profit.length : 0;
      setChildren(
        info,
        h('div', { class: 'ig-strong' }, `${def?.icon ?? ''} ${b.name ?? def?.name ?? b.typeId}`),
        statRow('Właściciel', owner ? `${owner.logo} ${owner.name}${owner.bankrupt ? ' (bankrut)' : ''}` : '—').el,
        statRow('Stan techniczny', `${Math.round(b.condition * 100)}%`).el,
        statRow('Śr. zysk miesięczny', formatMoney(avg)).el,
        statRow('Cena', price === null ? 'nie na sprzedaż' : formatMoney(price)).el,
        statRow('Twoja gotówka', formatMoney(player.cash)).el,
        h(
          'div',
          { class: 'ig-row ig-row-end' },
          button('Pokaż', () => focusBuilding(ctx, b), { variant: 'ghost', small: true }),
          button(
            'Przejmij',
            () => {
              const r = ctx.services.ai.buyBuilding(player.id, id);
              if (r.ok) p.close();
              else {
                msg.textContent = r.reason;
                ctx.bus.emit('sfx', { id: 'error' });
              }
            },
            { variant: 'primary', icon: '🤝', disabled: price === null || player.cash < price },
          ),
        ),
      );
    };
  },
};

export const rivalsPanel: PanelDef = {
  id: 'rivals',
  title: 'Konkurencja',
  icon: '🏢',
  width: 460,
  refreshMs: 2000,
  create(p, ctx) {
    let expanded = 0;
    p.onUpdate = () => {
      const state = ctx.tryState();
      if (!state) return;
      const rivals = Object.values(state.companies).filter((c) => !c.isPlayer);
      if (!rivals.length) {
        setChildren(p.body, h('div', { class: 'ig-muted' }, 'Brak rywali w tej grze.'));
        return;
      }
      const player = state.companies[state.playerCompanyId]!;
      const row = (c: Company): HTMLElement => {
        const s = aiSummary(ctx, c);
        const pers = c.ai ? PERSONALITIES[c.ai.personality] : null;
        const value = ctx.services.economy.companyValue(c.id);
        const body = h(
          'div',
          { class: 'ig-col' },
          statRow('Charakter', pers ? `${pers.name} (${DIFF_LABEL[c.ai!.difficulty]})` : '—').el,
          statRow('Gotówka / wartość', `${formatMoney(c.cash, true)} / ${formatMoney(value, true)}`).el,
          statRow('Budynki / pojazdy', `${s.buildings} / ${s.vehicles}`).el,
          statRow('Specjalizacja', s.focus.join(', ') || '—').el,
        );
        if (expanded === c.id) {
          const list = Object.values(state.buildings).filter((b) => b.owner === c.id);
          body.append(
            h(
              'div',
              { class: 'ig-list' },
              list.map((b) => {
                const def = ctx.data.buildings[b.typeId];
                const price = ctx.services.ai.buildingPrice(player.id, b.id);
                return h(
                  'div',
                  { class: 'ig-list-item ig-row' },
                  h('span', { class: 'ig-grow', onclick: () => focusBuilding(ctx, b), style: { cursor: 'pointer' } }, `${def?.icon ?? ''} ${def?.name ?? b.typeId}`),
                  h('span', { class: 'ig-small ig-muted' }, price === null ? '—' : formatMoney(price, true)),
                  button('Przejmij', () => ctx.ui.openPanel('takeover', { buildingId: b.id }), { small: true, disabled: price === null }),
                );
              }),
            ),
          );
        }
        return section(
          `${c.logo} ${c.name}${c.bankrupt ? ' — bankrut' : ''}`,
          h('div', { style: { borderLeft: `3px solid ${c.color}`, paddingLeft: '8px' } }, body),
          button(expanded === c.id ? 'Ukryj budynki' : 'Pokaż budynki', () => {
            expanded = expanded === c.id ? 0 : c.id;
            p.onUpdate?.();
          }, { variant: 'ghost', small: true }),
        );
      };
      setChildren(p.body, rivals.map(row));
    };
  },
};
