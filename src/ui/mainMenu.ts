/**
 * Main menu overlay (shown when no game runs). UI agent: extend with a full
 * "new game" dialog (seed, map size, difficulty, rivals, campaign).
 */
import type { GameContext } from '../core/context';
import { startNewGame } from '../core/lifecycle';
import { AUTOSAVE_SLOT, hasSlot, listSlots } from '../core/save';
import { button } from './components';
import { h, setChildren } from './dom';
import { importAndStart, loadSlotAndStart } from './panels/saveLoad';
import type { UiManager } from './ui';

export function installMainMenu(ctx: GameContext, ui: UiManager): void {
  const menu = h('div', { class: 'ig-main-menu' });
  ui.overlayLayer.append(menu);

  const render = (): void => {
    const last = listSlots()[0];
    setChildren(
      menu,
      h(
        'div',
        { class: 'ig-main-menu-card' },
        h('div', { class: 'ig-main-title' }, 'Industry Giant 3'),
        h('div', { class: 'ig-main-subtitle' }, 'Zbuduj przemysłowe imperium — od farmy po smartfony.'),
        h(
          'div',
          { class: 'ig-col ig-main-buttons' },
          last ? button(`Kontynuuj (${last.gameDate})`, () => void loadSlotAndStart(ctx, last.slot), { variant: 'primary', icon: '▶' }) : null,
          button('Nowa gra', () => {
            ctx.services.audio.unlock();
            startNewGame(ctx, {});
          }, { variant: last ? 'default' : 'primary', icon: '🏭' }),
          button('Kampania', () => ctx.ui.openPanel('campaign'), { icon: '🎖', disabled: ctx.services.game.scenarios().length === 0 }),
          button('Wczytaj grę', () => ctx.ui.openPanel('saveLoad', { mode: 'load' }), { icon: '📂', disabled: listSlots().length === 0 }),
          button('Importuj z pliku', () => void importAndStart(ctx), { icon: '⬆' }),
          button('Ustawienia', () => ctx.ui.openPanel('settings'), { icon: '⚙️' }),
        ),
        h('div', { class: 'ig-main-footer' }, hasSlot(AUTOSAVE_SLOT) ? 'Autozapis dostępny' : ' '),
      ),
    );
  };

  const show = (): void => {
    render();
    menu.style.display = '';
  };
  const hide = (): void => {
    menu.style.display = 'none';
  };
  ctx.bus.on('game:started', hide);
  ctx.bus.on('game:ended', () => setTimeout(show, 0));
  show();
}
