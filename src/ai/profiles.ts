/**
 * AI personalities, difficulty tuning and rival identities (names, colours, logos).
 */
import type { AIPersonality, Difficulty } from '../core/types';

export interface PersonalityDef {
  id: AIPersonality;
  /** Polish label for UI. */
  name: string;
  description: string;
  /** Multiplier of the think interval (<1 = acts more often). */
  tempo: number;
  /** Max simultaneous chain projects (added to difficulty base). */
  extraProjects: number;
  /** Fraction of cash kept as a safety reserve before starting a new project. */
  reserve: number;
  /** Willingness to borrow 0..1 (0 = never). */
  loanAppetite: number;
  /** Preference weight for long chains (depth). */
  depthBias: number;
  /** Preference for cities where rivals (incl. the player) already sell. */
  competeBias: number;
  /** Shop price factor (undercut < 1). */
  priceFactor: number;
  /** Minimal expected monthly ROI (profit / capital) for a new chain. */
  minRoi: number;
  /** Research priority (0..1). */
  research: number;
  /** Preference for green products / eco tech. */
  green: number;
}

export const PERSONALITIES: Record<AIPersonality, PersonalityDef> = {
  balanced: {
    id: 'balanced', name: 'Zrównoważony', description: 'Rozsądnie inwestuje i powoli się rozwija.',
    tempo: 1, extraProjects: 0, reserve: 0.15, loanAppetite: 0.4, depthBias: 0, competeBias: 0, priceFactor: 1, minRoi: 0.008, research: 0.5, green: 0.2,
  },
  aggressive: {
    id: 'aggressive', name: 'Agresywny ekspander', description: 'Szybko się rozrasta, zaciąga kredyty i podcina ceny w miastach rywali.',
    tempo: 0.7, extraProjects: 1, reserve: 0.05, loanAppetite: 0.9, depthBias: -0.1, competeBias: 0.6, priceFactor: 0.9, minRoi: 0.004, research: 0.3, green: 0,
  },
  cautious: {
    id: 'cautious', name: 'Ostrożny', description: 'Buduje tylko pewne łańcuchy, unika długów, szybko spłaca kredyty.',
    tempo: 1.3, extraProjects: -1, reserve: 0.35, loanAppetite: 0.1, depthBias: -0.2, competeBias: -0.4, priceFactor: 1.05, minRoi: 0.015, research: 0.4, green: 0.2,
  },
  industrialist: {
    id: 'industrialist', name: 'Specjalista – przemysł ciężki', description: 'Wybiera długie łańcuchy produkcyjne i kolej.',
    tempo: 1, extraProjects: 0, reserve: 0.15, loanAppetite: 0.6, depthBias: 0.4, competeBias: 0, priceFactor: 1, minRoi: 0.006, research: 0.6, green: 0,
  },
  merchant: {
    id: 'merchant', name: 'Specjalista – handel', description: 'Stawia na sieci sklepów i logistykę w wielu miastach.',
    tempo: 0.9, extraProjects: 1, reserve: 0.12, loanAppetite: 0.4, depthBias: -0.3, competeBias: 0.3, priceFactor: 0.95, minRoi: 0.007, research: 0.3, green: 0.1,
  },
  green: {
    id: 'green', name: 'Ekologiczny', description: 'Inwestuje w zielone technologie i produkty ekologiczne.',
    tempo: 1.1, extraProjects: 0, reserve: 0.2, loanAppetite: 0.3, depthBias: 0, competeBias: -0.2, priceFactor: 1.05, minRoi: 0.006, research: 0.8, green: 1,
  },
};

export interface DifficultyDef {
  /** Days between planner runs. */
  thinkDays: number;
  /** Max simultaneous chain projects. */
  projects: number;
  /** Relative noise applied to profit estimates (bad judgement on easy). */
  noise: number;
  /** Starting cash multiplier vs START_CASH.normal (setup only, never later). */
  startCash: number;
  /** Buildings per chain cap. */
  maxChainBuildings: number;
  /** Whether to add extra raw producers for bottlenecks. */
  balanceChains: boolean;
  /** Max vehicles per link. */
  maxVehiclesPerLink: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultyDef> = {
  easy: { thinkDays: 20, projects: 1, noise: 0.35, startCash: 0.7, maxChainBuildings: 6, balanceChains: false, maxVehiclesPerLink: 2 },
  normal: { thinkDays: 12, projects: 2, noise: 0.15, startCash: 1, maxChainBuildings: 9, balanceChains: true, maxVehiclesPerLink: 3 },
  hard: { thinkDays: 7, projects: 3, noise: 0.05, startCash: 1.25, maxChainBuildings: 12, balanceChains: true, maxVehiclesPerLink: 5 },
};

export const RIVAL_NAMES: string[] = [
  'Hutnik S.A.', 'Kowalski i Synowie', 'Przemysł Polski', 'Orzeł Industries', 'Wisła Trans', 'Nowak Holding',
  'Stal-Pol', 'Bursztyn Corp.', 'Mazowsze Group', 'Karpaty Consolidated', 'Bałtyk Handel', 'Sokół Przemysłowy',
  'Tatra Dynamics', 'Warta Logistyka', 'Odra Wytwórnia', 'Jantar Fabryki',
];

export const RIVAL_COLORS: string[] = ['#e0564a', '#4a9ee0', '#5cc486', '#b07be0', '#e07bb8', '#4ad0c8', '#c0c050', '#d9803a'];

export const RIVAL_LOGOS: string[] = ['🦅', '🐻', '⚓', '🔥', '🌲', '💎', '🦊', '🐺', '🛡️', '⭐'];

export const PERSONALITY_POOL: AIPersonality[] = ['balanced', 'aggressive', 'cautious', 'industrialist', 'merchant', 'green'];
