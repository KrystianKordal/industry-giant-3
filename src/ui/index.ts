/**
 * ui module init. The UiManager instance is created by main.ts and exposed as
 * ctx.ui; here we install HUD, toolbar (build menu, overlays), minimap, hints,
 * main menu and all core panels + UI hotkeys.
 * Owner: UI agent. See docs/CONTRACTS.md "UI — API".
 *
 * UI hotkeys (reserved by UI): F1/H help · B build · C dashboard · J chains ·
 * I research · U routes · E encyclopedia · P blueprints · N notifications ·
 * M minimap · O / Shift+O overlays · Ctrl+S save · + / − zoom.
 */
import type { GameContext } from '../core/context';
import { installBuildMenu } from './buildMenu';
import { installHints } from './hints';
import { installHud } from './hud';
import { installMainMenu } from './mainMenu';
import { installMinimap } from './minimap';
import { installOverlays } from './overlays';
import { chainPanel } from './panels/chainView';
import { dashboardPanel, routesPanel } from './panels/dashboard';
import { encyclopediaPanel } from './panels/encyclopedia';
import { inspectorPanel } from './panels/inspector';
import { blueprintsPanel, helpPanel, notificationsPanel } from './panels/misc';
import { researchPanel } from './panels/research';
import { routePanel } from './panels/routeEditor';
import { gameMenuPanel, saveLoadPanel } from './panels/saveLoad';
import { settingsPanel } from './panels/settings';
import type { ToolbarButtonDef } from './types';
import { UiManager } from './ui';

export function init(ctx: GameContext): void {
  const ui = ctx.ui;
  if (!(ui instanceof UiManager)) return; // headless
  for (const p of [
    saveLoadPanel,
    gameMenuPanel,
    settingsPanel,
    inspectorPanel,
    routePanel,
    routesPanel,
    dashboardPanel,
    researchPanel,
    chainPanel,
    encyclopediaPanel,
    notificationsPanel,
    blueprintsPanel,
    helpPanel,
  ])
    ui.registerPanel(p);

  installHud(ctx, ui);
  const build = installBuildMenu(ctx, ui);
  installOverlays(ctx, ui);
  installMinimap(ctx, ui);
  installHints(ctx, ui);
  installMainMenu(ctx, ui);

  ctx.bus.on('select', (sel) => {
    if (sel.kind === 'none') ui.closePanel('inspector');
    else if (sel.kind === 'route') ui.openPanel('route', { routeId: sel.id });
    else ui.openPanel('inspector', sel);
  });

  // ---------------------------------------------------------------- manage group
  const panelBtn = (id: string, icon: string, label: string, order: number, tooltip: string, hotkey: string, panel = id): ToolbarButtonDef => ({
    id,
    icon,
    label,
    group: 'manage',
    order,
    tooltip,
    hotkey: hotkey.toUpperCase(),
    onClick: (c) => c.ui.togglePanel(panel),
    isActive: (c) => c.ui.isPanelOpen(panel),
  });
  const manage: [ToolbarButtonDef, string, string][] = [
    [panelBtn('dashboard', '📊', 'CEO', 0, 'Panel CEO: finanse, KPI, kredyty, konkurencja', 'c'), 'c', 'Panel CEO'],
    [panelBtn('chains', '🔗', 'Łańcuchy', 10, 'Widok łańcuchów produkcji i wąskich gardeł', 'j'), 'j', 'Widok łańcuchów produkcji'],
    [panelBtn('routes', '🛣️', 'Trasy', 15, 'Lista tras i pojazdów', 'u'), 'u', 'Lista tras'],
    [panelBtn('research', '🔬', 'Badania', 20, 'Drzewo technologii', 'i'), 'i', 'Badania'],
    [panelBtn('blueprints', '📐', 'Blueprinty', 30, 'Zapisane układy budynków', 'p'), 'p', 'Blueprinty'],
    [panelBtn('encyclopedia', '📖', 'Wiedza', 40, 'Encyklopedia produktów, budynków i technologii', 'e'), 'e', 'Encyklopedia'],
  ];
  for (const [def, key, desc] of manage) {
    ui.registerToolbarButton(def);
    ctx.input.registerHotkey({ key, description: desc, handler: (_e, c) => def.onClick(c, new MouseEvent('click')) });
  }

  // ---------------------------------------------------------------- view group
  ui.registerToolbarButton({
    id: 'inspect',
    icon: '🔍',
    label: 'Inspekcja',
    group: 'view',
    order: 0,
    tooltip: 'Narzędzie inspekcji (klik = szczegóły obiektu)',
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
    tooltip: 'Siatka kafli',
    onClick: (c) => {
      c.userSettings.showGrid = !c.userSettings.showGrid;
      c.bus.emit('settings:changed', {});
    },
    isActive: (c) => c.userSettings.showGrid,
  });

  // ---------------------------------------------------------------- hotkeys
  const help = (): void => ui.togglePanel('help');
  ctx.input.registerHotkey({ key: 'f1', description: 'Pomoc i skróty', inGame: false, handler: help });
  ctx.input.registerHotkey({ key: 'h', description: 'Pomoc i skróty', handler: help });
  ctx.input.registerHotkey({ key: 'b', description: 'Menu budowy', handler: () => build.toggle() });
  ctx.input.registerHotkey({ key: 'n', description: 'Powiadomienia', handler: () => ui.togglePanel('notifications') });
  ctx.input.registerHotkey({ key: 'ctrl+s', description: 'Zapisz grę', handler: () => ui.openPanel('saveLoad', { mode: 'save' }) });
}
