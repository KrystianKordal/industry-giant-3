import type { TechDef } from './defs';

/**
 * Technology tree (~36 techs, 5 eras).
 *
 * A tech can be researched when all prereqs are done and its era is reachable
 * for the company (tech.era index <= company era index). `era_*` techs move the
 * company (and, for the player, the world) into the next era early.
 *
 * Modifier effects are MULTIPLIED into company.modifiers["<effect>.<target>"]
 * (1 = neutral). Targets: building type id, building category, building tag
 * ('farm', 'mine', 'food', 'heavy', …), vehicle mode/id, or 'all'.
 * Effects read by economy: efficiency, quality (value − 1 added), workers,
 * upkeep, emissions, sales, research, wages, interest, capacity, buildSpeed.
 * Read by logistics: speed.<mode|vehicleId>, upkeep.vehicles, capacity.<vehicle mode>.
 */
export const TECHS: TechDef[] = [
  // ======================================================== industrial
  { id: 'crop_rotation', name: 'Płodozmian', icon: '🌱', cost: 120, prereqs: [], era: 'industrial', effects: [{ kind: 'modifier', key: 'efficiency.farm', value: 1.15 }], description: 'Farmy produkują o 15% więcej.' },
  { id: 'accounting', name: 'Księgowość podwójna', icon: '📒', cost: 120, prereqs: [], era: 'industrial', effects: [{ kind: 'modifier', key: 'upkeep.all', value: 0.9 }], description: 'Koszty utrzymania budynków −10%.' },
  { id: 'steam_power', name: 'Maszyna parowa', icon: '⚙️', cost: 180, prereqs: [], era: 'industrial', effects: [{ kind: 'modifier', key: 'efficiency.factory', value: 1.1 }, { kind: 'unlockVehicle', id: 'steam_wagon' }], description: 'Fabryki +10% wydajności. Odblokowuje parowy wóz drogowy.' },
  { id: 'blasting', name: 'Materiały wybuchowe', icon: '🧨', cost: 160, prereqs: [], era: 'industrial', effects: [{ kind: 'modifier', key: 'efficiency.mine', value: 1.2 }], description: 'Kopalnie wydobywają o 20% więcej.' },
  { id: 'textile_machinery', name: 'Krosna mechaniczne', icon: '🧵', cost: 200, prereqs: ['steam_power'], era: 'industrial', effects: [{ kind: 'modifier', key: 'efficiency.textile', value: 1.25 }, { kind: 'modifier', key: 'workers.textile', value: 0.8 }], description: 'Zakłady tekstylne +25% wydajności i −20% pracowników.' },
  { id: 'railways', name: 'Koleje żelazne', icon: '🚂', cost: 250, prereqs: ['steam_power'], era: 'industrial', effects: [{ kind: 'unlockBuilding', id: 'train_station' }, { kind: 'unlockVehicle', id: 'steam_train' }], description: 'Odblokowuje stacje kolejowe i parowozy.' },
  { id: 'bessemer_process', name: 'Proces Bessemera', icon: '🔥', cost: 300, prereqs: ['steam_power', 'blasting'], era: 'industrial', effects: [{ kind: 'unlockRecipe', id: 'smelt_steel_bessemer' }, { kind: 'modifier', key: 'efficiency.heavy', value: 1.1 }], description: 'Tańsza i lepsza stal. Przemysł ciężki +10%.' },
  { id: 'era_electric', name: 'Elektryczność', icon: '⚡', cost: 1500, prereqs: ['railways', 'bessemer_process'], era: 'industrial', effects: [{ kind: 'era', id: 'electric' }], description: 'Przejście do epoki elektryczności: nowe produkty, budynki i pojazdy.' },

  // ======================================================== electric
  { id: 'electrification', name: 'Elektryfikacja', icon: '💡', cost: 500, prereqs: ['era_electric'], era: 'electric', effects: [{ kind: 'unlockBuilding', id: 'coal_power_plant' }, { kind: 'modifier', key: 'efficiency.factory', value: 1.1 }], description: 'Elektrownie węglowe. Fabryki +10%.' },
  { id: 'combustion_engine', name: 'Silnik spalinowy', icon: '⛽', cost: 600, prereqs: ['era_electric'], era: 'electric', effects: [{ kind: 'unlockVehicle', id: 'truck_early' }, { kind: 'unlockBuilding', id: 'oil_well' }], description: 'Ciężarówki i szyby naftowe.' },
  { id: 'refining', name: 'Rafinacja ropy', icon: '🛢️', cost: 700, prereqs: ['combustion_engine'], era: 'electric', effects: [{ kind: 'unlockBuilding', id: 'refinery' }, { kind: 'unlockVehicle', id: 'tanker_truck' }], description: 'Rafinerie (paliwo + chemikalia) i cysterny.' },
  { id: 'chemistry', name: 'Chemia przemysłowa', icon: '🧪', cost: 700, prereqs: ['refining'], era: 'electric', effects: [{ kind: 'unlockBuilding', id: 'chemical_plant' }, { kind: 'modifier', key: 'efficiency.farm', value: 1.1 }], description: 'Zakłady chemiczne i nawozy sztuczne. Farmy +10%.' },
  { id: 'refrigeration', name: 'Chłodnictwo', icon: '❄️', cost: 550, prereqs: ['electrification'], era: 'electric', effects: [{ kind: 'unlockBuilding', id: 'cannery' }, { kind: 'modifier', key: 'perish.all', value: 0.5 }, { kind: 'modifier', key: 'efficiency.food', value: 1.1 }], description: 'Konserwownie; żywność psuje się 2× wolniej.' },
  { id: 'steamships', name: 'Statki parowe', icon: '🚢', cost: 500, prereqs: ['era_electric'], era: 'electric', effects: [{ kind: 'unlockVehicle', id: 'steamship' }, { kind: 'modifier', key: 'speed.water', value: 1.1 }], description: 'Parowce towarowe.' },
  { id: 'assembly_line', name: 'Taśma produkcyjna', icon: '🏭', cost: 1000, prereqs: ['electrification'], era: 'electric', effects: [{ kind: 'modifier', key: 'efficiency.factory', value: 1.2 }, { kind: 'modifier', key: 'workers.factory', value: 0.85 }], description: 'Fabryki +20% i −15% pracowników. Odblokowuje modernizację maszyn.' },
  { id: 'era_mass', name: 'Produkcja masowa', icon: '🏭', cost: 3200, prereqs: ['assembly_line', 'refining'], era: 'electric', effects: [{ kind: 'era', id: 'mass' }], description: 'Przejście do epoki produkcji masowej.' },

  // ======================================================== mass production
  { id: 'plastics_tech', name: 'Tworzywa sztuczne', icon: '🧴', cost: 1500, prereqs: ['era_mass', 'chemistry'], era: 'mass', effects: [{ kind: 'unlockProduct', id: 'plastics' }, { kind: 'unlockRecipe', id: 'make_plastics' }], description: 'Plastik, zabawki i AGD.' },
  { id: 'automobiles', name: 'Motoryzacja', icon: '🚗', cost: 2000, prereqs: ['era_mass', 'plastics_tech'], era: 'mass', effects: [{ kind: 'unlockBuilding', id: 'car_factory' }], description: 'Fabryki samochodów.' },
  { id: 'diesel_engines', name: 'Silnik Diesla', icon: '🚆', cost: 1500, prereqs: ['era_mass'], era: 'mass', effects: [{ kind: 'unlockVehicle', id: 'truck_diesel' }, { kind: 'unlockVehicle', id: 'diesel_train' }], description: 'Ciężarówki i lokomotywy spalinowe.' },
  { id: 'electronics_basic', name: 'Elektronika lampowa', icon: '📻', cost: 1800, prereqs: ['era_mass', 'plastics_tech'], era: 'mass', effects: [{ kind: 'unlockBuilding', id: 'radio_factory' }], description: 'Radioodbiorniki.' },
  { id: 'automation_1', name: 'Automatyzacja', icon: '🤖', cost: 2200, prereqs: ['era_mass'], era: 'mass', effects: [{ kind: 'modifier', key: 'workers.all', value: 0.8 }], description: 'Wszystkie budynki potrzebują 20% mniej pracowników. Płace rosną z każdą epoką szybciej niż ceny — automatyzacja utrzymuje stare łańcuchy na plusie.' },
  { id: 'marketing', name: 'Marketing', icon: '📣', cost: 1200, prereqs: ['era_mass'], era: 'mass', effects: [{ kind: 'modifier', key: 'sales.all', value: 1.15 }], description: 'Sklepy przyciągają 15% więcej klientów. Kampanie reklamowe.' },
  { id: 'era_modern', name: 'Era informacji', icon: '🛰️', cost: 6500, prereqs: ['automation_1', 'electronics_basic'], era: 'mass', effects: [{ kind: 'era', id: 'modern' }], description: 'Przejście do ery nowoczesnej.' },

  // ======================================================== modern
  { id: 'containerization', name: 'Konteneryzacja', icon: '📦', cost: 3000, prereqs: ['era_modern'], era: 'modern', effects: [{ kind: 'unlockBuilding', id: 'logistics_hub' }, { kind: 'unlockVehicle', id: 'container_ship' }, { kind: 'modifier', key: 'capacity.warehouse', value: 1.5 }], description: 'Kontenerowce, centra logistyczne, magazyny +50%.' },
  { id: 'microchips', name: 'Mikroprocesory', icon: '💾', cost: 4000, prereqs: ['era_modern'], era: 'modern', effects: [{ kind: 'unlockBuilding', id: 'component_factory' }, { kind: 'unlockBuilding', id: 'electronics_plant' }], description: 'Komponenty, komputery, telewizory.' },
  { id: 'environmental_tech', name: 'Technologie środowiskowe', icon: '🌿', cost: 3000, prereqs: ['era_modern'], era: 'modern', effects: [{ kind: 'modifier', key: 'emissions.all', value: 0.75 }, { kind: 'unlockBuilding', id: 'recycling_plant' }, { kind: 'unlockBuilding', id: 'organic_farm' }], description: 'Emisje −25%, recykling, farmy ekologiczne, filtry emisji.' },
  { id: 'renewables', name: 'Odnawialne źródła energii', icon: '🌞', cost: 3500, prereqs: ['environmental_tech'], era: 'modern', effects: [{ kind: 'unlockBuilding', id: 'wind_farm' }, { kind: 'unlockBuilding', id: 'solar_farm' }], description: 'Farmy wiatrowe i słoneczne.' },
  { id: 'lithium_batteries', name: 'Baterie litowe', icon: '🔋', cost: 4000, prereqs: ['microchips'], era: 'modern', effects: [{ kind: 'unlockBuilding', id: 'lithium_mine' }, { kind: 'unlockBuilding', id: 'battery_factory' }], description: 'Kopalnie litu i fabryki baterii.' },
  { id: 'industrial_robots', name: 'Roboty przemysłowe', icon: '🦿', cost: 3500, prereqs: ['era_modern', 'automation_1'], era: 'modern', effects: [{ kind: 'modifier', key: 'workers.all', value: 0.8 }, { kind: 'modifier', key: 'efficiency.factory', value: 1.05 }], description: 'Kolejne −20% pracowników we wszystkich budynkach i fabryki +5%. Odpowiedź na wysokie płace ery nowoczesnej.' },
  { id: 'logistics_software', name: 'Systemy logistyczne', icon: '🗺️', cost: 3000, prereqs: ['era_modern'], era: 'modern', effects: [{ kind: 'modifier', key: 'speed.road', value: 1.15 }, { kind: 'modifier', key: 'upkeep.vehicles', value: 0.85 }], description: 'Pojazdy drogowe +15% szybsze, utrzymanie floty −15%.' },
  { id: 'era_digital', name: 'Rewolucja cyfrowa', icon: '📱', cost: 14000, prereqs: ['microchips', 'containerization'], era: 'modern', effects: [{ kind: 'era', id: 'digital' }], description: 'Przejście do ery cyfrowej.' },

  // ======================================================== digital
  { id: 'smartphones_tech', name: 'Smartfony', icon: '📱', cost: 8000, prereqs: ['era_digital', 'lithium_batteries'], era: 'digital', effects: [{ kind: 'unlockBuilding', id: 'smartphone_factory' }], description: 'Fabryki smartfonów.' },
  { id: 'cloud_computing', name: 'Chmura obliczeniowa', icon: '☁️', cost: 9000, prereqs: ['era_digital'], era: 'digital', effects: [{ kind: 'unlockBuilding', id: 'data_center' }, { kind: 'unlockBuilding', id: 'server_factory' }, { kind: 'unlockBuilding', id: 'online_store' }], description: 'Centra danych, serwery i e-commerce.' },
  { id: 'drones_tech', name: 'Drony dostawcze', icon: '🛸', cost: 7000, prereqs: ['era_digital'], era: 'digital', effects: [{ kind: 'unlockBuilding', id: 'drone_port' }, { kind: 'unlockVehicle', id: 'cargo_drone' }], description: 'Dronoporty i drony — logistyka ostatniej mili.' },
  { id: 'electric_vehicles', name: 'Elektromobilność', icon: '🔌', cost: 8000, prereqs: ['era_digital', 'lithium_batteries'], era: 'digital', effects: [{ kind: 'unlockBuilding', id: 'ev_factory' }, { kind: 'unlockVehicle', id: 'truck_ev' }], description: 'Auta i ciężarówki elektryczne.' },
  { id: 'big_data', name: 'Big Data', icon: '📊', cost: 7000, prereqs: ['cloud_computing'], era: 'digital', effects: [{ kind: 'modifier', key: 'sales.all', value: 1.15 }, { kind: 'modifier', key: 'research.all', value: 1.25 }], description: 'Lepsze prognozy popytu: sprzedaż +15%, badania +25%.' },
  { id: 'robotics', name: 'Robotyka', icon: '🦾', cost: 12000, prereqs: ['era_digital', 'industrial_robots'], era: 'digital', effects: [{ kind: 'modifier', key: 'workers.all', value: 0.6 }, { kind: 'modifier', key: 'efficiency.all', value: 1.1 }, { kind: 'unlockVehicle', id: 'truck_autonomous' }], description: 'Pracownicy −40%, wydajność +10%, autonomiczne ciężarówki.' },
  { id: 'fusion_power', name: 'Zielona sieć energetyczna', icon: '♾️', cost: 15000, prereqs: ['renewables', 'era_digital'], era: 'digital', effects: [{ kind: 'modifier', key: 'emissions.all', value: 0.6 }, { kind: 'modifier', key: 'energyPrice.all', value: 0.6 }], description: 'Emisje −40%, prąd z sieci 40% tańszy.' },
];
