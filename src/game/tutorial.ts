/**
 * Step-by-step tutorial engine (scenario 1 "Chleb powszedni").
 * Progress lives in state.advisor.tutorialStep (-1 = none / finished).
 * Steps advance automatically when their condition holds (checked on relevant
 * bus events and daily), or manually ("Dalej") for info steps.
 * Highlights: toolbar buttons (DOM class .ig-tut-highlight on elements with a
 * matching data-id / data-tool / label) and a pulsing marker on a map tile
 * (render layer 'game.tutorial').
 */
import type { GameContext } from '../core/context';
import { TILE_SIZE } from '../core/constants';
import { notify } from '../core/notify';
import type { Building, GameState, TilePos } from '../core/types';
import { selectCity } from './objectives';
import { gameExt } from './tracking';

export interface TutorialStep {
  id: string;
  title: string;
  text: string;
  /** Toolbar/button ids or labels to highlight. */
  highlight?: string[];
  /** Map target for the marker/camera. */
  target?(ctx: GameContext, state: GameState): TilePos | null;
  /** Condition to complete the step (manual step when omitted). */
  done?(ctx: GameContext, state: GameState): boolean;
}

function playerBuildings(state: GameState): Building[] {
  return Object.values(state.buildings).filter((b) => b.owner === state.playerCompanyId);
}

function produces(ctx: GameContext, b: Building, productId: string): boolean {
  const def = ctx.data.buildings[b.typeId];
  if (!def) return false;
  return def.recipes.some((r) => ctx.data.recipes[r]?.outputs.some((o) => o.product === productId));
}

function hasProducer(ctx: GameContext, state: GameState, productId: string): boolean {
  return playerBuildings(state).some((b) => produces(ctx, b, productId));
}

function cityCenter(state: GameState): TilePos | null {
  const c = selectCity(state, 'largest');
  return c ? { x: c.x, y: c.y } : null;
}

function nearPlayerBuilding(ctx: GameContext, state: GameState, productId: string): TilePos | null {
  const b = playerBuildings(state).find((x) => produces(ctx, x, productId));
  if (!b) return cityCenter(state);
  const c = cityCenter(state);
  if (!c) return { x: b.x, y: b.y };
  return { x: Math.round((b.x + c.x) / 2), y: Math.round((b.y + c.y) / 2) };
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    title: 'Witaj w Industry Giant 3!',
    text: 'Zbudujesz swój pierwszy łańcuch produkcyjny: zboże → mąka → chleb → sklep. Doradca będzie podpowiadał kolejne kroki.',
  },
  {
    id: 'camera',
    title: 'Rozejrzyj się',
    text: 'Przesuwaj mapę prawym przyciskiem myszy lub klawiszami WASD, przybliżaj kółkiem. Spacja pauzuje grę, klawisze 1–3 zmieniają tempo.',
    target: (_c, s) => cityCenter(s),
  },
  {
    id: 'farm',
    title: 'Zbuduj farmę zboża',
    text: 'Wybierz z paska budowy „Farma zboża” i postaw ją na żyznej równinie niedaleko miasta (zaznaczone pole to dobre miejsce).',
    highlight: ['farm_grain', 'Farma'],
    target: (_c, s) => gameExt(s).tutorialTarget,
    done: (c, s) => hasProducer(c, s, 'grain'),
  },
  {
    id: 'mill',
    title: 'Postaw młyn',
    text: 'Młyn zamieni zboże w mąkę. Postaw go między farmą a miastem — krótsze trasy to mniejsze koszty.',
    highlight: ['mill', 'Młyn'],
    target: (c, s) => nearPlayerBuilding(c, s, 'grain'),
    done: (c, s) => hasProducer(c, s, 'flour'),
  },
  {
    id: 'bakery',
    title: 'Postaw piekarnię',
    text: 'Piekarnia wypieka chleb z mąki. Najlepiej blisko młyna i miasta.',
    highlight: ['bakery', 'Piekarnia'],
    target: (c, s) => nearPlayerBuilding(c, s, 'flour'),
    done: (c, s) => hasProducer(c, s, 'bread'),
  },
  {
    id: 'shop',
    title: 'Otwórz sklep w mieście',
    text: 'Sklep spożywczy sprzedaje chleb mieszkańcom. Postaw go w mieście lub tuż przy nim.',
    highlight: ['shop_food', 'Sklep'],
    target: (_c, s) => cityCenter(s),
    done: (c, s) => playerBuildings(s).some((b) => c.data.buildings[b.typeId]?.category === 'shop'),
  },
  {
    id: 'route',
    title: 'Połącz budynki',
    text: 'Zbuduj drogi i utwórz trasy: farma → młyn → piekarnia → sklep. Możesz użyć auto-połączenia, które zbuduje drogę, trasę i kupi pojazd.',
    highlight: ['road', 'route', 'autoConnect', 'Droga', 'Trasa'],
    done: (_c, s) => Object.values(s.routes).some((r) => r.owner === s.playerCompanyId),
  },
  {
    id: 'vehicle',
    title: 'Kup pojazd',
    text: 'Trasa potrzebuje pojazdów. Kup wóz konny i przypisz go do trasy. Każde ogniwo łańcucha potrzebuje transportu.',
    highlight: ['vehicles', 'buyVehicle', 'Pojazd'],
    done: (_c, s) => Object.values(s.vehicles).some((v) => v.owner === s.playerCompanyId && v.routeId !== null),
  },
  {
    id: 'sale',
    title: 'Poczekaj na pierwszą sprzedaż',
    text: 'Teraz łańcuch zaczyna oddychać: zboże rośnie, młyn miele, piekarnia piecze, a wozy kursują. Przyspiesz czas (2 lub 3) i obserwuj.',
    done: (_c, s) => (gameExt(s).sold.bread ?? 0) > 0 || Object.values(gameExt(s).sold).some((v) => v > 0),
  },
  {
    id: 'finish',
    title: 'Brawo!',
    text: 'Twój pierwszy łańcuch działa. Realizuj cele scenariusza (🎯) — rozbudowuj produkcję, dodawaj pojazdy i otwieraj kolejne sklepy.',
  },
];

// ---------------------------------------------------------------- setup
/** Place the tutorial marker on a fertile tile near the largest city. */
export function setupTutorial(ctx: GameContext, state: GameState): void {
  state.advisor.tutorialStep = 0;
  const city = selectCity(state, 'largest');
  const ext = gameExt(state);
  ext.tutorialTarget = null;
  if (!city) return;
  const m = state.map;
  const def = ctx.data.buildings['farm_grain'];
  let best: TilePos | null = null;
  let bestScore = -Infinity;
  const r0 = Math.max(3, city.radius + 2);
  for (let dy = -r0 - 10; dy <= r0 + 10; dy++)
    for (let dx = -r0 - 10; dx <= r0 + 10; dx++) {
      const d = Math.hypot(dx, dy);
      if (d < r0 || d > r0 + 10) continue;
      const x = city.x + dx;
      const y = city.y + dy;
      if (x < 1 || y < 1 || x >= m.width - 3 || y >= m.height - 3) continue;
      if (def) {
        try {
          const chk = ctx.services.economy.checkPlacement(state.playerCompanyId, 'farm_grain', x, y, 0);
          if (!chk.ok) continue;
        } catch {
          continue;
        }
      }
      const score = m.fertility[y * m.width + x]! - d * 4;
      if (score > bestScore) {
        bestScore = score;
        best = { x: x + 1, y: y + 1 };
      }
    }
  ext.tutorialTarget = best ?? { x: city.x + r0, y: city.y };
}

// ---------------------------------------------------------------- engine
export function currentStep(state: GameState | null): TutorialStep | null {
  if (!state) return null;
  const i = state.advisor.tutorialStep;
  return i >= 0 && i < TUTORIAL_STEPS.length ? TUTORIAL_STEPS[i]! : null;
}

export function skipTutorial(ctx: GameContext): void {
  const st = ctx.tryState();
  if (!st) return;
  st.advisor.tutorialStep = -1;
  clearHighlights();
  ctx.ui.closePanel('tutorial');
}

/** Move to the next step (manual "Dalej" or when done). */
export function advanceTutorial(ctx: GameContext): void {
  const st = ctx.tryState();
  if (!st || st.advisor.tutorialStep < 0) return;
  st.advisor.tutorialStep++;
  if (st.advisor.tutorialStep >= TUTORIAL_STEPS.length) {
    st.advisor.tutorialStep = -1;
    clearHighlights();
    ctx.ui.closePanel('tutorial');
    return;
  }
  ctx.bus.emit('sfx', { id: 'success' });
  onStepEnter(ctx, st);
}

function onStepEnter(ctx: GameContext, st: GameState): void {
  const step = currentStep(st);
  if (!step) return;
  applyHighlights(step.highlight ?? []);
  const t = step.target?.(ctx, st);
  if (t) ctx.bus.emit('camera:focus', { x: t.x, y: t.y, zoom: 1.5 });
  ctx.bus.emit('advisor:tip', { id: `tutorial:${step.id}`, text: step.text, target: t ? { kind: 'tile', x: t.x, y: t.y } : null });
  ctx.ui.refreshPanel('tutorial');
}

/** Check the current step's condition; advances (possibly several steps). */
export function checkTutorial(ctx: GameContext): void {
  const st = ctx.tryState();
  if (!st) return;
  for (let guard = 0; guard < TUTORIAL_STEPS.length; guard++) {
    const step = currentStep(st);
    if (!step?.done) return;
    let ok = false;
    try {
      ok = step.done(ctx, st);
    } catch {
      ok = false;
    }
    if (!ok) return;
    notify(ctx, { level: 'success', icon: '✅', title: `Samouczek: ${step.title}`, text: 'Krok ukończony.', category: 'advisor', silent: true });
    advanceTutorial(ctx);
  }
}

// ---------------------------------------------------------------- DOM highlight
const HL = 'ig-tut-highlight';
let hlTargets: string[] = [];
let hlTimer: ReturnType<typeof setInterval> | null = null;

export function clearHighlights(): void {
  hlTargets = [];
  if (hlTimer) clearInterval(hlTimer);
  hlTimer = null;
  if (typeof document === 'undefined') return;
  for (const el of document.querySelectorAll(`.${HL}`)) el.classList.remove(HL);
}

function applyHighlights(targets: string[]): void {
  clearHighlights();
  hlTargets = targets;
  if (typeof document === 'undefined' || !targets.length) return;
  const paint = (): void => {
    for (const el of document.querySelectorAll(`.${HL}`)) el.classList.remove(HL);
    for (const t of hlTargets) {
      const esc = t.replace(/"/g, '');
      const els = document.querySelectorAll<HTMLElement>(`[data-id="${esc}"], [data-tool="${esc}"], [data-toolbar-id="${esc}"], [data-panel="${esc}"]`);
      if (els.length) {
        for (const el of els) el.classList.add(HL);
        continue;
      }
      for (const el of document.querySelectorAll<HTMLElement>('.ig-toolbar-btn, .ig-btn')) {
        if ((el.textContent ?? '').includes(t)) el.classList.add(HL);
      }
    }
  };
  paint();
  hlTimer = setInterval(paint, 1500); // toolbar may re-render
}

// ---------------------------------------------------------------- map marker layer
export function installTutorialLayer(ctx: GameContext): void {
  ctx.renderer.registerLayer({
    id: 'game.tutorial',
    z: 85,
    space: 'world',
    visible: () => {
      const st = ctx.tryState();
      return !!st && st.advisor.tutorialStep >= 0 && !!currentStep(st)?.target;
    },
    draw: (rc) => {
      const st = ctx.tryState();
      const step = currentStep(st);
      const t = st && step?.target?.(ctx, st);
      if (!t) return;
      const g = rc.g;
      const time = rc.motion ? rc.timeMs / 1000 : 0;
      const pulse = 0.5 + 0.5 * Math.sin(time * 4);
      const cx = (t.x + 0.5) * TILE_SIZE;
      const cy = (t.y + 0.5) * TILE_SIZE;
      g.save();
      g.strokeStyle = `rgba(245, 201, 107, ${0.5 + 0.5 * pulse})`;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(cx, cy, TILE_SIZE * (1.2 + pulse * 0.6), 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = 'rgba(245, 201, 107, 0.18)';
      g.fill();
      g.restore();
    },
  });
}
