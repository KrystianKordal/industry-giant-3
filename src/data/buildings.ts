import { Terrain, type EraId, type ProductId, type TerrainId } from '../core/types';
import type { BuildingCategory, BuildingDef, BuildingUpgradeDef, ProductCategory } from './defs';
import { PRODUCTS } from './products';
import { LAND_BUILDABLE } from './terrain';

/**
 * All building types.
 *
 * Categories: raw (farms/mines/forestry), factory, shop, warehouse, station,
 * research, recycling, energy, export, hq.
 *
 * Field notes for other modules:
 *  - `capacity`: per-product buffer size (factory input/output, shop stock,
 *    hub/station/export storage). Read the effective value via
 *    economy/stock.ts `buildingCapacity()` (upgrades + tech modifiers).
 *  - stations: `stationMode` (road/rail/water/air), `radius` = catchment in tiles,
 *    `loadRate` = units/day handled (hint for logistics).
 *  - shops: `sells` = authoritative product list, `radius` = customer reach in
 *    tiles (from the shop to the city edge), `salesPerDay` = throughput cap.
 *  - `power`: MW produced (+) / consumed (−) while operating.
 *  - upgrade `effects` keys: efficiency, capacity, workers, sales, research,
 *    emissions, upkeep (multipliers) and quality (value − 1 is added to quality).
 */

// ---------------------------------------------------------------- terrain sets
const FARMLAND: TerrainId[] = [Terrain.Grass, Terrain.Farmland];
const PASTURE: TerrainId[] = [Terrain.Grass, Terrain.Farmland, Terrain.Hills];
const MINING: TerrainId[] = [...LAND_BUILDABLE, Terrain.Mountain, Terrain.Swamp];
const SHOP_TERRAIN: TerrainId[] = [...LAND_BUILDABLE, Terrain.Urban];
const COASTAL: TerrainId[] = [Terrain.Beach, Terrain.Grass, Terrain.Farmland, Terrain.Forest, Terrain.Hills, Terrain.Desert, Terrain.Snow, Terrain.Swamp];

// ---------------------------------------------------------------- shop assortments
const productsIn = (...cats: ProductCategory[]): ProductId[] => PRODUCTS.filter((p) => cats.includes(p.category)).map((p) => p.id);
const without = (list: ProductId[], ...ids: ProductId[]): ProductId[] => list.filter((p) => !ids.includes(p));

const FOOD = productsIn('food');
const CONSUMER = without(productsIn('consumer'), 'cars', 'electric_car');
const LUXURY = productsIn('luxury');
const ELECTRONICS = without(productsIn('electronics'), 'servers');
const HARDWARE: ProductId[] = ['coal', 'planks', 'bricks', 'cement', 'glass', 'tools'];

// ---------------------------------------------------------------- upgrades
function producerUpgrades(cost: number, pollution: number): BuildingUpgradeDef[] {
  const list: BuildingUpgradeDef[] = [
    { id: 'expand', name: 'Rozbudowa', cost: Math.round(cost * 0.6), effects: { efficiency: 1.5, workers: 1.4, capacity: 1.5, upkeep: 1.3 } },
    { id: 'machines', name: 'Modernizacja maszyn', cost: Math.round(cost * 0.5), effects: { efficiency: 1.2, quality: 1.05 }, requiresTech: 'assembly_line' },
  ];
  if (pollution >= 5) list.push({ id: 'filters', name: 'Filtry emisji', cost: Math.round(cost * 0.3), effects: { emissions: 0.5 }, requiresTech: 'environmental_tech' });
  return list;
}
function shopUpgrades(cost: number): BuildingUpgradeDef[] {
  return [
    { id: 'expand', name: 'Powiększenie sklepu', cost: Math.round(cost * 0.8), effects: { sales: 1.5, capacity: 1.5, workers: 1.5 } },
    { id: 'advertising', name: 'Kampania reklamowa', cost: Math.round(cost * 0.5), effects: { sales: 1.25 }, requiresTech: 'marketing' },
  ];
}
function hubUpgrades(cost: number): BuildingUpgradeDef[] {
  return [{ id: 'expand', name: 'Rozbudowa magazynu', cost: Math.round(cost * 0.7), effects: { capacity: 2, workers: 1.5 } }];
}
function labUpgrades(cost: number): BuildingUpgradeDef[] {
  return [{ id: 'expand', name: 'Nowe pracownie', cost: Math.round(cost * 0.7), effects: { research: 1.5, workers: 1.4 } }];
}

// ---------------------------------------------------------------- builders
type Extra = Partial<BuildingDef>;

function def(
  id: string,
  name: string,
  icon: string,
  category: BuildingCategory,
  era: EraId,
  size: [number, number],
  cost: number,
  upkeep: number,
  workers: number,
  extra: Extra,
): BuildingDef {
  const d: BuildingDef = {
    id,
    name,
    icon,
    category,
    era,
    size: { w: size[0], h: size[1] },
    cost,
    upkeep,
    workers,
    allowedTerrain: LAND_BUILDABLE,
    recipes: [],
    pollution: 0,
    capacity: 150,
    buildDays: 10,
    ...extra,
  };
  if (!d.upgrades) {
    if (category === 'raw' || category === 'factory' || category === 'recycling') d.upgrades = producerUpgrades(cost, d.pollution);
    else if (category === 'shop') d.upgrades = shopUpgrades(cost);
    else if (category === 'warehouse' || category === 'station' || category === 'export') d.upgrades = hubUpgrades(cost);
    else if (category === 'research') d.upgrades = labUpgrades(cost);
  }
  return d;
}

const farm = (id: string, name: string, icon: string, era: EraId, cost: number, upkeep: number, workers: number, extra: Extra): BuildingDef =>
  def(id, name, icon, 'raw', era, [3, 3], cost, upkeep, workers, { allowedTerrain: FARMLAND, pollution: 1, capacity: 250, buildDays: 8, tags: ['farm', 'agri'], ...extra });

const mine = (id: string, name: string, icon: string, era: EraId, deposit: string, cost: number, upkeep: number, workers: number, extra: Extra): BuildingDef =>
  def(id, name, icon, 'raw', era, [2, 2], cost, upkeep, workers, { allowedTerrain: MINING, requiresDeposit: deposit, pollution: 5, capacity: 300, buildDays: 12, tags: ['mine'], ...extra });

const factory = (id: string, name: string, icon: string, era: EraId, size: [number, number], cost: number, upkeep: number, workers: number, extra: Extra): BuildingDef =>
  def(id, name, icon, 'factory', era, size, cost, upkeep, workers, { pollution: 2, capacity: 200, buildDays: 10, ...extra });

const shop = (id: string, name: string, icon: string, era: EraId, size: [number, number], cost: number, upkeep: number, workers: number, sells: ProductId[], extra: Extra): BuildingDef =>
  def(id, name, icon, 'shop', era, size, cost, upkeep, workers, { allowedTerrain: SHOP_TERRAIN, sells, radius: 8, capacity: 150, salesPerDay: 12, buildDays: 5, tags: ['retail'], ...extra });

// ============================================================================
export const BUILDINGS: BuildingDef[] = [
  // ======================================================== raw: farms
  farm('farm_grain', 'Farma zboża', '🌾', 'industrial', 6000, 120, 6, { minFertility: 80, recipes: ['grow_grain', 'grow_grain_fert'], color: '#c9b04a', description: 'Uprawia zboże. Plon zależy od żyzności gleby, pory roku i pogody.' }),
  farm('farm_cattle', 'Ranczo bydła', '🐄', 'industrial', 7000, 140, 5, { allowedTerrain: PASTURE, minFertility: 50, recipes: ['raise_cattle'], pollution: 3, color: '#8a6a4a', description: 'Hoduje bydło dla rzeźni. Produkuje odpady organiczne.' }),
  farm('farm_cotton', 'Plantacja bawełny', '☁️', 'industrial', 6000, 120, 6, { minFertility: 100, recipes: ['grow_cotton'], color: '#e8e8e0' }),
  farm('farm_sheep', 'Owczarnia', '🐑', 'industrial', 5000, 100, 4, { allowedTerrain: PASTURE, minFertility: 30, recipes: ['raise_sheep'], color: '#d8d0c0' }),
  farm('farm_dairy', 'Obora', '🥛', 'industrial', 7000, 140, 6, { allowedTerrain: PASTURE, minFertility: 60, recipes: ['milk_cows'], pollution: 2, color: '#f0f0e8' }),
  farm('farm_sugar', 'Plantacja buraków', '🍠', 'industrial', 5000, 110, 5, { minFertility: 90, recipes: ['grow_sugar_beet'], color: '#a05070' }),
  farm('vineyard', 'Winnica', '🍇', 'industrial', 8000, 150, 6, { allowedTerrain: PASTURE, minFertility: 70, recipes: ['grow_grapes'], color: '#7a3a8a' }),
  farm('cocoa_plantation', 'Plantacja kakao', '🫘', 'electric', 12000, 250, 6, { allowedTerrain: [Terrain.Grass, Terrain.Farmland, Terrain.Forest, Terrain.Swamp], minFertility: 120, recipes: ['grow_cocoa'], color: '#6a3a20' }),
  farm('organic_farm', 'Farma ekologiczna', '🥗', 'modern', 30000, 700, 10, { minFertility: 120, recipes: ['grow_organic'], requiresTech: 'environmental_tech', green: true, pollution: 0, tags: ['farm', 'agri', 'green'], color: '#60c060', description: 'Zielone produkty bez nawozów sztucznych. Poprawia ekowizerunek.' }),

  // ======================================================== raw: forestry & mines
  def('forestry', 'Leśniczówka', '🪵', 'raw', 'industrial', [2, 2], 4000, 80, 5, { allowedTerrain: [Terrain.Forest], recipes: ['cut_wood'], pollution: 1, capacity: 250, buildDays: 6, tags: ['forestry'], color: '#5a7a3a', description: 'Pozyskuje drewno. Wydajność zależy od gęstości lasu.' }),
  mine('coal_mine', 'Kopalnia węgla', '⛏️', 'industrial', 'coal', 10000, 200, 10, { recipes: ['mine_coal'], pollution: 6, color: '#444444' }),
  mine('iron_mine', 'Kopalnia rudy żelaza', '⛏️', 'industrial', 'iron', 11000, 230, 12, { recipes: ['mine_iron'], color: '#8a5a3c' }),
  mine('gold_mine', 'Kopalnia złota', '⛏️', 'industrial', 'gold', 15000, 300, 10, { recipes: ['mine_gold'], color: '#c8a030' }),
  mine('clay_pit', 'Glinianka', '🟫', 'industrial', 'clay', 4000, 90, 6, { recipes: ['dig_clay'], pollution: 2, color: '#a86a48' }),
  mine('quarry', 'Kamieniołom', '⛰️', 'industrial', 'stone', 5000, 110, 8, { recipes: ['quarry_stone'], pollution: 4, color: '#9a9a9a' }),
  mine('copper_mine', 'Kopalnia miedzi', '⛏️', 'electric', 'copper', 18000, 300, 10, { recipes: ['mine_copper'], color: '#c07040' }),
  mine('sand_pit', 'Piaskownia', '🏖️', 'electric', 'sand', 8000, 150, 6, { recipes: ['dig_sand'], pollution: 2, color: '#e0cc90' }),
  mine('oil_well', 'Szyb naftowy', '🛢️', 'electric', 'oil', 25000, 500, 8, { recipes: ['pump_oil'], pollution: 8, requiresTech: 'combustion_engine', tags: ['mine', 'oil'], color: '#202020' }),
  mine('lithium_mine', 'Kopalnia litu', '⛏️', 'modern', 'lithium', 60000, 1000, 8, { recipes: ['mine_lithium'], requiresTech: 'lithium_batteries', color: '#c0d0d8' }),

  // ======================================================== factories: food (industrial)
  factory('mill', 'Młyn', '🏭', 'industrial', [2, 2], 8000, 180, 6, { recipes: ['mill_flour'], tags: ['food'], color: '#b9a37a', description: 'Miele zboże na mąkę.' }),
  factory('bakery', 'Piekarnia', '🥖', 'industrial', [2, 2], 7000, 160, 8, { recipes: ['bake_bread', 'bake_bread_cheap', 'bake_bread_milk'], pollution: 1, tags: ['food'], color: '#d08a4a', description: 'Wypieka chleb z mąki (wariant ekonomiczny lub premium z mlekiem).' }),
  factory('brewery', 'Browar', '🍺', 'industrial', [2, 2], 9000, 200, 8, { recipes: ['brew_beer'], tags: ['food'], color: '#c09030' }),
  factory('slaughterhouse', 'Rzeźnia', '🥩', 'industrial', [2, 2], 9000, 200, 10, { recipes: ['slaughter'], pollution: 3, tags: ['food'], color: '#a04040', description: 'Z bydła: mięso i skóra (plus odpady organiczne).' }),
  factory('cheese_dairy', 'Serowarnia', '🧀', 'industrial', [2, 2], 8000, 170, 7, { recipes: ['make_cheese'], tags: ['food'], color: '#e0c040' }),
  factory('sugar_mill', 'Cukrownia', '🍬', 'industrial', [2, 2], 10000, 220, 10, { recipes: ['refine_sugar'], pollution: 3, tags: ['food'], color: '#e8d8e0' }),
  factory('winery', 'Winiarnia', '🍷', 'industrial', [2, 2], 10000, 200, 6, { recipes: ['make_wine'], pollution: 1, tags: ['food', 'luxury'], color: '#8a2040' }),

  // ======================================================== factories: textiles, wood, luxury (industrial)
  factory('textile_mill', 'Tkalnia', '🧵', 'industrial', [2, 2], 10000, 200, 10, { recipes: ['spin_cotton', 'spin_wool'], pollution: 3, tags: ['textile'], color: '#6a8ac0' }),
  factory('tailor', 'Szwalnia', '👕', 'industrial', [2, 2], 8000, 170, 10, { recipes: ['sew_clothes', 'sew_clothes_cheap'], pollution: 1, tags: ['textile'], color: '#5a7ad0' }),
  factory('shoemaker', 'Zakład obuwniczy', '👞', 'industrial', [2, 2], 8000, 170, 8, { recipes: ['make_shoes'], pollution: 1, tags: ['textile'], color: '#6a4020' }),
  factory('sawmill', 'Tartak', '🪚', 'industrial', [2, 2], 7000, 150, 8, { recipes: ['saw_planks'], tags: ['wood'], color: '#c09060' }),
  factory('carpentry', 'Stolarnia', '🪑', 'industrial', [2, 2], 9000, 180, 10, { recipes: ['make_furniture', 'make_furniture_premium', 'make_toys_wood'], pollution: 1, tags: ['wood'], color: '#a07040' }),
  factory('goldsmith', 'Pracownia złotnicza', '💍', 'industrial', [1, 1], 12000, 200, 4, { recipes: ['make_jewelry'], pollution: 0, capacity: 60, tags: ['luxury'], color: '#e0c050' }),

  // ======================================================== factories: heavy industry (industrial)
  factory('brickworks', 'Cegielnia', '🧱', 'industrial', [2, 2], 8000, 170, 10, { recipes: ['make_bricks'], pollution: 6, tags: ['heavy'], color: '#b04a30' }),
  factory('steel_mill', 'Huta stali', '🔥', 'industrial', [3, 3], 25000, 400, 18, { recipes: ['smelt_steel', 'smelt_steel_bessemer'], pollution: 25, capacity: 300, buildDays: 18, tags: ['heavy'], color: '#6a7080', description: 'Ruda żelaza + węgiel → stal. Produkuje żużel i dużo zanieczyszczeń.' }),
  factory('toolworks', 'Kuźnia', '🔨', 'industrial', [2, 2], 10000, 200, 10, { recipes: ['forge_tools'], pollution: 4, tags: ['heavy'], color: '#707880' }),
  factory('cement_plant', 'Cementownia', '⬜', 'industrial', [2, 2], 14000, 220, 8, { recipes: ['make_cement', 'make_cement_slag'], pollution: 12, tags: ['heavy'], color: '#b8b8b0' }),

  // ======================================================== factories: electric era
  factory('paper_mill', 'Papiernia', '📄', 'electric', [2, 2], 15000, 300, 8, { recipes: ['make_paper'], pollution: 6, power: -4, tags: ['wood'], color: '#e0e0d8' }),
  factory('printing_house', 'Drukarnia', '📰', 'electric', [2, 2], 12000, 250, 10, { recipes: ['print_news'], pollution: 1, power: -3, color: '#c0c0b8' }),
  factory('cannery', 'Konserwownia', '🥫', 'electric', [2, 2], 15000, 300, 12, { recipes: ['can_food'], power: -4, requiresTech: 'refrigeration', tags: ['food'], color: '#a0a0b0' }),
  factory('chocolate_factory', 'Fabryka czekolady', '🍫', 'electric', [2, 2], 18000, 350, 12, { recipes: ['make_chocolate', 'make_chocolate_cheap'], pollution: 1, power: -4, tags: ['food', 'luxury'], color: '#5a3020' }),
  factory('copper_smelter', 'Huta miedzi', '🥉', 'electric', [3, 3], 30000, 450, 14, { recipes: ['smelt_copper'], pollution: 20, power: -6, capacity: 300, buildDays: 16, tags: ['heavy'], color: '#c87533' }),
  factory('glassworks', 'Huta szkła', '🪟', 'electric', [2, 2], 20000, 300, 10, { recipes: ['make_glass'], pollution: 10, power: -5, tags: ['heavy'], color: '#a0d8e8' }),
  factory('refinery', 'Rafineria', '🛢️', 'electric', [3, 3], 45000, 700, 14, { recipes: ['refine_oil'], pollution: 30, power: -8, capacity: 400, buildDays: 20, requiresTech: 'refining', tags: ['heavy', 'chemical'], color: '#404850', description: 'Ropa → paliwo + chemikalia.' }),
  factory('chemical_plant', 'Zakłady chemiczne', '🧪', 'electric', [3, 3], 40000, 600, 12, { recipes: ['make_fertilizer', 'make_plastics'], pollution: 18, power: -8, capacity: 300, buildDays: 18, requiresTech: 'chemistry', tags: ['chemical'], color: '#6ac05a' }),

  // ======================================================== factories: mass production
  factory('car_factory', 'Fabryka samochodów', '🚗', 'mass', [4, 3], 120000, 2400, 50, { recipes: ['make_cars'], pollution: 15, power: -20, capacity: 300, buildDays: 25, requiresTech: 'automobiles', tags: ['heavy', 'vehicles'], color: '#c04040' }),
  factory('appliance_factory', 'Fabryka AGD', '🧊', 'mass', [3, 3], 60000, 900, 18, { recipes: ['make_appliances'], pollution: 6, power: -10, requiresTech: 'plastics_tech', color: '#c8d0d8' }),
  factory('toy_factory', 'Fabryka zabawek', '🧸', 'mass', [2, 2], 30000, 600, 16, { recipes: ['make_toys'], pollution: 3, power: -4, requiresTech: 'plastics_tech', color: '#e0a060' }),
  factory('radio_factory', 'Zakłady radiowe', '📻', 'mass', [2, 2], 50000, 900, 20, { recipes: ['make_radios'], pollution: 2, power: -6, requiresTech: 'electronics_basic', tags: ['electronics'], color: '#a06030' }),

  // ======================================================== factories: modern & digital
  factory('food_factory', 'Zakład garmażeryjny', '🍱', 'modern', [2, 2], 60000, 1000, 10, { recipes: ['make_ready_meals'], pollution: 2, power: -6, tags: ['food'], color: '#e08050' }),
  factory('component_factory', 'Fabryka komponentów', '💾', 'modern', [3, 3], 150000, 2400, 16, { recipes: ['make_components'], pollution: 5, power: -20, requiresTech: 'microchips', tags: ['electronics'], color: '#3a8a5a' }),
  factory('battery_factory', 'Fabryka baterii', '🔋', 'modern', [3, 3], 140000, 2200, 14, { recipes: ['make_batteries'], pollution: 8, power: -20, requiresTech: 'lithium_batteries', tags: ['electronics'], color: '#5ac05a' }),
  factory('electronics_plant', 'Zakłady elektroniczne', '💻', 'modern', [3, 3], 160000, 2500, 20, { recipes: ['make_computers', 'make_tvs'], pollution: 4, power: -15, requiresTech: 'microchips', tags: ['electronics'], color: '#7080a0' }),
  factory('smartphone_factory', 'Fabryka smartfonów', '📱', 'digital', [3, 3], 300000, 5000, 40, { recipes: ['make_smartphones'], pollution: 4, power: -25, requiresTech: 'smartphones_tech', tags: ['electronics'], color: '#202830' }),
  factory('server_factory', 'Fabryka serwerów', '🖥️', 'digital', [3, 3], 250000, 4500, 30, { recipes: ['make_servers'], pollution: 4, power: -20, requiresTech: 'cloud_computing', tags: ['electronics'], color: '#405060' }),
  factory('ev_factory', 'Fabryka aut elektrycznych', '🚙', 'digital', [4, 3], 500000, 8000, 60, { recipes: ['make_ev'], pollution: 6, power: -40, capacity: 300, buildDays: 30, requiresTech: 'electric_vehicles', tags: ['vehicles', 'green'], color: '#40c0a0' }),
  factory('data_center', 'Centrum danych', '🌐', 'digital', [3, 3], 350000, 6000, 15, { recipes: ['run_datacenter'], pollution: 2, power: -60, requiresTech: 'cloud_computing', tags: ['digital'], color: '#3060a0', description: 'Serwery → usługi chmurowe sprzedawane bezpośrednio przez internet.' }),
  factory('software_studio', 'Studio programistyczne', '💿', 'digital', [2, 2], 200000, 3000, 30, { recipes: ['develop_software'], pollution: 0, power: -4, tags: ['digital'], color: '#8050c0', description: 'Oprogramowanie sprzedawane online — bez transportu.' }),

  // ======================================================== recycling
  def('compost_plant', 'Kompostownia', '🍂', 'recycling', 'industrial', [2, 2], 5000, 90, 4, { recipes: ['compost'], pollution: 1, capacity: 300, buildDays: 6, green: true, tags: ['recycling'], color: '#6a5a2a', description: 'Odpady organiczne → nawóz. Poprawia ekowizerunek.' }),
  def('recycling_plant', 'Zakład recyklingu', '♻️', 'recycling', 'modern', [3, 3], 50000, 600, 6, { recipes: ['recycle_ewaste', 'recycle_slag', 'recycle_organic'], pollution: 2, power: -8, capacity: 400, buildDays: 15, requiresTech: 'environmental_tech', green: true, tags: ['recycling', 'green'], color: '#40a060', description: 'Elektroodpady → miedź i tworzywa; żużel → cement.' }),

  // ======================================================== energy
  def('coal_power_plant', 'Elektrownia węglowa', '🏭', 'energy', 'electric', [3, 3], 40000, 500, 10, { recipes: ['burn_coal'], power: 60, pollution: 40, capacity: 300, buildDays: 20, requiresTech: 'electrification', tags: ['power'], color: '#505050', description: 'Pali węgiel, dostarcza 60 MW prądu dla twoich zakładów.' }),
  def('oil_power_plant', 'Elektrownia olejowa', '🏭', 'energy', 'mass', [3, 3], 55000, 600, 10, { recipes: ['burn_fuel'], power: 70, pollution: 28, capacity: 300, buildDays: 20, requiresTech: 'diesel_engines', tags: ['power'], color: '#606050' }),
  def('wind_farm', 'Farma wiatrowa', '🌬️', 'energy', 'modern', [3, 3], 45000, 400, 3, { power: 30, pollution: 0, capacity: 0, buildDays: 12, requiresTech: 'renewables', green: true, tags: ['power', 'green'], color: '#e0f0f0', description: 'Zielona energia (zależna od wiatru). Poprawia reputację.' }),
  def('solar_farm', 'Farma słoneczna', '☀️', 'energy', 'modern', [3, 3], 50000, 300, 2, { power: 25, pollution: 0, capacity: 0, buildDays: 10, requiresTech: 'renewables', green: true, tags: ['power', 'green'], color: '#304870', description: 'Zielona energia (więcej latem). Poprawia reputację.' }),

  // ======================================================== research
  def('design_office', 'Biuro konstrukcyjne', '📐', 'research', 'industrial', [2, 2], 12000, 250, 6, { researchPoints: 40, capacity: 0, buildDays: 8, color: '#7a8ab0', description: 'Generuje punkty badań (40/mies.).' }),
  def('research_lab', 'Laboratorium badawcze', '🔬', 'research', 'electric', [3, 3], 40000, 800, 15, { researchPoints: 150, power: -5, capacity: 0, buildDays: 15, color: '#6a9ad0', description: 'Generuje punkty badań (150/mies.).' }),
  def('rnd_center', 'Centrum R&D', '🧬', 'research', 'modern', [3, 3], 150000, 2500, 30, { researchPoints: 500, power: -15, capacity: 0, buildDays: 20, color: '#9a7ae0', description: 'Generuje punkty badań (500/mies.).' }),

  // ======================================================== shops
  shop('shop_food', 'Sklep spożywczy', '🏪', 'industrial', [1, 1], 4000, 100, 3, FOOD, { sellsCategories: ['food'], color: '#4aa0d0', description: 'Sprzedaje żywność mieszkańcom pobliskich miast.' }),
  shop('shop_general', 'Dom handlowy', '🏬', 'industrial', [1, 1], 5000, 120, 3, CONSUMER, { sellsCategories: ['consumer'], color: '#5a8ad0', description: 'Ubrania, buty, meble, narzędzia, gazety, zabawki, AGD.' }),
  shop('shop_hardware', 'Skład budowlany', '🧱', 'industrial', [1, 1], 4500, 110, 3, HARDWARE, { color: '#a08060', description: 'Węgiel na opał, deski, cegły, cement, szkło i narzędzia.' }),
  shop('shop_luxury', 'Salon luksusowy', '💎', 'industrial', [1, 1], 8000, 200, 3, LUXURY, { sellsCategories: ['luxury'], salesPerDay: 6, capacity: 80, color: '#c0a0e0', description: 'Wino, biżuteria, czekolada — dla zamożnych klientów.' }),
  shop('fuel_station', 'Stacja paliw', '⛽', 'mass', [1, 1], 12000, 250, 3, ['fuel'], { radius: 10, salesPerDay: 20, capacity: 300, color: '#d0a020' }),
  shop('car_dealer', 'Salon samochodowy', '🚘', 'mass', [2, 2], 30000, 600, 6, ['cars', 'electric_car'], { radius: 12, salesPerDay: 2, capacity: 40, color: '#c04040' }),
  shop('shop_electronics', 'Sklep RTV', '📺', 'mass', [1, 1], 20000, 400, 4, ELECTRONICS, { sellsCategories: ['electronics'], salesPerDay: 8, capacity: 100, color: '#404860' }),
  shop('supermarket', 'Supermarket', '🛒', 'mass', [2, 2], 40000, 900, 15, [...FOOD, 'clothes', 'shoes', 'toys', 'newspapers', 'tools'], { radius: 14, salesPerDay: 60, capacity: 400, color: '#40a0a0', description: 'Duży zasięg i obroty: żywność i podstawowe artykuły.' }),
  shop('online_store', 'Sklep internetowy', '📦', 'digital', [2, 2], 120000, 2500, 12, [...CONSUMER, ...LUXURY, ...ELECTRONICS], { radius: 45, salesPerDay: 60, capacity: 500, requiresTech: 'cloud_computing', tags: ['retail', 'digital'], color: '#8060e0', description: 'E-commerce: obsługuje miasta w promieniu 45 pól.' }),

  // ======================================================== warehouses, stations, export
  def('warehouse', 'Magazyn', '📦', 'warehouse', 'industrial', [2, 2], 7000, 100, 3, { capacity: 600, loadRate: 200, buildDays: 8, color: '#8a7a6a', description: 'Hub: przechowuje dowolne towary i rozdziela je dalej.' }),
  def('logistics_hub', 'Centrum logistyczne', '🏗️', 'warehouse', 'modern', [3, 3], 60000, 1000, 12, { capacity: 3000, loadRate: 1000, buildDays: 15, requiresTech: 'containerization', color: '#6a7a8a' }),
  def('truck_depot', 'Zajezdnia', '🅿️', 'station', 'industrial', [1, 1], 3000, 60, 2, { stationMode: 'road', capacity: 0, loadRate: 100, radius: 0, buildDays: 4, color: '#607080', description: 'Baza pojazdów drogowych (serwis, postój).' }),
  def('train_station', 'Stacja kolejowa', '🚉', 'station', 'industrial', [3, 1], 12000, 200, 4, { stationMode: 'rail', capacity: 400, loadRate: 400, radius: 4, buildDays: 10, requiresTech: 'railways', color: '#806050', description: 'Obsługuje budynki w promieniu 4 pól.' }),
  def('harbor', 'Port', '⚓', 'station', 'industrial', [2, 2], 20000, 400, 8, { allowedTerrain: COASTAL, requiresWater: true, stationMode: 'water', capacity: 1000, loadRate: 800, radius: 5, buildDays: 15, color: '#305070', description: 'Przeładunek na statki. Musi przylegać do wody.' }),
  def('drone_port', 'Dronoport', '🛸', 'station', 'digital', [1, 1], 40000, 500, 3, { stationMode: 'air', capacity: 200, loadRate: 150, radius: 3, buildDays: 8, requiresTech: 'drones_tech', color: '#a0a0e0' }),
  def('export_center', 'Centrum eksportowe', '🌍', 'export', 'industrial', [2, 2], 15000, 250, 6, { capacity: 800, salesPerDay: 40, loadRate: 300, buildDays: 12, color: '#50a080', description: 'Sprzedaje dowolne towary za granicę po cenie eksportowej.' }),

  // ======================================================== headquarters
  def('headquarters', 'Siedziba firmy', '🏢', 'hq', 'industrial', [2, 2], 20000, 300, 10, { allowedTerrain: SHOP_TERRAIN, researchPoints: 15, capacity: 0, buildDays: 10, color: '#e8b04a', description: 'Jedna na firmę. +reputacja i +15 pkt badań/mies.' }),
];
