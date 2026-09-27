/** Settings panel (user preferences, persisted in localStorage). */
import { saveUserSettings } from '../../core/settings';
import type { UserSettings } from '../../core/types';
import { segmented } from '../components';
import { h } from '../dom';
import type { PanelDef } from '../types';

type NumKey = { [K in keyof UserSettings]: UserSettings[K] extends number ? K : never }[keyof UserSettings];
type BoolKey = { [K in keyof UserSettings]: UserSettings[K] extends boolean ? K : never }[keyof UserSettings];

export const settingsPanel: PanelDef = {
  id: 'settings',
  title: 'Ustawienia',
  icon: '⚙️',
  width: 380,
  refreshMs: 0,
  create(p, ctx) {
    const s = ctx.userSettings;
    const changed = (): void => {
      saveUserSettings(s);
      ctx.services.audio.applySettings();
      ctx.bus.emit('settings:changed', {});
    };
    const slider = (key: NumKey, label: string, min: number, max: number, step: number): HTMLElement =>
      h(
        'label',
        { class: 'ig-field' },
        h('span', null, label),
        h('input', {
          type: 'range',
          min,
          max,
          step,
          value: String(s[key]),
          oninput: (e: Event) => {
            (s[key] as number) = Number((e.target as HTMLInputElement).value);
            changed();
          },
        }),
      );
    const check = (key: BoolKey, label: string): HTMLElement =>
      h(
        'label',
        { class: 'ig-field ig-field-check' },
        h('input', {
          type: 'checkbox',
          checked: s[key],
          onchange: (e: Event) => {
            (s[key] as boolean) = (e.target as HTMLInputElement).checked;
            changed();
          },
        }),
        h('span', null, label),
      );
    const autosave = h(
      'select',
      {
        onchange: (e: Event) => {
          s.autosaveMonths = Number((e.target as HTMLSelectElement).value);
          changed();
        },
      },
      [0, 1, 3, 6, 12].map((m) => h('option', { value: String(m), selected: s.autosaveMonths === m }, m === 0 ? 'Wyłączony' : `Co ${m} mies.`)),
    );
    p.body.append(
      h('div', { class: 'ig-section-title' }, 'Dźwięk'),
      slider('masterVolume', 'Głośność ogólna', 0, 1, 0.05),
      slider('musicVolume', 'Muzyka', 0, 1, 0.05),
      slider('sfxVolume', 'Efekty', 0, 1, 0.05),
      slider('ambientVolume', 'Otoczenie', 0, 1, 0.05),
      check('muted', 'Wycisz wszystko'),
      h('div', { class: 'ig-section-title' }, 'Rozgrywka'),
      h('label', { class: 'ig-field' }, h('span', null, 'Autozapis'), autosave),
      check('advisorEnabled', 'Podpowiedzi doradcy'),
      check('edgeScroll', 'Przewijanie krawędzią ekranu'),
      slider('scrollSpeed', 'Szybkość przewijania', 0.3, 3, 0.1),
      h('div', { class: 'ig-section-title' }, 'Interfejs'),
      h(
        'div',
        { class: 'ig-field' },
        h('span', null, 'Skala interfejsu'),
        segmented(
          [0.85, 1, 1.15, 1.3, 1.5].map((v) => ({ value: v, label: `${Math.round(v * 100)}%` })),
          [0.85, 1, 1.15, 1.3, 1.5].reduce((a, b) => (Math.abs(b - s.uiScale) < Math.abs(a - s.uiScale) ? b : a), 1),
          (v) => {
            s.uiScale = v;
            changed();
          },
        ).el,
      ),
      h('div', { class: 'ig-section-title' }, 'Grafika'),
      check('showGrid', 'Siatka kafli [G]'),
      check('dayNightCycle', 'Cykl dnia i nocy oraz pór roku'),
      check('tiltShift', 'Efekt tilt-shift (miniatura)'),
      check('reducedMotion', 'Ogranicz animacje'),
      check('showFps', 'Pokaż FPS'),
    );
  },
};
