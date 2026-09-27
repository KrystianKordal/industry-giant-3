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
import { h } from './dom';
import type { HudItemDef, PanelDef, PanelInstance, ToastOptions, ToolbarButtonDef, WindowHandle } from './types';

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
      const x = Math.min(lr.width - 60, Math.max(-r.width + 80, ev.clientX - lr.left - ox));
      const y = Math.min(lr.height - 30, Math.max(0, ev.clientY - lr.top - oy));
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
  else if (pos === 'left') (x = 12 + off), (y = 64 + off);
  else if (pos === 'right') (x = lw - w - 12 - off), (y = 64 + off);
  else (x = (lw - w) / 2 + off), (y = Math.max(56, (lh - hgt) / 2 - 40) + off);
  el.style.left = `${Math.max(0, x)}px`;
  el.style.top = `${Math.max(48, y)}px`;
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
  /** Called when toolbar/HUD registries change (hud.ts re-renders). */
  onRegistryChange: (() => void) | null = null;

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

  private tickPanels(): void {
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

  // ------------------------------------------------------------ toasts
  toast(o: ToastOptions): void {
    const level = o.level ?? 'info';
    const el = h(
      'div',
      { class: `ig-toast ig-toast-${level}` },
      h('div', { class: 'ig-toast-icon' }, o.icon ?? ''),
      h('div', { class: 'ig-toast-content' }, h('div', { class: 'ig-toast-title' }, o.title), o.text ? h('div', { class: 'ig-toast-text' }, o.text) : null),
    );
    const remove = (): void => {
      el.classList.add('ig-toast-out');
      setTimeout(() => el.remove(), 250);
    };
    el.addEventListener('click', () => {
      if (o.onClick) o.onClick();
      else if (o.target) {
        this.ctx.bus.emit('select', o.target);
        const t = o.target;
        const st = this.ctx.tryState();
        if (t.kind === 'tile') this.ctx.bus.emit('camera:focus', { x: t.x, y: t.y });
        else if (st && t.kind === 'building' && st.buildings[t.id]) this.ctx.bus.emit('camera:focus', { x: st.buildings[t.id]!.x, y: st.buildings[t.id]!.y });
        else if (st && t.kind === 'city' && st.cities[t.id]) this.ctx.bus.emit('camera:focus', { x: st.cities[t.id]!.x, y: st.cities[t.id]!.y });
      }
      remove();
    });
    this.toastLayer.append(el);
    while (this.toastLayer.children.length > 5) this.toastLayer.firstElementChild?.remove();
    setTimeout(remove, o.durationMs ?? (level === 'danger' ? 8000 : 5000));
  }
}
