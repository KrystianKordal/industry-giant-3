/**
 * Pick tool: one-shot "click a target on the map" (used by inspector
 * "Połącz z…", route editor "Dodaj przystanek" …).
 *
 *   ctx.input.setTool('pick', { prompt: 'Wybierz odbiorcę', kinds: ['building'],
 *     accept: (sel) => sel.kind === 'building' || 'Wybierz budynek', onPick: (sel) => … } satisfies PickArgs)
 *
 * After a successful pick the tool returns to the previous tool (default: inspect).
 */
import { TILE_SIZE } from '../../core/constants';
import type { GameContext } from '../../core/context';
import type { Selection } from '../../core/events';
import type { ToolDef } from '../types';
import { pickAt } from './inspect';

export interface PickArgs {
  prompt: string;
  icon?: string;
  /** Allowed selection kinds (default: building). */
  kinds?: Selection['kind'][];
  /** Return true to accept, or a Polish reason string to reject. */
  accept?(sel: Selection, ctx: GameContext): true | string;
  onPick(sel: Selection, ctx: GameContext): void;
  onCancel?(ctx: GameContext): void;
}

export function createPickTool(ctx: GameContext): ToolDef {
  let args: PickArgs | null = null;
  let hoverSel: Selection = { kind: 'none' };
  let hoverOk: true | string = 'Wskaż cel';

  const evaluate = (sel: Selection): true | string => {
    if (!args) return 'Brak zadania';
    const kinds = args.kinds ?? ['building'];
    if (!kinds.includes(sel.kind)) return kinds.includes('building') ? 'Wskaż budynek' : 'Nieprawidłowy cel';
    return args.accept ? args.accept(sel, ctx) : true;
  };

  return {
    id: 'pick',
    name: 'Wybór celu',
    icon: '🎯',
    cursor: 'pointer',
    activate(_c, a) {
      args = (a as PickArgs) ?? null;
      hoverSel = { kind: 'none' };
    },
    deactivate() {
      args = null;
    },
    pointerMove(e) {
      if (!e.inMap) {
        hoverSel = { kind: 'none' };
        return;
      }
      hoverSel = pickAt(ctx.state, e.fx, e.fy);
      hoverOk = evaluate(hoverSel);
    },
    click(e) {
      if (!args || !e.inMap) return;
      const sel = pickAt(ctx.state, e.fx, e.fy);
      const ok = evaluate(sel);
      if (ok !== true) {
        ctx.ui.toast({ level: 'warning', icon: '🎯', title: ok, durationMs: 2500 });
        ctx.bus.emit('sfx', { id: 'error' });
        return;
      }
      const a = args;
      ctx.input.setTool(null);
      ctx.bus.emit('sfx', { id: 'click' });
      a.onPick(sel, ctx);
    },
    cancel() {
      const a = args;
      args = null;
      a?.onCancel?.(ctx);
      return false;
    },
    drawPreview({ g, state, zoom }) {
      if (hoverSel.kind !== 'building') return;
      const b = state.buildings[hoverSel.id];
      if (!b) return;
      g.strokeStyle = hoverOk === true ? '#5cc486' : '#e0564a';
      g.lineWidth = 3 / zoom;
      g.strokeRect(b.x * TILE_SIZE - 2, b.y * TILE_SIZE - 2, b.w * TILE_SIZE + 4, b.h * TILE_SIZE + 4);
    },
    hint: () => `${args?.icon ?? '🎯'} ${args?.prompt ?? 'Wskaż cel'} — PPM/Esc: anuluj`,
    status: () => {
      if (!args || hoverSel.kind === 'none') return null;
      const st = ctx.state;
      let title = '';
      if (hoverSel.kind === 'building') {
        const b = st.buildings[hoverSel.id];
        const d = b ? ctx.data.buildings[b.typeId] : undefined;
        title = `${d?.icon ?? ''} ${b?.name ?? d?.name ?? ''}`;
      } else if (hoverSel.kind === 'city') title = `🏙️ ${st.cities[hoverSel.id]?.name ?? ''}`;
      else if (hoverSel.kind === 'vehicle') title = `🚚 ${st.vehicles[hoverSel.id]?.name ?? ''}`;
      else title = 'Teren';
      return { icon: args.icon ?? '🎯', title, ok: hoverOk === true, message: hoverOk === true ? args.prompt : hoverOk };
    },
  };
}
