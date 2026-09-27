/**
 * Campaign scenarios (5). Each has a story intro, fixed map settings, starting
 * conditions (setup) and objectives. Product ids are given as candidate lists so
 * scenarios survive data changes (fallback objectives otherwise).
 */
import type { GameContext } from '../core/context';
import { cityPopulation } from '../core/entities';
import type { ScenarioInfo } from '../core/services';
import type { GameState, NewGameOptions } from '../core/types';
import { clamp } from '../core/util';
import type { ObjectiveSpec } from './objectives';
import { gameExt } from './tracking';

export interface ScenarioDef {
  id: string;
  name: string;
  icon: string;
  year: number;
  /** 1..5 */
  difficulty: number;
  /** Short description for lists. */
  description: string;
  /** Story intro paragraphs (briefing). */
  intro: string[];
  options: Partial<NewGameOptions>;
  objectives: ObjectiveSpec[];
  /** Starting conditions (runs in the 'scenario' new-game step). */
  setup?(state: GameState, ctx: GameContext): void;
  /** Step-by-step tutorial (scenario 1). */
  tutorial?: boolean;
  victoryText: string;
  defeatText: string;
}

const BUILDING_MATERIALS = ['bricks', 'cement', 'planks', 'glass', 'steel'];

/** Increase city preference (demand multiplier) for products. */
function boostDemand(state: GameState, products: string[], factor: number): void {
  for (const c of Object.values(state.cities)) for (const p of products) c.preferences[p] = (c.preferences[p] ?? 1) * factor;
}

export const SCENARIOS: ScenarioDef[] = [
  // ------------------------------------------------------------------ 1
  {
    id: 'bread',
    name: 'Chleb powszedni',
    icon: '🍞',
    year: 1850,
    difficulty: 1,
    description: 'Samouczek: zbuduj pierwszy łańcuch farma → młyn → piekarnia → sklep.',
    intro: [
      'Rok 1850. Miasteczka w dolinie rosną szybciej niż ich piekarnie. Ludzie stoją w kolejkach po chleb, a Ty masz w kieszeni skromny spadek i głowę pełną pomysłów.',
      'Zbuduj farmę zboża, młyn i piekarnię, a potem otwórz sklep w mieście. Połącz wszystko drogą i wyślij pierwsze wozy. Doradca poprowadzi Cię krok po kroku.',
    ],
    options: { seed: 1850, mapWidth: 96, mapHeight: 96, mapPreset: 'inland', waterLevel: 0.2, cityCount: 4, rivals: 0, startYear: 1850, difficulty: 'easy', disasters: false, politicalEvents: false, resourceAbundance: 1.2, startCash: 150_000 },
    tutorial: true,
    objectives: [
      { id: 'bread_sold', kind: 'deliver', title: 'Sprzedaj 300 szt. towaru: {product}', products: ['bread'], target: 300, reward: 5000, fallback: { kind: 'deliver', title: 'Sprzedaj 300 szt. towarów', target: 300 } },
      { id: 'bread_profit', kind: 'profitMonth', title: 'Osiągnij miesięczny zysk 1 000 zł', target: 1000, reward: 5000 },
      { id: 'bread_city', kind: 'supplyCity', title: 'Zaspokój 50% popytu na {product} w mieście {city}', products: ['bread'], city: 'largest', target: 0.5, optional: true, reward: 10000 },
    ],
    victoryText: 'Miasta mają chleb, a Ty — pierwszą dochodową firmę. To dopiero początek imperium!',
    defeatText: 'Piekarnia zamknięta, wierzyciele pukają do drzwi. Spróbuj jeszcze raz.',
  },
  // ------------------------------------------------------------------ 2
  {
    id: 'rail',
    name: 'Żelazna kolej',
    icon: '🚂',
    year: 1900,
    difficulty: 2,
    description: 'Zbuduj łańcuch stali i uruchom pierwszy pociąg towarowy.',
    intro: [
      'Przełom wieków. Kraj pokrywa się siecią torów, a każda nowa linia potrzebuje stali. Kto opanuje hutnictwo i kolej, ten zbuduje przyszłość.',
      'Uruchom kopalnie węgla i rudy żelaza, zbuduj hutę i przewieź surowce koleją. Uważaj — konkurencyjna firma też ma apetyt na złoża.',
    ],
    options: { seed: 1900, mapWidth: 128, mapHeight: 128, mapPreset: 'continent', waterLevel: 0.3, cityCount: 6, rivals: 1, startYear: 1900, difficulty: 'normal', disasters: false, politicalEvents: true, resourceAbundance: 1.3, startCash: 300_000 },
    objectives: [
      { id: 'steel_produced', kind: 'produce', title: 'Wyprodukuj 500 szt.: {product}', products: ['steel'], target: 500, reward: 20000, fallback: { kind: 'produce', title: 'Wyprodukuj 500 szt. towarów', target: 500 } },
      { id: 'first_train', kind: 'vehicles', title: 'Kup pierwszy pociąg', target: 1, meta: { mode: 'rail' }, reward: 10000 },
      { id: 'tools_sold', kind: 'deliver', title: 'Sprzedaj 400 szt.: {product}', products: ['tools'], target: 400, reward: 20000, fallback: { kind: 'profitMonth', title: 'Osiągnij miesięczny zysk 10 000 zł', target: 10000 } },
      { id: 'rail_value', kind: 'companyValue', title: 'Osiągnij wartość firmy 1 mln zł', target: 1_000_000, deadlineYears: 12 },
    ],
    victoryText: 'Twoje pociągi wożą stal przez cały kraj. Epoka pary należy do Ciebie!',
    defeatText: 'Konkurencja okazała się szybsza. Kolej pojechała bez Ciebie.',
  },
  // ------------------------------------------------------------------ 3
  {
    id: 'rebuild',
    name: 'Powojenna odbudowa',
    icon: '🧱',
    year: 1950,
    difficulty: 3,
    description: 'Zaopatrz zniszczone miasta w materiały budowlane.',
    intro: [
      'Rok 1950. Wojna się skończyła, ale miasta leżą w gruzach. Ludzie wracają do domów, których nie ma, a rząd oferuje kontrakty na odbudowę.',
      'Dostarcz materiały budowlane — cegły, cement, drewno i szkło — do co najmniej trzech miast. Pomóż im odrosnąć, zanim zrobią to rywale.',
    ],
    options: { seed: 1950, mapWidth: 128, mapHeight: 128, mapPreset: 'continent', waterLevel: 0.3, cityCount: 7, rivals: 2, startYear: 1950, difficulty: 'normal', disasters: true, politicalEvents: true, resourceAbundance: 1, startCash: 400_000 },
    setup(state) {
      // War damage: cities shrunk, unhappy, hungry for building materials.
      for (const c of Object.values(state.cities)) {
        c.population.poor = Math.round(c.population.poor * 0.75);
        c.population.middle = Math.round(c.population.middle * 0.6);
        c.population.rich = Math.round(c.population.rich * 0.5);
        c.satisfaction = Math.min(c.satisfaction, 0.25);
        c.growthRate = Math.min(c.growthRate, 0);
      }
      boostDemand(state, BUILDING_MATERIALS, 3);
    },
    objectives: [
      { id: 'rebuild_cities', kind: 'supplyCity', title: 'Zaspokój ≥50% popytu na {product} w 3 miastach', products: ['bricks', 'cement', 'planks'], target: 3, meta: { threshold: 0.5 }, reward: 50000, deadlineYears: 15, fallback: { kind: 'deliver', title: 'Sprzedaj 3 000 szt. towarów', target: 3000 } },
      { id: 'rebuild_materials', kind: 'deliver', title: 'Dostarcz 2 000 szt.: {product}', products: ['cement', 'bricks'], target: 2000, reward: 30000 },
      { id: 'rebuild_growth', kind: 'custom', title: 'Populacja miast wzrośnie o 25%', target: 25, meta: { custom: 'populationGrowth' }, deadlineYears: 20 },
      { id: 'rebuild_glass', kind: 'deliver', title: 'Dostarcz 500 szt.: {product}', products: ['glass'], target: 500, optional: true, reward: 25000 },
    ],
    victoryText: 'Miasta odbudowane, dzieci wróciły do szkół. Twoja firma stała się symbolem nowego początku.',
    defeatText: 'Odbudowa utknęła. Miasta czekają na kogoś, kto dotrzyma słowa.',
  },
  // ------------------------------------------------------------------ 4
  {
    id: 'trade',
    name: 'Globalny handel',
    icon: '🚢',
    year: 1990,
    difficulty: 4,
    description: 'Port, eksport i transport multimodalny w walce z trzema rywalami.',
    intro: [
      'Upadają granice, świat staje się jednym rynkiem. Kontenerowce łączą kontynenty, a firmy z trzech stron mapy walczą o te same porty.',
      'Zbuduj port, eksportuj swoje towary i połącz ciężarówki, pociągi i statki w jedną sieć. Zdobądź przewagę na rynku, zanim zrobią to rywale.',
    ],
    options: { seed: 1990, mapWidth: 160, mapHeight: 160, mapPreset: 'coast', waterLevel: 0.4, cityCount: 9, rivals: 3, startYear: 1990, difficulty: 'normal', disasters: true, politicalEvents: true, resourceAbundance: 1, startCash: 1_000_000 },
    objectives: [
      { id: 'trade_port', kind: 'buildings', title: 'Zbuduj port', target: 1, meta: { mode: 'water' }, reward: 50000 },
      { id: 'trade_export', kind: 'custom', title: 'Zarób 1 mln zł na eksporcie', target: 1_000_000, meta: { custom: 'exportIncome' }, reward: 200000, deadlineYears: 15, fallback: { kind: 'profitMonth', title: 'Osiągnij miesięczny zysk 100 000 zł', target: 100000 } },
      { id: 'trade_share', kind: 'marketShare', title: 'Zdobądź 40% rynku: {product}', products: ['tvs', 'cars', 'appliances'], target: 0.4, reward: 100000 },
      { id: 'trade_value', kind: 'companyValue', title: 'Osiągnij wartość firmy 10 mln zł', target: 10_000_000, deadlineYears: 20 },
      { id: 'trade_rivals', kind: 'custom', title: 'Wyprzedź wszystkich rywali pod względem wartości', target: 3, meta: { custom: 'rivalsBeaten' }, optional: true, reward: 250000 },
    ],
    victoryText: 'Twoje kontenery płyną do każdego portu świata. Globalny rynek mówi Twoim językiem.',
    defeatText: 'Rywale przejęli szlaki handlowe. Twoje statki stoją w porcie.',
  },
  // ------------------------------------------------------------------ 5
  {
    id: 'digital',
    name: 'Era cyfrowa',
    icon: '📱',
    year: 2020,
    difficulty: 5,
    description: 'Smartfony, recykling i zielona reputacja.',
    intro: [
      'Rok 2020. Każdy chce nowego smartfona, ale klienci patrzą też na ślad węglowy. Regulacje zaostrzają się z roku na rok, a surowce są drogie.',
      'Zbuduj łańcuch smartfonów od litu i miedzi po sklep, zamknij obieg dzięki recyklingowi elektrośmieci i zdobądź zieloną reputację.',
    ],
    options: { seed: 2020, mapWidth: 160, mapHeight: 160, mapPreset: 'continent', waterLevel: 0.35, cityCount: 10, rivals: 3, startYear: 2020, difficulty: 'hard', disasters: true, politicalEvents: true, resourceAbundance: 0.9, startCash: 3_000_000 },
    setup(state) {
      state.ecology.awareness = Math.max(state.ecology.awareness, 0.8);
      for (const c of Object.values(state.cities)) c.greenPreference = Math.max(c.greenPreference, 0.6);
    },
    objectives: [
      { id: 'digital_phones', kind: 'deliver', title: 'Sprzedaj 2 000 szt.: {product}', products: ['smartphones'], target: 2000, reward: 500000, fallback: { kind: 'profitMonth', title: 'Osiągnij miesięczny zysk 300 000 zł', target: 300000 } },
      { id: 'digital_recycling', kind: 'custom', title: 'Przetwórz 500 szt. w recyklingu', target: 500, meta: { custom: 'recycled' }, reward: 200000 },
      { id: 'digital_eco', kind: 'ecoRating', title: 'Osiągnij ocenę ekologiczną 75', target: 75, reward: 200000 },
      { id: 'digital_value', kind: 'companyValue', title: 'Osiągnij wartość firmy 50 mln zł', target: 50_000_000, deadlineYears: 20 },
    ],
    victoryText: 'Twoje smartfony są w każdej kieszeni, a elektrośmieci wracają do obiegu. Jesteś Industry Giant!',
    defeatText: 'Rynek cyfrowy nie wybacza. Konkurencja była szybsza i bardziej zielona.',
  },
];

export function scenarioById(id: string | null | undefined): ScenarioDef | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

export function scenarioInfo(s: ScenarioDef): ScenarioInfo {
  return { id: s.id, name: s.name, description: s.description, icon: s.icon, difficulty: s.difficulty, options: { ...s.options, mode: 'campaign', scenarioId: s.id } };
}

/** Record starting population (for growth objectives). */
export function recordStart(state: GameState): void {
  let pop = 0;
  for (const c of Object.values(state.cities)) pop += cityPopulation(c);
  const ext = gameExt(state);
  ext.startPopulation = pop;
  ext.startDay = state.time.totalDays;
}

export const clampDifficulty = (d: number): number => clamp(Math.round(d), 1, 5);
