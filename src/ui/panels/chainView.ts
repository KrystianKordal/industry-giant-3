/**
 * Chain view (panel 'chains'): live diagram of the player's production chains.
 * Nodes = owned building types (grouped, columns by chain depth), edges =
 * routes with monthly throughput (animated flow), dashed grey = missing
 * connection (recipe link without a route), red = bottleneck.
 * Hover = details, click node = cycle through its buildings on the map,
 * drag node = rearrange (kept while the panel is open).
 */
import type { GameContext } from '../../core/context';
import { formatMoney, formatNumber, formatPercent } from '../../core/format';
import { buildChainGraph, type ChainEdge, type ChainGraph, type ChainNode } from '../analytics';
import { badge, emptyState } from '../components';
import { h, setChildren } from '../dom';
import { productIcon, productName } from '../fmt';
import { hideTooltip, tooltip } from '../tooltip';
import { focusTarget } from '../ui';
import type { PanelDef } from '../types';

const NODE_W = 150;
const NODE_H = 58;
const COL_GAP = 70;
const ROW_GAP = 22;

interface Laid {
  node: ChainNode;
  x: number;
  y: number;
}

function layout(g: ChainGraph, overrides: Map<string, { x: number; y: number }>): { laid: Map<string, Laid>; w: number; h: number } {
  const depths = [...new Set(g.nodes.map((n) => n.depth))].sort((a, b) => a - b);
  const laid = new Map<string, Laid>();
  let maxRows = 0;
  depths.forEach((d, col) => {
    const list = g.nodes.filter((n) => n.depth === d).sort((a, b) => b.count - a.count || a.typeId.localeCompare(b.typeId));
    maxRows = Math.max(maxRows, list.length);
    list.forEach((n, row) => {
      const o = overrides.get(n.typeId);
      laid.set(n.typeId, { node: n, x: o?.x ?? 20 + col * (NODE_W + COL_GAP), y: o?.y ?? 36 + row * (NODE_H + ROW_GAP) });
    });
  });
  let w = 40 + depths.length * (NODE_W + COL_GAP);
  let hh = 60 + maxRows * (NODE_H + ROW_GAP);
  for (const l of laid.values()) {
    w = Math.max(w, l.x + NODE_W + 20);
    hh = Math.max(hh, l.y + NODE_H + 20);
  }
  return { laid, w, h: hh };
}

export const chainPanel: PanelDef = {
  id: 'chains',
  title: 'Łańcuchy produkcyjne',
  icon: '🔗',
  width: 900,
  refreshMs: 1000,
  create(p, ctx) {
    const info = h('div', { class: 'ig-chain-info' });
    const canvas = h('canvas', { class: 'ig-chain-canvas' });
    const wrap = h('div', { class: 'ig-chain-wrap' }, canvas);
    const legend = h(
      'div',
      { class: 'ig-chain-legend' },
      h('span', null, h('i', { class: 'ok' }), 'trasa (grubość = przewóz)'),
      h('span', null, h('i', { class: 'missing' }), 'brak połączenia'),
      h('span', null, h('i', { class: 'bad' }), 'wąskie gardło'),
      h('span', { class: 'ig-muted' }, 'Najedź, aby zobaczyć szczegóły · kliknij węzeł, aby przejść do budynku · przeciągnij, aby przesunąć'),
    );
    p.body.append(info, legend, wrap);

    let graph: ChainGraph = { nodes: [], edges: [] };
    const overrides = new Map<string, { x: number; y: number }>();
    let lay = layout(graph, overrides);
    let hover: { kind: 'node'; id: string } | { kind: 'edge'; e: ChainEdge } | null = null;
    const cycleIdx = new Map<string, number>();
    let raf = 0;
    let closed = false;

    const recompute = (): void => {
      if (!ctx.hasGame) return;
      graph = buildChainGraph(ctx.state, ctx.data, ctx.state.playerCompanyId);
      lay = layout(graph, overrides);
      const bottlenecks = graph.edges.filter((e) => e.bottleneck).length;
      const missing = graph.edges.filter((e) => e.missing).length;
      const starved = graph.nodes.filter((n) => n.starved >= 0.5);
      setChildren(
        info,
        graph.nodes.length === 0
          ? emptyState('🏭', 'Nie masz jeszcze budynków produkcyjnych. Zacznij od surowców (🌾) i połącz je z fabrykami.')
          : h(
              'div',
              { class: 'ig-chips' },
              badge(`${graph.nodes.length} typów budynków`, 'info'),
              badge(`${graph.edges.filter((e) => !e.missing).length} połączeń`, 'info'),
              missing ? badge(`${missing} brakujących połączeń`, 'warn', 'Budynki mogłyby się zaopatrywać nawzajem, ale nie ma trasy') : null,
              bottlenecks ? badge(`${bottlenecks} wąskich gardeł`, 'neg') : badge('brak wąskich gardeł', 'pos'),
              starved.length ? badge(`niedobór surowców: ${starved.map((n) => ctx.data.buildings[n.typeId]?.icon ?? '').join(' ')}`, 'neg') : null,
            ),
      );
      wrap.style.display = graph.nodes.length ? '' : 'none';
    };

    const edgePts = (e: ChainEdge): [number, number, number, number] | null => {
      const a = lay.laid.get(e.from);
      const b = lay.laid.get(e.to);
      if (!a || !b) return null;
      const forward = b.x >= a.x;
      return forward ? [a.x + NODE_W, a.y + NODE_H / 2, b.x, b.y + NODE_H / 2] : [a.x, a.y + NODE_H / 2, b.x + NODE_W, b.y + NODE_H / 2];
    };
    const bez = (x1: number, y1: number, x2: number, y2: number, t: number): [number, number] => {
      const cx = (x1 + x2) / 2;
      const u = 1 - t;
      const x = u * u * u * x1 + 3 * u * u * t * cx + 3 * u * t * t * cx + t * t * t * x2;
      const y = u * u * u * y1 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y2;
      return [x, y];
    };

    const draw = (t: number): void => {
      if (closed) return;
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(lay.w, (wrap.clientWidth || 860) - 4);
      const hh = Math.max(lay.h, 260);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hh * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(hh * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${hh}px`;
      }
      const g = canvas.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, hh);
      // column headers
      g.font = '600 10px system-ui, sans-serif';
      g.fillStyle = 'rgba(147,160,178,0.8)';
      g.textAlign = 'left';
      const cols = new Map<number, number>();
      for (const l of lay.laid.values()) if (!overrides.has(l.node.typeId)) cols.set(l.node.depth, l.x);
      for (const [d, x] of cols) g.fillText(d === 0 ? 'SUROWCE' : Number.isInteger(d) ? `ETAP ${d}` : 'MAGAZYNY', x + 2, 16);

      // edges
      const maxThr = Math.max(1, ...graph.edges.map((e) => e.throughput));
      for (const e of graph.edges) {
        const pts = edgePts(e);
        if (!pts) continue;
        const [x1, y1, x2, y2] = pts;
        const isHover = hover?.kind === 'edge' && hover.e === e;
        const width = e.missing ? 1.5 : 2 + (e.throughput / maxThr) * 7;
        g.beginPath();
        g.moveTo(x1, y1);
        g.bezierCurveTo((x1 + x2) / 2, y1, (x1 + x2) / 2, y2, x2, y2);
        g.lineWidth = width + (isHover ? 2 : 0);
        g.setLineDash(e.missing ? [6, 5] : []);
        g.strokeStyle = e.bottleneck ? 'rgba(255,90,70,0.9)' : e.missing ? 'rgba(150,160,175,0.55)' : 'rgba(111,163,216,0.75)';
        g.stroke();
        g.setLineDash([]);
        // arrow head
        g.fillStyle = g.strokeStyle;
        const dir = x2 >= x1 ? 1 : -1;
        g.beginPath();
        g.moveTo(x2, y2);
        g.lineTo(x2 - 8 * dir, y2 - 5);
        g.lineTo(x2 - 8 * dir, y2 + 5);
        g.fill();
        // flow particles
        if (!e.missing && e.throughput > 0 && e.vehicles > 0 && !ctx.userSettings.reducedMotion) {
          const n = Math.min(8, 2 + Math.round((e.throughput / maxThr) * 6));
          const speed = ctx.hasGame && !ctx.state.time.paused ? 0.00018 * ctx.state.time.speed : 0;
          for (let k = 0; k < n; k++) {
            const tt = (k / n + t * speed) % 1;
            const [px, py] = bez(x1, y1, x2, y2, tt);
            g.beginPath();
            g.arc(px, py, 2.6, 0, Math.PI * 2);
            g.fillStyle = e.bottleneck ? '#ffb3a8' : '#dff0ff';
            g.fill();
          }
        }
        // label
        const [mx, my] = bez(x1, y1, x2, y2, 0.5);
        g.font = '11px system-ui, sans-serif';
        g.textAlign = 'center';
        const label = `${e.products.slice(0, 3).map((pp) => productIcon(ctx, pp)).join('')}${e.missing ? '' : ` ${formatNumber(e.throughput)}/m`}`;
        const tw = g.measureText(label).width + 8;
        g.fillStyle = 'rgba(12,16,22,0.85)';
        g.fillRect(mx - tw / 2, my - 9, tw, 17);
        g.fillStyle = e.bottleneck ? '#ff9b8e' : '#e6ebf2';
        g.fillText(label, mx, my + 4);
      }

      // nodes
      for (const l of lay.laid.values()) {
        const n = l.node;
        const def = ctx.data.buildings[n.typeId];
        const isHover = hover?.kind === 'node' && hover.id === n.typeId;
        const bad = n.starved >= 0.5 || n.blocked >= 0.5;
        g.fillStyle = isHover ? '#243042' : '#1c2430';
        g.strokeStyle = bad ? '#e0564a' : n.efficiency > 0.7 ? '#5cc486' : 'rgba(255,255,255,0.18)';
        g.lineWidth = bad ? 2.5 : 1.5;
        roundRect(g, l.x, l.y, NODE_W, NODE_H, 9);
        g.fill();
        g.stroke();
        // efficiency bar
        g.fillStyle = 'rgba(255,255,255,0.07)';
        g.fillRect(l.x + 8, l.y + NODE_H - 9, NODE_W - 16, 4);
        g.fillStyle = `hsl(${Math.round(Math.min(1, n.efficiency) * 120)} 65% 52%)`;
        g.fillRect(l.x + 8, l.y + NODE_H - 9, (NODE_W - 16) * Math.min(1, n.efficiency), 4);
        g.font = '20px system-ui, "Apple Color Emoji", sans-serif';
        g.textAlign = 'left';
        g.fillStyle = '#fff';
        g.fillText(def?.icon ?? '🏢', l.x + 8, l.y + 28);
        g.font = '600 12px system-ui, sans-serif';
        g.fillStyle = '#e6ebf2';
        g.fillText(clip(g, def?.name ?? n.typeId, NODE_W - 44), l.x + 36, l.y + 20);
        g.font = '11px system-ui, sans-serif';
        g.fillStyle = n.profit >= 0 ? '#7fd6a0' : '#ff7b6e';
        g.fillText(`×${n.count} · ${formatMoney(n.profit, true)}`, l.x + 36, l.y + 36);
        if (bad) {
          g.fillStyle = '#e0564a';
          g.font = '12px system-ui';
          g.fillText('⚠', l.x + NODE_W - 16, l.y + 16);
        }
      }
    };

    // ---------------------------------------------------------------- interaction
    const hit = (ev: MouseEvent): typeof hover => {
      const r = canvas.getBoundingClientRect();
      const k = r.width / (canvas.clientWidth || r.width);
      const x = (ev.clientX - r.left) / k;
      const y = (ev.clientY - r.top) / k;
      for (const l of lay.laid.values()) if (x >= l.x && x <= l.x + NODE_W && y >= l.y && y <= l.y + NODE_H) return { kind: 'node', id: l.node.typeId };
      let best: ChainEdge | null = null;
      let bd = 10;
      for (const e of graph.edges) {
        const pts = edgePts(e);
        if (!pts) continue;
        for (let t = 0; t <= 1; t += 0.05) {
          const [px, py] = bez(pts[0], pts[1], pts[2], pts[3], t);
          const d = Math.hypot(px - x, py - y);
          if (d < bd) {
            bd = d;
            best = e;
          }
        }
      }
      return best ? { kind: 'edge', e: best } : null;
    };
    let drag: { id: string; ox: number; oy: number; moved: boolean } | null = null;
    canvas.addEventListener('pointerdown', (ev) => {
      const hv = hit(ev);
      if (hv?.kind !== 'node') return;
      const l = lay.laid.get(hv.id)!;
      const r = canvas.getBoundingClientRect();
      const k = r.width / (canvas.clientWidth || r.width);
      drag = { id: hv.id, ox: (ev.clientX - r.left) / k - l.x, oy: (ev.clientY - r.top) / k - l.y, moved: false };
      canvas.setPointerCapture(ev.pointerId);
    });
    canvas.addEventListener('pointermove', (ev) => {
      if (drag) {
        const r = canvas.getBoundingClientRect();
        const k = r.width / (canvas.clientWidth || r.width);
        const x = (ev.clientX - r.left) / k - drag.ox;
        const y = (ev.clientY - r.top) / k - drag.oy;
        const l = lay.laid.get(drag.id);
        if (l && (Math.abs(l.x - x) > 2 || Math.abs(l.y - y) > 2 || drag.moved)) {
          drag.moved = true;
          l.x = Math.max(0, x);
          l.y = Math.max(24, y);
          overrides.set(drag.id, { x: l.x, y: l.y });
          hideTooltip();
        }
        return;
      }
      const hv = hit(ev);
      const changed = JSON.stringify(hv && (hv.kind === 'node' ? hv.id : `${hv.e.from}>${hv.e.to}`)) !== JSON.stringify(hover && (hover.kind === 'node' ? hover.id : `${hover.e.from}>${hover.e.to}`));
      hover = hv;
      canvas.style.cursor = hv?.kind === 'node' ? 'pointer' : 'default';
      if (changed) {
        if (hv) canvas.dispatchEvent(new MouseEvent('mouseenter', { clientX: ev.clientX, clientY: ev.clientY }));
        else hideTooltip();
      }
    });
    canvas.addEventListener('pointerup', (ev) => {
      const d = drag;
      drag = null;
      if (!d || d.moved) return;
      const hv = hit(ev);
      if (hv?.kind !== 'node') return;
      const n = graph.nodes.find((x) => x.typeId === hv.id);
      if (!n || !n.buildingIds.length) return;
      const i = ((cycleIdx.get(n.typeId) ?? -1) + 1) % n.buildingIds.length;
      cycleIdx.set(n.typeId, i);
      focusTarget(ctx, { kind: 'building', id: n.buildingIds[i]! });
    });
    canvas.addEventListener('mouseleave', () => (hover = null));
    tooltip(canvas, () => {
      if (!hover) return '';
      if (hover.kind === 'node') {
        const n = graph.nodes.find((x) => x.typeId === (hover as { id: string }).id);
        if (!n) return '';
        const d = ctx.data.buildings[n.typeId];
        return (
          `${d?.icon ?? ''} ${d?.name ?? n.typeId} ×${n.count}\n` +
          `Wydajność: ${formatPercent(n.efficiency)}\nZysk (mies.): ${formatMoney(n.profit)}\n` +
          (n.inputs.length ? `Wejście: ${n.inputs.map((pp) => `${productIcon(ctx, pp)} ${productName(ctx, pp)}`).join(', ')}\n` : '') +
          (n.outputs.length ? `Wyjście: ${n.outputs.map((pp) => `${productIcon(ctx, pp)} ${productName(ctx, pp)}`).join(', ')}\n` : '') +
          (n.starved > 0 ? `⚠ Brak surowców: ${formatPercent(n.starved)} budynków\n` : '') +
          (n.blocked > 0 ? `📦 Pełne magazyny: ${formatPercent(n.blocked)} budynków\n` : '') +
          'Kliknij, aby przejść do budynku.'
        );
      }
      const e = hover.e;
      const a = ctx.data.buildings[e.from];
      const b = ctx.data.buildings[e.to];
      return (
        `${a?.icon ?? ''} ${a?.name ?? e.from} → ${b?.icon ?? ''} ${b?.name ?? e.to}\n` +
        `Towary: ${e.products.map((pp) => `${productIcon(ctx, pp)} ${productName(ctx, pp)}`).join(', ')}\n` +
        (e.missing
          ? 'Brak trasy — użyj „Połącz z…” w inspektorze budynku.'
          : `Przewóz: ${formatNumber(e.throughput)} j./mies. · tras: ${e.routes} · pojazdów: ${e.vehicles}`) +
        (e.bottleneck ? `\n⚠ Wąskie gardło: ${e.vehicles === 0 && !e.missing ? 'trasa bez pojazdów' : 'odbiorca czeka na towar — dodaj pojazdy lub trasę'}` : '')
      );
    });

    recompute();
    raf = requestAnimationFrame(draw);
    p.onUpdate = recompute;
    p.onClose = () => {
      closed = true;
      cancelAnimationFrame(raf);
    };
  },
};

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function clip(g: CanvasRenderingContext2D, s: string, max: number): string {
  if (g.measureText(s).width <= max) return s;
  let t = s;
  while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}
