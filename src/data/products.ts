import type { ProductDef } from './defs';

/** PLACEHOLDER product list (grain → flour → bread). The data agent fills ~50 products. */
export const PRODUCTS: ProductDef[] = [
  { id: 'grain', name: 'Zboże', icon: '🌾', category: 'agri', era: 'industrial', basePrice: 4, isRaw: true, weightClass: 'bulk', color: '#e0c060', seasonal: [0.9, 0.9, 1, 1, 1, 1.1, 1.2, 1.2, 1.1, 1, 0.9, 0.9] },
  { id: 'flour', name: 'Mąka', icon: '🥡', category: 'material', era: 'industrial', basePrice: 10, isRaw: false, weightClass: 'normal', color: '#f2ead0' },
  { id: 'bread', name: 'Chleb', icon: '🍞', category: 'food', era: 'industrial', basePrice: 22, isRaw: false, weightClass: 'light', perishableDays: 20, consumption: { poor: 30, middle: 25, rich: 15 }, color: '#c98a3c' },
  { id: 'coal', name: 'Węgiel', icon: '⚫', category: 'raw', era: 'industrial', basePrice: 6, isRaw: true, weightClass: 'bulk', color: '#333333' },
  { id: 'iron_ore', name: 'Ruda żelaza', icon: '🪨', category: 'raw', era: 'industrial', basePrice: 7, isRaw: true, weightClass: 'bulk', color: '#8a4b30' },
];
