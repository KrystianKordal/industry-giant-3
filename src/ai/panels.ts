/**
 * AI-related UI panels: 'rivals' (list of competitors with their buildings and
 * takeover offers) and 'takeover' ({ buildingId } → buy a rival building).
 * Built with the shared UI kit (ui/dom, ui/components) — browser only.
 */
import type { GameContext } from '../core/context';
import { formatMoney } from '../core/format';
import type { Building, BuildingId, Company } from '../core/types';
import { button, confirmDialog, section, statRow } from '../ui/components';
import { h, setChildren } from '../ui/dom';
import type { PanelDef } from '../ui/types';
import { aiSummary } from './competitor';
import { PERSONALITIES } from './profiles';
import { MONOPOLY_SHARE, monopolyStatus } from '../game/milestones';
import { buyCompany, companyTakeoverQuote } from './takeover';

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
      const all = Object.values(state.companies).filter((c) => !c.isPlayer);
      const rivals = all.filter((c) => !c.acquiredBy);
      const acquired = all.filter((c) => c.acquiredBy);
      const player = state.companies[state.playerCompanyId]!;
      const acquiredNote = acquired.length
        ? h(
            'div',
            { class: 'ig-small ig-muted', style: { marginTop: '6px' } },
            `Przejęte firmy: ${acquired.map((c) => `${c.logo} ${c.name}${c.acquiredBy !== player.id ? ` (przez ${state.companies[c.acquiredBy!]?.name ?? '?'})` : ''}`).join(', ')}`,
          )
        : null;
      const mono = monopolyStatus(ctx, state);
      const goal = all.length
        ? h(
            'div',
            { class: 'ig-small', style: { marginBottom: '8px' } },
            state.goals.milestones.monopolist !== undefined
              ? '👑 Cel „Monopolista” osiągnięty.'
              : `👑 Cel „Monopolista”: przejmij wszystkich rywali (zostało ${mono.rivalsLeft}/${mono.rivalsTotal}) albo zdobądź ${Math.round(MONOPOLY_SHARE * 100)}% sprzedaży (masz ${Math.round(mono.share * 100)}%).`,
          )
        : null;
      if (!rivals.length) {
        setChildren(p.body, goal, h('div', { class: 'ig-muted' }, all.length ? 'Wszyscy rywale zostali przejęci — rynek należy do Ciebie!' : 'Brak rywali w tej grze.'), acquiredNote);
        return;
      }
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
        const q = companyTakeoverQuote(ctx, player.id, c.id);
        if (q) {
          const canPay = player.cash >= q.price;
          body.append(
            h(
              'div',
              { class: 'ig-row', style: { marginTop: '4px', alignItems: 'center' } },
              h(
                'span',
                { class: 'ig-grow ig-small', 'data-tip': `Wycena ${formatMoney(q.base)} × premia ${q.premium.toFixed(2)}. Gotówka (${formatMoney(q.cash, true)}) i kredyty (${formatMoney(q.debt, true)}) rywala przechodzą na Ciebie.` },
                q.blocked ? h('span', { class: 'ig-muted' }, `Wrogie przejęcie: ${q.blocked}`) : `Wrogie przejęcie: ${formatMoney(q.price, true)}`,
              ),
              q.blocked
                ? null
                : button(
                    'Przejmij firmę',
                    async () => {
                      const ans = await confirmDialog(
                        ctx.ui.root ?? document.body,
                        `Przejąć ${c.name}?`,
                        `Zapłacisz ${formatMoney(q.price)}. Przejmiesz ${q.buildings} budynków, ${q.vehicles} pojazdów, ${q.routes} tras, gotówkę ${formatMoney(q.cash)} i kredyty ${formatMoney(q.debt)}. Rywal zniknie z rynku.`,
                        [
                          { id: 'no', label: 'Anuluj', variant: 'ghost' },
                          { id: 'yes', label: 'Przejmij', variant: 'primary' },
                        ],
                      );
                      if (ans !== 'yes') return;
                      const r = buyCompany(ctx, player.id, c.id);
                      if (!r.ok) {
                        ctx.ui.toast({ level: 'warning', icon: '🚫', title: 'Przejęcie nieudane', text: r.reason });
                        ctx.bus.emit('sfx', { id: 'error' });
                      }
                      p.onUpdate?.();
                    },
                    { variant: 'primary', small: true, icon: '🦈', disabled: !canPay, title: canPay ? undefined : `Brakuje ${formatMoney(q.price - player.cash)}` },
                  ),
            ),
          );
        }
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
      setChildren(p.body, goal, ...rivals.map(row), acquiredNote);
    };
  },
};
