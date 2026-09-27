/**
 * Contextual ambience driven by what the camera sees: factory hum, farm/nature
 * (wind + occasional birds), city murmur, water. Volumes follow the mix of
 * visible tiles and the camera zoom (closer = louder).
 */
import { TILE_SIZE } from '../core/constants';
import type { GameContext } from '../core/context';
import type { AudioEngine } from './engine';

export interface AmbienceMix {
  factory: number;
  nature: number;
  city: number;
  water: number;
}

/** Sample the camera view → 0..1 weights (pure: exported for tests/debug). */
export function sampleView(ctx: GameContext): AmbienceMix {
  const mix: AmbienceMix = { factory: 0, nature: 0, city: 0, water: 0 };
  const st = ctx.tryState();
  if (!st) return mix;
  const cam = ctx.renderer.camera as { x: number; y: number; zoom: number; viewW?: number; viewH?: number };
  const m = st.map;
  const vw = (cam.viewW ?? 800) / cam.zoom / TILE_SIZE;
  const vh = (cam.viewH ?? 600) / cam.zoom / TILE_SIZE;
  const cx = cam.x / TILE_SIZE;
  const cy = cam.y / TILE_SIZE;
  const x0 = Math.max(0, Math.floor(cx - vw / 2));
  const y0 = Math.max(0, Math.floor(cy - vh / 2));
  const x1 = Math.min(m.width, Math.ceil(cx + vw / 2));
  const y1 = Math.min(m.height, Math.ceil(cy + vh / 2));
  if (x1 <= x0 || y1 <= y0) return mix;
  const stride = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 500)));
  let n = 0;
  const seen = new Set<number>();
  for (let y = y0; y < y1; y += stride)
    for (let x = x0; x < x1; x += stride) {
      const i = y * m.width + x;
      n++;
      const t = m.terrain[i]!;
      if (ctx.data.terrain[t]?.isWater) mix.water++;
      else if (m.city[i] || m.house[i]) mix.city++;
      else if (t === 4 /* Forest */ || t === 10 /* Farmland */ || t === 3 /* Grass */) mix.nature += t === 3 ? 0.4 : 1;
      const bid = m.building[i];
      if (bid && !seen.has(bid)) {
        seen.add(bid);
        const b = st.buildings[bid];
        const cat = b ? ctx.data.buildings[b.typeId]?.category : undefined;
        if (cat === 'factory' || cat === 'energy' || cat === 'recycling') mix.factory += 6;
        else if (cat === 'raw') {
          if (ctx.data.buildings[b!.typeId]?.requiresDeposit) mix.factory += 4;
          else mix.nature += 4;
        } else if (cat === 'shop') mix.city += 2;
      }
    }
  if (!n) return mix;
  const zoomF = Math.max(0.15, Math.min(1, (cam.zoom - 0.2) / 1.2));
  mix.factory = Math.min(1, (mix.factory / n) * 8) * zoomF;
  mix.nature = Math.min(1, (mix.nature / n) * 1.4) * zoomF;
  mix.city = Math.min(1, (mix.city / n) * 2.5) * zoomF;
  mix.water = Math.min(1, (mix.water / n) * 1.5) * (0.4 + 0.6 * zoomF);
  return mix;
}

export class Ambience {
  private gains: Partial<Record<keyof AmbienceMix, GainNode>> = {};
  private timer: ReturnType<typeof setInterval> | null = null;
  private nature = 0;
  private started = false;

  constructor(
    private readonly eng: AudioEngine,
    private readonly ctx: GameContext,
  ) {}

  private noiseSrc(): AudioBufferSourceNode {
    const src = this.eng.ac!.createBufferSource();
    src.buffer = this.eng.noiseBuffer();
    src.loop = true;
    src.start(0, Math.random() * 1.5);
    return src;
  }

  private lfo(freq: number, depth: number, target: AudioParam): void {
    const ac = this.eng.ac!;
    const o = ac.createOscillator();
    o.frequency.value = freq;
    const g = ac.createGain();
    g.gain.value = depth;
    o.connect(g);
    g.connect(target);
    o.start();
  }

  start(): void {
    const ac = this.eng.ac;
    if (!ac || this.started) return;
    this.started = true;
    const mk = (k: keyof AmbienceMix): GainNode => {
      const g = ac.createGain();
      g.gain.value = 0;
      g.connect(this.eng.ambientBus);
      this.gains[k] = g;
      return g;
    };
    // factory hum: low saws + filtered noise, slow wobble
    {
      const out = mk('factory');
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 260;
      lp.connect(out);
      for (const [f, v] of [
        [55, 0.12],
        [110.5, 0.06],
        [165, 0.03],
      ] as const) {
        const o = ac.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        const g = ac.createGain();
        g.gain.value = v;
        o.connect(g);
        g.connect(lp);
        o.start();
      }
      const n = this.noiseSrc();
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 400;
      bp.Q.value = 0.8;
      const ng = ac.createGain();
      ng.gain.value = 0.1;
      n.connect(bp);
      bp.connect(ng);
      ng.connect(out);
      this.lfo(0.3, 60, lp.frequency);
    }
    // city murmur: band-passed noise with slow amplitude modulation
    {
      const out = mk('city');
      const n = this.noiseSrc();
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 650;
      bp.Q.value = 0.6;
      const am = ac.createGain();
      am.gain.value = 0.22;
      n.connect(bp);
      bp.connect(am);
      am.connect(out);
      this.lfo(0.17, 0.08, am.gain);
      this.lfo(0.05, 150, bp.frequency);
    }
    // water: low-passed noise with wave swells
    {
      const out = mk('water');
      const n = this.noiseSrc();
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 520;
      const am = ac.createGain();
      am.gain.value = 0.25;
      n.connect(lp);
      lp.connect(am);
      am.connect(out);
      this.lfo(0.11, 0.15, am.gain);
      this.lfo(0.07, 200, lp.frequency);
    }
    // nature: soft wind (high-passed noise); birds scheduled separately
    {
      const out = mk('nature');
      const n = this.noiseSrc();
      const hp = ac.createBiquadFilter();
      hp.type = 'bandpass';
      hp.frequency.value = 1800;
      hp.Q.value = 0.4;
      const am = ac.createGain();
      am.gain.value = 0.06;
      n.connect(hp);
      hp.connect(am);
      am.connect(out);
      this.lfo(0.09, 0.04, am.gain);
    }
    this.timer = setInterval(() => this.update(), 450);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const ac = this.eng.ac;
    if (!ac) return;
    for (const g of Object.values(this.gains)) g?.gain.setTargetAtTime(0, ac.currentTime, 0.5);
    this.started = false;
  }

  /** Fade everything out while no game runs (menu). */
  silence(): void {
    const ac = this.eng.ac;
    if (!ac) return;
    for (const g of Object.values(this.gains)) g?.gain.setTargetAtTime(0, ac.currentTime, 0.8);
  }

  private update(): void {
    const ac = this.eng.ac;
    if (!ac || ac.state !== 'running') return;
    if (!this.ctx.hasGame) {
      this.silence();
      return;
    }
    let mix: AmbienceMix;
    try {
      mix = sampleView(this.ctx);
    } catch {
      return;
    }
    const t = ac.currentTime;
    const paused = this.ctx.tryState()?.time.paused ?? false;
    const k = paused ? 0.5 : 1;
    this.gains.factory?.gain.setTargetAtTime(mix.factory * 0.7 * k, t, 0.6);
    this.gains.city?.gain.setTargetAtTime(mix.city * 0.6 * k, t, 0.6);
    this.gains.water?.gain.setTargetAtTime(mix.water * 0.55, t, 0.8);
    this.gains.nature?.gain.setTargetAtTime(mix.nature * 0.6, t, 0.8);
    this.nature = mix.nature;
    // birds (daytime-ish seasons)
    const season = this.ctx.tryState()?.time.season;
    if (season !== 'winter' && Math.random() < this.nature * 0.35) this.chirp();
  }

  private chirp(): void {
    const ac = this.eng.ac!;
    const out = this.gains.nature;
    if (!out) return;
    const t = ac.currentTime + Math.random() * 0.3;
    const base = 2600 + Math.random() * 1800;
    const notes = 1 + Math.floor(Math.random() * 4);
    for (let i = 0; i < notes; i++) {
      const s = t + i * (0.09 + Math.random() * 0.05);
      const o = ac.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(base, s);
      o.frequency.exponentialRampToValueAtTime(base * (0.7 + Math.random() * 0.6), s + 0.07);
      const g = ac.createGain();
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.05, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.08);
      o.connect(g);
      g.connect(out);
      o.start(s);
      o.stop(s + 0.1);
    }
  }
}
