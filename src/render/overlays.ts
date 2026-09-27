/**
 * Map overlays (heatmaps / data views), render side.
 *
 *   ctx.renderer.setOverlay('pollution')          // or null to hide
 *   ctx.renderer.listOverlays(): OverlayInfo[]     // id, name, icon, description, legend
 *   ctx.renderer.overlayInfo(id?): OverlayInfo     // legend with CURRENT min/max
 *
 * Ids: 'demand' (optionally 'demand:<productId>'), 'pollution', 'profit',
 * 'traffic', 'deposits', 'fertility', 'landValue', 'ownership'.
 * Heat overlays are rasterised to a W×H image (1 px / tile) and drawn smoothed;
 * data overlays (profit, traffic, deposits, ownership) draw per visible tile/building.
 */
import { TILE_SIZE } from '../core/constants';
import type { GameContext } from '../core/context';
import { formatMoney, formatNumber } from '../core/format';
import { Terrain, type GameState } from '../core/types';
import { trafficLevel } from '../logistics/api';
import { PUBLIC_COLOR } from './palette';
import type { LayerDef, OverlayInfo, OverlayLegend, RenderContext } from './types';
import { alpha, buildRamp, rgbaStr } from './util/color';
import { drawEmoji } from './util/sprites';

const T = TILE_SIZE;

const HEAT_STOPS = [
  { t: 0, color: '#50c878' },
  { t: 0.5, color: '#e8d24a' },
  { t: 1, color: '#ff5a3c' },
];

interface OverlayImpl {
  id: string;
  name: string;
  icon: string;
  description: string;
  unit: string;
  minLabel: string;
  maxLabel: string;
  stops: { t: number; color: string; a?: number }[];
  /** Heat overlays: fill `out` (per tile, NaN = transparent) and return the max for normalisation. */
  compute?(state: GameState, out: Float32Array, param: string | null): { min: number; max: number };
  /** Data overlays draw themselves. */
  draw?(rc: RenderContext, param: string | null): void;
  legend?(state: GameState | null): Partial<OverlayLegend>;
  refreshMs: number;
  /** Dim the map underneath. */
  dim: number;
}

const cityPop = (c: { population: { poor: number; middle: number; rich: number } }): number => c.population.poor + c.population.middle + c.population.rich;

export class OverlayManager {
  private impls = new Map<string, OverlayImpl>();
  private heat: Float32Array | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private img: ImageData | null = null;
  private lastId = '';
  private lastAt = -1e9;
  private stateRef: GameState | null = null;
  private range = { min: 0, max: 1 };
  private luts = new Map<string, Uint8ClampedArray>();
  private profitRange = 1000;
  private profitAt = 0;
  private depClusters: { st: GameState | null; list: { x: number; y: number; d: number; n: number; amount: number }[] } = { st: null, list: [] };
  private binColors: string[] = [];

  constructor(private readonly ctx: GameContext) {
    for (let i = 0; i < 12; i++) {
      const lut = buildRamp(HEAT_STOPS);
      const k = Math.round((i / 11) * 255) * 4;
      this.binColors.push(rgbaStr(lut[k]!, lut[k + 1]!, lut[k + 2]!, 0.85));
    }
    this.registerDefaults();
    ctx.bus.on('overlay:changed', () => {
      this.lastAt = -1e9;
    });
    ctx.bus.on('map:changed', () => {
      this.lastAt = -1e9;
      this.depClusters.st = null;
    });
  }

  register(impl: OverlayImpl): void {
    this.impls.set(impl.id, impl);
  }

  private split(id: string | null): [OverlayImpl | undefined, string | null] {
    if (!id) return [undefined, null];
    const c = id.indexOf(':');
    const base = c >= 0 ? id.slice(0, c) : id;
    return [this.impls.get(base), c >= 0 ? id.slice(c + 1) : null];
  }

  list(): OverlayInfo[] {
    const st = this.ctx.tryState();
    return [...this.impls.values()].map((o) => this.infoOf(o, st, false));
  }

  info(id: string | null): OverlayInfo | null {
    const [o] = this.split(id);
    if (!o) return null;
    const cur = id === this.lastId;
    const info = this.infoOf(o, this.ctx.tryState(), cur);
    info.id = id!;
    return info;
  }

  private infoOf(o: OverlayImpl, st: GameState | null, current: boolean): OverlayInfo {
    const legend: OverlayLegend = {
      kind: 'gradient',
      min: current ? this.range.min : 0,
      max: current ? this.range.max : 1,
      unit: o.unit,
      stops: o.stops.map((s) => ({ t: s.t, color: s.color })),
      minLabel: o.minLabel,
      maxLabel: o.maxLabel,
      ...(o.legend ? o.legend(st) : {}),
    };
    return { id: o.id, name: o.name, icon: o.icon, description: o.description, legend };
  }

  private lut(o: OverlayImpl): Uint8ClampedArray {
    let l = this.luts.get(o.id);
    if (!l) {
      l = buildRamp(o.stops);
      this.luts.set(o.id, l);
    }
    return l;
  }

  /** Overlay layer draw. */
  draw(rc: RenderContext): void {
    const id = rc.ctx.renderer.overlay;
    const [o, param] = this.split(id);
    if (!o || !id) return;
    const { g, state, view } = rc;
    if (o.dim > 0) {
      g.fillStyle = `rgba(12,16,26,${o.dim})`;
      g.fillRect(view.x0 * T, view.y0 * T, (view.x1 - view.x0) * T, (view.y1 - view.y0) * T);
    }
    if (o.compute) {
      const W = state.map.width;
      const H = state.map.height;
      if (state !== this.stateRef || !this.heat || this.heat.length !== W * H) {
        this.stateRef = state;
        this.heat = new Float32Array(W * H);
        this.canvas = document.createElement('canvas');
        this.canvas.width = W;
        this.canvas.height = H;
        this.img = new ImageData(W, H);
        this.lastAt = -1e9;
      }
      if (id !== this.lastId || rc.timeMs - this.lastAt > o.refreshMs) {
        this.lastId = id;
        this.lastAt = rc.timeMs;
        this.heat.fill(NaN);
        this.range = o.compute(state, this.heat, param);
        const lut = this.lut(o);
        const d = this.img!.data;
        const span = this.range.max - this.range.min || 1;
        for (let i = 0; i < W * H; i++) {
          const v = this.heat[i]!;
          const p = i * 4;
          if (v !== v) {
            d[p + 3] = 0;
            continue;
          }
          const k = Math.max(0, Math.min(255, Math.round(((v - this.range.min) / span) * 255))) * 4;
          d[p] = lut[k]!;
          d[p + 1] = lut[k + 1]!;
          d[p + 2] = lut[k + 2]!;
          d[p + 3] = lut[k + 3]!;
        }
        this.canvas!.getContext('2d')!.putImageData(this.img!, 0, 0);
      }
      g.imageSmoothingEnabled = true;
      g.globalAlpha = 0.82;
      g.drawImage(this.canvas!, 0, 0, W * T, H * T);
      g.globalAlpha = 1;
    } else {
      this.lastId = id;
      o.draw?.(rc, param);
    }
  }

  // ------------------------------------------------------------------ defaults
  private registerDefaults(): void {
    const ctx = this.ctx;
    this.register({
      id: 'demand',
      name: 'Popyt',
      icon: '🛒',
      description: 'Niezaspokojony popyt w miastach (jednostki / miesiąc). Użyj „demand:<produkt>” dla jednego towaru.',
      unit: 'jedn./mies.',
      minLabel: 'zaspokojony',
      maxLabel: 'duży niedobór',
      stops: [
        { t: 0, color: '#50c878', a: 0 },
        { t: 0.08, color: '#50c878', a: 0.35 },
        { t: 0.5, color: '#e8d24a', a: 0.7 },
        { t: 1, color: '#ff5a3c', a: 0.85 },
      ],
      refreshMs: 1000,
      dim: 0.2,
      compute(state, out, param) {
        const { width: W, height: H } = state.map;
        let max = 1;
        out.fill(0);
        for (const k in state.cities) {
          const c = state.cities[k]!;
          let unmet = 0;
          for (const p in c.demand) {
            if (param && p !== param) continue;
            const d = c.demand[p]!;
            unmet += d.monthly * (1 - Math.min(1, d.satisfaction));
          }
          if (unmet <= 0) continue;
          const R = Math.max(4, c.radius + 6);
          for (let y = Math.max(0, Math.floor(c.y - R)); y <= Math.min(H - 1, Math.ceil(c.y + R)); y++)
            for (let x = Math.max(0, Math.floor(c.x - R)); x <= Math.min(W - 1, Math.ceil(c.x + R)); x++) {
              const dd = Math.hypot(x - c.x, y - c.y) / R;
              if (dd >= 1) continue;
              const i = y * W + x;
              const v = out[i]! + unmet * (1 - dd * dd);
              out[i] = v;
              if (v > max) max = v;
            }
        }
        return { min: 0, max };
      },
    });
    this.register({
      id: 'pollution',
      name: 'Zanieczyszczenie',
      icon: '🏭',
      description: 'Skażenie powietrza i gleby. Obniża zadowolenie i wzrost miast.',
      unit: 'pkt',
      minLabel: 'niskie',
      maxLabel: 'wysokie',
      stops: [
        { t: 0, color: '#ffdc50', a: 0 },
        { t: 0.1, color: '#ffdc50', a: 0.35 },
        { t: 0.5, color: '#ff8c3c', a: 0.7 },
        { t: 1, color: '#8c1e28', a: 0.9 },
      ],
      refreshMs: 1000,
      dim: 0.15,
      compute(state, out) {
        const p = state.map.pollution;
        let max = 40;
        for (let i = 0; i < p.length; i++) {
          const v = p[i]!;
          out[i] = v;
          if (v > max) max = v;
        }
        return { min: 0, max };
      },
    });
    this.register({
      id: 'fertility',
      name: 'Żyzność',
      icon: '🌱',
      description: 'Żyzność gleby — wpływa na plony i jakość produktów rolnych.',
      unit: '%',
      minLabel: 'jałowa',
      maxLabel: 'żyzna',
      stops: [
        { t: 0, color: '#8a5a3c', a: 0.55 },
        { t: 0.45, color: '#d8c85a', a: 0.6 },
        { t: 1, color: '#2fa84a', a: 0.75 },
      ],
      refreshMs: 5000,
      dim: 0.1,
      compute(state, out) {
        const { fertility, terrain } = state.map;
        for (let i = 0; i < fertility.length; i++) out[i] = terrain[i]! <= Terrain.Water ? NaN : fertility[i]! / 2.55;
        return { min: 0, max: 100 };
      },
    });
    this.register({
      id: 'landValue',
      name: 'Wartość gruntu',
      icon: '🏷️',
      description: 'Szacunkowa atrakcyjność działek: bliskość miast, dróg i wybrzeża, koszt terenu.',
      unit: 'indeks',
      minLabel: 'tania',
      maxLabel: 'droga',
      stops: [
        { t: 0, color: '#3c5a8c', a: 0.35 },
        { t: 0.5, color: '#b07bd0', a: 0.55 },
        { t: 1, color: '#ffd24a', a: 0.8 },
      ],
      refreshMs: 3000,
      dim: 0.15,
      compute(state, out) {
        const { width: W, height: H, terrain, flags } = state.map;
        const tdefs = ctx.data.terrain;
        for (let i = 0; i < W * H; i++) {
          const t = terrain[i]!;
          if (t <= Terrain.Water) continue;
          const bc = tdefs[t]?.buildCost ?? 1;
          out[i] = 10 / bc + (flags[i]! & 2 ? 4 : 0) + (state.network.road[i] ? 3 : 0);
        }
        for (const k in state.cities) {
          const c = state.cities[k]!;
          const pop = cityPop(c);
          const R = 8 + Math.sqrt(pop) / 6;
          const w = Math.sqrt(pop) / 4;
          for (let y = Math.max(0, Math.floor(c.y - R)); y <= Math.min(H - 1, Math.ceil(c.y + R)); y++)
            for (let x = Math.max(0, Math.floor(c.x - R)); x <= Math.min(W - 1, Math.ceil(c.x + R)); x++) {
              const i = y * W + x;
              if (out[i] !== out[i]) continue;
              const dd = Math.hypot(x - c.x, y - c.y) / R;
              if (dd < 1) out[i] = out[i]! + w * (1 - dd) * (1 - dd);
            }
        }
        let max = 1;
        let min = Infinity;
        for (let i = 0; i < W * H; i++) {
          const v = out[i]!;
          if (v !== v) continue;
          if (v > max) max = v;
          if (v < min) min = v;
        }
        return { min: Number.isFinite(min) ? min : 0, max };
      },
    });
    this.register({
      id: 'traffic',
      name: 'Przepustowość',
      icon: '🚦',
      description: 'Natężenie ruchu na drogach i torach — czerwone odcinki to wąskie gardła.',
      unit: '%',
      minLabel: 'luźno',
      maxLabel: 'korek',
      stops: HEAT_STOPS,
      refreshMs: 0,
      dim: 0.4,
      draw: (rc) => {
        const { g, state, view } = rc;
        const { road, rail } = state.network;
        const W = state.map.width;
        for (let y = view.y0; y < view.y1; y++)
          for (let x = view.x0; x < view.x1; x++) {
            const i = y * W + x;
            if (!road[i] && !rail[i]) continue;
            const lv = trafficLevel(state, i);
            g.fillStyle = this.binColors[Math.min(11, Math.round(lv * 11))]!;
            g.fillRect(x * T + 3, y * T + 3, T - 6, T - 6);
          }
        this.range = { min: 0, max: 100 };
      },
    });
    this.register({
      id: 'profit',
      name: 'Rentowność',
      icon: '💹',
      description: 'Zysk Twoich budynków w ostatnim miesiącu (zł).',
      unit: 'zł/mies.',
      minLabel: 'strata',
      maxLabel: 'zysk',
      stops: [
        { t: 0, color: '#ff5a3c' },
        { t: 0.5, color: '#e8d24a' },
        { t: 1, color: '#50c878' },
      ],
      refreshMs: 0,
      dim: 0.45,
      legend: () => ({ min: -this.profitRange, max: this.profitRange }),
      draw: (rc) => {
        const { g, state, view } = rc;
        const pid = state.playerCompanyId;
        if (rc.timeMs - this.profitAt > 1000) {
          this.profitAt = rc.timeMs;
          let m = 200;
          for (const k in state.buildings) {
            const b = state.buildings[k]!;
            if (b.owner !== pid) continue;
            m = Math.max(m, Math.abs(profitOf(b)));
          }
          this.profitRange = m;
        }
        this.range = { min: -this.profitRange, max: this.profitRange };
        const z = rc.zoom;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        for (const k in state.buildings) {
          const b = state.buildings[k]!;
          if (b.x + b.w < view.x0 || b.y + b.h < view.y0 || b.x > view.x1 || b.y > view.y1) continue;
          if (b.owner !== pid) {
            g.fillStyle = 'rgba(120,125,135,0.35)';
            g.fillRect(b.x * T + 2, b.y * T + 2, b.w * T - 4, b.h * T - 4);
            continue;
          }
          const p = profitOf(b);
          const tt = 0.5 + Math.max(-0.5, Math.min(0.5, p / (2 * this.profitRange)));
          const col = tt < 0.45 ? '#ff5a3c' : tt > 0.55 ? '#50c878' : '#e8d24a';
          g.fillStyle = alpha(col, 0.7);
          g.fillRect(b.x * T + 2, b.y * T + 2, b.w * T - 4, b.h * T - 4);
          g.strokeStyle = col;
          g.lineWidth = Math.max(1.5, 2 / z);
          g.strokeRect(b.x * T + 2, b.y * T + 2, b.w * T - 4, b.h * T - 4);
          if (rc.ppt >= 16) {
            const fs = Math.max(8, 11 / z);
            g.font = `700 ${fs}px system-ui, sans-serif`;
            g.lineWidth = fs * 0.25;
            g.strokeStyle = 'rgba(0,0,0,0.7)';
            const txt = (p > 0 ? '+' : '') + formatMoney(p, true);
            const cx = (b.x + b.w / 2) * T;
            const cy = (b.y + b.h / 2) * T;
            g.strokeText(txt, cx, cy);
            g.fillStyle = '#fff';
            g.fillText(txt, cx, cy);
          }
        }
      },
    });
    this.register({
      id: 'deposits',
      name: 'Złoża',
      icon: '⛏️',
      description: 'Złoża surowców — kolor = rodzaj, intensywność = jakość.',
      unit: 'jedn.',
      minLabel: 'niska jakość',
      maxLabel: 'wysoka jakość',
      stops: [
        { t: 0, color: '#7a7a7a' },
        { t: 1, color: '#ffffff' },
      ],
      refreshMs: 0,
      dim: 0.5,
      legend: (st) => {
        const cats = [];
        if (st)
          for (let d = 1; d < st.map.depositTypes.length; d++) {
            const def = ctx.data.deposits[st.map.depositTypes[d]!];
            if (def) cats.push({ label: def.name, color: def.color, icon: def.icon });
          }
        return { kind: 'categories', categories: cats };
      },
      draw: (rc) => {
        const { g, state, view } = rc;
        const { deposit, depositQuality, depositAmount, depositTypes } = state.map;
        const W = state.map.width;
        const cols: string[] = [];
        for (let d = 1; d < depositTypes.length; d++) cols[d] = ctx.data.deposits[depositTypes[d]!]?.color ?? '#aaa';
        for (let y = view.y0; y < view.y1; y++)
          for (let x = view.x0; x < view.x1; x++) {
            const i = y * W + x;
            const d = deposit[i]!;
            if (!d || depositAmount[i]! <= 0) continue;
            g.fillStyle = alpha(cols[d] ?? '#aaa', 0.35 + (depositQuality[i]! / 255) * 0.55);
            g.fillRect(x * T + 1, y * T + 1, T - 2, T - 2);
          }
        // cluster icons + amounts
        const cl = this.clusters(state);
        const z = rc.zoom;
        g.textAlign = 'center';
        g.textBaseline = 'top';
        for (const c of cl) {
          if (c.x < view.x0 - 2 || c.y < view.y0 - 2 || c.x > view.x1 + 2 || c.y > view.y1 + 2) continue;
          const def = ctx.data.deposits[depositTypes[c.d]!];
          if (!def) continue;
          const s = Math.max(T * 0.5, 20 / z);
          const cx = (c.x + 0.5) * T;
          const cy = (c.y + 0.5) * T;
          g.fillStyle = 'rgba(15,18,26,0.8)';
          g.beginPath();
          g.arc(cx, cy, s * 0.62, 0, Math.PI * 2);
          g.fill();
          g.strokeStyle = def.color;
          g.lineWidth = s * 0.1;
          g.stroke();
          drawEmoji(g, def.icon, cx, cy, s * 0.8, s * 0.8 * z * rc.dpr);
          if (rc.ppt >= 10) {
            const fs = Math.max(6, 10 / z);
            g.font = `600 ${fs}px system-ui, sans-serif`;
            g.fillStyle = '#fff';
            g.fillText(formatNumber(c.amount), cx, cy + s * 0.7);
          }
        }
      },
    });
    this.register({
      id: 'ownership',
      name: 'Własność',
      icon: '🏢',
      description: 'Budynki i infrastruktura według firm.',
      unit: '',
      minLabel: '',
      maxLabel: '',
      stops: [{ t: 0, color: '#888' }],
      refreshMs: 0,
      dim: 0.45,
      legend: (st) => ({
        kind: 'categories',
        categories: st ? Object.values(st.companies).map((c) => ({ label: c.name, color: c.color, icon: c.logo })) : [],
      }),
      draw: (rc) => {
        const { g, state, view } = rc;
        const W = state.map.width;
        const { road, rail, owner } = state.network;
        for (let y = view.y0; y < view.y1; y++)
          for (let x = view.x0; x < view.x1; x++) {
            const i = y * W + x;
            if (!road[i] && !rail[i]) continue;
            const o = owner[i]!;
            g.fillStyle = alpha(state.companies[o]?.color ?? PUBLIC_COLOR, 0.7);
            g.fillRect(x * T + 8, y * T + 8, T - 16, T - 16);
          }
        for (const k in state.buildings) {
          const b = state.buildings[k]!;
          if (b.x + b.w < view.x0 || b.y + b.h < view.y0 || b.x > view.x1 || b.y > view.y1) continue;
          const col = state.companies[b.owner]?.color ?? PUBLIC_COLOR;
          g.fillStyle = alpha(col, 0.75);
          g.fillRect(b.x * T + 2, b.y * T + 2, b.w * T - 4, b.h * T - 4);
        }
      },
    });
  }

  private clusters(state: GameState): { x: number; y: number; d: number; n: number; amount: number }[] {
    if (this.depClusters.st === state) return this.depClusters.list;
    const { width: W, height: H, deposit, depositAmount } = state.map;
    const seen = new Uint8Array(W * H);
    const list: { x: number; y: number; d: number; n: number; amount: number }[] = [];
    const stack: number[] = [];
    for (let i = 0; i < W * H; i++) {
      const d = deposit[i]!;
      if (!d || seen[i]) continue;
      let sx = 0, sy = 0, n = 0, amt = 0;
      stack.push(i);
      seen[i] = 1;
      while (stack.length) {
        const j = stack.pop()!;
        const x = j % W;
        const y = (j - x) / W;
        sx += x;
        sy += y;
        n++;
        amt += depositAmount[j]!;
        if (x > 0 && !seen[j - 1] && deposit[j - 1] === d) (seen[j - 1] = 1), stack.push(j - 1);
        if (x < W - 1 && !seen[j + 1] && deposit[j + 1] === d) (seen[j + 1] = 1), stack.push(j + 1);
        if (y > 0 && !seen[j - W] && deposit[j - W] === d) (seen[j - W] = 1), stack.push(j - W);
        if (y < H - 1 && !seen[j + W] && deposit[j + W] === d) (seen[j + W] = 1), stack.push(j + W);
      }
      list.push({ x: Math.round(sx / n), y: Math.round(sy / n), d, n, amount: Math.round(amt) });
    }
    this.depClusters = { st: state, list };
    return list;
  }
}

function profitOf(b: { stats: { profitHistory: number[]; revenueMonth: number; costMonth: number } }): number {
  const h = b.stats.profitHistory;
  return h.length ? h[h.length - 1]! : b.stats.revenueMonth - b.stats.costMonth;
}

export function createOverlayLayer(mgr: OverlayManager): LayerDef {
  return {
    id: 'overlay',
    z: 60,
    visible: (rc) => !!rc.ctx.renderer.overlay,
    draw: (rc) => mgr.draw(rc),
  };
}
