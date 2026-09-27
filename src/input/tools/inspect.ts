/**
 * Default tool: click selects vehicle / building / city / tile and emits 'select'.
 * Left-drag pans the camera.
 */
import type { GameContext } from '../../core/context';
import type { Selection } from '../../core/events';
import type { GameState } from '../../core/types';
import type { ToolDef } from '../types';

/** Resolve what is at fractional tile coords (vehicles first, then buildings, cities, tile). */
export function pickAt(state: GameState, fx: number, fy: number): Selection {
  const tx = Math.floor(fx);
  const ty = Math.floor(fy);
  const { map } = state;
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return { kind: 'none' };
  let best = 0;
  let bestD = 0.45 * 0.45;
  for (const v of Object.values(state.vehicles)) {
    const d = (v.x - fx) ** 2 + (v.y - fy) ** 2;
    if (d < bestD) {
      bestD = d;
      best = v.id;
    }
  }
  if (best) return { kind: 'vehicle', id: best };
  const i = ty * map.width + tx;
  if (map.building[i]) return { kind: 'building', id: map.building[i]! };
  if (map.city[i]) return { kind: 'city', id: map.city[i]! };
  return { kind: 'tile', x: tx, y: ty };
}

export function createInspectTool(ctx: GameContext): ToolDef {
  let last: { sx: number; sy: number } | null = null;
  return {
    id: 'inspect',
    name: 'Inspekcja',
    icon: '🔍',
    cursor: 'default',
    pointerDown(e) {
      last = { sx: e.sx, sy: e.sy };
    },
    pointerMove(e) {
      if (e.dragStart && last) {
        ctx.renderer.camera.panBy(last.sx - e.sx, last.sy - e.sy);
        last = { sx: e.sx, sy: e.sy };
      }
    },
    pointerUp() {
      last = null;
    },
    click(e) {
      const sel = pickAt(ctx.state, e.fx, e.fy);
      ctx.bus.emit('select', sel);
      if (sel.kind !== 'none') ctx.bus.emit('sfx', { id: 'click' });
    },
    hint: () => 'Kliknij obiekt, aby go zbadać. Przeciągnij, aby przesunąć mapę.',
  };
}
