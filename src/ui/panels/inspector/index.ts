/**
 * Inspector panel (singleton 'inspector', opened on 'select'): dispatches to
 * building / city / vehicle / tile views. Routes open the 'route' editor,
 * companies open the dashboard's competitors tab.
 */
import type { Selection } from '../../../core/events';
import { formatNumber, formatPercent } from '../../../core/format';
import { companyLabel } from '../../fmt';
import { h } from '../../dom';
import type { PanelDef } from '../../types';
import { renderBuildingInspector } from './building';
import { renderCityInspector } from './city';
import { kv } from './common';
import { renderVehicleInspector } from './vehicle';

export const inspectorPanel: PanelDef = {
  id: 'inspector',
  title: 'Inspektor',
  icon: '🔍',
  width: 390,
  position: 'right',
  refreshMs: 400,
  create(p, ctx) {
    const sel = p.args as Selection;
    if (sel.kind === 'building') renderBuildingInspector(p, ctx, sel.id);
    else if (sel.kind === 'city') renderCityInspector(p, ctx, sel.id);
    else if (sel.kind === 'vehicle') renderVehicleInspector(p, ctx, sel.id);
    else if (sel.kind === 'tile') {
      const rows = h('div', { class: 'ig-col ig-small' });
      p.body.append(rows);
      p.onUpdate = () => {
        const st = ctx.state;
        const d = ctx.data;
        const m = st.map;
        const i = sel.y * m.width + sel.x;
        const dep = m.depositTypes[m.deposit[i]!];
        const cityId = m.city[i]!;
        const t = d.terrain[m.terrain[i]!];
        p.setTitle(`📍 Pole ${sel.x}, ${sel.y}`);
        rows.replaceChildren(
          kv('Teren', t?.name ?? '?'),
          kv('Budowa', t?.buildable ? `możliwa (koszt ×${t.buildCost})` : 'niemożliwa', t?.buildable ? '' : 'ig-neg'),
          kv('Wysokość', String(m.elevation[i])),
          kv('Żyzność', formatPercent(m.fertility[i]! / 255)),
          kv('Las', formatPercent(m.forest[i]! / 255)),
          kv(
            'Złoże',
            dep ? `${d.deposits[dep]?.icon ?? ''} ${d.deposits[dep]?.name ?? dep}: ${formatNumber(m.depositAmount[i]!)} (jakość ${formatPercent(m.depositQuality[i]! / 255)})` : '—',
          ),
          kv('Zanieczyszczenie', m.pollution[i]!.toFixed(1), m.pollution[i]! > 50 ? 'ig-neg' : ''),
          kv('Miasto', cityId ? (st.cities[cityId]?.name ?? '—') : '—'),
          st.network.road[i] || st.network.rail[i]
            ? kv('Infrastruktura', `${st.network.road[i] ? '🛣️ droga ' : ''}${st.network.rail[i] ? '🛤️ tory ' : ''}(${companyLabel(st, st.network.owner[i]!)}) · ruch ${st.network.traffic[i]}`)
            : '',
        );
      };
    } else if (sel.kind === 'route') {
      p.close();
      ctx.ui.openPanel('route', { routeId: sel.id });
    } else if (sel.kind === 'company') {
      p.close();
      ctx.ui.openPanel('dashboard', { tab: 'rivals' });
    } else p.body.append('Nic nie wybrano.');
  },
};
