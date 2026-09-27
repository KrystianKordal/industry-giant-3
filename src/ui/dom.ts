/**
 * Tiny hyperscript helper for vanilla DOM.
 *
 *   h('div', { class: 'row', onclick: () => … }, 'Tekst', h('b', null, '42'))
 *   h('input', { type: 'range', min: 0, max: 1, step: 0.1, value: 0.5, oninput: (e) => … })
 */
export type Child = Node | string | number | null | undefined | false | Child[];

export type Props = {
  class?: string;
  style?: string | Partial<Record<keyof CSSStyleDeclaration, string>>;
  dataset?: Record<string, string>;
  [attr: string]: unknown;
};

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style') {
        if (typeof v === 'string') el.style.cssText = v;
        else Object.assign(el.style, v);
      } else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else if (k in el && k !== 'list' && k !== 'form') (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

/** Replace all children. */
export function setChildren(el: Element, ...children: Child[]): void {
  el.replaceChildren();
  append(el, children);
}

/** Set textContent only if changed (cheap updates in onUpdate). */
export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}
