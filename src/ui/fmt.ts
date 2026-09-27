/**
 * UI text helpers: Polish labels for enums, product/building labels,
 * lock reasons, recipe summaries. Defensive: unknown ids never throw.
 */
import type { GameContext } from '../core/context';
import { formatNumber } from '../core/format';
import type {
  BuildingStatus,
  CityTier,
  FinanceCategory,
  GameState,
  SocialClass,
  Stock,
  TransportMode,
  VehicleStatus,
} from '../core/types';
import type { BuildingCategory, BuildingDef, ProductDef, RecipeDef } from '../data/defs';

export const BUILDING_STATUS: Record<BuildingStatus, { label: string; tone: 'pos' | 'warn' | 'neg' | 'dim'; icon: string }> = {
  ok: { label: 'Pracuje', tone: 'pos', icon: '●' },
  construction: { label: 'W budowie', tone: 'dim', icon: '🏗️' },
  disabled: { label: 'Wyłączony', tone: 'dim', icon: '⏻' },
  noInput: { label: 'Brak surowców', tone: 'neg', icon: '⚠' },
  outputFull: { label: 'Magazyn pełny', tone: 'warn', icon: '📦' },
  noWorkers: { label: 'Brak pracowników', tone: 'neg', icon: '👷' },
  noDeposit: { label: 'Brak złoża', tone: 'neg', icon: '⛏️' },
  noCustomers: { label: 'Brak klientów', tone: 'warn', icon: '🛒' },
  noPower: { label: 'Brak prądu', tone: 'neg', icon: '⚡' },
  damaged: { label: 'Uszkodzony', tone: 'neg', icon: '💥' },
  noPermit: { label: 'Brak pozwolenia', tone: 'neg', icon: '📜' },
};

export const VEHICLE_STATUS: Record<VehicleStatus, string> = {
  idle: 'Bezczynny',
  moving: 'W drodze',
  loading: 'Załadunek',
  unloading: 'Rozładunek',
  waiting: 'Czeka',
  noPath: 'Brak drogi!',
  broken: 'Awaria',
  depot: 'W zajezdni',
  stopped: 'Zatrzymany',
};

export const MODE_LABEL: Record<TransportMode, string> = { road: 'Drogowy', rail: 'Kolejowy', water: 'Wodny', air: 'Powietrzny' };
export const MODE_ICON: Record<TransportMode, string> = { road: '🚚', rail: '🚂', water: '🚢', air: '✈️' };

export const CLASS_LABEL: Record<SocialClass, string> = { poor: 'Robotnicy', middle: 'Klasa średnia', rich: 'Zamożni' };
export const TIER_LABEL: Record<CityTier, string> = { village: 'Wieś', town: 'Miasteczko', city: 'Miasto', metropolis: 'Metropolia' };

export const CATEGORY_LABEL: Record<BuildingCategory, string> = {
  raw: 'Surowce',
  factory: 'Fabryki',
  shop: 'Sklepy',
  warehouse: 'Magazyny',
  station: 'Stacje',
  research: 'Badania',
  recycling: 'Recykling',
  energy: 'Energia',
  export: 'Eksport',
  hq: 'Siedziba',
};

export const FINANCE_LABEL: Record<FinanceCategory, string> = {
  sales: 'Sprzedaż w sklepach',
  trade: 'Handel',
  export: 'Eksport',
  subsidy: 'Dotacje',
  assetSale: 'Sprzedaż majątku',
  loanIn: 'Kredyty (wpływ)',
  otherIncome: 'Inne przychody',
  construction: 'Budowa',
  demolition: 'Rozbiórki',
  vehiclePurchase: 'Zakup pojazdów',
  buildingUpkeep: 'Utrzymanie budynków',
  vehicleUpkeep: 'Utrzymanie pojazdów',
  infraUpkeep: 'Utrzymanie infrastruktury',
  wages: 'Płace',
  purchases: 'Zakupy towarów',
  energy: 'Energia',
  research: 'Badania',
  interest: 'Odsetki',
  loanRepayment: 'Spłata kredytów',
  taxes: 'Podatki',
  emissionTax: 'Podatek emisyjny',
  fines: 'Kary',
  disaster: 'Katastrofy',
  otherExpense: 'Inne koszty',
};

export const PRODUCT_CATEGORY_LABEL: Record<string, string> = {
  raw: 'Surowce',
  agri: 'Rolnictwo',
  material: 'Półprodukty',
  food: 'Żywność',
  consumer: 'Dobra konsumpcyjne',
  luxury: 'Luksus',
  electronics: 'Elektronika',
  energy: 'Energia',
  waste: 'Odpady',
  digital: 'Cyfrowe',
};

export const NOTIF_CATEGORY_LABEL: Record<string, string> = {
  production: 'Produkcja',
  logistics: 'Logistyka',
  finance: 'Finanse',
  city: 'Miasta',
  event: 'Wydarzenia',
  research: 'Badania',
  goal: 'Cele',
  ai: 'Konkurencja',
  system: 'System',
};

// ---------------------------------------------------------------- products / buildings
export function productDef(ctx: GameContext, id: string): ProductDef | undefined {
  return ctx.data.products[id];
}
export const productIcon = (ctx: GameContext, id: string): string => ctx.data.products[id]?.icon ?? '📦';
export const productName = (ctx: GameContext, id: string): string => ctx.data.products[id]?.name ?? id;
export const productLabel = (ctx: GameContext, id: string): string => `${productIcon(ctx, id)} ${productName(ctx, id)}`;

export const buildingDef = (ctx: GameContext, typeId: string): BuildingDef | undefined => ctx.data.buildings[typeId];
export function buildingName(ctx: GameContext, b: { typeId: string; name: string | null; id?: number }): string {
  return b.name ?? ctx.data.buildings[b.typeId]?.name ?? b.typeId;
}
export const buildingIcon = (ctx: GameContext, typeId: string): string => ctx.data.buildings[typeId]?.icon ?? '🏢';

/** "4 🥡 Mąka + 1 ⚫" */
export function ioText(ctx: GameContext, list: readonly { product: string; qty: number }[]): string {
  if (!list.length) return '—';
  return list.map((io) => `${formatNumber(io.qty, 1)} ${productIcon(ctx, io.product)} ${productName(ctx, io.product)}`).join(' + ');
}

/** "10 🌾 → 8 🥡" compact recipe text. */
export function recipeShort(ctx: GameContext, r: RecipeDef): string {
  const i = r.inputs.map((io) => `${formatNumber(io.qty, 1)}${productIcon(ctx, io.product)}`).join(' ');
  const o = r.outputs.map((io) => `${formatNumber(io.qty, 1)}${productIcon(ctx, io.product)}`).join(' ');
  return i ? `${i} → ${o}` : `→ ${o}`;
}

/** Output units per 30-day month at efficiency 1. */
export function recipeMonthly(r: RecipeDef): { product: string; qty: number }[] {
  const cycles = r.days > 0 ? 30 / r.days : 0;
  return r.outputs.map((o) => ({ product: o.product, qty: o.qty * cycles }));
}

export function stockSummary(ctx: GameContext, s: Stock): string {
  const e = Object.entries(s).filter(([, v]) => v.qty >= 0.05);
  if (!e.length) return '—';
  return e.map(([k, v]) => `${productIcon(ctx, k)} ${formatNumber(v.qty, 1)}`).join('  ');
}

export function qualityLabel(q: number): string {
  if (q >= 0.8) return 'Premium';
  if (q >= 0.6) return 'Dobra';
  if (q >= 0.4) return 'Standard';
  if (q >= 0.2) return 'Niska';
  return 'Bardzo niska';
}

// ---------------------------------------------------------------- unlocks
export interface LockInfo {
  unlocked: boolean;
  /** Polish reason when locked. */
  reason: string;
}

/** Is a building/vehicle available for the player, and if not, why. */
export function lockInfo(ctx: GameContext, kind: 'building' | 'vehicle', id: string): LockInfo {
  const st = ctx.tryState();
  const def = kind === 'building' ? ctx.data.buildings[id] : ctx.data.vehicles[id];
  if (!def) return { unlocked: false, reason: 'Nieznany obiekt' };
  if (!st) return { unlocked: true, reason: '' };
  let unlocked = true;
  try {
    unlocked = ctx.services.economy.isUnlocked(st.playerCompanyId, kind, id);
  } catch {
    unlocked = true;
  }
  if (unlocked) return { unlocked: true, reason: '' };
  const reasons: string[] = [];
  const era = ctx.data.eras[def.era];
  if (era && ctx.data.eraIndex(def.era) > ctx.data.eraIndex(st.time.eraId)) reasons.push(`Epoka: ${era.icon} ${era.name} (od ${era.startYear} r.)`);
  const player = st.companies[st.playerCompanyId];
  if (def.requiresTech && !player?.research.unlocked[def.requiresTech]) {
    reasons.push(`Technologia: ${ctx.data.techs[def.requiresTech]?.name ?? def.requiresTech}`);
  }
  const effKind = kind === 'building' ? 'unlockBuilding' : 'unlockVehicle';
  for (const t of ctx.data.techList()) {
    if (player?.research.unlocked[t.id]) continue;
    if (t.effects.some((e) => e.kind === effKind && 'id' in e && e.id === id) && t.id !== def.requiresTech) reasons.push(`Technologia: ${t.icon} ${t.name}`);
  }
  return { unlocked: false, reason: reasons.length ? `Wymaga — ${reasons.join(', ')}` : 'Zablokowane' };
}

/** Company display "🏭 Nazwa". */
export function companyLabel(st: GameState, id: number): string {
  const c = st.companies[id];
  return c ? `${c.logo} ${c.name}` : 'Publiczny';
}

export function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

const EFFECT_LABEL: Record<string, string> = {
  efficiency: 'wydajność',
  workers: 'pracownicy',
  capacity: 'pojemność',
  upkeep: 'utrzymanie',
  quality: 'jakość',
  emissions: 'emisje',
  speed: 'prędkość',
  output: 'produkcja',
  energy: 'energia',
  wages: 'płace',
  research: 'badania',
};

/** "wydajność +50%, pracownicy +40%" from an effects map (multiplicative convention). */
export function effectsText(effects: Record<string, number>): string {
  return Object.entries(effects)
    .map(([k, v]) => {
      const [eff, target] = k.split('.');
      const pct = Math.round((v - 1) * 100);
      return `${EFFECT_LABEL[eff ?? k] ?? eff}${target && target !== 'all' ? ` (${target})` : ''} ${pct >= 0 ? '+' : ''}${pct}%`;
    })
    .join(', ');
}
