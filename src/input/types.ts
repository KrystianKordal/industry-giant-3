/**
 * Input/tool contracts. Owned by the UI agent (input/). Any module may register
 * tools (e.g. logistics registers road/rail/route tools) via ctx.input.registerTool.
 */
import type { GameContext } from '../core/context';
import type { RenderContext } from '../render/types';

export interface ToolPointerEvent {
  /** Integer tile under cursor (may be outside the map — check inMap). */
  tx: number;
  ty: number;
  /** Fractional tile coords. */
  fx: number;
  fy: number;
  /** Screen coords (CSS px relative to canvas). */
  sx: number;
  sy: number;
  /** 0 left, 1 middle, 2 right. */
  button: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  inMap: boolean;
  /** Tile where the current (left-button) drag started; null when not dragging. */
  dragStart: { tx: number; ty: number } | null;
}

export interface ToolDef {
  id: string;
  name: string;
  icon?: string;
  /** CSS cursor while active. */
  cursor?: string;
  activate?(ctx: GameContext, args?: unknown): void;
  deactivate?(ctx: GameContext): void;
  pointerDown?(e: ToolPointerEvent, ctx: GameContext): void;
  pointerMove?(e: ToolPointerEvent, ctx: GameContext): void;
  pointerUp?(e: ToolPointerEvent, ctx: GameContext): void;
  /** Left click without drag (fired after pointerUp). */
  click?(e: ToolPointerEvent, ctx: GameContext): void;
  /** Return true if the key was consumed. */
  keyDown?(e: KeyboardEvent, ctx: GameContext): boolean;
  /**
   * Esc / right-click cancel. Return true if the tool handled it and stays active
   * (e.g. cancelled a drag); false/undefined → switch back to the default tool.
   */
  cancel?(ctx: GameContext): boolean | void;
  /** Draw preview in world space (called by the 'tool-preview' layer, z=90). */
  drawPreview?(rc: RenderContext): void;
  /** Short status/help text shown by the UI while active (bottom hint bar). */
  hint?(ctx: GameContext): string;
  /**
   * Rich info card shown next to the cursor while the tool is active (polled ~8×/s).
   * Return null to hide. Used by build/blueprint tools; logistics tools may use it for road cost etc.
   */
  status?(ctx: GameContext): ToolStatus | null;
}

export interface ToolStatusLine {
  label: string;
  value: string;
  /** Colour hint for the value. */
  tone?: 'pos' | 'neg' | 'warn' | 'dim';
}

export interface ToolStatus {
  icon?: string;
  title: string;
  /** true = green header (placement OK), false = red, undefined = neutral. */
  ok?: boolean;
  /** Main message (e.g. invalid placement reason). */
  message?: string;
  lines?: ToolStatusLine[];
  /** Small footer (key hints). */
  footer?: string;
}

export interface HotkeyDef {
  /** Key spec: 'b', 'Escape', 'F1', 'ctrl+s', 'shift+r' (e.key, case-insensitive). */
  key: string;
  description: string;
  /** Only when a game runs (default true). */
  inGame?: boolean;
  handler(e: KeyboardEvent, ctx: GameContext): void;
}
