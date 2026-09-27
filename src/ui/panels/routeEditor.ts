/**
 * Route editor (panel 'route', args { routeId } or { draft: { mode } } for a new route).
 * Stops list with orders per stop (load/unload + product filter, wait for full),
 * reorder/remove, add stop via map pick; vehicles list (buy/sell/unassign),
 * priority, enable/pause, rename, delete; stats + throughput chart.
 * All changes go through ctx.services.logistics.
 */
import type { GameContext } from '../../core/context';
import { formatMoney, formatNumber, formatSignedMoney } from '../../core/format';
import type { ProductId, Route, RouteOrder, RouteStop, TransportMode } from '../../core/types';
import { stockTotal } from '../../core/util';
import type { PickArgs } from '../../input/tools/pick';
import { lineChart } from '../charts';
import { badge, button, chip, confirmDialog, emptyState, linkButton, meter, section, segmented, select } from '../components';
import { h, setChildren } from '../dom';
import { MODE_ICON, MODE_LABEL, VEHICLE_STATUS, lockInfo, productIcon, productName } from '../fmt';
import { focusTarget } from '../ui';
import type { PanelDef } from '../types';
import { kv } from './inspector/common';

interface RouteArgs {
  routeId?: number;
  draft?: { mode?: TransportMode; stops?: number[] };
}

const cloneStops = (s: RouteStop[]): RouteStop[] => JSON.parse(JSON.stringify(s)) as RouteStop[];

function productsOf(ctx: GameContext, buildingId: number): ProductId[] {
  const b = ctx.state.buildings[buildingId];
  if (!b) return [];
  const r = b.recipeId ? ctx.data.recipes[b.recipeId] : undefined;
  const set = new Set<ProductId>([...(r?.outputs.map((o) => o.product) ?? []), ...(r?.inputs.map((o) => o.product) ?? []), ...Object.keys(b.output), ...Object.keys(b.storage)]);
  for (const p of ctx.data.buildings[b.typeId]?.sells ?? []) set.add(p);
  return [...set];
}

export const routePanel: PanelDef = {
  id: 'route',
  title: 'Trasa',
  icon: '🛣️',
  width: 440,
  position: 'left',
  refreshMs: 500,
  key: (args) => `route:${(args as RouteArgs | undefined)?.routeId ?? 'new'}`,
  create(p, ctx) {
    const args = (p.args ?? {}) as RouteArgs;
    let routeId = args.routeId ?? 0;
    let draftMode: TransportMode = args.draft?.mode ?? 'road';
    let draftStops: RouteStop[] = (args.draft?.stops ?? []).map((id, k, arr) => ({
      buildingId: id,
      orders: [{ action: k === arr.length - 1 && k > 0 ? 'unload' : 'load', products: 'all', limit: 0 }],
      waitFull: false,
      minLoad: 0,
    }));
    const route = (): Route | undefined => (routeId ? ctx.tryState()?.routes[routeId] : undefined);
    const isDraft = (): boolean => !routeId;
    const stops = (): RouteStop[] => route()?.stops ?? draftStops;
    const mode = (): TransportMode => route()?.mode ?? draftMode;

    const applyStops = (next: RouteStop[]): void => {
      if (isDraft()) {
        draftStops = next;
        renderAll();
        return;
      }
      const ok = ctx.services.logistics.updateRoute(routeId, { stops: next });
      if (!ok) {
        ctx.ui.toast({ level: 'warning', icon: '🛣️', title: 'Nie można zapisać przystanków', text: 'Sprawdź, czy budynki należą do Ciebie i obsługują ten rodzaj transportu.' });
        ctx.bus.emit('sfx', { id: 'error' });
      }
      renderAll();
    };

    const header = h('div');
    const statsEl = h('div');
    const chart = h('canvas', { class: 'ig-chart' });
    const stopsEl = h('div', { class: 'ig-stops' });
    const vehEl = h('div');
    const footer = h('div', { class: 'ig-insp-actions' });
    p.body.append(header, section('Przystanki', stopsEl), section('Pojazdy', vehEl), section('Statystyki', statsEl, chart), footer);

    const addStop = (): void => {
      const pick: PickArgs = {
        prompt: 'Wskaż budynek — nowy przystanek trasy',
        icon: '🛣️',
        kinds: ['building'],
        accept: (sel) => {
          if (sel.kind !== 'building') return 'Wskaż budynek';
          const b = ctx.state.buildings[sel.id];
          if (!b) return 'Brak budynku';
          if (b.owner !== ctx.state.playerCompanyId && ctx.data.buildings[b.typeId]?.category !== 'export') return 'To nie Twój budynek';
          return true;
        },
        onPick: (sel) => {
          if (sel.kind !== 'building') return;
          const next = cloneStops(stops());
          const isFirst = next.length === 0;
          next.push({ buildingId: sel.id, orders: [{ action: isFirst ? 'load' : 'unload', products: 'all', limit: 0 }], waitFull: false, minLoad: 0 });
          applyStops(next);
          ctx.ui.openPanel('route', p.args);
        },
      };
      ctx.input.setTool('pick', pick);
    };

    const orderEditor = (idx: number, stop: RouteStop): HTMLElement => {
      const load = stop.orders.find((o) => o.action === 'load');
      const unload = stop.orders.find((o) => o.action === 'unload');
      const products = productsOf(ctx, stop.buildingId);
      const setOrder = (action: RouteOrder['action'], on: boolean, prods?: ProductId[] | 'all'): void => {
        const next = cloneStops(stops());
        const s = next[idx]!;
        s.orders = s.orders.filter((o) => o.action !== action);
        if (on) s.orders.push({ action, products: prods ?? 'all', limit: 0 });
        s.orders.sort((a) => (a.action === 'unload' ? -1 : 1));
        applyStops(next);
      };
      const prodSel = (action: RouteOrder['action'], o: RouteOrder | undefined): HTMLElement | null => {
        if (!o || !products.length) return null;
        const cur = o.products === 'all' ? 'all' : (o.products[0] ?? 'all');
        return select<string>(
          [{ value: 'all', label: 'wszystko' }, ...products.map((pp) => ({ value: pp, label: `${productIcon(ctx, pp)} ${productName(ctx, pp)}` }))],
          cur,
          (v) => setOrder(action, true, v === 'all' ? 'all' : [v]),
          'ig-select-sm',
        );
      };
      return h(
        'div',
        { class: 'ig-orders' },
        chip('⬆ Załaduj', { active: !!load, onClick: () => setOrder('load', !load), title: 'Pobierz towary na tym przystanku' }),
        prodSel('load', load),
        chip('⬇ Rozładuj', { active: !!unload, onClick: () => setOrder('unload', !unload), title: 'Oddaj towary na tym przystanku' }),
        prodSel('unload', unload),
        chip('⏳ Czekaj na pełny', {
          active: stop.waitFull,
          title: 'Pojazd czeka, aż zapełni ładownię',
          onClick: () => {
            const next = cloneStops(stops());
            next[idx]!.waitFull = !next[idx]!.waitFull;
            next[idx]!.minLoad = next[idx]!.waitFull ? 1 : 0;
            applyStops(next);
          },
        }),
      );
    };

    const renderStops = (): void => {
      const list = stops();
      const st = ctx.state;
      setChildren(
        stopsEl,
        list.length === 0 ? emptyState('🛣️', 'Brak przystanków. Dodaj co najmniej dwa budynki.') : null,
        list.map((s, i) => {
          const b = st.buildings[s.buildingId];
          const d = b ? ctx.data.buildings[b.typeId] : undefined;
          let legOk = true;
          if (!isDraft() && list.length > 1) {
            const nxt = list[(i + 1) % list.length]!;
            try {
              legOk = ctx.services.logistics.isConnected(mode(), s.buildingId, nxt.buildingId);
            } catch {
              legOk = true;
            }
          }
          return h(
            'div',
            { class: 'ig-stop' },
            h('div', { class: 'ig-stop-num' }, String(i + 1)),
            h(
              'div',
              { class: 'ig-grow' },
              h(
                'div',
                { class: 'ig-row' },
                linkButton(b ? `${d?.icon ?? ''} ${b.name ?? d?.name ?? ''}` : '(usunięty budynek)', () => focusTarget(ctx, { kind: 'building', id: s.buildingId })),
                !legOk ? badge('brak drogi →', 'neg', 'Brak połączenia z następnym przystankiem — zbuduj drogę/tory') : null,
              ),
              orderEditor(i, s),
            ),
            h(
              'div',
              { class: 'ig-stop-btns' },
              button('', () => {
                if (i === 0) return;
                const next = cloneStops(list);
                [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
                applyStops(next);
              }, { icon: '↑', small: true, variant: 'ghost', title: 'W górę', disabled: i === 0 }),
              button('', () => {
                if (i === list.length - 1) return;
                const next = cloneStops(list);
                [next[i + 1], next[i]] = [next[i]!, next[i + 1]!];
                applyStops(next);
              }, { icon: '↓', small: true, variant: 'ghost', title: 'W dół', disabled: i === list.length - 1 }),
              button('', () => applyStops(cloneStops(list).filter((_, k) => k !== i)), { icon: '✕', small: true, variant: 'ghost', title: 'Usuń przystanek' }),
            ),
          );
        }),
        h('div', { class: 'ig-row', style: { marginTop: '6px' } }, button('Dodaj przystanek', addStop, { icon: '➕', small: true })),
      );
    };

    let buyType = '';
    let wagons = 2;
    const renderVehicles = (): void => {
      const r = route();
      const st = ctx.state;
      if (!r) {
        setChildren(vehEl, h('div', { class: 'ig-muted ig-small' }, 'Pojazdy dodasz po utworzeniu trasy.'));
        return;
      }
      const types = ctx.data.vehicleList().filter((v) => v.mode === r.mode);
      const avail = types.filter((v) => lockInfo(ctx, 'vehicle', v.id).unlocked);
      if (!avail.some((v) => v.id === buyType)) buyType = avail[0]?.id ?? '';
      const cash = st.companies[st.playerCompanyId]?.cash ?? 0;
      const vdef = ctx.data.vehicles[buyType];
      setChildren(
        vehEl,
        r.vehicleIds.length === 0 ? h('div', { class: 'ig-warn ig-small' }, '⚠ Trasa bez pojazdów — nic nie jest przewożone.') : null,
        r.vehicleIds.map((vid) => {
          const v = st.vehicles[vid];
          if (!v) return null;
          const tot = stockTotal(v.cargo);
          return h(
            'div',
            { class: 'ig-route-row' },
            h('span', null, ctx.data.vehicles[v.typeId]?.icon ?? MODE_ICON[v.mode]),
            linkButton(v.name, () => focusTarget(ctx, { kind: 'vehicle', id: vid })),
            h('span', { class: 'ig-muted ig-small' }, VEHICLE_STATUS[v.status] ?? v.status),
            meter(v.capacity ? tot / v.capacity : 0, { width: 50, label: `Ładunek ${formatNumber(tot, 1)}/${formatNumber(v.capacity)}` }),
            h('span', { class: 'ig-grow' }),
            button('', () => {
              ctx.services.logistics.assignVehicle(vid, null);
              renderAll();
            }, { icon: '⏏', small: true, variant: 'ghost', title: 'Odłącz od trasy' }),
            button('', () => {
              const res = ctx.services.logistics.sellVehicle(vid);
              if (!res.ok) ctx.ui.toast({ level: 'warning', title: 'Nie można sprzedać', text: res.reason });
              renderAll();
            }, { icon: '💰', small: true, variant: 'ghost', title: 'Sprzedaj pojazd' }),
          );
        }),
        avail.length
          ? h(
              'div',
              { class: 'ig-row', style: { marginTop: '6px', flexWrap: 'wrap' } },
              select(
                avail.map((v) => ({ value: v.id, label: `${v.icon} ${v.name} — ${v.capacity} j., ${v.speed} kaf./dz., ${formatMoney(v.cost, true)}` })),
                buyType,
                (val) => {
                  buyType = val;
                  renderVehicles();
                },
                'ig-grow',
              ),
              vdef?.wagons
                ? select(
                    Array.from({ length: vdef.wagons.max - vdef.wagons.min + 1 }, (_, k) => vdef.wagons!.min + k).map((n) => ({ value: n, label: `${n} wag.` })),
                    Math.min(vdef.wagons.max, Math.max(vdef.wagons.min, wagons)),
                    (n) => (wagons = n),
                  )
                : null,
              button('Kup', () => {
                const res = ctx.services.logistics.buyVehicle(st.playerCompanyId, buyType, r.id, vdef?.wagons ? { wagons } : undefined);
                if (res.ok) ctx.ui.toast({ level: 'success', icon: vdef?.icon ?? '🚚', title: `Kupiono: ${vdef?.name ?? ''}`, text: formatMoney(res.cost) });
                else {
                  ctx.ui.toast({ level: 'warning', title: 'Zakup nieudany', text: res.reason });
                  ctx.bus.emit('sfx', { id: 'error' });
                }
                renderAll();
              }, { icon: '➕', small: true, variant: 'primary', disabled: !vdef || vdef.cost > cash }),
            )
          : h('div', { class: 'ig-muted ig-small' }, `Brak dostępnych pojazdów (${MODE_LABEL[r.mode]}).`),
      );
    };

    const renderHeader = (): void => {
      const r = route();
      if (!r) {
        const seg = segmented<TransportMode>(
          [
            { value: 'road', label: '🚚 Drogowa' },
            { value: 'rail', label: '🚂 Kolejowa' },
            { value: 'water', label: '🚢 Wodna' },
          ],
          draftMode,
          (v) => (draftMode = v),
        );
        setChildren(header, h('div', { class: 'ig-muted ig-small' }, 'Nowa trasa — wybierz rodzaj transportu i dodaj przystanki.'), seg.el);
        setChildren(
          footer,
          h('span', { class: 'ig-grow' }),
          button('Utwórz trasę', () => {
            const res = ctx.services.logistics.createRoute(ctx.state.playerCompanyId, { mode: draftMode, stops: draftStops });
            if (!res.ok) {
              ctx.ui.toast({ level: 'warning', title: 'Nie można utworzyć trasy', text: res.reason });
              return;
            }
            const w = (res as { warning?: string }).warning;
            if (w) ctx.ui.toast({ level: 'warning', icon: '🛣️', title: 'Trasa utworzona z ostrzeżeniem', text: w });
            p.close();
            ctx.ui.openPanel('route', { routeId: res.id });
          }, { variant: 'primary', icon: '✔', disabled: draftStops.length < 2 }),
        );
        return;
      }
      p.setTitle(`${MODE_ICON[r.mode]} ${r.name}`);
      const name = h('input', {
        type: 'text',
        class: 'ig-grow',
        value: r.name,
        onchange: () => {
          if (name.value.trim()) ctx.services.logistics.updateRoute(r.id, { name: name.value.trim() });
          p.setTitle(`${MODE_ICON[r.mode]} ${name.value}`);
        },
      });
      setChildren(
        header,
        h('div', { class: 'ig-row' }, h('span', { class: 'ig-route-dot big', style: { background: r.color } }), name, badge(MODE_LABEL[r.mode], 'info'), r.auto ? badge('auto', 'dim', 'Utworzona automatycznie') : null),
        h(
          'div',
          { class: 'ig-row', style: { marginTop: '6px' } },
          select(
            [1, 2, 3, 4, 5].map((v) => ({ value: v, label: `Priorytet ${v}` })),
            r.priority,
            (v) => ctx.services.logistics.updateRoute(r.id, { priority: v }),
          ),
          button(r.enabled ? 'Wstrzymaj' : 'Wznów', () => {
            const ok = ctx.services.logistics.updateRoute(r.id, { enabled: !r.enabled });
            if (!ok) {
              r.enabled = !r.enabled;
              ctx.bus.emit('route:changed', { routeId: r.id });
            }
            renderAll();
          }, { icon: r.enabled ? '⏸' : '▶', small: true }),
          button('', () => ctx.bus.emit('select', { kind: 'route', id: r.id }), { icon: '📍', small: true, variant: 'ghost', title: 'Podświetl na mapie' }),
        ),
      );
      setChildren(
        footer,
        h('span', { class: 'ig-grow' }),
        button('Usuń trasę', async () => {
          if (!ctx.ui.root) return;
          const ans = await confirmDialog(ctx.ui.root, 'Usunąć trasę?', `Pojazdy (${r.vehicleIds.length}) zostaną odłączone.`, [
            { id: 'no', label: 'Anuluj', variant: 'ghost' },
            { id: 'yes', label: 'Usuń', variant: 'danger' },
          ]);
          if (ans === 'yes' && ctx.services.logistics.removeRoute(r.id)) p.close();
        }, { icon: '🗑', small: true, variant: 'danger' }),
      );
    };

    let chartAt = 0;
    const renderStats = (): void => {
      const r = route();
      if (!r) {
        statsEl.replaceChildren();
        chart.style.display = 'none';
        return;
      }
      const s = r.stats;
      const last = s.profitHistory[s.profitHistory.length - 1];
      const delivered = Object.entries(s.deliveredMonth);
      statsEl.replaceChildren(
        kv('Kursy (mies.)', String(s.tripsMonth)),
        kv('Przewieziono (mies.)', delivered.length ? delivered.map(([pp, q]) => `${productIcon(ctx, pp)} ${formatNumber(q)}`).join('  ') : '—'),
        kv('Przychód (mies.)', formatMoney(s.revenueMonth), 'ig-pos'),
        kv('Koszty (mies.)', formatMoney(s.costMonth), 'ig-neg'),
        kv('Zysk (poprz. mies.)', last === undefined ? '—' : formatSignedMoney(last), last !== undefined && last < 0 ? 'ig-neg' : 'ig-pos'),
      );
      if (performance.now() - chartAt > 3000) {
        chartAt = performance.now();
        const th = s.throughputHistory;
        chart.style.display = th.length > 1 ? '' : 'none';
        if (th.length > 1) lineChart(chart, [{ name: 'Przepustowość (j./mies.)', values: th, color: r.color || '#6fa3d8' }], { width: 400, height: 100 });
      }
    };

    let sig = '';
    const signature = (): string => {
      const r = route();
      if (!r) return `draft:${JSON.stringify(draftStops)}`;
      const st = ctx.state;
      return `${JSON.stringify(r.stops)}|${r.vehicleIds.join(',')}|${r.enabled}|${r.priority}|${r.name}|${r.vehicleIds.map((v) => st.vehicles[v]?.status).join(',')}|${Math.floor((st.companies[st.playerCompanyId]?.cash ?? 0) / 1000)}`;
    };
    const renderAll = (): void => {
      sig = signature();
      renderHeader();
      renderStops();
      renderVehicles();
      renderStats();
    };
    renderAll();

    const off = ctx.bus.on('route:removed', ({ routeId: rid }) => {
      if (rid === routeId) p.close();
    });
    p.onClose = off;
    p.onUpdate = () => {
      if (routeId && !route()) return p.close();
      if (signature() !== sig) renderAll();
      else renderStats();
    };
  },
};

/** Open the editor for a new route (optionally with preselected stops). */
export function openNewRoute(ctx: GameContext, mode: TransportMode = 'road', stops: number[] = []): void {
  ctx.ui.closePanel('route:new');
  ctx.ui.openPanel('route', { draft: { mode, stops } });
}
