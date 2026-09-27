/**
 * Main menu overlay (shown when no game runs): title, continue, new game
 * dialog (seed + random, map size & type, difficulty, rivals 0–4, starting
 * era, cities, company name & colour, advanced options), campaign, load,
 * import, settings, encyclopedia.
 */
import { GAME_VERSION } from '../core/constants';
import type { GameContext } from '../core/context';
import { formatMoney } from '../core/format';
import { startNewGame } from '../core/lifecycle';
import { AUTOSAVE_SLOT, hasSlot, listSlots } from '../core/save';
import { START_CASH } from '../core/state';
import type { Difficulty, MapPreset, NewGameOptions } from '../core/types';
import { button, segmented, select, slider } from './components';
import { h, setChildren } from './dom';
import { importAndStart, loadSlotAndStart } from './panels/saveLoad';
import type { UiManager } from './ui';

export const COMPANY_COLORS = ['#e8b04a', '#e0564a', '#4a9ee0', '#5cc486', '#b07be0', '#e07bb0', '#4ad0c8', '#f08a3c', '#9aa8b8'];
const MAP_SIZES: { value: number; label: string; title: string }[] = [
  { value: 64, label: 'Mała', title: '64×64 — szybka partia' },
  { value: 96, label: 'Średnia', title: '96×96' },
  { value: 128, label: 'Duża', title: '128×128 — zalecana' },
  { value: 192, label: 'Wielka', title: '192×192' },
  { value: 256, label: 'Ogromna', title: '256×256 — dla cierpliwych' },
];
const PRESETS: { value: MapPreset; label: string }[] = [
  { value: 'continent', label: '🌍 Kontynent' },
  { value: 'coast', label: '🏖️ Wybrzeże' },
  { value: 'inland', label: '⛰️ Śródlądzie' },
  { value: 'islands', label: '🏝️ Wyspy' },
  { value: 'archipelago', label: '🌊 Archipelag' },
];
const DIFFS: { value: Difficulty; label: string; title: string }[] = [
  { value: 'easy', label: 'Łatwy', title: `Start: ${formatMoney(START_CASH.easy)}, spokojni rywale` },
  { value: 'normal', label: 'Normalny', title: `Start: ${formatMoney(START_CASH.normal)}` },
  { value: 'hard', label: 'Trudny', title: `Start: ${formatMoney(START_CASH.hard)}, agresywni rywale, wymagające miasta` },
];

const randomSeed = (): number => Math.floor(Math.random() * 0xffffffff) >>> 0;

export function installMainMenu(ctx: GameContext, ui: UiManager): void {
  const menu = h('div', { class: 'ig-main-menu' });
  const bg = h('div', { class: 'ig-menu-bg' }, skyline());
  ui.overlayLayer.append(menu);

  const opts: Partial<NewGameOptions> & { seed: number } = {
    seed: randomSeed(),
    mapWidth: 128,
    mapHeight: 128,
    mapPreset: 'continent',
    difficulty: 'normal',
    rivals: 3,
    startYear: 1850,
    companyName: 'Moja Firma',
    companyColor: COMPANY_COLORS[0]!,
    cityCount: 8,
    disasters: true,
    politicalEvents: true,
    resourceAbundance: 1,
    waterLevel: 0.35,
    mode: 'sandbox',
    scenarioId: null,
  };

  const start = (o: Partial<NewGameOptions>): void => {
    try {
      ctx.services.audio.unlock();
    } catch {
      /* audio optional */
    }
    menu.classList.add('ig-menu-leaving');
    setTimeout(() => {
      try {
        startNewGame(ctx, o);
      } catch (err) {
        console.error(err);
        menu.classList.remove('ig-menu-leaving');
        ctx.ui.toast({ level: 'danger', title: 'Nie udało się rozpocząć gry', text: String(err) });
      }
    }, 30);
  };

  const renderMain = (): void => {
    const slots = listSlots();
    const last = slots[0];
    const scenarios = safeScenarios(ctx);
    setChildren(
      menu,
      bg,
      h(
        'div',
        { class: 'ig-main-menu-card' },
        h('div', { class: 'ig-main-logo' }, '🏭'),
        h('div', { class: 'ig-main-title' }, 'Industry Giant 3'),
        h('div', { class: 'ig-main-subtitle' }, 'Zbuduj przemysłowe imperium — od farmy po smartfony.'),
        h(
          'div',
          { class: 'ig-col ig-main-buttons' },
          last
            ? button(`Kontynuuj — ${last.companyName}`, () => void loadSlotAndStart(ctx, last.slot), { variant: 'primary', icon: '▶', title: `${last.gameDate} · ${formatMoney(last.cash, true)}` })
            : null,
          button('Nowa gra', renderNewGame, { variant: last ? 'default' : 'primary', icon: '🏭' }),
          button('Kampania', () => ctx.ui.openPanel('campaign'), { icon: '🎖', disabled: scenarios.length === 0, title: scenarios.length ? `${scenarios.length} scenariuszy` : 'Brak scenariuszy' }),
          button('Wczytaj grę', () => ctx.ui.openPanel('saveLoad', { mode: 'load' }), { icon: '📂', disabled: slots.length === 0 }),
          h(
            'div',
            { class: 'ig-row' },
            button('Import', () => void importAndStart(ctx), { icon: '⬆', title: 'Wczytaj zapis z pliku .ig3save' }),
            button('Encyklopedia', () => ctx.ui.openPanel('encyclopedia'), { icon: '📖' }),
            button('', () => ctx.ui.openPanel('settings'), { icon: '⚙️', title: 'Ustawienia' }),
          ),
        ),
        h('div', { class: 'ig-main-footer' }, `v${GAME_VERSION}`, hasSlot(AUTOSAVE_SLOT) ? ' · autozapis dostępny' : ''),
      ),
    );
  };

  const renderNewGame = (): void => {
    const seedInput = h('input', {
      type: 'text',
      class: 'ig-seed',
      value: String(opts.seed),
      oninput: () => {
        const n = Number(seedInput.value.replace(/\D/g, ''));
        opts.seed = Number.isFinite(n) && n > 0 ? n >>> 0 : hashText(seedInput.value);
      },
    });
    const dice = button('', () => {
      opts.seed = randomSeed();
      seedInput.value = String(opts.seed);
    }, { icon: '🎲', title: 'Losowe ziarno' });
    const nameInput = h('input', { type: 'text', class: 'ig-input-wide', value: opts.companyName ?? '', maxLength: 32, oninput: () => (opts.companyName = nameInput.value) });
    const swatches = h(
      'div',
      { class: 'ig-swatches' },
      COMPANY_COLORS.map((c) => {
        const s = h('button', {
          class: `ig-swatch${c === opts.companyColor ? ' active' : ''}`,
          style: { background: c },
          onclick: () => {
            opts.companyColor = c;
            for (const el of swatches.querySelectorAll('.ig-swatch')) el.classList.toggle('active', el === s);
            preview.style.setProperty('--co', c);
          },
        });
        return s;
      }),
    );
    const preview = h('div', { class: 'ig-company-preview' }, '🏭');
    preview.style.setProperty('--co', opts.companyColor ?? COMPANY_COLORS[0]!);

    const eras = ctx.data.eraList();
    const cashLabel = h('span', { class: 'ig-muted ig-small' });
    const updCash = (): void => setChildren(cashLabel, `Kapitał startowy: ${formatMoney(START_CASH[opts.difficulty ?? 'normal'])}`);
    updCash();

    const field = (label: string, ...ctl: (HTMLElement | null)[]): HTMLElement => h('div', { class: 'ig-ng-field' }, h('div', { class: 'ig-ng-label' }, label), h('div', { class: 'ig-ng-control' }, ctl));
    const advanced = h(
      'details',
      { class: 'ig-ng-adv' },
      h('summary', null, 'Opcje zaawansowane'),
      field('Liczba miast', slider({ min: 4, max: 16, step: 1, value: opts.cityCount ?? 8 }, (v) => (opts.cityCount = v)).el),
      field('Zasoby', slider({ min: 0.5, max: 2, step: 0.25, value: opts.resourceAbundance ?? 1, format: (v) => `×${v}` }, (v) => (opts.resourceAbundance = v)).el),
      field('Poziom wody', slider({ min: 0.15, max: 0.6, step: 0.05, value: opts.waterLevel ?? 0.35, format: (v) => `${Math.round(v * 100)}%` }, (v) => (opts.waterLevel = v)).el),
      field(
        'Wydarzenia',
        h('label', { class: 'ig-field-check' }, h('input', { type: 'checkbox', checked: opts.disasters, onchange: (e: Event) => (opts.disasters = (e.target as HTMLInputElement).checked) }), ' katastrofy'),
        h('label', { class: 'ig-field-check' }, h('input', { type: 'checkbox', checked: opts.politicalEvents, onchange: (e: Event) => (opts.politicalEvents = (e.target as HTMLInputElement).checked) }), ' polityka i gospodarka'),
      ),
    );

    setChildren(
      menu,
      bg,
      h(
        'div',
        { class: 'ig-main-menu-card ig-newgame' },
        h('div', { class: 'ig-ng-head' }, h('div', { class: 'ig-main-title small' }, 'Nowa gra'), h('div', { class: 'ig-muted' }, 'Tryb swobodny na losowej mapie')),
        h(
          'div',
          { class: 'ig-ng-grid' },
          h(
            'div',
            { class: 'ig-ng-col' },
            h('div', { class: 'ig-section-title' }, 'Firma'),
            h('div', { class: 'ig-row' }, preview, h('div', { class: 'ig-grow' }, nameInput)),
            field('Kolor', swatches),
            h('div', { class: 'ig-section-title' }, 'Rozgrywka'),
            field(
              'Trudność',
              segmented(DIFFS, opts.difficulty ?? 'normal', (v) => {
                opts.difficulty = v;
                updCash();
              }).el,
            ),
            cashLabel,
            field('Rywale AI', slider({ min: 0, max: 4, step: 1, value: opts.rivals ?? 3, format: (v) => (v === 0 ? 'brak' : String(v)) }, (v) => (opts.rivals = v)).el),
            field(
              'Epoka startowa',
              select(
                eras.map((e) => ({ value: e.startYear, label: `${e.icon} ${e.name} (${e.startYear})` })),
                opts.startYear ?? eras[0]?.startYear ?? 1850,
                (v) => (opts.startYear = v),
              ),
            ),
          ),
          h(
            'div',
            { class: 'ig-ng-col' },
            h('div', { class: 'ig-section-title' }, 'Mapa'),
            field(
              'Rozmiar',
              segmented(
                MAP_SIZES.map((m) => ({ value: m.value, label: m.label, title: m.title })),
                opts.mapWidth ?? 128,
                (v) => {
                  opts.mapWidth = v;
                  opts.mapHeight = v;
                },
              ).el,
            ),
            field('Typ', select(PRESETS, opts.mapPreset ?? 'continent', (v) => (opts.mapPreset = v))),
            field('Ziarno', h('div', { class: 'ig-row' }, seedInput, dice)),
            advanced,
          ),
        ),
        h(
          'div',
          { class: 'ig-row ig-ng-foot' },
          button('Wstecz', renderMain, { variant: 'ghost', icon: '←' }),
          h('span', { class: 'ig-grow' }),
          button('Rozpocznij', () => start({ ...opts, companyName: (opts.companyName ?? '').trim() || 'Moja Firma' }), { variant: 'primary', icon: '▶' }),
        ),
      ),
    );
    setTimeout(() => nameInput.focus(), 0);
  };

  const show = (): void => {
    menu.classList.remove('ig-menu-leaving');
    renderMain();
    menu.style.display = '';
  };
  const hide = (): void => {
    menu.style.display = 'none';
  };
  ctx.bus.on('game:started', hide);
  ctx.bus.on('game:ended', () => setTimeout(show, 0));
  show();
  // refresh "continue" / campaign availability after late registrations
  setTimeout(() => {
    if (!ctx.hasGame && menu.querySelector('.ig-main-buttons')) renderMain();
  }, 0);
}

function safeScenarios(ctx: GameContext): unknown[] {
  try {
    return ctx.services.game.scenarios();
  } catch {
    return [];
  }
}

function hashText(s: string): number {
  let h2 = 2166136261;
  for (let i = 0; i < s.length; i++) h2 = Math.imul(h2 ^ s.charCodeAt(i), 16777619);
  return h2 >>> 0 || 1;
}

/** Decorative factory skyline (SVG) for the menu background. */
function skyline(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 1200 300');
  svg.setAttribute('preserveAspectRatio', 'xMidYMax slice');
  svg.classList.add('ig-skyline');
  const shapes =
    'M0 300 V220 H60 V180 H90 V220 H140 V150 H160 V90 H175 V150 H200 V200 H260 V170 H300 V200 H340 V120 H352 V70 H364 V120 H380 V210 H440 V190 H470 V160 H520 V190 H560 V230 H600 V140 H640 V100 H652 V60 H662 V100 H700 V180 H760 V200 H800 V150 H830 V200 H880 V120 H890 V80 H902 V120 H930 V210 H990 V170 H1040 V200 H1080 V160 H1100 V110 H1112 V160 H1150 V220 H1200 V300 Z';
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', shapes);
  svg.append(p);
  for (const [x, y] of [
    [167, 90],
    [358, 70],
    [657, 60],
    [896, 80],
    [1106, 110],
  ] as const) {
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', String(x));
    c.setAttribute('cy', String(y - 10));
    c.setAttribute('r', '10');
    c.classList.add('ig-smoke');
    svg.append(c);
  }
  return svg;
}
