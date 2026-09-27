/**
 * Tooltip helper: tooltip(el, 'tekst') or tooltip(el, () => dynamicNodeOrText).
 * One shared floating element follows the cursor.
 */
import { h } from './dom';

let tipEl: HTMLElement | null = null;

function ensure(): HTMLElement {
  if (!tipEl) {
    tipEl = h('div', { class: 'ig-tooltip' });
    document.body.append(tipEl);
  }
  return tipEl;
}

export type TooltipContent = string | Node | (() => string | Node);

export function tooltip(el: HTMLElement, content: TooltipContent): void {
  const show = (e: MouseEvent): void => {
    const t = ensure();
    const c = typeof content === 'function' ? content() : content;
    t.replaceChildren(typeof c === 'string' ? document.createTextNode(c) : c);
    t.style.display = 'block';
    move(e);
  };
  const move = (e: MouseEvent): void => {
    const t = ensure();
    const pad = 14;
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    const r = t.getBoundingClientRect();
    if (x + r.width > window.innerWidth - 4) x = e.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 4) y = e.clientY - r.height - pad;
    t.style.left = `${x}px`;
    t.style.top = `${y}px`;
  };
  el.addEventListener('mouseenter', show);
  el.addEventListener('mousemove', move);
  el.addEventListener('mouseleave', hideTooltip);
  el.addEventListener('mousedown', hideTooltip);
}

export function hideTooltip(): void {
  if (tipEl) tipEl.style.display = 'none';
}
