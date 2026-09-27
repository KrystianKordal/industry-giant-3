/**
 * Reusable UI components (vanilla DOM). All return plain elements or small
 * handles with update methods. Styling: styles.css (.ig-* classes).
 */
import { h, setChildren, setText, type Child } from './dom';
import { tooltip } from './tooltip';

export interface ButtonOptions {
  icon?: string;
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  small?: boolean;
  title?: string;
  disabled?: boolean;
}

export function button(label: string, onClick: (e: MouseEvent) => void, o: ButtonOptions = {}): HTMLButtonElement {
  const b = h(
    'button',
    {
      class: `ig-btn ig-btn-${o.variant ?? 'default'}${o.small ? ' ig-btn-sm' : ''}`,
      disabled: o.disabled,
      onclick: (e: MouseEvent) => onClick(e),
    },
    o.icon ? h('span', { class: 'ig-btn-icon' }, o.icon) : null,
    label ? h('span', null, label) : null,
  );
  if (o.title) tooltip(b, o.title);
  return b;
}

export interface TabDef {
  id: string;
  label: string;
  icon?: string;
  /** Build tab content (called on first show; and again if rerender=true). */
  render(el: HTMLElement): void;
  rerender?: boolean;
}

export interface TabsHandle {
  el: HTMLElement;
  active: string;
  select(id: string): void;
}

export function tabs(defs: TabDef[], initial?: string): TabsHandle {
  const bar = h('div', { class: 'ig-tabs-bar' });
  const content = h('div', { class: 'ig-tabs-content' });
  const panes = new Map<string, HTMLElement>();
  const btns = new Map<string, HTMLElement>();
  const handle: TabsHandle = {
    el: h('div', { class: 'ig-tabs' }, bar, content),
    active: '',
    select(id) {
      const def = defs.find((d) => d.id === id);
      if (!def) return;
      handle.active = id;
      for (const [k, b] of btns) b.classList.toggle('active', k === id);
      let pane = panes.get(id);
      if (!pane || def.rerender) {
        pane = pane ?? h('div', { class: 'ig-tab-pane' });
        pane.replaceChildren();
        def.render(pane);
        panes.set(id, pane);
      }
      content.replaceChildren(pane);
    },
  };
  for (const d of defs) {
    const b = h('button', { class: 'ig-tab', onclick: () => handle.select(d.id) }, d.icon ? `${d.icon} ` : '', d.label);
    btns.set(d.id, b);
    bar.append(b);
  }
  handle.select(initial ?? defs[0]?.id ?? '');
  return handle;
}

export interface Column<T> {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  width?: string;
  /** Cell content; default = String(row[key]). */
  render?(row: T): Child;
  /** Sort value; enables click-to-sort on header. */
  sort?(row: T): number | string;
}

export interface TableHandle<T> {
  el: HTMLElement;
  setRows(rows: T[]): void;
}

export function table<T>(columns: Column<T>[], rows: T[] = [], opts: { onRowClick?(row: T): void; empty?: string } = {}): TableHandle<T> {
  let sortKey: string | null = null;
  let sortDir = 1;
  let current = rows;
  const thead = h('thead');
  const tbody = h('tbody');
  const el = h('div', { class: 'ig-table-wrap' }, h('table', { class: 'ig-table' }, thead, tbody));
  const renderHead = (): void => {
    setChildren(
      thead,
      h(
        'tr',
        null,
        columns.map((c) =>
          h(
            'th',
            {
              style: { textAlign: c.align ?? 'left', width: c.width ?? '' },
              class: c.sort ? 'sortable' : '',
              onclick: c.sort
                ? () => {
                    sortDir = sortKey === c.key ? -sortDir : 1;
                    sortKey = c.key;
                    renderBody();
                    renderHead();
                  }
                : undefined,
            },
            c.label,
            sortKey === c.key ? (sortDir > 0 ? ' ▲' : ' ▼') : '',
          ),
        ),
      ),
    );
  };
  const renderBody = (): void => {
    let list = current;
    const col = columns.find((c) => c.key === sortKey);
    if (col?.sort) {
      const f = col.sort;
      list = [...current].sort((a, b) => {
        const va = f(a);
        const vb = f(b);
        return (va < vb ? -1 : va > vb ? 1 : 0) * sortDir;
      });
    }
    if (list.length === 0) {
      setChildren(tbody, h('tr', null, h('td', { colSpan: columns.length, class: 'ig-muted', style: { textAlign: 'center' } }, opts.empty ?? 'Brak danych')));
      return;
    }
    setChildren(
      tbody,
      list.map((row) =>
        h(
          'tr',
          { class: opts.onRowClick ? 'clickable' : '', onclick: opts.onRowClick ? () => opts.onRowClick!(row) : undefined },
          columns.map((c) =>
            h('td', { style: { textAlign: c.align ?? 'left' } }, c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '')),
          ),
        ),
      ),
    );
  };
  renderHead();
  renderBody();
  return {
    el,
    setRows(r) {
      current = r;
      renderBody();
    },
  };
}

export interface ProgressHandle {
  el: HTMLElement;
  set(value: number, label?: string): void;
}

/** Progress bar, value 0..1. */
export function progressBar(value = 0, o: { label?: string; color?: string } = {}): ProgressHandle {
  const fill = h('div', { class: 'ig-progress-fill' });
  if (o.color) fill.style.background = o.color;
  const text = h('div', { class: 'ig-progress-label' }, o.label ?? '');
  const el = h('div', { class: 'ig-progress' }, fill, text);
  const handle: ProgressHandle = {
    el,
    set(v, label) {
      fill.style.width = `${Math.max(0, Math.min(1, v)) * 100}%`;
      if (label !== undefined) setText(text, label);
    },
  };
  handle.set(value);
  return handle;
}

/** Label/value row for inspectors: returns { el, set(value) }. */
export function statRow(label: string, value: Child = ''): { el: HTMLElement; set(v: string): void } {
  const v = h('span', { class: 'ig-stat-value' }, value);
  return { el: h('div', { class: 'ig-stat' }, h('span', { class: 'ig-stat-label' }, label), v), set: (s) => setText(v, s) };
}

export function section(title: string, ...children: Child[]): HTMLElement {
  return h('div', { class: 'ig-section' }, h('div', { class: 'ig-section-title' }, title), ...children);
}

/** Simple modal dialog with buttons; resolves with the chosen button id (null on close). */
export function confirmDialog(layer: HTMLElement, title: string, text: string, buttons: { id: string; label: string; variant?: ButtonOptions['variant'] }[]): Promise<string | null> {
  return new Promise((resolve) => {
    const close = (v: string | null): void => {
      back.remove();
      resolve(v);
    };
    const back = h(
      'div',
      { class: 'ig-modal-back', onclick: (e: MouseEvent) => e.target === back && close(null) },
      h(
        'div',
        { class: 'ig-modal' },
        h('h3', null, title),
        h('p', null, text),
        h('div', { class: 'ig-row ig-row-end' }, buttons.map((b) => button(b.label, () => close(b.id), { variant: b.variant }))),
      ),
    );
    layer.append(back);
  });
}
