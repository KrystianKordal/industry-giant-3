/**
 * render module init. The Renderer instance itself is created by main.ts
 * (needs the canvas) and exposed as ctx.renderer; here we register layers.
 * Owner: render agent. See docs/CONTRACTS.md → "Renderowanie — API".
 */
import type { GameContext } from '../core/context';
import { createAtmosphereLayers } from './layers/atmosphere';
import { createBuildingsLayer } from './layers/buildings';
import { createLabelLayers } from './layers/labels';
import { createNetworkLayer } from './layers/network';
import { createSelectionLayer } from './layers/selection';
import { createTerrainLayer, terrainCacheRef } from './layers/terrain';
import { createVehiclesLayer } from './layers/vehicles';
import { createWaterLayer } from './layers/water';
import { createOverlayLayer } from './overlays';
import { Renderer } from './renderer';
import type { LayerDef } from './types';

export function init(ctx: GameContext): void {
  if (ctx.headless) return;
  const r = ctx.renderer;
  if (!(r instanceof Renderer)) return;
  const layers: LayerDef[] = [
    createTerrainLayer(ctx),
    createWaterLayer(),
    createNetworkLayer(ctx),
    createBuildingsLayer(ctx, r.fx),
    createVehiclesLayer(ctx, r.fx),
    ...r.fxLayers,
    ...createAtmosphereLayers(ctx),
    createOverlayLayer(r.overlays),
    ...createLabelLayers(ctx),
    createSelectionLayer(ctx),
    perfLayer(r),
  ];
  for (const l of layers) r.registerLayer(l);
  // old placeholder id kept free: houses are part of the terrain chunks now
  r.unregisterLayer('houses');
  // dev: window.ig3render for perf inspection
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).ig3render = { renderer: r, terrain: () => terrainCacheRef };
}

function perfLayer(r: Renderer): LayerDef {
  return {
    id: 'fps',
    z: 1000,
    space: 'screen',
    visible: (rc) => rc.ctx.userSettings.showFps,
    draw({ g, width }) {
      const s = r.stats;
      g.font = '12px ui-monospace, monospace';
      g.textAlign = 'right';
      g.textBaseline = 'alphabetic';
      const lines = [
        `${s.fps} FPS · ${s.frameMs.toFixed(1)} ms`,
        `LOD ${s.chunks.lod} · ${s.chunks.chunks} chunks · ${(s.chunks.pixels / 1e6).toFixed(1)} Mpx`,
        `particles ${r.fx.count}`,
      ];
      g.fillStyle = 'rgba(10,14,20,0.6)';
      g.fillRect(width - 250, 48, 244, lines.length * 15 + 8);
      g.fillStyle = '#9fe870';
      lines.forEach((l, i) => g.fillText(l, width - 12, 64 + i * 15));
    },
  };
}
