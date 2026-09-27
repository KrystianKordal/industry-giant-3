/**
 * Network layer (z=10): roads (dirt / paved / highway), rails (ballast,
 * sleepers, steel rails, catenary), bridges and tunnel portals.
 * Geometry is built per 32×32 chunk into Path2D objects (world px) and cached
 * until the chunk is invalidated (network:changed / map:changed).
 */
import { CHUNK_SIZE, TILE_SIZE } from '../../core/constants';
import type { GameContext } from '../../core/context';
import { RailKind, RoadKind, Terrain, TileFlag, type GameState, type TileRect } from '../../core/types';
import { addPts, deriveMask4, pieceOffset, piecesFor } from '../netGeom';
import type { LayerDef, RenderContext } from '../types';

const T = TILE_SIZE;

interface NetChunk {
  dirty: boolean;
  /** Road centrelines per kind (index = RoadKind). */
  road: Path2D[];
  /** Straight centrelines (lane markings) per kind. */
  roadMark: Path2D[];
  rail: Path2D[];
  /** Offset rail lines per kind. */
  railSteel: Path2D[];
  /** Catenary posts (electrified). */
  posts: Path2D;
  /** Bridge decks (road + rail centrelines on bridge tiles). */
  bridge: Path2D;
  bridgeRail: Path2D;
  tunnel: Path2D;
  hasRoad: boolean;
  hasRail: boolean;
  hasBridge: boolean;
  hasTunnel: boolean;
}

const ROAD_STYLE = [
  null,
  { w: 0.34, edge: '#8f7a57', fill: '#c9b48a', mark: null as string | null, far: '#e4d4ac' }, // dirt
  { w: 0.46, edge: '#474b52', fill: '#6c7079', mark: '#e9e4cf', far: '#f1ead6' }, // paved
  { w: 0.62, edge: '#34373d', fill: '#565a62', mark: '#f0c64a', far: '#f6d77e' }, // highway
] as const;

const RAIL_STYLE = [
  null,
  { bed: '#9a8e7c', sleeper: '#5f4a38', steel: '#c4c8cf' },
  { bed: '#948c80', sleeper: '#5a4a3c', steel: '#d0d4db' },
  { bed: '#b9b5ad', sleeper: '#8d8a84', steel: '#e1e4ea' },
] as const;

/** Road mask: logistics' roadConn (+ driveway stubs into buildings) or derived from neighbours. */
export function roadMaskAt(state: GameState, i: number): number {
  const net = state.network;
  const W = state.map.width;
  const H = state.map.height;
  let m = net.roadConn[i]!;
  const x = i % W;
  const y = (i - x) / W;
  if (!m) m = deriveMask4(x, y, (nx, ny) => nx >= 0 && ny >= 0 && nx < W && ny < H && net.road[ny * W + nx]! > 0);
  const b = state.map.building;
  if (y > 0 && b[i - W]) m |= 1;
  if (x < W - 1 && b[i + 1]) m |= 2;
  if (y < H - 1 && b[i + W]) m |= 4;
  if (x > 0 && b[i - 1]) m |= 8;
  return m;
}

/** Rail mask straight from logistics (rails connect only along drawn directions). */
export function railMaskAt(state: GameState, i: number): number {
  return state.network.railConn[i]!;
}

function buildChunk(state: GameState, cx: number, cy: number): NetChunk {
  const c: NetChunk = {
    dirty: false,
    road: [new Path2D(), new Path2D(), new Path2D(), new Path2D()],
    roadMark: [new Path2D(), new Path2D(), new Path2D(), new Path2D()],
    rail: [new Path2D(), new Path2D(), new Path2D(), new Path2D()],
    railSteel: [new Path2D(), new Path2D(), new Path2D(), new Path2D()],
    posts: new Path2D(),
    bridge: new Path2D(),
    bridgeRail: new Path2D(),
    tunnel: new Path2D(),
    hasRoad: false,
    hasRail: false,
    hasBridge: false,
    hasTunnel: false,
  };
  const { map, network } = state;
  const W = map.width;
  const x0 = cx * CHUNK_SIZE;
  const y0 = cy * CHUNK_SIZE;
  const x1 = Math.min(W, x0 + CHUNK_SIZE);
  const y1 = Math.min(map.height, y0 + CHUNK_SIZE);
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = y * W + x;
      const rk = network.road[i]!;
      const lk = network.rail[i]!;
      if (!rk && !lk) continue;
      const flags = map.flags[i]!;
      const onWater = map.terrain[i]! <= Terrain.Water || (flags & (TileFlag.Bridge | TileFlag.River)) !== 0;
      if (flags & TileFlag.Tunnel) {
        c.hasTunnel = true;
        c.tunnel.rect(x * T + 4, y * T + 4, T - 8, T - 8);
      }
      if (rk) {
        const kind = Math.min(3, rk);
        c.hasRoad = true;
        const m = roadMaskAt(state, i);
        const pieces = piecesFor(m);
        if (!pieces.length) {
          c.road[kind]!.moveTo((x + 0.5) * T, (y + 0.5) * T);
          c.road[kind]!.lineTo((x + 0.51) * T, (y + 0.5) * T);
        }
        for (const p of pieces) {
          addPts(c.road[kind]!, p.pts, x, y, T);
          if (p.straight || (pieces.length === 1 && !p.arm)) addPts(c.roadMark[kind]!, p.pts, x, y, T);
          if (onWater) {
            c.hasBridge = true;
            addPts(c.bridge, p.pts, x, y, T);
          }
        }
      }
      if (lk) {
        const kind = Math.min(3, lk);
        c.hasRail = true;
        const m = railMaskAt(state, i);
        const pieces = piecesFor(m);
        if (!pieces.length) {
          c.rail[kind]!.moveTo((x + 0.3) * T, (y + 0.5) * T);
          c.rail[kind]!.lineTo((x + 0.7) * T, (y + 0.5) * T);
        }
        for (let k = 0; k < pieces.length; k++) {
          const p = pieces[k]!;
          addPts(c.rail[kind]!, p.pts, x, y, T);
          addPts(c.railSteel[kind]!, pieceOffset(m, k, 0.1), x, y, T);
          addPts(c.railSteel[kind]!, pieceOffset(m, k, -0.1), x, y, T);
          if (onWater) {
            c.hasBridge = true;
            addPts(c.bridgeRail, p.pts, x, y, T);
          }
        }
        if (kind === RailKind.Electrified && (x + y) % 2 === 0 && pieces.length) {
          const q = pieceOffset(m, 0, 0.3);
          const mid = (q.length / 2) | 0;
          const px = (x + q[mid - (mid % 2)]!) * T;
          const py = (y + q[mid - (mid % 2) + 1]!) * T;
          c.posts.moveTo(px + 1.6, py);
          c.posts.arc(px, py, 1.6, 0, Math.PI * 2);
        }
      }
    }
  return c;
}

export function createNetworkLayer(ctx: GameContext): LayerDef {
  const chunks = new Map<number, NetChunk>();
  let stateRef: GameState | null = null;
  const vis: NetChunk[] = [];

  const get = (state: GameState, cx: number, cy: number): NetChunk => {
    const k = cy * 4096 + cx;
    let c = chunks.get(k);
    if (!c || c.dirty) {
      c = buildChunk(state, cx, cy);
      chunks.set(k, c);
    }
    return c;
  };

  const invalidate = (r: TileRect | null): void => {
    if (!r) {
      for (const c of chunks.values()) c.dirty = true;
      return;
    }
    for (let cy = Math.floor(r.y / CHUNK_SIZE); cy <= Math.floor((r.y + r.h - 1) / CHUNK_SIZE); cy++)
      for (let cx = Math.floor(r.x / CHUNK_SIZE); cx <= Math.floor((r.x + r.w - 1) / CHUNK_SIZE); cx++) {
        const c = chunks.get(cy * 4096 + cx);
        if (c) c.dirty = true;
      }
  };
  // buildings add driveway stubs to adjacent roads
  ctx.bus.on('building:built', ({ buildingId }) => {
    const b = ctx.tryState()?.buildings[buildingId];
    if (b) invalidate({ x: b.x - 1, y: b.y - 1, w: b.w + 2, h: b.h + 2 });
  });
  ctx.bus.on('building:removed', (b) => invalidate({ x: b.x - 1, y: b.y - 1, w: b.w + 2, h: b.h + 2 }));

  const draw = (rc: RenderContext): void => {
    const { g, state, view } = rc;
    if (state !== stateRef) {
      chunks.clear();
      stateRef = state;
    }
    vis.length = 0;
    let anyRoad = false;
    let anyRail = false;
    let anyBridge = false;
    for (let cy = Math.floor(view.y0 / CHUNK_SIZE); cy <= Math.floor((view.y1 - 1) / CHUNK_SIZE); cy++)
      for (let cx = Math.floor(view.x0 / CHUNK_SIZE); cx <= Math.floor((view.x1 - 1) / CHUNK_SIZE); cx++) {
        const c = get(state, cx, cy);
        if (!c.hasRoad && !c.hasRail && !c.hasTunnel) continue;
        vis.push(c);
        anyRoad ||= c.hasRoad;
        anyRail ||= c.hasRail;
        anyBridge ||= c.hasBridge;
      }
    if (!vis.length) return;
    const p = rc.ppt;
    const far = p < 12;
    const minW = 1.4 / rc.zoom; // at least ~1.4 css px wide
    g.lineCap = 'round';
    g.lineJoin = 'round';

    // ---- bridges (under everything)
    if (anyBridge && !far) {
      g.save();
      g.translate(T * 0.1, T * 0.14);
      g.strokeStyle = 'rgba(10,30,50,0.3)';
      g.lineWidth = T * 0.72;
      g.lineCap = 'butt';
      for (const c of vis) if (c.hasBridge) {
        g.stroke(c.bridge);
        g.stroke(c.bridgeRail);
      }
      g.restore();
      g.lineCap = 'butt';
      g.strokeStyle = '#6d6259';
      g.lineWidth = T * 0.74;
      for (const c of vis) if (c.hasBridge) {
        g.stroke(c.bridge);
        g.stroke(c.bridgeRail);
      }
      g.strokeStyle = '#b6a893';
      g.lineWidth = T * 0.64;
      for (const c of vis) if (c.hasBridge) {
        g.stroke(c.bridge);
        g.stroke(c.bridgeRail);
      }
      g.lineCap = 'round';
    }

    // ---- roads
    if (anyRoad) {
      for (let k = 1; k <= 3; k++) {
        const s = ROAD_STYLE[k]!;
        if (far) {
          g.strokeStyle = s.far;
          g.lineWidth = Math.max(minW, T * s.w * 0.8);
          for (const c of vis) g.stroke(c.road[k]!);
          continue;
        }
        g.strokeStyle = s.edge;
        g.lineWidth = T * (s.w + 0.08);
        for (const c of vis) g.stroke(c.road[k]!);
      }
      if (!far)
        for (let k = 1; k <= 3; k++) {
          const s = ROAD_STYLE[k]!;
          g.strokeStyle = s.fill;
          g.lineWidth = T * s.w;
          for (const c of vis) g.stroke(c.road[k]!);
        }
      if (p >= 20) {
        g.lineCap = 'butt';
        for (let k: number = RoadKind.Paved; k <= RoadKind.Highway; k++) {
          const s = ROAD_STYLE[k]!;
          g.strokeStyle = s.mark!;
          g.lineWidth = T * (k === RoadKind.Highway ? 0.035 : 0.03);
          g.setLineDash(k === RoadKind.Highway ? [] : [T * 0.14, T * 0.12]);
          for (const c of vis) g.stroke(c.roadMark[k]!);
        }
        // dirt road wheel ruts
        g.setLineDash([]);
        g.strokeStyle = 'rgba(120,96,60,0.35)';
        g.lineWidth = T * 0.05;
        for (const c of vis) g.stroke(c.roadMark[RoadKind.Dirt]!);
        g.lineCap = 'round';
      }
    }

    // ---- rails
    if (anyRail) {
      if (far) {
        for (let k = 1; k <= 3; k++) {
          g.strokeStyle = '#3b3d44';
          g.lineWidth = Math.max(minW * 1.2, T * 0.26);
          for (const c of vis) g.stroke(c.rail[k]!);
        }
        g.strokeStyle = '#f2f2f2';
        g.lineWidth = Math.max(minW * 0.5, T * 0.12);
        g.lineCap = 'butt';
        g.setLineDash([T * 0.5, T * 0.5]);
        for (let k = 1; k <= 3; k++) for (const c of vis) g.stroke(c.rail[k]!);
        g.setLineDash([]);
        g.lineCap = 'round';
      } else {
        for (let k = 1; k <= 3; k++) {
          const s = RAIL_STYLE[k]!;
          g.strokeStyle = s.bed;
          g.lineWidth = T * 0.44;
          g.lineCap = 'butt';
          for (const c of vis) g.stroke(c.rail[k]!);
          if (p >= 14) {
            g.strokeStyle = s.sleeper;
            g.lineWidth = T * 0.36;
            g.setLineDash([T * 0.055, T * 0.09]);
            for (const c of vis) g.stroke(c.rail[k]!);
            g.setLineDash([]);
          }
          g.lineCap = 'round';
          g.strokeStyle = 'rgba(40,40,44,0.8)';
          g.lineWidth = Math.max(minW * 0.5, T * 0.06);
          for (const c of vis) g.stroke(c.railSteel[k]!);
          g.strokeStyle = s.steel;
          g.lineWidth = Math.max(minW * 0.35, T * 0.032);
          for (const c of vis) g.stroke(c.railSteel[k]!);
        }
        if (p >= 16) {
          g.fillStyle = '#4b4f57';
          for (const c of vis) g.fill(c.posts);
        }
      }
    }

    // ---- tunnel portals
    for (const c of vis) {
      if (!c.hasTunnel) continue;
      g.fillStyle = 'rgba(30,28,26,0.55)';
      g.fill(c.tunnel);
    }
    g.lineCap = 'butt';
  };

  return { id: 'network', z: 10, draw, invalidate };
}
