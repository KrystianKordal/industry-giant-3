/**
 * Collects map / network modifications made by world code and emits
 * `map:changed` / `network:changed` once per batch (per CONTRACTS: whoever
 * modifies the map emits the events).
 */
import type { GameContext } from '../core/context';
import { Dir, TileFlag, type GameState, type RoadKindId, type TileIndex } from '../core/types';

export class ChangeSet {
  x0 = Infinity;
  y0 = Infinity;
  x1 = -Infinity;
  y1 = -Infinity;
  roads: TileIndex[] = [];

  touch(x: number, y: number): void {
    if (x < this.x0) this.x0 = x;
    if (y < this.y0) this.y0 = y;
    if (x > this.x1) this.x1 = x;
    if (y > this.y1) this.y1 = y;
  }
  get empty(): boolean {
    return this.x1 < this.x0 && this.roads.length === 0;
  }
  /** Emit events (no-op when nothing changed). */
  flush(ctx: GameContext | null): void {
    if (!ctx) return;
    if (this.roads.length > 0) ctx.bus.emit('network:changed', { kind: 'road', tiles: this.roads });
    if (this.x1 >= this.x0)
      ctx.bus.emit('map:changed', { x: this.x0, y: this.y0, w: this.x1 - this.x0 + 1, h: this.y1 - this.y0 + 1 });
    this.x0 = this.y0 = Infinity;
    this.x1 = this.y1 = -Infinity;
    this.roads = [];
  }
}

const DIR_BITS = [Dir.N, Dir.E, Dir.S, Dir.W] as const;
const OPPOSITE = [Dir.S, Dir.W, Dir.N, Dir.E] as const;

/**
 * Put a public road on a tile (if none) and connect it to 4-neighbour roads
 * (both directions of roadConn). River tiles get TileFlag.Bridge.
 * Returns true if the tile changed.
 */
export function placeRoad(state: GameState, idx: TileIndex, kind: RoadKindId, cs: ChangeSet | null, owner = 0): boolean {
  const net = state.network;
  const map = state.map;
  const W = map.width;
  const H = map.height;
  const had = net.road[idx]!;
  if (had >= kind) return false;
  net.road[idx] = kind;
  if (!had) net.owner[idx] = owner;
  if (map.flags[idx]! & TileFlag.River) map.flags[idx]! |= TileFlag.Bridge;
  const x = idx % W;
  const y = (idx / W) | 0;
  const nbs = [y > 0 ? idx - W : -1, x < W - 1 ? idx + 1 : -1, y < H - 1 ? idx + W : -1, x > 0 ? idx - 1 : -1];
  for (let k = 0; k < 4; k++) {
    const n = nbs[k]!;
    if (n < 0 || !net.road[n]) continue;
    net.roadConn[idx]! |= DIR_BITS[k]!;
    net.roadConn[n]! |= OPPOSITE[k]!;
    if (cs) cs.touch(n % W, (n / W) | 0);
  }
  net.version++;
  if (cs) {
    cs.roads.push(idx);
    cs.touch(x, y);
  }
  return true;
}
