/**
 * Save / load.
 *
 *  - serializeState / deserializeState: JSON with typed arrays encoded as
 *    { "$ta": "Uint8Array", "b64": "…" }. Envelope: { format, version, savedAt, info, state }.
 *  - Versioned: on load, migrations registered with registerMigration(from, fn)
 *    run in order until state.version === SAVE_VERSION.
 *  - localStorage slots (gzip-compressed + base64 when CompressionStream exists).
 *  - File export (download .ig3save) / import (gzip or plain JSON).
 *
 * Rules for state authors: only plain data + typed arrays (see types.ts).
 * Map/Set/Date/class instances will NOT survive a roundtrip.
 */
import { SAVE_VERSION, STORAGE_PREFIX } from './constants';
import { formatDate } from './format';
import type { GameState } from './types';

export const SAVE_FORMAT = 'ig3-save';
export const AUTOSAVE_SLOT = 'auto';

export interface SaveSlotInfo {
  slot: string;
  name: string;
  /** ISO real time. */
  savedAt: string;
  /** In-game date text. */
  gameDate: string;
  companyName: string;
  cash: number;
  version: number;
  /** Bytes stored. */
  size: number;
}

interface SaveEnvelope {
  format: typeof SAVE_FORMAT;
  version: number;
  savedAt: string;
  info: Omit<SaveSlotInfo, 'slot' | 'size'>;
  state: unknown;
}

// ---------------------------------------------------------------- typed array codec
type TypedArray =
  | Uint8Array
  | Int8Array
  | Uint16Array
  | Int16Array
  | Uint32Array
  | Int32Array
  | Float32Array
  | Float64Array
  | Uint8ClampedArray;

const TA_CTORS: Record<string, new (buf: ArrayBuffer) => TypedArray> = {
  Uint8Array,
  Int8Array,
  Uint16Array,
  Int16Array,
  Uint32Array,
  Int32Array,
  Float32Array,
  Float64Array,
  Uint8ClampedArray,
};

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function replacer(_key: string, value: unknown): unknown {
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const ta = value as TypedArray;
    const bytes = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);
    return { $ta: ta.constructor.name, b64: bytesToBase64(bytes) };
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return { $num: String(value) };
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object') {
    const v = value as { $ta?: string; b64?: string; $num?: string };
    if (typeof v.$ta === 'string' && typeof v.b64 === 'string') {
      const Ctor = TA_CTORS[v.$ta];
      if (!Ctor) throw new Error(`Nieznany typ tablicy w zapisie: ${v.$ta}`);
      const bytes = base64ToBytes(v.b64);
      return new Ctor(bytes.buffer as ArrayBuffer);
    }
    if (typeof v.$num === 'string' && Object.keys(v).length === 1) return Number(v.$num);
  }
  return value;
}

// ---------------------------------------------------------------- migrations
export type Migration = (state: Record<string, unknown>) => void;
const migrations = new Map<number, Migration>();

/** Register a migration that upgrades a state from `fromVersion` to `fromVersion + 1`. */
export function registerMigration(fromVersion: number, fn: Migration): void {
  migrations.set(fromVersion, fn);
}

function migrate(state: Record<string, unknown>): GameState {
  let v = typeof state.version === 'number' ? state.version : 0;
  if (v > SAVE_VERSION) throw new Error(`Zapis pochodzi z nowszej wersji gry (v${v}).`);
  while (v < SAVE_VERSION) {
    const m = migrations.get(v);
    if (!m) throw new Error(`Brak migracji zapisu z wersji ${v}.`);
    m(state);
    v++;
    state.version = v;
  }
  return state as unknown as GameState;
}

// ---------------------------------------------------------------- (de)serialize
export function slotInfoOf(state: GameState): Omit<SaveSlotInfo, 'slot' | 'size'> {
  const p = state.companies[state.playerCompanyId];
  return {
    name: state.meta.name,
    savedAt: new Date().toISOString(),
    gameDate: formatDate(state.time),
    companyName: p?.name ?? '',
    cash: p?.cash ?? 0,
    version: state.version,
  };
}

export function serializeState(state: GameState): string {
  const info = slotInfoOf(state);
  const env: SaveEnvelope = { format: SAVE_FORMAT, version: state.version, savedAt: info.savedAt, info, state };
  return JSON.stringify(env, replacer);
}

export function deserializeState(json: string): GameState {
  const env = JSON.parse(json, reviver) as Partial<SaveEnvelope>;
  if (env.format !== SAVE_FORMAT || !env.state || typeof env.state !== 'object') throw new Error('To nie jest plik zapisu Industry Giant 3.');
  return migrate(env.state as Record<string, unknown>);
}

// ---------------------------------------------------------------- compression
const hasCompression = (): boolean => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

export async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

// ---------------------------------------------------------------- storage
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let storageOverride: StorageLike | null = null;
/** Use a custom storage (tests). null = localStorage. */
export function setSaveStorage(s: StorageLike | null): void {
  storageOverride = s;
}
function storage(): StorageLike {
  const s = storageOverride ?? (globalThis.localStorage as StorageLike | undefined);
  if (!s) throw new Error('Brak localStorage');
  return s;
}

const slotKey = (slot: string): string => `${STORAGE_PREFIX}save.${slot}`;
const INDEX_KEY = `${STORAGE_PREFIX}saves`;

function readIndex(): SaveSlotInfo[] {
  try {
    return JSON.parse(storage().getItem(INDEX_KEY) ?? '[]') as SaveSlotInfo[];
  } catch {
    return [];
  }
}

/** Encode a state to the string stored in a slot ("gz:<base64>" or raw JSON). */
export async function encodeForStorage(state: GameState): Promise<string> {
  const json = serializeState(state);
  return hasCompression() ? `gz:${bytesToBase64(await gzip(json))}` : json;
}

export async function decodeFromStorage(raw: string): Promise<GameState> {
  const json = raw.startsWith('gz:') ? await gunzip(base64ToBytes(raw.slice(3))) : raw;
  return deserializeState(json);
}

/** Save to a localStorage slot. Updates state.meta.savedAt. Throws on quota errors (message in Polish). */
export async function saveToSlot(state: GameState, slot: string): Promise<SaveSlotInfo> {
  state.meta.savedAt = new Date().toISOString();
  const data = await encodeForStorage(state);
  try {
    storage().setItem(slotKey(slot), data);
  } catch {
    throw new Error('Brak miejsca w pamięci przeglądarki — usuń stare zapisy lub wyeksportuj grę do pliku.');
  }
  const info: SaveSlotInfo = { ...slotInfoOf(state), slot, size: data.length };
  const index = readIndex().filter((s) => s.slot !== slot);
  index.push(info);
  storage().setItem(INDEX_KEY, JSON.stringify(index));
  return info;
}

export async function loadFromSlot(slot: string): Promise<GameState> {
  const raw = storage().getItem(slotKey(slot));
  if (!raw) throw new Error(`Brak zapisu w slocie "${slot}".`);
  return decodeFromStorage(raw);
}

/** Slots sorted newest first. */
export function listSlots(): SaveSlotInfo[] {
  return readIndex().sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function hasSlot(slot: string): boolean {
  return readIndex().some((s) => s.slot === slot);
}

export function deleteSlot(slot: string): void {
  storage().removeItem(slotKey(slot));
  storage().setItem(INDEX_KEY, JSON.stringify(readIndex().filter((s) => s.slot !== slot)));
}

// ---------------------------------------------------------------- files
/** Trigger a browser download of the save (.ig3save, gzip if available). */
export async function exportToFile(state: GameState): Promise<void> {
  const json = serializeState(state);
  const body: BlobPart = hasCompression() ? ((await gzip(json)) as BlobPart) : json;
  const blob = new Blob([body], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safe = state.meta.name.replace(/[^\p{L}\p{N}_-]+/gu, '_');
  a.href = url;
  a.download = `${safe}_${state.time.year}-${String(state.time.month).padStart(2, '0')}.ig3save`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Parse an uploaded save file (gzip or JSON). */
export async function importFromFile(file: Blob): Promise<GameState> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  const json = isGzip ? await gunzip(bytes) : new TextDecoder().decode(bytes);
  return deserializeState(json);
}

/** Open a file picker and import the chosen save. Resolves null if cancelled. */
export function pickSaveFile(): Promise<GameState | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ig3save,.json,application/json,application/octet-stream';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      importFromFile(f).then(resolve, reject);
    };
    input.click();
  });
}
