import type { TechDef } from './defs';

/** PLACEHOLDER tech tree. The data agent fills the full tree across 5 eras. */
export const TECHS: TechDef[] = [
  { id: 'crop_rotation', name: 'Płodozmian', icon: '🌱', cost: 100, prereqs: [], era: 'industrial', effects: [{ kind: 'modifier', key: 'efficiency.farm_grain', value: 1.15 }], description: 'Farmy zbóż produkują o 15% więcej.' },
  { id: 'combustion_engine', name: 'Silnik spalinowy', icon: '⚙️', cost: 400, prereqs: ['crop_rotation'], era: 'electric', effects: [{ kind: 'unlockVehicle', id: 'truck_early' }], description: 'Odblokowuje ciężarówki.' },
];
