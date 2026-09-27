/**
 * Building buffers: effective capacity and which products a building takes in
 * or hands out. Logistics/UI/AI may use these (logistics has its own
 * equivalents in logistics/access.ts — keep semantics in sync):
 *  - producers (raw/factory/recycling/energy): unload into `input` (current recipe inputs),
 *    load from `output` (main outputs + byproducts)
 *  - shops: unload into `input` (def.sells ∩ shop.assortment)
 *  - warehouse/station/export: unload into / load from `storage`
 */
import type { GameContext } from '../core/context';
import type { Building, ProductId } from '../core/types';
import type { BuildingDef } from '../data/defs';
import { buildingMod } from './modifiers';

/** Effective per-product capacity (def × upgrades × tech `capacity.<target>`). */
export function buildingCapacity(ctx: GameContext, b: Building, def: BuildingDef = ctx.data.building(b.typeId)): number {
  return Math.round(def.capacity * buildingMod(ctx.state, b, def, 'capacity'));
}

export const isHubDef = (def: BuildingDef): boolean => def.category === 'warehouse' || def.category === 'station' || def.category === 'export';

/** Products the building accepts as deliveries (null = anything, e.g. hubs accepting 'all'). */
export function acceptedProducts(ctx: GameContext, b: Building): ProductId[] | null {
  const def = ctx.data.buildings[b.typeId];
  if (!def) return [];
  if (def.category === 'shop') {
    const sells = def.sells ?? [];
    return b.shop && b.shop.assortment.length ? sells.filter((p) => b.shop!.assortment.includes(p)) : sells;
  }
  if (isHubDef(def)) return b.hub && b.hub.accept !== 'all' ? b.hub.accept : null;
  const r = b.recipeId ? ctx.data.recipes[b.recipeId] : undefined;
  return r ? r.inputs.map((i) => i.product) : [];
}

/** Free room for a delivery of product p (units). */
export function inputSpace(ctx: GameContext, b: Building, p: ProductId): number {
  const def = ctx.data.buildings[b.typeId];
  if (!def || b.constructionProgress < 1) return 0;
  const acc = acceptedProducts(ctx, b);
  if (acc && !acc.includes(p)) return 0;
  const cap = isHubDef(def) ? b.hub?.limits[p] || buildingCapacity(ctx, b, def) : buildingCapacity(ctx, b, def);
  const cur = (isHubDef(def) ? b.storage : b.input)[p]?.qty ?? 0;
  return Math.max(0, cap - cur);
}
