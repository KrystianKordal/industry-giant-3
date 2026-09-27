/**
 * City name generation (Polish-sounding). Uses data/names.ts CITY_NAMES first,
 * then this module's extra pool, then compound names (Nowy/Stary …, … Wielki/Mały,
 * … nad Wisłą) — always unique within a game.
 */
import { CITY_NAMES } from '../data/names';
import type { Rng } from '../core/rng';

export const EXTRA_CITY_NAMES: string[] = [
  'Zielonka', 'Kamionka', 'Wolbórz', 'Ostrołęka', 'Radomyśl', 'Białobrzegi', 'Sokołów', 'Mielnik', 'Przemęt', 'Trzebnica',
  'Czarnków', 'Wieluń', 'Zawichost', 'Gniewkowo', 'Kłodawa', 'Sieradz', 'Łęczyca', 'Opatów', 'Grabów', 'Żuromin',
  'Pilica', 'Bolesławiec', 'Chełmno', 'Dobrzyń', 'Golub', 'Koprzywnica', 'Lubomierz', 'Mszczonów', 'Nieszawa', 'Olkusz',
  'Pyzdry', 'Rypin', 'Sławków', 'Tuchola', 'Wąchock', 'Zbąszyń', 'Żarnów', 'Bodzentyn', 'Ciechanowiec', 'Drohiczyn',
  'Frampol', 'Gorzów', 'Iłża', 'Jedlnia', 'Kazimierz', 'Łobżenica', 'Mogilno', 'Nowogród', 'Osieck', 'Połaniec',
  'Rogoźno', 'Szadek', 'Tykocin', 'Uniejów', 'Warka', 'Zakroczym', 'Brodnica', 'Chęciny', 'Dąbrowa', 'Głogów',
  'Hrubieszów', 'Jarocin', 'Koło', 'Lipno', 'Miastko', 'Nakło', 'Oborniki', 'Pleszew', 'Raciąż', 'Skępe',
  'Tarnogród', 'Wągrowiec', 'Zduny', 'Źrebce', 'Kowalewo', 'Strzelno', 'Mirosławiec', 'Czersk', 'Lubawa', 'Sępólno',
];

const PREFIXES = ['Nowy', 'Stary', 'Górny', 'Dolny'];
const SUFFIXES = ['Wielki', 'Mały', 'Górny', 'Dolny', 'Nowy'];
const RIVERS = ['nad Wisłą', 'nad Odrą', 'nad Wartą', 'nad Bugiem', 'nad Pilicą', 'nad Narwią', 'nad Sanem'];

const feminine = (base: string): boolean => /[aą]$/.test(base);
const neuter = (base: string): boolean => /[oe]$/.test(base);

function adjust(adj: string, base: string): string {
  if (feminine(base)) return adj.replace(/y$/, 'a').replace(/i$/, 'a');
  if (neuter(base)) return adj.replace(/y$/, 'e').replace(/i$/, 'ie');
  return adj;
}

/** Produce `count` unique city names (deterministic for the rng stream). */
export function generateCityNames(r: Rng, count: number, taken: readonly string[] = []): string[] {
  const used = new Set(taken);
  const out: string[] = [];
  const pool = r.shuffle([...CITY_NAMES, ...EXTRA_CITY_NAMES]);
  for (const n of pool) {
    if (out.length >= count) break;
    if (used.has(n)) continue;
    used.add(n);
    out.push(n);
  }
  let guard = 0;
  while (out.length < count && guard++ < 10000) {
    const base = r.pick(EXTRA_CITY_NAMES);
    const kind = r.int(0, 2);
    const name =
      kind === 0 ? `${adjust(r.pick(PREFIXES), base)} ${base}` : kind === 1 ? `${base} ${adjust(r.pick(SUFFIXES), base)}` : `${base} ${r.pick(RIVERS)}`;
    if (used.has(name)) continue;
    used.add(name);
    out.push(name);
  }
  while (out.length < count) out.push(`Osada ${out.length + 1}`);
  return out;
}
