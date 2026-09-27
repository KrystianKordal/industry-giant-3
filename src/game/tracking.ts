/**
 * Persistent counters used by objectives, milestones and the tutorial.
 * Stored in state.ext.game (plain data). Fed by bus events.
 */
import type { GameContext } from '../core/context';
import type { CompanyId, GameState, ProductId, TransportMode } from '../core/types';

export interface ObjectiveMeta {
  /** 'supplyCity' with cityId 0: count cities with satisfaction >= threshold. */
  threshold?: number;
  category?: string;
  buildingTypes?: string[];
  mode?: TransportMode;
  /** Only count after the scenario started (default true for counters). */
  custom?: string;
}

export interface GameExt {
  /** Units produced by the player's buildings, per product. */
  produced: Record<ProductId, number>;
  /** Units sold by the player's shops, per product. */
  sold: Record<ProductId, number>;
  /** `${cityId}:${productId}` -> units sold by the player. */
  soldCity: Record<string, number>;
  /** Sales this month per product per company (market share). */
  shareMonth: Record<ProductId, Record<CompanyId, number>>;
  /** Last closed month copy of shareMonth. */
  shareLast: Record<ProductId, Record<CompanyId, number>>;
  /** Units produced by player's recycling buildings. */
  recycled: number;
  /** Units of green products sold by the player. */
  greenSold: number;
  /** Extra objective data by objective id. */
  meta: Record<string, ObjectiveMeta>;
  /** Tutorial marker tile (null = none). */
  tutorialTarget: { x: number; y: number } | null;
  /** Briefing shown (campaign). */
  briefed: boolean;
  /** Total city population when the scenario started. */
  startPopulation: number;
  /** totalDays when the scenario started. */
  startDay: number;
}

export function emptyExt(): GameExt {
  return {
    produced: {},
    sold: {},
    soldCity: {},
    shareMonth: {},
    shareLast: {},
    recycled: 0,
    greenSold: 0,
    meta: {},
    tutorialTarget: null,
    briefed: false,
    startPopulation: 0,
    startDay: 0,
  };
}

/** Objects already checked for missing keys (avoids re-filling on every call). */
const checked = new WeakSet<object>();

/** state.ext.game with defaults filled in (safe for old saves). */
export function gameExt(state: GameState): GameExt {
  const cur = state.ext.game as Record<string, unknown> | undefined;
  if (cur && typeof cur === 'object') {
    if (!checked.has(cur)) {
      const d = emptyExt() as unknown as Record<string, unknown>;
      for (const k of Object.keys(d)) if (!(k in cur)) cur[k] = d[k];
      checked.add(cur);
    }
    return cur as unknown as GameExt;
  }
  const e = emptyExt();
  state.ext.game = e;
  checked.add(e);
  return e;
}

export function installTracking(ctx: GameContext): void {
  ctx.bus.on('building:produced', ({ buildingId, productId, qty }) => {
    const st = ctx.tryState();
    const b = st?.buildings[buildingId];
    if (!st || !b || b.owner !== st.playerCompanyId || !(qty > 0)) return;
    const ext = gameExt(st);
    ext.produced[productId] = (ext.produced[productId] ?? 0) + qty;
    if (ctx.data.buildings[b.typeId]?.category === 'recycling') ext.recycled += qty;
  });
  ctx.bus.on('sale', ({ companyId, cityId, productId, qty }) => {
    const st = ctx.tryState();
    if (!st || !(qty > 0)) return;
    const ext = gameExt(st);
    const share = (ext.shareMonth[productId] ??= {});
    share[companyId] = (share[companyId] ?? 0) + qty;
    if (companyId !== st.playerCompanyId) return;
    ext.sold[productId] = (ext.sold[productId] ?? 0) + qty;
    const key = `${cityId}:${productId}`;
    ext.soldCity[key] = (ext.soldCity[key] ?? 0) + qty;
    if (ctx.data.products[productId]?.green) ext.greenSold += qty;
  });
  ctx.bus.on('time:month', () => {
    const st = ctx.tryState();
    if (!st) return;
    const ext = gameExt(st);
    ext.shareLast = ext.shareMonth;
    ext.shareMonth = {};
  });
}
