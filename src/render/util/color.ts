/**
 * Colour helpers for the renderer. Parsing is cached so per-frame code can
 * call these with CSS strings without re-parsing / allocating every frame.
 */

export type RGB = [number, number, number];

const parseCache = new Map<string, RGB>();

/** Parse '#rgb', '#rrggbb', 'rgb(r,g,b)' / 'rgba(…)' into [r,g,b] (cached). Unknown → magenta. */
const FALLBACK: RGB = [128, 128, 128];

export function parseColor(c: string): RGB {
  // defensive: a missing colour (bad mod data, undefined palette entry) must never throw in a draw loop
  if (typeof c !== 'string' || !c) return FALLBACK;
  let v = parseCache.get(c);
  if (v) return v;
  v = [255, 0, 255];
  const s = c.trim();
  if (s[0] === '#') {
    if (s.length === 4) {
      v = [parseInt(s[1]! + s[1], 16), parseInt(s[2]! + s[2], 16), parseInt(s[3]! + s[3], 16)];
    } else if (s.length >= 7) {
      const n = parseInt(s.slice(1, 7), 16);
      v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
  } else {
    const m = /rgba?\(([^)]+)\)/.exec(s);
    if (m) {
      const p = m[1]!.split(',').map((x) => parseFloat(x));
      v = [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];
    }
  }
  parseCache.set(c, v);
  return v;
}

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

export const rgbStr = (r: number, g: number, b: number): string => `rgb(${clamp255(r)},${clamp255(g)},${clamp255(b)})`;
export const rgbaStr = (r: number, g: number, b: number, a: number): string =>
  `rgba(${clamp255(r)},${clamp255(g)},${clamp255(b)},${a < 0 ? 0 : a > 1 ? 1 : +a.toFixed(3)})`;

export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const derivedCache = new Map<string, string>();

/** Multiply brightness (k<1 darker, k>1 lighter towards white). Cached by (color,k). */
export function shade(color: string, k: number): string {
  const key = `s|${color}|${k}`;
  let r = derivedCache.get(key);
  if (r) return r;
  const [R, G, B] = parseColor(color);
  if (k <= 1) r = rgbStr(R * k, G * k, B * k);
  else {
    const t = Math.min(1, k - 1);
    r = rgbStr(R + (255 - R) * t, G + (255 - G) * t, B + (255 - B) * t);
  }
  derivedCache.set(key, r);
  return r;
}

/** Colour with alpha. Cached. */
export function alpha(color: string, a: number): string {
  const q = Math.round(a * 100);
  const key = `a|${color}|${q}`;
  let r = derivedCache.get(key);
  if (r) return r;
  const [R, G, B] = parseColor(color);
  r = rgbaStr(R, G, B, q / 100);
  derivedCache.set(key, r);
  return r;
}

/** Mix two CSS colours. Cached. */
export function mix(a: string, b: string, t: number): string {
  const q = Math.round(t * 100);
  const key = `m|${a}|${b}|${q}`;
  let r = derivedCache.get(key);
  if (r) return r;
  const A = parseColor(a);
  const B = parseColor(b);
  const m = mixRgb(A, B, q / 100);
  r = rgbStr(m[0], m[1], m[2]);
  derivedCache.set(key, r);
  return r;
}

/** Perceived luminance 0..1. */
export function luminance(color: string): number {
  const [r, g, b] = parseColor(color);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Colour ramp: stops sorted by t in 0..1 → packed RGBA lookup table of 256 entries. */
export function buildRamp(stops: { t: number; color: string; a?: number }[]): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1]!.t) k++;
    const s0 = stops[k]!;
    const s1 = stops[Math.min(stops.length - 1, k + 1)]!;
    const span = s1.t - s0.t || 1;
    const f = Math.max(0, Math.min(1, (t - s0.t) / span));
    const c0 = parseColor(s0.color);
    const c1 = parseColor(s1.color);
    const a0 = s0.a ?? 1;
    const a1 = s1.a ?? 1;
    lut[i * 4] = c0[0] + (c1[0] - c0[0]) * f;
    lut[i * 4 + 1] = c0[1] + (c1[1] - c0[1]) * f;
    lut[i * 4 + 2] = c0[2] + (c1[2] - c0[2]) * f;
    lut[i * 4 + 3] = (a0 + (a1 - a0) * f) * 255;
  }
  return lut;
}

/** CSS colour of a ramp at t (0..1). */
export function rampColor(lut: Uint8ClampedArray, t: number, a = 1): string {
  const i = Math.max(0, Math.min(255, Math.round(t * 255))) * 4;
  return rgbaStr(lut[i]!, lut[i + 1]!, lut[i + 2]!, a);
}
