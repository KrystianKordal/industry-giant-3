/**
 * UI framework core: floating windows (draggable, closable, stacking),
 * panel registry, toolbar/HUD registries, toasts.
 *
 *   ctx.ui.registerPanel({ id: 'finance', title: 'Finanse', create(p, ctx) { p.body.append(…); p.onUpdate = () => …; } });
 *   ctx.ui.openPanel('finance');
 *   ctx.ui.registerToolbarButton({ id: 'build-farm', icon: '🌾', label: 'Farma', group: 'raw', onClick: (ctx) => … });
 *
 * Components (buttons, tabs, tables, progress bars) → ui/components.ts,
 * charts → ui/charts.ts, tooltips → ui/tooltip.ts, DOM helper → ui/dom.ts.
 */
import type { GameContext, UiApi } from '../core/context';
import type { EntityRef } from '../core/types';
import { h } from './dom';
import type { HudItemDef, OverlayDef, PanelDef, PanelInstance, ToastOptions, ToolbarButtonDef, WindowHandle } from './types';

// ============================================================================
// Windows
// ============================================================================

export interface WindowOptions {
  title: string;
  icon?: string;
  width?: number;
  height?: number;
  position?: PanelDef['position'];
  closable?: boolean;
  className?: string;
  onClose?: () => void;
}

let zTop = 100;

/** Current UI zoom (userSettings.uiScale applied as CSS zoom on #ui-root). */
export function uiScale(): number {
  const root = document.getElementById('ui-root');
  const z = root ? Number(root.style.zoom || 1) : 1;
  return Number.isFinite(z) && z > 0 ? z : 1;
}
const openWindows = new Set<WindowHandle>();
let cascade = 0;

/** Create a floating window inside `layer`. */
export function createWindow(layer: HTMLElement, opts: WindowOptions): WindowHandle {
  const titleEl = h('span', { class: 'ig-window-title' }, opts.title);
  const body = h('div', { class: 'ig-window-body' });
  const header = h('div', { class: 'ig-window-header' }, opts.icon ? h('span', { class: 'ig-window-icon' }, opts.icon) : null, titleEl);
  const el = h('div', { class: `ig-window ${opts.className ?? ''}` }, header, body);
  if (opts.width) el.style.width = `${opts.width}px`;
  if (opts.height) el.style.height = `${opts.height}px`;

  let closed = false;
  const handle: WindowHandle = {
    el,
    body,
    setTitle: (t) => {
      titleEl.textContent = t;
    },
    bringToFront: () => {
      el.style.zIndex = String(++zTop);
      openWindows.delete(handle);
      openWindows.add(handle); // keep insertion order = stacking order
    },
    close: () => {
      if (closed) return;
      closed = true;
      openWindows.delete(handle);
      el.remove();
      opts.onClose?.();
    },
    get closed() {
      return closed;
    },
  };

  if (opts.closable !== false) {
    header.append(h('button', { class: 'ig-window-close', title: 'Zamknij (Esc)', onclick: () => handle.close() }, '✕'));
  }

  // dragging
  header.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    handle.bringToFront();
    const r = el.getBoundingClientRect();
    const ox = e.clientX - r.left;
    const oy = e.clientY - r.top;
    header.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent): void => {
      const lr = layer.getBoundingClientRect();
      const sc = uiScale();
      const lw = lr.width / sc;
      const lh = lr.height / sc;
      const x = Math.min(lw - 60, Math.max(-r.width / sc + 80, (ev.clientX - lr.left - ox) / sc));
      const y = Math.min(lh - 30, Math.max(0, (ev.clientY - lr.top - oy) / sc));
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    };
    const up = (): void => {
      header.removeEventListener('pointermove', move);
      header.removeEventListener('pointerup', up);
    };
    header.addEventListener('pointermove', move);
    header.addEventListener('pointerup', up);
  });
  el.addEventListener('pointerdown', () => handle.bringToFront(), { capture: true });

  layer.append(el);
  placeWindow(layer, el, opts.position ?? 'center');
  handle.bringToFront();
  return handle;
}

function placeWindow(layer: HTMLElement, el: HTMLElement, pos: NonNullable<PanelDef['position']>): void {
  const lw = layer.clientWidth || window.innerWidth;
  const lh = layer.clientHeight || window.innerHeight;
  const w = el.offsetWidth || 360;
  const hgt = el.offsetHeight || 240;
  const off = (cascade++ % 6) * 24;
  let x: number;
  let y: number;
  if (typeof pos === 'object') ({ x, y } = pos);
  else if (pos === 'left') (x = 12 + off), (y = 56 + off);
  else if (pos === 'right') (x = lw - w - 12 - off), (y = 56 + off);
  else (x = (lw - w) / 2 + off), (y = Math.max(56, (lh - hgt) / 2 - 40) + off);
  x = Math.min(x, lw - Math.min(w, lw) - 4);
  y = Math.min(y, Math.max(48, lh - hgt - 90));
  el.style.left = `${Math.max(0, x)}px`;
  el.style.top = `${Math.max(48, y)}px`;
}

/** Move a window up/left so it fits in the layer (after its content grew). */
export function fitWindow(layer: HTMLElement, el: HTMLElement): void {
  const lw = layer.clientWidth || window.innerWidth;
  const lh = layer.clientHeight || window.innerHeight;
  const top = el.offsetTop;
  const left = el.offsetLeft;
  const maxBottom = lh - 84; // keep clear of the bottom toolbar
  if (top + el.offsetHeight > maxBottom) el.style.top = `${Math.max(48, maxBottom - el.offsetHeight)}px`;
  if (left + el.offsetWidth > lw - 6) el.style.left = `${Math.max(0, lw - 6 - el.offsetWidth)}px`;
}

// ============================================================================
// Manager
// ============================================================================

export class UiManager implements UiApi {
  readonly root: HTMLElement;
  /** Layer for windows. */
  readonly windowLayer: HTMLElement;
  /** Layer for full-screen overlays (menus). */
  readonly overlayLayer: HTMLElement;
  private toastLayer: HTMLElement;
  private panels = new Map<string, PanelDef>();
  private instances = new Map<string, PanelInstance & { lastUpdate: number }>();
  readonly toolbarButtons: ToolbarButtonDef[] = [];
  readonly hudItems: HudItemDef[] = [];
  readonly overlays: OverlayDef[] = [];
  /** Called when toolbar/HUD registries change (hud.ts re-renders). */
  onRegistryChange: (() => void) | null = null;
  /** Extra listeners notified (batched) after registry changes — overlay bar, build menu… */
  readonly registryListeners = new Set<() => void>();

  constructor(
    root: HTMLElement,
    private readonly ctx: GameContext,
  ) {
    this.root = root;
    this.windowLayer = h('div', { class: 'ig-layer ig-window-layer' });
    this.toastLayer = h('div', { class: 'ig-toasts' });
    this.overlayLayer = h('div', { class: 'ig-layer ig-overlay-layer' });
    root.append(this.windowLayer, this.toastLayer, this.overlayLayer);

    setInterval(() => this.tickPanels(), 250);
    this.applyScale();
    ctx.bus.on('settings:changed', () => this.applyScale());
    ctx.bus.on('notify', (n) => this.toast({ level: n.level, title: n.title, text: n.text, icon: n.icon, target: n.target }));
    ctx.bus.on('game:ended', () => this.closeAll());
  }

  // ------------------------------------------------------------ panels
  registerPanel(def: PanelDef): void {
    this.panels.set(def.id, def);
  }

  openPanel(id: string, args?: unknown): void {
    const def = this.panels.get(id);
    if (!def) {
      console.warn(`[ui] unknown panel "${id}"`);
      return;
    }
    const key = def.key ? def.key(args) : id;
    const existing = this.instances.get(key);
    let position = def.position;
    if (existing) {
      if (existing.args === args || def.key) {
        existing.window.bringToFront();
        return;
      }
      // singleton reopened with new args → rebuild in place
      position = { x: existing.window.el.offsetLeft, y: existing.window.el.offsetTop };
      existing.close();
    }
    const title = typeof def.title === 'function' ? def.title(args) : def.title;
    const inst = {} as PanelInstance & { lastUpdate: number };
    const win = createWindow(this.windowLayer, {
      title,
      icon: def.icon,
      width: def.width,
      height: def.height,
      position,
      onClose: () => {
        this.instances.delete(key);
        try {
          inst.onClose?.();
        } catch (err) {
          console.error(err);
        }
        this.ctx.bus.emit('panel:closed', { id: key });
      },
    });
    Object.assign(inst, {
      key,
      panelId: id,
      args,
      body: win.body,
      window: win,
      onUpdate: null,
      onClose: null,
      lastUpdate: performance.now(),
      setTitle: (t: string) => win.setTitle(t),
      close: () => win.close(),
    });
    this.instances.set(key, inst);
    try {
      def.create(inst, this.ctx);
      inst.onUpdate?.();
    } catch (err) {
      console.error(`[ui] panel "${id}" create failed`, err);
      win.body.append(h('div', { class: 'ig-error' }, `Błąd panelu: ${String(err)}`));
    }
    // content is built after placement → keep the grown window inside the viewport
    const fit = (): void => fitWindow(this.windowLayer, win.el);
    fit();
    requestAnimationFrame(fit);
    this.ctx.bus.emit('panel:opened', { id: key });
    this.ctx.bus.emit('sfx', { id: 'open' });
  }

  closePanel(idOrKey: string): void {
    this.instances.get(idOrKey)?.close();
    for (const inst of [...this.instances.values()]) if (inst.panelId === idOrKey) inst.close();
  }

  togglePanel(id: string, args?: unknown): void {
    if (this.isPanelOpen(id)) this.closePanel(id);
    else this.openPanel(id, args);
  }

  isPanelOpen(idOrKey: string): boolean {
    if (this.instances.has(idOrKey)) return true;
    for (const i of this.instances.values()) if (i.panelId === idOrKey) return true;
    return false;
  }

  refreshPanel(id: string): void {
    for (const i of this.instances.values()) if (i.panelId === id || i.key === id) i.onUpdate?.();
  }

  closeTopWindow(): boolean {
    const list = [...openWindows];
    const top = list[list.length - 1];
    if (!top) return false;
    top.close();
    this.ctx.bus.emit('sfx', { id: 'close' });
    return true;
  }

  closeAll(): void {
    for (const w of [...openWindows]) w.close();
  }

  /**
   * Keep toasts from covering open windows: dodge windows docked on the right
   * (inspector) by moving the stack left of them; next to a centred window the
   * stack gets narrower so it covers as little of the window as possible.
   */
  private layoutToasts(): void {
    const layer = this.toastLayer;
    if (!layer.children.length) return;
    const sc = uiScale();
    const vw = window.innerWidth / sc;
    const FULL = window.innerWidth <= 820 ? 260 : 320;
    const MIN = 220;
    const rects = [...openWindows].map((w) => {
      const e = w.el;
      return { l: e.offsetLeft, r: e.offsetLeft + e.offsetWidth, t: e.offsetTop, b: e.offsetTop + e.offsetHeight };
    });
    const top = layer.offsetTop;
    const bottom = top + layer.offsetHeight;
    const hits = (right: number, w: number): { l: number; r: number }[] =>
      rects.filter((r) => r.r > vw - right - w && r.l < vw - right && r.b > top && r.t < bottom);
    // 1) dodge windows docked on the right (inspector) by moving the stack left of them
    let right = 12;
    for (let k = 0; k < 3; k++) {
      const hit = hits(right, FULL).filter((r) => r.r > vw - 40 && r.l > vw * 0.4);
      if (!hit.length) break;
      right = vw - Math.min(...hit.map((r) => r.l)) + 10;
    }
    if (vw - right - FULL < 8) right = 12;
    // 2) a centred window reaching into the column: narrow the toasts to fit beside it
    let width = FULL;
    const over = hits(right, FULL);
    if (over.length) {
      const avail = vw - right - Math.max(...over.map((r) => r.r)) - 12;
      width = Math.max(MIN, Math.min(FULL, avail));
    }
    const px = `${Math.round(right)}px`;
    if (layer.style.right !== px) layer.style.right = px;
    const wpx = `${Math.round(width)}px`;
    if (layer.style.width !== wpx) layer.style.width = wpx;
  }

  private tickPanels(): void {
    this.layoutToasts();
    if (!this.ctx.hasGame) return;
    const now = performance.now();
    for (const inst of this.instances.values()) {
      const def = this.panels.get(inst.panelId);
      const every = def?.refreshMs ?? 500;
      if (every <= 0 || now - inst.lastUpdate < every) continue;
      inst.lastUpdate = now;
      try {
        inst.onUpdate?.();
      } catch (err) {
        console.error(`[ui] panel "${inst.panelId}" update failed`, err);
      }
    }
  }

  // ------------------------------------------------------------ registries
  registerToolbarButton(def: ToolbarButtonDef): void {
    const i = this.toolbarButtons.findIndex((b) => b.id === def.id);
    if (i >= 0) this.toolbarButtons.splice(i, 1);
    this.toolbarButtons.push(def);
    this.onRegistryChange?.();
  }

  registerHudItem(def: HudItemDef): void {
    const i = this.hudItems.findIndex((b) => b.id === def.id);
    if (i >= 0) this.hudItems.splice(i, 1);
    this.hudItems.push(def);
    this.onRegistryChange?.();
  }

  registerOverlay(def: OverlayDef): void {
    const i = this.overlays.findIndex((o) => o.id === def.id);
    if (i >= 0) this.overlays.splice(i, 1, def);
    else this.overlays.push(def);
    this.overlays.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
    this.onRegistryChange?.();
  }

  overlayDef(id: string | null): OverlayDef | undefined {
    return id ? this.overlays.find((o) => o.id === id) : undefined;
  }

  /** Apply userSettings.uiScale as CSS zoom on the UI root. */
  applyScale(): void {
    const sc = Math.max(0.7, Math.min(1.6, this.ctx.userSettings.uiScale || 1));
    this.root.style.zoom = String(sc);
    document.documentElement.style.setProperty('--ui-scale', String(sc));
  }

  /** Remove visible toasts whose title or text equals `text` (dedupe advisor tips). */
  dismissToastsMatching(text: string): void {
    for (const el of [...this.toastLayer.children]) {
      const t = el.querySelector('.ig-toast-text')?.textContent ?? '';
      const ti = el.querySelector('.ig-toast-title')?.textContent ?? '';
      if (t === text || ti === text) el.remove();
    }
  }

  /** All open panel instances (read-only view). */
  openInstances(): PanelInstance[] {
    return [...this.instances.values()];
  }

  // ------------------------------------------------------------ toasts
  toast(o: ToastOptions): void {
    const level = o.level ?? 'info';
    const el = h(
      'div',
      { class: `ig-toast ig-toast-${level}` },
      h('div', { class: 'ig-toast-icon' }, o.icon ?? ''),
      h(
        'div',
        { class: 'ig-toast-content' },
        h('div', { class: 'ig-toast-title' }, o.title),
        o.text ? h('div', { class: 'ig-toast-text' }, o.text) : null,
        o.target || o.onClick ? h('div', { class: 'ig-toast-goto' }, 'Pokaż →') : null,
      ),
      h('button', { class: 'ig-toast-x', title: 'Zamknij', onclick: (e: MouseEvent) => (e.stopPropagation(), remove()) }, '✕'),
    );
    let hover = false;
    el.addEventListener('mouseenter', () => (hover = true));
    el.addEventListener('mouseleave', () => (hover = false));
    const remove = (): void => {
      el.classList.add('ig-toast-out');
      setTimeout(() => el.remove(), 250);
    };
    const autoRemove = (): void => {
      if (hover) setTimeout(autoRemove, 1500);
      else remove();
    };
    el.addEventListener('click', () => {
      if (o.onClick) o.onClick();
      else if (o.target) focusTarget(this.ctx, o.target);
      remove();
    });
    this.toastLayer.append(el);
    while (this.toastLayer.children.length > 5) this.toastLayer.firstElementChild?.remove();
    this.layoutToasts();
    setTimeout(autoRemove, o.durationMs ?? (level === 'danger' ? 8000 : 5000));
  }
}

/** Select an entity and move the camera to it (toasts, notifications, lists). */
export function focusTarget(ctx: GameContext, t: EntityRef, select = true): void {
  const st = ctx.tryState();
  if (!st) return;
  let pos: { x: number; y: number } | null = null;
  if (t.kind === 'tile') pos = { x: t.x, y: t.y };
  else if (t.kind === 'building' && st.buildings[t.id]) {
    const b = st.buildings[t.id]!;
    pos = { x: b.x + (b.w - 1) / 2, y: b.y + (b.h - 1) / 2 };
  } else if (t.kind === 'city' && st.cities[t.id]) pos = { x: st.cities[t.id]!.x, y: st.cities[t.id]!.y };
  else if (t.kind === 'vehicle' && st.vehicles[t.id]) pos = { x: Math.floor(st.vehicles[t.id]!.x), y: Math.floor(st.vehicles[t.id]!.y) };
  else if (t.kind === 'route' && st.routes[t.id]) {
    const first = st.routes[t.id]!.stops[0];
    const b = first ? st.buildings[first.buildingId] : undefined;
    if (b) pos = { x: b.x, y: b.y };
  } else if (t.kind === 'company') {
    const c = st.companies[t.id];
    if (c?.hq) pos = c.hq;
  }
  if (pos) ctx.bus.emit('camera:focus', { x: pos.x, y: pos.y });
  if (select) ctx.bus.emit('select', t);
}
