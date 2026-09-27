/**
 * GameContext — the single object handed to every module's `init(ctx)` and to
 * every system. It wires together the bus, data, sim, services and the
 * (optional, browser-only) renderer / UI / input.
 *
 * In tests use createContext({ headless: true }) — renderer/ui/input are no-op
 * stubs, everything else is real.
 */
import type { HotkeyDef, ToolDef } from '../input/types';
import type { Camera } from '../render/camera';
import type { LayerDef } from '../render/types';
import type { HudItemDef, OverlayDef, PanelDef, ToastOptions, ToolbarButtonDef } from '../ui/types';
import { registry as globalRegistry, type DataRegistry } from '../data/registry';
import { createBus, type GameBus } from './bus';
import { createDefaultServices, type Services } from './services';
import { DEFAULT_USER_SETTINGS } from './settings';
import { Sim } from './sim';
import { NewGameRegistry } from './state';
import type { GameState, TileRect, UserSettings } from './types';

// ---------------------------------------------------------------- browser-side APIs

export interface RendererApi {
  readonly camera: Camera;
  /** Current overlay/heatmap id (null = none). */
  readonly overlay: string | null;
  readonly fps: number;
  /** Add or replace (same id) a layer. */
  registerLayer(def: LayerDef): void;
  unregisterLayer(id: string): void;
  setLayerVisible(id: string, visible: boolean): void;
  /** Mark tiles dirty for cached layers (null = everything). */
  invalidate(rect?: TileRect | null): void;
  /** Center camera on a tile (optionally zoom). */
  centerOn(x: number, y: number, zoom?: number): void;
  setOverlay(id: string | null): void;
  /** Callback every animation frame (before drawing). Returns unsubscribe. */
  onFrame(fn: (dtMs: number) => void): () => void;
}

export interface UiApi {
  /** DOM root for UI (#ui-root). null when headless. */
  readonly root: HTMLElement | null;
  registerPanel(def: PanelDef): void;
  /** Open (or focus) a panel. args are passed to create(); multi-instance panels use def.key(args). */
  openPanel(id: string, args?: unknown): void;
  closePanel(idOrKey: string): void;
  /** Close the top-most window (Esc). Returns false if none open. */
  closeTopWindow(): boolean;
  togglePanel(id: string, args?: unknown): void;
  isPanelOpen(idOrKey: string): boolean;
  /** Force onUpdate of open instances of a panel. */
  refreshPanel(id: string): void;
  registerToolbarButton(def: ToolbarButtonDef): void;
  registerHudItem(def: HudItemDef): void;
  toast(opts: ToastOptions): void;
  /** Describe a map overlay (name, icon, legend) for the overlay bar/minimap. Same id = replace. */
  registerOverlay(def: OverlayDef): void;
}

export interface InputApi {
  registerTool(def: ToolDef): void;
  /** Activate tool by id (null → default 'inspect'). args go to tool.activate(). */
  setTool(id: string | null, args?: unknown): void;
  readonly activeToolId: string;
  /** Hovered tile (null = outside map / no game). */
  readonly hover: { x: number; y: number } | null;
  registerHotkey(def: HotkeyDef): void;
  /** Is a key (KeyboardEvent.code, e.g. 'ShiftLeft', 'KeyW') currently held. */
  isKeyDown(code: string): boolean;
}

// ---------------------------------------------------------------- context

export interface GameContext {
  readonly bus: GameBus;
  readonly data: DataRegistry;
  readonly sim: Sim;
  /** Cross-module services (economy/logistics/world/game/audio). */
  readonly services: Services;
  /** New-game pipeline (mapgen, cities, companies, scenario…). */
  readonly newGame: NewGameRegistry;
  renderer: RendererApi;
  ui: UiApi;
  input: InputApi;
  /** User preferences (not part of the save). Persist with saveUserSettings(). */
  userSettings: UserSettings;
  /** true in tests / without DOM. */
  readonly headless: boolean;
  /** Current game state. THROWS if no game is running — check hasGame first in UI code. */
  readonly state: GameState;
  readonly hasGame: boolean;
  tryState(): GameState | null;
  /** Install a state (used by core/lifecycle.ts). Do not call from modules. */
  setState(s: GameState | null): void;
}

export interface CreateContextOptions {
  headless?: boolean;
  data?: DataRegistry;
  userSettings?: UserSettings;
}

export function createContext(opts: CreateContextOptions = {}): GameContext {
  let current: GameState | null = null;
  const ctx = {
    bus: createBus(),
    data: opts.data ?? globalRegistry,
    headless: opts.headless ?? false,
    userSettings: opts.userSettings ?? { ...DEFAULT_USER_SETTINGS },
    renderer: headlessRenderer(),
    ui: headlessUi(),
    input: headlessInput(),
    get state(): GameState {
      if (!current) throw new Error('Brak aktywnej gry (ctx.state)');
      return current;
    },
    get hasGame(): boolean {
      return current !== null;
    },
    tryState: () => current,
    setState: (s: GameState | null) => {
      current = s;
    },
  } as Omit<GameContext, 'sim' | 'services' | 'newGame'> as GameContext;
  (ctx as { sim: Sim }).sim = new Sim(ctx);
  (ctx as { services: Services }).services = createDefaultServices(ctx);
  (ctx as { newGame: NewGameRegistry }).newGame = new NewGameRegistry();
  return ctx;
}

// ---------------------------------------------------------------- headless stubs

function headlessRenderer(): RendererApi {
  const camera = { x: 0, y: 0, zoom: 1 } as unknown as Camera;
  return {
    camera,
    overlay: null,
    fps: 0,
    registerLayer: () => {},
    unregisterLayer: () => {},
    setLayerVisible: () => {},
    invalidate: () => {},
    centerOn: () => {},
    setOverlay: () => {},
    onFrame: () => () => {},
  };
}

function headlessUi(): UiApi {
  return {
    root: null,
    registerPanel: () => {},
    openPanel: () => {},
    closePanel: () => {},
    closeTopWindow: () => false,
    togglePanel: () => {},
    isPanelOpen: () => false,
    refreshPanel: () => {},
    registerToolbarButton: () => {},
    registerHudItem: () => {},
    toast: () => {},
    registerOverlay: () => {},
  };
}

function headlessInput(): InputApi {
  return {
    registerTool: () => {},
    setTool: () => {},
    activeToolId: 'inspect',
    hover: null,
    registerHotkey: () => {},
    isKeyDown: () => false,
  };
}
