/**
 * City inspector: population by class, growth, satisfaction, history chart,
 * demand vs supply per product (shortages highlighted), shops present,
 * labour pool, opinion/permits of the player.
 */
import type { GameContext } from '../../../core/context';
import { cityPopulation } from '../../../core/entities';
import { formatMoney, formatNumber, formatPercent } from '../../../core/format';
import type { SocialClass } from '../../../core/types';
import { lineChart } from '../../charts';
import { badge, button, goodColor, linkButton, meter, section } from '../../components';
import { h } from '../../dom';
import { CLASS_LABEL, TIER_LABEL, productIcon, productName } from '../../fmt';
import { tooltip } from '../../tooltip';
import { openBuildMenu } from '../../buildMenu';
import { focusTarget } from '../../ui';
import type { PanelInstance } from '../../types';
import { dyn, kv } from './common';

const CLASS_COLOR: Record<SocialClass, string> = { poor: '#8aa0b8', middle: '#e8b04a', rich: '#b07be0' };

export function renderCityInspector(p: PanelInstance, ctx: GameContext, id: number): void {
  const get = () => ctx.tryState()?.cities[id];
  if (!get()) {
    p.body.append(h('div', { class: 'ig-muted' }, 'Miasto nie istnieje.'));
    return;
  }

  const summary = dyn((el) => {
    const c = get()!;
    const pop = cityPopulation(c);
    el.append(
      h(
        'div',
        { class: 'ig-insp-head' },
        h('div', { class: 'ig-insp-icon' }, c.tier === 'metropolis' ? '🌆' : c.tier === 'city' ? '🏙️' : c.tier === 'town' ? '🏘️' : '🏡'),
        h(
          'div',
          { class: 'ig-grow' },
          h('div', { class: 'ig-big' }, formatNumber(pop), h('span', { class: 'ig-muted ig-small' }, ' mieszkańców')),
          h(
            'div',
            { class: 'ig-small' },
            badge(TIER_LABEL[c.tier] ?? c.tier, 'dim'),
            ' ',
            badge(`${c.growthRate >= 0 ? '▲' : '▼'} ${formatPercent(c.growthRate, 1)}/mies.`, c.growthRate > 0.001 ? 'pos' : c.growthRate < -0.001 ? 'neg' : 'dim', 'Tempo wzrostu populacji — rośnie, gdy miasto jest dobrze zaopatrzone'),
            c.isPort ? badge('⚓ port', 'info') : '',
          ),
        ),
        button('', () => focusTarget(ctx, { kind: 'city', id }, false), { icon: '📍', small: true, variant: 'ghost', title: 'Pokaż na mapie' }),
      ),
      h('div', { class: 'ig-row ig-small' }, h('span', { class: 'ig-muted', style: { width: '90px' } }, 'Zadowolenie'), meter(c.satisfaction, { color: goodColor(c.satisfaction), width: 160 }), h('span', null, formatPercent(c.satisfaction))),
    );
    // population by class — stacked bar
    const bar = h('div', { class: 'ig-stack' });
    const legend = h('div', { class: 'ig-stack-legend' });
    for (const k of ['poor', 'middle', 'rich'] as SocialClass[]) {
      const v = c.population[k];
      const seg = h('div', { class: 'ig-stack-seg', style: { width: `${pop ? (v / pop) * 100 : 0}%`, background: CLASS_COLOR[k] } });
      tooltip(seg, `${CLASS_LABEL[k]}: ${formatNumber(v)} (${formatPercent(pop ? v / pop : 0)})`);
      bar.append(seg);
      legend.append(h('span', null, h('i', { style: { background: CLASS_COLOR[k] } }), `${CLASS_LABEL[k]} ${formatNumber(v)}`));
    }
    el.append(h('div', { class: 'ig-sub' }, 'Struktura społeczna'), bar, legend);
  }, '', () => {
    const c = get()!;
    return `${cityPopulation(c)}|${c.satisfaction.toFixed(2)}|${c.growthRate.toFixed(4)}|${c.tier}`;
  });
  p.body.append(summary.el);

  const chart = h('canvas', { class: 'ig-chart' });
  p.body.append(chart);
  let chartAt = 0;

  // demand table
  const demand = dyn((el) => {
    const c = get()!;
    const rows = Object.entries(c.demand).sort((a, b) => a[1].satisfaction - b[1].satisfaction);
    if (!rows.length) {
      el.append(h('div', { class: 'ig-muted ig-small' }, 'Miasto nie zgłasza jeszcze zapotrzebowania.'));
      return;
    }
    const pid = ctx.state.playerCompanyId;
    el.append(
      h(
        'div',
        { class: 'ig-demand-head' },
        h('span', null, 'Produkt'),
        h('span', { title: 'Popyt na miesiąc' }, 'Popyt'),
        h('span', { title: 'Dostarczono w tym miesiącu' }, 'Dostaw.'),
        h('span', { title: 'Zaspokojenie popytu' }, 'Zaspok.'),
        h('span', null, 'Cena'),
      ),
    );
    for (const [prod, d] of rows) {
      const short = d.satisfaction < 0.5;
      const mine = d.shareByCompany[pid] ?? 0;
      const row = h(
        'div',
        { class: `ig-demand-grid${short ? ' shortage' : ''}` },
        h('span', null, `${productIcon(ctx, prod)} ${productName(ctx, prod)}`),
        h('span', null, formatNumber(d.monthly)),
        h('span', null, formatNumber(d.suppliedMonth)),
        h('span', { class: 'ig-row' }, meter(d.satisfaction, { color: goodColor(d.satisfaction), width: 54 }), formatPercent(d.satisfaction)),
        h('span', null, formatMoney(d.price)),
      );
      tooltip(
        row,
        `${productName(ctx, prod)}\nPopyt: ${formatNumber(d.monthly)}/mies.\nDostarczono w tym miesiącu: ${formatNumber(d.suppliedMonth)} (Twoje: ${formatNumber(mine)})\n` +
          (short ? '⚠ Niedobór — okazja do sprzedaży!' : 'Rynek dobrze zaopatrzony'),
      );
      el.append(row);
    }
  });
  p.body.append(section('Popyt i podaż', demand.el));

  const shops = dyn(
    (el) => {
      const c = get()!;
      const st = ctx.state;
      const list = Object.values(st.buildings).filter((b) => b.cityId === id && ctx.data.buildings[b.typeId]?.category === 'shop');
      if (!list.length) el.append(h('div', { class: 'ig-muted ig-small' }, 'Brak sklepów — zbuduj pierwszy!'));
      for (const b of list) {
        const d = ctx.data.buildings[b.typeId];
        const owner = st.companies[b.owner];
        el.append(
          h(
            'div',
            { class: 'ig-route-row' },
            h('span', { class: 'ig-route-dot', style: { background: owner?.color ?? '#999' } }),
            linkButton(`${d?.icon ?? ''} ${b.name ?? d?.name ?? ''}`, () => focusTarget(ctx, { kind: 'building', id: b.id })),
            h('span', { class: 'ig-muted ig-small' }, owner ? owner.name : 'publiczny'),
          ),
        );
      }
      el.append(h('div', { style: { marginTop: '6px' } }, button('Zbuduj sklep', () => openBuildMenu('shop'), { icon: '🏪', small: true })));
      void c;
    },
    '',
    () =>
      Object.values(ctx.state.buildings)
        .filter((b) => b.cityId === id)
        .map((b) => b.id)
        .join(','),
  );
  p.body.append(section('Sklepy w mieście', shops.el));

  const labour = dyn((el) => {
    const c = get()!;
    const pid = ctx.state.playerCompanyId;
    const op = c.opinion[pid] ?? 0;
    const permit = c.permits[pid] ?? 'granted';
    el.append(
      kv('Siła robocza', `${formatNumber(c.labour.employed)} / ${formatNumber(c.labour.workforce)} zatrudnionych`),
      kv('Średnia płaca', `${formatMoney(c.labour.wage)}/mies.`),
      kv('Wykształcenie', formatPercent(c.labour.skill)),
      kv('Zasięg dojazdów', `${c.labour.commuteRadius} kafli`),
      kv('Opinia o Twojej firmie', `${op > 0 ? '+' : ''}${Math.round(op)}`, op < -20 ? 'ig-neg' : op > 20 ? 'ig-pos' : ''),
      kv('Pozwolenia', permit === 'granted' ? '✅ przyznane' : permit === 'restricted' ? '⚠ ograniczone' : '⛔ odmowa', permit === 'granted' ? '' : 'ig-neg'),
      kv('Preferencje ekologiczne', formatPercent(c.greenPreference)),
      kv('Założone', `${c.foundedYear} r.`),
    );
  });
  p.body.append(section('Rynek pracy i opinia', labour.el));

  p.onUpdate = () => {
    const c = get();
    if (!c) return p.close();
    p.setTitle(`🏙️ ${c.name}`);
    summary.update();
    demand.update();
    shops.update();
    labour.update();
    if (performance.now() - chartAt > 3000) {
      chartAt = performance.now();
      const hist = c.history.population;
      chart.style.display = hist.length > 1 ? '' : 'none';
      if (hist.length > 1) lineChart(chart, [{ name: 'Populacja', values: hist, color: '#6fa3d8' }], { width: 340, height: 100 });
    }
  };
}
