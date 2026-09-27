/**
 * LogisticsService implementation (ctx.services.logistics).
 */
import type { GameContext } from '../core/context';
import type { LogisticsService } from '../core/services';
import { buildNetwork, estimatePath, planBetween, removeNetwork } from './network';
import { findTilePath } from './pathfinding';
import { autoConnect, createRoute, isConnected, removeRoute, suggestRoutes, updateRoute } from './routes';
import { assignVehicle, buyVehicle, sellVehicle } from './vehicles';

export function createLogisticsService(ctx: GameContext): LogisticsService {
  return {
    buildNetwork: (companyId, kind, tiles, level) => buildNetwork(ctx, companyId, kind, tiles, level),
    removeNetwork: (companyId, kind, tiles) => removeNetwork(ctx, companyId, kind, tiles),
    estimateNetwork(companyId, kind, tiles, level) {
      const est = estimatePath(ctx, companyId, kind, tiles, level);
      return est.ok
        ? { ok: true, cost: est.cost, newTiles: est.newTiles, bridgeTiles: est.bridgeTiles }
        : { ok: false, reason: est.reason ?? 'Nie można budować' };
    },
    planNetworkPath: (kind, from, to) => planBetween(ctx, kind, [from], [to]),
    findPath: (mode, from, to) => {
      const p = findTilePath(ctx, mode, from, to);
      return p ? p.slice() : null;
    },
    isConnected: (mode, a, b) => isConnected(ctx, mode, a, b),
    createRoute: (companyId, spec) => createRoute(ctx, companyId, spec),
    updateRoute: (routeId, spec) => updateRoute(ctx, routeId, spec),
    removeRoute: (routeId) => removeRoute(ctx, routeId),
    buyVehicle: (companyId, typeId, routeId, opts) => buyVehicle(ctx, companyId, typeId, routeId, opts),
    sellVehicle: (vehicleId) => sellVehicle(ctx, vehicleId),
    assignVehicle: (vehicleId, routeId) => assignVehicle(ctx, vehicleId, routeId),
    autoConnect: (companyId, a, b, mode) => autoConnect(ctx, companyId, a, b, mode),
    suggestRoutes: (companyId, limit) => suggestRoutes(ctx, companyId, limit),
  };
}
