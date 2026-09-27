/**
 * Tooltip helper: tooltip(el, 'tekst') or tooltip(el, () => dynamicNodeOrText).
 * One shared floating element follows the cursor. Also: any element with a
 * `data-tip="…"` attribute gets a tooltip automatically (delegated listener).
 */
import { h } from './dom';

let tipEl: HTMLElement | null = null;
let delegated = false;

function ensure(): HTMLElement {
  if (!tipEl) {
    tipEl = h('div', { class: 'ig-tooltip' });
    document.body.append(tipEl);
  }
  if (!delegated) installDelegated();
  return tipEl;
}

export type TooltipContent = string | Node | (() => string | Node);

function showAt(content: string | Node, e: MouseEvent): void {
  const t = ensure();
  if (content === '' || content === null) {
    t.style.display = 'none';
    return;
  }
  t.replaceChildren(typeof content === 'string' ? document.createTextNode(content) : content);
  t.style.display = 'block';
  moveTo(e);
}

function moveTo(e: MouseEvent): void {
  const t = ensure();
  if (t.style.display === 'none') return;
  const pad = 14;
  let x = e.clientX + pad;
  let y = e.clientY + pad;
  const r = t.getBoundingClientRect();
  if (x + r.width > window.innerWidth - 4) x = e.clientX - r.width - pad;
  if (y + r.height > window.innerHeight - 4) y = e.clientY - r.height - pad;
  t.style.left = `${Math.max(4, x)}px`;
  t.style.top = `${Math.max(4, y)}px`;
}

export function tooltip(el: HTMLElement, content: TooltipContent): void {
  const show = (e: MouseEvent): void => {
    let c: string | Node;
    try {
      c = typeof content === 'function' ? content() : content;
    } catch {
      c = '';
    }
    showAt(c, e);
  };
  el.addEventListener('mouseenter', show);
  el.addEventListener('mousemove', moveTo);
  el.addEventListener('mouseleave', hideTooltip);
  el.addEventListener('mousedown', hideTooltip);
  ensure();
}

export function hideTooltip(): void {
  if (tipEl) tipEl.style.display = 'none';
}

function installDelegated(): void {
  delegated = true;
  let current: HTMLElement | null = null;
  document.addEventListener('mouseover', (e) => {
    const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-tip]') ?? null;
    if (el === current) return;
    current = el;
    if (el?.dataset.tip) showAt(el.dataset.tip, e);
    else if (!el) {
      /* leaving a data-tip element; explicit tooltips manage themselves */
    }
  });
  document.addEventListener('mouseout', (e) => {
    const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-tip]') ?? null;
    const to = (e.relatedTarget as HTMLElement | null)?.closest?.<HTMLElement>('[data-tip]') ?? null;
    if (el && el !== to) {
      current = null;
      hideTooltip();
    }
  });
  document.addEventListener('mousemove', (e) => {
    if (current) moveTo(e);
  });
}
