/**
 * PLACEHOLDER inspector: opened on 'select'. Shows raw info about the
 * selection. The UI agent replaces it with proper building/city/vehicle/route inspectors.
 */
import type { Selection } from '../../core/events';
import { cityPopulation } from '../../core/entities';
import { formatMoney, formatNumber, formatPercent } from '../../core/format';
import type { Stock } from '../../core/types';
import { h, setChildren } from '../dom';
import type { PanelDef } from '../types';

const stockText = (s: Stock): string =>
  Object.entries(s)
    .map(([k, v]) => `${k}: ${v.qty.toFixed(1)} (q${Math.round(v.quality * 100)})`)
    .join(', ') || '—';

export const inspectorPanel: PanelDef = {
  id: 'inspector',
  title: 'Inspektor',
  icon: '🔍',
  width: 320,
  position: 'right',
  refreshMs: 500,
  create(p, ctx) {
    const sel = p.args as Selection;
    const rows = h('div', { class: 'ig-col ig-small' });
    p.body.append(rows);
    const row = (k: string, v: string): HTMLElement => h('div', { class: 'ig-stat' }, h('span', { class: 'ig-stat-label' }, k), h('span', { class: 'ig-stat-value' }, v));
    p.onUpdate = () => {
      const st = ctx.state;
      const d = ctx.data;
      if (sel.kind === 'building') {
        const b = st.buildings[sel.id];
        if (!b) return p.close();
        const def = d.buildings[b.typeId];
        p.setTitle(`${def?.icon ?? ''} ${b.name ?? def?.name ?? b.typeId}`);
        setChildren(
          rows,
          row('Właściciel', st.companies[b.owner]?.name ?? 'publiczny'),
          row('Status', b.status),
          row('Budowa', formatPercent(b.constructionProgress)),
          row('Receptura', b.recipeId ?? '—'),
          row('Postęp', formatPercent(b.progress)),
          row('Wejście', stockText(b.input)),
          row('Wyjście', stockText(b.output)),
          row('Magazyn', stockText(b.storage)),
          row('Pracownicy', `${b.workers.employed}/${b.workers.required}`),
          row('Wydajność', formatPercent(b.efficiency)),
        );
      } else if (sel.kind === 'city') {
        const c = st.cities[sel.id];
        if (!c) return p.close();
        p.setTitle(`🏙️ ${c.name}`);
        setChildren(rows, row('Populacja', formatNumber(cityPopulation(c))), row('Zadowolenie', formatPercent(c.satisfaction)), row('Wzrost/mies.', formatPercent(c.growthRate, 1)));
      } else if (sel.kind === 'vehicle') {
        const v = st.vehicles[sel.id];
        if (!v) return p.close();
        p.setTitle(`🚚 ${v.name}`);
        setChildren(rows, row('Status', v.status), row('Ładunek', stockText(v.cargo)), row('Stan', formatPercent(v.condition)), row('Przychód (mies.)', formatMoney(v.stats.revenueMonth)));
      } else if (sel.kind === 'tile') {
        const m = st.map;
        const i = sel.y * m.width + sel.x;
        const dep = m.depositTypes[m.deposit[i]!];
        p.setTitle(`📍 Pole ${sel.x}, ${sel.y}`);
        setChildren(
          rows,
          row('Teren', d.terrain[m.terrain[i]!]?.name ?? '?'),
          row('Wysokość', String(m.elevation[i])),
          row('Żyzność', formatPercent(m.fertility[i]! / 255)),
          row('Las', formatPercent(m.forest[i]! / 255)),
          row('Złoże', dep ? `${d.deposits[dep]?.name ?? dep}: ${formatNumber(m.depositAmount[i]!)} (jakość ${formatPercent(m.depositQuality[i]! / 255)})` : '—'),
          row('Zanieczyszczenie', m.pollution[i]!.toFixed(1)),
        );
      } else {
        setChildren(rows, 'Nic nie wybrano.');
      }
    };
  },
};
