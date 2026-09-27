/**
 * Building inspector: status, construction, recipe selector (incl. alternative
 * recipes), production progress, input/output stock with quality, workers,
 * efficiency, pollution, profit chart, shop/hub settings, routes, auto-connect,
 * enable/disable, priority, upgrades, demolish, acquisition of rival buildings.
 */
import type { GameContext } from '../../../core/context';
import { addMoney } from '../../../core/money';
import { formatMoney, formatNumber, formatPercent, formatSignedMoney } from '../../../core/format';
import type { Building, TransportMode } from '../../../core/types';
import type { PickArgs } from '../../../input/tools/pick';
import { lineChart } from '../../charts';
import { badge, button, confirmDialog, goodColor, linkButton, meter, progressBar, section, select, segmented } from '../../components';
import { h, setText } from '../../dom';
import { BUILDING_STATUS, CATEGORY_LABEL, MODE_ICON, companyLabel, effectsText, ioText, productIcon, productLabel } from '../../fmt';
import { tooltip } from '../../tooltip';
import { focusTarget } from '../../ui';
import type { PanelInstance } from '../../types';
import { dyn, kv, stockList } from './common';

/** Buildings of the player that could receive `b`'s outputs / supply its inputs, nearest first. */
export function connectionCandidates(ctx: GameContext, b: Building): { building: Building; dir: 'out' | 'in'; products: string[]; dist: number }[] {
  const st = ctx.state;
  const d = ctx.data;
  const r = b.recipeId ? d.recipes[b.recipeId] : undefined;
  const def = d.buildings[b.typeId];
  const outs = r?.outputs.map((o) => o.product) ?? [];
  const ins = r?.inputs.map((i) => i.product) ?? (def?.category === 'shop' ? (def.sells ?? []) : []);
  const res: { building: Building; dir: 'out' | 'in'; products: string[]; dist: number }[] = [];
  for (const o of Object.values(st.buildings)) {
    if (o.id === b.id || o.owner !== b.owner) continue;
    const od = d.buildings[o.typeId];
    if (!od) continue;
    const or = o.recipeId ? d.recipes[o.recipeId] : undefined;
    const oIns = or?.inputs.map((i) => i.product) ?? (od.category === 'shop' ? (od.sells ?? []) : []);
    const oOuts = or?.outputs.map((x) => x.product) ?? [];
    const dist = Math.round(Math.hypot(o.x - b.x, o.y - b.y));
    const sendP = outs.filter((p) => oIns.includes(p) || (od.category === 'warehouse' && outs.length));
    const recvP = ins.filter((p) => oOuts.includes(p));
    if (sendP.length) res.push({ building: o, dir: 'out', products: sendP, dist });
    else if (recvP.length) res.push({ building: o, dir: 'in', products: recvP, dist });
  }
  return res.sort((a, b2) => a.dist - b2.dist).slice(0, 6);
}

function setEnabled(ctx: GameContext, b: Building, on: boolean): void {
  const svc = ctx.services.economy.setBuildingEnabled;
  if (svc) svc(b.id, on);
  else {
    b.enabled = on;
    if (!on) b.status = 'disabled';
    ctx.bus.emit('building:changed', { buildingId: b.id });
  }
  ctx.bus.emit('sfx', { id: 'click' });
}

function doUpgrade(ctx: GameContext, b: Building, upgradeId: string): void {
  const def = ctx.data.buildings[b.typeId];
  const up = def?.upgrades?.find((u) => u.id === upgradeId);
  if (!up) return;
  const svc = ctx.services.economy.upgradeBuilding;
  if (svc) {
    const res = svc(b.id, upgradeId);
    if (!res.ok) ctx.ui.toast({ level: 'warning', title: 'Ulepszenie nieudane', text: res.reason });
    else ctx.ui.toast({ level: 'success', icon: '⬆️', title: `Ulepszono: ${up.name}` });
    return;
  }
  const c = ctx.state.companies[b.owner];
  if (!c || c.cash < up.cost) {
    ctx.ui.toast({ level: 'warning', title: 'Brak środków', text: `Potrzeba ${formatMoney(up.cost)}` });
    return;
  }
  addMoney(ctx, b.owner, -up.cost, 'construction');
  b.upgrades.push(up.id);
  ctx.bus.emit('building:changed', { buildingId: b.id });
  ctx.bus.emit('sfx', { id: 'build' });
  ctx.ui.toast({ level: 'success', icon: '⬆️', title: `Ulepszono: ${up.name}` });
}

/** Start the "connect to…" flow: pick a target building, then autoConnect. */
export function startConnect(ctx: GameContext, from: Building, mode: TransportMode): void {
  const args: PickArgs = {
    prompt: `Wskaż budynek do połączenia z: ${ctx.data.buildings[from.typeId]?.name ?? ''}`,
    icon: '🔗',
    kinds: ['building'],
    accept: (sel) => {
      if (sel.kind !== 'building') return 'Wskaż budynek';
      if (sel.id === from.id) return 'Wskaż inny budynek';
      const t = ctx.state.buildings[sel.id];
      if (t && t.owner !== from.owner && ctx.data.buildings[t.typeId]?.category !== 'export') return 'To nie Twój budynek';
      return true;
    },
    onPick: (sel) => {
      if (sel.kind !== 'building') return;
      connect(ctx, from.id, sel.id, mode);
    },
  };
  ctx.input.setTool('pick', args);
}

export function connect(ctx: GameContext, fromId: number, toId: number, mode: TransportMode): void {
  const st = ctx.state;
  let res;
  try {
    res = ctx.services.logistics.autoConnect(st.playerCompanyId, fromId, toId, mode);
  } catch (err) {
    res = { ok: false as const, reason: String(err) };
  }
  const a = st.buildings[fromId];
  const b = st.buildings[toId];
  const name = (x?: Building): string => (x ? (x.name ?? ctx.data.buildings[x.typeId]?.name ?? '') : '?');
  if (res.ok) {
    ctx.ui.toast({
      level: 'success',
      icon: '🔗',
      title: `Połączono: ${name(a)} → ${name(b)}`,
      text: `Koszt: ${formatMoney(res.cost)}`,
      onClick: () => ctx.ui.openPanel('route', { routeId: res.routeId }),
    });
    ctx.bus.emit('sfx', { id: 'success' });
  } else {
    ctx.ui.toast({ level: 'warning', icon: '🔗', title: 'Nie udało się połączyć', text: res.reason });
    ctx.bus.emit('sfx', { id: 'error' });
  }
}

export function renderBuildingInspector(p: PanelInstance, ctx: GameContext, id: number): void {
  const st = ctx.state;
  const b0 = st.buildings[id];
  if (!b0) {
    p.body.append(h('div', { class: 'ig-muted' }, 'Budynek nie istnieje.'));
    return;
  }
  const def = ctx.data.buildings[b0.typeId];
  const isMine = b0.owner === st.playerCompanyId;
  const get = (): Building | undefined => ctx.state.buildings[id];

  // ---------------------------------------------------------------- header
  const statusEl = h('span');
  const head = h(
    'div',
    { class: 'ig-insp-head' },
    h('div', { class: 'ig-insp-icon' }, def?.icon ?? '🏢'),
    h(
      'div',
      { class: 'ig-grow' },
      h('div', { class: 'ig-muted ig-small' }, `${def ? CATEGORY_LABEL[def.category] : ''} · ${companyLabel(st, b0.owner)}`),
      statusEl,
    ),
    button('', () => focusTarget(ctx, { kind: 'building', id }, false), { icon: '📍', small: true, variant: 'ghost', title: 'Pokaż na mapie' }),
  );
  p.body.append(head);

  const construction = progressBar(0, { color: 'linear-gradient(90deg,#6fa3d8,#9cc6ef)' });
  const constructionWrap = section('Budowa', construction.el);
  p.body.append(constructionWrap);

  // ---------------------------------------------------------------- production
  const recipes = def?.recipes.map((r) => ctx.data.recipes[r]).filter((r) => !!r) ?? [];
  const cycle = progressBar(0);
  const effMeter = h('div');
  const recipeInfo = h('div', { class: 'ig-small ig-recipe-info' });
  if (recipes.length) {
    const recipeSel =
      recipes.length > 1 && isMine
        ? select(
            recipes.map((r) => {
              let unlocked = true;
              try {
                unlocked = ctx.services.economy.isUnlocked(st.playerCompanyId, 'recipe', r.id);
              } catch {
                unlocked = true;
              }
              return {
                value: r.id,
                label: `${r.alternative ? '◇ ' : ''}${r.name}${r.qualityModifier ? ` (jakość ${r.qualityModifier > 0 ? '+' : ''}${Math.round(r.qualityModifier * 100)}%)` : ''}${unlocked ? '' : ' 🔒'}`,
                disabled: !unlocked,
              };
            }),
            b0.recipeId ?? recipes[0]!.id,
            (v) => {
              const ok = ctx.services.economy.setRecipe(id, v);
              if (!ok) ctx.ui.toast({ level: 'warning', title: 'Nie można zmienić receptury' });
              else ctx.bus.emit('sfx', { id: 'click' });
              renderRecipe();
            },
            'ig-grow',
          )
        : null;
    const renderRecipe = (): void => {
      const b = get();
      const r = b?.recipeId ? ctx.data.recipes[b.recipeId] : recipes[0];
      recipeInfo.replaceChildren();
      if (!r) return;
      recipeInfo.append(
        h('div', { class: 'ig-recipe-flow' }, r.inputs.length ? h('span', null, ioText(ctx, r.inputs)) : h('span', { class: 'ig-muted' }, 'bez surowców'), h('span', { class: 'ig-recipe-arrow' }, '→'), h('span', null, ioText(ctx, r.outputs))),
        h(
          'div',
          { class: 'ig-muted' },
          `Cykl: ${r.days} dni`,
          r.byproducts?.length ? ` · uboczne: ${ioText(ctx, r.byproducts)}` : '',
          r.energy ? ` · energia ${r.energy} MWh` : '',
        ),
        r.alternative ? badge('receptura alternatywna', 'info', r.description ?? '') : '',
        r.qualityModifier ? badge(`jakość ${r.qualityModifier > 0 ? '+' : ''}${Math.round(r.qualityModifier * 100)}%`, r.qualityModifier > 0 ? 'pos' : 'warn') : '',
      );
    };
    renderRecipe();
    p.body.append(
      section(
        'Produkcja',
        recipeSel ? h('div', { class: 'ig-row' }, h('span', { class: 'ig-muted ig-small' }, 'Receptura'), recipeSel) : null,
        recipeInfo,
        h('div', { class: 'ig-row', style: { marginTop: '6px' } }, h('span', { class: 'ig-muted ig-small', style: { width: '70px' } }, 'Cykl'), h('div', { class: 'ig-grow' }, cycle.el)),
        effMeter,
      ),
    );
  }

  // ---------------------------------------------------------------- stock
  const stock = dyn((el) => {
    const b = get();
    if (!b) return;
    const r = b.recipeId ? ctx.data.recipes[b.recipeId] : undefined;
    const cap = (def?.capacity ?? 0) * Math.max(1, b.level);
    const expectedIn = r?.inputs.map((i) => i.product) ?? (def?.category === 'shop' ? (def.sells ?? []) : []);
    const expectedOut = r?.outputs.map((o) => o.product) ?? [];
    if (expectedIn.length || Object.keys(b.input).length) el.append(h('div', { class: 'ig-sub' }, def?.category === 'shop' ? 'Towary na sprzedaż' : 'Wejście'), stockList(ctx, b.input, cap, 'brak', expectedIn));
    if (expectedOut.length || Object.keys(b.output).length) el.append(h('div', { class: 'ig-sub' }, 'Wyjście'), stockList(ctx, b.output, cap, 'brak', expectedOut));
    if (Object.keys(b.storage).length || b.hub) el.append(h('div', { class: 'ig-sub' }, 'Magazyn'), stockList(ctx, b.storage, cap, 'pusty'));
  });
  p.body.append(section('Magazyny', stock.el));

  // ---------------------------------------------------------------- shop
  if (b0.shop && isMine) {
    const demand = dyn((el) => {
      const b = get();
      if (!b) return;
      const city = b.cityId ? ctx.state.cities[b.cityId] : undefined;
      if (!city) {
        el.append(h('div', { class: 'ig-warn ig-small' }, '⚠ Sklep poza zasięgiem miasta — brak klientów.'));
        return;
      }
      el.append(h('div', { class: 'ig-small ig-muted' }, `Obsługuje: 🏙️ ${city.name}`));
      for (const pid of def?.sells ?? []) {
        const dm = city.demand[pid];
        if (!dm) continue;
        el.append(
          h(
            'div',
            { class: 'ig-demand-row' },
            h('span', null, productLabel(ctx, pid)),
            meter(dm.satisfaction, { color: goodColor(dm.satisfaction), width: 70, label: `Zaspokojenie popytu: ${formatPercent(dm.satisfaction)}` }),
            h('span', { class: 'ig-small ig-muted' }, `${formatNumber(dm.monthly)}/mies. · ${formatMoney(dm.price)}`),
          ),
        );
      }
    });
    const priceVal = h('span', { class: 'ig-slider-value' }, `${Math.round(b0.shop.priceFactor * 100)}%`);
    const price = h('input', {
      type: 'range',
      min: 0.5,
      max: 2,
      step: 0.05,
      value: String(b0.shop.priceFactor),
      oninput: () => {
        const b = get();
        if (!b?.shop) return;
        b.shop.priceFactor = Number(price.value);
        setText(priceVal, `${Math.round(b.shop.priceFactor * 100)}%`);
        ctx.bus.emit('building:changed', { buildingId: id });
      },
    });
    tooltip(price, 'Cena względem rynkowej: niższa = więcej klientów, wyższa = większa marża');
    p.body.append(section('Sklep', h('div', { class: 'ig-field' }, h('span', null, 'Poziom cen'), h('div', { class: 'ig-slider' }, price, priceVal)), demand.el));
    p.onUpdate = chain(p.onUpdate, demand.update);
  }

  // ---------------------------------------------------------------- workers & state
  const workers = dyn((el) => {
    const b = get();
    if (!b) return;
    const w = b.workers;
    const src = w.sourceCityId ? ctx.state.cities[w.sourceCityId] : undefined;
    const ratio = w.required > 0 ? w.employed / w.required : 1;
    el.append(
      kv('Pracownicy', h('span', null, `${formatNumber(w.employed)} / ${formatNumber(w.required)} `, meter(ratio, { color: goodColor(ratio), width: 60 })), ratio < 0.7 ? 'ig-neg' : ''),
      kv('Płaca', `${formatMoney(w.wage)}/mies.`),
      kv('Umiejętności', formatPercent(w.skill)),
      kv('Dojeżdżają z', src ? `🏙️ ${src.name}` : '—', src ? '' : 'ig-warn'),
      w.automation > 0 ? kv('Automatyzacja', formatPercent(w.automation)) : '',
      kv('Stan techniczny', h('span', null, meter(b.condition, { color: goodColor(b.condition), width: 80 }), ` ${formatPercent(b.condition)}`)),
      def?.pollution ? kv('Emisje', `${formatNumber(def.pollution, 1)} / mies.`, def.pollution >= 3 ? 'ig-warn' : '') : '',
      kv('Poziom', String(b.level)),
    );
  });
  p.body.append(section('Załoga i stan', workers.el));

  // ---------------------------------------------------------------- finance
  const chartCanvas = h('canvas', { class: 'ig-chart' });
  const finance = dyn((el) => {
    const b = get();
    if (!b) return;
    const s = b.stats;
    const last = s.profitHistory[s.profitHistory.length - 1];
    el.append(
      kv('Przychód (ten mies.)', formatMoney(s.revenueMonth), 'ig-pos'),
      kv('Koszty (ten mies.)', formatMoney(s.costMonth), 'ig-neg'),
      kv('Zysk (poprz. mies.)', last === undefined ? '—' : formatSignedMoney(last), last !== undefined && last < 0 ? 'ig-neg' : 'ig-pos'),
      kv('Łącznie wyprodukowano', formatNumber(s.totalProduced)),
    );
  });
  let chartAt = 0;
  const drawChart = (): void => {
    const b = get();
    if (!b || performance.now() - chartAt < 2000) return;
    chartAt = performance.now();
    const hist = b.stats.profitHistory;
    if (hist.length < 2) {
      chartCanvas.style.display = 'none';
      return;
    }
    chartCanvas.style.display = '';
    lineChart(chartCanvas, [{ name: 'Zysk / mies.', values: hist, color: 'var(--accent)' }], { width: 320, height: 110 });
  };
  p.body.append(section('Finanse', finance.el, chartCanvas));

  // ---------------------------------------------------------------- routes & connect
  const routes = dyn((el) => {
    const b = get();
    if (!b) return;
    const list = Object.values(ctx.state.routes).filter((r) => r.stops.some((s) => s.buildingId === id));
    if (!list.length) el.append(h('div', { class: 'ig-warn ig-small' }, '⚠ Brak tras — towary nie są transportowane.'));
    for (const r of list) {
      el.append(
        h(
          'div',
          { class: 'ig-route-row' },
          h('span', { class: 'ig-route-dot', style: { background: r.color } }),
          linkButton(`${MODE_ICON[r.mode]} ${r.name}`, () => ctx.ui.openPanel('route', { routeId: r.id })),
          h('span', { class: 'ig-muted ig-small' }, `${r.vehicleIds.length} poj. · ${r.stops.length} przyst.`),
        ),
      );
    }
    if (isMine) {
      const cands = connectionCandidates(ctx, b);
      const connected = new Set(list.flatMap((r) => r.stops.map((s) => s.buildingId)));
      const fresh = cands.filter((c) => !connected.has(c.building.id)).slice(0, 4);
      if (fresh.length) {
        el.append(h('div', { class: 'ig-sub' }, 'Sugerowane połączenia'));
        for (const c of fresh) {
          const cd = ctx.data.buildings[c.building.typeId];
          el.append(
            h(
              'div',
              { class: 'ig-route-row' },
              h('span', null, c.dir === 'out' ? '→' : '←'),
              linkButton(`${cd?.icon ?? ''} ${c.building.name ?? cd?.name ?? ''}`, () => focusTarget(ctx, { kind: 'building', id: c.building.id }, false)),
              h('span', { class: 'ig-muted ig-small' }, `${c.products.map((pp) => productIcon(ctx, pp)).join('')} · ${c.dist} kafli`),
              h('span', { class: 'ig-grow' }),
              button('Połącz', () => (c.dir === 'out' ? connect(ctx, id, c.building.id, connectMode) : connect(ctx, c.building.id, id, connectMode)), { small: true }),
            ),
          );
        }
      }
    }
  }, '', () => {
    const b = get();
    if (!b) return '';
    const rs = Object.values(ctx.state.routes).filter((r) => r.stops.some((s) => s.buildingId === id));
    return `${rs.map((r) => `${r.id}:${r.name}:${r.vehicleIds.length}:${r.stops.length}`).join(',')}|${isMine ? connectionCandidates(ctx, b).map((c) => c.building.id).join(',') : ''}`;
  });
  let connectMode: TransportMode = 'road';
  const modeSeg = segmented<TransportMode>(
    [
      { value: 'road', label: '🚚 Droga', title: 'Połączenie drogowe (ciężarówki)' },
      { value: 'rail', label: '🚂 Kolej', title: 'Połączenie kolejowe' },
      { value: 'water', label: '🚢 Woda', title: 'Połączenie wodne (wymaga portów)' },
    ],
    'road',
    (v) => (connectMode = v),
  );
  p.body.append(
    section(
      'Logistyka',
      routes.el,
      isMine
        ? h(
            'div',
            { class: 'ig-row', style: { marginTop: '6px', flexWrap: 'wrap' } },
            modeSeg.el,
            button('Połącz z…', () => {
              const b = get();
              if (b) startConnect(ctx, b, connectMode);
            }, { icon: '🔗', small: true, variant: 'primary', title: 'Automatycznie zbuduj drogę, trasę i pojazd do wskazanego budynku' }),
          )
        : null,
    ),
  );

  // ---------------------------------------------------------------- upgrades & actions
  if (isMine) {
    const ups = def?.upgrades ?? [];
    const upgrades = dyn((el) => {
      const b = get();
      if (!b) return;
      for (const u of ups) {
        const has = b.upgrades.includes(u.id);
        const effects = effectsText(u.effects);
        el.append(
          h(
            'div',
            { class: 'ig-route-row' },
            h('span', { class: 'ig-grow' }, has ? '✅ ' : '⬆️ ', u.name, h('span', { class: 'ig-muted ig-small' }, ` ${effects}`)),
            has ? badge('zainstalowane', 'pos') : button(formatMoney(u.cost, true), () => doUpgrade(ctx, b, u.id), { small: true, title: `Kup ulepszenie: ${u.name}` }),
          ),
        );
      }
    }, '', () => get()?.upgrades.join(',') ?? '');
    if (ups.length) p.body.append(section('Ulepszenia', upgrades.el));
    p.onUpdate = chain(p.onUpdate, upgrades.update);

    const enableBtn = button('', () => {
      const b = get();
      if (b) setEnabled(ctx, b, !b.enabled);
      updateAll();
    }, { small: true });
    const prio = select(
      [1, 2, 3, 4, 5].map((v) => ({ value: v, label: `Priorytet ${v}${v === 5 ? ' (najwyższy)' : v === 1 ? ' (najniższy)' : ''}` })),
      b0.priority,
      (v) => {
        const b = get();
        if (!b) return;
        b.priority = v;
        ctx.bus.emit('building:changed', { buildingId: id });
      },
    );
    tooltip(prio, 'Priorytet dostaw przy niedoborze towarów');
    p.body.append(
      h(
        'div',
        { class: 'ig-insp-actions' },
        enableBtn,
        prio,
        h('span', { class: 'ig-grow' }),
        button('Wyburz', async () => {
          const b = get();
          if (!b || !ctx.ui.root) return;
          const refund = Math.round((def?.cost ?? 0) * 0.25);
          const ans = await confirmDialog(ctx.ui.root, 'Wyburzyć budynek?', `${def?.name ?? ''} zostanie rozebrany. Odzyskasz ok. ${formatMoney(refund)}.`, [
            { id: 'no', label: 'Anuluj', variant: 'ghost' },
            { id: 'yes', label: 'Wyburz', variant: 'danger' },
          ]);
          if (ans !== 'yes') return;
          const res = ctx.services.economy.demolish(id);
          if (!res.ok) ctx.ui.toast({ level: 'warning', title: 'Nie można wyburzyć', text: res.reason });
          else p.close();
        }, { small: true, variant: 'danger', icon: '💥' }),
      ),
    );
    const upd = (): void => {
      const b = get();
      if (!b) return;
      enableBtn.replaceChildren(b.enabled ? '⏸ Wyłącz' : '▶ Włącz');
    };
    p.onUpdate = chain(p.onUpdate, upd);
  } else if (b0.owner !== 0) {
    let price: number | null = null;
    try {
      price = ctx.services.ai.buildingPrice(st.playerCompanyId, id);
    } catch {
      price = null;
    }
    p.body.append(
      h(
        'div',
        { class: 'ig-insp-actions' },
        h('span', { class: 'ig-muted ig-small ig-grow' }, price !== null ? `Cena przejęcia: ~${formatMoney(price)}` : 'Właściciel nie chce sprzedać.'),
        button('Przejmij', () => ctx.ui.openPanel('takeover', { buildingId: id }), {
          icon: '🤝',
          small: true,
          variant: 'primary',
          title: 'Odkup budynek od konkurenta',
          disabled: price === null,
        }),
      ),
    );
  }

  // ---------------------------------------------------------------- update loop
  const updateAll = (): void => {
    const b = get();
    if (!b) {
      p.close();
      return;
    }
    p.setTitle(`${def?.icon ?? ''} ${b.name ?? def?.name ?? b.typeId}`);
    const s = BUILDING_STATUS[b.status] ?? { label: b.status, tone: 'dim', icon: '•' };
    statusEl.replaceChildren(badge(`${s.icon} ${s.label}`, s.tone === 'pos' ? 'pos' : s.tone === 'neg' ? 'neg' : s.tone === 'warn' ? 'warn' : 'dim'), b.enabled ? '' : badge('wyłączony', 'dim'));
    constructionWrap.style.display = b.constructionProgress < 1 ? '' : 'none';
    construction.set(b.constructionProgress, `Budowa ${formatPercent(b.constructionProgress)}`);
    cycle.set(b.progress, b.status === 'ok' ? formatPercent(b.progress) : (BUILDING_STATUS[b.status]?.label ?? ''));
    effMeter.replaceChildren(
      h('div', { class: 'ig-row ig-small' }, h('span', { class: 'ig-muted', style: { width: '70px' } }, 'Wydajność'), meter(Math.min(1, b.efficiency), { color: goodColor(b.efficiency), width: 140 }), h('span', null, formatPercent(b.efficiency))),
    );
    stock.update();
    workers.update();
    finance.update();
    routes.update();
    drawChart();
  };
  p.onUpdate = chain(updateAll, p.onUpdate);
}

function chain(a: (() => void) | null, b: (() => void) | null): () => void {
  return () => {
    a?.();
    b?.();
  };
}
