/**
 * Terrain layer (z=0): multi-LOD chunk-cached terrain.
 *  - per-pixel base: seasonal palette, organic terrain borders, smooth
 *    coastlines with shallows/foam/sand, hillshade, rock/snow/desert/swamp/
 *    farmland textures, fertility tint
 *  - vector details: rivers, deposit pebbles, mountain peaks, tree sprites,
 *    city houses (row-major so overlaps look right)
 * Invalidated by map:changed / network:changed (renderer), building:built/removed
 * and time:season (here).
 */
import { TILE_SIZE } from '../../core/constants';
import type { GameContext } from '../../core/context';
import { Terrain, TileFlag, type GameState, type Season } from '../../core/types';
import { drawHouseTile, houseClassFor } from '../art/houses';
import { TREE_SPAN, treeSprite, type TreeKind } from '../art/trees';
import { ChunkCache, type LodSpec } from '../chunkCache';
import { addPts, piecesFor } from '../netGeom';
import { RIVER_COLOR, terrainPalette, type TerrainPalette } from '../palette';
import type { LayerDef } from '../types';
import { shade } from '../util/color';
import { hash01, hashInt, noiseAt, noiseFast } from '../util/noise';

const LODS: LodSpec[] = [
  { ppt: 8, tiles: 32 },
  { ppt: 16, tiles: 32 },
  { ppt: 32, tiles: 32 },
  { ppt: 64, tiles: 16 },
];
/** Resolution of the per-pixel base per LOD (upscaled smoothly when lower than ppt). */
const BASE_PPT = [8, 12, 12, 24];

const MAXT = 34; // max chunk tiles + margin
const sLand = new Float32Array(MAXT * MAXT);
const sDepth = new Float32Array(MAXT * MAXT);
const sTerr = new Uint8Array(MAXT * MAXT);
const sUniform = new Uint8Array(MAXT * MAXT);
const sShade = new Float32Array(MAXT * MAXT);
const sElev = new Float32Array(MAXT * MAXT);
const sTmp = new Float32Array(MAXT * MAXT);

const imageCache = new Map<number, { img: ImageData; u32: Uint32Array; canvas: HTMLCanvasElement }>();
function baseBuffer(w: number, h: number): { img: ImageData; u32: Uint32Array; canvas: HTMLCanvasElement } {
  const k = w * 10000 + h;
  let b = imageCache.get(k);
  if (!b) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const img = new ImageData(w, h);
    b = { img, u32: new Uint32Array(img.data.buffer), canvas };
    imageCache.set(k, b);
  }
  return b;
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = x <= e0 ? 0 : x >= e1 ? 1 : (x - e0) / (e1 - e0);
  return t * t * (3 - 2 * t);
};

let seasonKey = '';

export function createTerrainLayer(ctx: GameContext): LayerDef {
  let pal: TerrainPalette = terrainPalette('summer', 'temperate');
  let season: Season = 'summer';

  const refreshPalette = (st: GameState): boolean => {
    const k = `${st.time.season}|${st.map.climate}`;
    if (k === seasonKey) return false;
    seasonKey = k;
    season = st.time.season;
    pal = terrainPalette(st.time.season, st.map.climate);
    return true;
  };

  // ------------------------------------------------------------------ base pass
  function renderBase(state: GameState, x0: number, y0: number, x1: number, y1: number, B: number): HTMLCanvasElement {
    const { map } = state;
    const W = map.width;
    const H = map.height;
    const tw = x1 - x0;
    const th = y1 - y0;
    const mw = tw + 2;
    const sea = map.seaLevel;
    // per-tile arrays incl. 1-tile margin
    for (let j = 0; j < th + 2; j++) {
      const ty = Math.min(H - 1, Math.max(0, y0 - 1 + j));
      for (let i = 0; i < mw; i++) {
        const tx = Math.min(W - 1, Math.max(0, x0 - 1 + i));
        const idx = ty * W + tx;
        const t = map.terrain[idx]!;
        const k = j * mw + i;
        sTerr[k] = t;
        const water = t === Terrain.DeepWater || t === Terrain.Water;
        sLand[k] = water ? 0 : 1;
        sDepth[k] = t === Terrain.DeepWater ? 1 : t === Terrain.Water ? 0.35 : 0;
        sElev[k] = Math.max(sea, map.elevation[idx]!);
      }
    }
    // water tiles take the mean elevation of adjacent land (no dark pits around lakes)
    for (let j = 0; j < th + 2; j++)
      for (let i = 0; i < mw; i++) {
        const k = j * mw + i;
        if (sLand[k]) continue;
        let sum = 0;
        let n = 0;
        if (i > 0 && sLand[k - 1]) (sum += sElev[k - 1]!), n++;
        if (i < mw - 1 && sLand[k + 1]) (sum += sElev[k + 1]!), n++;
        if (j > 0 && sLand[k - mw]) (sum += sElev[k - mw]!), n++;
        if (j < th + 1 && sLand[k + mw]) (sum += sElev[k + mw]!), n++;
        sTmp[k] = n ? sum / n : sea;
      }
    for (let k = 0; k < mw * (th + 2); k++) if (!sLand[k]) sElev[k] = sTmp[k]!;
    // uniform neighbourhood flags (skip jitter where all neighbours share terrain)
    for (let j = 1; j <= th; j++)
      for (let i = 1; i <= tw; i++) {
        const k = j * mw + i;
        const t = sTerr[k]!;
        sUniform[k] =
          sTerr[k - 1] === t && sTerr[k + 1] === t && sTerr[k - mw] === t && sTerr[k + mw] === t &&
          sTerr[k - mw - 1] === t && sTerr[k - mw + 1] === t && sTerr[k + mw - 1] === t && sTerr[k + mw + 1] === t
            ? 1
            : 0;
      }
    // corner shading grid (tw+1)×(th+1): corner (i,j) at tile coords (x0+i, y0+j)
    const cw = tw + 1;
    for (let j = 0; j <= th; j++)
      for (let i = 0; i <= tw; i++) {
        const a = sElev[j * mw + i]!; // tile (x0-1+i, y0-1+j) = NW of corner
        const b = sElev[j * mw + i + 1]!; // NE
        const c = sElev[(j + 1) * mw + i]!; // SW
        const d = sElev[(j + 1) * mw + i + 1]!; // SE
        const dEx = (b + d - a - c) * 0.5;
        const dEy = (c + d - a - b) * 0.5;
        const e = (a + b + c + d) * 0.25;
        let s = 1 + 0.0055 * (dEx + dEy) + ((e - sea) / 255) * 0.07;
        s = s < 0.62 ? 0.62 : s > 1.32 ? 1.32 : s;
        sShade[j * cw + i] = s;
      }

    const pw = tw * B;
    const ph = th * B;
    const buf = baseBuffer(pw, ph);
    const u32 = buf.u32;
    const invB = 1 / B;
    const P = pal;
    const snowCover = P.snowCover;
    const crops = P.crops;
    const fert = map.fertility;
    const forest = map.forest;
    const lod0 = B <= 8;

    for (let py = 0; py < ph; py++) {
      const fy = y0 + (py + 0.5) * invB;
      const v = fy - y0 + 0.5; // centre-grid coords (margin array)
      const iv = v | 0;
      const fv = v - iv;
      const cv = fy - y0; // corner-grid coords
      const icv = Math.min(th - 1, cv | 0);
      const fcv = cv - icv;
      const ownJ = ((py * invB) | 0) + 1;
      for (let px = 0; px < pw; px++) {
        const fx = x0 + (px + 0.5) * invB;
        const u = fx - x0 + 0.5;
        const iu = u | 0;
        const fu = u - iu;
        const k00 = iv * mw + iu;
        const l00 = sLand[k00]!;
        const l10 = sLand[k00 + 1]!;
        const l01 = sLand[k00 + mw]!;
        const l11 = sLand[k00 + mw + 1]!;
        let L = l00 + (l10 - l00) * fu + (l01 - l00) * fv + (l00 - l10 - l01 + l11) * fu * fv;
        if (L > 0.02 && L < 0.98) L += (noiseAt(fx * 7, fy * 7) - 0.5) * 0.3;
        // hillshade
        const cu = fx - x0;
        const icu = Math.min(tw - 1, cu | 0);
        const fcu = cu - icu;
        const c00 = icv * cw + icu;
        const s00 = sShade[c00]!;
        const s10 = sShade[c00 + 1]!;
        const s01 = sShade[c00 + cw]!;
        const s11 = sShade[c00 + cw + 1]!;
        let sh = s00 + (s10 - s00) * fcu + (s01 - s00) * fcv + (s00 - s10 - s01 + s11) * fcu * fcv;
        const grain = noiseFast(px + x0 * B, py + y0 * B);
        const macro = noiseAt(fx * 1.3, fy * 1.3);
        let r: number, g: number, b: number;
        if (L < 0.5) {
          // ---------------- water
          const d00 = sDepth[k00]!;
          const d10 = sDepth[k00 + 1]!;
          const d01 = sDepth[k00 + mw]!;
          const d11 = sDepth[k00 + mw + 1]!;
          const D = d00 + (d10 - d00) * fu + (d01 - d00) * fv + (d00 - d10 - d01 + d11) * fu * fv;
          const t = smooth(0.2, 0.95, D + (macro - 0.5) * 0.25);
          r = P.shallow[0] + (P.deep[0] - P.shallow[0]) * t;
          g = P.shallow[1] + (P.deep[1] - P.shallow[1]) * t;
          b = P.shallow[2] + (P.deep[2] - P.shallow[2]) * t;
          if (L > 0.28) {
            const m = ((L - 0.28) / 0.22) * 0.75;
            r += (P.shallowLight[0] - r) * m;
            g += (P.shallowLight[1] - g) * m;
            b += (P.shallowLight[2] - b) * m;
          }
          if (L > 0.455) {
            const m = Math.min(1, (L - 0.455) / 0.045) * 0.7;
            r += (P.foam[0] - r) * m;
            g += (P.foam[1] - g) * m;
            b += (P.foam[2] - b) * m;
          }
          sh = 0.97 + grain * 0.06;
        } else {
          // ---------------- land: pick (jittered) source tile
          let sj = ownJ;
          let si = ((px * invB) | 0) + 1;
          if (!sUniform[sj * mw + si]) {
            const jx = (noiseAt(fx * 19, fy * 19) - 0.5) * 0.9 + (noiseAt(fx * 5.3, fy * 5.3) - 0.5) * 0.3;
            const jy = (noiseAt(fy * 19 + 91.7, fx * 19 + 37.1) - 0.5) * 0.9 + (noiseAt(fy * 5.3 + 11.3, fx * 5.3 + 7.9) - 0.5) * 0.3;
            const ji = Math.floor(fx + jx) - x0 + 1;
            const jj = Math.floor(fy + jy) - y0 + 1;
            if (ji >= 0 && jj >= 0 && ji < mw && jj < th + 2 && sLand[jj * mw + ji]) {
              si = ji;
              sj = jj;
            }
          }
          const k = sj * mw + si;
          let t = sTerr[k]!;
          if (!sLand[k]) t = Terrain.Beach;
          const stx = Math.min(W - 1, Math.max(0, x0 - 1 + si));
          const sty = Math.min(H - 1, Math.max(0, y0 - 1 + sj));
          const tIdx = sty * W + stx;
          let snowable = 1;
          switch (t) {
            case Terrain.Grass: {
              const f = fert[tIdx]! / 255;
              r = P.grassDry[0] + (P.grassLush[0] - P.grassDry[0]) * f;
              g = P.grassDry[1] + (P.grassLush[1] - P.grassDry[1]) * f;
              b = P.grassDry[2] + (P.grassLush[2] - P.grassDry[2]) * f;
              break;
            }
            case Terrain.Forest: {
              r = P.forestFloor[0];
              g = P.forestFloor[1];
              b = P.forestFloor[2];
              if (lod0) {
                const dens = forest[tIdx]! / 255;
                const n = noiseFast(px * 3.1 + x0 * 24, py * 3.1 + y0 * 24);
                if (n < 0.35 + dens * 0.35) {
                  r *= 0.72;
                  g *= 0.8;
                  b *= 0.72;
                } else if (n > 0.85) {
                  r *= 1.12;
                  g *= 1.1;
                  b *= 1.05;
                }
              }
              break;
            }
            case Terrain.Hills:
              r = P.hills[0];
              g = P.hills[1];
              b = P.hills[2];
              break;
            case Terrain.Mountain: {
              const n = noiseAt(fx * 4.1, fy * 4.1);
              const n2 = noiseAt(fx * 17, fy * 17);
              const m = 0.86 + n * 0.2 + (n2 - 0.5) * 0.16;
              const dk = smooth(0.62, 0.8, n2) * 0.45;
              r = (P.rock[0] + (P.rockDark[0] - P.rock[0]) * dk) * m;
              g = (P.rock[1] + (P.rockDark[1] - P.rock[1]) * dk) * m;
              b = (P.rock[2] + (P.rockDark[2] - P.rock[2]) * dk) * m;
              // snow caps by (bilinear) elevation
              const e00 = sElev[k00]!;
              const e10 = sElev[k00 + 1]!;
              const e01 = sElev[k00 + mw]!;
              const e11 = sElev[k00 + mw + 1]!;
              const E = e00 + (e10 - e00) * fu + (e01 - e00) * fv + (e00 - e10 - e01 + e11) * fu * fv - sea;
              const cap = smooth(185, 200, E + (n - 0.5) * 50 + snowCover * 60);
              if (cap > 0) {
                r += (P.snow[0] - r) * cap;
                g += (P.snow[1] - g) * cap;
                b += (P.snow[2] - b) * cap;
              }
              sh = 1 + (sh - 1) * 1.5;
              break;
            }
            case Terrain.Desert: {
              const rip = Math.sin((fx * 0.8 + fy * 0.55) * 9 + macro * 7) * 0.035;
              r = P.desert[0] * (1 + rip);
              g = P.desert[1] * (1 + rip);
              b = P.desert[2] * (1 + rip);
              snowable = 0;
              break;
            }
            case Terrain.Snow:
              r = P.snow[0];
              g = P.snow[1];
              b = P.snow[2];
              snowable = 0;
              break;
            case Terrain.Swamp: {
              const n = noiseAt(fx * 3.7, fy * 3.7);
              if (n < 0.34) {
                r = P.swampWater[0];
                g = P.swampWater[1];
                b = P.swampWater[2];
              } else {
                r = P.swamp[0];
                g = P.swamp[1];
                b = P.swamp[2];
              }
              break;
            }
            case Terrain.Farmland: {
              const fh = hashInt(stx >> 1, sty >> 1, 5);
              const c = crops[fh % crops.length]!;
              const along = (fh >> 8) & 1;
              const stripe = ((along ? fx : fy) * 6) % 1 < 0.45 ? 0.9 : 1.02;
              r = c[0] * stripe;
              g = c[1] * stripe;
              b = c[2] * stripe;
              // field border
              const lx = fx - (stx & ~1);
              const ly = fy - (sty & ~1);
              if (lx < 0.05 || ly < 0.05) {
                r *= 0.82;
                g *= 0.86;
                b *= 0.8;
              }
              break;
            }
            case Terrain.Urban:
              r = P.urban[0];
              g = P.urban[1];
              b = P.urban[2];
              snowable = 0.6;
              break;
            default:
              r = P.sand[0];
              g = P.sand[1];
              b = P.sand[2];
              snowable = 0.3;
          }
          // coastal sand band
          if (L < 0.6 && t !== Terrain.Urban) {
            const m = ((0.6 - L) / 0.1) * 0.85;
            r += (P.sand[0] - r) * m;
            g += (P.sand[1] - g) * m;
            b += (P.sand[2] - b) * m;
          }
          // winter snow cover
          if (snowCover > 0 && snowable > 0) {
            const s = smooth(0.35, 0.5, snowCover * snowable + (macro - 0.5) * 0.5 + (grain - 0.5) * 0.12);
            r += (P.snow[0] - r) * s;
            g += (P.snow[1] - g) * s;
            b += (P.snow[2] - b) * s;
          }
          const vmul = 0.94 + macro * 0.1 + (grain - 0.5) * 0.05;
          r *= vmul;
          g *= vmul;
          b *= vmul;
        }
        r *= sh;
        g *= sh;
        b *= sh;
        u32[py * pw + px] =
          0xff000000 | ((b > 255 ? 255 : b < 0 ? 0 : b) << 16) | ((g > 255 ? 255 : g < 0 ? 0 : g) << 8) | (r > 255 ? 255 : r < 0 ? 0 : r);
      }
    }
    const cg = buf.canvas.getContext('2d')!;
    cg.putImageData(buf.img, 0, 0);
    return buf.canvas;
  }

  // ------------------------------------------------------------------ vector pass
  function drawDetails(g: CanvasRenderingContext2D, state: GameState, x0: number, y0: number, x1: number, y1: number, P: number): void {
    const { map, network } = state;
    const W = map.width;
    const H = map.height;
    g.setTransform(P, 0, 0, P, -x0 * P, -y0 * P);
    const winter = pal.snowCover > 0;

    // rivers
    const isWater = (i: number): boolean => map.terrain[i]! <= Terrain.Water;
    const riverOrWater = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= W || y >= H) return false;
      const i = y * W + x;
      return (map.flags[i]! & TileFlag.River) !== 0 || isWater(i);
    };
    let anyRiver = false;
    const river = new Path2D();
    const nodes: number[] = [];
    const isRiver = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H && (map.flags[y * W + x]! & TileFlag.River) !== 0 && !isWater(y * W + x);
    const waterAt = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H && isWater(y * W + x);
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = y * W + x;
        if (!(map.flags[i]! & TileFlag.River) || isWater(i)) continue;
        anyRiver = true;
        let m = 0;
        if (isRiver(x, y - 1)) m |= 1;
        if (isRiver(x + 1, y)) m |= 2;
        if (isRiver(x, y + 1)) m |= 4;
        if (isRiver(x - 1, y)) m |= 8;
        // river mouth: only river ends flow into one adjacent water tile
        const bits = (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
        if (bits <= 1) {
          if (waterAt(x, y + 1) && !(m & 4)) m |= 4;
          else if (waterAt(x + 1, y) && !(m & 2)) m |= 2;
          else if (waterAt(x - 1, y) && !(m & 8)) m |= 8;
          else if (waterAt(x, y - 1) && !(m & 1)) m |= 1;
        }
        const pcs = piecesFor(m);
        if (!pcs.length || pcs.some((p) => p.arm)) nodes.push(x + 0.5, y + 0.5);
        for (const p of pcs) addPts(river, p.pts, x, y, 1);
      }
    if (anyRiver) {
      const wc = winter ? '#9cc4dc' : RIVER_COLOR;
      g.lineCap = 'butt';
      g.lineJoin = 'round';
      const pass = (color: string, width: number): void => {
        g.strokeStyle = color;
        g.lineWidth = width;
        g.stroke(river);
        g.fillStyle = color;
        g.beginPath();
        for (let k = 0; k < nodes.length; k += 2) {
          g.moveTo(nodes[k]! + width / 2, nodes[k + 1]!);
          g.arc(nodes[k]!, nodes[k + 1]!, width / 2, 0, Math.PI * 2);
        }
        g.fill();
      };
      pass(winter ? '#b9c9c4' : '#6f9a5e', 0.56);
      pass(wc, 0.38);
      if (P >= 16) {
        g.strokeStyle = 'rgba(255,255,255,0.2)';
        g.lineWidth = 0.07;
        g.stroke(river);
      }
    }
    if (P < 16) {
      // LOD 0: houses as simple blocks only
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = y * W + x;
          const lv = map.house[i]!;
          if (!lv || map.building[i]) continue;
          g.fillStyle = lv >= 4 ? (lv === 5 ? '#8ea3b6' : '#c4bfb6') : '#b87a5c';
          const pad = lv >= 4 ? 0.12 : 0.2;
          g.fillRect(x + pad, y + pad, 1 - pad * 2, 1 - pad * 2);
        }
      return;
    }

    // deposits (subtle pebbles)
    const depCols: string[] = [];
    for (let d = 1; d < map.depositTypes.length; d++) depCols[d] = ctx.data.deposits[map.depositTypes[d]!]?.color ?? '#777';
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = y * W + x;
        const d = map.deposit[i]!;
        if (!d || map.building[i] || map.house[i] || network.road[i] || network.rail[i]) continue;
        if (map.depositAmount[i]! <= 0) continue;
        const col = depCols[d] ?? '#777';
        const h = hashInt(x, y, 33);
        for (let k = 0; k < 3; k++) {
          const px = x + 0.2 + (((h >> (k * 6)) & 63) / 63) * 0.6;
          const py = y + 0.2 + (((h >> (k * 6 + 3)) & 63) / 63) * 0.6;
          const r = 0.05 + ((h >> (k * 3 + 20)) & 3) * 0.015;
          g.fillStyle = 'rgba(0,0,0,0.25)';
          g.beginPath();
          g.ellipse(px + 0.02, py + 0.025, r, r * 0.8, 0, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = col;
          g.beginPath();
          g.ellipse(px, py, r, r * 0.8, 0, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = 'rgba(255,255,255,0.35)';
          g.beginPath();
          g.arc(px - r * 0.3, py - r * 0.3, r * 0.35, 0, Math.PI * 2);
          g.fill();
        }
      }

    // trees, peaks & houses — row-major incl. 1-tile margin (overhang)
    const climate = map.climate;
    const coniferBase = climate === 'arctic' ? 0.85 : climate === 'continental' ? 0.55 : climate === 'temperate' ? 0.25 : climate === 'arid' ? 0.1 : 0;
    const tropical = climate === 'tropical';
    const trees = pal.trees;
    const conifers = pal.conifers;
    const bareDeciduous = season === 'winter' && pal.snowCover > 0;
    const cityShare = new Map<number, [number, number]>();
    const sea = map.seaLevel;
    const tx0 = Math.max(0, x0 - 1);
    const ty0 = Math.max(0, y0 - 1);
    const tx1 = Math.min(W, x1 + 1);
    const ty1 = Math.min(H, y1 + 1);
    const tree = (x: number, y: number, kind: TreeKind, color: string, size: number): void => {
      const spr = treeSprite(P, kind, color, winter);
      const s = TREE_SPAN * size;
      g.drawImage(spr, x - s / 2, y - s / 2, s, s);
    };
    for (let y = ty0; y < ty1; y++)
      for (let x = tx0; x < tx1; x++) {
        const i = y * W + x;
        if (map.building[i] || network.road[i] || network.rail[i] || (map.flags[i]! & TileFlag.River)) continue;
        const lv = map.house[i]!;
        if (lv) {
          const cid = map.city[i]!;
          let share = cityShare.get(cid);
          if (!share) {
            const c = state.cities[cid];
            const tot = c ? c.population.poor + c.population.middle + c.population.rich : 0;
            share = tot > 0 && c ? [c.population.rich / tot, c.population.middle / tot] : [0.1, 0.4];
            cityShare.set(cid, share);
          }
          drawHouseTile(g, x, y, lv, houseClassFor(x, y, share[0], share[1], lv), P, winter);
          continue;
        }
        const t = map.terrain[i]!;
        if (t <= Terrain.Water) continue;
        const h = hashInt(x, y, 7);
        const hf = (h & 1023) / 1023;
        let n = 0;
        switch (t) {
          case Terrain.Forest:
            n = 2 + Math.round((map.forest[i]! / 255) * 3);
            break;
          case Terrain.Hills:
            n = hf < 0.22 ? 1 + (h >> 12 & 1) : 0;
            break;
          case Terrain.Grass:
            n = hf < 0.025 ? 1 : 0;
            break;
          case Terrain.Swamp:
            n = hf < 0.45 ? 1 + (h >> 12 & 1) : 0;
            break;
          case Terrain.Snow:
            n = hf < 0.12 ? 1 : 0;
            break;
          case Terrain.Beach:
            n = tropical && hf < 0.3 ? 1 : 0;
            break;
          case Terrain.Desert:
            n = hf < 0.03 ? 1 : 0;
            break;
          case Terrain.Urban:
            n = hf < 0.12 ? 1 : 0;
            break;
          case Terrain.Mountain: {
            const e = map.elevation[i]! - sea;
            if (e < 150 && hf < 0.12) n = 1;
            // peaks
            if (hf > 0.55) {
              const cx = x + 0.5 + (((h >> 10) & 15) / 15 - 0.5) * 0.3;
              const cy = y + 0.55 + (((h >> 14) & 15) / 15 - 0.5) * 0.3;
              const s = 0.34 + ((h >> 18) & 7) * 0.03;
              g.fillStyle = 'rgba(40,36,34,0.18)';
              g.beginPath();
              g.moveTo(cx - s, cy + s * 0.45);
              g.lineTo(cx, cy - s * 0.75);
              g.lineTo(cx + s * 1.1, cy + s * 0.5);
              g.closePath();
              g.fill();
              g.fillStyle = 'rgba(255,255,255,0.16)';
              g.beginPath();
              g.moveTo(cx - s, cy + s * 0.45);
              g.lineTo(cx, cy - s * 0.75);
              g.lineTo(cx - s * 0.1, cy + s * 0.45);
              g.closePath();
              g.fill();
              if (e > 150 || winter) {
                g.fillStyle = 'rgba(248,250,252,0.9)';
                g.beginPath();
                g.moveTo(cx - s * 0.32, cy - s * 0.35);
                g.lineTo(cx, cy - s * 0.75);
                g.lineTo(cx + s * 0.36, cy - s * 0.33);
                g.lineTo(cx + s * 0.05, cy - s * 0.42);
                g.closePath();
                g.fill();
              }
            }
            break;
          }
        }
        if (!n) continue;
        const elevK = Math.min(1, Math.max(0, (map.elevation[i]! - sea - 90) / 120));
        for (let k = 0; k < n; k++) {
          const hk = hashInt(x, y, 100 + k);
          const px = x + 0.16 + ((hk & 255) / 255) * 0.68;
          const py = y + 0.16 + (((hk >> 8) & 255) / 255) * 0.68;
          const size = 0.72 + (((hk >> 16) & 63) / 63) * 0.5;
          let kind: TreeKind;
          let color: string;
          if (t === Terrain.Beach) {
            kind = 'palm';
            color = '#5f9a48';
          } else if (t === Terrain.Desert) {
            kind = 'cactus';
            color = '#5f8f4a';
          } else if (t === Terrain.Swamp) {
            kind = (hk >> 24) & 1 ? 'bush' : 'round';
            color = shade(trees[(hk >>> 26) % trees.length]!, 0.8);
          } else if (hash01(x * 7 + k, y * 3, 9) < coniferBase + elevK * 0.5 || t === Terrain.Snow) {
            kind = 'cone';
            color = conifers[(hk >>> 24) % conifers.length]!;
          } else if (bareDeciduous) {
            kind = 'bare';
            color = '#7c6a58';
          } else {
            kind = t === Terrain.Urban || (t !== Terrain.Forest && (hk >> 23) & 1) ? 'bush' : 'round';
            color = trees[(hk >>> 24) % trees.length]!;
          }
          tree(px, py, kind, color, size);
        }
      }
  }

  const drawChunk = (g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, state: GameState, ppt: number, lod: number): void => {
    refreshPalette(state);
    const B = BASE_PPT[lod] ?? 16;
    const base = renderBase(state, x0, y0, x1, y1, B);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(base, 0, 0, (x1 - x0) * B, (y1 - y0) * B, 0, 0, (x1 - x0) * ppt, (y1 - y0) * ppt);
    drawDetails(g, state, x0, y0, x1, y1, ppt);
  };

  const cache = new ChunkCache({ lods: LODS, drawChunk, budgetMs: 7, maxPixels: 28e6 });
  terrainCacheRef = cache;

  const inv = (x: number, y: number, w: number, h: number): void => cache.invalidate({ x: x - 1, y: y - 1, w: w + 2, h: h + 2 });
  ctx.bus.on('building:built', ({ buildingId }) => {
    const b = ctx.tryState()?.buildings[buildingId];
    if (b) inv(b.x, b.y, b.w, b.h);
  });
  ctx.bus.on('building:removed', (e) => inv(e.x, e.y, e.w, e.h));
  ctx.bus.on('time:season', () => {
    const st = ctx.tryState();
    if (st && refreshPalette(st)) cache.invalidate(null);
  });
  ctx.bus.on('game:started', ({ state }) => {
    seasonKey = '';
    refreshPalette(state);
    cache.reset();
  });

  return {
    id: 'terrain',
    z: 0,
    draw: (rc) => {
      const { g, state } = rc;
      if (refreshPalette(state)) cache.invalidate(null);
      // soft drop shadow around the map
      const mw = state.map.width * TILE_SIZE;
      const mh = state.map.height * TILE_SIZE;
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(TILE_SIZE * 0.4, TILE_SIZE * 0.5, mw, mh);
      cache.draw(rc);
    },
    invalidate: (r) => cache.invalidate(r),
  };
}

/** Terrain cache (for perf stats in the debug overlay). */
export let terrainCacheRef: ChunkCache | null = null;
