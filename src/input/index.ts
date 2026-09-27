/**
 * input module init: tools (inspect, build, pick, blueprint), input layers, global hotkeys.
 * The InputManager instance is created by main.ts (needs the canvas) and exposed as ctx.input.
 * Owner: UI agent. Other modules register their own tools via ctx.input.registerTool.
 *
 * Reserved keys (CONTRACTS §8): W A S D, arrows, Space, 1–3, G, Esc.
 * UI hotkeys are registered in ui/index.ts (see "UI — API" in CONTRACTS.md).
 */
import type { GameContext } from '../core/context';
import { InputManager } from './input';
import { createInputLayers } from './layers';
import { createBlueprintTool } from './tools/blueprint';
import { createBuildTool } from './tools/build';
import { createInspectTool } from './tools/inspect';
import { createPickTool } from './tools/pick';

export function init(ctx: GameContext): void {
  ctx.input.registerTool(createInspectTool(ctx));
  ctx.input.registerTool(createBuildTool(ctx));
  ctx.input.registerTool(createPickTool(ctx));
  ctx.input.registerTool(createBlueprintTool(ctx));
  if (ctx.input instanceof InputManager) for (const l of createInputLayers(ctx, ctx.input)) ctx.renderer.registerLayer(l);

  ctx.input.registerHotkey({ key: 'space', description: 'Pauza / wznów', handler: (_e, c) => c.sim.togglePause() });
  ctx.input.registerHotkey({ key: '1', description: 'Prędkość ×1', handler: (_e, c) => c.sim.setSpeed(1) });
  ctx.input.registerHotkey({ key: '2', description: 'Prędkość ×2', handler: (_e, c) => c.sim.setSpeed(2) });
  ctx.input.registerHotkey({ key: '3', description: 'Prędkość ×4', handler: (_e, c) => c.sim.setSpeed(4) });
  ctx.input.registerHotkey({
    key: 'g',
    description: 'Siatka kafli',
    handler: (_e, c) => {
      c.userSettings.showGrid = !c.userSettings.showGrid;
      c.bus.emit('settings:changed', {});
    },
  });
  ctx.input.registerHotkey({
    key: '=',
    description: 'Przybliż',
    handler: (_e, c) => {
      const cam = c.renderer.camera;
      cam.zoomAt(1.25, cam.viewW / 2, cam.viewH / 2);
    },
  });
  ctx.input.registerHotkey({
    key: '-',
    description: 'Oddal',
    handler: (_e, c) => {
      const cam = c.renderer.camera;
      cam.zoomAt(0.8, cam.viewW / 2, cam.viewH / 2);
    },
  });
}
