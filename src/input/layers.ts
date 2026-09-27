/**
 * Input-owned render layers: active tool preview (z=90) and hover outline (z=100).
 */
import { TILE_SIZE } from '../core/constants';
import type { GameContext } from '../core/context';
import type { LayerDef } from '../render/types';
import type { InputManager } from './input';

export function createInputLayers(ctx: GameContext, input: InputManager): LayerDef[] {
  return [
    {
      id: 'tool-preview',
      z: 90,
      draw: (rc) => input.activeTool?.drawPreview?.(rc),
    },
    {
      id: 'hover',
      z: 100,
      draw({ g, zoom }) {
        const h = ctx.input.hover;
        if (!h) return;
        g.strokeStyle = 'rgba(255,255,255,0.85)';
        g.lineWidth = 2 / zoom;
        g.strokeRect(h.x * TILE_SIZE, h.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      },
    },
  ];
}
