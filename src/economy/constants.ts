/**
 * Economy balance constants. Tweak here (tests in economy/*.test.ts check the
 * first chain stays profitable).
 */

/** Ex-factory (wholesale) value of goods as a fraction of market price — used for per-building value-added stats and valuation. */
export const WHOLESALE = 0.8;

/** Fallback monthly wage per worker by era index (when no city labour pool is available). */
export const BASE_WAGE_BY_ERA = [55, 80, 130, 220, 340] as const;
/** Buildings without any city in commute range still hire this fraction of workers (rural/itinerant labour)… */
export const RURAL_WORKER_SHARE = 0.6;
/** …at this wage premium. */
export const RURAL_WAGE_MULT = 1.2;
/** Extra commute tiles added to city.labour.commuteRadius (measured to the city edge). */
export const COMMUTE_BONUS = 4;

/** Grid electricity price per MW per month (deficit bought, zł). */
export const GRID_PRICE = 60;
/** Surplus electricity sold to the grid per MW per month. */
export const GRID_SELL_PRICE = 30;

/** Free research points per month every company gets (small "engineering office"). */
export const BASE_RESEARCH_POINTS = 10;
/** Research budget: zł per research point. */
export const ZL_PER_RESEARCH_POINT = 40;

/** Upkeep paid by a disabled (switched off) building, as a fraction. */
export const DISABLED_UPKEEP = 0.3;
/** Refund on demolition: finished building / under construction. */
export const DEMOLISH_REFUND = 0.25;
export const DEMOLISH_REFUND_CONSTRUCTION = 0.6;

/** Waste disposal cost per unit (zł) when waste output overflows the buffer. */
export const WASTE_DISPOSAL_COST = 3;

/** Building condition loss per year (ageing). */
export const CONDITION_DECAY_PER_YEAR = 0.02;
/** Repair cost = missing condition × building cost × this. */
export const REPAIR_COST_FACTOR = 0.35;

/** Loans. */
export const LOAN_MIN = 5000;
export const LOAN_TERMS = [12, 24, 36, 60, 120] as const;
/** Credit limit floor & fraction of valuation. */
export const CREDIT_FLOOR = 30000;
export const CREDIT_VALUATION_SHARE = 0.5;

/** Months of negative cash at month close before bankruptcy. */
export const BANKRUPTCY_MONTHS = 3;

/** Corporate tax by difficulty. */
export const TAX_RATE = { easy: 0.15, normal: 0.19, hard: 0.25 } as const;
/** Base annual interest by difficulty. */
export const INTEREST_RATE = { easy: 0.05, normal: 0.07, hard: 0.09 } as const;

/** Export price as a fraction of market price (before volume saturation). */
export const EXPORT_PRICE_SHARE = 0.72;
/** Export price drop per unit exported last month relative to this volume (per product). */
export const EXPORT_SATURATION_UNITS = 2000;

/** Market price response: target multiplier = clamp(PRICE_A − PRICE_B × supply/demand, MIN, MAX). */
export const PRICE_A = 1.15;
export const PRICE_B = 0.25;
export const PRICE_MIN = 0.6;
export const PRICE_MAX = 1.25;
/** Fraction of the gap to the target price closed each month. */
export const PRICE_SMOOTHING = 0.35;

/** Pollution spread radius (tiles around the footprint) and scale. */
export const POLLUTION_RADIUS = 3;
export const POLLUTION_SCALE = 1.2;
