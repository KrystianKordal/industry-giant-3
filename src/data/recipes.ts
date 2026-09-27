import type { RecipeDef, RecipeIO } from './defs';

/**
 * Recipes. Raw buildings use recipes with no inputs. One cycle takes `days`
 * game days at efficiency 1; inputs are consumed when the cycle completes.
 * Output quality = avg input quality (raw: deposit/soil quality) + qualityModifier.
 * `alternative: true` marks a cheaper or premium variant of the standard recipe.
 * Recipes with empty outputs are used by power plants (fuel → electricity).
 */
const io = (product: string, qty: number): RecipeIO => ({ product, qty });

export const RECIPES: RecipeDef[] = [
  // ======================================================== raw: agriculture
  { id: 'grow_grain', name: 'Uprawa zboża', inputs: [], outputs: [io('grain', 50)], days: 10, qualityModifier: 0 },
  { id: 'grow_grain_fert', name: 'Zboże z nawozem', inputs: [io('fertilizer', 8)], outputs: [io('grain', 75)], days: 10, qualityModifier: 0.05, alternative: true, description: 'Nawóz: +50% plonu i lepsza jakość.' },
  { id: 'raise_cattle', name: 'Hodowla bydła', inputs: [], outputs: [io('cattle', 20)], byproducts: [io('organic_waste', 6)], days: 15, qualityModifier: 0 },
  { id: 'grow_cotton', name: 'Uprawa bawełny', inputs: [], outputs: [io('cotton', 45)], days: 12, qualityModifier: 0 },
  { id: 'raise_sheep', name: 'Hodowla owiec', inputs: [], outputs: [io('wool', 30)], days: 10, qualityModifier: 0.05 },
  { id: 'milk_cows', name: 'Dojenie krów', inputs: [], outputs: [io('milk', 40)], byproducts: [io('organic_waste', 4)], days: 6, qualityModifier: 0 },
  { id: 'grow_sugar_beet', name: 'Uprawa buraków', inputs: [], outputs: [io('sugar_beet', 80)], days: 12, qualityModifier: 0 },
  { id: 'grow_grapes', name: 'Uprawa winorośli', inputs: [], outputs: [io('grapes', 40)], days: 10, qualityModifier: 0.05 },
  { id: 'grow_cocoa', name: 'Uprawa kakao', inputs: [], outputs: [io('cocoa', 30)], days: 12, qualityModifier: 0 },
  { id: 'grow_organic', name: 'Uprawa ekologiczna', inputs: [], outputs: [io('organic_food', 30)], byproducts: [io('organic_waste', 3)], days: 10, qualityModifier: 0.15, requiresTech: 'environmental_tech' },

  // ======================================================== raw: extraction
  { id: 'cut_wood', name: 'Wyrąb drewna', inputs: [], outputs: [io('wood', 40)], days: 8, qualityModifier: 0 },
  { id: 'mine_coal', name: 'Wydobycie węgla', inputs: [], outputs: [io('coal', 40)], days: 6, qualityModifier: 0 },
  { id: 'mine_iron', name: 'Wydobycie rudy żelaza', inputs: [], outputs: [io('iron_ore', 36)], days: 6, qualityModifier: 0 },
  { id: 'mine_copper', name: 'Wydobycie rudy miedzi', inputs: [], outputs: [io('copper_ore', 36)], days: 6, qualityModifier: 0 },
  { id: 'mine_gold', name: 'Wydobycie złota', inputs: [], outputs: [io('gold', 8)], days: 10, qualityModifier: 0 },
  { id: 'dig_clay', name: 'Wydobycie gliny', inputs: [], outputs: [io('clay', 60)], days: 6, qualityModifier: 0 },
  { id: 'quarry_stone', name: 'Wydobycie kamienia', inputs: [], outputs: [io('stone', 50)], days: 6, qualityModifier: 0 },
  { id: 'dig_sand', name: 'Wydobycie piasku', inputs: [], outputs: [io('sand', 60)], days: 6, qualityModifier: 0 },
  { id: 'pump_oil', name: 'Wydobycie ropy', inputs: [], outputs: [io('oil', 40)], days: 5, qualityModifier: 0 },
  { id: 'mine_lithium', name: 'Wydobycie litu', inputs: [], outputs: [io('lithium', 24)], days: 8, qualityModifier: 0 },

  // ======================================================== food processing
  { id: 'mill_flour', name: 'Mielenie mąki', inputs: [io('grain', 20)], outputs: [io('flour', 16)], days: 4, qualityModifier: 0 },
  { id: 'bake_bread', name: 'Wypiek chleba', inputs: [io('flour', 8)], outputs: [io('bread', 12)], days: 2, qualityModifier: 0.05 },
  { id: 'bake_bread_cheap', name: 'Chleb ekonomiczny', inputs: [io('flour', 6)], outputs: [io('bread', 12)], days: 2, qualityModifier: -0.15, alternative: true, description: 'Mniej mąki na bochenek — taniej, ale gorsza jakość.' },
  { id: 'bake_bread_milk', name: 'Chleb na mleku', inputs: [io('flour', 8), io('milk', 4)], outputs: [io('bread', 12)], days: 2, qualityModifier: 0.2, alternative: true, description: 'Premium: wyższa jakość i cena.' },
  { id: 'brew_beer', name: 'Warzenie piwa', inputs: [io('grain', 20)], outputs: [io('beer', 14)], byproducts: [io('organic_waste', 3)], days: 5, qualityModifier: 0.05 },
  { id: 'slaughter', name: 'Ubój bydła', inputs: [io('cattle', 10)], outputs: [io('meat', 12), io('leather', 6)], byproducts: [io('organic_waste', 4)], days: 5, qualityModifier: 0 },
  { id: 'make_cheese', name: 'Wyrób sera', inputs: [io('milk', 20)], outputs: [io('cheese', 8)], days: 4, qualityModifier: 0.05 },
  { id: 'refine_sugar', name: 'Produkcja cukru', inputs: [io('sugar_beet', 30)], outputs: [io('sugar', 12)], byproducts: [io('organic_waste', 6)], days: 5, qualityModifier: 0 },
  { id: 'make_wine', name: 'Produkcja wina', inputs: [io('grapes', 20)], outputs: [io('wine', 12)], days: 10, qualityModifier: 0.1 },
  { id: 'can_food', name: 'Puszkowanie mięsa', inputs: [io('meat', 10), io('steel', 2)], outputs: [io('canned_food', 16)], days: 4, qualityModifier: 0 },
  { id: 'make_chocolate', name: 'Czekolada mleczna', inputs: [io('cocoa', 10), io('milk', 6), io('sugar', 4)], outputs: [io('chocolate', 14)], days: 4, qualityModifier: 0.1 },
  { id: 'make_chocolate_cheap', name: 'Wyrób czekoladopodobny', inputs: [io('cocoa', 6), io('sugar', 6)], outputs: [io('chocolate', 12)], days: 4, qualityModifier: -0.2, alternative: true, description: 'Mniej kakao, więcej cukru — tanio, ale klienci to czują.' },
  { id: 'make_ready_meals', name: 'Dania gotowe', inputs: [io('meat', 6), io('flour', 6), io('plastics', 2)], outputs: [io('ready_meals', 20)], byproducts: [io('organic_waste', 2)], days: 2, qualityModifier: 0 },

  // ======================================================== textiles & wood
  { id: 'spin_cotton', name: 'Tkanie bawełny', inputs: [io('cotton', 15)], outputs: [io('fabric', 12)], days: 4, qualityModifier: 0 },
  { id: 'spin_wool', name: 'Tkanie wełny', inputs: [io('wool', 15)], outputs: [io('fabric', 10)], days: 4, qualityModifier: 0.15, alternative: true, description: 'Wełniana tkanina — lepsza jakość.' },
  { id: 'sew_clothes', name: 'Szycie ubrań', inputs: [io('fabric', 8)], outputs: [io('clothes', 8)], days: 3, qualityModifier: 0.05 },
  { id: 'sew_clothes_cheap', name: 'Odzież masowa', inputs: [io('fabric', 6)], outputs: [io('clothes', 8)], days: 3, qualityModifier: -0.15, alternative: true },
  { id: 'make_shoes', name: 'Szycie butów', inputs: [io('leather', 6)], outputs: [io('shoes', 6)], days: 3, qualityModifier: 0.05 },
  { id: 'saw_planks', name: 'Cięcie desek', inputs: [io('wood', 20)], outputs: [io('planks', 16)], days: 4, qualityModifier: 0 },
  { id: 'make_furniture', name: 'Meble drewniane', inputs: [io('planks', 12)], outputs: [io('furniture', 4)], days: 4, qualityModifier: 0 },
  { id: 'make_furniture_premium', name: 'Meble tapicerowane', inputs: [io('planks', 12), io('fabric', 4)], outputs: [io('furniture', 4)], days: 4, qualityModifier: 0.25, alternative: true, description: 'Premium: wyższa jakość, wyższa cena.' },
  { id: 'make_paper', name: 'Produkcja papieru', inputs: [io('wood', 20)], outputs: [io('paper', 16)], days: 4, qualityModifier: 0 },
  { id: 'print_news', name: 'Druk gazet', inputs: [io('paper', 8)], outputs: [io('newspapers', 24)], days: 2, qualityModifier: 0 },
  { id: 'make_toys_wood', name: 'Zabawki drewniane', inputs: [io('planks', 8)], outputs: [io('toys', 8)], days: 3, qualityModifier: 0.1, alternative: true },
  { id: 'make_toys', name: 'Zabawki z tworzyw', inputs: [io('plastics', 6)], outputs: [io('toys', 12)], days: 3, qualityModifier: 0 },

  // ======================================================== heavy industry & building materials
  { id: 'make_bricks', name: 'Wypalanie cegieł', inputs: [io('clay', 25), io('coal', 5)], outputs: [io('bricks', 30)], days: 5, qualityModifier: 0 },
  { id: 'smelt_steel', name: 'Wytop stali', inputs: [io('iron_ore', 20), io('coal', 10)], outputs: [io('steel', 12)], byproducts: [io('slag', 6)], days: 5, qualityModifier: 0 },
  { id: 'smelt_steel_bessemer', name: 'Stal Bessemera', inputs: [io('iron_ore', 20), io('coal', 6)], outputs: [io('steel', 15)], byproducts: [io('slag', 5)], days: 4, qualityModifier: 0.1, alternative: true, requiresTech: 'bessemer_process', description: 'Mniej węgla, więcej i lepszej stali.' },
  { id: 'forge_tools', name: 'Kucie narzędzi', inputs: [io('steel', 6), io('wood', 4)], outputs: [io('tools', 8)], days: 4, qualityModifier: 0 },
  { id: 'make_jewelry', name: 'Wyrób biżuterii', inputs: [io('gold', 3)], outputs: [io('jewelry', 3)], days: 5, qualityModifier: 0.1 },
  { id: 'make_cement', name: 'Produkcja cementu', inputs: [io('stone', 20), io('coal', 5)], outputs: [io('cement', 24)], days: 5, qualityModifier: 0 },
  { id: 'make_cement_slag', name: 'Cement z żużla', inputs: [io('slag', 15), io('stone', 10)], outputs: [io('cement', 20)], days: 5, qualityModifier: -0.05, alternative: true, description: 'Recykling odpadu hutniczego.' },
  { id: 'smelt_copper', name: 'Wytop miedzi', inputs: [io('copper_ore', 20), io('coal', 6)], outputs: [io('copper', 12)], byproducts: [io('slag', 4)], days: 4, qualityModifier: 0 },
  { id: 'make_glass', name: 'Wytop szkła', inputs: [io('sand', 20), io('coal', 6)], outputs: [io('glass', 15)], days: 4, qualityModifier: 0 },

  // ======================================================== oil & chemistry
  { id: 'refine_oil', name: 'Rafinacja ropy', inputs: [io('oil', 30)], outputs: [io('fuel', 20), io('chemicals', 10)], days: 4, qualityModifier: 0 },
  { id: 'make_plastics', name: 'Synteza tworzyw', inputs: [io('chemicals', 8), io('oil', 10)], outputs: [io('plastics', 18)], days: 3, qualityModifier: 0, requiresTech: 'plastics_tech' },
  { id: 'make_fertilizer', name: 'Nawozy sztuczne', inputs: [io('chemicals', 6)], outputs: [io('fertilizer', 30)], days: 3, qualityModifier: 0.05 },
  { id: 'compost', name: 'Kompostowanie', inputs: [io('organic_waste', 20)], outputs: [io('fertilizer', 10)], days: 6, qualityModifier: -0.05 },

  // ======================================================== mass-era manufacturing
  { id: 'make_cars', name: 'Montaż samochodów', inputs: [io('steel', 12), io('glass', 4), io('plastics', 4)], outputs: [io('cars', 2)], days: 5, qualityModifier: 0 },
  { id: 'make_appliances', name: 'Produkcja AGD', inputs: [io('steel', 6), io('copper', 4), io('plastics', 4)], outputs: [io('appliances', 8)], days: 5, qualityModifier: 0 },
  { id: 'make_radios', name: 'Montaż radioodbiorników', inputs: [io('copper', 4), io('plastics', 4)], outputs: [io('radios', 8)], days: 4, qualityModifier: 0 },

  // ======================================================== electronics (modern / digital)
  { id: 'make_components', name: 'Produkcja komponentów', inputs: [io('copper', 6), io('plastics', 4), io('sand', 6)], outputs: [io('components', 14)], days: 2, qualityModifier: 0 },
  { id: 'make_batteries', name: 'Produkcja baterii', inputs: [io('lithium', 8), io('copper', 4)], outputs: [io('batteries', 12)], days: 2, qualityModifier: 0 },
  { id: 'make_computers', name: 'Montaż komputerów', inputs: [io('components', 8), io('plastics', 4), io('glass', 3)], outputs: [io('computers', 4)], byproducts: [io('e_waste', 1)], days: 3, qualityModifier: 0 },
  { id: 'make_tvs', name: 'Montaż telewizorów', inputs: [io('components', 5), io('glass', 5), io('plastics', 4)], outputs: [io('tvs', 5)], byproducts: [io('e_waste', 1)], days: 3, qualityModifier: 0 },
  { id: 'make_smartphones', name: 'Montaż smartfonów', inputs: [io('components', 6), io('batteries', 4), io('glass', 2)], outputs: [io('smartphones', 10)], byproducts: [io('e_waste', 1)], days: 3, qualityModifier: 0.05 },
  { id: 'make_servers', name: 'Montaż serwerów', inputs: [io('components', 10), io('steel', 4)], outputs: [io('servers', 4)], byproducts: [io('e_waste', 1)], days: 4, qualityModifier: 0 },
  { id: 'make_ev', name: 'Montaż aut elektrycznych', inputs: [io('steel', 10), io('batteries', 12), io('components', 6), io('glass', 4)], outputs: [io('electric_car', 2)], days: 4, qualityModifier: 0.05 },
  { id: 'run_datacenter', name: 'Hosting w chmurze', inputs: [io('servers', 1)], outputs: [io('cloud_services', 80)], days: 6, qualityModifier: 0.05 },
  { id: 'develop_software', name: 'Tworzenie oprogramowania', inputs: [], outputs: [io('software', 16)], days: 8, qualityModifier: 0.1 },

  // ======================================================== recycling
  { id: 'recycle_ewaste', name: 'Recykling elektroodpadów', inputs: [io('e_waste', 10)], outputs: [io('copper', 6), io('plastics', 6)], days: 3, qualityModifier: -0.05 },
  { id: 'recycle_slag', name: 'Przeróbka żużla', inputs: [io('slag', 20)], outputs: [io('cement', 14)], days: 3, qualityModifier: -0.05 },
  { id: 'recycle_organic', name: 'Biokompost', inputs: [io('organic_waste', 20)], outputs: [io('fertilizer', 14)], days: 3, qualityModifier: 0 },

  // ======================================================== power (no product outputs; building produces power while running)
  { id: 'burn_coal', name: 'Spalanie węgla', inputs: [io('coal', 20)], outputs: [], days: 5, qualityModifier: 0 },
  { id: 'burn_fuel', name: 'Spalanie paliwa', inputs: [io('fuel', 8)], outputs: [], days: 5, qualityModifier: 0 },
];
