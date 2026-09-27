/**
 * Global engine constants. Changing any of these affects balance and/or saves —
 * coordinate via docs/CONTRACTS.md changelog.
 */

/** Current save format version. Bump + add a migration in save.ts when GameState shape changes incompatibly. */
export const SAVE_VERSION = 1;
/** Game build version shown in menus / stored in save meta. */
export const GAME_VERSION = '0.1.0';

// ---------------------------------------------------------------- time
/** Simulation ticks per game day. dt of a 'tick' system = 1 / TICKS_PER_DAY days. */
export const TICKS_PER_DAY = 10;
/** Real milliseconds per game day at speed 1x (1 day ≈ 1 s). */
export const MS_PER_DAY = 1000;
export const DAYS_PER_MONTH = 30;
export const MONTHS_PER_YEAR = 12;
export const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR;
/** Safety cap: max sim ticks processed per real frame (prevents spiral of death). */
export const MAX_TICKS_PER_UPDATE = 60;

// ---------------------------------------------------------------- history lengths
/** Length (in months) of monthly history arrays (finance, prices, stats). */
export const HISTORY_MONTHS = 36;
/** Length (in days) of daily history arrays. */
export const HISTORY_DAYS = 90;
export const MAX_NOTIFICATIONS = 200;
export const MAX_EVENT_HISTORY = 50;

// ---------------------------------------------------------------- map / render
/** World pixels per tile at zoom 1. Top-down square tiles. */
export const TILE_SIZE = 32;
/** Tiles per side of a render cache chunk. */
export const CHUNK_SIZE = 32;
export const MIN_MAP_SIZE = 32;
export const MAX_MAP_SIZE = 256;
export const MIN_ZOOM = 0.125;
export const MAX_ZOOM = 4;

// ---------------------------------------------------------------- ids
/** Id 0 means "none" everywhere (typed arrays, refs). Real ids start at 1. */
export const NONE = 0;
/** Company id reserved for public/city-owned infrastructure. */
export const PUBLIC_OWNER = 0;

// ---------------------------------------------------------------- storage keys
export const STORAGE_PREFIX = 'ig3.';
