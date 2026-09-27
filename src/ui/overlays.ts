/**
 * Map overlays (heatmaps) — UI side: default overlay descriptions, overlay
 * flyout above the toolbar, legend card, hotkeys. Drawing on the map is done
 * by the render module (its overlay layer checks ctx.renderer.overlay).
 * Other modules may add/replace overlays with ctx.ui.registerOverlay(def).
 */
import type { GameContext } from '../core/context';
import type { GameState } from '../core/types';
import { h, setChildren } from './dom';
import { tooltip } from './tooltip';
import type { OverlayDef } from './types';
import type { UiManager } from './ui';

type RGBA = [number, number, number, number];

const rgbCache = new Map<string, [number, number, number]>();
export function hexToRgb(hex: string): [number, number, number] {
  let c = rgbCache.get(hex);
  if (c) return c;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) c = [128, 128, 128];
  else {
    let s = m[1]!;
    if (s.length === 3) s = s.replace(/./g, (x) => x + x);
    const n = parseInt(s, 16);
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  rgbCache.set(hex, c);
  return c;
}

/** 0..1 → green→yellow→red (or reversed). */
export function heat(t: number, alpha = 200, reverse = false): RGBA {
  let v = Math.max(0, Math.min(1, t));
  if (reverse) v = 1 - v;
  const r = v < 0.5 ? Math.round(80 + v * 2 * 175) : 255;
  const g = v < 0.5 ? 200 : Math.round(200 - (v - 0.5) * 2 * 170);
  return [r, g, 60, alpha];
}

// Per-state caches (cheap, rebuilt at most once per second by the minimap).
let profitCache: { st: GameState | null; at: number; map: Map<number, number> } = { st: null, at: 0, map: new Map() };
function buildingProfit(st: GameState, id: number): number | undefined {
  const now = performance.now();
  if (profitCache.st !== st || now - profitCache.at > 900) {
    const map = new Map<number, number>();
    for (const b of Object.values(st.buildings)) {
      if (b.owner !== st.playerCompanyId) continue;
      const last = b.stats.profitHistory[b.stats.profitHistory.length - 1];
      map.set(b.id, last ?? b.stats.revenueMonth - b.stats.costMonth);
    }
    profitCache = { st, at: now, map };
  }
  return profitCache.map.get(id);
}

export const DEFAULT_OVERLAYS: OverlayDef[] = [
  {
    id: 'demand',
    name: 'Popyt',
    icon: '🛒',
    order: 10,
    description: 'Niezaspokojony popyt w miastach — czerwone miasta czekają na towary.',
    gradient: { stops: ['#50c878', '#e8d24a', '#ff5a3c'], min: 'zaspokojony', max: 'duży niedobór' },
    minimapColor(st, i) {
      const cid = st.map.city[i];
      if (!cid) return null;
      const c = st.cities[cid];
      if (!c) return null;
      return heat(1 - c.satisfaction, 210);
    },
  },
  {
    id: 'pollution',
    name: 'Zanieczyszczenie',
    icon: '🏭',
    order: 20,
    description: 'Skażenie powietrza i gleby. Obniża zadowolenie i wzrost miast.',
    gradient: { stops: ['rgba(255,220,80,0.4)', '#ff8c3c', '#b4281e'], min: 'niskie', max: 'wysokie' },
    minimapColor(st, i) {
      const v = st.map.pollution[i]!;
      if (v < 1) return null;
      const t = Math.min(1, v / 120);
      return [Math.round(255 - t * 75), Math.round(210 - t * 170), 40, Math.round(90 + t * 150)];
    },
  },
  {
    id: 'profit',
    name: 'Rentowność',
    icon: '💹',
    order: 30,
    description: 'Zysk Twoich budynków w ostatnim miesiącu.',
    legend: [
      { color: '#50c878', label: 'zysk' },
      { color: '#e8d24a', label: 'około zera' },
      { color: '#ff5a3c', label: 'strata' },
    ],
    minimapColor(st, i) {
      const bid = st.map.building[i];
      if (!bid) return null;
      const p = buildingProfit(st, bid);
      if (p === undefined) return null;
      return p > 50 ? [80, 200, 120, 255] : p < -50 ? [255, 90, 60, 255] : [232, 210, 74, 255];
    },
  },
  {
    id: 'traffic',
    name: 'Przepustowość',
    icon: '🚦',
    order: 40,
    description: 'Natężenie ruchu na drogach i torach — czerwone odcinki to wąskie gardła.',
    gradient: { stops: ['#50c878', '#e8d24a', '#ff5a3c'], min: 'luźno', max: 'korek' },
    minimapColor(st, i) {
      if (!st.network.road[i] && !st.network.rail[i]) return null;
      const v = st.network.traffic[i]!;
      return heat(Math.min(1, v / 60), 255);
    },
  },
  {
    id: 'deposits',
    name: 'Złoża',
    icon: '⛏️',
    order: 50,
    description: 'Złoża surowców (kolor = typ, jasność = jakość).',
    minimapColor(st, i, ctx) {
      const d = st.map.deposit[i]!;
      if (!d || st.map.depositAmount[i]! <= 0) return null;
      const def = ctx.data.deposits[st.map.depositTypes[d] ?? ''];
      const [r, g, b] = hexToRgb(def?.color ?? '#b07030');
      const q = st.map.depositQuality[i]! / 255;
      return [r, g, b, Math.round(140 + q * 115)];
    },
  },
  {
    id: 'fertility',
    name: 'Żyzność',
    icon: '🌱',
    order: 60,
    description: 'Żyzność gleby — farmy na zielonych terenach dają więcej i lepsze plony.',
    gradient: { stops: ['#8a6a3a', '#c8b44a', '#3ec85a'], min: 'jałowa', max: 'żyzna' },
    minimapColor(st, i, ctx) {
      if (ctx.data.terrain[st.map.terrain[i]!]?.isWater) return null;
      const t = st.map.fertility[i]! / 255;
      return [Math.round(138 - t * 76), Math.round(106 + t * 94), Math.round(58 + t * 32), 190];
    },
  },
];

/** Deposit legend is generated from data (depends on the registry). */
function depositLegend(ctx: GameContext): OverlayDef['legend'] {
  return ctx.data.depositList().map((d) => ({ color: d.color, label: `${d.icon} ${d.name.replace(/^Złoże\s+/i, '')}` }));
}

export function installOverlays(ctx: GameContext, ui: UiManager): void {
  for (const o of DEFAULT_OVERLAYS) if (!ui.overlays.some((x) => x.id === o.id)) ui.registerOverlay(o);

  // ---------------------------------------------------------------- flyout
  const fly = h('div', { class: 'ig-flyout ig-overlay-fly' });
  fly.style.display = 'none';
  ui.root.append(fly);
  const renderFly = (): void => {
    const cur = ctx.renderer.overlay;
    setChildren(
      fly,
      h('div', { class: 'ig-flyout-title' }, '🗺️ Nakładki mapy'),
      h(
        'div',
        { class: 'ig-overlay-list' },
        h('button', { class: `ig-overlay-btn${cur === null ? ' active' : ''}`, onclick: () => setOverlay(null) }, h('span', { class: 'ig-overlay-icon' }, '✖'), h('span', null, 'Brak')),
        ui.overlays.map((o) => {
          const b = h(
            'button',
            { class: `ig-overlay-btn${cur === o.id ? ' active' : ''}`, onclick: () => setOverlay(cur === o.id ? null : o.id) },
            h('span', { class: 'ig-overlay-icon' }, o.icon),
            h('span', null, o.name),
          );
          tooltip(b, `${o.name}${o.hotkey ? ` [${o.hotkey}]` : ''}\n${o.description ?? ''}`);
          return b;
        }),
      ),
    );
  };
  const setOverlay = (id: string | null): void => {
    ctx.renderer.setOverlay(id);
    ctx.bus.emit('sfx', { id: 'click' });
    renderFly();
    renderLegend();
  };
  const toggleFly = (show?: boolean): void => {
    const vis = show ?? fly.style.display === 'none';
    fly.style.display = vis ? '' : 'none';
    if (vis) {
      closeOtherFlyouts(ui, fly);
      renderFly();
    }
  };
  (fly as HTMLElement & { closeFly?: () => void }).closeFly = () => toggleFly(false);

  // ---------------------------------------------------------------- legend
  const legend = h('div', { class: 'ig-legend' });
  legend.style.display = 'none';
  ui.root.append(legend);
  const renderLegend = (): void => {
    const id = ctx.hasGame ? ctx.renderer.overlay : null;
    const def = ui.overlayDef(id);
    if (!id) {
      legend.style.display = 'none';
      return;
    }
    legend.style.display = '';
    const entries = def?.id === 'deposits' && !def.legend ? depositLegend(ctx) : def?.legend;
    setChildren(
      legend,
      h(
        'div',
        { class: 'ig-legend-head' },
        h('span', { class: 'ig-legend-title' }, `${def?.icon ?? '🗺️'} ${def?.name ?? id}`),
        h('button', { class: 'ig-legend-x', title: 'Wyłącz nakładkę [Shift+O]', onclick: () => setOverlay(null) }, '✕'),
      ),
      def?.description ? h('div', { class: 'ig-legend-desc' }, def.description) : null,
      def?.gradient
        ? h(
            'div',
            { class: 'ig-legend-gradient' },
            h('div', { class: 'ig-legend-bar', style: { background: `linear-gradient(90deg, ${def.gradient.stops.join(', ')})` } }),
            h('div', { class: 'ig-legend-scale' }, h('span', null, def.gradient.min), h('span', null, def.gradient.max)),
          )
        : null,
      entries?.length
        ? h(
            'div',
            { class: 'ig-legend-items' },
            entries.map((e) => h('div', { class: 'ig-legend-item' }, h('span', { class: 'ig-legend-swatch', style: { background: e.color } }), e.label)),
          )
        : null,
    );
  };

  ctx.bus.on('overlay:changed', () => {
    renderLegend();
    if (fly.style.display !== 'none') renderFly();
  });
  ctx.bus.on('game:started', renderLegend);
  ctx.bus.on('game:ended', () => {
    legend.style.display = 'none';
    fly.style.display = 'none';
  });
  ui.registryListeners.add(() => {
    if (fly.style.display !== 'none') renderFly();
    renderLegend();
  });

  ui.registerToolbarButton({
    id: 'overlays',
    icon: '🗺️',
    label: 'Nakładki',
    group: 'view',
    order: 20,
    tooltip: 'Nakładki mapy: popyt, zanieczyszczenie, rentowność, ruch, złoża',
    hotkey: 'O',
    onClick: () => toggleFly(),
    isActive: (c) => fly.style.display !== 'none' || !!c.renderer.overlay,
  });

  const cycle = (dir: number): void => {
    const list = ui.overlays.map((o) => o.id);
    if (!list.length) return;
    const cur = ctx.renderer.overlay;
    const i = cur ? list.indexOf(cur) : -1;
    const next = i + dir;
    setOverlay(next < 0 || next >= list.length ? null : list[next]!);
  };
  ctx.input.registerHotkey({ key: 'o', description: 'Następna nakładka mapy', handler: () => cycle(1) });
  ctx.input.registerHotkey({ key: 'shift+o', description: 'Wyłącz nakładkę', handler: () => setOverlay(null) });
}

/** Only one flyout (build palette / overlays) open at a time. */
export function closeOtherFlyouts(ui: UiManager, except: HTMLElement): void {
  for (const el of ui.root.querySelectorAll<HTMLElement & { closeFly?: () => void }>('.ig-flyout')) {
    if (el !== except && el.style.display !== 'none') el.closeFly?.();
  }
}
