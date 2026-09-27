import type { VehicleDef } from './defs';

/**
 * Vehicles per era. `capacity` = cargo units (trains: per wagon), `speed` =
 * tiles per game day, `upkeep` = zł/month, `emissions` = CO2 units per tile.
 * Gated by era and (optionally) `requiresTech` — check with
 * ctx.services.economy.isUnlocked(companyId, 'vehicle', id).
 */
export const VEHICLES: VehicleDef[] = [
  // ======================================================== road
  { id: 'horse_cart', name: 'Wóz konny', icon: '🐴', mode: 'road', capacity: 20, speed: 5, cost: 800, upkeep: 40, era: 'industrial', lifespanYears: 15, emissions: 0, color: '#8a6a40', description: 'Tani i wolny. Dobry na krótkie trasy.' },
  { id: 'steam_wagon', name: 'Parowy wóz drogowy', icon: '🚜', mode: 'road', capacity: 30, speed: 6, cost: 2500, upkeep: 90, era: 'industrial', requiresTech: 'steam_power', lifespanYears: 15, emissions: 0.3, cargo: ['bulk', 'heavy', 'normal', 'light'], color: '#606060', description: 'Ciężki ładunek, ale nie przewozi płynów.' },
  { id: 'truck_early', name: 'Ciężarówka', icon: '🚚', mode: 'road', capacity: 35, speed: 9, cost: 4000, upkeep: 120, era: 'electric', requiresTech: 'combustion_engine', lifespanYears: 15, emissions: 0.2, color: '#c04a3a' },
  { id: 'tanker_truck', name: 'Cysterna', icon: '🚛', mode: 'road', capacity: 40, speed: 9, cost: 5000, upkeep: 140, era: 'electric', requiresTech: 'refining', lifespanYears: 15, emissions: 0.25, cargo: ['liquid'], color: '#d0a020', description: 'Tylko płyny: ropa, paliwo, mleko, chemikalia.' },
  { id: 'truck_diesel', name: 'Ciężarówka diesla', icon: '🚚', mode: 'road', capacity: 60, speed: 12, cost: 9000, upkeep: 200, era: 'mass', requiresTech: 'diesel_engines', lifespanYears: 15, emissions: 0.3, color: '#3a6ac0' },
  { id: 'truck_semi', name: 'Ciągnik siodłowy', icon: '🚛', mode: 'road', capacity: 90, speed: 15, cost: 18000, upkeep: 320, era: 'modern', lifespanYears: 15, emissions: 0.3, color: '#e0e0e0' },
  { id: 'truck_ev', name: 'Elektryczna ciężarówka', icon: '🔌', mode: 'road', capacity: 90, speed: 15, cost: 30000, upkeep: 200, era: 'digital', requiresTech: 'electric_vehicles', lifespanYears: 15, emissions: 0, color: '#40c0a0', description: 'Zero emisji, niskie koszty utrzymania.' },
  { id: 'truck_autonomous', name: 'Autonomiczna ciężarówka', icon: '🤖', mode: 'road', capacity: 100, speed: 17, cost: 45000, upkeep: 150, era: 'digital', requiresTech: 'robotics', lifespanYears: 15, emissions: 0, color: '#a0a0ff', description: 'Bez kierowcy: najniższe koszty utrzymania.' },

  // ======================================================== rail
  { id: 'steam_train', name: 'Parowóz', icon: '🚂', mode: 'rail', capacity: 30, speed: 10, cost: 15000, upkeep: 350, era: 'industrial', requiresTech: 'railways', lifespanYears: 30, emissions: 0.5, wagons: { min: 1, max: 6, costPerWagon: 1500 }, color: '#303030' },
  { id: 'diesel_train', name: 'Lokomotywa spalinowa', icon: '🚆', mode: 'rail', capacity: 50, speed: 16, cost: 40000, upkeep: 700, era: 'mass', requiresTech: 'diesel_engines', lifespanYears: 30, emissions: 0.4, wagons: { min: 2, max: 10, costPerWagon: 3000 }, color: '#c08030' },
  { id: 'electric_train', name: 'Lokomotywa elektryczna', icon: '🚄', mode: 'rail', capacity: 60, speed: 22, cost: 70000, upkeep: 800, era: 'modern', lifespanYears: 30, emissions: 0.1, wagons: { min: 2, max: 12, costPerWagon: 4000 }, color: '#3060c0' },
  { id: 'maglev_cargo', name: 'Pociąg towarowy dużych prędkości', icon: '🚅', mode: 'rail', capacity: 70, speed: 32, cost: 150000, upkeep: 1200, era: 'digital', requiresTech: 'robotics', lifespanYears: 30, emissions: 0, wagons: { min: 2, max: 12, costPerWagon: 6000 }, color: '#e0e0f0' },

  // ======================================================== water
  { id: 'sail_barge', name: 'Barka żaglowa', icon: '⛵', mode: 'water', capacity: 120, speed: 6, cost: 10000, upkeep: 220, era: 'industrial', lifespanYears: 25, emissions: 0, color: '#c0a070', description: 'Tania i pojemna, ale powolna.' },
  { id: 'steamship', name: 'Parowiec towarowy', icon: '🚢', mode: 'water', capacity: 250, speed: 9, cost: 30000, upkeep: 500, era: 'electric', requiresTech: 'steamships', lifespanYears: 30, emissions: 1, color: '#404040' },
  { id: 'cargo_ship', name: 'Drobnicowiec', icon: '🚢', mode: 'water', capacity: 450, speed: 11, cost: 60000, upkeep: 800, era: 'mass', requiresTech: 'steamships', lifespanYears: 30, emissions: 1, color: '#6a4a3a' },
  { id: 'container_ship', name: 'Kontenerowiec', icon: '🛳️', mode: 'water', capacity: 900, speed: 13, cost: 120000, upkeep: 1400, era: 'modern', requiresTech: 'containerization', lifespanYears: 30, emissions: 1.2, color: '#c04030' },

  // ======================================================== air
  { id: 'cargo_drone', name: 'Dron towarowy', icon: '🛸', mode: 'air', capacity: 6, speed: 30, cost: 6000, upkeep: 60, era: 'digital', requiresTech: 'drones_tech', cargo: ['light'], lifespanYears: 8, emissions: 0, color: '#a0a0e0', description: 'Lekkie towary na krótkich dystansach, bez dróg.' },
  { id: 'heavy_drone', name: 'Dron ciężki', icon: '🚁', mode: 'air', capacity: 15, speed: 24, cost: 18000, upkeep: 150, era: 'digital', requiresTech: 'robotics', cargo: ['light', 'normal'], lifespanYears: 8, emissions: 0, color: '#8080c0' },
];
