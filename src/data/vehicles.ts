import type { VehicleDef } from './defs';

/** PLACEHOLDER vehicles. The data agent fills the full roster (trucks, trains, ships, drones). */
export const VEHICLES: VehicleDef[] = [
  { id: 'horse_cart', name: 'Wóz konny', icon: '🐴', mode: 'road', capacity: 10, speed: 3, cost: 800, upkeep: 30, era: 'industrial', lifespanYears: 15, emissions: 0, color: '#8a6a40' },
  { id: 'truck_early', name: 'Ciężarówka', icon: '🚚', mode: 'road', capacity: 25, speed: 6, cost: 4000, upkeep: 90, era: 'electric', lifespanYears: 15, emissions: 0.2, color: '#c04a3a' },
  { id: 'steam_train', name: 'Parowóz', icon: '🚂', mode: 'rail', capacity: 30, speed: 8, cost: 15000, upkeep: 300, era: 'industrial', lifespanYears: 30, emissions: 0.5, wagons: { min: 1, max: 6, costPerWagon: 1500 }, color: '#303030' },
];
