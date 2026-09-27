/**
 * audio module — generative ambient music, synthesised SFX, contextual
 * ambience (WebAudio, no files). Owner: AI/game/audio agent.
 *
 *  - ctx.services.audio = { unlock, play, setMusic, applySettings }
 *  - bus: 'sfx' (unknown ids ignored), vehicle/research/notify reactions
 *  - volumes from ctx.userSettings; reacts to 'settings:changed'
 *  - the AudioContext is created only after a user gesture (autoplay policy)
 */
import { TILE_SIZE } from '../core/constants';
import type { GameContext } from '../core/context';
import { Ambience } from './ambience';
import { AudioEngine } from './engine';
import { MusicGenerator } from './music';
import { SFX, SFX_COOLDOWN } from './sfx';

export function init(ctx: GameContext): void {
  if (ctx.headless || typeof window === 'undefined') return;
  const eng = new AudioEngine();
  const music = new MusicGenerator(eng);
  const ambience = new Ambience(eng, ctx);
  let musicWanted = true;
  const last = new Map<string, number>();

  const startAll = (): void => {
    eng.applySettings(ctx.userSettings);
    if (musicWanted) music.start();
    ambience.start();
  };
  eng.onReady(startAll);

  const unlock = (): void => {
    eng.unlock();
  };

  /** Positional attenuation: 0 when far outside the view. */
  const positional = (x?: number, y?: number): number => {
    if (x === undefined || y === undefined) return 1;
    const cam = ctx.renderer.camera as { x: number; y: number; zoom: number; viewW?: number; viewH?: number };
    const cx = cam.x / TILE_SIZE;
    const cy = cam.y / TILE_SIZE;
    const half = Math.max((cam.viewW ?? 800) / cam.zoom / TILE_SIZE, (cam.viewH ?? 600) / cam.zoom / TILE_SIZE) / 2;
    const d = Math.hypot(x - cx, y - cy);
    if (d <= half) return 1;
    return Math.max(0, 1 - (d - half) / (half * 1.2));
  };

  const play = (id: string, opts: { x?: number; y?: number; volume?: number } = {}): void => {
    const fn = SFX[id];
    if (!fn || !eng.ready || ctx.userSettings.muted) return;
    const ac = eng.ac!;
    const now = ac.currentTime;
    const cd = SFX_COOLDOWN[id] ?? 0.04;
    if (now - (last.get(id) ?? -1) < cd) return;
    const vol = (opts.volume ?? 1) * positional(opts.x, opts.y);
    if (vol <= 0.02) return;
    last.set(id, now);
    try {
      fn(eng, eng.sfxBus, now + 0.005, vol);
    } catch (err) {
      console.warn('[audio] sfx failed', id, err);
    }
  };

  ctx.services.audio = {
    unlock,
    play,
    setMusic(on) {
      musicWanted = on;
      if (!eng.ac) return;
      if (on) music.start();
      else music.stop();
    },
    applySettings() {
      eng.applySettings(ctx.userSettings);
    },
  };

  // ------------------------------------------------------------ autoplay unlock
  const gesture = (): void => {
    unlock();
    if (eng.ac) {
      window.removeEventListener('pointerdown', gesture, true);
      window.removeEventListener('keydown', gesture, true);
    }
  };
  window.addEventListener('pointerdown', gesture, true);
  window.addEventListener('keydown', gesture, true);
  // UI click feedback for any button (deduped with UI-emitted 'click' by cooldown)
  document.addEventListener(
    'click',
    (e) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.('button, .ig-btn, .ig-toolbar-btn, .ig-tab')) play('click');
    },
    true,
  );
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) eng.suspend();
    else eng.resume();
  });

  // ------------------------------------------------------------ bus
  ctx.bus.on('sfx', ({ id, x, y, volume }) => play(id, { x, y, volume }));
  ctx.bus.on('settings:changed', () => eng.applySettings(ctx.userSettings));
  ctx.bus.on('vehicle:bought', ({ vehicleId }) => {
    const st = ctx.tryState();
    const v = st?.vehicles[vehicleId];
    if (!st || !v || v.owner !== st.playerCompanyId) return;
    play(v.mode === 'rail' ? 'train' : v.mode === 'water' ? 'ship' : 'truck', { x: v.x, y: v.y });
  });
  ctx.bus.on('research:completed', ({ companyId }) => {
    if (companyId === ctx.tryState()?.playerCompanyId) play('research');
  });
  ctx.bus.on('notify', ({ level, companyId }) => {
    const st = ctx.tryState();
    if (st && companyId && companyId !== st.playerCompanyId) return;
    if (level === 'danger' || level === 'warning') play('warning', { volume: level === 'danger' ? 1 : 0.7 });
    else if (level === 'info') play('notify', { volume: 0.7 });
  });
  ctx.bus.on('cash:changed', ({ companyId, amount, category }) => {
    const st = ctx.tryState();
    if (!st || companyId !== st.playerCompanyId) return;
    if ((category === 'subsidy' || category === 'assetSale' || category === 'loanIn') && amount > 0) play('cash');
  });
  ctx.bus.on('era:changed', ({ eraId }) => {
    music.era = Math.max(0, ctx.data.eraIndex(eraId));
  });
  ctx.bus.on('game:started', ({ state }) => {
    music.era = Math.max(0, ctx.data.eraIndex(state.time.eraId));
  });
}
