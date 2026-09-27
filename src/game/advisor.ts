/**
 * Advisor / mentor "Doradca": periodically analyses the player's situation and
 * emits contextual hints via notify(category 'advisor') + 'advisor:tip'.
 * Deduplicated per tip id (cooldowns in state.advisor.tipsShown) and rate
 * limited (state.advisor.lastTipDay). Toggle: userSettings.advisorEnabled.
 */
import type { GameContext } from '../core/context';
import { cityPopulation } from '../core/entities';
import { notify } from '../core/notify';
import type { Building, EntityRef, GameState } from '../core/types';
import { stockQty } from '../core/util';

export interface Tip {
  id: string;
  priority: number;
  title: string;
  text: string;
  target: EntityRef | null;
  level?: 'info' | 'warning' | 'danger';
  /** Days before the same tip may repeat. */
  cooldown: number;
}

/** Tips queued by events (era change…), emitted on the next advisor run. */
let queued: Tip[] = [];
/** Best current hint (for services.game.currentHint). */
let lastHint: string | null = null;

export function resetAdvisor(): void {
  queued = [];
  lastHint = null;
}

export function currentHint(): string | null {
  return lastHint;
}

export function queueTip(t: Tip): void {
  queued.push(t);
}

function bname(ctx: GameContext, b: Building): string {
  return b.name ?? ctx.data.buildings[b.typeId]?.name ?? b.typeId;
}

function monthlyExpenses(s: GameState): number {
  const c = s.companies[s.playerCompanyId];
  if (!c) return 0;
  const h = c.finances.history.slice(-3);
  if (!h.length) return c.finances.current.expenses;
  return h.reduce((a, m) => a + m.expenses, 0) / h.length;
}

/** Analyse state → candidate tips (pure w.r.t. state). */
export function analyse(ctx: GameContext, s: GameState): Tip[] {
  const tips: Tip[] = [];
  const pid = s.playerCompanyId;
  const player = s.companies[pid];
  if (!player) return tips;
  const mine = Object.values(s.buildings).filter((b) => b.owner === pid);

  // --- getting started
  if (!mine.length && s.time.totalDays > 3) {
    tips.push({
      id: 'start',
      priority: 80,
      title: 'Od czego zacząć?',
      text: 'Zacznij od prostego łańcucha: farma → młyn → piekarnia → sklep w mieście. Połącz budynki drogą i kup pojazd.',
      target: null,
      cooldown: 60,
    });
  }

  // --- cash
  const exp = monthlyExpenses(s);
  if (player.cash < 0) {
    tips.push({ id: 'cash_negative', priority: 100, level: 'danger', title: 'Ujemne saldo!', text: 'Firma jest pod kreską. Weź kredyt, sprzedaj nierentowne pojazdy lub budynki, zanim grozi bankructwo.', target: { kind: 'company', id: pid }, cooldown: 30 });
  } else if (exp > 0 && player.cash < exp * 2) {
    const canLoan = player.creditLimit - player.loans.reduce((a, l) => a + l.remaining, 0) > 0;
    tips.push({ id: 'cash_low', priority: 70, level: 'warning', title: 'Kończy się gotówka', text: canLoan ? 'Gotówki wystarczy na mniej niż 2 miesiące — rozważ kredyt.' : 'Gotówki wystarczy na mniej niż 2 miesiące — ogranicz wydatki.', target: { kind: 'company', id: pid }, cooldown: 60 });
  }

  // --- buildings
  for (const b of mine) {
    if (b.constructionProgress < 1) continue;
    const def = ctx.data.buildings[b.typeId];
    if (!def) continue;
    if (b.status === 'noInput' && (def.category === 'factory' || def.category === 'recycling')) {
      const recipe = b.recipeId ? ctx.data.recipes[b.recipeId] : undefined;
      const missing = recipe?.inputs.filter((i) => stockQty(b.input, i.product) < i.qty).map((i) => ctx.data.products[i.product]?.name ?? i.product) ?? [];
      const util = b.stats.utilizationHistory.length ? b.stats.utilizationHistory.at(-1)! : b.efficiency;
      tips.push({
        id: `input:${b.id}`,
        priority: 60,
        level: 'warning',
        title: 'Fabryka stoi',
        text: `${bname(ctx, b)} pracuje na ${Math.round(Math.max(0, Math.min(1, util ?? 0)) * 100)}% mocy — brakuje surowca${missing.length ? ` (${missing.join(', ')})` : ''}.`,
        target: { kind: 'building', id: b.id },
        cooldown: 45,
      });
    } else if (b.status === 'outputFull') {
      tips.push({ id: `full:${b.id}`, priority: 55, level: 'warning', title: 'Pełny magazyn', text: `${bname(ctx, b)} ma pełny magazyn wyjściowy — dodaj pojazd lub nową trasę odbioru.`, target: { kind: 'building', id: b.id }, cooldown: 45 });
    } else if (b.status === 'noWorkers') {
      tips.push({ id: `workers:${b.id}`, priority: 50, level: 'warning', title: 'Brak pracowników', text: `${bname(ctx, b)} nie ma pracowników — buduj bliżej miast albo podnieś płace.`, target: { kind: 'building', id: b.id }, cooldown: 60 });
    } else if (b.status === 'noCustomers') {
      tips.push({ id: `customers:${b.id}`, priority: 45, title: 'Sklep bez klientów', text: `${bname(ctx, b)} nie ma klientów — sklepy muszą stać w zasięgu miasta.`, target: { kind: 'building', id: b.id }, cooldown: 90 });
    }
    const ph = b.stats.profitHistory.slice(-3);
    if (ph.length === 3 && ph.every((v) => v < 0)) {
      tips.push({ id: `loss:${b.id}`, priority: 35, title: 'Budynek przynosi straty', text: `${bname(ctx, b)} od 3 miesięcy jest na minusie. Sprawdź zaopatrzenie i trasę albo rozważ rozbiórkę.`, target: { kind: 'building', id: b.id }, cooldown: 120 });
    }
  }

  // --- vehicles & routes
  let idle = 0;
  let noPath = 0;
  let firstIdle = 0;
  for (const v of Object.values(s.vehicles)) {
    if (v.owner !== pid) continue;
    if (v.status === 'idle') (idle++, (firstIdle ||= v.id));
    else if (v.status === 'noPath') (noPath++, (firstIdle ||= v.id));
  }
  if (noPath) tips.push({ id: 'nopath', priority: 58, level: 'warning', title: 'Brak drogi', text: `${noPath} pojazd(ów) nie może dojechać do celu — brakuje połączenia drogowego lub torów.`, target: { kind: 'vehicle', id: firstIdle }, cooldown: 30 });
  else if (idle) tips.push({ id: 'idle', priority: 40, title: 'Pojazdy bez trasy', text: `${idle} pojazd(ów) stoi bez trasy. Przypisz je lub sprzedaj.`, target: { kind: 'vehicle', id: firstIdle }, cooldown: 60 });

  for (const r of Object.values(s.routes)) {
    if (r.owner !== pid || r.vehicleIds.length < 2) continue;
    let slow = 0;
    for (const vid of r.vehicleIds) {
      const v = s.vehicles[vid];
      const def = v ? ctx.data.vehicles[v.typeId] : undefined;
      if (v && def && v.status === 'moving' && v.speed > 0 && v.speed < def.speed * 0.5) slow++;
    }
    if (slow * 2 >= r.vehicleIds.length) {
      tips.push({ id: `jam:${r.id}`, priority: 50, level: 'warning', title: 'Korki na trasie', text: `Trasa „${r.name}” ma korki — rozważ drugą drogę, lepszą nawierzchnię albo kolej.`, target: { kind: 'route', id: r.id }, cooldown: 60 });
    }
  }

  // --- city shortages (biggest unmet value)
  let best: Tip | null = null;
  let bestVal = 0;
  for (const city of Object.values(s.cities)) {
    if (cityPopulation(city) < 300) continue;
    for (const [p, d] of Object.entries(city.demand)) {
      if (d.monthly < 10 || d.satisfaction > 0.35) continue;
      let unlocked = true;
      try {
        unlocked = ctx.services.economy.isUnlocked(pid, 'product', p);
      } catch {
        /* assume yes */
      }
      if (!unlocked) continue;
      const val = d.monthly * (1 - d.satisfaction) * (d.price || ctx.data.products[p]?.basePrice || 1);
      if (val > bestVal) {
        bestVal = val;
        const pn = ctx.data.products[p]?.name ?? p;
        best = {
          id: `short:${city.id}:${p}`,
          priority: 42,
          title: 'Niedobór w mieście',
          text: `Miasto ${city.name} ma niedobór: ${pn} (zaspokojenie ${Math.round(d.satisfaction * 100)}%). To okazja na nowy łańcuch.`,
          target: { kind: 'city', id: city.id },
          cooldown: 120,
        };
      }
    }
  }
  if (best) tips.push(best);

  // --- research
  if (!player.research.current && player.cash > 20000 && s.time.totalDays > 60) {
    const avail = ctx.data.techList().some((t) => player.research.unlocked[t.id] === undefined && t.prereqs.every((p) => player.research.unlocked[p] !== undefined));
    if (avail) tips.push({ id: 'research', priority: 20, title: 'Badania czekają', text: 'Nie prowadzisz żadnych badań. Nowe technologie zwiększają wydajność i odblokowują produkty.', target: null, cooldown: 180 });
  }

  return tips.sort((a, b) => b.priority - a.priority);
}

function enabled(ctx: GameContext, s: GameState): boolean {
  return ctx.userSettings.advisorEnabled && s.advisor.enabled;
}

/** Advisor system (daily; analysis every few days). */
export function advisorSystem(s: GameState, _dt: number, ctx: GameContext): void {
  const today = s.time.totalDays;
  if (today % 3 !== 0 && !queued.length) return;
  if (s.goals.status !== 'playing' && s.goals.scenarioId) return;
  let tips: Tip[];
  try {
    tips = [...queued, ...analyse(ctx, s)].sort((a, b) => b.priority - a.priority);
  } catch (err) {
    console.warn('[advisor] analysis failed', err);
    return;
  }
  queued = [];
  const fresh = tips.filter((t) => s.advisor.tipsShown[t.id] === undefined || today - s.advisor.tipsShown[t.id]! >= t.cooldown);
  lastHint = (fresh[0] ?? tips[0])?.text ?? null;
  if (!enabled(ctx, s)) return;
  // During the tutorial the tutorial panel is the mentor; only urgent tips.
  const tutorial = s.advisor.tutorialStep >= 0;
  const gap = today < 60 ? 4 : 10;
  const tip = fresh.find((t) => !tutorial || t.priority >= 90);
  if (!tip) return;
  if (tip.priority < 90 && today - s.advisor.lastTipDay < gap && s.advisor.lastTipDay > 0) return;
  s.advisor.tipsShown[tip.id] = today;
  s.advisor.lastTipDay = today;
  // Keep the map small: forget very old entries.
  const ids = Object.keys(s.advisor.tipsShown);
  if (ids.length > 300) for (const id of ids) if (today - s.advisor.tipsShown[id]! > 720) delete s.advisor.tipsShown[id];
  ctx.bus.emit('advisor:tip', { id: tip.id, text: tip.text, target: tip.target });
  notify(ctx, { level: tip.level ?? 'info', icon: '🧑‍💼', title: `Doradca: ${tip.title}`, text: tip.text, target: tip.target, category: 'advisor' });
}

/** Era change → list what's newly available. */
export function onEraChanged(ctx: GameContext, eraId: string): void {
  const era = ctx.data.eras[eraId];
  if (!era) return;
  const b = ctx.data.buildingList().filter((x) => x.era === eraId).map((x) => x.name);
  const v = ctx.data.vehicleList().filter((x) => x.era === eraId).map((x) => x.name);
  const p = ctx.data.productList().filter((x) => x.era === eraId).map((x) => x.name);
  const parts: string[] = [];
  if (b.length) parts.push(`budynki: ${b.slice(0, 5).join(', ')}${b.length > 5 ? '…' : ''}`);
  if (p.length) parts.push(`produkty: ${p.slice(0, 5).join(', ')}${p.length > 5 ? '…' : ''}`);
  if (v.length) parts.push(`pojazdy: ${v.slice(0, 4).join(', ')}`);
  queueTip({
    id: `era:${eraId}`,
    priority: 90,
    title: `Nowa epoka odblokowała nowości`,
    text: parts.length ? `${era.name} odblokowała — ${parts.join('; ')}.` : `${era.name}: sprawdź nowe technologie w drzewie badań.`,
    target: null,
    cooldown: 100000,
  });
}
