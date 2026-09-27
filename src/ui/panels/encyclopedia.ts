/**
 * Encyclopedia (panel 'encyclopedia', args { kind?, id? }) — generated from the
 * data registry: products (recipes, production chain tree, uses, demand),
 * buildings, vehicles, technologies, eras. Works without a running game.
 */
import type { GameContext } from '../../core/context';
import { formatMoney, formatNumber } from '../../core/format';
import type { ProductDef, RecipeDef } from '../../data/defs';
import { buildingTooltip } from '../buildMenu';
import { badge } from '../components';
import { h, setChildren, type Child } from '../dom';
import { CATEGORY_LABEL, CLASS_LABEL, MODE_LABEL, effectsText, PRODUCT_CATEGORY_LABEL, ioText, lockInfo, productIcon, productName } from '../fmt';
import type { PanelDef } from '../types';
import { techEffectText } from './research';

type Kind = 'product' | 'building' | 'vehicle' | 'tech' | 'era';
const KINDS: { id: Kind; label: string }[] = [
  { id: 'product', label: '📦 Produkty' },
  { id: 'building', label: '🏭 Budynki' },
  { id: 'vehicle', label: '🚚 Pojazdy' },
  { id: 'tech', label: '🔬 Technologie' },
  { id: 'era', label: '⏳ Epoki' },
];

interface Entry {
  id: string;
  icon: string;
  name: string;
  group: string;
  order: number;
}

function entries(ctx: GameContext, kind: Kind): Entry[] {
  const d = ctx.data;
  const eraOrder = (e: string): number => d.eraIndex(e);
  switch (kind) {
    case 'product':
      return d.productList().map((p) => ({ id: p.id, icon: p.icon, name: p.name, group: PRODUCT_CATEGORY_LABEL[p.category] ?? p.category, order: eraOrder(p.era) * 1000 + p.basePrice }));
    case 'building':
      return d.buildingList().map((b) => ({ id: b.id, icon: b.icon, name: b.name, group: CATEGORY_LABEL[b.category] ?? b.category, order: eraOrder(b.era) * 1e7 + b.cost }));
    case 'vehicle':
      return d.vehicleList().map((v) => ({ id: v.id, icon: v.icon, name: v.name, group: MODE_LABEL[v.mode] ?? v.mode, order: eraOrder(v.era) * 1e7 + v.cost }));
    case 'tech':
      return d.techList().map((t) => ({ id: t.id, icon: t.icon, name: t.name, group: d.eras[t.era]?.name ?? t.era, order: eraOrder(t.era) * 1e7 + t.cost }));
    case 'era':
      return d.eraList().map((e) => ({ id: e.id, icon: e.icon, name: e.name, group: 'Epoki', order: e.index }));
  }
}

export const encyclopediaPanel: PanelDef = {
  id: 'encyclopedia',
  title: 'Encyklopedia',
  icon: '📖',
  width: 860,
  height: 580,
  refreshMs: 0,
  create(p, ctx) {
    const args = (p.args ?? {}) as { kind?: Kind; id?: string };
    let kind: Kind = args.kind ?? 'product';
    let selected = args.id ?? '';
    let query = '';
    const history: { kind: Kind; id: string }[] = [];

    const tabsEl = h('div', { class: 'ig-tabs-bar' });
    const search = h('input', {
      type: 'text',
      placeholder: '🔍 Szukaj…',
      class: 'ig-input-wide',
      oninput: () => {
        query = search.value.trim().toLowerCase();
        renderList();
      },
    });
    const listEl = h('div', { class: 'ig-ency-list' });
    const detail = h('div', { class: 'ig-ency-detail' });
    p.body.classList.add('ig-ency-body');
    p.body.append(tabsEl, h('div', { class: 'ig-ency' }, h('div', { class: 'ig-ency-side' }, search, listEl), detail));

    const go = (k: Kind, id: string, push = true): void => {
      if (push && selected) history.push({ kind, id: selected });
      kind = k;
      selected = id;
      renderTabs();
      renderList();
      renderDetail();
    };
    const link = (k: Kind, id: string, text: string): HTMLElement => h('button', { class: 'ig-link', onclick: () => go(k, id) }, text);
    const plink = (id: string): HTMLElement => link('product', id, `${productIcon(ctx, id)} ${productName(ctx, id)}`);

    const renderTabs = (): void => {
      setChildren(
        tabsEl,
        KINDS.map((k) => h('button', { class: `ig-tab${k.id === kind ? ' active' : ''}`, onclick: () => go(k.id, entries(ctx, k.id).sort((a, b) => a.order - b.order)[0]?.id ?? '', false) }, k.label)),
      );
    };

    const renderList = (): void => {
      const list = entries(ctx, kind)
        .filter((e) => !query || e.name.toLowerCase().includes(query) || e.id.includes(query))
        .sort((a, b) => a.group.localeCompare(b.group, 'pl') || a.order - b.order);
      let group = '';
      const out: Child[] = [];
      for (const e of list) {
        if (e.group !== group) {
          group = e.group;
          out.push(h('div', { class: 'ig-ency-group' }, group));
        }
        out.push(h('button', { class: `ig-ency-item${e.id === selected ? ' active' : ''}`, onclick: () => go(kind, e.id) }, h('span', null, e.icon), ' ', e.name));
      }
      setChildren(listEl, out.length ? out : h('div', { class: 'ig-muted ig-small' }, 'Brak wyników.'));
    };

    const recipeRow = (r: RecipeDef): HTMLElement => {
      const producers = ctx.data.buildingsRunning(r.id);
      return h(
        'div',
        { class: 'ig-ency-recipe' },
        h('div', { class: 'ig-strong' }, r.alternative ? '◇ ' : '◆ ', r.name, r.alternative ? badge('alternatywna', 'info') : '', r.qualityModifier ? badge(`jakość ${r.qualityModifier > 0 ? '+' : ''}${Math.round(r.qualityModifier * 100)}%`, r.qualityModifier > 0 ? 'pos' : 'warn') : ''),
        h(
          'div',
          { class: 'ig-recipe-flow' },
          r.inputs.length ? h('span', null, r.inputs.map((io, i) => [i ? ' + ' : '', `${formatNumber(io.qty, 1)} `, plink(io.product)])) : h('span', { class: 'ig-muted' }, 'z natury'),
          h('span', { class: 'ig-recipe-arrow' }, '→'),
          h('span', null, r.outputs.map((io, i) => [i ? ' + ' : '', `${formatNumber(io.qty, 1)} `, plink(io.product)])),
          h('span', { class: 'ig-muted' }, ` · ${r.days} dni`),
        ),
        r.byproducts?.length ? h('div', { class: 'ig-small ig-muted' }, `Produkty uboczne: ${ioText(ctx, r.byproducts)}`) : null,
        producers.length ? h('div', { class: 'ig-small' }, 'Budynek: ', producers.map((b, i) => [i ? ', ' : '', link('building', b.id, `${b.icon} ${b.name}`)])) : null,
        r.requiresTech ? h('div', { class: 'ig-small ig-warn' }, 'Wymaga: ', link('tech', r.requiresTech, ctx.data.techs[r.requiresTech]?.name ?? r.requiresTech)) : null,
      );
    };

    /** Upstream chain tree for a product. */
    const chainTree = (pid: string, depth = 0, seen = new Set<string>()): HTMLElement | null => {
      if (depth > 6 || seen.has(pid)) return null;
      const next = new Set(seen).add(pid);
      const r = ctx.data.recipesProducing(pid).find((x) => !x.alternative) ?? ctx.data.recipesProducing(pid)[0];
      const b = r ? ctx.data.buildingsRunning(r.id)[0] : undefined;
      return h(
        'div',
        { class: 'ig-chain-tree-node' },
        h('div', { class: 'ig-chain-tree-label' }, plink(pid), b ? h('span', { class: 'ig-muted ig-small' }, ` ← ${b.icon} ${b.name}`) : h('span', { class: 'ig-muted ig-small' }, ' (surowiec)')),
        r?.inputs.length ? h('div', { class: 'ig-chain-tree-children' }, r.inputs.map((io) => chainTree(io.product, depth + 1, next))) : null,
      );
    };

    const renderProduct = (pd: ProductDef): Child[] => {
      const d = ctx.data;
      const producing = d.recipesProducing(pd.id);
      const using = Object.values(d.recipes).filter((r) => r.inputs.some((i) => i.product === pd.id));
      const byproductOf = Object.values(d.recipes).filter((r) => r.byproducts?.some((i) => i.product === pd.id));
      const sellers = d.buildingList().filter((b) => b.sells?.includes(pd.id));
      const st = ctx.tryState();
      const price = st?.market.products[pd.id]?.price;
      const cons = pd.consumption ? Object.entries(pd.consumption).filter(([, v]) => v) : [];
      return [
        h('div', { class: 'ig-ency-title' }, h('span', { class: 'ig-ency-bigicon' }, pd.icon), h('div', null, h('h2', null, pd.name), h('div', { class: 'ig-muted' }, PRODUCT_CATEGORY_LABEL[pd.category] ?? pd.category, ' · epoka: ', link('era', pd.era, d.eras[pd.era]?.name ?? pd.era)))),
        pd.description ? h('p', null, pd.description) : null,
        h(
          'div',
          { class: 'ig-chips' },
          badge(`cena bazowa ${formatMoney(pd.basePrice)}`, 'accent'),
          price !== undefined ? badge(`rynek ${formatMoney(price)}`, 'info') : null,
          pd.perishableDays ? badge(`psuje się po ${pd.perishableDays} dniach`, 'warn') : null,
          pd.green ? badge('🌿 ekologiczny', 'pos') : null,
          pd.isWaste ? badge('♻ odpad', 'dim') : null,
          badge(`ładunek: ${pd.weightClass}`, 'dim'),
        ),
        cons.length ? h('div', { class: 'ig-section-title' }, 'Konsumpcja w miastach (na 1000 mieszkańców / mies.)') : null,
        cons.length ? h('div', { class: 'ig-chips' }, cons.map(([k, v]) => badge(`${CLASS_LABEL[k as 'poor'] ?? k}: ${v}`, 'dim'))) : null,
        h('div', { class: 'ig-section-title' }, 'Jak powstaje'),
        producing.length
          ? producing.map(recipeRow)
          : byproductOf.length
            ? [h('div', { class: 'ig-muted' }, 'Produkt uboczny powstający przy:'), ...byproductOf.map(recipeRow)]
            : h('div', { class: 'ig-muted' }, 'Surowiec — wydobywany lub uprawiany.'),
        h('div', { class: 'ig-section-title' }, 'Łańcuch produkcji'),
        h('div', { class: 'ig-chain-tree' }, chainTree(pd.id)),
        h('div', { class: 'ig-section-title' }, 'Wykorzystanie'),
        using.length ? using.map(recipeRow) : null,
        sellers.length ? h('div', null, 'Sprzedawany w: ', sellers.map((b, i) => [i ? ', ' : '', link('building', b.id, `${b.icon} ${b.name}`)])) : null,
        !using.length && !sellers.length ? h('div', { class: 'ig-muted' }, 'Produkt końcowy — trafia do sklepów lub na eksport.') : null,
      ];
    };

    const renderDetail = (): void => {
      const d = ctx.data;
      let body: Child[] = [];
      if (kind === 'product' && d.products[selected]) body = renderProduct(d.products[selected]!);
      else if (kind === 'building' && d.buildings[selected]) {
        const b = d.buildings[selected]!;
        const lock = lockInfo(ctx, 'building', b.id);
        const unlockers = d.techList().filter((t) => t.effects.some((e) => e.kind === 'unlockBuilding' && e.id === b.id));
        body = [
          h('div', { class: 'ig-ency-title' }, h('span', { class: 'ig-ency-bigicon' }, b.icon), h('div', null, h('h2', null, b.name), h('div', { class: 'ig-muted' }, CATEGORY_LABEL[b.category], ' · epoka: ', link('era', b.era, d.eras[b.era]?.name ?? b.era)))),
          buildingTooltip(ctx, b, lock.unlocked ? '' : lock.reason),
          b.recipes.length ? h('div', { class: 'ig-section-title' }, 'Receptury') : null,
          b.recipes.map((rid) => (d.recipes[rid] ? recipeRow(d.recipes[rid]!) : null)),
          b.upgrades?.length ? h('div', { class: 'ig-section-title' }, 'Ulepszenia') : null,
          b.upgrades?.map((u) => h('div', null, `⬆️ ${u.name} — ${formatMoney(u.cost)} (${effectsText(u.effects)})`)),
          unlockers.length ? h('div', { class: 'ig-small' }, 'Odblokowuje: ', unlockers.map((t, i) => [i ? ', ' : '', link('tech', t.id, `${t.icon} ${t.name}`)])) : null,
        ];
      } else if (kind === 'vehicle' && d.vehicles[selected]) {
        const v = d.vehicles[selected]!;
        body = [
          h('div', { class: 'ig-ency-title' }, h('span', { class: 'ig-ency-bigicon' }, v.icon), h('div', null, h('h2', null, v.name), h('div', { class: 'ig-muted' }, `Transport ${MODE_LABEL[v.mode].toLowerCase()} · epoka: `, link('era', v.era, d.eras[v.era]?.name ?? v.era)))),
          v.description ? h('p', null, v.description) : null,
          h(
            'div',
            { class: 'ig-ency-stats' },
            h('div', null, h('b', null, 'Ładowność: '), `${v.capacity} j.${v.wagons ? ' / wagon' : ''}`),
            h('div', null, h('b', null, 'Prędkość: '), `${v.speed} kafli/dzień`),
            h('div', null, h('b', null, 'Cena: '), formatMoney(v.cost)),
            h('div', null, h('b', null, 'Utrzymanie: '), `${formatMoney(v.upkeep)}/mies.`),
            h('div', null, h('b', null, 'Żywotność: '), `${v.lifespanYears} lat`),
            h('div', null, h('b', null, 'Emisje: '), `${v.emissions}/kafel`),
            v.wagons ? h('div', null, h('b', null, 'Wagony: '), `${v.wagons.min}–${v.wagons.max} (${formatMoney(v.wagons.costPerWagon)} / wagon)`) : null,
            v.cargo ? h('div', null, h('b', null, 'Ładunki: '), v.cargo.join(', ')) : null,
          ),
          v.requiresTech ? h('div', { class: 'ig-warn' }, 'Wymaga: ', link('tech', v.requiresTech, d.techs[v.requiresTech]?.name ?? v.requiresTech)) : null,
        ];
      } else if (kind === 'tech' && d.techs[selected]) {
        const t = d.techs[selected]!;
        const next = d.techList().filter((x) => x.prereqs.includes(t.id));
        body = [
          h('div', { class: 'ig-ency-title' }, h('span', { class: 'ig-ency-bigicon' }, t.icon), h('div', null, h('h2', null, t.name), h('div', { class: 'ig-muted' }, `${formatNumber(t.cost)} pkt badań · epoka: `, link('era', t.era, d.eras[t.era]?.name ?? t.era)))),
          h('p', null, t.description),
          h('div', { class: 'ig-section-title' }, 'Efekty'),
          techEffectText(ctx, t).map((x) => h('div', null, x)),
          t.prereqs.length ? h('div', { class: 'ig-section-title' }, 'Wymaga') : null,
          t.prereqs.map((pid) => h('div', null, link('tech', pid, `${d.techs[pid]?.icon ?? ''} ${d.techs[pid]?.name ?? pid}`))),
          next.length ? h('div', { class: 'ig-section-title' }, 'Prowadzi do') : null,
          next.map((x) => h('div', null, link('tech', x.id, `${x.icon} ${x.name}`))),
        ];
      } else if (kind === 'era' && d.eras[selected]) {
        const e = d.eras[selected]!;
        const inEra = <T extends { era: string; id: string; icon: string; name: string }>(list: T[], k: Kind): HTMLElement =>
          h('div', { class: 'ig-chips' }, list.filter((x) => x.era === e.id).map((x) => link(k, x.id, `${x.icon} ${x.name}`)));
        body = [
          h('div', { class: 'ig-ency-title' }, h('span', { class: 'ig-ency-bigicon' }, e.icon), h('div', null, h('h2', null, e.name), h('div', { class: 'ig-muted' }, `od ${e.startYear} r.`))),
          h('p', null, e.description),
          h('div', { class: 'ig-section-title' }, 'Nowe produkty'),
          inEra(d.productList(), 'product'),
          h('div', { class: 'ig-section-title' }, 'Nowe budynki'),
          inEra(d.buildingList(), 'building'),
          h('div', { class: 'ig-section-title' }, 'Nowe pojazdy'),
          inEra(d.vehicleList(), 'vehicle'),
          h('div', { class: 'ig-section-title' }, 'Technologie'),
          inEra(d.techList(), 'tech'),
        ];
      } else body = [h('div', { class: 'ig-muted' }, 'Wybierz pozycję z listy.')];
      setChildren(
        detail,
        history.length
          ? h(
              'button',
              {
                class: 'ig-link ig-small',
                onclick: () => {
                  const prev = history.pop();
                  if (prev) go(prev.kind, prev.id, false);
                },
              },
              '← wstecz',
            )
          : null,
        body,
      );
      detail.scrollTop = 0;
    };

    if (!selected) {
      // start somewhere familiar (the first chain of the game), not on the cheapest waste product
      const preferred = kind === 'product' ? ['bread', 'grain'].find((id) => ctx.data.products[id]) : undefined;
      selected =
        preferred ??
        entries(ctx, kind)
          .filter((e) => kind !== 'product' || !ctx.data.products[e.id]?.isWaste)
          .sort((a, b) => a.order - b.order)[0]?.id ??
        '';
    }
    renderTabs();
    renderList();
    renderDetail();
    setTimeout(() => search.focus(), 0);
  },
};
