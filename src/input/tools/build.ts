/**
 * Build tool: place a building (args: { typeId, rotation? }).
 *
 * Preview: footprint (green = OK, red = invalid + per-tile problems), catchment
 * radius, deposit tiles, dashed line to the nearest city. The info card
 * (ToolDef.status) shows cost, reason, expected monthly output, deposit /
 * fertility, nearest city demand and nearby suppliers/customers.
 * Placement goes through ctx.services.economy (checkPlacement / build).
 * Keys: R = rotate, Esc / right click = exit.
 */
import { TILE_SIZE } from '../../core/constants';
import type { GameContext } from '../../core/context';
import { footprintSize, type PlaceCheck } from '../../core/entities';
import { formatMoney, formatNumber, formatPercent } from '../../core/format';
import { TileFlag, type GameState } from '../../core/types';
import { cityPopulation } from '../../core/entities';
import type { BuildingDef } from '../../data/defs';
import type { RenderContext } from '../../render/types';
import type { ToolDef, ToolStatus, ToolStatusLine } from '../types';

const T = TILE_SIZE;

export interface BuildToolArgs {
  typeId: string;
  rotation?: 0 | 1 | 2 | 3;
}

interface Analysis {
  lines: ToolStatusLine[];
  cityPos: { x: number; y: number; name: string } | null;
  depositTiles: number[];
  badTiles: number[];
}

/** Anchor (top-left) so the cursor sits in the middle of the footprint. */
export function anchorFor(def: BuildingDef, rot: number, tx: number, ty: number): { x: number; y: number; w: number; h: number } {
  const { w, h } = footprintSize(def, rot);
  return { x: tx - Math.floor((w - 1) / 2), y: ty - Math.floor((h - 1) / 2), w, h };
}

export function createBuildTool(ctx: GameContext): ToolDef {
  let typeId = '';
  let rot: 0 | 1 | 2 | 3 = 0;
  let hover: { tx: number; ty: number } | null = null;
  let key = '';
  let check: PlaceCheck | null = null;
  let checkAt = 0;
  let analysis: Analysis | null = null;

  const def = (): BuildingDef | undefined => ctx.data.buildings[typeId];
  const player = (): number => ctx.state.playerCompanyId;

  const refresh = (force = false): void => {
    const d = def();
    if (!d || !hover || !ctx.hasGame) {
      check = null;
      analysis = null;
      key = '';
      return;
    }
    const a = anchorFor(d, rot, hover.tx, hover.ty);
    const k = `${typeId}:${a.x}:${a.y}:${rot}`;
    const now = performance.now();
    if (!force && k === key && now - checkAt < 400) return;
    const moved = k !== key;
    key = k;
    checkAt = now;
    try {
      check = ctx.services.economy.checkPlacement(player(), typeId, a.x, a.y, rot);
    } catch (err) {
      check = { ok: false, reason: `Błąd: ${String(err)}`, cost: 0 };
    }
    if (moved || !analysis) analysis = analyse(ctx, d, a.x, a.y, a.w, a.h);
  };

  return {
    id: 'build',
    name: 'Budowa',
    icon: '🔨',
    cursor: 'crosshair',
    activate(_c, args) {
      const a = (args ?? {}) as Partial<BuildToolArgs>;
      typeId = a.typeId ?? typeId;
      rot = a.rotation ?? 0;
      key = '';
      analysis = null;
      const h = ctx.input.hover;
      hover = h ? { tx: h.x, ty: h.y } : null;
      refresh(true);
    },
    deactivate() {
      hover = null;
      check = null;
      analysis = null;
    },
    pointerMove(e) {
      hover = e.inMap ? { tx: e.tx, ty: e.ty } : null;
      refresh();
    },
    click(e) {
      const d = def();
      if (!d || !e.inMap) return;
      hover = { tx: e.tx, ty: e.ty };
      const a = anchorFor(d, rot, e.tx, e.ty);
      let res;
      try {
        res = ctx.services.economy.build(player(), typeId, a.x, a.y, rot);
      } catch (err) {
        res = { ok: false as const, reason: String(err) };
      }
      // success: the economy service emits 'building:built' + sfx; the tool stays active for repeated placement
      if (!res.ok) {
        ctx.ui.toast({ level: 'warning', icon: '🚫', title: `Nie można postawić: ${d.name}`, text: res.reason, durationMs: 3000 });
        ctx.bus.emit('sfx', { id: 'error' });
      }
      refresh(true);
    },
    keyDown(e) {
      if (e.key === 'r' || e.key === 'R') {
        rot = (((rot + (e.shiftKey ? 3 : 1)) % 4) as 0 | 1 | 2 | 3);
        refresh(true);
        ctx.bus.emit('sfx', { id: 'click' });
        return true;
      }
      return false;
    },
    cancel() {
      return false;
    },
    drawPreview(rc) {
      const d = def();
      if (!d || !hover) return;
      refresh();
      drawFootprint(rc, d, rot, hover.tx, hover.ty, check, analysis);
    },
    hint: () => {
      const d = def();
      return `${d ? `${d.icon} ${d.name}` : 'Budowa'} — LPM: postaw · R: obróć · PPM/Esc: zakończ`;
    },
    status: () => {
      const d = def();
      if (!d || !hover || !ctx.hasGame) return null;
      refresh();
      const cash = ctx.state.companies[player()]?.cash ?? 0;
      const lines: ToolStatusLine[] = [];
      if (check) {
        const cost = check.ok ? check.cost : d.cost; // an invalid spot has no meaningful price
        lines.push({ label: 'Koszt', value: formatMoney(cost), tone: cost > cash ? 'neg' : undefined });
      }
      lines.push({ label: 'Utrzymanie', value: `${formatMoney(d.upkeep)}/mies.`, tone: 'dim' });
      if (d.workers) lines.push({ label: 'Pracownicy', value: String(d.workers), tone: 'dim' });
      if (analysis) lines.push(...analysis.lines);
      const st: ToolStatus = {
        icon: d.icon,
        title: d.name,
        ok: check?.ok,
        message: check ? (check.ok ? 'Kliknij, aby postawić' : check.reason ?? 'Nie można tu budować') : undefined,
        lines,
        footer: `R: obróć (${['↑', '→', '↓', '←'][rot]}) · Esc: zakończ`,
      };
      return st;
    },
  };
}

// ---------------------------------------------------------------- analysis
function analyse(ctx: GameContext, d: BuildingDef, x: number, y: number, w: number, h: number): Analysis {
  const st = ctx.state;
  const map = st.map;
  const lines: ToolStatusLine[] = [];
  const depositTiles: number[] = [];
  const badTiles: number[] = [];
  let depQ = 0;
  let depN = 0;
  let depAmount = 0;
  let fert = 0;
  let n = 0;
  for (let ty = y; ty < y + h; ty++)
    for (let tx = x; tx < x + w; tx++) {
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
      const i = ty * map.width + tx;
      n++;
      fert += map.fertility[i]!;
      const terrain = map.terrain[i]!;
      if (!d.allowedTerrain.includes(terrain as never) || map.building[i] || st.network.road[i] || st.network.rail[i] || map.flags[i]! & TileFlag.Blocked) badTiles.push(i);
      if (d.requiresDeposit && map.depositTypes[map.deposit[i]!] === d.requiresDeposit && map.depositAmount[i]! > 0) {
        depQ += map.depositQuality[i]!;
        depN++;
        depAmount += map.depositAmount[i]!;
      }
    }
  // nearby deposit tiles (so the player sees where to move)
  if (d.requiresDeposit) {
    const r = 6;
    for (let ty = y - r; ty < y + h + r; ty++)
      for (let tx = x - r; tx < x + w + r; tx++) {
        if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
        const i = ty * map.width + tx;
        if (map.depositTypes[map.deposit[i]!] === d.requiresDeposit && map.depositAmount[i]! > 0) depositTiles.push(i);
      }
    if (depN) {
      lines.push({ label: 'Złoże', value: `${formatNumber(depAmount)} j. · jakość ${formatPercent(depQ / depN / 255)}`, tone: depQ / depN / 255 >= 0.5 ? 'pos' : 'warn' });
    } else lines.push({ label: 'Złoże', value: 'brak pod budynkiem', tone: 'neg' });
  }
  if (d.minFertility !== undefined && n) {
    const avg = fert / n;
    lines.push({ label: 'Żyzność gleby', value: formatPercent(avg / 255), tone: avg >= d.minFertility ? (avg / 255 > 0.6 ? 'pos' : undefined) : 'neg' });
  }

  // expected output
  const recipe = d.recipes[0] ? ctx.data.recipes[d.recipes[0]] : undefined;
  const outputs: string[] = [];
  if (recipe && recipe.days > 0) {
    const cycles = 30 / recipe.days;
    lines.push({
      label: 'Produkcja',
      value: recipe.outputs.map((o) => `~${formatNumber(o.qty * cycles)} ${ctx.data.products[o.product]?.icon ?? ''}`).join(' ') + '/mies.',
    });
    if (recipe.inputs.length)
      lines.push({ label: 'Zużycie', value: recipe.inputs.map((o) => `${formatNumber(o.qty * cycles)} ${ctx.data.products[o.product]?.icon ?? ''}`).join(' ') + '/mies.', tone: 'dim' });
    outputs.push(...recipe.outputs.map((o) => o.product));
  }
  const sells = d.category === 'shop' ? (d.sells ?? []) : [];

  // nearest city & demand
  const cx = x + w / 2;
  const cy = y + h / 2;
  let cityPos: Analysis['cityPos'] = null;
  let cityId = 0;
  try {
    cityId = ctx.services.world.nearestCity(Math.floor(cx), Math.floor(cy));
  } catch {
    cityId = 0;
  }
  const city = cityId ? st.cities[cityId] : undefined;
  if (city) {
    const dist = Math.round(Math.hypot(city.x - cx, city.y - cy));
    cityPos = { x: city.x + 0.5, y: city.y + 0.5, name: city.name };
    lines.push({ label: 'Najbliższe miasto', value: `${city.name} · ${dist} kafli · ${formatNumber(cityPopulation(city))} mieszk.`, tone: 'dim' });
    for (const pid of [...new Set([...outputs, ...sells])]) {
      const dem = city.demand[pid];
      if (!dem) continue;
      const p = ctx.data.products[pid];
      lines.push({
        label: `Popyt ${p?.icon ?? ''}`,
        value: `${formatNumber(dem.monthly)}/mies. · zaspokojony ${formatPercent(dem.satisfaction)}`,
        tone: dem.satisfaction < 0.5 ? 'pos' : dem.satisfaction > 0.9 ? 'warn' : undefined,
      });
    }
  }
  if (d.category === 'shop' && d.radius) {
    let pop = 0;
    let cities = 0;
    for (const c of Object.values(st.cities)) {
      if (Math.hypot(c.x - cx, c.y - cy) <= d.radius + c.radius) {
        pop += cityPopulation(c);
        cities++;
      }
    }
    lines.push({ label: 'Klienci w zasięgu', value: cities ? `${formatNumber(pop)} mieszk. (${cities} miast)` : 'brak — postaw bliżej miasta', tone: cities ? 'pos' : 'neg' });
  }

  // nearby partners (suppliers of inputs / consumers of outputs), player first
  const inputs = recipe?.inputs.map((i) => i.product) ?? sells;
  const near = nearbyPartners(ctx, st, cx, cy, inputs, outputs);
  if (near.supplier) lines.push({ label: 'Dostawca', value: near.supplier, tone: 'pos' });
  else if (inputs.length) lines.push({ label: 'Dostawca', value: 'brak w pobliżu', tone: 'warn' });
  if (near.consumer) lines.push({ label: 'Odbiorca', value: near.consumer, tone: 'pos' });
  if (d.pollution >= 3) lines.push({ label: 'Emisje', value: `${d.pollution}/mies. — obniża zadowolenie miast`, tone: 'warn' });
  return { lines, cityPos, depositTiles, badTiles };
}

function nearbyPartners(
  ctx: GameContext,
  st: GameState,
  cx: number,
  cy: number,
  inputs: string[],
  outputs: string[],
): { supplier: string | null; consumer: string | null } {
  let bestS: { d: number; text: string } | null = null;
  let bestC: { d: number; text: string } | null = null;
  const pid = st.playerCompanyId;
  for (const b of Object.values(st.buildings)) {
    if (b.owner !== pid) continue;
    const bd = ctx.data.buildings[b.typeId];
    if (!bd) continue;
    const r = b.recipeId ? ctx.data.recipes[b.recipeId] : undefined;
    const d = Math.hypot(b.x + b.w / 2 - cx, b.y + b.h / 2 - cy);
    if (d > 40) continue;
    const label = `${bd.icon} ${b.name ?? bd.name} (${Math.round(d)} kafli)`;
    if (inputs.length && r?.outputs.some((o) => inputs.includes(o.product)) && (!bestS || d < bestS.d)) bestS = { d, text: label };
    const consumes = r?.inputs.some((i) => outputs.includes(i.product)) || (bd.category === 'shop' && (bd.sells ?? []).some((p) => outputs.includes(p)));
    if (outputs.length && consumes && (!bestC || d < bestC.d)) bestC = { d, text: label };
  }
  return { supplier: bestS?.text ?? null, consumer: bestC?.text ?? null };
}

// ---------------------------------------------------------------- drawing
function drawFootprint(rc: RenderContext, d: BuildingDef, rot: number, tx: number, ty: number, check: PlaceCheck | null, an: Analysis | null): void {
  const { g, zoom, state } = rc;
  const a = anchorFor(d, rot, tx, ty);
  const ok = !!check?.ok;
  const W = state.map.width;
  const pulse = 0.5 + 0.5 * Math.sin(rc.timeMs / 250);

  // deposit tiles nearby
  if (an?.depositTiles.length) {
    const dep = rc.data.deposits[d.requiresDeposit ?? ''];
    g.fillStyle = dep?.color ?? '#b07030';
    g.globalAlpha = 0.35;
    for (const i of an.depositTiles) g.fillRect((i % W) * T + T * 0.3, Math.floor(i / W) * T + T * 0.3, T * 0.4, T * 0.4);
    g.globalAlpha = 1;
  }

  // catchment radius
  if (d.radius) {
    g.save();
    g.beginPath();
    g.arc((a.x + a.w / 2) * T, (a.y + a.h / 2) * T, d.radius * T, 0, Math.PI * 2);
    g.fillStyle = 'rgba(74,158,224,0.08)';
    g.fill();
    g.setLineDash([8 / zoom, 6 / zoom]);
    g.strokeStyle = 'rgba(120,190,255,0.7)';
    g.lineWidth = 1.5 / zoom;
    g.stroke();
    g.restore();
  }

  // line to nearest city
  if (an?.cityPos) {
    g.save();
    g.setLineDash([6 / zoom, 6 / zoom]);
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 1.5 / zoom;
    g.beginPath();
    g.moveTo((a.x + a.w / 2) * T, (a.y + a.h / 2) * T);
    g.lineTo(an.cityPos.x * T, an.cityPos.y * T);
    g.stroke();
    g.restore();
  }

  // footprint
  g.fillStyle = ok ? `rgba(92,196,134,${0.28 + 0.1 * pulse})` : `rgba(224,86,74,${0.28 + 0.1 * pulse})`;
  g.fillRect(a.x * T, a.y * T, a.w * T, a.h * T);
  // bad tiles
  if (an && !ok) {
    g.strokeStyle = 'rgba(255,90,80,0.95)';
    g.lineWidth = 2 / zoom;
    for (const i of an.badTiles) {
      const bx = (i % W) * T;
      const by = Math.floor(i / W) * T;
      g.beginPath();
      g.moveTo(bx + 6, by + 6);
      g.lineTo(bx + T - 6, by + T - 6);
      g.moveTo(bx + T - 6, by + 6);
      g.lineTo(bx + 6, by + T - 6);
      g.stroke();
    }
  }
  g.strokeStyle = ok ? '#5cc486' : '#e0564a';
  g.lineWidth = 2 / zoom;
  g.strokeRect(a.x * T, a.y * T, a.w * T, a.h * T);

  // icon + rotation arrow
  const cx = (a.x + a.w / 2) * T;
  const cy = (a.y + a.h / 2) * T;
  g.font = `${Math.round(Math.min(a.w, a.h) * T * 0.55)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.globalAlpha = 0.9;
  g.fillText(d.icon, cx, cy);
  g.globalAlpha = 1;
  if (d.size.w !== d.size.h || rot) {
    const ang = (rot * Math.PI) / 2 - Math.PI / 2;
    const r = (Math.min(a.w, a.h) * T) / 2 - 4;
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
    g.lineTo(cx + Math.cos(ang + 2.6) * 7, cy + Math.sin(ang + 2.6) * 7 + 0);
    g.lineTo(cx + Math.cos(ang - 2.6) * 7, cy + Math.sin(ang - 2.6) * 7);
    g.closePath();
    g.globalAlpha = 0.6;
    g.fill();
    g.globalAlpha = 1;
  }
}
