/**
 * Input manager: routes canvas pointer/keyboard events to the active tool,
 * handles camera controls and global hotkeys.
 *
 * Camera: right/middle-drag pan (left-drag pans in the inspect tool), wheel
 * zooms toward cursor, WASD/arrows pan, optional edge scroll.
 * Keys: Esc = cancel tool (→ default tool; in default tool closes top window),
 * hotkeys registered via registerHotkey. Keyboard is ignored while typing in inputs.
 */
import type { GameContext, InputApi } from '../core/context';
import type { Renderer } from '../render/renderer';
import type { HotkeyDef, ToolDef, ToolPointerEvent } from './types';

export const DEFAULT_TOOL = 'inspect';
const DRAG_THRESHOLD = 5; // px
const PAN_KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

export class InputManager implements InputApi {
  private tools = new Map<string, ToolDef>();
  private hotkeys: HotkeyDef[] = [];
  private keys = new Set<string>();
  private _active = DEFAULT_TOOL;
  private _hover: { x: number; y: number } | null = null;
  private down: { button: number; sx: number; sy: number; tx: number; ty: number; moved: boolean } | null = null;
  private lastPointer = { sx: -1, sy: -1, inside: false };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ctx: GameContext,
    private readonly renderer: Renderer,
  ) {
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('pointerleave', () => {
      this.lastPointer.inside = false;
      this.setHover(null);
    });
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    renderer.onFrame((dt) => this.onFrame(dt));
    ctx.bus.on('game:ended', () => this.setTool(null));
  }

  // ------------------------------------------------------------ InputApi
  get activeToolId(): string {
    return this._active;
  }
  get hover(): { x: number; y: number } | null {
    return this._hover;
  }
  get activeTool(): ToolDef | undefined {
    return this.tools.get(this._active);
  }
  registerTool(def: ToolDef): void {
    this.tools.set(def.id, def);
  }
  setTool(id: string | null, args?: unknown): void {
    const next = id ?? DEFAULT_TOOL;
    if (!this.tools.has(next)) {
      console.warn(`[input] unknown tool "${next}"`);
      return;
    }
    const prev = this._active;
    this.tools.get(prev)?.deactivate?.(this.ctx);
    this._active = next;
    const tool = this.tools.get(next)!;
    this.canvas.style.cursor = tool.cursor ?? 'default';
    tool.activate?.(this.ctx, args);
    this.ctx.bus.emit('tool:changed', { toolId: next, previous: prev });
  }
  registerHotkey(def: HotkeyDef): void {
    this.hotkeys = this.hotkeys.filter((h) => h.key.toLowerCase() !== def.key.toLowerCase());
    this.hotkeys.push(def);
  }
  hotkeyList(): readonly HotkeyDef[] {
    return this.hotkeys;
  }
  isKeyDown(code: string): boolean {
    return this.keys.has(code);
  }
  /** Last pointer position over the canvas (CSS px) — for UI cards following the cursor. */
  get pointer(): { sx: number; sy: number; inside: boolean } {
    return this.lastPointer;
  }
  /** Registered tools (read-only). */
  toolList(): readonly ToolDef[] {
    return [...this.tools.values()];
  }

  /** Esc / right-click cancel semantics. `fromEscape` = keyboard Esc (may close windows / open the game menu). */
  cancel(fromEscape = false): void {
    const tool = this.activeTool;
    const handled = tool?.cancel?.(this.ctx);
    if (handled) return;
    if (this._active !== DEFAULT_TOOL) this.setTool(null);
    else if (!fromEscape) this.ctx.bus.emit('select', { kind: 'none' });
    else if (!this.ctx.ui.closeTopWindow()) {
      // nothing to close → deselect, then open the pause/game menu
      this.ctx.bus.emit('select', { kind: 'none' });
      this.ctx.ui.openPanel('gameMenu');
    }
  }

  // ------------------------------------------------------------ pointer
  private makeEvent(e: PointerEvent | MouseEvent): ToolPointerEvent {
    const r = this.canvas.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const t = this.renderer.camera.screenToTile(sx, sy);
    const tx = Math.floor(t.x);
    const ty = Math.floor(t.y);
    const st = this.ctx.tryState();
    const inMap = !!st && tx >= 0 && ty >= 0 && tx < st.map.width && ty < st.map.height;
    return {
      tx,
      ty,
      fx: t.x,
      fy: t.y,
      sx,
      sy,
      button: e.button,
      shift: e.shiftKey,
      ctrl: e.ctrlKey || e.metaKey,
      alt: e.altKey,
      inMap,
      dragStart: this.down && this.down.button === 0 && this.down.moved ? { tx: this.down.tx, ty: this.down.ty } : null,
    };
  }

  private onPointerDown(e: PointerEvent): void {
    if (!this.ctx.hasGame) return;
    this.canvas.setPointerCapture(e.pointerId);
    const ev = this.makeEvent(e);
    this.down = { button: e.button, sx: ev.sx, sy: ev.sy, tx: ev.tx, ty: ev.ty, moved: false };
    if (e.button === 0) this.activeTool?.pointerDown?.(ev, this.ctx);
  }

  private onPointerMove(e: PointerEvent): void {
    const ev = this.makeEvent(e);
    const prev = this.lastPointer;
    this.lastPointer = { sx: ev.sx, sy: ev.sy, inside: true };
    if (!this.ctx.hasGame) return;
    if (this.down && !this.down.moved && Math.hypot(ev.sx - this.down.sx, ev.sy - this.down.sy) > DRAG_THRESHOLD) {
      this.down.moved = true;
      ev.dragStart = this.down.button === 0 ? { tx: this.down.tx, ty: this.down.ty } : null;
    }
    // right / middle drag pans the camera
    if (this.down && this.down.button !== 0 && this.down.moved && prev.sx >= 0) {
      this.renderer.camera.panBy(prev.sx - ev.sx, prev.sy - ev.sy);
    }
    this.setHover(ev.inMap ? { x: ev.tx, y: ev.ty } : null);
    this.activeTool?.pointerMove?.(ev, this.ctx);
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    const d = this.down;
    if (!d || !this.ctx.hasGame) {
      this.down = null;
      return;
    }
    const ev = this.makeEvent(e);
    if (d.button === 0) {
      this.activeTool?.pointerUp?.(ev, this.ctx);
      if (!d.moved) this.activeTool?.click?.(ev, this.ctx);
    } else if (d.button === 2 && !d.moved) {
      this.cancel();
    }
    this.down = null;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    if (!this.ctx.hasGame) return;
    const r = this.canvas.getBoundingClientRect();
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
    this.renderer.camera.zoomAt(factor, e.clientX - r.left, e.clientY - r.top);
  }

  private setHover(h: { x: number; y: number } | null): void {
    const cur = this._hover;
    if (cur === h || (cur && h && cur.x === h.x && cur.y === h.y)) return;
    this._hover = h;
    this.ctx.bus.emit('hover', h);
  }

  // ------------------------------------------------------------ keyboard
  private onKeyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
    this.keys.add(e.code);
    if (e.key === 'Escape' && this.ctx.hasGame) {
      this.cancel(true);
      e.preventDefault();
      return;
    }
    if (this.ctx.hasGame && this.activeTool?.keyDown?.(e, this.ctx)) {
      e.preventDefault();
      return;
    }
    const spec = keySpec(e);
    for (const h of this.hotkeys) {
      if (h.key.toLowerCase() !== spec) continue;
      if ((h.inGame ?? true) && !this.ctx.hasGame) continue;
      e.preventDefault();
      h.handler(e, this.ctx);
      return;
    }
  }

  private onFrame(dtMs: number): void {
    if (!this.ctx.hasGame) return;
    const cam = this.renderer.camera;
    const speed = 700 * this.ctx.userSettings.scrollSpeed * (dtMs / 1000);
    let dx = 0;
    let dy = 0;
    const mod = this.keys.has('ControlLeft') || this.keys.has('MetaLeft') || this.keys.has('ControlRight') || this.keys.has('MetaRight');
    if (!mod) {
      for (const [code, [kx, ky]] of Object.entries(PAN_KEYS)) {
        if (this.keys.has(code)) {
          dx += kx;
          dy += ky;
        }
      }
    }
    if (this.ctx.userSettings.edgeScroll && this.lastPointer.inside) {
      const m = 12;
      if (this.lastPointer.sx < m) dx -= 1;
      if (this.lastPointer.sx > cam.viewW - m) dx += 1;
      if (this.lastPointer.sy < m) dy -= 1;
      if (this.lastPointer.sy > cam.viewH - m) dy += 1;
    }
    if (dx || dy) {
      const shift = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 2.5 : 1;
      cam.panBy(dx * speed * shift, dy * speed * shift);
    }
  }
}

/** Normalize a KeyboardEvent to 'ctrl+shift+alt+key' (lowercase). */
export function keySpec(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  if (e.shiftKey) parts.push('shift');
  if (e.altKey) parts.push('alt');
  parts.push(e.key === ' ' ? 'space' : e.key.toLowerCase());
  return parts.join('+');
}
