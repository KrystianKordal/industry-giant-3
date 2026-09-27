/**
 * Procedural city houses (top-down, soft shadows to the south-east), drawn in
 * tile units into terrain chunks. Variation by density level (1 hut … 5 tower),
 * social class and a per-tile hash.
 */
import { shade } from '../util/color';
import { hashInt } from '../util/noise';
import { ROOFS, WALLS } from '../palette';

export type HouseClass = 'poor' | 'middle' | 'rich';

const SHADOW = 'rgba(30,34,44,0.26)';

function gable(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, roof: string, alongX: boolean, detail: boolean): void {
  // shadow
  g.fillStyle = SHADOW;
  g.fillRect(x + 0.045, y + 0.055, w, h);
  if (!detail) {
    g.fillStyle = roof;
    g.fillRect(x, y, w, h);
    return;
  }
  // lit half (north / west) and shaded half
  g.fillStyle = shade(roof, 1.08);
  g.fillRect(x, y, w, h);
  g.fillStyle = shade(roof, 0.8);
  if (alongX) g.fillRect(x, y + h / 2, w, h / 2);
  else g.fillRect(x + w / 2, y, w / 2, h);
  // ridge
  g.fillStyle = shade(roof, 1.25);
  if (alongX) g.fillRect(x + 0.02, y + h / 2 - 0.012, w - 0.04, 0.024);
  else g.fillRect(x + w / 2 - 0.012, y + 0.02, 0.024, h - 0.04);
  // eaves outline
  g.strokeStyle = shade(roof, 0.6);
  g.lineWidth = 0.015;
  g.strokeRect(x, y, w, h);
}

function flat(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, roof: string, height: number, detail: boolean, hs: number): void {
  g.fillStyle = SHADOW;
  g.beginPath();
  // skewed shadow polygon (building height → longer shadow)
  g.moveTo(x + w, y);
  g.lineTo(x + w + height, y + height * 1.15);
  g.lineTo(x + w + height, y + h + height * 1.15);
  g.lineTo(x + height, y + h + height * 1.15);
  g.lineTo(x, y + h);
  g.lineTo(x + w, y + h);
  g.closePath();
  g.fill();
  g.fillStyle = roof;
  g.fillRect(x, y, w, h);
  if (!detail) return;
  g.strokeStyle = shade(roof, 0.72);
  g.lineWidth = 0.03;
  g.strokeRect(x + 0.015, y + 0.015, w - 0.03, h - 0.03);
  // light edge (NW)
  g.fillStyle = shade(roof, 1.18);
  g.fillRect(x, y, w, 0.025);
  g.fillRect(x, y, 0.025, h);
  // rooftop boxes
  const n = 1 + (hs & 1);
  g.fillStyle = shade(roof, 0.85);
  for (let i = 0; i < n; i++) {
    const bx = x + 0.12 + (((hs >> (3 + i * 4)) & 15) / 15) * (w - 0.34);
    const by = y + 0.12 + (((hs >> (5 + i * 5)) & 15) / 15) * (h - 0.34);
    g.fillRect(bx, by, 0.1, 0.08);
  }
}

/**
 * Draw the house(s) of one tile at (tx,ty). level 1..5. `ppt` = canvas px per
 * tile (detail decisions). Coordinates in tile units.
 */
export function drawHouseTile(
  g: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  level: number,
  cls: HouseClass,
  ppt: number,
  winter: boolean,
): void {
  const h = hashInt(tx, ty, 77);
  const detail = ppt >= 16;
  const roofs = ROOFS[cls];
  const roof = roofs[h % roofs.length]!;
  const roof2 = roofs[(h >>> 7) % roofs.length]!;
  const snowRoof = (c: string): string => (winter ? shade(c, 1.55) : c);

  // gardens for low density
  if (level <= 2 && detail) {
    g.fillStyle = cls === 'rich' ? 'rgba(96,160,80,0.55)' : cls === 'middle' ? 'rgba(120,160,90,0.35)' : 'rgba(150,140,100,0.25)';
    g.fillRect(tx + 0.06, ty + 0.06, 0.88, 0.88);
    if (cls === 'rich') {
      g.strokeStyle = 'rgba(60,110,60,0.8)';
      g.lineWidth = 0.05;
      g.strokeRect(tx + 0.06, ty + 0.06, 0.88, 0.88);
    }
  }

  switch (level) {
    case 1: {
      const two = (h & 3) === 0;
      const cnt = two ? 2 : 1;
      for (let k = 0; k < cnt; k++) {
        const hk = hashInt(tx, ty, 91 + k);
        const alongX = (hk & 1) === 0;
        const w = alongX ? 0.36 + ((hk >> 2) & 7) * 0.012 : 0.28 + ((hk >> 5) & 7) * 0.01;
        const d = alongX ? 0.28 + ((hk >> 5) & 7) * 0.01 : 0.36 + ((hk >> 2) & 7) * 0.012;
        const ox = two ? (k === 0 ? 0.08 : 0.52) : 0.18 + ((hk >> 9) & 15) * 0.02;
        const oy = two ? (k === 0 ? 0.12 : 0.5) : 0.18 + ((hk >> 13) & 15) * 0.02;
        gable(g, tx + ox, ty + oy, Math.min(w, 0.9 - ox), Math.min(d, 0.9 - oy), snowRoof(k ? roof2 : roof), alongX, detail);
      }
      break;
    }
    case 2: {
      const alongX = (h & 1) === 0;
      const w = alongX ? 0.58 : 0.44;
      const d = alongX ? 0.42 : 0.58;
      const ox = 0.14 + ((h >> 3) & 7) * 0.02;
      const oy = 0.14 + ((h >> 6) & 7) * 0.02;
      gable(g, tx + ox, ty + oy, w, d, snowRoof(roof), alongX, detail);
      if ((h >> 10) & 1) {
        // wing (L-shape)
        if (alongX) gable(g, tx + ox + w - 0.2, ty + oy + d - 0.04, 0.2, 0.26, snowRoof(roof), false, detail);
        else gable(g, tx + ox + w - 0.04, ty + oy + d - 0.2, 0.26, 0.2, snowRoof(roof), true, detail);
      }
      if (cls === 'rich' && detail && (h >> 12) & 1) {
        g.fillStyle = '#6cc3e0';
        g.fillRect(tx + 0.66, ty + 0.7, 0.2, 0.14);
        g.strokeStyle = '#f2f2ee';
        g.lineWidth = 0.02;
        g.strokeRect(tx + 0.66, ty + 0.7, 0.2, 0.14);
      }
      break;
    }
    case 3: {
      const alongX = (h & 1) === 0;
      const rows = (h >> 4) & 1 ? 2 : 1;
      for (let r = 0; r < rows; r++) {
        const segs = 3;
        for (let s = 0; s < segs; s++) {
          const c = roofs[(h + s * 3 + r * 5) % roofs.length]!;
          if (alongX) {
            const y = ty + (rows === 2 ? 0.08 + r * 0.46 : 0.28);
            gable(g, tx + 0.07 + s * 0.29, y, 0.28, 0.38, snowRoof(c), true, detail);
          } else {
            const x = tx + (rows === 2 ? 0.08 + r * 0.46 : 0.28);
            gable(g, x, ty + 0.07 + s * 0.29, 0.38, 0.28, snowRoof(c), false, detail);
          }
        }
      }
      break;
    }
    case 4: {
      const alongX = (h & 1) === 0;
      const w = alongX ? 0.8 : 0.62;
      const d = alongX ? 0.62 : 0.8;
      const base = WALLS[h % WALLS.length]!;
      const roofC = winter ? '#eef2f4' : shade(base, 0.86);
      flat(g, tx + (1 - w) / 2 - 0.03, ty + (1 - d) / 2 - 0.03, w, d, roofC, 0.1, detail, h);
      break;
    }
    default: {
      // tower
      const s = 0.66;
      const x = tx + 0.14;
      const y = ty + 0.12;
      const glass = ['#8ea9c2', '#7f9fb8', '#a3b5c4', '#8fb2b0'][h & 3]!;
      flat(g, x, y, s, s, winter ? '#dfe7ec' : glass, 0.26, detail, h);
      if (detail) {
        g.fillStyle = shade(glass, 1.15);
        g.fillRect(x + 0.14, y + 0.14, s - 0.28, s - 0.28);
        g.strokeStyle = shade(glass, 0.75);
        g.lineWidth = 0.02;
        g.strokeRect(x + 0.14, y + 0.14, s - 0.28, s - 0.28);
        g.fillStyle = '#c0504a';
        g.beginPath();
        g.arc(x + s / 2, y + s / 2, 0.035, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
  }
}

/** Pick a house class for a tile given the city's class shares (rich/middle fractions). */
export function houseClassFor(tx: number, ty: number, richFrac: number, middleFrac: number, level: number): HouseClass {
  const r = (hashInt(tx, ty, 13) & 1023) / 1023;
  // towers and big blocks skew middle/rich, huts skew poor
  const bias = (level - 3) * 0.06;
  if (r < richFrac + Math.max(0, bias)) return 'rich';
  if (r < richFrac + middleFrac + bias) return 'middle';
  return 'poor';
}
