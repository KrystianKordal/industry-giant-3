import type { RecipeDef } from './defs';

/** PLACEHOLDER recipes. Raw buildings use recipes with no inputs. */
export const RECIPES: RecipeDef[] = [
  { id: 'grow_grain', name: 'Uprawa zboża', inputs: [], outputs: [{ product: 'grain', qty: 10 }], days: 10, qualityModifier: 0 },
  { id: 'mill_flour', name: 'Mielenie mąki', inputs: [{ product: 'grain', qty: 10 }], outputs: [{ product: 'flour', qty: 8 }], days: 5, qualityModifier: 0 },
  { id: 'bake_bread', name: 'Wypiek chleba', inputs: [{ product: 'flour', qty: 4 }], outputs: [{ product: 'bread', qty: 6 }], days: 3, qualityModifier: 0.05 },
  { id: 'bake_bread_cheap', name: 'Chleb ekonomiczny', inputs: [{ product: 'flour', qty: 3 }], outputs: [{ product: 'bread', qty: 6 }], days: 3, qualityModifier: -0.15, alternative: true },
  { id: 'mine_coal', name: 'Wydobycie węgla', inputs: [], outputs: [{ product: 'coal', qty: 12 }], days: 6, qualityModifier: 0 },
];
