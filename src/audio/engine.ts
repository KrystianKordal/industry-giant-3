/**
 * WebAudio graph: master → compressor → destination, with music / sfx /
 * ambient buses and a shared generated reverb. The AudioContext is created
 * lazily on unlock() (autoplay policy: must follow a user gesture).
 */
import type { UserSettings } from '../core/types';

type AudioCtor = typeof AudioContext;

export class AudioEngine {
  ac: AudioContext | null = null;
  master!: GainNode;
  musicBus!: GainNode;
  sfxBus!: GainNode;
  ambientBus!: GainNode;
  /** Reverb send (convolver input). */
  reverb!: GainNode;
  private noise: AudioBuffer | null = null;
  private listeners: (() => void)[] = [];

  get ready(): boolean {
    return !!this.ac && this.ac.state === 'running';
  }

  /** Call once the context exists (fires immediately if already created). */
  onReady(fn: () => void): void {
    if (this.ac) fn();
    else this.listeners.push(fn);
  }

  /** Create/resume the context. Safe to call repeatedly. Returns true when usable. */
  unlock(): boolean {
    if (typeof window === 'undefined') return false;
    if (!this.ac) {
      const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext) as AudioCtor | undefined;
      if (!Ctor) return false;
      try {
        this.ac = new Ctor({ latencyHint: 'playback' });
      } catch {
        return false;
      }
      this.build();
      const ls = this.listeners;
      this.listeners = [];
      for (const fn of ls) fn();
    }
    if (this.ac.state === 'suspended') void this.ac.resume().catch(() => {});
    return true;
  }

  private build(): void {
    const ac = this.ac!;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 20;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.25;
    comp.connect(ac.destination);
    this.master = ac.createGain();
    this.master.connect(comp);
    this.musicBus = ac.createGain();
    this.sfxBus = ac.createGain();
    this.ambientBus = ac.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.ambientBus.connect(this.master);
    // reverb
    const conv = ac.createConvolver();
    conv.buffer = this.impulse(3.2, 2.6);
    const wet = ac.createGain();
    wet.gain.value = 0.55;
    this.reverb = ac.createGain();
    this.reverb.connect(conv);
    conv.connect(wet);
    wet.connect(this.master);
  }

  /** Stereo exponentially decaying noise impulse. */
  private impulse(seconds: number, decay: number): AudioBuffer {
    const ac = this.ac!;
    const len = Math.floor(ac.sampleRate * seconds);
    const buf = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  /** Shared 2 s white-noise buffer. */
  noiseBuffer(): AudioBuffer {
    if (this.noise) return this.noise;
    const ac = this.ac!;
    const len = ac.sampleRate * 2;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    return buf;
  }

  applySettings(s: UserSettings): void {
    if (!this.ac) return;
    const t = this.ac.currentTime;
    const m = s.muted ? 0 : s.masterVolume;
    this.master.gain.setTargetAtTime(m, t, 0.05);
    this.musicBus.gain.setTargetAtTime(s.musicVolume * 0.55, t, 0.2);
    this.sfxBus.gain.setTargetAtTime(s.sfxVolume * 0.8, t, 0.05);
    this.ambientBus.gain.setTargetAtTime(s.ambientVolume * 0.6, t, 0.3);
  }

  suspend(): void {
    if (this.ac && this.ac.state === 'running') void this.ac.suspend().catch(() => {});
  }
  resume(): void {
    if (this.ac && this.ac.state === 'suspended') void this.ac.resume().catch(() => {});
  }
}

/** MIDI note → Hz. */
export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
