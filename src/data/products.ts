import type { ProductDef } from './defs';

/**
 * All products (~60) across 5 eras.
 *
 * Units are abstract "crates". `basePrice` is the reference market price (zł)
 * at priceIndex 1. `consumption` = units per month per 1000 inhabitants of a
 * social class (cities buy these through shops). `seasonal` = 12 monthly
 * multipliers for demand and price (Jan..Dec). `eraDemand` = demand multiplier
 * per era index (0 industrial … 4 digital).
 */

// ---------------------------------------------------------------- seasonal curves
const HARVEST = [1.1, 1.1, 1.1, 1.05, 1, 0.95, 0.9, 0.85, 0.9, 1, 1.05, 1.1];
const HEATING = [1.6, 1.5, 1.2, 0.9, 0.7, 0.6, 0.6, 0.6, 0.8, 1.1, 1.4, 1.6];
const SUMMER = [0.8, 0.8, 0.9, 1, 1.1, 1.25, 1.3, 1.25, 1, 0.9, 0.8, 0.9];
const HOLIDAY = [0.9, 0.9, 0.9, 1, 0.9, 0.9, 0.9, 0.9, 1, 1, 1.2, 1.6];
const BUILDING = [0.7, 0.7, 0.9, 1.1, 1.2, 1.2, 1.2, 1.2, 1.1, 1, 0.9, 0.7];
const FASHION = [1, 0.9, 1, 1.05, 1, 0.95, 0.95, 1, 1.1, 1.05, 1, 1.1];

export const PRODUCTS: ProductDef[] = [
  // ======================================================== raw / agri — industrial
  { id: 'grain', name: 'Zboże', icon: '🌾', category: 'agri', era: 'industrial', basePrice: 10, isRaw: true, weightClass: 'bulk', color: '#e0c060', seasonal: HARVEST, description: 'Podstawa łańcucha spożywczego: mąka, chleb, piwo.' },
  { id: 'cattle', name: 'Bydło', icon: '🐄', category: 'agri', era: 'industrial', basePrice: 30, isRaw: true, weightClass: 'heavy', color: '#8a5a3a', description: 'Z rzeźni: mięso i skóra.' },
  { id: 'cotton', name: 'Bawełna', icon: '☁️', category: 'agri', era: 'industrial', basePrice: 12, isRaw: true, weightClass: 'normal', color: '#f4f4f0', seasonal: HARVEST, description: 'Przędzalnia robi z niej tkaninę.' },
  { id: 'wool', name: 'Wełna', icon: '🐑', category: 'agri', era: 'industrial', basePrice: 15, isRaw: true, weightClass: 'normal', color: '#e8e0cc', description: 'Szlachetniejsza tkanina (wyższa jakość).' },
  { id: 'milk', name: 'Mleko', icon: '🥛', category: 'agri', era: 'industrial', basePrice: 10, isRaw: true, weightClass: 'liquid', perishableDays: 12, color: '#fafaf5', description: 'Sery, czekolada, chleb na mleku.' },
  { id: 'sugar_beet', name: 'Buraki cukrowe', icon: '🍠', category: 'agri', era: 'industrial', basePrice: 6, isRaw: true, weightClass: 'bulk', color: '#b0506a', seasonal: HARVEST },
  { id: 'grapes', name: 'Winogrona', icon: '🍇', category: 'agri', era: 'industrial', basePrice: 12, isRaw: true, weightClass: 'normal', perishableDays: 20, color: '#7a3a8a' },
  { id: 'wood', name: 'Drewno', icon: '🪵', category: 'raw', era: 'industrial', basePrice: 8, isRaw: true, weightClass: 'bulk', color: '#8a6038', description: 'Z lasu. Deski, papier, narzędzia.' },
  { id: 'coal', name: 'Węgiel', icon: '⚫', category: 'raw', era: 'industrial', basePrice: 9, isRaw: true, weightClass: 'bulk', color: '#333333', seasonal: HEATING, consumption: { poor: 15, middle: 12, rich: 8 }, eraDemand: [1, 0.9, 0.5, 0.15, 0.05], description: 'Paliwo hut i elektrowni. Miasta kupują go na opał (zimą więcej).' },
  { id: 'iron_ore', name: 'Ruda żelaza', icon: '🪨', category: 'raw', era: 'industrial', basePrice: 10, isRaw: true, weightClass: 'bulk', color: '#8a4b30' },
  { id: 'gold', name: 'Złoto', icon: '🥇', category: 'raw', era: 'industrial', basePrice: 70, isRaw: true, weightClass: 'light', color: '#e8c030' },
  { id: 'clay', name: 'Glina', icon: '🟫', category: 'raw', era: 'industrial', basePrice: 5, isRaw: true, weightClass: 'bulk', color: '#a86a48' },
  { id: 'stone', name: 'Kamień', icon: '⛰️', category: 'raw', era: 'industrial', basePrice: 6, isRaw: true, weightClass: 'bulk', color: '#9a9a9a' },

  // ======================================================== raw — later eras
  { id: 'cocoa', name: 'Kakao', icon: '🫘', category: 'agri', era: 'electric', basePrice: 20, isRaw: true, weightClass: 'normal', color: '#6a3a20' },
  { id: 'copper_ore', name: 'Ruda miedzi', icon: '🟠', category: 'raw', era: 'electric', basePrice: 14, isRaw: true, weightClass: 'bulk', color: '#c07040' },
  { id: 'sand', name: 'Piasek', icon: '🏖️', category: 'raw', era: 'electric', basePrice: 4, isRaw: true, weightClass: 'bulk', color: '#e0cc90' },
  { id: 'oil', name: 'Ropa naftowa', icon: '🛢️', category: 'raw', era: 'electric', basePrice: 18, isRaw: true, weightClass: 'liquid', color: '#1a1a1a' },
  { id: 'lithium', name: 'Lit', icon: '🔘', category: 'raw', era: 'modern', basePrice: 60, isRaw: true, weightClass: 'normal', color: '#c0d0d8', description: 'Kluczowy do baterii.' },

  // ======================================================== materials
  { id: 'flour', name: 'Mąka', icon: '🥡', category: 'material', era: 'industrial', basePrice: 22, isRaw: false, weightClass: 'normal', color: '#f2ead0' },
  { id: 'leather', name: 'Skóra', icon: '🟤', category: 'material', era: 'industrial', basePrice: 40, isRaw: false, weightClass: 'normal', color: '#8a5030' },
  { id: 'fabric', name: 'Tkanina', icon: '🧵', category: 'material', era: 'industrial', basePrice: 32, isRaw: false, weightClass: 'normal', color: '#6a8ac0' },
  { id: 'planks', name: 'Deski', icon: '🪚', category: 'material', era: 'industrial', basePrice: 18, isRaw: false, weightClass: 'heavy', color: '#c09060', seasonal: BUILDING, consumption: { poor: 4, middle: 5, rich: 5 }, description: 'Meble, zabawki; miasta kupują na budowy.' },
  { id: 'bricks', name: 'Cegły', icon: '🧱', category: 'material', era: 'industrial', basePrice: 13, isRaw: false, weightClass: 'heavy', color: '#b04a30', seasonal: BUILDING, consumption: { poor: 8, middle: 10, rich: 12 }, eraDemand: [1, 1, 0.8, 0.6, 0.5], description: 'Materiał budowlany — rosnące miasta go potrzebują.' },
  { id: 'steel', name: 'Stal', icon: '⛓️', category: 'material', era: 'industrial', basePrice: 60, isRaw: false, weightClass: 'heavy', color: '#7a8a9a' },
  { id: 'sugar', name: 'Cukier', icon: '🍬', category: 'food', era: 'industrial', basePrice: 30, isRaw: false, weightClass: 'normal', color: '#f8f0f0', consumption: { poor: 8, middle: 10, rich: 8 } },
  { id: 'cement', name: 'Cement', icon: '⬜', category: 'material', era: 'industrial', basePrice: 16, isRaw: false, weightClass: 'bulk', color: '#b8b8b0', seasonal: BUILDING, consumption: { poor: 3, middle: 5, rich: 7 }, eraDemand: [0.5, 1, 1.2, 1.2, 1] },
  { id: 'fertilizer', name: 'Nawóz', icon: '🌱', category: 'material', era: 'industrial', basePrice: 20, isRaw: false, weightClass: 'bulk', color: '#6a8a3a', description: 'Farmy z nawozem plonują obficiej.' },
  { id: 'paper', name: 'Papier', icon: '📄', category: 'material', era: 'electric', basePrice: 25, isRaw: false, weightClass: 'normal', color: '#f0f0e8' },
  { id: 'copper', name: 'Miedź', icon: '🥉', category: 'material', era: 'electric', basePrice: 55, isRaw: false, weightClass: 'heavy', color: '#c87533' },
  { id: 'glass', name: 'Szkło', icon: '🪟', category: 'material', era: 'electric', basePrice: 30, isRaw: false, weightClass: 'normal', color: '#a0d8e8', consumption: { poor: 1, middle: 3, rich: 5 }, seasonal: BUILDING },
  { id: 'chemicals', name: 'Chemikalia', icon: '🧪', category: 'material', era: 'electric', basePrice: 45, isRaw: false, weightClass: 'liquid', color: '#8ae07a' },
  { id: 'fuel', name: 'Paliwo', icon: '⛽', category: 'energy', era: 'electric', basePrice: 40, isRaw: false, weightClass: 'liquid', color: '#d0a020', consumption: { poor: 2, middle: 10, rich: 22 }, eraDemand: [0, 0.3, 1, 1.2, 0.9], description: 'Benzyna dla samochodów mieszkańców.' },
  { id: 'plastics', name: 'Tworzywa sztuczne', icon: '🧴', category: 'material', era: 'mass', basePrice: 50, isRaw: false, weightClass: 'normal', color: '#e070b0', requiresTech: 'plastics_tech' },
  { id: 'components', name: 'Komponenty elektroniczne', icon: '💾', category: 'material', era: 'modern', basePrice: 150, isRaw: false, weightClass: 'light', color: '#3a8a5a', requiresTech: 'microchips' },
  { id: 'batteries', name: 'Baterie', icon: '🔋', category: 'material', era: 'modern', basePrice: 170, isRaw: false, weightClass: 'normal', color: '#5ac05a', requiresTech: 'lithium_batteries' },

  // ======================================================== food
  { id: 'bread', name: 'Chleb', icon: '🍞', category: 'food', era: 'industrial', basePrice: 40, isRaw: false, weightClass: 'light', perishableDays: 20, consumption: { poor: 50, middle: 40, rich: 25 }, color: '#c98a3c', description: 'Pierwszy łańcuch: farma → młyn → piekarnia → sklep.' },
  { id: 'meat', name: 'Mięso', icon: '🥩', category: 'food', era: 'industrial', basePrice: 45, isRaw: false, weightClass: 'normal', perishableDays: 15, consumption: { poor: 12, middle: 25, rich: 40 }, color: '#c04040' },
  { id: 'beer', name: 'Piwo', icon: '🍺', category: 'food', era: 'industrial', basePrice: 42, isRaw: false, weightClass: 'liquid', consumption: { poor: 20, middle: 18, rich: 10 }, seasonal: SUMMER, color: '#e0a030' },
  { id: 'cheese', name: 'Ser', icon: '🧀', category: 'food', era: 'industrial', basePrice: 60, isRaw: false, weightClass: 'normal', perishableDays: 40, consumption: { poor: 5, middle: 15, rich: 30 }, color: '#f0d050' },
  { id: 'canned_food', name: 'Konserwy', icon: '🥫', category: 'food', era: 'electric', basePrice: 50, isRaw: false, weightClass: 'normal', consumption: { poor: 15, middle: 10, rich: 3 }, eraDemand: [0, 1, 1, 0.7, 0.5], color: '#a0a0b0' },
  { id: 'ready_meals', name: 'Dania gotowe', icon: '🍱', category: 'food', era: 'modern', basePrice: 60, isRaw: false, weightClass: 'light', perishableDays: 25, consumption: { poor: 10, middle: 25, rich: 20 }, color: '#e08050' },
  { id: 'organic_food', name: 'Żywność ekologiczna', icon: '🥗', category: 'food', era: 'modern', basePrice: 55, isRaw: true, weightClass: 'light', perishableDays: 15, green: true, consumption: { poor: 0, middle: 12, rich: 40 }, color: '#60c060', requiresTech: 'environmental_tech', description: 'Zielony produkt: klienci dbający o środowisko płacą więcej.' },

  // ======================================================== consumer goods
  { id: 'clothes', name: 'Ubrania', icon: '👕', category: 'consumer', era: 'industrial', basePrice: 60, isRaw: false, weightClass: 'light', consumption: { poor: 10, middle: 15, rich: 25 }, seasonal: FASHION, color: '#5a7ad0' },
  { id: 'shoes', name: 'Buty', icon: '👞', category: 'consumer', era: 'industrial', basePrice: 90, isRaw: false, weightClass: 'light', consumption: { poor: 5, middle: 8, rich: 12 }, color: '#6a4020' },
  { id: 'furniture', name: 'Meble', icon: '🪑', category: 'consumer', era: 'industrial', basePrice: 180, isRaw: false, weightClass: 'heavy', consumption: { poor: 2, middle: 5, rich: 10 }, color: '#a07040' },
  { id: 'tools', name: 'Narzędzia', icon: '🔨', category: 'consumer', era: 'industrial', basePrice: 85, isRaw: false, weightClass: 'normal', consumption: { poor: 6, middle: 5, rich: 2 }, color: '#707880' },
  { id: 'newspapers', name: 'Gazety', icon: '📰', category: 'consumer', era: 'electric', basePrice: 20, isRaw: false, weightClass: 'light', perishableDays: 5, consumption: { poor: 8, middle: 15, rich: 15 }, eraDemand: [0, 1, 1, 0.8, 0.3], color: '#d0d0c8' },
  { id: 'toys', name: 'Zabawki', icon: '🧸', category: 'consumer', era: 'mass', basePrice: 80, isRaw: false, weightClass: 'light', consumption: { poor: 3, middle: 8, rich: 12 }, seasonal: HOLIDAY, color: '#e0a060' },
  { id: 'appliances', name: 'AGD', icon: '🧊', category: 'consumer', era: 'mass', basePrice: 260, isRaw: false, weightClass: 'heavy', consumption: { poor: 1, middle: 5, rich: 10 }, color: '#d8e0e8', requiresTech: 'plastics_tech' },
  { id: 'cars', name: 'Samochody', icon: '🚗', category: 'consumer', era: 'mass', basePrice: 2400, isRaw: false, weightClass: 'heavy', consumption: { poor: 0, middle: 1, rich: 5 }, color: '#d04040', requiresTech: 'automobiles' },

  // ======================================================== luxury
  { id: 'wine', name: 'Wino', icon: '🍷', category: 'luxury', era: 'industrial', basePrice: 90, isRaw: false, weightClass: 'liquid', consumption: { poor: 1, middle: 6, rich: 30 }, seasonal: HOLIDAY, color: '#8a2040' },
  { id: 'jewelry', name: 'Biżuteria', icon: '💍', category: 'luxury', era: 'industrial', basePrice: 320, isRaw: false, weightClass: 'light', consumption: { poor: 0, middle: 1, rich: 8 }, seasonal: HOLIDAY, color: '#f0d060' },
  { id: 'chocolate', name: 'Czekolada', icon: '🍫', category: 'luxury', era: 'electric', basePrice: 70, isRaw: false, weightClass: 'light', consumption: { poor: 2, middle: 10, rich: 30 }, seasonal: HOLIDAY, color: '#5a3020' },

  // ======================================================== electronics
  { id: 'radios', name: 'Radioodbiorniki', icon: '📻', category: 'electronics', era: 'mass', basePrice: 200, isRaw: false, weightClass: 'light', consumption: { poor: 2, middle: 5, rich: 6 }, eraDemand: [0, 0, 1, 0.6, 0.2], color: '#a06030', requiresTech: 'electronics_basic' },
  { id: 'tvs', name: 'Telewizory', icon: '📺', category: 'electronics', era: 'modern', basePrice: 500, isRaw: false, weightClass: 'normal', consumption: { poor: 2, middle: 5, rich: 8 }, color: '#303848', requiresTech: 'microchips' },
  { id: 'computers', name: 'Komputery', icon: '💻', category: 'electronics', era: 'modern', basePrice: 900, isRaw: false, weightClass: 'normal', consumption: { poor: 1, middle: 5, rich: 10 }, color: '#8090a0', requiresTech: 'microchips' },
  { id: 'smartphones', name: 'Smartfony', icon: '📱', category: 'electronics', era: 'digital', basePrice: 650, isRaw: false, weightClass: 'light', consumption: { poor: 5, middle: 10, rich: 15 }, color: '#202830', requiresTech: 'smartphones_tech' },
  { id: 'servers', name: 'Serwery', icon: '🖥️', category: 'electronics', era: 'digital', basePrice: 1600, isRaw: false, weightClass: 'normal', color: '#405060', requiresTech: 'cloud_computing' },
  { id: 'electric_car', name: 'Samochody elektryczne', icon: '🚙', category: 'consumer', era: 'digital', basePrice: 6000, isRaw: false, weightClass: 'heavy', green: true, consumption: { poor: 0, middle: 0.6, rich: 4 }, color: '#40c0a0', requiresTech: 'electric_vehicles' },

  // ======================================================== digital (sold directly online, no transport)
  { id: 'cloud_services', name: 'Usługi chmurowe', icon: '🌐', category: 'digital', era: 'digital', basePrice: 90, isRaw: false, weightClass: 'light', consumption: { poor: 5, middle: 20, rich: 40 }, color: '#60a0f0', requiresTech: 'cloud_computing', description: 'Produkt cyfrowy — sprzedawany bezpośrednio przez sieć.' },
  { id: 'software', name: 'Oprogramowanie', icon: '💿', category: 'digital', era: 'digital', basePrice: 400, isRaw: false, weightClass: 'light', consumption: { poor: 1, middle: 5, rich: 12 }, color: '#a060f0', description: 'Produkt cyfrowy — sprzedawany bezpośrednio przez sieć.' },

  // ======================================================== byproducts / waste
  { id: 'slag', name: 'Żużel', icon: '⬛', category: 'waste', era: 'industrial', basePrice: 1, isRaw: false, isWaste: true, weightClass: 'bulk', color: '#404040', description: 'Odpad hutniczy. Cementownia może go przetworzyć.' },
  { id: 'organic_waste', name: 'Odpady organiczne', icon: '🍂', category: 'waste', era: 'industrial', basePrice: 1, isRaw: false, isWaste: true, weightClass: 'bulk', color: '#6a5a2a', description: 'Kompostownia zamienia je w nawóz.' },
  { id: 'e_waste', name: 'Elektroodpady', icon: '🗑️', category: 'waste', era: 'modern', basePrice: 5, isRaw: false, isWaste: true, weightClass: 'normal', color: '#506050', description: 'Zakład recyklingu odzyskuje z nich miedź i tworzywa.' },
];
