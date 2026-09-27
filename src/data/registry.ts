/**
 * Data registry: holds all definitions, supports lookups and merging mod packs.
 *
 *   import { registry } from '../data/registry';   // or ctx.data
 *   registry.product('bread').basePrice
 *   registry.buildingsIn('factory')
 *   registry.mergeMod(jsonModPack)
 *
 * Defs are treated as immutable at runtime — never mutate them from systems.
 */
import type { BuildingTypeId, DepositTypeId, EraId, ProductId, RecipeId, TechId, TerrainId, VehicleTypeId } from '../core/types';
import { BUILDINGS } from './buildings';
import type {
  BuildingCategory,
  BuildingDef,
  DepositDef,
  EraDef,
  ModPack,
  ProductDef,
  RecipeDef,
  TechDef,
  TerrainDef,
  VehicleDef,
} from './defs';
import { DEPOSITS } from './deposits';
import { ERAS } from './eras';
import { PRODUCTS } from './products';
import { RECIPES } from './recipes';
import { TECHS } from './tech';
import { TERRAIN_DEFS } from './terrain';
import { VEHICLES } from './vehicles';

export interface ModMergeResult {
  added: number;
  replaced: number;
  errors: string[];
}

type DefKind = 'eras' | 'products' | 'recipes' | 'buildings' | 'vehicles' | 'techs' | 'deposits';

export class DataRegistry {
  readonly eras: Record<EraId, EraDef> = {};
  readonly products: Record<ProductId, ProductDef> = {};
  readonly recipes: Record<RecipeId, RecipeDef> = {};
  readonly buildings: Record<BuildingTypeId, BuildingDef> = {};
  readonly vehicles: Record<VehicleTypeId, VehicleDef> = {};
  readonly techs: Record<TechId, TechDef> = {};
  readonly deposits: Record<DepositTypeId, DepositDef> = {};
  readonly terrain: TerrainDef[] = [];
  /** Ids of mod packs merged so far. */
  readonly loadedMods: string[] = [];
  /** Incremented on every change (caches may compare). */
  version = 0;

  // ------------------------------------------------------------ loading
  /** Load a base data set (called by createRegistry). */
  loadBase(pack: Omit<ModPack, 'id' | 'name' | 'version'>, terrain: TerrainDef[]): void {
    this.mergeInto(pack);
    this.terrain.length = 0;
    this.terrain.push(...terrain);
    this.version++;
  }

  /**
   * Merge a mod pack (parsed JSON). Same id = replace, new id = add.
   * Performs light validation; invalid entries are skipped and reported.
   */
  mergeMod(pack: ModPack): ModMergeResult {
    const res: ModMergeResult = { added: 0, replaced: 0, errors: [] };
    if (!pack || typeof pack !== 'object' || typeof pack.id !== 'string') {
      res.errors.push('Nieprawidłowy mod: brak pola "id".');
      return res;
    }
    const r = this.mergeInto(pack);
    res.added = r.added;
    res.replaced = r.replaced;
    res.errors.push(...r.errors);
    if (!this.loadedMods.includes(pack.id)) this.loadedMods.push(pack.id);
    res.errors.push(...this.validate());
    this.version++;
    return res;
  }

  private mergeInto(pack: Partial<ModPack>): ModMergeResult {
    const res: ModMergeResult = { added: 0, replaced: 0, errors: [] };
    const kinds: DefKind[] = ['eras', 'products', 'recipes', 'buildings', 'vehicles', 'techs', 'deposits'];
    for (const kind of kinds) {
      const list = pack[kind] as { id: string }[] | undefined;
      if (!list) continue;
      if (!Array.isArray(list)) {
        res.errors.push(`Pole "${kind}" musi być tablicą.`);
        continue;
      }
      const target = this[kind] as Record<string, unknown>;
      for (const def of list) {
        if (!def || typeof def.id !== 'string' || !def.id) {
          res.errors.push(`Wpis w "${kind}" bez poprawnego id.`);
          continue;
        }
        if (def.id in target) res.replaced++;
        else res.added++;
        target[def.id] = def;
      }
    }
    return res;
  }

  /** Cross-reference validation. Returns human-readable (Polish) problems. */
  validate(): string[] {
    const errs: string[] = [];
    for (const r of Object.values(this.recipes)) {
      for (const io of [...r.inputs, ...r.outputs, ...(r.byproducts ?? [])])
        if (!this.products[io.product]) errs.push(`Receptura "${r.id}": nieznany produkt "${io.product}".`);
    }
    for (const b of Object.values(this.buildings)) {
      for (const rid of b.recipes) if (!this.recipes[rid]) errs.push(`Budynek "${b.id}": nieznana receptura "${rid}".`);
      if (b.requiresDeposit && !this.deposits[b.requiresDeposit]) errs.push(`Budynek "${b.id}": nieznane złoże "${b.requiresDeposit}".`);
      if (!this.eras[b.era]) errs.push(`Budynek "${b.id}": nieznana epoka "${b.era}".`);
    }
    for (const t of Object.values(this.techs)) {
      for (const p of t.prereqs) if (!this.techs[p]) errs.push(`Technologia "${t.id}": nieznany wymóg "${p}".`);
    }
    for (const d of Object.values(this.deposits)) {
      if (!this.products[d.product]) errs.push(`Złoże "${d.id}": nieznany produkt "${d.product}".`);
    }
    return errs;
  }

  // ------------------------------------------------------------ lookups (throw on unknown id)
  product(id: ProductId): ProductDef {
    return must(this.products[id], 'produkt', id);
  }
  recipe(id: RecipeId): RecipeDef {
    return must(this.recipes[id], 'receptura', id);
  }
  building(id: BuildingTypeId): BuildingDef {
    return must(this.buildings[id], 'budynek', id);
  }
  vehicle(id: VehicleTypeId): VehicleDef {
    return must(this.vehicles[id], 'pojazd', id);
  }
  tech(id: TechId): TechDef {
    return must(this.techs[id], 'technologia', id);
  }
  era(id: EraId): EraDef {
    return must(this.eras[id], 'epoka', id);
  }
  deposit(id: DepositTypeId): DepositDef {
    return must(this.deposits[id], 'złoże', id);
  }
  terrainDef(id: TerrainId | number): TerrainDef {
    return must(this.terrain[id], 'teren', String(id));
  }

  // ------------------------------------------------------------ lists
  productList(): ProductDef[] {
    return Object.values(this.products);
  }
  buildingList(): BuildingDef[] {
    return Object.values(this.buildings);
  }
  vehicleList(): VehicleDef[] {
    return Object.values(this.vehicles);
  }
  techList(): TechDef[] {
    return Object.values(this.techs);
  }
  depositList(): DepositDef[] {
    return Object.values(this.deposits);
  }
  /** Eras sorted by index. */
  eraList(): EraDef[] {
    return Object.values(this.eras).sort((a, b) => a.index - b.index);
  }
  buildingsIn(category: BuildingCategory): BuildingDef[] {
    return this.buildingList().filter((b) => b.category === category);
  }
  /** Recipes a building type can run. */
  recipesFor(buildingTypeId: BuildingTypeId): RecipeDef[] {
    return this.building(buildingTypeId).recipes.map((r) => this.recipe(r));
  }
  /** All recipes producing a product (as main output). */
  recipesProducing(productId: ProductId): RecipeDef[] {
    return Object.values(this.recipes).filter((r) => r.outputs.some((o) => o.product === productId));
  }
  /** All building types that can run a recipe. */
  buildingsRunning(recipeId: RecipeId): BuildingDef[] {
    return this.buildingList().filter((b) => b.recipes.includes(recipeId));
  }
  /** Era active for a calendar year (last era whose startYear <= year). */
  eraForYear(year: number): EraDef {
    const list = this.eraList();
    let cur = list[0]!;
    for (const e of list) if (e.startYear <= year) cur = e;
    return cur;
  }
  /** Era index (0..n) of an era id; -1 if unknown. */
  eraIndex(id: EraId): number {
    return this.eras[id]?.index ?? -1;
  }
}

function must<T>(v: T | undefined, what: string, id: string): T {
  if (v === undefined) throw new Error(`Nieznany ${what}: "${id}"`);
  return v;
}

/** Create a registry populated with the base game data. */
export function createRegistry(): DataRegistry {
  const r = new DataRegistry();
  r.loadBase(
      { eras: ERAS, products: PRODUCTS, recipes: RECIPES, buildings: BUILDINGS, vehicles: VEHICLES, techs: TECHS, deposits: DEPOSITS },
      TERRAIN_DEFS,
  );
  return r;
}

/** Global registry instance used by the game (ctx.data points here). */
export const registry: DataRegistry = createRegistry();
