/**
 * logistics module — road/rail network, pathfinding, vehicles, routes, hubs.
 * Owner: logistics agent.
 *
 * Files: network.ts (construction, bridges, bulldoze, upkeep, planning A*),
 * pathfinding.ts (vehicle A* + cache), astar.ts (engine), access.ts (modes,
 * access tiles, catchment, acceptance), cargo.ts (load/unload), vehicles.ts
 * (movement, stops, breakdowns, costs, buy/sell), routes.ts (routes, auto-connect,
 * suggestions), service.ts (ctx.services.logistics), api.ts (read API for
 * render/UI), tools/* (road, rail, bulldoze, route, autoconnect).
 */
import type { GameContext } from '../core/context';
import { SystemOrder } from '../core/sim';
import { chargeInfraUpkeep, neighbor, rebuildRoadConn, updateRoadConn } from './network';
import { onBuildingRemoved } from './routes';
import { dropRuntime, invalidatePaths, rt } from './runtime';
import { createLogisticsService } from './service';
import { createBulldozeTool } from './tools/bulldoze';
import { createNetworkTool } from './tools/networkTool';
import { createAutoConnectTool, createRouteTool } from './tools/routeTool';
import { vehicleDaily, vehicleMonthly, vehicleTick } from './vehicles';

export function init(ctx: GameContext): void {
  ctx.services.logistics = createLogisticsService(ctx);

  ctx.sim.registerSystem('logistics', SystemOrder.logistics, vehicleTick);
  ctx.sim.registerSystem('logistics.daily', SystemOrder.logistics + 1, vehicleDaily, { period: 'day' });
  ctx.sim.registerSystem(
    'logistics.monthly',
    SystemOrder.logistics + 2,
    (state, _dt, c) => {
      vehicleMonthly(state);
      chargeInfraUpkeep(c);
    },
    { period: 'month' },
  );

  // ------------------------------------------------------------ runtime caches
  ctx.bus.on('game:started', ({ state }) => {
    rebuildRoadConn(state);
    rt(ctx);
    invalidatePaths(ctx);
  });
  ctx.bus.on('game:ended', () => dropRuntime(ctx));
  ctx.bus.on('network:changed', ({ kind, tiles }) => {
    const st = ctx.tryState();
    if (!st) return;
    if (kind === 'road') {
      // keep masks correct for roads built by other modules (e.g. city streets)
      const { width: W, height: H } = st.map;
      for (const i of tiles) {
        updateRoadConn(st, i);
        for (let d = 0; d < 4; d++) {
          const j = neighbor(W, H, i, d);
          if (j >= 0) updateRoadConn(st, j);
        }
      }
    }
    invalidatePaths(ctx);
  });
  ctx.bus.on('building:built', () => ctx.hasGame && invalidatePaths(ctx));
  ctx.bus.on('building:completed', () => ctx.hasGame && invalidatePaths(ctx));
  ctx.bus.on('building:changed', () => ctx.hasGame && invalidatePaths(ctx));
  ctx.bus.on('building:removed', ({ buildingId }) => ctx.hasGame && onBuildingRemoved(ctx, buildingId));

  // ------------------------------------------------------------ tools & UI
  ctx.input.registerTool(createNetworkTool(ctx, 'road'));
  ctx.input.registerTool(createNetworkTool(ctx, 'rail'));
  ctx.input.registerTool(createBulldozeTool(ctx));
  ctx.input.registerTool(createRouteTool(ctx));
  ctx.input.registerTool(createAutoConnectTool(ctx));

  const toggleTool = (id: string) => (c: GameContext) => c.input.setTool(c.input.activeToolId === id ? null : id);
  const isTool = (id: string) => (c: GameContext) => c.input.activeToolId === id;
  const buttons: { id: string; icon: string; label: string; tooltip: string; hotkey: string }[] = [
    { id: 'road', icon: '🛣️', label: 'Drogi', tooltip: 'Buduj drogi (przeciągnij). Q zmienia rodzaj, mosty nad wodą automatycznie.', hotkey: 'R' },
    { id: 'rail', icon: '🛤️', label: 'Tory', tooltip: 'Buduj tory kolejowe między stacjami.', hotkey: 'T' },
    { id: 'route', icon: '🧭', label: 'Trasa', tooltip: 'Utwórz trasę: klikaj budynki/stacje po kolei, Enter = gotowe.', hotkey: 'L' },
    { id: 'autoconnect', icon: '🔗', label: 'Auto-połącz', tooltip: 'Kliknij producenta i odbiorcę — droga, trasa i pojazd automatycznie.', hotkey: 'K' },
    { id: 'bulldoze', icon: '🚜', label: 'Rozbiórka', tooltip: 'Usuń drogi/tory (zwrot 25%). Dwuklik na budynku = wyburzenie.', hotkey: 'X' },
  ];
  buttons.forEach((b, k) => {
    ctx.ui.registerToolbarButton({
      id: `logistics-${b.id}`,
      icon: b.icon,
      label: b.label,
      group: 'transport',
      order: k * 10,
      tooltip: b.tooltip,
      hotkey: b.hotkey,
      onClick: toggleTool(b.id),
      isActive: isTool(b.id),
    });
    ctx.input.registerHotkey({ key: b.hotkey.toLowerCase(), description: b.label, handler: (_e, c) => toggleTool(b.id)(c) });
  });
}
