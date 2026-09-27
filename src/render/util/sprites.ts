/**
 * Small pre-rendered sprites (emoji glyphs, soft particles, glows). Drawing a
 * cached canvas with drawImage is much cheaper than fillText/gradients each frame.
 */

export type Sprite = HTMLCanvasElement;

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

// ---------------------------------------------------------------- emoji

const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const emojiCache = new Map<string, Sprite>();
/** Size buckets in device px (sprites are drawn scaled to any size). */
const EMOJI_BUCKETS = [16, 32, 64, 128];

/**
 * Emoji rendered to a canvas of about `px` device pixels (bucketed). Draw with
 * drawImage(sprite, x - s/2, y - s/2, s, s).
 */
export function emojiSprite(emoji: string, px: number): Sprite {
  let b = EMOJI_BUCKETS[EMOJI_BUCKETS.length - 1]!;
  for (const s of EMOJI_BUCKETS)
    if (s >= px) {
      b = s;
      break;
    }
  const key = `${b}|${emoji}`;
  let c = emojiCache.get(key);
  if (c) return c;
  c = makeCanvas(b, b);
  const g = c.getContext('2d')!;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `${Math.round(b * 0.8)}px ${EMOJI_FONT}`;
  g.fillText(emoji, b / 2, b / 2 + b * 0.05);
  emojiCache.set(key, c);
  return c;
}

/** Draw an emoji centered at (x, y) with size s (in current transform units); devicePx = s × scale. */
export function drawEmoji(g: CanvasRenderingContext2D, emoji: string, x: number, y: number, s: number, devicePx: number): void {
  if (!emoji) return;
  g.drawImage(emojiSprite(emoji, devicePx), x - s / 2, y - s / 2, s, s);
}

// ---------------------------------------------------------------- soft puffs / glows

const puffCache = new Map<string, Sprite>();

/** Soft round puff (radial gradient) of a colour; 64 px. */
export function puffSprite(color: string): Sprite {
  let c = puffCache.get(color);
  if (c) return c;
  c = makeCanvas(64, 64);
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, color);
  grd.addColorStop(0.55, color);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  // colour stops need alpha variants: draw gradient with alpha falloff
  g.fillStyle = grd;
  g.globalAlpha = 1;
  g.beginPath();
  g.arc(32, 32, 32, 0, Math.PI * 2);
  g.fill();
  // soften the plateau edge
  const c2 = makeCanvas(64, 64);
  const g2 = c2.getContext('2d')!;
  const m = g2.createRadialGradient(32, 32, 0, 32, 32, 32);
  m.addColorStop(0, 'rgba(0,0,0,1)');
  m.addColorStop(0.5, 'rgba(0,0,0,0.75)');
  m.addColorStop(1, 'rgba(0,0,0,0)');
  g2.fillStyle = m;
  g2.fillRect(0, 0, 64, 64);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(c2, 0, 0);
  g.globalCompositeOperation = 'source-over';
  puffCache.set(color, c);
  return c;
}

/** Additive glow sprite (bright centre → transparent). */
export function glowSprite(color: string): Sprite {
  const key = `glow|${color}`;
  let c = puffCache.get(key);
  if (c) return c;
  c = makeCanvas(64, 64);
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, color);
  grd.addColorStop(0.25, color.replace(/rgba?\(([^,]+),([^,]+),([^,)]+)(,[^)]+)?\)/, 'rgba($1,$2,$3,0.45)'));
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  puffCache.set(key, c);
  return c;
}

/** Generic helper to render a sprite once and cache it by key. */
const genericCache = new Map<string, Sprite>();
export function cachedSprite(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): Sprite {
  let c = genericCache.get(key);
  if (c) return c;
  c = makeCanvas(w, h);
  draw(c.getContext('2d')!, c.width, c.height);
  genericCache.set(key, c);
  return c;
}

export { makeCanvas };
