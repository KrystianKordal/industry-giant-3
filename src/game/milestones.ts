/**
 * Sandbox (and campaign) milestones — auto-generated goals the game congratulates
 * the player for. Achieved ones are stored in state.goals.milestones[id] = day.
 */
import type { GameContext } from '../core/context';
import { notify } from '../core/notify';
import type { GameState } from '../core/types';
import { gameExt } from './tracking';

export interface MilestoneDef {
  id: string;
  icon: string;
  title: string;
  text: string;
  check(ctx: GameContext, s: GameState): boolean;
}

const pid = (s: GameState): number => s.playerCompanyId;
const player = (s: GameState) => s.companies[s.playerCompanyId];
const count = <T extends { owner: number }>(rec: Record<number, T>, owner: number): number => {
  let n = 0;
  for (const v of Object.values(rec)) if (v.owner === owner) n++;
  return n;
};

function value(ctx: GameContext, s: GameState, id: number): number {
  try {
    const v = ctx.services.economy.companyValue(id);
    if (Number.isFinite(v) && v !== 0) return v;
  } catch {
    /* fallback */
  }
  return s.companies[id]?.finances.valuation ?? 0;
}

/** Market share (by value, last closed month) needed for the "Monopolista" victory. */
export const MONOPOLY_SHARE = 0.6;

export interface MonopolyStatus {
  rivalsTotal: number;
  /** Rivals still on the market (not taken over, not bankrupt). */
  rivalsLeft: number;
  /** Player's share of all shop sales (by value) in the last closed month, 0..1. */
  share: number;
  achieved: boolean;
}

/** Sandbox victory "Monopolista": all rivals gone (taken over / bankrupt) or ≥ 60% market share. */
export function monopolyStatus(_ctx: GameContext, s: GameState): MonopolyStatus {
  const rivals = Object.values(s.companies).filter((x) => !x.isPlayer);
  const rivalsLeft = rivals.filter((r) => !r.acquiredBy && !r.bankrupt).length;
  const ext = gameExt(s);
  let mine = 0;
  let total = 0;
  for (const [p, byCompany] of Object.entries(ext.shareLast)) {
    const price = s.market.products[p]?.price ?? 1;
    for (const [cid, qty] of Object.entries(byCompany)) {
      const v = qty * price;
      total += v;
      if (Number(cid) === s.playerCompanyId) mine += v;
    }
  }
  const share = total > 0 ? mine / total : 0;
  const achieved = rivals.length > 0 && (rivalsLeft === 0 || (s.time.totalDays >= 720 && share >= MONOPOLY_SHARE && total >= 50_000));
  return { rivalsTotal: rivals.length, rivalsLeft, share, achieved };
}

export const MILESTONES: MilestoneDef[] = [
  { id: 'first_building', icon: '🏗️', title: 'Pierwszy budynek', text: 'Postawiłeś pierwszy budynek. Imperium zaczyna się od fundamentów!', check: (_c, s) => count(s.buildings, pid(s)) >= 1 },
  { id: 'first_vehicle', icon: '🚚', title: 'Pierwszy pojazd', text: 'Twoja flota wyjechała w trasę.', check: (_c, s) => count(s.vehicles, pid(s)) >= 1 },
  { id: 'first_sale', icon: '💰', title: 'Pierwsza sprzedaż', text: 'Klienci kupili Twój pierwszy towar.', check: (_c, s) => Object.values(gameExt(s).sold).some((v) => v > 0) },
  {
    id: 'first_chain',
    icon: '⛓️',
    title: 'Pierwszy łańcuch produkcyjny',
    text: 'Sprzedajesz towar wyprodukowany we własnej fabryce — łańcuch oddycha!',
    check: (c, s) => {
      const ext = gameExt(s);
      return Object.keys(ext.sold).some((p) => (ext.sold[p] ?? 0) > 0 && (ext.produced[p] ?? 0) > 0 && !c.data.products[p]?.isRaw);
    },
  },
  { id: 'profit_10k', icon: '📈', title: 'Zysk 10 tys. zł', text: 'Miesięczny zysk przekroczył 10 000 zł.', check: (_c, s) => (player(s)?.finances.history.at(-1)?.profit ?? 0) >= 10_000 },
  { id: 'profit_100k', icon: '📈', title: 'Zysk 100 tys. zł', text: 'Miesięczny zysk przekroczył 100 000 zł.', check: (_c, s) => (player(s)?.finances.history.at(-1)?.profit ?? 0) >= 100_000 },
  { id: 'cash_1m', icon: '💵', title: 'Pierwszy milion', text: 'Na koncie firmy jest milion złotych!', check: (_c, s) => (player(s)?.cash ?? 0) >= 1_000_000 },
  { id: 'cash_10m', icon: '💎', title: 'Dziesięć milionów', text: 'Gotówka przekroczyła 10 mln zł.', check: (_c, s) => (player(s)?.cash ?? 0) >= 10_000_000 },
  { id: 'value_100m', icon: '🏛️', title: 'Gigant przemysłu', text: 'Wartość firmy przekroczyła 100 mln zł.', check: (c, s) => value(c, s, pid(s)) >= 100_000_000 },
  { id: 'buildings_25', icon: '🏭', title: 'Imperium 25 budynków', text: 'Zarządzasz już 25 budynkami.', check: (_c, s) => count(s.buildings, pid(s)) >= 25 },
  { id: 'vehicles_50', icon: '🚛', title: 'Flota 50 pojazdów', text: 'Twoja flota liczy 50 pojazdów.', check: (_c, s) => count(s.vehicles, pid(s)) >= 50 },
  { id: 'first_research', icon: '🔬', title: 'Pierwsze odkrycie', text: 'Zbadałeś pierwszą technologię.', check: (_c, s) => Object.keys(player(s)?.research.unlocked ?? {}).length >= 1 },
  {
    id: 'city_supply_90',
    icon: '🏙️',
    title: 'Miasto zaopatrzone',
    text: 'Zaspokoiłeś ponad 90% popytu miasta na jeden z produktów.',
    check: (_c, s) => {
      const ext = gameExt(s);
      for (const city of Object.values(s.cities))
        for (const [p, d] of Object.entries(city.demand)) {
          if (d.satisfaction < 0.9 || d.monthly <= 0) continue;
          const mine = d.shareByCompany[pid(s)] ?? 0;
          let total = 0;
          for (const v of Object.values(d.shareByCompany)) total += v;
          if (total > 0 ? mine / total >= 0.5 : (ext.soldCity[`${city.id}:${p}`] ?? 0) > 0) return true;
        }
      return false;
    },
  },
  {
    id: 'beat_rival',
    icon: '🏆',
    title: 'Lider rynku',
    text: 'Twoja firma jest warta więcej niż każdy z rywali (albo rywal zbankrutował).',
    check: (c, s) => {
      const rivals = Object.values(s.companies).filter((x) => !x.isPlayer);
      if (!rivals.length) return false;
      if (rivals.some((r) => r.bankrupt)) return true;
      if (s.time.totalDays < 360) return false;
      const pv = value(c, s, pid(s));
      return rivals.every((r) => value(c, s, r.id) < pv);
    },
  },
  {
    id: 'monopolist',
    icon: '👑',
    title: 'Monopolista',
    text: `Wszyscy rywale zniknęli z rynku (przejęci lub zbankrutowani) albo kontrolujesz ponad ${Math.round(MONOPOLY_SHARE * 100)}% sprzedaży w sklepach. Wygrywasz grę swobodną!`,
    check: (c, s) => monopolyStatus(c, s).achieved,
  },
];

function achieve(ctx: GameContext, s: GameState, id: string, icon: string, title: string, text: string): void {
  if (s.goals.milestones[id] !== undefined) return;
  s.goals.milestones[id] = s.time.totalDays;
  ctx.bus.emit('milestone', { id, title });
  ctx.bus.emit('sfx', { id: 'success' });
  notify(ctx, { level: 'success', icon, title: `Kamień milowy: ${title}`, text, category: 'goal' });
}

/** Check all milestones (cheap; run every few days). */
export function checkMilestones(ctx: GameContext, s: GameState): void {
  for (const m of MILESTONES) {
    if (s.goals.milestones[m.id] !== undefined) continue;
    let ok = false;
    try {
      ok = m.check(ctx, s);
    } catch {
      ok = false;
    }
    if (!ok) continue;
    achieve(ctx, s, m.id, m.icon, m.title, m.text);
    // sandbox victory: celebrate, but let the player continue
    if (m.id === 'monopolist' && !s.goals.scenarioId && !ctx.headless) {
      ctx.bus.emit('sfx', { id: 'victory' });
      ctx.sim.setPaused(true);
      ctx.ui.openPanel('sandboxVictory');
    }
  }
}

/** Era milestone (from 'era:changed'). */
export function eraMilestone(ctx: GameContext, s: GameState, eraId: string): void {
  const era = ctx.data.eras[eraId];
  if (!era) return;
  achieve(ctx, s, `era_${eraId}`, era.icon, `Nowa epoka: ${era.name}`, 'Twoja firma wkracza w nowe czasy.');
}

/** All milestone descriptors (static + reached era milestones) for UI. */
export function milestoneList(ctx: GameContext, s: GameState): { id: string; icon: string; title: string; text: string; day: number | null }[] {
  const out = MILESTONES.map((m) => ({ id: m.id, icon: m.icon, title: m.title, text: m.text, day: s.goals.milestones[m.id] ?? null }));
  for (const e of ctx.data.eraList()) {
    const id = `era_${e.id}`;
    if (s.goals.milestones[id] !== undefined) out.push({ id, icon: e.icon, title: `Nowa epoka: ${e.name}`, text: e.description, day: s.goals.milestones[id]! });
  }
  return out;
}
