import { it } from 'vitest';
import { registry } from '../data/registry';
import { createEmptyState, defaultNewGameOptions } from '../core/state';
import { Terrain, TileFlag, type MapPreset } from '../core/types';
import { generateMap } from './mapgen';

const CH = '~-.,T^M:*%FU';
it('debug map', () => {
  const presets: MapPreset[] = ['continent', 'islands', 'archipelago', 'coast', 'inland'];
  for (const [k, preset] of presets.entries()) {
    const opts = { ...defaultNewGameOptions(), seed: Number(process.env.SEED ?? 1234) + k, mapWidth: 128, mapHeight: 128, mapPreset: preset };
    const st = createEmptyState(opts, registry);
    const t0 = performance.now();
    generateMap(st, st.settings, registry);
    const ms = performance.now() - t0;
    const m = st.map;
    const counts = new Array(12).fill(0);
    let river = 0;
    let dep = 0;
    let fert = 0;
    let land = 0;
    for (let i = 0; i < m.terrain.length; i++) {
      counts[m.terrain[i]!]++;
      if (m.flags[i]! & TileFlag.River) river++;
      if (m.deposit[i]) dep++;
      if (m.terrain[i]! > 1) {
        land++;
        if (m.terrain[i] === Terrain.Grass && m.fertility[i]! >= 100) fert++;
      }
    }
    const pct = (n: number) => ((n / land) * 100).toFixed(1);
    process.stdout.write('\n'+[preset, m.climate, ms.toFixed(1) + 'ms', 'land', land, 'river%', pct(river), 'dep', dep, 'fertile grass%', pct(fert)].join(' '));
    process.stdout.write('\n' + ['beach', pct(counts[2]), 'grass', pct(counts[3]), 'forest', pct(counts[4]), 'hills', pct(counts[5]), 'mtn', pct(counts[6]), 'desert', pct(counts[7]), 'snow', pct(counts[8]), 'swamp', pct(counts[9]), 'water', counts[1], 'deep', counts[0]].join(' '));
    if (process.env.SHOW?.includes(String(k))) {
      const lines: string[] = [];
      for (let y = 0; y < m.height; y += 2) {
        let s = '';
        for (let x = 0; x < m.width; x++) {
          const i = y * m.width + x;
          s += m.flags[i]! & TileFlag.River ? '=' : m.deposit[i] ? '$' : CH[m.terrain[i]!];
        }
        lines.push(s);
      }
      process.stdout.write("\n"+lines.join('\n'));
    }
  }
});
