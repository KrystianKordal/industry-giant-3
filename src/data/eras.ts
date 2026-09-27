import type { EraDef } from './defs';

/**
 * 5 eras 1850 → 2020. The global era follows the calendar (core.era) but the
 * player usually gets there earlier by researching the era technology
 * (`era_electric`, `era_mass`, …; see tech.ts) — economy then advances
 * state.time.eraId and emits 'era:changed'.
 */
export const ERAS: EraDef[] = [
  { id: 'industrial', index: 0, name: 'Rewolucja przemysłowa', startYear: 1850, color: '#b08850', icon: '🚂', description: 'Para, węgiel i żelazo. Proste łańcuchy, konne wozy i pierwsze koleje.' },
  { id: 'electric', index: 1, name: 'Epoka elektryczności', startYear: 1900, color: '#d9b44a', icon: '💡', description: 'Elektryfikacja, pierwsze ciężarówki, ropa naftowa i przemysł chemiczny.' },
  { id: 'mass', index: 2, name: 'Produkcja masowa', startYear: 1950, color: '#6fa3d8', icon: '🏭', description: 'Taśmy produkcyjne, samochody, plastik i dobra konsumpcyjne dla każdego.' },
  { id: 'modern', index: 3, name: 'Era nowoczesna', startYear: 1990, color: '#5fc28d', icon: '🛰️', description: 'Kontenery, komputery, autostrady i rosnąca świadomość ekologiczna.' },
  { id: 'digital', index: 4, name: 'Era cyfrowa', startYear: 2020, color: '#b07be0', icon: '📱', description: 'Smartfony, centra danych, drony i zielona energia.' },
];
