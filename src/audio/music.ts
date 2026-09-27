/**
 * Generative calm ambient music (IG2-like, focus friendly):
 *  - slow chord progressions (8–12 s per chord) played by soft detuned pads
 *    through a breathing low-pass filter,
 *  - a soft sine bass on the root,
 *  - a sparse, gently wandering arpeggio with a feedback delay,
 *  - evolution: progressions rotate, the key modulates every ~16 chords,
 *    density and brightness drift slowly; occasional pads-only passages.
 * Scheduling uses a look-ahead timer against AudioContext.currentTime.
 */
import { mtof, type AudioEngine } from './engine';

/** Mode intervals (semitones from tonic). */
export const MODES: Record<string, number[]> = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
};

/** Progressions as scale degrees (0-based). */
export const PROGRESSIONS: number[][] = [
  [0, 5, 3, 4],
  [0, 2, 5, 3],
  [1, 4, 0, 5],
  [0, 3, 5, 4],
  [5, 3, 0, 4],
  [0, 4, 5, 3],
];

/** MIDI notes of a diatonic chord (triad + optional 7th/9th) on `degree`. */
export function chordNotes(tonic: number, mode: number[], degree: number, extensions = 1): number[] {
  const note = (step: number): number => {
    const oct = Math.floor(step / 7);
    return tonic + mode[((step % 7) + 7) % 7]! + 12 * oct;
  };
  const out = [note(degree), note(degree + 2), note(degree + 4)];
  if (extensions >= 1) out.push(note(degree + 6));
  if (extensions >= 2) out.push(note(degree + 8));
  return out;
}

const pick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)]!;

export class MusicGenerator {
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextChordAt = 0;
  private nextArpAt = 0;
  private chordIndex = 0;
  private chordCount = 0;
  private progression = PROGRESSIONS[0]!;
  private tonic = 50; // D3
  private modeName = 'lydian';
  private current: number[] = [];
  private chordLen = 9;
  private density = 0.45;
  private brightness = 0.5;
  private arpStep = 0;
  private restChords = 0;
  private out: GainNode | null = null;
  private delay: DelayNode | null = null;
  /** 0..4 — slight colour change per era (brighter later). */
  era = 0;

  constructor(private readonly eng: AudioEngine) {}

  get playing(): boolean {
    return this.timer !== null;
  }

  start(): void {
    const ac = this.eng.ac;
    if (!ac || this.timer) return;
    if (!this.out) {
      this.out = ac.createGain();
      this.out.gain.value = 0;
      this.out.connect(this.eng.musicBus);
      const send = ac.createGain();
      send.gain.value = 0.6;
      this.out.connect(send);
      send.connect(this.eng.reverb);
      // arpeggio delay line
      this.delay = ac.createDelay(2);
      this.delay.delayTime.value = 0.43;
      const fb = ac.createGain();
      fb.gain.value = 0.35;
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2200;
      this.delay.connect(lp);
      lp.connect(fb);
      fb.connect(this.delay);
      lp.connect(this.out);
    }
    this.out.gain.cancelScheduledValues(ac.currentTime);
    this.out.gain.setTargetAtTime(1, ac.currentTime, 1.5);
    this.nextChordAt = ac.currentTime + 0.3;
    this.nextArpAt = this.nextChordAt + 2;
    this.timer = setInterval(() => this.schedule(), 200);
  }

  stop(): void {
    const ac = this.eng.ac;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (ac && this.out) this.out.gain.setTargetAtTime(0, ac.currentTime, 0.8);
  }

  private schedule(): void {
    const ac = this.eng.ac;
    if (!ac || ac.state !== 'running') return;
    const horizon = ac.currentTime + 1.5;
    while (this.nextChordAt < horizon) {
      this.playChord(this.nextChordAt);
      this.nextChordAt += this.chordLen;
    }
    const beat = 60 / 72 / 2; // eighth notes at 72 BPM
    while (this.nextArpAt < horizon) {
      if (this.restChords <= 0 && Math.random() < this.density) this.playArp(this.nextArpAt);
      this.nextArpAt += beat * (Math.random() < 0.15 ? 2 : 1);
    }
  }

  private evolve(): void {
    this.chordCount++;
    if (this.chordIndex === 0 && this.chordCount > 1 && Math.random() < 0.35) this.progression = pick(PROGRESSIONS);
    if (this.chordCount % 16 === 0) {
      // modulate by a fourth/fifth (or relative mode) and keep register comfortable
      this.tonic += pick([5, -5, 7, -7, 0]);
      while (this.tonic > 55) this.tonic -= 12;
      while (this.tonic < 45) this.tonic += 12;
      this.modeName = pick(this.era >= 3 ? ['lydian', 'ionian', 'dorian', 'mixolydian'] : ['lydian', 'ionian', 'dorian', 'aeolian', 'mixolydian']);
    }
    this.density = Math.max(0.15, Math.min(0.75, this.density + (Math.random() - 0.5) * 0.15));
    this.brightness = Math.max(0.2, Math.min(0.9, this.brightness + (Math.random() - 0.5) * 0.2 + this.era * 0.01));
    this.chordLen = 8 + Math.random() * 4;
    if (this.restChords > 0) this.restChords--;
    else if (Math.random() < 0.08) this.restChords = 2; // pads-only passage
  }

  private playChord(t: number): void {
    const ac = this.eng.ac!;
    const degree = this.progression[this.chordIndex % this.progression.length]!;
    this.chordIndex = (this.chordIndex + 1) % this.progression.length;
    const notes = chordNotes(this.tonic, MODES[this.modeName]!, degree, Math.random() < 0.6 ? 1 : 2);
    this.current = notes;
    const dur = this.chordLen + 3;
    // Pad voices
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.7;
    const base = 500 + this.brightness * 1100;
    filter.frequency.setValueAtTime(base * 0.6, t);
    filter.frequency.linearRampToValueAtTime(base, t + dur * 0.5);
    filter.frequency.linearRampToValueAtTime(base * 0.7, t + dur);
    const env = ac.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.09, t + 2.8);
    env.gain.setValueAtTime(0.09, t + dur - 3.5);
    env.gain.linearRampToValueAtTime(0, t + dur);
    filter.connect(env);
    env.connect(this.out!);
    for (const n of notes) {
      for (const [type, detune, vol] of [
        ['triangle', -6, 0.5],
        ['sawtooth', 7, 0.18],
      ] as const) {
        const o = ac.createOscillator();
        o.type = type;
        o.frequency.value = mtof(n + 12);
        o.detune.value = detune;
        const g = ac.createGain();
        g.gain.value = vol / notes.length;
        o.connect(g);
        g.connect(filter);
        o.start(t);
        o.stop(t + dur + 0.1);
      }
    }
    // Bass
    const b = ac.createOscillator();
    b.type = 'sine';
    b.frequency.value = mtof(notes[0]! - 12);
    const bg = ac.createGain();
    bg.gain.setValueAtTime(0, t);
    bg.gain.linearRampToValueAtTime(0.11, t + 1.5);
    bg.gain.setValueAtTime(0.11, t + dur - 3);
    bg.gain.linearRampToValueAtTime(0, t + dur);
    b.connect(bg);
    bg.connect(this.out!);
    b.start(t);
    b.stop(t + dur + 0.1);
    this.evolve();
  }

  private playArp(t: number): void {
    const ac = this.eng.ac!;
    if (!this.current.length) return;
    // gentle random walk over chord tones across two octaves
    this.arpStep += pick([-1, 1, 1, 2, -2]);
    const span = this.current.length * 2;
    this.arpStep = ((this.arpStep % span) + span) % span;
    const note = this.current[this.arpStep % this.current.length]! + 24 + (this.arpStep >= this.current.length ? 12 : 0);
    const o = ac.createOscillator();
    o.type = Math.random() < 0.7 ? 'sine' : 'triangle';
    o.frequency.value = mtof(note);
    const g = ac.createGain();
    const v = 0.035 + Math.random() * 0.03;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 1.6);
    o.connect(g);
    g.connect(this.out!);
    if (this.delay) g.connect(this.delay);
    o.start(t);
    o.stop(t + 1.7);
  }
}
