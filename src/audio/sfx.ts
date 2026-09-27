/**
 * Synthesised sound effects (no audio files). Each effect is a small function
 * building short-lived nodes into `dest`. Unknown ids are ignored.
 */
import { mtof, type AudioEngine } from './engine';

type Synth = (e: AudioEngine, dest: AudioNode, t: number, vol: number) => void;

function tone(e: AudioEngine, dest: AudioNode, t: number, o: { f: number; f2?: number; type?: OscillatorType; dur: number; vol: number; attack?: number }): void {
  const ac = e.ac!;
  const osc = ac.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.f, t);
  if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + o.dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(o.vol, t + (o.attack ?? 0.005));
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  osc.connect(g);
  g.connect(dest);
  osc.start(t);
  osc.stop(t + o.dur + 0.05);
}

function noise(e: AudioEngine, dest: AudioNode, t: number, o: { dur: number; vol: number; type?: BiquadFilterType; f: number; f2?: number; q?: number; attack?: number }): void {
  const ac = e.ac!;
  const src = ac.createBufferSource();
  src.buffer = e.noiseBuffer();
  src.loop = true;
  const flt = ac.createBiquadFilter();
  flt.type = o.type ?? 'lowpass';
  flt.frequency.setValueAtTime(o.f, t);
  if (o.f2) flt.frequency.exponentialRampToValueAtTime(o.f2, t + o.dur);
  flt.Q.value = o.q ?? 0.8;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(o.vol, t + (o.attack ?? 0.005));
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  src.connect(flt);
  flt.connect(g);
  g.connect(dest);
  src.start(t, Math.random());
  src.stop(t + o.dur + 0.05);
}

function bell(e: AudioEngine, dest: AudioNode, t: number, midi: number, vol: number, dur = 1.2): void {
  tone(e, dest, t, { f: mtof(midi), dur, vol });
  tone(e, dest, t, { f: mtof(midi) * 2.76, dur: dur * 0.4, vol: vol * 0.25 });
  tone(e, dest, t, { f: mtof(midi) * 5.4, dur: dur * 0.2, vol: vol * 0.1 });
}

function arp(e: AudioEngine, dest: AudioNode, t: number, notes: number[], step: number, vol: number, dur = 0.8): void {
  notes.forEach((n, i) => bell(e, dest, t + i * step, n, vol, dur));
}

export const SFX: Record<string, Synth> = {
  click: (e, d, t, v) => tone(e, d, t, { f: 1800, f2: 1200, type: 'sine', dur: 0.05, vol: 0.25 * v }),
  hover: (e, d, t, v) => tone(e, d, t, { f: 2400, type: 'sine', dur: 0.025, vol: 0.06 * v }),
  open: (e, d, t, v) => {
    tone(e, d, t, { f: 660, type: 'sine', dur: 0.09, vol: 0.12 * v });
    tone(e, d, t + 0.05, { f: 990, type: 'sine', dur: 0.12, vol: 0.1 * v });
  },
  close: (e, d, t, v) => {
    tone(e, d, t, { f: 880, type: 'sine', dur: 0.08, vol: 0.1 * v });
    tone(e, d, t + 0.05, { f: 587, type: 'sine', dur: 0.1, vol: 0.09 * v });
  },
  build: (e, d, t, v) => {
    tone(e, d, t, { f: 140, f2: 55, type: 'sine', dur: 0.35, vol: 0.5 * v });
    noise(e, d, t, { dur: 0.25, vol: 0.3 * v, f: 1200, f2: 300 });
    noise(e, d, t + 0.12, { dur: 0.12, vol: 0.15 * v, type: 'bandpass', f: 2500, q: 2 });
    tone(e, d, t + 0.18, { f: 523, type: 'triangle', dur: 0.25, vol: 0.08 * v });
  },
  demolish: (e, d, t, v) => {
    noise(e, d, t, { dur: 0.8, vol: 0.45 * v, f: 2500, f2: 120, attack: 0.01 });
    tone(e, d, t, { f: 90, f2: 35, type: 'sine', dur: 0.6, vol: 0.45 * v });
  },
  road: (e, d, t, v) => noise(e, d, t, { dur: 0.22, vol: 0.25 * v, type: 'bandpass', f: 900, f2: 500, q: 1.2 }),
  rail: (e, d, t, v) => {
    tone(e, d, t, { f: 1200, type: 'square', dur: 0.04, vol: 0.05 * v });
    tone(e, d, t + 0.09, { f: 1100, type: 'square', dur: 0.04, vol: 0.05 * v });
    noise(e, d, t, { dur: 0.15, vol: 0.15 * v, type: 'highpass', f: 2000 });
  },
  cash: (e, d, t, v) => {
    bell(e, d, t, 88, 0.13 * v, 0.5);
    bell(e, d, t + 0.08, 93, 0.13 * v, 0.7);
    noise(e, d, t, { dur: 0.08, vol: 0.06 * v, type: 'highpass', f: 6000 });
  },
  error: (e, d, t, v) => {
    tone(e, d, t, { f: 220, type: 'square', dur: 0.12, vol: 0.08 * v });
    tone(e, d, t + 0.13, { f: 165, type: 'square', dur: 0.18, vol: 0.08 * v });
  },
  notify: (e, d, t, v) => bell(e, d, t, 84, 0.1 * v, 0.9),
  warning: (e, d, t, v) => {
    bell(e, d, t, 76, 0.12 * v, 0.5);
    bell(e, d, t + 0.18, 76, 0.12 * v, 0.6);
  },
  success: (e, d, t, v) => arp(e, d, t, [72, 76, 79, 84], 0.08, 0.1 * v, 0.9),
  research: (e, d, t, v) => arp(e, d, t, [79, 83, 86, 91, 95], 0.06, 0.07 * v, 1.2),
  era: (e, d, t, v) => {
    // swelling major chord
    const ac = e.ac!;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.18 * v, t + 1.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 4);
    g.connect(d);
    for (const n of [55, 62, 67, 71, 74]) {
      const o = ac.createOscillator();
      o.type = 'triangle';
      o.frequency.value = mtof(n);
      o.connect(g);
      o.start(t);
      o.stop(t + 4.1);
    }
    arp(e, d, t + 0.8, [79, 83, 86], 0.15, 0.08 * v, 1.5);
  },
  victory: (e, d, t, v) => {
    arp(e, d, t, [60, 64, 67, 72], 0.14, 0.14 * v, 0.8);
    arp(e, d, t + 0.62, [65, 69, 72, 77], 0.14, 0.14 * v, 0.8);
    arp(e, d, t + 1.24, [67, 71, 74, 79, 84], 0.12, 0.16 * v, 2.2);
  },
  defeat: (e, d, t, v) => {
    tone(e, d, t, { f: mtof(62), type: 'triangle', dur: 0.8, vol: 0.14 * v });
    tone(e, d, t + 0.5, { f: mtof(58), type: 'triangle', dur: 0.8, vol: 0.13 * v });
    tone(e, d, t + 1.0, { f: mtof(55), type: 'triangle', dur: 1.6, vol: 0.12 * v });
  },
  produce: (e, d, t, v) => tone(e, d, t, { f: 1500, f2: 1100, type: 'sine', dur: 0.04, vol: 0.03 * v }),
  truck: (e, d, t, v) => {
    tone(e, d, t, { f: 330, type: 'sawtooth', dur: 0.18, vol: 0.05 * v, attack: 0.02 });
    tone(e, d, t, { f: 415, type: 'sawtooth', dur: 0.18, vol: 0.04 * v, attack: 0.02 });
  },
  train: (e, d, t, v) => {
    for (const f of [370, 466, 554]) tone(e, d, t, { f, type: 'triangle', dur: 0.9, vol: 0.05 * v, attack: 0.08 });
  },
  ship: (e, d, t, v) => {
    tone(e, d, t, { f: 98, type: 'sawtooth', dur: 1.4, vol: 0.12 * v, attack: 0.15 });
    tone(e, d, t, { f: 147, type: 'sine', dur: 1.4, vol: 0.08 * v, attack: 0.15 });
  },
};

/** Minimal interval between two plays of the same id (seconds). */
export const SFX_COOLDOWN: Record<string, number> = { produce: 0.35, cash: 0.2, notify: 1.2, warning: 1.5, truck: 1.5, train: 2, ship: 3, hover: 0.05, road: 0.08 };
