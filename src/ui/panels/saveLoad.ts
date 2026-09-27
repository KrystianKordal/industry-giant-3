/** Save / load panel (args: { mode: 'save' | 'load' }). */
import type { GameContext } from '../../core/context';
import { formatMoney } from '../../core/format';
import { endGame, saveGame, startLoadedGame } from '../../core/lifecycle';
import { AUTOSAVE_SLOT, deleteSlot, exportToFile, listSlots, loadFromSlot, pickSaveFile } from '../../core/save';
import { button, confirmDialog } from '../components';
import { h, setChildren } from '../dom';
import type { PanelDef } from '../types';

export const SAVE_SLOTS = ['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6'];
const slotLabel = (s: string): string => (s === AUTOSAVE_SLOT ? 'Autozapis' : `Slot ${s.replace('slot', '')}`);

export async function loadSlotAndStart(ctx: GameContext, slot: string): Promise<void> {
  try {
    const st = await loadFromSlot(slot);
    startLoadedGame(ctx, st);
  } catch (err) {
    ctx.ui.toast({ level: 'danger', title: 'Nie udało się wczytać', text: err instanceof Error ? err.message : String(err) });
  }
}

export async function importAndStart(ctx: GameContext): Promise<void> {
  try {
    const st = await pickSaveFile();
    if (st) startLoadedGame(ctx, st);
  } catch (err) {
    ctx.ui.toast({ level: 'danger', title: 'Błędny plik zapisu', text: err instanceof Error ? err.message : String(err) });
  }
}

export const saveLoadPanel: PanelDef = {
  id: 'saveLoad',
  title: (args) => ((args as { mode?: string } | undefined)?.mode === 'save' ? 'Zapisz grę' : 'Wczytaj grę'),
  icon: '💾',
  width: 460,
  refreshMs: 0,
  create(p, ctx) {
    const mode = (p.args as { mode?: 'save' | 'load' } | undefined)?.mode ?? 'load';
    const list = h('div', { class: 'ig-list' });
    const render = (): void => {
      const slots = listSlots();
      const byId = new Map(slots.map((s) => [s.slot, s]));
      const ids = mode === 'save' ? SAVE_SLOTS : slots.map((s) => s.slot);
      setChildren(
        list,
        ids.length === 0 ? h('div', { class: 'ig-muted' }, 'Brak zapisanych gier.') : null,
        ids.map((id) => {
          const info = byId.get(id);
          return h(
            'div',
            { class: 'ig-list-item' },
            h(
              'div',
              { class: 'ig-grow' },
              h('div', { class: 'ig-strong' }, `${slotLabel(id)}${info ? ` — ${info.companyName}` : ''}`),
              h('div', { class: 'ig-muted ig-small' }, info ? `${info.gameDate} · ${formatMoney(info.cash, true)} · ${new Date(info.savedAt).toLocaleString('pl-PL')}` : 'Pusty'),
            ),
            mode === 'save'
              ? button(info ? 'Nadpisz' : 'Zapisz', async () => {
                  try {
                    await saveGame(ctx, id);
                    ctx.ui.toast({ level: 'success', title: 'Zapisano grę', text: slotLabel(id) });
                    render();
                  } catch (err) {
                    ctx.ui.toast({ level: 'danger', title: 'Błąd zapisu', text: err instanceof Error ? err.message : String(err) });
                  }
                }, { variant: 'primary', small: true })
              : button('Wczytaj', () => {
                  p.close();
                  void loadSlotAndStart(ctx, id);
                }, { variant: 'primary', small: true }),
            info
              ? button('', () => {
                  deleteSlot(id);
                  render();
                }, { icon: '🗑', variant: 'ghost', small: true, title: 'Usuń zapis' })
              : null,
          );
        }),
      );
    };
    render();
    const footer = h(
      'div',
      { class: 'ig-row ig-row-end', style: { marginTop: '10px' } },
      mode === 'save' && ctx.hasGame ? button('Eksportuj do pliku', () => void exportToFile(ctx.state), { icon: '⬇' }) : null,
      mode === 'load' ? button('Importuj z pliku', () => {
        p.close();
        void importAndStart(ctx);
      }, { icon: '⬆' }) : null,
    );
    p.body.append(list, footer);
  },
};

export const gameMenuPanel: PanelDef = {
  id: 'gameMenu',
  title: 'Menu gry',
  icon: '☰',
  width: 280,
  refreshMs: 0,
  create(p, ctx) {
    // pause while the menu is open, restore the previous state on close
    const wasPaused = ctx.tryState()?.time.paused ?? true;
    if (ctx.hasGame) ctx.sim.setPaused(true);
    p.onClose = () => {
      if (ctx.hasGame && !wasPaused) ctx.sim.setPaused(false);
    };
    const col = h('div', { class: 'ig-col ig-game-menu' });
    col.append(
      h('div', { class: 'ig-muted ig-small', style: { textAlign: 'center' } }, '⏸ Gra wstrzymana'),
      button('Wróć do gry', () => p.close(), { variant: 'primary', icon: '▶' }),
      button('Zapisz grę', () => ctx.ui.openPanel('saveLoad', { mode: 'save' }), { icon: '💾' }),
      button('Wczytaj grę', () => ctx.ui.openPanel('saveLoad', { mode: 'load' }), { icon: '📂' }),
      button('Ustawienia', () => ctx.ui.openPanel('settings'), { icon: '⚙️' }),
      button('Pomoc i skróty', () => ctx.ui.openPanel('help'), { icon: '❔' }),
      button('Encyklopedia', () => ctx.ui.openPanel('encyclopedia'), { icon: '📖' }),
      button('Wyjdź do menu głównego', async () => {
        if (!ctx.ui.root) return;
        const ans = await confirmDialog(ctx.ui.root, 'Wyjść do menu?', 'Niezapisane postępy zostaną utracone (chyba że masz autozapis).', [
          { id: 'save', label: 'Zapisz i wyjdź', variant: 'primary' },
          { id: 'quit', label: 'Wyjdź bez zapisu', variant: 'danger' },
          { id: 'no', label: 'Anuluj', variant: 'ghost' },
        ]);
        if (ans === 'no' || ans === null) return;
        if (ans === 'save') {
          try {
            await saveGame(ctx, AUTOSAVE_SLOT);
          } catch (err) {
            ctx.ui.toast({ level: 'danger', title: 'Błąd zapisu', text: err instanceof Error ? err.message : String(err) });
            return;
          }
        }
        p.close();
        endGame(ctx);
      }, { icon: '🚪', variant: 'danger' }),
    );
    p.body.append(col);
  },
};
