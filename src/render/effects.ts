/**
 * Particle effects (smoke, steam, dust, sparkles, splashes, coins) and floating
 * texts/icons. Pooled struct-of-arrays — no per-frame allocations.
 *
 * Public: ctx.renderer.effect(kind, x, y, opts) with x/y in TILE units
 * (fractional; tile centre = x+0.5). Game events spawn effects automatically
 * (construction dust, completion sparkles, delivery "+zł" texts, production pops).
 */
import { TILE_SIZE } from '../core/constants';
import type { GameContext } from '../core/context';
import { formatMoney } from '../core/format';
import type { EffectKind, EffectOptions, LayerDef, RenderContext } from './types';
import { drawEmoji, puffSprite, type Sprite } from './util/sprites';

const T = TILE_SIZE;
const CAP = 3000;
const K_SMOKE = 0;
const K_STEAM = 1;
const K_DUST = 2;
const K_SPARKLE = 3;
const K_SPLASH = 4;
const K_COIN = 5;
const K_DARK = 6;

const SPRITE_COLORS = ['rgba(120,118,116,1)', 'rgba(250,250,252,1)', 'rgba(190,165,120,1)', 'rgba(255,236,150,1)', 'rgba(200,232,248,1)', 'rgba(255,210,70,1)', 'rgba(70,68,66,1)'];

interface FloatText {
  active: boolean;
  x: number;
  y: number;
  t: number;
  max: number;
  text: string;
  icon: boolean;
  color: string;
  scale: number;
}

export class Effects {
  private x = new Float32Array(CAP);
  private y = new Float32Array(CAP);
  private vx = new Float32Array(CAP);
  private vy = new Float32Array(CAP);
  private life = new Float32Array(CAP);
  private max = new Float32Array(CAP);
  private size = new Float32Array(CAP);
  private grow = new Float32Array(CAP);
  private a0 = new Float32Array(CAP);
  private kind = new Uint8Array(CAP);
  private n = 0;
  private sprites: Sprite[] | null = null;
  readonly texts: FloatText[] = [];
  /** Wind drift in world px / s (set from weather). */
  windX = 6;
  windY = -1;

  get count(): number {
    return this.n;
  }

  clear(): void {
    this.n = 0;
    for (const t of this.texts) t.active = false;
  }

  /** Low-level particle spawn in WORLD px. */
  particle(kind: number, wx: number, wy: number, vx: number, vy: number, life: number, size: number, grow: number, alpha: number): void {
    let i = this.n;
    if (i >= CAP) {
      // overwrite the oldest-ish slot
      i = (Math.random() * CAP) | 0;
    } else this.n++;
    this.x[i] = wx;
    this.y[i] = wy;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = 0;
    this.max[i] = life;
    this.size[i] = size;
    this.grow[i] = grow;
    this.a0[i] = alpha;
    this.kind[i] = kind;
  }

  /** Chimney smoke puff at world px. dark = heavy industry. */
  smoke(wx: number, wy: number, scale = 1, dark = false): void {
    this.particle(dark ? K_DARK : K_SMOKE, wx, wy, (Math.random() - 0.5) * 3, -8 - Math.random() * 6, 2.6 + Math.random() * 1.2, 5 * scale, 7 * scale, dark ? 0.5 : 0.42);
  }
  steam(wx: number, wy: number, scale = 1): void {
    this.particle(K_STEAM, wx, wy, (Math.random() - 0.5) * 3, -7 - Math.random() * 5, 2 + Math.random(), 7 * scale, 9 * scale, 0.5);
  }

  /** Spawn an effect at TILE coords. */
  spawn(kind: EffectKind, x: number, y: number, opts: EffectOptions = {}): void {
    const wx = x * T;
    const wy = y * T;
    const s = opts.scale ?? 1;
    switch (kind) {
      case 'smoke':
        for (let i = 0; i < (opts.count ?? 1); i++) this.smoke(wx, wy, s);
        break;
      case 'steam':
        for (let i = 0; i < (opts.count ?? 1); i++) this.steam(wx, wy, s);
        break;
      case 'dust': {
        const n = opts.count ?? 12;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 6 + Math.random() * 14;
          this.particle(K_DUST, wx + Math.cos(a) * 4 * s, wy + Math.sin(a) * 4 * s, Math.cos(a) * sp * s, Math.sin(a) * sp * s - 3, 0.9 + Math.random() * 0.7, 5 * s, 9 * s, 0.55);
        }
        break;
      }
      case 'sparkle': {
        const n = opts.count ?? 14;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 10 + Math.random() * 22;
          this.particle(K_SPARKLE, wx, wy, Math.cos(a) * sp * s, Math.sin(a) * sp * s - 8, 0.8 + Math.random() * 0.6, 4 * s, -2 * s, 0.95);
        }
        break;
      }
      case 'splash': {
        const n = opts.count ?? 8;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          this.particle(K_SPLASH, wx, wy, Math.cos(a) * 8 * s, Math.sin(a) * 8 * s, 0.7 + Math.random() * 0.4, 3 * s, 5 * s, 0.6);
        }
        break;
      }
      case 'coins': {
        const n = opts.count ?? 6;
        for (let i = 0; i < n; i++)
          this.particle(K_COIN, wx + (Math.random() - 0.5) * 10, wy, (Math.random() - 0.5) * 10, -22 - Math.random() * 12, 0.9 + Math.random() * 0.3, 3.2 * s, 0, 1);
        break;
      }
      case 'text':
      case 'icon':
        this.floatText(x, y, opts.text ?? '', opts.color ?? '#ffffff', kind === 'icon', s);
        break;
    }
  }

  floatText(x: number, y: number, text: string, color: string, icon: boolean, scale = 1): void {
    if (!text) return;
    let f = this.texts.find((t) => !t.active);
    if (!f) {
      if (this.texts.length >= 64) f = this.texts[0]!;
      else {
        f = { active: false, x: 0, y: 0, t: 0, max: 1.6, text: '', icon: false, color: '#fff', scale: 1 };
        this.texts.push(f);
      }
    }
    f.active = true;
    f.x = x;
    f.y = y;
    f.t = 0;
    f.max = icon ? 1.3 : 1.8;
    f.text = text;
    f.icon = icon;
    f.color = color;
    f.scale = scale;
  }

  update(dt: number): void {
    const { x, y, vx, vy, life, max, size, grow } = this;
    let n = this.n;
    const wx = this.windX;
    const wy = this.windY;
    for (let i = 0; i < n; i++) {
      life[i] += dt;
      if (life[i]! >= max[i]!) {
        // swap-remove
        n--;
        x[i] = x[n]!;
        y[i] = y[n]!;
        vx[i] = vx[n]!;
        vy[i] = vy[n]!;
        life[i] = life[n]!;
        max[i] = max[n]!;
        size[i] = size[n]!;
        grow[i] = grow[n]!;
        this.a0[i] = this.a0[n]!;
        this.kind[i] = this.kind[n]!;
        i--;
        continue;
      }
      const k = this.kind[i]!;
      if (k === K_SMOKE || k === K_STEAM || k === K_DARK) {
        const f = Math.min(1, life[i]! / 1.2);
        x[i] += (vx[i]! + wx * f) * dt;
        y[i] += (vy[i]! + wy * f) * dt;
      } else {
        x[i] += vx[i]! * dt;
        y[i] += vy[i]! * dt;
        vx[i] *= 1 - 2.5 * dt;
        vy[i] *= 1 - 2.5 * dt;
        if (k === K_COIN) vy[i] += 60 * dt;
      }
      size[i] = Math.max(0.5, size[i]! + grow[i]! * dt);
    }
    this.n = n;
    for (const t of this.texts) if (t.active && (t.t += dt) >= t.max) t.active = false;
  }

  draw(rc: RenderContext): void {
    if (!this.n) return;
    const g = rc.g;
    if (!this.sprites) this.sprites = SPRITE_COLORS.map((c) => puffSprite(c));
    const sp = this.sprites;
    const v = rc.view;
    const minX = v.x0 * T - 40;
    const maxX = v.x1 * T + 40;
    const minY = v.y0 * T - 40;
    const maxY = v.y1 * T + 40;
    const nightDim = 1 - rc.night * 0.3;
    for (let i = 0; i < this.n; i++) {
      const px = this.x[i]!;
      const py = this.y[i]!;
      if (px < minX || px > maxX || py < minY || py > maxY) continue;
      const t = this.life[i]! / this.max[i]!;
      const k = this.kind[i]!;
      const fadeIn = k <= K_STEAM || k === K_DARK ? Math.min(1, t * 6) : 1;
      g.globalAlpha = this.a0[i]! * (1 - t) * fadeIn * nightDim;
      const s = this.size[i]!;
      if (k === K_SPARKLE) {
        g.fillStyle = '#ffe98a';
        g.fillRect(px - s / 2, py - s / 8, s, s / 4);
        g.fillRect(px - s / 8, py - s / 2, s / 4, s);
      } else if (k === K_COIN) {
        g.fillStyle = '#ffcf3a';
        g.beginPath();
        g.arc(px, py, s, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#fff2a8';
        g.fillRect(px - s * 0.3, py - s * 0.5, s * 0.25, s * 0.5);
      } else g.drawImage(sp[k]!, px - s, py - s, s * 2, s * 2);
    }
    g.globalAlpha = 1;
  }

  /** Screen-space floating texts. */
  drawTexts(rc: RenderContext): void {
    const g = rc.g;
    const cam = rc.camera;
    const z = cam.zoom;
    const hw = cam.viewW / 2;
    const hh = cam.viewH / 2;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const f of this.texts) {
      if (!f.active) continue;
      const sx = (f.x * T - cam.x) * z + hw;
      const sy = (f.y * T - cam.y) * z + hh - f.t * 26;
      if (sx < -80 || sy < -40 || sx > rc.width + 80 || sy > rc.height + 40) continue;
      const u = f.t / f.max;
      const pop = u < 0.12 ? 0.6 + (u / 0.12) * 0.4 : 1;
      g.globalAlpha = u > 0.65 ? 1 - (u - 0.65) / 0.35 : 1;
      if (f.icon) {
        const s = 22 * f.scale * pop;
        drawEmoji(g, f.text, sx, sy, s, s * rc.dpr);
      } else {
        g.font = `700 ${Math.round(13 * f.scale * pop)}px system-ui, sans-serif`;
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(10,14,20,0.75)';
        g.strokeText(f.text, sx, sy);
        g.fillStyle = f.color;
        g.fillText(f.text, sx, sy);
      }
    }
    g.globalAlpha = 1;
  }
}

export function createEffects(ctx: GameContext): { fx: Effects; layers: LayerDef[] } {
  const fx = new Effects();
  const inView = (x: number, y: number): boolean => {
    const cam = ctx.renderer.camera;
    const v = cam.visibleTiles(2);
    return x >= v.x0 && y >= v.y0 && x < v.x1 && y < v.y1;
  };
  ctx.bus.on('game:ended', () => fx.clear());
  ctx.bus.on('game:started', () => fx.clear());
  ctx.bus.on('building:built', ({ buildingId }) => {
    const b = ctx.tryState()?.buildings[buildingId];
    if (!b || !inView(b.x, b.y)) return;
    fx.spawn('dust', b.x + b.w / 2, b.y + b.h / 2, { count: 10 + b.w * b.h * 3, scale: Math.min(2, 0.8 + (b.w + b.h) * 0.15) });
  });
  ctx.bus.on('building:completed', ({ buildingId }) => {
    const b = ctx.tryState()?.buildings[buildingId];
    if (!b || !inView(b.x, b.y)) return;
    fx.spawn('sparkle', b.x + b.w / 2, b.y + b.h / 2, { count: 18 });
  });
  ctx.bus.on('building:removed', (b) => {
    if (!inView(b.x, b.y)) return;
    fx.spawn('dust', b.x + b.w / 2, b.y + b.h / 2, { count: 16 + b.w * b.h * 4, scale: 1.4 });
  });
  ctx.bus.on('vehicle:delivered', ({ buildingId, value }) => {
    const st = ctx.tryState();
    const b = st?.buildings[buildingId];
    if (!st || !b || value <= 0 || b.owner !== st.playerCompanyId || !inView(b.x, b.y)) return;
    fx.floatText(b.x + b.w / 2, b.y, `+${formatMoney(value, true)}`, '#8ef0a0', false);
  });
  ctx.bus.on('sale', ({ buildingId, revenue, companyId }) => {
    const st = ctx.tryState();
    const b = st?.buildings[buildingId];
    if (!st || !b || companyId !== st.playerCompanyId || revenue < 1 || !inView(b.x, b.y)) return;
    if (Math.random() < 0.35) fx.spawn('coins', b.x + b.w / 2, b.y + 0.2, { count: 3 });
  });
  ctx.bus.on('building:produced', ({ buildingId, productId }) => {
    const st = ctx.tryState();
    const b = st?.buildings[buildingId];
    if (!st || !b || ctx.renderer.camera.zoom < 0.6 || !inView(b.x, b.y)) return;
    const icon = ctx.data.products[productId]?.icon;
    if (icon) fx.floatText(b.x + b.w / 2, b.y + 0.1, icon, '#fff', true, 0.8);
  });
  ctx.bus.on('network:changed', ({ tiles }) => {
    const st = ctx.tryState();
    if (!st || tiles.length > 60) return;
    const W = st.map.width;
    for (let k = 0; k < tiles.length; k += 2) {
      const i = tiles[k]!;
      const x = i % W;
      const y = (i - x) / W;
      if (inView(x, y)) fx.spawn('dust', x + 0.5, y + 0.5, { count: 3, scale: 0.6 });
    }
  });

  let lastT = 0;
  const layers: LayerDef[] = [
    {
      id: 'effects',
      z: 50,
      draw(rc) {
        const dt = Math.min(0.1, rc.dtMs / 1000);
        if (rc.timeMs !== lastT) {
          lastT = rc.timeMs;
          // wind from the weather region under the camera
          const st = rc.state;
          const w = st.weather;
          if (w && w.regions.length) {
            const tx = rc.camera.x / T;
            const ty = rc.camera.y / T;
            const ri = Math.min(w.rows - 1, Math.max(0, Math.floor(ty / w.regionSize))) * w.cols + Math.min(w.cols - 1, Math.max(0, Math.floor(tx / w.regionSize)));
            const reg = w.regions[ri];
            const wind = reg ? reg.wind : 0.3;
            fx.windX = 4 + wind * 22;
            fx.windY = -1 - wind * 3;
          }
          fx.update(dt);
        }
        fx.draw(rc);
      },
    },
    {
      id: 'floating-text',
      z: 72,
      space: 'screen',
      draw: (rc) => fx.drawTexts(rc),
    },
  ];
  return { fx, layers };
}
