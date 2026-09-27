/**
 * Render palette: terrain colours per season, tree colours, roof colours,
 * product/company fallbacks. Soft, slightly desaturated "toy map" look.
 */
import { Terrain, type ClimateZone, type Season } from '../core/types';
import { parseColor, type RGB } from './util/color';

export interface TerrainPalette {
  deep: RGB;
  shallow: RGB;
  shallowLight: RGB;
  foam: RGB;
  sand: RGB;
  grassLush: RGB;
  grassDry: RGB;
  forestFloor: RGB;
  hills: RGB;
  rock: RGB;
  rockDark: RGB;
  snow: RGB;
  desert: RGB;
  swamp: RGB;
  swampWater: RGB;
  urban: RGB;
  /** Crop colours for farmland patches. */
  crops: RGB[];
  /** Tree canopy colours (deciduous). */
  trees: string[];
  /** Conifer colours. */
  conifers: string[];
  /** 0..1 snow cover on land (winter in cold climates). */
  snowCover: number;
}

const c = parseColor;

const SUMMER: TerrainPalette = {
  deep: c('#2c5d88'),
  shallow: c('#4a8db8'),
  shallowLight: c('#79b8d2'),
  foam: c('#e4f3f5'),
  sand: c('#e8d8a4'),
  grassLush: c('#86bb64'),
  grassDry: c('#bcc17a'),
  forestFloor: c('#5d9150'),
  hills: c('#9eae6c'),
  rock: c('#a09787'),
  rockDark: c('#6f675e'),
  snow: c('#e8eef1'),
  desert: c('#e3c588'),
  swamp: c('#6d8756'),
  swampWater: c('#4f6f5e'),
  urban: c('#d2cbbd'),
  crops: [c('#e2c25a'), c('#d7b74e'), c('#9cc15c'), c('#b89a62'), c('#e8d36a'), c('#a7bf5a')],
  trees: ['#4f8f45', '#5a9a4a', '#3f7d3e', '#6aa452', '#478a4a'],
  conifers: ['#2f6a44', '#35714a', '#28603f'],
  snowCover: 0,
};

const SPRING: TerrainPalette = {
  ...SUMMER,
  grassLush: c('#90c96a'),
  grassDry: c('#b3c97a'),
  forestFloor: c('#679d56'),
  hills: c('#a4ba70'),
  crops: [c('#a9cf6a'), c('#9cc760'), c('#b7a070'), c('#c4d676'), c('#e6e06a'), c('#8fbf5c')],
  trees: ['#6cae55', '#7cbb5e', '#5aa04e', '#e9b7c8', '#8cc463'],
};

const AUTUMN: TerrainPalette = {
  ...SUMMER,
  grassLush: c('#a9b566'),
  grassDry: c('#c6b872'),
  forestFloor: c('#8a8448'),
  hills: c('#aea468'),
  crops: [c('#c19a58'), c('#b58a52'), c('#caa963'), c('#9d7c4e'), c('#d6b665'), c('#a58a58')],
  trees: ['#d9892f', '#c8562e', '#e0b23c', '#9a8f3c', '#b8672f', '#6f8f45'],
  conifers: ['#30663f', '#386d44', '#2d5f3d'],
};

const WINTER_MILD: TerrainPalette = {
  ...SUMMER,
  grassLush: c('#9aab72'),
  grassDry: c('#b4b27f'),
  forestFloor: c('#6f7f58'),
  hills: c('#a5a57a'),
  crops: [c('#9c8a66'), c('#8f7c5c'), c('#a39574'), c('#877459')],
  trees: ['#7a7f58', '#6d7a50', '#8a8660'],
  conifers: ['#2f5c43', '#355f47'],
};

const WINTER_SNOW: TerrainPalette = {
  ...WINTER_MILD,
  shallow: c('#5b95b8'),
  shallowLight: c('#a7cfe0'),
  snowCover: 0.85,
};

export function terrainPalette(season: Season, climate: ClimateZone): TerrainPalette {
  const snowy = climate === 'temperate' || climate === 'continental' || climate === 'arctic';
  switch (season) {
    case 'spring':
      return SPRING;
    case 'autumn':
      return AUTUMN;
    case 'winter':
      if (!snowy) return WINTER_MILD;
      return { ...WINTER_SNOW, snowCover: climate === 'temperate' ? 0.62 : 0.88 };
    default:
      return climate === 'arid' ? { ...SUMMER, grassLush: c('#a3b865'), grassDry: c('#cbbf7c') } : SUMMER;
  }
}

/** Roof colours per social class (Townscaper-ish). */
export const ROOFS = {
  poor: ['#9a6a4e', '#8a7466', '#a8765a', '#7d7470', '#b08058'],
  middle: ['#c2644a', '#b8573f', '#5f7f9a', '#6f8f6a', '#c98b4a', '#8a6fa0', '#d0764e'],
  rich: ['#d9573f', '#3f8f9a', '#e0a040', '#4f6fb0', '#c94f6a', '#5fa07a'],
} as const;

export const WALLS = ['#efe6d6', '#e8dcc8', '#f3ede2', '#e2d3bd', '#f0e0d0'];

/** Neutral colour for public (owner 0) infrastructure. */
export const PUBLIC_COLOR = '#9aa3ad';

/** Water surface colour used by vector parts (rivers, ports). */
export const RIVER_COLOR = '#5a9cc4';
export const RIVER_BANK = '#6f8f5e';

/** Terrain ids that count as water. */
export const isWaterTerrain = (t: number): boolean => t === Terrain.DeepWater || t === Terrain.Water;
