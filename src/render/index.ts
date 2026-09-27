/**
 * render module init. The Renderer instance itself is created by main.ts
 * (needs the canvas) and exposed as ctx.renderer; here we register layers.
 * Owner: render agent.
 */
import type { GameContext } from '../core/context';
import { createPlaceholderLayers } from './layers/placeholders';
import { createTerrainLayer } from './layers/terrain';

export function init(ctx: GameContext): void {
  if (ctx.headless) return;
  ctx.renderer.registerLayer(createTerrainLayer(ctx));
  for (const l of createPlaceholderLayers(ctx)) ctx.renderer.registerLayer(l);
}
