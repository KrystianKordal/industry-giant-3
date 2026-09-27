/** Shared pieces for inspector panels. */
import type { GameContext } from '../../../core/context';
import { formatNumber, formatPercent } from '../../../core/format';
import type { Stock } from '../../../core/types';
import { goodColor, meter } from '../../components';
import { h, type Child } from '../../dom';
import { productIcon, productName, qualityLabel } from '../../fmt';
import { tooltip } from '../../tooltip';

/** Table-like list of stock entries: icon, name, qty(/cap), quality meter. */
export function stockList(ctx: GameContext, s: Stock, capacity = 0, emptyText = 'pusto', expected: string[] = []): HTMLElement {
  const keys = [...new Set([...expected, ...Object.keys(s).filter((k) => (s[k]?.qty ?? 0) >= 0.05)])];
  if (!keys.length) return h('div', { class: 'ig-muted ig-small' }, emptyText);
  return h(
    'div',
    { class: 'ig-stock' },
    keys.map((k) => {
      const e = s[k];
      const qty = e?.qty ?? 0;
      const q = e?.quality ?? 0.5;
      const fill = capacity > 0 ? qty / capacity : 0;
      const row = h(
        'div',
        { class: 'ig-stock-row' },
        h('span', { class: 'ig-stock-icon' }, productIcon(ctx, k)),
        h('span', { class: 'ig-stock-name' }, productName(ctx, k)),
        h('span', { class: `ig-stock-qty${qty < 0.05 ? ' ig-neg' : ''}` }, capacity > 0 ? `${formatNumber(qty, 1)} / ${formatNumber(capacity)}` : formatNumber(qty, 1)),
        capacity > 0 ? meter(fill, { color: fill > 0.9 ? 'var(--warning)' : 'var(--info)', width: 46 }) : null,
        qty >= 0.05 ? meter(q, { color: goodColor(q), width: 36 }) : h('span', { style: { width: '36px' } }),
      );
      tooltip(row, `${productName(ctx, k)}: ${formatNumber(qty, 1)} szt.\nJakość: ${formatPercent(q)} (${qualityLabel(q)})`);
      return row;
    }),
  );
}

export function kv(label: string, value: Child, tone = ''): HTMLElement {
  return h('div', { class: 'ig-stat' }, h('span', { class: 'ig-stat-label' }, label), h('span', { class: `ig-stat-value ${tone}` }, value));
}

/**
 * Container whose content is replaced on each update(). If `sig` is given the
 * content is rebuilt only when the signature changes (keeps buttons clickable).
 */
export function dyn(render: (el: HTMLElement) => void, cls = '', sig?: () => string): { el: HTMLElement; update(): void } {
  const el = h('div', { class: cls });
  let last: string | null = null;
  return {
    el,
    update() {
      if (sig) {
        let s = '';
        try {
          s = sig();
        } catch {
          s = String(Math.random());
        }
        if (s === last) return;
        last = s;
      }
      el.replaceChildren();
      try {
        render(el);
      } catch (err) {
        el.append(h('div', { class: 'ig-error' }, String(err)));
      }
    },
  };
}
