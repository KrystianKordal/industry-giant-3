/**
 * input module init: default tool, input layers, global hotkeys.
 * The InputManager instance is created by main.ts (needs the canvas) and exposed as ctx.input.
 * Owner: UI agent. Other modules register their own tools via ctx.input.registerTool.
 */
import type { GameContext } from '../core/context';
import { InputManager } from './input';
import { createInputLayers } from './layers';
import { createInspectTool } from './tools/inspect';

export function init(ctx: GameContext): void {
  ctx.input.registerTool(createInspectTool(ctx));
  if (ctx.input instanceof InputManager) for (const l of createInputLayers(ctx, ctx.input)) ctx.renderer.registerLayer(l);

  ctx.input.registerHotkey({ key: 'space', description: 'Pauza / wznów', handler: (_e, c) => c.sim.togglePause() });
  ctx.input.registerHotkey({ key: '1', description: 'Prędkość ×1', handler: (_e, c) => c.sim.setSpeed(1) });
  ctx.input.registerHotkey({ key: '2', description: 'Prędkość ×2', handler: (_e, c) => c.sim.setSpeed(2) });
  ctx.input.registerHotkey({ key: '3', description: 'Prędkość ×4', handler: (_e, c) => c.sim.setSpeed(4) });
  ctx.input.registerHotkey({
    key: 'g',
    description: 'Siatka',
    handler: (_e, c) => {
      c.userSettings.showGrid = !c.userSettings.showGrid;
    },
  });
}
