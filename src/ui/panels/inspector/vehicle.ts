/** Vehicle inspector: status, route (assign), cargo, stats, profit chart, follow camera, sell. */
import type { GameContext } from '../../../core/context';
import { formatMoney, formatNumber, formatPercent, formatSignedMoney } from '../../../core/format';
import { stockTotal } from '../../../core/util';
import { lineChart } from '../../charts';
import { badge, button, confirmDialog, goodColor, meter, section, select } from '../../components';
import { h } from '../../dom';
import { MODE_ICON, MODE_LABEL, VEHICLE_STATUS } from '../../fmt';
import { focusTarget } from '../../ui';
import type { PanelInstance } from '../../types';
import { dyn, kv, stockList } from './common';

export function renderVehicleInspector(p: PanelInstance, ctx: GameContext, id: number): void {
  const get = () => ctx.tryState()?.vehicles[id];
  const v0 = get();
  if (!v0) {
    p.body.append(h('div', { class: 'ig-muted' }, 'Pojazd nie istnieje.'));
    return;
  }
  const def = ctx.data.vehicles[v0.typeId];
  const isMine = v0.owner === ctx.state.playerCompanyId;

  let following = false;
  let offFrame: (() => void) | null = null;
  const followBtn = button('Śledź', () => {
    following = !following;
    followBtn.classList.toggle('ig-btn-primary', following);
    offFrame?.();
    offFrame = null;
    if (following)
      offFrame = ctx.renderer.onFrame(() => {
        const v = get();
        if (!v) return;
        const a = ctx.sim.alpha;
        ctx.renderer.camera.centerOnTile(v.prevX + (v.x - v.prevX) * a, v.prevY + (v.y - v.prevY) * a);
      });
  }, { icon: '🎥', small: true, title: 'Kamera podąża za pojazdem' });
  p.onClose = () => offFrame?.();

  const head = dyn((el) => {
    const v = get()!;
    el.append(
      h(
        'div',
        { class: 'ig-insp-head' },
        h('div', { class: 'ig-insp-icon' }, def?.icon ?? MODE_ICON[v.mode]),
        h(
          'div',
          { class: 'ig-grow' },
          h('div', { class: 'ig-muted ig-small' }, `${def?.name ?? v.typeId} · ${MODE_LABEL[v.mode]}`),
          badge(VEHICLE_STATUS[v.status] ?? v.status, v.status === 'noPath' || v.status === 'broken' ? 'neg' : v.status === 'idle' || v.status === 'waiting' ? 'warn' : 'pos'),
        ),
      ),
    );
  }, '', () => `${get()?.status}`);
  p.body.append(head.el, h('div', { class: 'ig-row' }, followBtn, button('', () => focusTarget(ctx, { kind: 'vehicle', id }, false), { icon: '📍', small: true, variant: 'ghost', title: 'Pokaż na mapie' })));

  // route assignment
  if (isMine) {
    const routes = Object.values(ctx.state.routes).filter((r) => r.owner === v0.owner && r.mode === v0.mode);
    const sel = select<number>(
      [{ value: 0, label: '— bez trasy —' }, ...routes.map((r) => ({ value: r.id, label: `${r.name} (${r.stops.length} przyst.)` }))],
      v0.routeId ?? 0,
      (val) => {
        const ok = ctx.services.logistics.assignVehicle(id, val || null);
        if (!ok) ctx.ui.toast({ level: 'warning', title: 'Nie udało się przypisać trasy' });
      },
      'ig-grow',
    );
    p.body.append(
      section(
        'Trasa',
        h('div', { class: 'ig-row' }, sel, button('Edytuj', () => {
          const v = get();
          if (v?.routeId) ctx.ui.openPanel('route', { routeId: v.routeId });
        }, { small: true, icon: '✏️' })),
      ),
    );
  }

  const cargo = dyn((el) => {
    const v = get()!;
    const tot = stockTotal(v.cargo);
    el.append(
      h('div', { class: 'ig-row ig-small' }, h('span', { class: 'ig-muted', style: { width: '80px' } }, 'Załadunek'), meter(v.capacity ? tot / v.capacity : 0, { width: 150 }), `${formatNumber(tot, 1)} / ${formatNumber(v.capacity)}`),
      stockList(ctx, v.cargo, 0, 'pusty'),
    );
  });
  p.body.append(section('Ładunek', cargo.el));

  const stats = dyn((el) => {
    const v = get()!;
    const route = v.routeId ? ctx.state.routes[v.routeId] : undefined;
    const stop = route?.stops[v.stopIndex];
    const target = stop ? ctx.state.buildings[stop.buildingId] : undefined;
    el.append(
      kv('Cel', target ? `${ctx.data.buildings[target.typeId]?.icon ?? ''} ${target.name ?? ctx.data.buildings[target.typeId]?.name ?? ''}` : '—'),
      kv('Prędkość', `${formatNumber(v.speed, 1)} kafli/dzień${def ? ` (maks. ${def.speed})` : ''}`),
      kv('Stan', h('span', null, meter(v.condition, { color: goodColor(v.condition), width: 70 }), ` ${formatPercent(v.condition)}`), v.condition < 0.3 ? 'ig-neg' : ''),
      kv('Wiek', `${formatNumber(v.ageDays / 360, 1)} lat${def ? ` / ${def.lifespanYears}` : ''}`),
      v.wagons ? kv('Wagony', String(v.wagons)) : '',
      kv('Kursy (mies.)', String(v.stats.tripsMonth)),
      kv('Dostarczono (mies.)', formatNumber(v.stats.deliveredMonth)),
      kv('Przychód (mies.)', formatMoney(v.stats.revenueMonth), 'ig-pos'),
      kv('Koszty (mies.)', formatMoney(v.stats.costMonth), 'ig-neg'),
      kv('Utrzymanie', `${formatMoney(def?.upkeep ?? 0)}/mies.`),
    );
  });
  p.body.append(section('Statystyki', stats.el));
  const chart = h('canvas', { class: 'ig-chart' });
  p.body.append(chart);
  let chartAt = 0;

  if (isMine) {
    p.body.append(
      h(
        'div',
        { class: 'ig-insp-actions' },
        h('span', { class: 'ig-grow' }),
        button('Sprzedaj', async () => {
          if (!ctx.ui.root) return;
          const ans = await confirmDialog(ctx.ui.root, 'Sprzedać pojazd?', `${get()?.name ?? ''} zostanie sprzedany.`, [
            { id: 'no', label: 'Anuluj', variant: 'ghost' },
            { id: 'yes', label: 'Sprzedaj', variant: 'danger' },
          ]);
          if (ans !== 'yes') return;
          const res = ctx.services.logistics.sellVehicle(id);
          if (res.ok) {
            ctx.ui.toast({ level: 'success', icon: '💰', title: 'Sprzedano pojazd', text: formatSignedMoney(-res.cost) });
            p.close();
          } else ctx.ui.toast({ level: 'warning', title: 'Nie można sprzedać', text: res.reason });
        }, { icon: '💰', small: true, variant: 'danger' }),
      ),
    );
  }

  p.onUpdate = () => {
    const v = get();
    if (!v) return p.close();
    p.setTitle(`${def?.icon ?? '🚚'} ${v.name}`);
    head.update();
    cargo.update();
    stats.update();
    if (performance.now() - chartAt > 3000) {
      chartAt = performance.now();
      const hist = v.stats.profitHistory;
      chart.style.display = hist.length > 1 ? '' : 'none';
      if (hist.length > 1) lineChart(chart, [{ name: 'Zysk / mies.', values: hist, color: 'var(--accent)' }], { width: 320, height: 100 });
    }
  };
}
