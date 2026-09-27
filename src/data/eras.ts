import type { EraDef } from './defs';

/** 5 eras 1850 → 2020. The era of a game is derived from the calendar year (and may be gated by research). */
export const ERAS: EraDef[] = [
  { id: 'industrial', index: 0, name: 'Rewolucja przemysłowa', startYear: 1850, color: '#b08850', icon: '🚂', description: 'Para, węgiel i żelazo. Proste łańcuchy, konne wozy i pierwsze koleje.' },
  { id: 'electric', index: 1, name: 'Epoka elektryczności', startYear: 1890, color: '#d9b44a', icon: '💡', description: 'Elektryfikacja, pierwsze ciężarówki i przemysł chemiczny.' },
  { id: 'mass', index: 2, name: 'Produkcja masowa', startYear: 1925, color: '#6fa3d8', icon: '🏭', description: 'Taśmy produkcyjne, samochody, plastik i dobra konsumpcyjne.' },
  { id: 'modern', index: 3, name: 'Era nowoczesna', startYear: 1960, color: '#5fc28d', icon: '🛰️', description: 'Kontenery, elektronika, autostrady i świadomość ekologiczna.' },
  { id: 'digital', index: 4, name: 'Era cyfrowa', startYear: 1995, color: '#b07be0', icon: '📱', description: 'Smartfony, centra danych, drony i zielona energia.' },
];
