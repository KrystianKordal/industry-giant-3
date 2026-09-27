/**
 * Research view: tech tree grouped by era (columns), progress of the current
 * tech, ETA, availability (prereqs), effects in tooltips. Used as a dashboard
 * tab and as the standalone 'research' panel.
 */
import type { GameContext } from '../../core/context';
import { formatMoney, formatNumber } from '../../core/format';
import type { TechDef } from '../../data/defs';
import { badge, progressBar, select } from '../components';
import { h, setChildren } from '../dom';
import { effectsText, productLabel } from '../fmt';
import { tooltip } from '../tooltip';
import type { PanelDef } from '../types';

export function techEffectText(ctx: GameContext, t: TechDef): string[] {
  return t.effects.map((e) => {
    switch (e.kind) {
      case 'unlockBuilding':
        return `🏗️ Budynek: ${ctx.data.buildings[e.id]?.icon ?? ''} ${ctx.data.buildings[e.id]?.name ?? e.id}`;
      case 'unlockRecipe':
        return `📜 Receptura: ${ctx.data.recipes[e.id]?.name ?? e.id}`;
      case 'unlockVehicle':
        return `🚚 Pojazd: ${ctx.data.vehicles[e.id]?.icon ?? ''} ${ctx.data.vehicles[e.id]?.name ?? e.id}`;
      case 'unlockProduct':
        return `📦 Produkt: ${productLabel(ctx, e.id)}`;
      case 'modifier':
        return `📈 ${effectsText({ [e.key]: e.value })}`;
      case 'era':
        return `⏩ Epoka: ${ctx.data.eras[e.id]?.name ?? e.id}`;
      default:
        return '';
    }
  });
}

type TechState = 'done' | 'current' | 'available' | 'locked';

export function renderResearch(root: HTMLElement, ctx: GameContext): () => void {
  const topInfo = h('div');
  const budgetSlot = h('div');
  const top = h('div', { class: 'ig-research-top' }, topInfo, budgetSlot);
  const tree = h('div', { class: 'ig-tech-tree' });
  root.append(top, tree);
  const countBadge = badge('', 'info');
  const bar = progressBar(0);
  let sig = '';

  const stateOf = (t: TechDef): TechState => {
    const c = ctx.state.companies[ctx.state.playerCompanyId];
    if (!c) return 'locked';
    if (c.research.unlocked[t.id] !== undefined) return 'done';
    if (c.research.current === t.id) return 'current';
    return t.prereqs.every((p) => c.research.unlocked[p] !== undefined) ? 'available' : 'locked';
  };

  const start = (t: TechDef): void => {
    const pid = ctx.state.playerCompanyId;
    let res;
    try {
      res = ctx.services.economy.startResearch(pid, t.id);
    } catch (err) {
      res = { ok: false as const, reason: String(err) };
    }
    if (res.ok) {
      ctx.ui.toast({ level: 'info', icon: t.icon, title: `Rozpoczęto badania: ${t.name}` });
      ctx.bus.emit('sfx', { id: 'research' });
    } else ctx.ui.toast({ level: 'warning', icon: '🔬', title: 'Nie można rozpocząć badań', text: res.reason });
    sig = '';
    update();
  };

  const update = (): void => {
    if (!ctx.hasGame) return;
    const c = ctx.state.companies[ctx.state.playerCompanyId];
    if (!c) return;
    const r = c.research;
    const cur = r.current ? ctx.data.techs[r.current] : undefined;
    // top panel (cheap, every update)
    if (cur) {
      const eta = r.pointsPerMonth > 0 ? Math.ceil((cur.cost - r.progress) / r.pointsPerMonth) : Infinity;
      bar.set(r.progress / cur.cost, `${formatNumber(r.progress)} / ${formatNumber(cur.cost)} pkt`);
      setChildren(
        topInfo,
        h('div', { class: 'ig-row' }, h('span', { class: 'ig-research-icon' }, cur.icon), h('div', { class: 'ig-grow' }, h('div', { class: 'ig-strong' }, `Badane: ${cur.name}`), bar.el)),
        h('div', { class: 'ig-muted ig-small' }, `${formatNumber(r.pointsPerMonth, 1)} pkt/mies. · ${Number.isFinite(eta) ? `ukończenie za ~${eta} mies.` : 'brak postępu — zbuduj laboratorium lub zwiększ budżet'}`),
      );
    } else {
      setChildren(
        topInfo,
        h('div', { class: 'ig-warn' }, '🔬 Nic nie jest badane — wybierz technologię z drzewa poniżej.'),
        h('div', { class: 'ig-muted ig-small' }, `${formatNumber(r.pointsPerMonth, 1)} pkt/mies.`),
      );
    }
    if (!budgetSlot.firstChild) budgetSlot.append(budgetRow());
    countBadge.textContent = `odkryto ${Object.keys(r.unlocked).length}/${ctx.data.techList().length}`;
    // tree (only when something changed)
    const s = `${Object.keys(r.unlocked).length}|${r.current}|${ctx.data.version}`;
    if (s === sig) return;
    sig = s;
    const eras = ctx.data.eraList();
    const techs = ctx.data.techList();
    setChildren(
      tree,
      eras.map((era) => {
        const list = techs.filter((t) => t.era === era.id).sort((a, b) => a.cost - b.cost);
        const reached = ctx.data.eraIndex(ctx.state.time.eraId) >= era.index;
        return h(
          'div',
          { class: `ig-tech-col${reached ? '' : ' future'}`, style: { '--era-color': era.color } as Record<string, string> },
          h('div', { class: 'ig-tech-era' }, `${era.icon} ${era.name}`, h('div', { class: 'ig-muted ig-small' }, `od ${era.startYear} r.`)),
          list.length === 0 ? h('div', { class: 'ig-muted ig-small' }, '—') : null,
          list.map((t) => {
            const stt = stateOf(t);
            const card = h(
              'button',
              { class: `ig-tech ${stt}`, onclick: () => (stt === 'available' ? start(t) : undefined) },
              h('span', { class: 'ig-tech-icon' }, t.icon),
              h('span', { class: 'ig-tech-name' }, t.name),
              h('span', { class: 'ig-tech-cost' }, stt === 'done' ? '✓' : stt === 'current' ? '⏳' : `${formatNumber(t.cost)} pkt`),
            );
            if (stt === 'current' && cur) {
              const pr = h('div', { class: 'ig-tech-progress' });
              pr.style.width = `${Math.min(100, (r.progress / cur.cost) * 100)}%`;
              card.append(pr);
            }
            tooltip(card, () => {
              const eff = techEffectText(ctx, t);
              const missing = t.prereqs.filter((p) => c.research.unlocked[p] === undefined).map((p) => ctx.data.techs[p]?.name ?? p);
              return (
                `${t.icon} ${t.name}\n${t.description}\n\nKoszt: ${formatNumber(t.cost)} pkt\n${eff.join('\n')}` +
                (missing.length ? `\n\n🔒 Wymaga: ${missing.join(', ')}` : '') +
                (stt === 'available' ? '\n\nKliknij, aby rozpocząć badania.' : '')
              );
            });
            return card;
          }),
        );
      }),
    );
  };

  const budgetRow = (): HTMLElement => {
    const c = ctx.state.companies[ctx.state.playerCompanyId]!;
    const opts = [0, 500, 1000, 2500, 5000, 10000, 25000];
    if (!opts.includes(c.research.budget)) opts.push(c.research.budget);
    const sel = select(
      opts.sort((a, b) => a - b).map((v) => ({ value: v, label: v ? `${formatMoney(v)}/mies.` : 'brak' })),
      c.research.budget,
      (v) => {
        c.research.budget = v;
      },
    );
    tooltip(sel, 'Miesięczny budżet na badania — zamieniany na punkty badań (oprócz laboratoriów)');
    return h('div', { class: 'ig-row ig-small', style: { marginTop: '6px' } }, h('span', { class: 'ig-muted' }, 'Budżet R&D:'), sel, h('span', { class: 'ig-grow' }), countBadge);
  };

  update();
  return update;
}

export const researchPanel: PanelDef = {
  id: 'research',
  title: 'Badania i rozwój',
  icon: '🔬',
  width: 860,
  refreshMs: 1000,
  create(p, ctx) {
    const upd = renderResearch(p.body, ctx);
    p.onUpdate = upd;
  },
};
