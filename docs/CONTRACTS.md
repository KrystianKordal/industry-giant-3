# Industry Giant 3 — kontrakty modułów (CONTRACTS)

Dokument dla agentów pracujących równolegle. Czytaj w całości przed pierwszą zmianą.
Kod: TypeScript strict, Vite, Canvas 2D, vanilla DOM (bez Reacta), Vitest. **Żadnych zależności runtime.**
Tekst w grze / UI: **po polsku**. Komentarze w kodzie: angielski lub polski.

Komendy: `npm run dev` · `npm run typecheck` · `npm test` · `npm run build`.
Dev: `http://localhost:5173/?autostart&seed=123&size=64` od razu startuje grę; w konsoli `window.ig3` = `GameContext`.

---

## 1. Własność katalogów

| Agent | Katalogi (tylko te edytujesz) |
|---|---|
| **Dane + ekonomia** | `src/data/**`, `src/economy/**` |
| **Świat + miasta** | `src/world/**` |
| **Logistyka** | `src/logistics/**` (w tym własne narzędzia: `src/logistics/tools/**`) |
| **Renderowanie** | `src/render/**` |
| **UI** | `src/ui/**`, `src/input/**`, `src/styles.css`, `index.html` |
| **AI / gra / audio** | `src/ai/**`, `src/game/**`, `src/audio/**` |
| Fundament (wspólne) | `src/core/**`, `src/main.ts`, `docs/CONTRACTS.md` |

**Nie edytuj cudzych katalogów.** Czytać/importować publiczne API wolno (preferuj `ctx.*`).
Jeśli potrzebujesz zmiany w `core/`: zrób ją **minimalną i addytywną** (nowe pole opcjonalne / nowe zdarzenie / nowa metoda), nie łam istniejących sygnatur, i **dopisz wpis do Changelogu** na końcu tego pliku.
Własny CSS modułu: `src/<dir>/<dir>.css` importowany z jego `index.ts`; używaj zmiennych z `styles.css` (`--panel`, `--accent`, `--text-dim`…) i klas `.ig-*`.
Testy: obok kodu jako `*.test.ts` (środowisko `node`; do systemów użyj `createContext({ headless: true })`).

---

## 2. Wzorzec init

Każdy katalog ma `index.ts` z `export function init(ctx: GameContext): void`. Woła je **tylko** `main.ts`, raz, przy starcie (zanim powstanie jakakolwiek gra), w kolejności:
`world → economy → logistics → ai → game → render → input → ui → audio`.

`init` wyłącznie **rejestruje**: systemy, kroki nowej gry, usługi, warstwy, narzędzia, panele, przyciski, nasłuchy zdarzeń. Nie tworzy stanu gry.
Stan zależny od gry (cache ścieżek itp.) buduj w `ctx.bus.on('game:started', …)` i czyść w `'game:ended'`.

`GameContext` (`core/context.ts`):
- `bus` – EventBus (§5), `data` – `DataRegistry` (defs), `sim` – pętla (§4)
- `services` – usługi międzymodułowe (§6), `newGame` – kroki nowej gry (§3)
- `renderer`, `ui`, `input` – API przeglądarkowe (w trybie headless to no-op stuby)
- `state` – aktualny `GameState` (**rzuca**, gdy brak gry; w UI sprawdź `ctx.hasGame`), `tryState()`
- `userSettings` – preferencje użytkownika (poza zapisem gry; `core/settings.ts`)

---

## 3. Stan gry (`core/types.ts`) i nowa gra

- **Jeden serializowalny obiekt `GameState`**: tylko dane (obiekty, tablice, liczby, stringi, bool, null) **+ typed arrays** (kodowane przez `save.ts`). Zakaz: klasy, funkcje, `Map`, `Set`, `Date`, referencje DOM.
- Encje w `Record<id, Entity>`; id liczbowe ≥ 1, `0` = brak. Nowe id: `newId(state, 'building' | 'vehicle' | …)` (`core/util.ts`).
- Encje twórz **fabrykami** z `core/entities.ts` (`createBuildingRecord`, `createVehicleRecord`, `createRouteRecord`, `createCityRecord`, `createCompany`) – dzięki temu nowe pola dostają domyślne wartości. `addBuilding/removeBuilding` utrzymują `map.building`.
- Mapa = struct-of-arrays, indeks `idx = y * width + x` (`tileIndex`, `tileXY`). Drogi/tory w `state.network` (nie w `map.flags`).
- Magazyn towarów: `Stock = { [productId]: { qty, quality } }`, jakość 0..1 (0.5 = standard). Operacje: `addStock / takeStock / moveStock / stockQty` (mieszają jakość).
- Historie miesięczne: tablice `number[]`, najstarsze pierwsze, `pushHistory(arr, v)` (limit `HISTORY_MONTHS`).
- Modyfikatory firmy: `company.modifiers["<efekt>.<cel>"]` (np. `efficiency.factory`, `speed.rail`, `upkeep.vehicles`), czytaj przez `getModifier(company, key)` (fallback `<efekt>.all`, potem 1).
- Prywatne trwałe dane modułu, które nie pasują do typów: `state.ext.<katalog>` (plain data). Rozszerzanie typów w `types.ts` jest dozwolone (addytywnie + changelog) – preferowane dla danych, które czytają inni.
- Pieniądze: **tylko** `addMoney(ctx, companyId, ±kwota, kategoria)` / `trySpend` (`core/money.ts`) – księguje w `finances.current.ledger` i emituje `cash:changed`. Zamknięcie miesiąca (przeniesienie do `history`, podatki, wycena) robi ekonomia.
- Komunikaty dla gracza: `notify(ctx, { level, title, text, target, companyId, category })` (`core/notify.ts`) – zapisuje do `state.notifications` i pokazuje toast.
- Losowość w symulacji: **tylko** `rng(state.rng)` (`core/rng.ts`). Generatory osobnym strumieniem: `rng(createRng(hashSeed(seed, 'nazwa')))`. `Math.random` zabronione w systemach.

**Nowa gra** (`core/state.ts`, `core/lifecycle.ts`): `createEmptyState(options)` (mapa trawą, firma gracza, rynek po cenach bazowych) → `ctx.state` ustawione → kroki `ctx.newGame.register(name, order, fn)` w kolejności → `game:new` → `game:started` → start sim.

| order | nazwa | właściciel |
|---|---|---|
| 100 | `mapgen` (teren, złoża, rzeki; **core ma placeholder – nadpisz tą samą nazwą**) | świat |
| 200 | `cities` | świat |
| 250 | `weather` | świat |
| 300 | `market` (+ odblokowania) | ekonomia |
| 400 | `companies` (dodatki dla gracza) | ekonomia |
| 450 | `ai` (rywale) | AI |
| 500 | `scenario` (cele, nadpisania) | gra |

Stałe: `NewGameStepOrder`. Rejestracja pod istniejącą nazwą **zastępuje** krok.

---

## 4. Symulacja (`core/sim.ts`)

- Fixed step: `TICKS_PER_DAY = 10`, 1 dzień ≈ 1 s przy 1×; miesiąc = 30 dni, rok = 12 mies. Pory roku: 3–5 wiosna, 6–8 lato, 9–11 jesień, 12–2 zima.
- `ctx.sim.registerSystem(name, order, (state, dt, ctx) => …, { period })` – `period`: `'tick'` (dt = 0.1 dnia, domyślnie), `'day'` (dt = 1), `'month'` (dt = 30), `'year'`. Ta sama nazwa = zastąpienie.
- W każdym ticku: najpierw kalendarz, potem systemy rosnąco wg `order`, potem zdarzenia `time:*`. Systemy `day/month` widzą **już nową datę** (miesiąc, który się zamknął, to poprzedni).
- Kolejność (`SystemOrder`): era 50 · weather 100 · events 150 · workforce 200 · production 300 · logistics 400 · market 500 · cities 550 · ecology 600 · research 700 · finance 800 · ai 900 · goals 1000 · advisor 1050 · stats 1100.
- Sterowanie: `setSpeed(1|2|4)`, `setPaused`, `togglePause`, `step(n)`, `advanceDays(d)` (testy), `alpha` (interpolacja renderu). Systemy rdzenia: `core.era` (epoka z kalendarza), `core.stats.*` (serie w `state.stats`), autozapis.
- System, który rzuci wyjątek, jest logowany i pomijany (w testach `ctx.sim.throwOnError = true`).

---

## 5. Zdarzenia (`core/events.ts` – pełna lista z typami ładunków)

Emisja `ctx.bus.emit(nazwa, payload)`, nasłuch `const off = ctx.bus.on(nazwa, fn)`. Synchroniczne.
- cykl gry: `game:new`, `game:loaded`, `game:started` (oba przypadki), `game:ended`, `game:beforeSave`, `game:saved`, `game:won`, `game:lost`
- czas: `time:tick` (tanio!), `time:day`, `time:month`, `time:year`, `time:season`, `time:speed`, `era:changed`
- mapa: `map:changed {x,y,w,h}` (render unieważnia chunki), `network:changed {kind, tiles}`
- budynki: `building:built`, `building:completed`, `building:removed`, `building:changed`, `building:statusChanged`, `building:produced`
- transport: `vehicle:bought|sold|arrived|delivered|broken`, `route:created|changed|removed`
- ekonomia: `cash:changed`, `sale`, `market:updated`, `company:created|bankrupt`, `research:started|completed`
- świat: `city:founded`, `city:grew`, `worldEvent:started|ended`, `weather:changed`
- gra: `goal:completed|failed`, `milestone`, `advisor:tip`
- UI/feedback: `notify` (przez `notify()`), `sfx {id,x?,y?}`, `select` (Selection), `hover`, `tool:changed`, `camera:changed`, `camera:focus {x,y,zoom?}` (każdy może poprosić o przesunięcie kamery), `overlay:changed`, `panel:opened|closed`, `settings:changed`

**Kto modyfikuje mapę/sieć, ten emituje `map:changed` / `network:changed`** (inaczej render nie odświeży cache).

---

## 6. Usługi (`core/services.ts`)

Wywołania gameplayowe między modułami idą przez `ctx.services.<nazwa>.<metoda>(…)` i działają na bieżącym `ctx.state`, zwracając `ActionResult = {ok:true, cost, …} | {ok:false, reason}` (reason po polsku).
- `economy` (ekonomia): `checkPlacement, build, demolish, setRecipe, price, isUnlocked, startResearch, takeLoan, repayLoan, companyValue, acquireBuilding`
- `logistics` (logistyka): `buildNetwork, removeNetwork, estimateNetwork, planNetworkPath, findPath, isConnected, createRoute, updateRoute, removeRoute, buyVehicle, sellVehicle, assignVehicle, autoConnect`
- `world` (świat): `cityAt, nearestCity, regionAt, isBuildableTile`
- `game` (gra): `scenarios, currentHint`; `audio` (audio): `unlock, play, setMusic, applySettings`

Właściciel podmienia implementację w `init`: `ctx.services.logistics = createLogisticsService(ctx)` albo `Object.assign(ctx.services.economy, {...})`. Domyślne fallbacki: `economy.build/demolish/checkPlacement/setRecipe/price/isUnlocked` i `world.*` **działają** (prosto); reszta zwraca „Niezaimplementowane”. AI i UI **działają wyłącznie przez usługi** (nie duplikuj reguł budowy).
Zmiana sygnatury = zmiana kontraktu → changelog.

---

## 7. Render (`src/render`)

- `Renderer` (rAF, niezależny od sim) + `Camera` (top-down, `TILE_SIZE = 32` px świata na kafel przy zoomie 1, zoom 0.125–4, clamp do mapy). Helpery: `screenToWorld`, `screenToTile`, `worldToScreen`, `tileToScreen`, `zoomAt`, `panBy`, `centerOnTile`, `visibleTiles`.
- Warstwy: `ctx.renderer.registerLayer({ id, z, space?: 'world'|'screen', visible?(rc), draw(rc), invalidate?(rect) })`. W `world` 1 jednostka = 1 px świata (kafel `x*TILE_SIZE`). Rysuj tylko `rc.view` (widoczne kafle). Ta sama `id` zastępuje warstwę.
- Z-index: 0 teren · 5 dekale/złoża · 10 sieć · 20 domy · 30 budynki · 40 pojazdy · 50 efekty · 60 nakładki · 70 etykiety · 80 zaznaczenie · 90 podgląd narzędzia (input) · 100 hover (input) · 1000+ screen/debug.
- Cache: `ChunkCache` (32×32 kafle na offscreen canvas, przerysowanie tylko po `invalidate`). Pojazdy interpoluj `lerp(prevX, x, rc.alpha)`.
- Nakładki: `ctx.renderer.setOverlay(id|null)` → `renderer.overlay`, `state.view.overlay`, `overlay:changed`; warstwa nakładki sprawdza `rc.ctx.renderer.overlay` w `visible`.
- Obecne warstwy `terrain`, `network`, `houses`, `buildings`, `vehicles`, `grid`, `fps` to **placeholdery** – render agent je zastępuje.

## 8. Wejście (`src/input`)

- `ctx.input.registerTool({ id, name, cursor?, activate?, deactivate?, pointerDown/Move/Up?, click?, keyDown?, cancel?, drawPreview?(rc), hint? })`; `ctx.input.setTool(id | null, args?)` (null → `inspect`).
- Zdarzenia narzędzia mają `tx,ty` (kafel), `fx,fy`, `sx,sy`, `button`, modyfikatory, `inMap`, `dragStart`. `click` = lewy bez przeciągania.
- Esc / prawy klik bez ruchu → `tool.cancel()`; jeśli zwróci `true` narzędzie zostaje, inaczej powrót do `inspect`; w `inspect` Esc zamyka górne okno.
- Kamera: prawy/środkowy drag (w `inspect` także lewy), kółko = zoom do kursora, WASD/strzałki (Shift = szybciej), opcjonalnie krawędź ekranu. **W, A, S, D, spacja, 1–3, G, Esc są zajęte.**
- Skróty: `ctx.input.registerHotkey({ key: 'b' | 'ctrl+s' | 'shift+r' | 'f1', description, handler })`. Ignorowane podczas pisania w polach.
- `inspect` emituje `select` (pojazd → budynek → miasto → kafel).

## 9. UI (`src/ui`)

- Panele: `ctx.ui.registerPanel({ id, title, icon?, width?, position?, key?(args), refreshMs?, create(p, ctx) })`; w `create` buduj w `p.body`, ustaw `p.onUpdate` (co `refreshMs`, domyślnie 500 ms) i `p.onClose` (odsubskrybuj). `openPanel(id, args)`, `closePanel`, `togglePanel`, `isPanelOpen`, `refreshPanel`. Panel z `key(args)` = wiele instancji (np. inspektor na budynek).
- Pasek dolny: `ctx.ui.registerToolbarButton({ id, icon, label, group, order?, tooltip?, hotkey?, onClick(ctx), isActive?(ctx) })`; grupy: `raw, factory, shop, logistics, transport, special, manage, view`.
- Górny pasek: `ctx.ui.registerHudItem({ id, side: 'left'|'center'|'right', order?, create(el, ctx), update?(el, ctx) })`.
- Toasty: `ctx.ui.toast({...})` (lub `notify()` dla trwałych).
- Klocki: `ui/dom.ts` (`h()`, `setChildren`, `setText`), `ui/components.ts` (`button, tabs, table, progressBar, statRow, section, confirmDialog`), `ui/charts.ts` (`sparkline, drawSparkline, lineChart`), `ui/tooltip.ts` (`tooltip(el, textOrFn)`), `ui/ui.ts` (`createWindow`).
- Istniejące panele: `gameMenu`, `saveLoad {mode}`, `settings`, `inspector` (**placeholder**, UI agent zastępuje), menu główne (`ui/mainMenu.ts`; przycisk „Kampania” otwiera panel `campaign` – rejestruje go moduł gry).
- Formatowanie po polsku: `core/format.ts` (`formatMoney`, `formatNumber`, `formatPercent`, `formatDate`, nazwy miesięcy/pór roku).

## 10. Dane (`src/data`)

Typy w `data/defs.ts` (`ProductDef, RecipeDef, BuildingDef, VehicleDef, TechDef, EraDef, DepositDef, TerrainDef, ModPack`). Rejestr `data/registry.ts` (`ctx.data`): `product(id)`, `building(id)`… (rzucają dla nieznanego id), rekordy `products[id]` (bezpieczny odczyt), listy, `recipesFor`, `recipesProducing`, `eraForYear`, `mergeMod(pack)`, `validate()`. Defs są **niemutowalne** w runtime. Pliki danych obecnie to placeholdery (zboże → mąka → chleb, farma/młyn/piekarnia/sklep, wóz/ciężarówka/parowóz). Nowe pola w defs tylko opcjonalne. Mody: `ModPack` JSON (to samo id = zastąpienie); aktywne mody zapisywane w `state.mods`.

## 11. Zapis (`core/save.ts`)

- Format: JSON `{ format: 'ig3-save', version, savedAt, info, state }`, typed arrays jako `{ $ta, b64 }`, w localStorage gzip+base64 (`gz:` prefix). Sloty `slot1..6` + `auto`; eksport `.ig3save`.
- `SAVE_VERSION` w `core/constants.ts`. Zmiana kształtu stanu łamiąca stare zapisy → podbij wersję i `registerMigration(staraWersja, s => {...})`. Dodanie pola z sensownym defaultem: dopisz migrację uzupełniającą albo czytaj defensywnie.
- Przed zapisem leci `game:beforeSave` – dopisz tam bieżące dane do stanu. Po wczytaniu `game:loaded` → odbuduj cache.
- Stan musi przejść `serialize → deserialize` bez strat (test `core/save.test.ts`).

## 12. Wydajność

- Mapa do 256×256 (65 536 kafli), 300 pojazdów, 60 FPS. Pola per kafel = typed arrays (nie obiekty na kafel). Nie iteruj całej mapy co tick – co dzień/miesiąc lub przyrostowo.
- `time:tick` i systemy `'tick'` muszą być tanie (O(pojazdy), nie O(kafle)).
- Render: tylko `rc.view`; statykę cache'uj (`ChunkCache`); unikaj alokacji w pętlach rysowania.
- Brak `Object.values(state.buildings)` w gorących pętlach per kafel – buduj indeksy w module (runtime cache, nie w stanie).

## 13. Konwencje

- Pliki `camelCase.ts`, typy `PascalCase`, stałe `UPPER_SNAKE`, id danych `snake_case` (`iron_ore`, `farm_grain`), zdarzenia `domena:akcja`, systemy/kroki: nazwa katalogu lub `katalog.podsystem`.
- Importy typów: `import type`. Bez `any` (użyj `unknown`). Bez zależności runtime.
- Teksty dla gracza po polsku, z polskimi znakami. Ikony: emoji.

---

## Changelog kontraktu

| Data | Autor | Zmiana |
|---|---|---|
| Etap 0 | fundament | Wersja początkowa: GameState v1, sim, bus, services, render/input/ui API. |
