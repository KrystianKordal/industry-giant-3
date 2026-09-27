/** Save / load panel (args: { mode: 'save' | 'load' }). */
import type { GameContext } from '../../core/context';
import { formatMoney } from '../../core/format';
import { endGame, saveGame, startLoadedGame } from '../../core/lifecycle';
import { AUTOSAVE_SLOT, deleteSlot, exportToFile, listSlots, loadFromSlot, pickSaveFile } from '../../core/save';
import { button } from '../components';
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
    const col = h('div', { class: 'ig-col' });
    col.append(
      button('Wróć do gry', () => p.close(), { variant: 'primary' }),
      button('Zapisz grę', () => ctx.ui.openPanel('saveLoad', { mode: 'save' }), { icon: '💾' }),
      button('Wczytaj grę', () => ctx.ui.openPanel('saveLoad', { mode: 'load' }), { icon: '📂' }),
      button('Ustawienia', () => ctx.ui.openPanel('settings'), { icon: '⚙️' }),
      button('Wyjdź do menu głównego', () => {
        p.close();
        endGame(ctx);
      }, { icon: '🚪', variant: 'danger' }),
    );
    p.body.append(col);
  },
};
