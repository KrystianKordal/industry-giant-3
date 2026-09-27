/**
 * UI contracts (panels, toolbar, HUD, toasts). Owned by the UI agent; any module
 * may register panels/buttons through ctx.ui.
 */
import type { GameContext } from '../core/context';
import type { EntityRef, GameState, NotificationLevel } from '../core/types';

export interface WindowHandle {
  /** Root element of the window. */
  el: HTMLElement;
  /** Content container. */
  body: HTMLElement;
  setTitle(title: string): void;
  bringToFront(): void;
  close(): void;
  readonly closed: boolean;
}

export interface PanelInstance {
  /** Instance key (= panel id, or panel.key(args) for multi-instance panels). */
  key: string;
  panelId: string;
  /** Arguments passed to openPanel (e.g. { buildingId }). */
  args: unknown;
  body: HTMLElement;
  window: WindowHandle;
  /** Set in create(); called periodically (refreshMs) and on refreshPanel(). */
  onUpdate: (() => void) | null;
  /** Set in create(); called when the window closes (unsubscribe here). */
  onClose: (() => void) | null;
  setTitle(title: string): void;
  close(): void;
}

export interface PanelDef {
  id: string;
  title: string | ((args: unknown) => string);
  icon?: string;
  width?: number;
  height?: number;
  /** Initial placement (default: 'center'). */
  position?: 'center' | 'left' | 'right' | { x: number; y: number };
  /**
   * For multi-instance panels (e.g. one inspector per building) return a unique
   * key per args. Omit for singleton panels.
   */
  key?: (args: unknown) => string;
  /** Auto-refresh interval in ms while open (default 500; 0 = manual only). */
  refreshMs?: number;
  /** Build the content into p.body; set p.onUpdate / p.onClose as needed. */
  create(p: PanelInstance, ctx: GameContext): void;
}

/** Known toolbar groups (bottom bar). Free-form strings are allowed too. */
export type ToolbarGroup =
  | 'raw'
  | 'factory'
  | 'shop'
  | 'logistics'
  | 'transport'
  | 'special'
  | 'manage'
  | 'view'
  | (string & {});

export interface ToolbarButtonDef {
  id: string;
  icon: string;
  label: string;
  group: ToolbarGroup;
  /** Sort order within group (default 100). */
  order?: number;
  tooltip?: string;
  /** Hotkey hint shown in tooltip (registration of the key is separate: ctx.input.registerHotkey). */
  hotkey?: string;
  onClick(ctx: GameContext, ev: MouseEvent): void;
  /** Highlighted state (e.g. tool active / panel open). Polled on refresh. */
  isActive?(ctx: GameContext): boolean;
}

export interface HudItemDef {
  id: string;
  side: 'left' | 'center' | 'right';
  order?: number;
  create(el: HTMLElement, ctx: GameContext): void;
  /** Called ~4×/s while a game runs. */
  update?(el: HTMLElement, ctx: GameContext): void;
}

export interface ToastOptions {
  level?: NotificationLevel;
  title: string;
  text?: string;
  icon?: string;
  durationMs?: number;
  target?: EntityRef | null;
  onClick?: () => void;
}

export interface OverlayLegendItem {
  color: string;
  label: string;
}

/**
 * Map overlay description (heatmap). The render module draws it (layer checks
 * ctx.renderer.overlay === id); the UI shows a toggle button, a legend and
 * optionally tints the minimap. Register with ctx.ui.registerOverlay(def).
 */
export interface OverlayDef {
  id: string;
  name: string;
  icon: string;
  description?: string;
  /** Sort order in the overlay bar (default 100). */
  order?: number;
  /** Hotkey hint shown in the tooltip (registration is separate). */
  hotkey?: string;
  /** Discrete legend entries… */
  legend?: OverlayLegendItem[];
  /** …or a continuous gradient (CSS colors, low → high). */
  gradient?: { stops: string[]; min: string; max: string };
  /**
   * Optional per-tile minimap tint: return [r,g,b,a] (0..255) or null for none.
   * Called for every tile about once per second while the overlay is active — keep it cheap.
   */
  minimapColor?(state: GameState, idx: number, ctx: GameContext): [number, number, number, number] | null;
}
