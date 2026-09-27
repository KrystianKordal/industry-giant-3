/**
 * ui module init. The UiManager instance is created by main.ts and exposed as
 * ctx.ui; here we install HUD, main menu and core panels.
 * Owner: UI agent.
 */
import type { GameContext } from '../core/context';
import { installHud } from './hud';
import { installMainMenu } from './mainMenu';
import { inspectorPanel } from './panels/inspector';
import { gameMenuPanel, saveLoadPanel } from './panels/saveLoad';
import { settingsPanel } from './panels/settings';
import { UiManager } from './ui';

export function init(ctx: GameContext): void {
  const ui = ctx.ui;
  if (!(ui instanceof UiManager)) return; // headless
  ui.registerPanel(saveLoadPanel);
  ui.registerPanel(gameMenuPanel);
  ui.registerPanel(settingsPanel);
  ui.registerPanel(inspectorPanel);
  installHud(ctx, ui);
  installMainMenu(ctx, ui);

  ctx.bus.on('select', (sel) => {
    if (sel.kind === 'none') ui.closePanel('inspector');
    else ui.openPanel('inspector', sel);
  });

  ui.registerToolbarButton({
    id: 'inspect',
    icon: '🔍',
    label: 'Inspekcja',
    group: 'view',
    order: 0,
    tooltip: 'Narzędzie inspekcji',
    hotkey: 'Esc',
    onClick: (c) => c.input.setTool(null),
    isActive: (c) => c.input.activeToolId === 'inspect',
  });
  ui.registerToolbarButton({
    id: 'grid',
    icon: '▦',
    label: 'Siatka',
    group: 'view',
    order: 10,
    hotkey: 'G',
    onClick: (c) => {
      c.userSettings.showGrid = !c.userSettings.showGrid;
    },
    isActive: (c) => c.userSettings.showGrid,
  });
}
