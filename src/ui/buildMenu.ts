/**
 * Build menu: toolbar category buttons (group 'build') + palette flyout listing
 * BuildingDefs of the category. Unlocked items are clickable (activates the
 * 'build' tool); locked ones are greyed with an era/tech requirement tooltip.
 */
import type { GameContext } from '../core/context';
import { formatMoney, formatNumber } from '../core/format';
import type { BuildingCategory, BuildingDef } from '../data/defs';
import { h, setChildren } from './dom';
import { CATEGORY_LABEL, ioText, lockInfo, productIcon } from './fmt';
import { closeOtherFlyouts } from './overlays';
import { hideTooltip, tooltip } from './tooltip';
import type { UiManager } from './ui';

export interface BuildCategory {
  id: string;
  label: string;
  icon: string;
  categories: BuildingCategory[];
  tooltip: string;
}

export const BUILD_CATEGORIES: BuildCategory[] = [
  { id: 'raw', label: 'Surowce', icon: '🌾', categories: ['raw'], tooltip: 'Farmy, kopalnie, tartaki, szyby — źródła surowców' },
  { id: 'factory', label: 'Fabryki', icon: '🏭', categories: ['factory'], tooltip: 'Zakłady przetwórcze: z surowców powstają produkty' },
  { id: 'shop', label: 'Handel', icon: '🏪', categories: ['shop', 'export'], tooltip: 'Sklepy w miastach i centra eksportowe — tu zarabiasz' },
  { id: 'hub', label: 'Magazyny', icon: '📦', categories: ['warehouse', 'station'], tooltip: 'Magazyny, huby, zajezdnie, stacje i porty' },
  { id: 'special', label: 'Specjalne', icon: '⚡', categories: ['research', 'recycling', 'energy', 'hq'], tooltip: 'Laboratoria, recykling, energia, siedziba' },
];

export function buildingsForCategory(ctx: GameContext, cat: BuildCategory): BuildingDef[] {
  return ctx.data
    .buildingList()
    .filter((b) => cat.categories.includes(b.category))
    .sort((a, b) => ctx.data.eraIndex(a.era) - ctx.data.eraIndex(b.era) || a.cost - b.cost);
}

/** Rich tooltip for a building def (also used by the encyclopedia). */
export function buildingTooltip(ctx: GameContext, d: BuildingDef, lockReason = ''): HTMLElement {
  const era = ctx.data.eras[d.era];
  const rows: (HTMLElement | null)[] = [
    h('div', { class: 'ig-tt-title' }, `${d.icon} ${d.name}`),
    d.description ? h('div', { class: 'ig-tt-desc' }, d.description) : null,
    h('div', { class: 'ig-tt-row' }, `Koszt: ${formatMoney(d.cost)} · utrzymanie ${formatMoney(d.upkeep)}/mies.`),
    h('div', { class: 'ig-tt-row' }, `Rozmiar ${d.size.w}×${d.size.h} · pracownicy ${d.workers} · budowa ${d.buildDays} dni`),
  ];
  for (const rid of d.recipes.slice(0, 4)) {
    const r = ctx.data.recipes[rid];
    if (!r) continue;
    rows.push(h('div', { class: 'ig-tt-recipe' }, `${r.alternative ? '◇' : '◆'} ${r.name}: ${r.inputs.length ? `${ioText(ctx, r.inputs)} → ` : ''}${ioText(ctx, r.outputs)} (${r.days} dni)`));
  }
  if (d.sells?.length) rows.push(h('div', { class: 'ig-tt-row' }, `Sprzedaje: ${d.sells.map((p) => productIcon(ctx, p)).join(' ')}`));
  const req: string[] = [];
  if (d.requiresDeposit) req.push(`złoże: ${ctx.data.deposits[d.requiresDeposit]?.name ?? d.requiresDeposit}`);
  if (d.minFertility) req.push('żyzna gleba');
  if (d.requiresWater) req.push('dostęp do wody');
  if (req.length) rows.push(h('div', { class: 'ig-tt-row ig-warn' }, `Wymaga: ${req.join(', ')}`));
  if (d.radius) rows.push(h('div', { class: 'ig-tt-row' }, `Zasięg: ${d.radius} kafli`));
  if (d.pollution) rows.push(h('div', { class: 'ig-tt-row' }, `Emisje: ${formatNumber(d.pollution, 1)}/mies.`));
  if (d.researchPoints) rows.push(h('div', { class: 'ig-tt-row' }, `Badania: +${d.researchPoints} pkt/mies.`));
  if (d.power) rows.push(h('div', { class: 'ig-tt-row' }, `Energia: ${d.power > 0 ? '+' : ''}${d.power} MW`));
  if (era) rows.push(h('div', { class: 'ig-tt-row ig-muted' }, `Epoka: ${era.icon} ${era.name}`));
  if (lockReason) rows.push(h('div', { class: 'ig-tt-lock' }, `🔒 ${lockReason}`));
  return h('div', { class: 'ig-tt' }, rows);
}

/** Open the build palette on a category (set by installBuildMenu). */
export let openBuildMenu: (catId: string) => void = () => {};

export function installBuildMenu(ctx: GameContext, ui: UiManager): { open(catId: string): void; toggle(catId?: string): void } {
  const fly = h('div', { class: 'ig-flyout ig-build-fly' }) as HTMLElement & { closeFly?: () => void };
  fly.style.display = 'none';
  ui.root.append(fly);
  let current: BuildCategory | null = null;
  let last = BUILD_CATEGORIES[0]!;
  let showLocked = true;

  const close = (): void => {
    fly.style.display = 'none';
    current = null;
    hideTooltip();
  };
  fly.closeFly = close;

  let sig = '';
  const render = (force = true): void => {
    if (!current || !ctx.hasGame) return;
    const cat = current;
    const st = ctx.state;
    const cash = st.companies[st.playerCompanyId]?.cash ?? 0;
    const list = buildingsForCategory(ctx, cat);
    const items = list
      .map((d) => ({ d, lock: lockInfo(ctx, 'building', d.id) }))
      .filter((x) => showLocked || x.lock.unlocked);
    const activeType = ctx.input.activeToolId === 'build' ? activeBuildType : '';
    const newSig = `${cat.id}|${showLocked}|${activeType}|${items.map((x) => `${x.d.id}:${x.lock.unlocked ? 1 : 0}:${x.d.cost <= cash ? 1 : 0}`).join(',')}`;
    if (!force && newSig === sig) return;
    sig = newSig;
    setChildren(
      fly,
      h(
        'div',
        { class: 'ig-flyout-head' },
        h('div', { class: 'ig-flyout-title' }, `${cat.icon} ${cat.label}`),
        h(
          'label',
          { class: 'ig-flyout-opt' },
          h('input', {
            type: 'checkbox',
            checked: showLocked,
            onchange: (e: Event) => {
              showLocked = (e.target as HTMLInputElement).checked;
              render();
            },
          }),
          'pokaż zablokowane',
        ),
        h('button', { class: 'ig-legend-x', onclick: close, title: 'Zamknij' }, '✕'),
      ),
      items.length === 0
        ? h('div', { class: 'ig-muted ig-small', style: { padding: '8px' } }, 'Brak budynków w tej kategorii.')
        : h(
            'div',
            { class: 'ig-build-grid' },
            items.map(({ d, lock }) => {
              const afford = d.cost <= cash;
              const card = h(
                'button',
                {
                  class: `ig-build-card${lock.unlocked ? '' : ' locked'}${activeType === d.id ? ' active' : ''}`,
                  dataset: { id: d.id, tool: 'build' },
                  onclick: () => {
                    if (!lock.unlocked) {
                      ctx.ui.toast({ level: 'info', icon: '🔒', title: `${d.name} — zablokowane`, text: lock.reason, durationMs: 3500 });
                      ctx.bus.emit('sfx', { id: 'error' });
                      return;
                    }
                    selectType(d.id);
                  },
                },
                h('div', { class: 'ig-build-icon' }, d.icon),
                h('div', { class: 'ig-build-name' }, d.name),
                h('div', { class: `ig-build-cost${afford ? '' : ' ig-neg'}` }, lock.unlocked ? formatMoney(d.cost, true) : `🔒 ${ctx.data.eras[d.era]?.icon ?? ''}`),
                d.recipes[0] && ctx.data.recipes[d.recipes[0]]
                  ? h('div', { class: 'ig-build-out' }, ctx.data.recipes[d.recipes[0]]!.outputs.map((o) => productIcon(ctx, o.product)).join(''))
                  : d.sells?.length
                    ? h('div', { class: 'ig-build-out' }, d.sells.slice(0, 5).map((p) => productIcon(ctx, p)).join(''))
                    : null,
              );
              tooltip(card, () => buildingTooltip(ctx, d, lock.unlocked ? '' : lock.reason));
              return card;
            }),
          ),
      h('div', { class: 'ig-flyout-foot' }, `${CATEGORY_LABEL[cat.categories[0]!]} · kliknij budynek, potem miejsce na mapie · R obraca`),
    );
  };

  let activeBuildType = '';
  const selectType = (typeId: string): void => {
    activeBuildType = typeId;
    ctx.input.setTool('build', { typeId });
    close();
  };

  const open = (catId: string): void => {
    const cat = BUILD_CATEGORIES.find((c) => c.id === catId) ?? last;
    current = cat;
    last = cat;
    fly.style.display = '';
    closeOtherFlyouts(ui, fly);
    render();
  };
  const toggle = (catId?: string): void => {
    const id = catId ?? last.id;
    if (current?.id === id && fly.style.display !== 'none') close();
    else open(id);
  };

  for (const [i, cat] of BUILD_CATEGORIES.entries()) {
    ui.registerToolbarButton({
      id: `build-${cat.id}`,
      icon: cat.icon,
      label: cat.label,
      group: 'build',
      order: i * 10,
      tooltip: cat.tooltip,
      hotkey: i === 0 ? 'B' : undefined,
      onClick: () => toggle(cat.id),
      isActive: (c) => {
        if (current?.id === cat.id) return true;
        if (c.input.activeToolId !== 'build') return false;
        const d = c.data.buildings[activeBuildType];
        return !!d && cat.categories.includes(d.category);
      },
    });
  }

  ctx.bus.on('tool:changed', ({ toolId }) => {
    if (toolId !== 'build') activeBuildType = '';
  });
  ctx.bus.on('game:ended', close);
  ctx.bus.on('era:changed', () => render());
  ctx.bus.on('research:completed', () => render());
  setInterval(() => {
    if (current && fly.style.display !== 'none') render(false);
  }, 1000);

  openBuildMenu = open;
  return { open, toggle };
}
