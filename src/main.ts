/**
 * Bootstrap: create context + browser services, init all modules, show main menu.
 * Owned by core/foundation. Modules must NOT be initialized anywhere else.
 */
import './styles.css';
import { init as initAi } from './ai';
import { init as initAudio } from './audio';
import { createContext } from './core/context';
import { installCore, startNewGame } from './core/lifecycle';
import { loadUserSettings } from './core/settings';
import { init as initEconomy } from './economy';
import { init as initGame } from './game';
import { init as initInput } from './input';
import { InputManager } from './input/input';
import { init as initLogistics } from './logistics';
import { init as initRender } from './render';
import { Renderer } from './render/renderer';
import { init as initUi } from './ui';
import { UiManager } from './ui/ui';
import { init as initWorld } from './world';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui-root') as HTMLElement;

const ctx = createContext({ userSettings: loadUserSettings() });
installCore(ctx);

const renderer = new Renderer(canvas, ctx);
ctx.renderer = renderer;
ctx.input = new InputManager(canvas, ctx, renderer);
ctx.ui = new UiManager(uiRoot, ctx);

// Module init order: simulation modules first (they register systems/services/steps),
// then presentation (render layers, input tools, UI panels), audio last.
const modules: [string, (c: typeof ctx) => void][] = [
  ['world', initWorld],
  ['economy', initEconomy],
  ['logistics', initLogistics],
  ['ai', initAi],
  ['game', initGame],
  ['render', initRender],
  ['input', initInput],
  ['ui', initUi],
  ['audio', initAudio],
];
for (const [name, init] of modules) {
  try {
    init(ctx);
  } catch (err) {
    console.error(`[main] init of module "${name}" failed`, err);
  }
}

renderer.start();

// Dev helpers: window.ig3 = ctx; ?autostart[&seed=123&size=64] starts a game immediately.
if (import.meta.env.DEV) (window as unknown as { ig3: typeof ctx }).ig3 = ctx;
const params = new URLSearchParams(location.search);
if (params.has('autostart')) {
  const seed = Number(params.get('seed'));
  const size = Number(params.get('size'));
  startNewGame(ctx, {
    ...(Number.isFinite(seed) && seed > 0 ? { seed } : {}),
    ...(size > 0 ? { mapWidth: size, mapHeight: size } : {}),
  });
}
