/**
 * CEO dashboard (panel 'dashboard', args { tab? }): KPI cards, monthly charts,
 * P&L by ledger category, top/bottom buildings & routes, loans, research,
 * competitors ranking.
 */
import type { GameContext } from '../../core/context';
import { formatMoney, formatMonthShort, formatNumber, formatPercent, formatSignedMoney } from '../../core/format';
import type { Company, FinanceCategory, FinanceMonth } from '../../core/types';
import { NON_OPERATING_CATEGORIES } from '../../core/types';
import { routeUtilisation } from '../../logistics/api';
import { buildingProfit, companyRanking, lastOf, loanPayment, routeProfit } from '../analytics';
import { barList, drawSparkline, lineChart } from '../charts';
import { badge, button, confirmDialog, emptyState, goodColor, kpiCard, linkButton, meter, section, segmented, slider, table, type KpiHandle, type Tone } from '../components';
import { h, setChildren } from '../dom';
import { BUILDING_STATUS, FINANCE_LABEL, MODE_ICON } from '../fmt';
import { focusTarget } from '../ui';
import type { PanelDef, PanelInstance } from '../types';
import { openNewRoute } from './routeEditor';
import { renderResearch } from './research';

const TABS: { id: string; label: string }[] = [
  { id: 'overview', label: '📊 Przegląd' },
  { id: 'finance', label: '💵 Wynik (P&L)' },
  { id: 'buildings', label: '🏭 Budynki' },
  { id: 'routes', label: '🛣️ Trasy' },
  { id: 'loans', label: '🏦 Kredyty' },
  { id: 'research', label: '🔬 Badania' },
  { id: 'rivals', label: '🏆 Konkurencja' },
];

const player = (ctx: GameContext): Company => ctx.state.companies[ctx.state.playerCompanyId]!;
const monthLabels = (hist: FinanceMonth[]): string[] => hist.map((m) => formatMonthShort(m.month, m.year));

function delta(cur: number, prev: number | undefined, goodUp = true): { text: string; tone: Tone } | null {
  if (prev === undefined) return null;
  const d = cur - prev;
  if (Math.abs(d) < 1) return { text: 'bez zmian', tone: 'dim' };
  const pct = prev !== 0 ? ` (${d > 0 ? '+' : ''}${formatPercent(d / Math.abs(prev))})` : '';
  const up = d > 0;
  return { text: `${up ? '▲' : '▼'} ${formatSignedMoney(d, true)}${pct} m/m`, tone: up === goodUp ? 'pos' : 'neg' };
}

// ---------------------------------------------------------------- overview
function overview(el: HTMLElement, ctx: GameContext): () => void {
  const cards: Record<string, KpiHandle> = {
    revenue: kpiCard('Przychody', '📈', 'Przychody operacyjne ostatniego zamkniętego miesiąca (porównanie z miesiącem wcześniej; niżej: bieżący, niepełny miesiąc)'),
    costs: kpiCard('Koszty', '📉', 'Koszty operacyjne ostatniego zamkniętego miesiąca (niżej: bieżący, niepełny miesiąc)'),
    profit: kpiCard('Zysk netto', '💰', 'Wynik ostatniego zamkniętego miesiąca (w nawiasie: bieżący)'),
    cashflow: kpiCard('Przepływ gotówki', '💸', 'Zmiana gotówki w ciągu ostatnich 30 dni (z kredytami i inwestycjami)'),
    value: kpiCard('Wartość firmy', '🏢', 'Wycena: majątek + gotówka − długi'),
    rep: kpiCard('Reputacja', '⭐', 'Reputacja i ocena ekologiczna (0–100)'),
  };
  const c1 = h('canvas', { class: 'ig-chart' });
  const c2 = h('canvas', { class: 'ig-chart' });
  const status = h('div', { class: 'ig-status-summary' });
  el.append(
    h('div', { class: 'ig-kpis' }, Object.values(cards).map((k) => k.el)),
    h('div', { class: 'ig-grid2' }, section('Przychody, koszty i zysk (miesięcznie)', c1), section('Gotówka i wartość firmy', c2)),
    section('Stan imperium', status),
  );
  let chartAt = 0;
  return () => {
    const p = player(ctx);
    const f = p.finances;
    const hist = f.history;
    const last = hist[hist.length - 1];
    const prev = hist[hist.length - 2];
    // Closed months are comparable; the running month is partial, so it is shown as a note only.
    const withCurrent = (d: { text: string; tone: Tone } | null, cur: number): { text: string; tone: Tone } => ({
      text: `${d ? `${d.text} · ` : ''}bieżący: ${formatMoney(cur, true)}`,
      tone: d?.tone ?? 'dim',
    });
    if (last) {
      cards.revenue!.set(formatMoney(last.revenue, true), withCurrent(delta(last.revenue, prev?.revenue), f.current.revenue));
      cards.costs!.set(formatMoney(last.expenses, true), withCurrent(delta(last.expenses, prev?.expenses, false), f.current.expenses));
    } else {
      cards.revenue!.set(formatMoney(f.current.revenue, true), { text: 'bieżący miesiąc', tone: 'dim' });
      cards.costs!.set(formatMoney(f.current.expenses, true), { text: 'bieżący miesiąc', tone: 'dim' });
    }
    const lp = last?.profit ?? f.current.profit;
    cards.profit!.set(formatSignedMoney(lp, true), last ? { text: `bieżący: ${formatSignedMoney(f.current.profit, true)}${prev ? ` · poprz. ${formatSignedMoney(prev.profit, true)}` : ''}`, tone: f.current.profit >= 0 ? 'pos' : 'neg' } : null);
    const daily = ctx.state.stats.daily[`company.${p.id}.cash`] ?? [];
    const cf = daily.length > 1 ? p.cash - daily[Math.max(0, daily.length - 31)]! : 0;
    cards.cashflow!.set(formatSignedMoney(cf, true), { text: `gotówka: ${formatMoney(p.cash, true)}`, tone: cf >= 0 ? 'pos' : 'neg' });
    let value = f.valuation;
    try {
      value = ctx.services.economy.companyValue(p.id);
    } catch {
      /* default */
    }
    cards.value!.set(formatMoney(value, true), delta(value, lastOf(f.valuationHistory.slice(0, -1))));
    cards.rep!.set(`${Math.round(p.reputation)} / 100`, { text: `🌿 eko ${Math.round(p.ecoRating)}`, tone: p.ecoRating >= 50 ? 'pos' : 'warn' });

    if (performance.now() - chartAt > 2000) {
      chartAt = performance.now();
      drawSparkline(cards.revenue!.spark, hist.map((m) => m.revenue), { width: 150, height: 26, color: '#7fd6a0' });
      drawSparkline(cards.costs!.spark, hist.map((m) => m.expenses), { width: 150, height: 26, color: '#ff7b6e' });
      drawSparkline(cards.profit!.spark, hist.map((m) => m.profit), { width: 150, height: 26, color: 'var(--accent)' });
      drawSparkline(cards.cashflow!.spark, daily.slice(-60), { width: 150, height: 26, color: '#6fa3d8' });
      drawSparkline(cards.value!.spark, f.valuationHistory, { width: 150, height: 26, color: '#b07be0' });
      const labels = monthLabels(hist);
      if (hist.length > 1) {
        lineChart(
          c1,
          [
            { name: 'Przychody', values: hist.map((m) => m.revenue), color: '#7fd6a0' },
            { name: 'Koszty', values: hist.map((m) => m.expenses), color: '#ff7b6e' },
            { name: 'Zysk', values: hist.map((m) => m.profit), color: '#e8b04a' },
          ],
          { height: 170, labels, yFormat: (v) => formatMoney(v, true).replace(' zł', '') },
        );
      } else setChildren(c1.parentElement ?? el, h('div', { class: 'ig-section-title' }, 'Przychody, koszty i zysk (miesięcznie)'), c1, h('div', { class: 'ig-muted ig-small' }, 'Wykres pojawi się po zamknięciu pierwszych miesięcy.'));
      const cashM = ctx.state.stats.monthly[`company.${p.id}.cash`] ?? [];
      const valM = ctx.state.stats.monthly[`company.${p.id}.value`] ?? f.valuationHistory;
      if (cashM.length > 1 || valM.length > 1)
        lineChart(
          c2,
          [
            { name: 'Gotówka', values: cashM, color: '#6fa3d8' },
            { name: 'Wartość', values: valM, color: '#b07be0' },
          ],
          { height: 170, yFormat: (v) => formatMoney(v, true).replace(' zł', '') },
        );
    }

    // status summary
    const st = ctx.state;
    const mine = Object.values(st.buildings).filter((b) => b.owner === p.id);
    const counts = new Map<string, number>();
    for (const b of mine) counts.set(b.status, (counts.get(b.status) ?? 0) + 1);
    const vehicles = Object.values(st.vehicles).filter((v) => v.owner === p.id);
    const routes = Object.values(st.routes).filter((r) => r.owner === p.id);
    setChildren(
      status,
      h('div', { class: 'ig-chips' }, badge(`🏭 ${mine.length} budynków`, 'info'), badge(`🚚 ${vehicles.length} pojazdów`, 'info'), badge(`🛣️ ${routes.length} tras`, 'info'), badge(`🏦 ${p.loans.length} kredytów`, 'dim')),
      h(
        'div',
        { class: 'ig-chips' },
        [...counts.entries()]
          .filter(([s]) => s !== 'ok')
          .map(([s, n]) => {
            const info = BUILDING_STATUS[s as keyof typeof BUILDING_STATUS];
            return badge(`${info?.icon ?? ''} ${info?.label ?? s}: ${n}`, info?.tone === 'neg' ? 'neg' : info?.tone === 'warn' ? 'warn' : 'dim');
          }),
        (counts.get('ok') ?? 0) > 0 ? badge(`● pracuje: ${counts.get('ok')}`, 'pos') : null,
      ),
    );
  };
}

// ---------------------------------------------------------------- P&L
function finance(el: HTMLElement, ctx: GameContext): () => void {
  let which: 'current' | 'last' | 'avg' = 'last';
  const seg = segmented(
    [
      { value: 'current', label: 'Bieżący miesiąc' },
      { value: 'last', label: 'Poprzedni miesiąc' },
      { value: 'avg', label: 'Średnia 12 mies.' },
    ],
    which,
    (v) => {
      which = v as typeof which;
      sig = '';
      upd();
    },
  );
  const body = h('div');
  el.append(seg.el, body);
  let sig = '';
  const upd = (): void => {
    const p = player(ctx);
    const f = p.finances;
    let ledger: Partial<Record<FinanceCategory, number>> = {};
    let title = '';
    if (which === 'current' || !f.history.length) {
      ledger = f.current.ledger;
      title = `Bieżący miesiąc (${formatMonthShort(f.current.month, f.current.year)}, w toku)`;
    } else if (which === 'last') {
      const m = f.history[f.history.length - 1]!;
      ledger = m.ledger;
      title = formatMonthShort(m.month, m.year);
    } else {
      const last12 = f.history.slice(-12);
      for (const m of last12) for (const [k, v] of Object.entries(m.ledger)) ledger[k as FinanceCategory] = (ledger[k as FinanceCategory] ?? 0) + (v ?? 0) / last12.length;
      title = `Średnia z ${last12.length} mies.`;
    }
    const s = `${which}|${JSON.stringify(ledger)}`;
    if (s === sig) return;
    sig = s;
    const entries = Object.entries(ledger).filter(([, v]) => Math.abs(v ?? 0) >= 0.5) as [FinanceCategory, number][];
    const op = entries.filter(([k]) => !NON_OPERATING_CATEGORIES.includes(k));
    const nonOp = entries.filter(([k]) => NON_OPERATING_CATEGORIES.includes(k));
    const income = op.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const costs = op.filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1]);
    const rev = income.reduce((a, [, v]) => a + v, 0);
    const exp = costs.reduce((a, [, v]) => a + v, 0);
    setChildren(
      body,
      h('div', { class: 'ig-section-title' }, title),
      entries.length === 0
        ? emptyState('📒', 'Brak operacji w tym okresie.')
        : h(
            'div',
            { class: 'ig-grid2' },
            h(
              'div',
              null,
              h('div', { class: 'ig-sub' }, 'Przychody'),
              income.length ? barList(income.map(([k, v]) => ({ label: FINANCE_LABEL[k] ?? k, value: v })), (v) => formatMoney(v, true)) : h('div', { class: 'ig-muted ig-small' }, '—'),
              h('div', { class: 'ig-sub' }, 'Koszty'),
              costs.length ? barList(costs.map(([k, v]) => ({ label: FINANCE_LABEL[k] ?? k, value: v })), (v) => formatMoney(v, true)) : h('div', { class: 'ig-muted ig-small' }, '—'),
            ),
            h(
              'div',
              { class: 'ig-pnl' },
              h('div', { class: 'ig-stat' }, h('span', { class: 'ig-stat-label' }, 'Przychody operacyjne'), h('span', { class: 'ig-stat-value ig-pos' }, formatMoney(rev))),
              h('div', { class: 'ig-stat' }, h('span', { class: 'ig-stat-label' }, 'Koszty operacyjne'), h('span', { class: 'ig-stat-value ig-neg' }, formatMoney(exp))),
              h('div', { class: 'ig-stat ig-pnl-total' }, h('span', { class: 'ig-stat-label' }, 'Wynik operacyjny'), h('span', { class: `ig-stat-value ${rev + exp >= 0 ? 'ig-pos' : 'ig-neg'}` }, formatSignedMoney(rev + exp))),
              rev > 0 ? h('div', { class: 'ig-stat' }, h('span', { class: 'ig-stat-label' }, 'Marża'), h('span', { class: 'ig-stat-value' }, formatPercent((rev + exp) / rev))) : null,
              nonOp.length ? h('div', { class: 'ig-sub' }, 'Finansowanie (poza wynikiem)') : null,
              nonOp.map(([k, v]) => h('div', { class: 'ig-stat' }, h('span', { class: 'ig-stat-label' }, FINANCE_LABEL[k] ?? k), h('span', { class: `ig-stat-value ${v >= 0 ? 'ig-pos' : 'ig-neg'}` }, formatSignedMoney(v)))),
              h('div', { class: 'ig-stat' }, h('span', { class: 'ig-stat-label' }, 'Stawka podatku'), h('span', { class: 'ig-stat-value' }, formatPercent(f.taxRate))),
              h('div', { class: 'ig-stat' }, h('span', { class: 'ig-stat-label' }, 'Przychody łącznie (od startu)'), h('span', { class: 'ig-stat-value' }, formatMoney(f.lifetimeRevenue, true))),
            ),
          ),
    );
  };
  return upd;
}

// ---------------------------------------------------------------- buildings
function buildings(el: HTMLElement, ctx: GameContext): () => void {
  const topEl = h('div', { class: 'ig-grid2' });
  type Row = { id: number; name: string; icon: string; status: string; eff: number; profit: number; revenue: number };
  const tbl = table<Row>(
    [
      { key: 'name', label: 'Budynek', render: (r) => `${r.icon} ${r.name}`, sort: (r) => r.name },
      { key: 'status', label: 'Status', render: (r) => { const s = BUILDING_STATUS[r.status as keyof typeof BUILDING_STATUS]; return badge(s?.label ?? r.status, s?.tone === 'pos' ? 'pos' : s?.tone === 'neg' ? 'neg' : s?.tone === 'warn' ? 'warn' : 'dim'); }, sort: (r) => r.status },
      { key: 'eff', label: 'Wydajność', align: 'right', render: (r) => h('span', { class: 'ig-row', style: { justifyContent: 'flex-end' } }, meter(Math.min(1, r.eff), { color: goodColor(r.eff), width: 50 }), formatPercent(r.eff)), sort: (r) => r.eff },
      { key: 'revenue', label: 'Przychód (mies.)', align: 'right', render: (r) => formatMoney(r.revenue, true), sort: (r) => r.revenue },
      { key: 'profit', label: 'Zysk (poprz.)', align: 'right', render: (r) => h('span', { class: r.profit >= 0 ? 'ig-pos' : 'ig-neg' }, formatSignedMoney(r.profit, true)), sort: (r) => r.profit },
    ],
    [],
    { onRowClick: (r) => focusTarget(ctx, { kind: 'building', id: r.id }), empty: 'Nie masz jeszcze budynków.' },
  );
  el.append(topEl, section('Wszystkie budynki', tbl.el));
  let sig = '';
  return () => {
    const st = ctx.state;
    const rows: Row[] = Object.values(st.buildings)
      .filter((b) => b.owner === st.playerCompanyId)
      .map((b) => {
        const d = ctx.data.buildings[b.typeId];
        return { id: b.id, name: b.name ?? d?.name ?? b.typeId, icon: d?.icon ?? '🏢', status: b.status, eff: b.efficiency, profit: buildingProfit(b), revenue: b.stats.revenueMonth };
      });
    const s = rows.map((r) => `${r.id}:${r.status}:${Math.round(r.profit)}:${Math.round(r.revenue / 100)}:${r.eff.toFixed(2)}`).join(',');
    if (s === sig) return;
    sig = s;
    tbl.setRows(rows);
    const sorted = [...rows].sort((a, b) => b.profit - a.profit);
    const list = (title: string, items: Row[]): HTMLElement =>
      section(
        title,
        items.length
          ? h('div', { class: 'ig-list' }, items.map((r) => h('div', { class: 'ig-list-item ig-clickable', onclick: () => focusTarget(ctx, { kind: 'building', id: r.id }) }, h('span', null, r.icon), h('span', { class: 'ig-grow' }, r.name), h('span', { class: r.profit >= 0 ? 'ig-pos' : 'ig-neg' }, formatSignedMoney(r.profit, true)))))
          : h('div', { class: 'ig-muted ig-small' }, '—'),
      );
    setChildren(topEl, list('🏆 Najbardziej zyskowne', sorted.slice(0, 5)), list('⚠ Najmniej zyskowne', sorted.slice(-5).reverse().filter((r) => !sorted.slice(0, 5).includes(r) || sorted.length <= 5)));
  };
}

// ---------------------------------------------------------------- routes
export function routes(el: HTMLElement, ctx: GameContext): () => void {
  const util = (id: number): { load: number; noPath: number } => {
    try {
      const u = routeUtilisation(ctx, id);
      return { load: Math.round(u.avgLoad * 100) / 100, noPath: u.noPath };
    } catch {
      return { load: 0, noPath: 0 };
    }
  };
  type Row = { id: number; name: string; mode: string; color: string; stops: number; vehicles: number; thr: number; profit: number; enabled: boolean; load: number; noPath: number };
  const tbl = table<Row>(
    [
      { key: 'name', label: 'Trasa', render: (r) => h('span', null, h('span', { class: 'ig-route-dot', style: { background: r.color } }), ` ${MODE_ICON[r.mode as 'road'] ?? ''} ${r.name}`, r.enabled ? '' : ' ⏸'), sort: (r) => r.name },
      { key: 'stops', label: 'Przyst.', align: 'right', sort: (r) => r.stops },
      { key: 'vehicles', label: 'Pojazdy', align: 'right', render: (r) => (r.vehicles ? String(r.vehicles) : badge('0', 'neg')), sort: (r) => r.vehicles },
      { key: 'load', label: 'Załadunek', align: 'right', render: (r) => h('span', { class: 'ig-row', style: { justifyContent: 'flex-end' } }, r.noPath ? badge('brak drogi', 'neg') : '', meter(r.load, { color: goodColor(r.load), width: 46 }), formatPercent(r.load)), sort: (r) => r.load },
      { key: 'thr', label: 'Przewóz/mies.', align: 'right', render: (r) => formatNumber(r.thr), sort: (r) => r.thr },
      { key: 'profit', label: 'Zysk (poprz.)', align: 'right', render: (r) => h('span', { class: r.profit >= 0 ? 'ig-pos' : 'ig-neg' }, formatSignedMoney(r.profit, true)), sort: (r) => r.profit },
    ],
    [],
    { onRowClick: (r) => ctx.ui.openPanel('route', { routeId: r.id }), empty: 'Brak tras. Użyj „Połącz z…” w inspektorze budynku lub utwórz trasę ręcznie.' },
  );
  const sugg = h('div');
  el.append(
    h('div', { class: 'ig-row', style: { marginBottom: '8px' } }, button('Nowa trasa', () => openNewRoute(ctx), { icon: '➕', variant: 'primary', small: true })),
    tbl.el,
    section('Sugerowane połączenia', sugg),
  );
  let sig = '';
  let suggAt = 0;
  return () => {
    const st = ctx.state;
    const rows: Row[] = Object.values(st.routes)
      .filter((r) => r.owner === st.playerCompanyId)
      .map((r) => ({
        id: r.id,
        name: r.name,
        mode: r.mode,
        color: r.color,
        stops: r.stops.length,
        vehicles: r.vehicleIds.length,
        thr: lastOf(r.stats.throughputHistory) ?? Object.values(r.stats.deliveredMonth).reduce((a, b) => a + b, 0),
        profit: routeProfit(r),
        enabled: r.enabled,
        ...util(r.id),
      }));
    const s = JSON.stringify(rows);
    if (s !== sig) {
      sig = s;
      tbl.setRows(rows);
    }
    if (performance.now() - suggAt > 4000) {
      suggAt = performance.now();
      let list: ReturnType<typeof ctx.services.logistics.suggestRoutes> = [];
      try {
        list = ctx.services.logistics.suggestRoutes(st.playerCompanyId, 5);
      } catch {
        list = [];
      }
      setChildren(
        sugg,
        list.length === 0
          ? h('div', { class: 'ig-muted ig-small' }, 'Wszystkie łańcuchy są połączone.')
          : list.map((sg) => {
              const a = st.buildings[sg.fromBuilding];
              const b = st.buildings[sg.toBuilding];
              if (!a || !b) return null;
              const da = ctx.data.buildings[a.typeId];
              const db = ctx.data.buildings[b.typeId];
              return h(
                'div',
                { class: 'ig-route-row' },
                linkButton(`${da?.icon ?? ''} ${a.name ?? da?.name ?? ''}`, () => focusTarget(ctx, { kind: 'building', id: a.id })),
                h('span', null, `→ ${ctx.data.products[sg.productId]?.icon ?? ''} →`),
                linkButton(`${db?.icon ?? ''} ${b.name ?? db?.name ?? ''}`, () => focusTarget(ctx, { kind: 'building', id: b.id })),
                h('span', { class: 'ig-muted ig-small' }, `${Math.round(sg.distance)} kafli`),
                h('span', { class: 'ig-grow' }),
                button('Połącz', () => {
                  const res = ctx.services.logistics.autoConnect(st.playerCompanyId, a.id, b.id, 'road');
                  if (res.ok) ctx.ui.toast({ level: 'success', icon: '🔗', title: 'Połączono', text: formatMoney(res.cost) });
                  else ctx.ui.toast({ level: 'warning', title: 'Nie udało się połączyć', text: res.reason });
                  suggAt = 0;
                }, { small: true }),
              );
            }),
      );
    }
  };
}

// ---------------------------------------------------------------- loans
function loans(el: HTMLElement, ctx: GameContext): () => void {
  const info = h('div');
  const list = h('div', { class: 'ig-list' });
  let amount = 50_000;
  let term = 36;
  const payEl = h('div', { class: 'ig-small ig-muted' });
  const amountSlider = slider({ min: 5_000, max: 1_000_000, step: 5_000, value: amount, format: (v) => formatMoney(v, true) }, (v) => {
    amount = v;
    updPay();
  });
  const termSeg = segmented(
    [12, 24, 36, 60, 120].map((m) => ({ value: m, label: `${m} mies.` })),
    term,
    (v) => {
      term = v;
      updPay();
    },
  );
  const rate = (): number => ctx.state.market.interestRate || 0.08;
  const updPay = (): void => {
    setChildren(payEl, `Rata: ~${formatMoney(loanPayment(amount, rate(), term))}/mies. · oprocentowanie ${formatPercent(rate(), 1)} rocznie · łącznie do spłaty ~${formatMoney(loanPayment(amount, rate(), term) * term, true)}`);
  };
  el.append(
    info,
    section('Aktywne kredyty', list),
    section(
      'Nowy kredyt',
      h('div', { class: 'ig-field' }, h('span', null, 'Kwota'), amountSlider.el),
      h('div', { class: 'ig-field' }, h('span', null, 'Okres'), termSeg.el),
      payEl,
      h(
        'div',
        { class: 'ig-row ig-row-end', style: { marginTop: '8px' } },
        button('Weź kredyt', () => {
          const res = ctx.services.economy.takeLoan(ctx.state.playerCompanyId, amount, term);
          if (res.ok) {
            ctx.ui.toast({ level: 'success', icon: '🏦', title: `Kredyt przyznany: ${formatMoney(amount)}` });
            ctx.bus.emit('sfx', { id: 'cash' });
          } else ctx.ui.toast({ level: 'warning', icon: '🏦', title: 'Bank odmówił', text: res.reason });
          sig = '';
          upd();
        }, { variant: 'primary', icon: '🏦' }),
      ),
    ),
  );
  let sig = '';
  const upd = (): void => {
    const p = player(ctx);
    const debt = p.loans.reduce((a, l) => a + l.remaining, 0);
    const avail = Math.max(0, p.creditLimit - debt);
    const maxAmount = Math.max(5_000, Math.floor(avail / 5_000) * 5_000);
    amountSlider.input.max = String(maxAmount);
    if (amount > maxAmount) {
      // the credit limit shrank (valuation / reputation) — keep the requested amount within it
      amount = maxAmount;
      amountSlider.input.value = String(amount);
      amountSlider.input.dispatchEvent(new Event('input'));
    }
    amountSlider.input.disabled = avail < 5_000;
    setChildren(
      info,
      h(
        'div',
        { class: 'ig-kpis' },
        h('div', { class: 'ig-kpi' }, h('div', { class: 'ig-kpi-title' }, '🏦 Limit kredytowy'), h('div', { class: 'ig-kpi-value' }, formatMoney(p.creditLimit, true))),
        h('div', { class: 'ig-kpi' }, h('div', { class: 'ig-kpi-title' }, '📉 Zadłużenie'), h('div', { class: 'ig-kpi-value ig-neg' }, formatMoney(debt, true))),
        h('div', { class: 'ig-kpi' }, h('div', { class: 'ig-kpi-title' }, '✅ Dostępne'), h('div', { class: 'ig-kpi-value ig-pos' }, formatMoney(avail, true))),
        h('div', { class: 'ig-kpi' }, h('div', { class: 'ig-kpi-title' }, '📆 Raty/mies.'), h('div', { class: 'ig-kpi-value' }, formatMoney(p.loans.reduce((a, l) => a + l.monthlyPayment, 0), true))),
      ),
    );
    updPay();
    const s = JSON.stringify(p.loans.map((l) => [l.id, Math.round(l.remaining)])) + Math.floor(p.cash / 1000);
    if (s === sig) return;
    sig = s;
    setChildren(
      list,
      p.loans.length === 0
        ? h('div', { class: 'ig-muted ig-small' }, 'Brak kredytów.')
        : p.loans.map((l) =>
            h(
              'div',
              { class: 'ig-list-item' },
              h(
                'div',
                { class: 'ig-grow' },
                h('div', { class: 'ig-strong' }, `${formatMoney(l.remaining)} z ${formatMoney(l.principal)}`),
                h('div', { class: 'ig-muted ig-small' }, `${formatPercent(l.annualRate, 1)} · rata ${formatMoney(l.monthlyPayment)}/mies. · ${l.termMonths} mies.`),
                meter(1 - l.remaining / Math.max(1, l.principal), { color: 'var(--success)', label: 'Spłacono' }),
              ),
              button('Spłać', async () => {
                if (!ctx.ui.root) return;
                const ans = await confirmDialog(ctx.ui.root, 'Spłacić kredyt?', `Spłata całości: ${formatMoney(l.remaining)}`, [
                  { id: 'no', label: 'Anuluj', variant: 'ghost' },
                  { id: 'yes', label: 'Spłać', variant: 'primary' },
                ]);
                if (ans !== 'yes') return;
                const res = ctx.services.economy.repayLoan(p.id, l.id);
                if (!res.ok) ctx.ui.toast({ level: 'warning', title: 'Nie można spłacić', text: res.reason });
                sig = '';
                upd();
              }, { small: true, disabled: p.cash < l.remaining }),
              button('−10 tys.', () => {
                const res = ctx.services.economy.repayLoan(p.id, l.id, Math.min(10_000, l.remaining));
                if (!res.ok) ctx.ui.toast({ level: 'warning', title: 'Nie można spłacić', text: res.reason });
                sig = '';
                upd();
              }, { small: true, variant: 'ghost', disabled: p.cash < Math.min(10_000, l.remaining) }),
            ),
          ),
    );
  };
  return upd;
}

// ---------------------------------------------------------------- rivals
function rivals(el: HTMLElement, ctx: GameContext): () => void {
  const chart = h('canvas', { class: 'ig-chart' });
  const body = h('div');
  el.append(
    h('div', { class: 'ig-row', style: { marginBottom: '8px' } }, button('Rywale i przejęcia', () => ctx.ui.openPanel('rivals'), { icon: '🏢', small: true, title: 'Budynki konkurentów na sprzedaż, przejęcia' })),
    body,
    section('Wartość firm w czasie', chart),
  );
  let chartAt = 0;
  let sig = '';
  return () => {
    const st = ctx.state;
    const rank = companyRanking(st, (id) => {
      try {
        return ctx.services.economy.companyValue(id);
      } catch {
        return st.companies[id]?.finances.valuation ?? 0;
      }
    });
    const s = JSON.stringify(rank.map((r) => [r.id, Math.round(r.value / 1000), Math.round(r.cash / 1000), r.buildings, r.vehicles]));
    if (s !== sig) {
      sig = s;
      setChildren(
        body,
        h(
          'div',
          { class: 'ig-rank' },
          rank.map((r, i) => {
            const c = st.companies[r.id]!;
            return h(
              'div',
              { class: `ig-rank-row${c.isPlayer ? ' me' : ''}${c.bankrupt ? ' bankrupt' : ''}` },
              h('span', { class: 'ig-rank-pos' }, i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`),
              h('span', { class: 'ig-route-dot big', style: { background: c.color } }),
              h('span', { class: 'ig-grow' }, h('div', { class: 'ig-strong' }, `${c.logo} ${c.name}`, c.isPlayer ? badge('Ty', 'accent') : '', c.bankrupt ? badge('bankrut', 'neg') : ''), h('div', { class: 'ig-muted ig-small' }, `${r.buildings} budynków · ${r.vehicles} pojazdów · reputacja ${Math.round(c.reputation)}${c.ai ? ` · ${aiLabel(c.ai.personality)}` : ''}`)),
              h('span', { class: 'ig-rank-val' }, h('div', { class: 'ig-strong' }, formatMoney(r.value, true)), h('div', { class: `ig-small ${r.profit >= 0 ? 'ig-pos' : 'ig-neg'}` }, `${formatSignedMoney(r.profit, true)}/mies.`)),
            );
          }),
        ),
      );
    }
    if (performance.now() - chartAt > 3000) {
      chartAt = performance.now();
      const series = Object.values(st.companies)
        .filter((c) => !c.acquiredBy)
        .map((c) => ({ name: c.name, values: st.stats.monthly[`company.${c.id}.value`] ?? c.finances.valuationHistory, color: c.color }))
        .filter((x) => x.values.length > 1);
      chart.style.display = series.length ? '' : 'none';
      if (series.length) lineChart(chart, series, { height: 180, yFormat: (v) => formatMoney(v, true).replace(' zł', '') });
    }
  };
}

function aiLabel(p: string): string {
  return ({ balanced: 'zrównoważony', aggressive: 'agresywny', cautious: 'ostrożny', industrialist: 'przemysłowiec', merchant: 'kupiec', green: 'ekologiczny' } as Record<string, string>)[p] ?? p;
}

// ---------------------------------------------------------------- panel
export const dashboardPanel: PanelDef = {
  id: 'dashboard',
  title: 'Panel CEO',
  icon: '📊',
  width: 880,
  refreshMs: 500,
  create(p: PanelInstance, ctx) {
    const initial = (p.args as { tab?: string } | undefined)?.tab ?? 'overview';
    const bar = h('div', { class: 'ig-tabs-bar' });
    const content = h('div', { class: 'ig-tabs-content ig-dashboard' });
    p.body.append(bar, content);
    const panes = new Map<string, { el: HTMLElement; update: () => void }>();
    const btns = new Map<string, HTMLElement>();
    let active = '';
    const builders: Record<string, (el: HTMLElement, c: GameContext) => () => void> = {
      overview,
      finance,
      buildings,
      routes,
      loans,
      research: (el, c) => renderResearch(el, c),
      rivals,
    };
    const selectTab = (id: string): void => {
      if (!builders[id]) id = 'overview';
      active = id;
      for (const [k, b] of btns) b.classList.toggle('active', k === id);
      let pane = panes.get(id);
      if (!pane) {
        const el = h('div');
        let update: () => void = () => {};
        try {
          update = builders[id]!(el, ctx);
        } catch (err) {
          el.append(h('div', { class: 'ig-error' }, String(err)));
        }
        pane = { el, update };
        panes.set(id, pane);
      }
      content.replaceChildren(pane.el);
      pane.update();
    };
    for (const t of TABS) {
      const b = h('button', { class: 'ig-tab', onclick: () => selectTab(t.id) }, t.label);
      btns.set(t.id, b);
      bar.append(b);
    }
    selectTab(initial);
    p.onUpdate = () => panes.get(active)?.update();
    // reopening with another tab switches tabs
    const inst = p as PanelInstance & { selectTab?: (id: string) => void };
    inst.selectTab = selectTab;
  },
};

/** Standalone route list (all player routes). */
export const routesPanel: PanelDef = {
  id: 'routes',
  title: 'Trasy',
  icon: '🛣️',
  width: 720,
  refreshMs: 1000,
  create(p, ctx) {
    p.onUpdate = routes(p.body, ctx);
  },
};
