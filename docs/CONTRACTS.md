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
- Pełne warstwy, nakładki, pomocniki podglądu i efekty: **§20 „Renderowanie — API”**.

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

Typy w `data/defs.ts` (`ProductDef, RecipeDef, BuildingDef, VehicleDef, TechDef, EraDef, DepositDef, TerrainDef, ModPack`). Rejestr `data/registry.ts` (`ctx.data`): `product(id)`, `building(id)`… (rzucają dla nieznanego id), rekordy `products[id]` (bezpieczny odczyt), listy, `recipesFor`, `recipesProducing`, `eraForYear`, `mergeMod(pack)`, `validate()`. Defs są **niemutowalne** w runtime. Pełny zestaw danych (5 epok, ~64 produkty, ~70 budynków, 18 pojazdów, 37 technologii, 9 złóż) — szczegóły w §19. Nowe pola w defs tylko opcjonalne. Mody: `ModPack` JSON (to samo id = zastąpienie); aktywne mody zapisywane w `state.mods`.

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

## 14. Świat — API (`src/world`)

**Kroki nowej gry:** `mapgen` (100) → `cities` (200, na końcu pass „fairness”) → `weather` (250). **Systemy:** `weather` (day, 100), `events` (day, 150), `cities` (month, 550).

**Mapa (mapgen)** — deterministyczna dla `seed` + opcji + listy złóż; 256×256 < 300 ms.
- `map.elevation`: woda `0..seaLevel-1`, ląd `seaLevel..255`; `map.seaLevel = 50`. `map.climate` = dominujący klimat.
- Rzeki = `TileFlag.River` na kaflach lądu (4-spójne, spływają do morza/jeziora/krawędzi). Jeziora = `Terrain.Water` niepołączona z krawędzią. `TileFlag.Coast` = ląd przy dowolnej wodzie.
- `fertility` 0..255 (równiny 95–255, bonus przy rzekach), `forest` 0..255.
- Złoża: generycznie dla **każdego** `DepositDef` z rejestru (sort. po id); `terrain` = dozwolone tereny (woda tylko jeśli wymieniona). Opcjonalne pola defa czytane defensywnie: `clusterSize` (śr. kafli w złożu, dom. 9), `clusters` (liczba na mapę 128², nadpisuje `frequency`). Jakość = szum regionalny + los złoża.
- Fairness: każde złoże, którego produkt jest z epoki startowej (lub wcześniejszej), leży ≤ 16 kafli od ≥ 2 miast (ten sam ląd); każde miasto ma żyzne równiny w promieniu 12.

**Miasta** — liczba = `round(cityCount × (0.55 + 0.45·√(W·H)/128))`, 6–14 (gdy `cityCount ≥ 6`). Ulice: publiczne drogi (`network.owner = 0`) w siatce co 3 kafle od centrum; domy na `Terrain.Urban` z `map.house` 1..5 (pojemność 60/150/320/650/1300 osób), `map.city` = obszar miasta (promień+1). Miasto nie zabudowuje: budynków, torów, `Blocked/Damaged`, `Farmland`, złóż, rzek (ulica przez rzekę = `TileFlag.Bridge`). Budynek/droga postawione na domu go usuwają (świat nasłuchuje `building:built`, `network:changed`). Świat emituje `map:changed` / `network:changed` przy rozbudowie.
- **Kontrakt popytu (sklepy ekonomii):** `city.demand[pid].monthly` = jednostki/mies.; sklep **dodaje** sprzedaż do `suppliedMonth` i `shareByCompany[companyId]`; `price` = cena lokalna (rynek × niedobór × zamożność). System `cities` (miesięcznie, po `market` 500) zamyka miesiąc: `satisfaction` = EMA(supplied/monthly), `history`, potem **zeruje** `suppliedMonth` i `shareByCompany`. Popyt: tylko produkty z `consumption` i epoką ≤ bieżącej; × preferencje miasta (0.75–1.25, `city.preferences`) × `seasonal[miesiąc]` × starzenie produktów (−15%/epokę po 1 epoce) × zielone × efekty zdarzeń. Odświeżany co miesiąc, przy `era:changed`, `game:new` i zdarzeniach z `demand.*`.
- Zadowolenie = 0.22 + 0.6·zaopatrzenie (ważone wartością, żywność ×1.4) + 0.1·praca (`labour.employed`/(30% workforce), zapisuje ekonomia) − zanieczyszczenie + zdarzenia. Wzrost/mies. = (zadowolenie − próg[trudność 0.26/0.30/0.34]) × 0.035 (spadek ×0.5). Klasy dryfują do udziałów epoki, przechylonych zadowoleniem. `labour.workforce/wage/skill/commuteRadius`, `greenPreference`, `tier` (wieś <2.5k, miasteczko <12k, miasto <60k, metropolia) — pisze świat. Historie: `city.history.*`, `stats.monthly["city.<id>.population"]`. Zdarzenie `city:grew` co miesiąc przy wzroście; `notify` przy awansie `tier`.

**Pogoda** — `state.weather.regions[r]` aktualizowane codziennie (klimat regionu z szerokości + składu terenu; temperatura sezonowa, rodzaj pogody na 1–7 dni, `drought` 0..1 rośnie w suche ciepłe dni, spada po deszczu). `kind === 'storm'` = sztorm (logistyka blokuje statki/drony). `weather:changed` gdy zmienia się rodzaj.

**Zdarzenia świata** (`state.events.active`, `WorldEvent`) — losowane co ~40–80 dni (÷ `easy 0.7 / hard 1.4`), `disasters` / `politicalEvents` z opcji; cooldowny w `events.cooldowns`. Zasięg: `companyId` (tylko ta firma), `cityId`, `area`, `regionIds`; brak = globalne. Klucze `effects`:
| klucz | typ | kto stosuje |
|---|---|---|
| `efficiency.<cel>` (`farm`, `all`, …) | × | ekonomia (budynki w zasięgu) |
| `speed.water/road/rail/air` (0 = stop) | × | logistyka |
| `demand.all / demand.<pid> / demand.<kategoria>`, `growth`, `wages.all` | × | świat (popyt/miasta) |
| `price.all / price.<pid>`, `economy` (boom/recesja → `market.economyFactor`), `emissionCap` | × | ekonomia |
| `satisfaction` | + | świat |
| `carbonTax` (zł/jedn. CO₂), `subsidy.<pid>` (ułamek przychodu) | + | ekonomia (lustrzane wpisy w `ecology.regulations`, id `ev-<eventId>`) |

Rodzaje: `storm` (zawsze z `area`), `flood`, `earthquake`, `fire`, `heatwave`, `blizzard`, `drought` (z pogody), `strike` (`cityId`+`companyId`), `boom`, `recession`, `priceShock`, `subsidy`, `carbonTax`, `emissionNorm`, `epidemic`, `festival`. Szkody: `building.condition` ↓ (+ `building:changed`), drogi/tory `TileFlag.Damaged` (auto-naprawa po 15–40 dniach, `state.ext.world.repairs`), domy tracą gęstość, las płonie. Każde zdarzenie → `notify` (kategoria `event`) + `worldEvent:started/ended`.

**Usługi `ctx.services.world`:** `cityAt`, `nearestCity(x,y,maxDist?)`, `regionAt`, `isBuildableTile` (teren + brak budynku/drogi/toru/domu/Blocked), `tilesInRadius(x,y,r)`, `terrainCost(x,y,'road'|'rail')` (networkCost × nachylenie × rzeka/most ×3/×4 × tory w mieście ×2; woda = ∞), `weatherAt(x,y)`, `modifierAt(key,x?,y?)` = pogoda × zdarzenia (np. `speed.water` 0 = zablokowane, `efficiency.farm`, `season.farm`). Eksporty modułu (`src/world/index.ts`): `modifierAt`, `isWaterBlocked`, `eventModifier/eventAdditive/eventApplies`, `weatherAt/weatherModifier`, `WEATHER_NAMES/ICONS`, `TIER_NAMES`, `rollWorldEvent` (debug/scenariusze).

**Stan prywatny:** `state.ext.world = { rng, repairs }` (osobny strumień RNG pogody/zdarzeń — nie rusza `state.rng`). Zanieczyszczenie (`map.pollution`) świat tylko czyta (dyfuzja/zanik = ekonomia).

---

## 15. AI — API (`src/ai`)

- Krok nowej gry `ai` (450): tworzy `options.rivals` firm AI (`Company.ai: AIState`), nazwy/kolory/logo z `ai/profiles.ts`, osobowości (`balanced, aggressive, cautious, industrialist, merchant, green`) × trudność = `options.difficulty` (easy/normal/hard: częstotliwość myślenia, liczba projektów, szum ocen, balans łańcuchów). `company.hq` = rejon domowy. Emituje `company:created`. Scenariusz może wołać `createRivals(state, options, ctx, specs)`.
- System `ai` (900, `day`): każda firma myśli co `thinkDays × tempo` dni, łączny budżet **8 ms/dzień** (reszta następnego dnia). Pętla: utrzymanie planów (odbudowa utraconych budynków, `setRecipe`, połączenia `logistics.autoConnect` → fallback `planNetworkPath + buildNetwork + createRoute + buyVehicle`, dokupowanie pojazdów gdy wyjście >60% pojemności), finanse (`takeLoan/repayLoan`), badania (`startResearch`), nowy projekt (ocena łańcuchów z rejestru: `ai/analysis.ts`, wybór miasta z niezaspokojonym popytem, rozmieszczenie surowiec → fabryka → sklep przez `economy.checkPlacement/build`), obsługa kryzysu (sprzedaż pojazdów, rozbiórka strat), bankructwo.
- **Pieniądze**: AI nie tworzy pieniędzy — płaci wyłącznie przez usługi. Jedyny bezpośredni zapis w stanie: `shop.priceFactor` własnych sklepów (+ `building:changed`) i `research.budget` własnej firmy. Każde wywołanie usługi jest w try/catch (stuby/wyjątki nie wywracają symulacji).
- Plany w `company.ai.plans` (`kind: 'chain'`, params: `product, city, spec (JSON), ids[], linked[], routes[], est, capital`).
- Bankructwo: `company:bankrupt` (od ekonomii lub fallback AI po roku głęboko pod kreską) → AI sprzedaje pojazdy, usuwa trasy, budynki są **na sprzedaż za ~50%** przez 180 dni, potem rozbiórka.
- Ekonomia może podpiąć własny model zysku: `setProfitEstimator(fn)` z `ai/analysis.ts`.
- **Usługa `ctx.services.ai`** (nowa, `core/services.ts`):
  - `buildingPrice(buyerId, buildingId): number | null` — cena przejęcia (null = nie na sprzedaż; budynki gracza nigdy nie są sprzedawane AI). Wycena: wartość księgowa × stan + 12 × śr. zysk + towary, × premia osobowości (~1,3–1,5); bankrut: 50% księgowej + towary.
  - `buyBuilding(buyerId, buildingId): ActionResult` — płaci (`construction` / `assetSale`), zmienia `owner`, usuwa trasy sprzedawcy przez ten budynek, emituje `building:changed`, `map:changed`, `sfx cash`.
  - **UI (inspektor)**: dla budynku rywala pokaż przycisk „Przejmij” → `ctx.ui.openPanel('takeover', { buildingId })` (albo wywołaj usługę bezpośrednio). `economy.acquireBuilding` może delegować do `ai.buyBuilding` dla budynków AI.
- Panele: `rivals` (lista rywali, ich budynki i przejęcia; przycisk paska `rivals` w grupie `manage`), `takeover { buildingId }`.

## 16. Gra — API (`src/game`)

- Krok nowej gry `scenario` (500): gdy `options.mode === 'campaign'` i `options.scenarioId` → warunki startowe scenariusza, cele (`state.goals.objectives`), samouczek (`state.advisor.tutorialStep = 0`). W sandboxie cele puste (tylko kamienie milowe). Prywatne liczniki: `state.ext.game` (`produced, sold, soldCity, shareMonth/shareLast, recycled, greenSold, meta, startPopulation, startDay…`) — zasilane zdarzeniami `building:produced` (gracza), `sale` (wszyscy; udział w rynku). **Ekonomia: emituj `building:produced` i `sale`, logistyka/ekonomia: przychód z eksportu księguj w kategorii `export`** — z tego liczone są cele.
- Scenariusze (`game/scenarios.ts`): `bread` (1850, samouczek), `rail` (1900), `rebuild` (1950), `trade` (1990), `digital` (2020). Start: `startScenario(ctx, id)` z `game/index.ts` albo `startNewGame(ctx, services.game.scenarios()[i].options)`. Produkty celów podawane jako listy kandydatów + fallback (odporne na zmiany danych).
- Rodzaje celów (`ObjectiveKind`): `cash, companyValue (services.economy.companyValue), profitMonth (ostatni zamknięty miesiąc), produce, deliver (sprzedane w sklepach; opcjonalnie cityId), supplyCity (city.demand[p].satisfaction; cityId 0 → liczba miast ≥ progu), population, research, buildings (filtr meta: category/buildingTypes/mode = stationMode), vehicles (meta.mode), reputation, ecoRating, marketShare (0..1), custom (routes, exportIncome, recycled, greenSold, rivalsBeaten, populationGrowth)`.
- System `goals` (1000, `day`): postęp, nagrody (`addMoney … 'subsidy'`), terminy, `goal:completed/failed`; wygrana = wszystkie wymagane cele → `game:won` + pauza + panel `scenarioResult`; porażka = wymagany cel po terminie albo bankructwo gracza (`company:bankrupt`) → `game:lost`. System `goals.milestones` (co 5 dni) → `state.goals.milestones`, zdarzenie `milestone`.
- Postęp kampanii: localStorage `ig3.campaign` (`{ completed: {id: {days, date}} }`); scenariusz odblokowany, gdy poprzedni ukończony.
- Doradca (system `advisor`, 1050, `day`, analiza co 3 dni): wskazówki przez `notify(category 'advisor')` + `advisor:tip`; dedup `state.advisor.tipsShown` (cooldown per id), limit częstotliwości `lastTipDay`; włącznik `userSettings.advisorEnabled` (przycisk `advisor` w `manage`). `services.game.currentHint()` = najlepsza bieżąca podpowiedź.
- Samouczek: `state.advisor.tutorialStep`, panel `tutorial` (lewa strona), kroki kończą się zdarzeniami (`building:built`, `route:created`, `vehicle:bought`, `sale`) lub przyciskiem „Dalej”. Podświetlenie przycisków: klasa `.ig-tut-highlight` na elementach `[data-id="<id>"]`, `[data-tool]`, `[data-toolbar-id]` (fallback: tekst przycisku). **UI: nadaj przyciskom paska `data-id="<id budynku/narzędzia>"`.** Znacznik na mapie: warstwa `game.tutorial` (z 85).
- Panele: `campaign` (menu główne), `scenarioBriefing` (odprawa, pauzuje grę), `objectives` (cele + kamienie milowe; przycisk `objectives`), `scenarioResult {won, reason}`, `tutorial`. HUD: `goals` (lewa strona, „🎯 2/3”).

## 17. Audio — API (`src/audio`)

- `ctx.services.audio`: `unlock()` (AudioContext tworzony dopiero po geście; moduł sam łapie pierwszy `pointerdown/keydown`), `play(id, {x?, y?, volume?})`, `setMusic(on)`, `applySettings()` (czyta `ctx.userSettings`: master/music/sfx/ambient/muted; też na `settings:changed`).
- `sfx` ids: `click, hover, open, close, build, demolish, road, rail, cash, error, notify, warning, success, research, era, victory, defeat, produce, truck, train, ship` (nieznane ignorowane; limity częstotliwości per id). `x,y` = kafel → głośność zależna od odległości od kamery.
- Muzyka generatywna (pady + bas + arpeggio, modulacje), ambient kontekstowy wg widoku kamery (fabryki, natura/ptaki, miasto, woda; głośniej przy zbliżeniu). Wszystko syntezowane, bez plików.

## 18. Logistyka — API (`src/logistics`)

**Systemy:** `logistics` (tick, 400: ruch, postoje, zajętość kafli), `logistics.daily` (day, 401: starzenie, awarie, koszty pojazdów zbiorczo per firma `vehicleUpkeep`, zanik `network.traffic`), `logistics.monthly` (month, 402: historie `profitHistory`/`throughputHistory` pojazdów i tras, zerowanie liczników miesiąca, utrzymanie dróg/torów `infraUpkeep`). Cache ścieżek w runtime (nie w stanie), czyszczony przy `network:changed`, `building:built|completed|changed|removed`, `game:started`.

**Sieć** (`state.network`):
- `road[i]` 1 gruntowa / 2 utwardzona (epoka ≥1) / 3 autostrada (epoka ≥3); `rail[i]` 1 zwykły / 2 zelektryfikowany (≥2) / 3 KDP (≥3). Właściciel `owner[i]` (0 = publiczne — nie do rozbiórki przez firmy).
- `roadConn` = N|E|S|W do **każdej** sąsiedniej drogi (logistyka przelicza też maski dróg zbudowanych przez innych po `network:changed` kind `road`). `railConn` = tylko wzdłuż narysowanej ścieżki (+ końce odcinka łączą się z sąsiednimi torami) → skrzyżowanie torów bez zwrotnicy. Na razie tylko 4 kierunki (bity ukośne nieużywane).
- Most = kafel wody lub `TileFlag.River` → `TileFlag.Bridge`, musi być prosty, maks. 12 pól, koszt ×6 (droga) / ×8 (tory) dla wody; rzeka = `world.terrainCost` (×3/×4). Koszt lądu = koszt poziomu × `ctx.services.world.terrainCost(x,y,kind)` × las 1.15 × dom 4 (dom usuwa świat). Rozbiórka zwraca 25%. Utrzymanie miesięczne per kafel (mosty ×3), modyfikator `upkeep.infra`.
- Uszkodzone kafle (`TileFlag.Damaged`) są nieprzejezdne; pojazdy przeliczają trasę przy wejściu na zmieniony kafel.

**Dostęp do budynków (tryb transportu):** `road` — każdy budynek, przystanek = kafel drogi przylegający (4-sąsiedztwo) do obrysu. `rail` — `BuildingDef.stationMode === 'rail'` + tory przylegające. `water` — `stationMode 'water'` (lub hub z `requiresWater`) + woda/rzeka przylegająca (także po skosie). `air` — `stationMode 'air'`, lot po prostej między dronoportami (≤ max(40, radius) pól). Stacje rail/water/air obsługują **własne** budynki w `def.radius` (dom. 4) wokół obrysu albo `hub.linked`, jeśli niepuste.

**Towar:** załadunek z `output` (+ `storage` hubów powyżej `hub.reserve`). Rozładunek do `input` (fabryka: wejścia bieżącej receptury; sklep: `sells` / `sellsCategories` / kategorie konsumenckie, filtr `shop.assortment`) albo `storage` (warehouse/station/export z `capacity > 0`, filtr `hub.accept`, limit `hub.limits[p] || def.capacity`, × `level`). Stacja kolejowa/port/dronoport przy rozładunku zasila najpierw odbiorców w zasięgu (wg `Building.priority`), resztę składa w `storage`; przy załadunku bierze `storage` stacji, potem wyjścia budynków w zasięgu. Budynki w budowie nie ładują/nie przyjmują. Rozkaz „załaduj wszystko” bierze tylko produkty, które przyjmie któryś z przystanków rozładunku trasy. Dostawa do budynku **innej firmy** = sprzedaż B2B po cenie rynkowej (kupujący `purchases`, sprzedający `trade`; brak gotówki kupującego = brak dostawy). Do budynku **publicznego** (owner 0, np. centrum eksportu) = eksport po `market.exportPrice` (`export`), towar znika — **ekonomia nie powinna drugi raz sprzedawać tych dostaw**. `vehicle:delivered.value` = wartość rynkowa (lub faktyczna kwota przy B2B/eksporcie); trafia do `stats.revenueMonth` pojazdu i trasy (dla własnych dostaw to wartość nominalna, nie gotówka).

**Pojazdy:** statusy `moving → unloading → loading → (waiting gdy waitFull, maks. 30 dni) → moving`; `noPath` (ponowna próba co 2 dni + jedno powiadomienie), `broken` (1–4 dni, koszt naprawy 1.5% ceny), `waiting` w trasie = sztorm (statki/drony, `world.modifierAt('speed.<mode>') <= 0` lub `weather.kind === 'storm'`). Prędkość = `def.speed` × `speed.<mode>` firmy × stan (0.7+0.3·condition) × poziom drogi/toru × `world.modifierAt('speed.<mode>', x, y)` × korek. Korek: gdy na następnym kaflu jest ≥ pojemności pojazdów (droga 2/2/4/8 wg poziomu, tory 1, woda 4) → × cap/(n+1), min 0.25. Pociągi: pojemność = `capacity × wagons`, cena = `cost + wagons × costPerWagon`. Emisje `def.emissions` × długość → `company.emissionsMonth` (+ 5% do `map.pollution` kafla). `x,y` w jednostkach kafla (środek = +0.5), `prevX/prevY` do interpolacji, `heading` w radianach.

**Usługi** `ctx.services.logistics` (wszystko jak w §6) + `suggestRoutes(companyId, limit?)` → `RouteSuggestion[]` (producent → odbiorca bez trasy), `buyVehicle(…, opts?: { depotId?, wagons? })`, `updateRoute(id, { …, enabled? })`, `createRoute` zwraca opcjonalne `warning` (brak połączenia), `autoConnect` (road: planuje i buduje drogę A*, rail: buduje tory między stacjami obsługującymi budynki, water/air: sprawdza połączenie; używa istniejącej trasy A→B jeśli jest; kupuje najlepszy dostępny pojazd na ile starczy) zwraca `{ routeId, vehicleId?, warning? }`. `estimateNetwork` zwraca `{ cost, newTiles, bridgeTiles }`.

**API do odczytu** (`import … from '../logistics/api'`, tanie, bez alokacji tam gdzie się da): `vehiclePose(v, alpha, out?)` → `{x,y,heading}` (kafle), `vehicleMainCargo(v)`, `vehicleLoad(v)` 0..1, `vehicleStatusLabel(v)`, `VEHICLE_STATUS_LABELS`, `vehicleTarget(state,v)`, `vehicleSellValue`, `vehiclePrice`; `roadLevel/railLevel/roadMask/railMask(state,i)`, `roadMaskWithBuildings(state,i)` (bity także w stronę przylegających budynków — wjazdy); `tileOccupancy(ctx,i)`, `occupancyArray(ctx)`, `congestionAt(ctx,i)` (zajętość/pojemność, >1 = korek), `trafficLevel(state,i)` 0..1 (**używaj do nakładki „traffic”** — `network.traffic` rośnie o 10 na przejazd, zanik 7%/dzień, 1000 ≈ 7 przejazdów/dzień); `routeUtilisation(ctx,routeId)` → `{vehicles, avgLoad, congestion, throughput, noPath}`, `routeLegs(ctx,routeId)` → ścieżki kafli odcinków (linie tras na mapie); `buildingTransportModes(def)`, `stationMode(def)`, `stationRadius(def)`, `stationCatchment(ctx,b)`, `accessTiles(ctx,b,mode)`, `hasRoadAccess(ctx,b)`; `bestLevel/levelName/levelUnlocked/maxLevel`, `DIR_BITS`.

**Narzędzia** (`ctx.input.setTool(id, args)`; przyciski w grupie `transport`): `road` {level?} (R), `rail` {level?} (T) — przeciągnij = ścieżka A* po najtańszym terenie (Shift = L, Ctrl = odwrócone L), klik = 1 pole, Q = poziom; `route` {mode?} (L) — klikaj przystanki, Enter/klik w pierwszy = utwórz + kup pojazd, Backspace cofa; `autoconnect` (K) — producent → odbiorca; `bulldoze` (X) — klik/obszar usuwa własne drogi i tory, 2× klik na własnym budynku = `economy.demolish`. Po utworzeniu trasy emitowane jest `select {kind:'route'}`.

**Stan prywatny:** brak (`state.ext.logistics` nieużywane); wszystko w typach rdzenia.

## 19. Ekonomia — API (`src/economy`, dane `src/data`)

**Dane** (`ctx.data`): 5 epok (`industrial` 1850, `electric` 1900, `mass` 1950, `modern` 1990, `digital` 2020), ~64 produkty, ~80 receptur (warianty `alternative`: tańsze/premium, zmieniają jakość), ~70 budynków, 18 pojazdów (road/rail/water/air), 37 technologii, 9 złóż (`coal, iron, clay, stone, gold, copper, sand, oil, lithium` — id stabilne, świat je rozmieszcza). Nowe **opcjonalne** pola defów: `ProductDef.eraDemand[5]` (mnożnik popytu per epoka), `BuildingDef.tags` (cele modyfikatorów: `farm, mine, forestry, food, textile, wood, heavy, chemical, electronics, digital, retail, power, green, recycling…`), `sellsCategories` (sklepy; mody z nowymi produktami tych kategorii są dopisywane do `sells` automatycznie przy `mergeMod`), `salesPerDay` (sklep/eksport), `loadRate` (stacje/huby — podpowiedź dla logistyki), `green`. `sells` sklepów jest zawsze wypełnione (autorytatywne). Przykładowy mod: `src/data/mods/example.json` (pasieka → miód → miód pitny).

**Systemy:** `economy.monthClose` (month, **60** — pierwszy w ticku nowego miesiąca: ceny rynku → ekologia (podatek emisyjny, kary, eko-ocena, reputacja, opinie/pozwolenia miast) → finanse (raty kredytów, podatek dochodowy, `current → history` z `cashEnd`, wycena, `creditLimit`, bankructwo, historia statystyk budynków); czyta `city.demand[*].suppliedMonth/shareByCompany` zanim `cities` (550) je wyzeruje) · `workforce` (day, 200) · `production` (tick, 300) + `production.daily` (day, 301: starzenie `condition` −2%/rok, psucie — spadek jakości towarów z `perishableDays`) · `market` (day, 500: sprzedaż w sklepach, eksport, produkty cyfrowe) · `ecology` (day, 600: rozprowadzenie emisji na `map.pollution` w promieniu ~3 pól + zanik `ecology.pollutionDecay`) · `research` (day, 700) · `finance` (day, 800: utrzymanie budynków, płace, prąd). Kroki nowej gry: `market` (300), `companies` (400). **Ekonomia NIE nalicza** utrzymania pojazdów ani dróg/torów (robi to logistyka) ani sprzedaży B2B/eksportu przy dostawach do cudzych/publicznych budynków.

**Produkcja:** cykl receptury postępuje o `dt / recipe.days × efficiency`, gdy są wejścia (w `input`) i miejsce na wyjścia (`output` ≤ pojemność); wejścia zużywane na końcu cyklu. `efficiency` = pracownicy (`employed/required` × (0.85+0.3·skill)) × stan (0.5+0.5·condition) × modyfikatory `efficiency.*` (firma × ulepszenia × zdarzenia świata w zasięgu) × czynnik miejsca (farmy: żyzność/160, pora roku 0.75–1.15, susza, zanieczyszczenie; leśniczówka: gęstość lasu; wiatr/słońce). Jakość wyjścia = średnia jakość wejść (ważona wartością; surowce: jakość złoża/gleby) + `qualityModifier` + (`quality.*` − 1). Kopalnie zmniejszają `map.depositAmount` (status `noDeposit`). Produkty uboczne trafiają do `output`; nadmiar **odpadów** jest utylizowany za 3 zł/szt. (`otherExpense`). Statusy: `construction, ok, disabled, noWorkers (<25% załogi), noInput, outputFull, noDeposit, noCustomers, damaged (condition < 0.25)` + `building:statusChanged`; koniec budowy → `building:completed`; cykl → `building:produced`. Budynek z `power<0` pobiera prąd tylko gdy `ok`; niedobór kupowany z sieci (`energy`, 60 zł/MW/mies.), nadwyżka sprzedawana (30). `company.energy.produced/consumed` = MW·dni w bieżącym miesiącu.

**Bufory** (`economy/stock.ts`): `buildingCapacity(ctx,b)` = `def.capacity` × ulepszenia × `capacity.*` (autorytatywna pojemność), `acceptedProducts(ctx,b)`, `inputSpace(ctx,b,p)`. Zmiana receptury (`setRecipe`) przenosi niepotrzebne wejścia do `output` (do wywiezienia).

**Pracownicy:** budynek zatrudnia z miast, których **krawędź** jest w zasięgu `labour.commuteRadius + 4`, najpierw najbliższe (kolejność: `priority` malejąco, id); pisze `workers.*`, `building.cityId`, `city.labour.employed` (świat tylko czyta). Brak miasta w zasięgu → 60% załogi za 1.2× płacy bazowej epoki. Płaca = średnia `labour.wage` miast × `wages.*`.

**Sklepy i popyt:** sklep sprzedaje miastom, których krawędź jest ≤ `def.radius` od sklepu. Dziennie miasto chce `monthly/30` (max ×1.25, nie więcej niż `monthly − suppliedMonth`); sklepy dzielą popyt wg atrakcyjności = jakość^1.5 / `priceFactor`² × reputacja × odległość × `sales.*` × zielone (`greenPreference`). Cena = `demand.price` (świat) × `shop.priceFactor` × jakość (0.7+0.6q) × zielona premia. Przychód → `sales`, dopisek do `suppliedMonth`, `shareByCompany`, `building.stats.soldMonth`, zdarzenie `sale`. Dotacje (`subsidy.<pid>` / regulacja `subsidy`) → `subsidy`. **Centrum eksportowe** (własne) sprzedaje `storage` za `exportPrice` do `salesPerDay` dziennie (`export`). **Produkty cyfrowe** (`category 'digital'`) sprzedają się prosto z `output` producenta do popytu wszystkich miast.

**Rynek** (`state.market`, miesięcznie): `price` → bazowa × `priceIndex` × `economyFactor` (= iloczyn efektów `economy` globalnych zdarzeń: boom/recesja) × sezon × niedobór (1.15 − 0.25·podaż/popyt, 0.6..1.25) × `price.<pid|kategoria|all>`; wygładzanie 35%/mies. Podaż = wyprodukowane, popyt = zużycie fabryk + `Σ city.demand.monthly`. `exportPrice` = 72% ceny, spada przy dużym eksporcie. `trend` −1..1, historie `priceHistory/supplyHistory/demandHistory`, `last` = zamknięty miesiąc. Emituje `market:updated`.

**Finanse:** kredyty annuitetowe (`takeLoan(id, kwota ≥ 5000, 6–240 mies.)`, oprocentowanie = `market.interestRate` (trudność 5/7/9%) + premia za ryzyko × `interest.all`; limit = `creditLimit` − dług), `repayLoan` (całość lub część, rata przeliczana). Podatek dochodowy (15/19/25% wg trudności) od dodatniego zysku miesiąca. Wycena = gotówka + majątek (budynki koszt×(0.3+0.4·stan), pojazdy, towary po 50% ceny) − dług + 6× średni zysk (6 mies.). `creditLimit` = max(30 000, 50% wyceny) × (0.5 + reputacja/100). Ujemna gotówka przy zamknięciu miesiąca → `monthsInDebt++` + ostrzeżenie; 3 miesiące → `company.bankrupt = true` + `company:bankrupt` (gra zamienia to na porażkę). Budynki bankruta nie pracują. Statystyki budynków: `stats.revenueMonth/costMonth` liczone jako **wartość dodana** (towary po 80% ceny rynkowej; sklep: przychód − towar po 80%) + płace/utrzymanie → `profitHistory`; `utilizationHistory` 0..1. Serie: `stats.monthly["company.<id>.profit|revenue"]`.

**Badania:** punkty/mies. = 10 bazowo + laboratoria (`researchPoints` × efektywność × ulepszenia; także siedziba 15) + `research.budget`/40 zł, × `research.all`. Budżet wydawany dziennie (`research`) tylko gdy coś jest badane i gotówka ≥ 0. Po ukończeniu: `research.unlocked[tech]`, efekty `modifier` są **mnożone** do `company.modifiers[key]`, odblokowania, `research:completed` (+ powiadomienie gracza), start następnej z `queue`. Przełączenie technologii zachowuje postęp (`ext.economy.researchPartial`). Technologie `era_*` przenoszą firmę do kolejnej epoki; gdy zrobi to **gracz**, ekonomia ustawia `state.time.eraId` i emituje `era:changed` (kalendarz nadal działa jak dotąd w `core.era`).

**Odblokowania:** `isUnlocked(companyId, kind, id)` = epoka defa ≤ epoka firmy (max(epoka świata, najwyższa zbadana `era_*`)) **i** (brak `requiresTech` lub zbadana / odblokowana efektem `unlock*`). Receptury nie mają epoki. `company.unlocks` to pochodny cache (odświeżany przy starcie, badaniach, `era:changed`, `company:created`).

**Ekologia:** eko-ocena → 75 − 18·log10(1 + emisje/8)·(0.6 + świadomość) + zielone budynki (energia 6, recykling/eko 4 pkt, max 25); reputacja ← eko-ocena, średnia jakość sprzedanych towarów, zaopatrzenie sklepów, długi, siedziba. Opinia miasta o firmie (−100..100) ← miejsca pracy, udział w zaopatrzeniu, zanieczyszczające budynki ≤ 12 pól od krawędzi, eko-ocena; pozwolenia: opinia < −40 → `denied` (zakaz budowy w obrębie miasta + 2 pola), < −10 lub reputacja < 20 → `restricted` (tylko budynki z `pollution ≤ 2`). Podatek emisyjny = (`ecology.carbonTax` + regulacje `carbonTax` + efekty `carbonTax` zdarzeń bez lustrzanej regulacji `ev-<id>`) × `company.emissionsMonth`. `emissionCap`: wartość < 5 = mnożnik bazowej emisji firmy (średnia 6 mies. przed normą), inaczej limit bezwzględny; przekroczenie → kara 10 zł/jedn. (`fines`). Ekonomia zeruje `company.emissionsMonth` i `ecology.co2Month` przy zamknięciu (logistyka może do nich dopisywać emisje pojazdów).

**Usługi** `ctx.services.economy` — wszystkie z §6 działają + opcjonalne: `setBuildingEnabled`, `upgradeBuilding(id, upgradeId)` (efekty: `efficiency, capacity, workers, sales, research, emissions, upkeep`, `quality` addytywnie; `level = 1 + liczba ulepszeń`), `setShopPrice(id, 0.5..2)`, `setResearchBudget(companyId, zł/mies.)`, `queueResearch(companyId, techId)` (dokłada brakujące wymagania), `cancelResearch`, `repairBuilding` (koszt = brak stanu × koszt × 0.35). `checkPlacement` = reguły rdzenia + odblokowania + jedna siedziba na firmę + pozwolenia miast. `build` ustawia `cityId`, farmy zamieniają trawę w `Farmland`, inne budynki czyszczą las. `demolish` zwraca 25% × stan (w budowie więcej). `acquireBuilding` deleguje do `services.ai.buyBuilding` (fallback własny). `price(p, cityId?)` = `city.demand[p].price` albo cena rynkowa.

**Analiza** (`import { … } from '../economy/analysis'`, czyste odczyty, dla AI/doradcy/UI): `buildingEconomics(ctx, typeId, recipeId?, opts)` (przepływy/mies., wartość dodana przy efektywności 1), `producersOf/producerOf(ctx, productId)`, `shopFor(ctx, productId)`, `planChain(ctx, productId, opts)` → `ChainPlan` (drzewo węzłów z liczbą budynków zbalansowaną do zasilenia jednego budynku końcowego; `investment/monthlyProfit/paybackMonths` w stanie ustalonym — dostawcy liczeni proporcjonalnie, `standaloneInvestment/standaloneProfit` — wszystko od zera; `deposits`, `unlocked`), `rankChains(ctx, companyId, { maxInvestment? })` (najlepsze łańcuchy firmy wg zysku/zł), `pnlSummary(company)` + `pnlGroups(month)` + `FINANCE_CATEGORY_NAMES` (polskie nazwy kategorii księgi — do P&L w UI), `stockValue`. Opcje: `prices: 'market' | 'base'`, `wage`, `companyId` (filtr odblokowań). AI może podpiąć to przez własny `setProfitEstimator`. Inne eksporty: `economy/finance.ts` (`loanRate`, `annuityPayment`, `computeValuation`, `assetValue`), `economy/research.ts` (`researchPointsPerMonth`, `labPoints`), `economy/unlocks.ts` (`companyEraIndex`, `researchBlocker`), `economy/ecology.ts` (`carbonTaxRate`), `economy/sales.ts` (`citiesInReach`, `qualityPriceFactor`), `economy/service.ts` (`repairCost`), stałe balansu w `economy/constants.ts`.

**Balans (testy `src/economy/chain.test.ts`):** pierwszy łańcuch farma → młyn → piekarnia → sklep (+6 wozów, drogi; ok. 40 tys. zł) na „normal” daje ~+4 tys. zł/mies. od 2. miesiąca i zwraca całą inwestycję w ~10 miesięcy (≈5 min gry). Łańcuchy późniejszych epok: większy zysk absolutny, zwrot 15–30 mies. przy znacznie wyższym kapitale.

**Stan prywatny:** `state.ext.economy = { researchPartial, exportMonth, exportLast, util, salesQ, capBaseline, version }` (czytany defensywnie; brak = domyślne).

## 19. UI — API (`src/ui`, `src/input`)

**Panele** — `ctx.ui.registerPanel({ id, title, icon?, width?, height?, position?: 'center'|'left'|'right'|{x,y}, key?(args), refreshMs?, create(p, ctx) })`. W `create` buduj DOM w `p.body` (klocki z `ui/components.ts`, `ui/dom.ts`), ustaw `p.onUpdate` (wołane co `refreshMs`, dom. 500 ms, tylko gdy gra trwa — **nie** co klatkę) i `p.onClose`. Aktualizuj tanio: `setText`, albo przebudowuj fragment tylko gdy zmieni się sygnatura danych (wzorzec `dyn(render, cls, sig)` z `ui/panels/inspector/common.ts`) — przebudowa co tick niszczy przyciski pod kursorem. Okno po zbudowaniu jest dopasowywane do ekranu. `openPanel(id, args)` dla singletonu z innymi `args` przebudowuje okno w miejscu.
- Istniejące panele UI (id → args): `inspector` (Selection; budynek/miasto/pojazd/kafel), `route {routeId} | {draft:{mode?, stops?: BuildingId[]}}` (edytor trasy, klucz `route:<id>`/`route:new`), `routes` (lista tras), `dashboard {tab?: 'overview'|'finance'|'buildings'|'routes'|'loans'|'research'|'rivals'}`, `research`, `chains` (widok łańcuchów), `encyclopedia {kind?: 'product'|'building'|'vehicle'|'tech'|'era', id?}`, `notifications`, `blueprints`, `help`, `settings`, `saveLoad {mode}`, `gameMenu` (pauzuje grę na czas otwarcia). Panele innych modułów, do których UI linkuje: `campaign`, `rivals`, `takeover {buildingId}`, `objectives`.
- `select` z `{kind:'route'}` otwiera edytor trasy, `{kind:'company'}` → dashboard/rywale, reszta → `inspector`; `{kind:'none'}` zamyka inspektor. `focusTarget(ctx, ref)` z `ui/ui.ts` = kamera + zaznaczenie (toasty, listy).

**Pasek dolny** — `ctx.ui.registerToolbarButton({ id, icon, label, group, order?, tooltip?, hotkey?, onClick, isActive? })`. Grupy (kolejność): `build` (UI: kategorie budynków → paleta), `raw, factory, shop`, `logistics`, `transport` (narzędzia logistyki), `special`, `manage` (CEO, łańcuchy, trasy, badania, blueprinty, wiedza + cele/doradca/rywale z modułów gry/AI), `view` (inspekcja, siatka, nakładki). Każdy przycisk dostaje `data-id="<id>"` (i `data-toolbar-id`), karty palety budowy `data-id="<buildingTypeId>" data-tool="build"`, przyciski nakładek `data-id="overlay-<id>"` — do podświetleń samouczka (`.ig-tut-highlight`). `hotkey` to tylko opis — klawisz rejestruj osobno przez `ctx.input.registerHotkey`.

**Górny pasek** — `ctx.ui.registerHudItem({ id, side, order?, create(el), update?(el) })`; `update` ~4×/s. Zajęte przez UI: `company`(10, lewa), `era`(20), `date`, `speed` (środek), `reputation`(5), `cash`(10, animacja delty z `cash:changed`), `bell`(900), `help`(950), `menu`(1000) (prawa).

**Narzędzia** (`src/input`) — oprócz `ToolDef` z §8: opcjonalne `status?(ctx): ToolStatus | null` = karta przy kursorze (tytuł, `ok` zielony/czerwony, `message`, `lines[{label,value,tone}]`, `footer`), odpytywana ~8×/s; `hint?(ctx)` = pasek podpowiedzi nad paskiem narzędzi. Narzędzia UI: `inspect` (domyślne), `build {typeId, rotation?}` (walidacja przez `economy.checkPlacement`, budowa `economy.build`, R = obrót, zostaje aktywne), `pick` (`PickArgs {prompt, icon?, kinds?, accept?(sel)→true|powód, onPick(sel), onCancel?}` — jednorazowy wybór celu na mapie, np. „Połącz z…”), `blueprint {mode:'select'} | {mode:'paste', blueprintId}` (zapis do `state.blueprints`, wklejanie: `economy.build`+`setRecipe`, sieć przez `logistics.buildNetwork` pociętą na spójne odcinki). Warstwy wejścia: `tool-preview` (z 90), `hover` (z 100, tylko inspekcja/pick); zaznaczenie (z 80) rysuje render.

**Nakładki** — lista i legenda pochodzą z `ctx.renderer.listOverlays()/overlayInfo(id)` (render jest źródłem prawdy; `demand:<productId>` wybierane w legendzie). `ctx.ui.registerOverlay(def: OverlayDef)` (nowe w `UiApi`) dodaje/uzupełnia opis nakładki po stronie UI: `name, icon, description, legend | gradient` (fallback gdy render nie zna id) oraz `minimapColor(state, idx, ctx) → [r,g,b,a] | null` — zabarwienie minimapy (wołane dla każdego kafla ~1×/s, musi być tanie). UI ma domyślne `minimapColor` dla `demand, pollution, profit, traffic (trafficLevel), deposits, fertility, ownership`.

**Podpowiedzi i komunikaty** — trwałe: `notify()` (toast + dziennik 🔔, klik = `target`). Doradca: `ctx.bus.emit('advisor:tip', { id, text, target })` → dymek doradcy (kolejka, dedup po `id`, przycisk „Pokaż”, wyłączenie = `userSettings.advisorEnabled`); toast o tym samym tekście jest automatycznie chowany. `services.game.currentHint()` odpytywane co 5 s i pokazywane w tym samym dymku. Krótkie komunikaty bez logu: `ctx.ui.toast({ level, title, text?, icon?, target?, onClick?, durationMs? })`.

**Skala / responsywność** — `userSettings.uiScale` (0.85–1.5) = CSS `zoom` na `#ui-root` (+ `--ui-scale` dla tooltipów); pozycje w px wewnątrz UI dziel przez `uiScale()` z `ui/ui.ts`. Tooltip: `tooltip(el, textOrFn)` albo atrybut `data-tip="…"` na dowolnym elemencie.

**Skróty zajęte przez UI** (poza §8 i logistyką R/T/L/K/X): `F1`/`H` pomoc · `B` budowa · `C` panel CEO · `J` łańcuchy · `U` trasy · `I` badania · `E` encyklopedia · `P` blueprinty · `N` powiadomienia · `M` minimapa · `O`/`Shift+O` nakładki · `Ctrl+S` zapis · `=`/`-` zoom · w narzędziu budowy/blueprintu `R`/`Shift+R` obrót. Esc: narzędzie → okno → odznaczenie + menu gry (pauza).

## 20. Renderowanie — API (`src/render`)

**Warstwy (z)** – zastępują placeholdery z §7: `terrain` 0 (teren + domy + drzewa + rzeki + znaczniki złóż, cache chunków multi-LOD) · `water-anim` 2 · `network` 10 · `buildings` 30 · `vehicles` 40 · `effects` 50 · `clouds` 52 · `night` 55 (screen, multiply) · `lights` 56 (additive) · `weather` 57 (screen) · `overlay` 60 · `routes` 62 (linie przepływu) · `grid` 65 · `tiltshift` 66 (screen) · `labels` 70 (screen) · `floating-text` 72 (screen) · `selection` 80 · (input: `tool-preview` 90, `hover` 100) · `fps` 1000. Warstwy `houses` już nie ma (domy są w chunkach terenu).

**RenderContext** (`rc`, `render/types.ts`) – oprócz pól z §7: `ppt` (px CSS na kafel = zoom×32), `detail: 'far' | 'mid' | 'close'` (zoom semantyczny: < 12 px/kafel = daleko: bloki + duże ikony, linie przepływu tras, tylko etykiety miast; 12–28 = średnio; ≥ 28 = pełne detale i animacje), `night` 0..1, `motion` (false przy `reducedMotion`), `helpers` (niżej).

**Odświeżanie**: pętla rAF rysuje każdą klatkę – *nie trzeba* prosić o redraw. Cache (teren, sieć) odświeżają się same po `map:changed` / `network:changed` / `building:built|removed` / `time:season`. Kto zmienia dane per kafel bez tych zdarzeń: `ctx.renderer.invalidate({x,y,w,h})` (lub `null` = wszystko).

**Nakładki** – `ctx.renderer.setOverlay(id | null)`; `ctx.renderer.listOverlays(): OverlayInfo[]`; `ctx.renderer.overlayInfo(id?)` → `{ id, name, icon, description, legend }`, gdzie `legend = { kind: 'gradient'|'categories', min, max, unit, stops: [{t, color}], minLabel, maxLabel, categories?: [{label, color, icon?}], note? }` (min/max = bieżący zakres danych aktywnej nakładki). Id: `demand` (+ `demand:<productId>` dla jednego towaru), `pollution`, `profit` (budynki gracza, etykiety zysku), `traffic` (kafle sieci wg `trafficLevel` + linie tras), `deposits` (kolory złóż + ikony skupisk z ilością), `fertility`, `landValue`, `ownership`. Nakładki cieplne: rastr 1 px/kafel, przeliczany co 1–5 s.

**Pomocniki podglądu** (`rc.helpers.*` w `drawPreview(rc)` albo `import { … } from 'src/render/preview'`; współrzędne w kaflach):
`footprint(rc, x, y, w, h, valid: boolean | color, label?)` · `ghostBuilding(rc, typeId, x, y, rotation, valid)` (sztuka budynku + obrys + zasięg `def.radius`) · `ghostNetwork(rc, pathTiles, 'road'|'rail', valid)` · `tiles(rc, indices, valid|color)` · `radius(rc, cx, cy, r, color?)` · `line(rc, indices | {x,y}[], color, {width?, dashed?, flow?, alpha?})` · `arrow(rc, x0, y0, x1, y1, color?)` · `label(rc, tx, ty, text, color?)` · `highlightBuilding(rc, b, color?)`. Kolory: `VALID_COLOR`, `INVALID_COLOR`, `NEUTRAL_COLOR`.

**Efekty** – `ctx.renderer.effect(kind, x, y, opts?)` (x,y w kaflach, ułamkowe): `smoke | steam | dust | sparkle | splash | coins | text | icon`, `opts = { count?, text?, color?, scale? }` (np. `effect('text', b.x+1, b.y, { text: '+500 zł', color: '#8ef0a0' })`). Automatycznie: pył przy `building:built/removed` i budowie sieci, iskry przy `building:completed`, „+zł” przy `vehicle:delivered` (gracz), monety przy `sale`, ikona produktu przy `building:produced`, dym z kominów pracujących fabryk (intensywność z `def.pollution`), para z chłodni, dym parowozów.

**Stan budynku na mapie**: ikona produktu (wyjście receptury) w białym znaczku z obwódką koloru firmy; znaczek statusu (prawy górny róg) dla `noInput`, `outputFull`, `noWorkers`, `noDeposit`, `noCustomers`, `noPower`, `damaged`, `noPermit`, `disabled`/`enabled=false` (`STATUS_BADGE` w `layers/buildings.ts`); budowa = plac + rusztowanie + pasek postępu. Archetyp grafiki wybiera `artKindOf(def)` (kategoria, słowa w id, `stationMode`).

**Pojazdy**: pozycja `lerp(prevX, x, rc.alpha)`, kurs wygładzany; drogowe jadą prawym pasem; pociąg = lokomotywa + `wagons` wagonów wzdłuż `path`; kolor ładunku = `ProductDef.color` głównego towaru; daleko = kropki w kolorze ładunku z obwódką firmy.

**Atmosfera**: dzień/noc wg czasu symulacji, cykl `DAY_NIGHT_CYCLE_DAYS = 30` dni gry (1 dzień ≈ 1 s, więc cykl dobowy byłby migotaniem), wyłączany `userSettings.dayNightCycle`; pory roku zmieniają paletę (śnieg zimą w klimacie umiarkowanym/kontynentalnym/arktycznym, jesienne drzewa); pogoda regionu pod kamerą (deszcz, burza z błyskami, śnieg, mgła, cienie chmur); `userSettings.tiltShift` (wymaga `ctx.filter`); `reducedMotion` wyłącza animacje.

**Wydajność**: `ctx.renderer.stats` = `{ fps, frameMs, layerMs, chunks }` (widoczne z `userSettings.showFps`); w DEV `window.ig3render`. Teren: chunki LOD 8/16/32/64 px/kafel, budżet 7 ms/klatkę na przerysowania, LRU (≈28 Mpx), LOD 0 dogrzewany w tle. Sieć: `Path2D` per chunk 32×32. Brak alokacji w pętlach per kafel.

## Changelog kontraktu

| Data | Autor | Zmiana |
|---|---|---|
| Etap 0 | fundament | Wersja początkowa: GameState v1, sim, bus, services, render/input/ui API. |
| Etap 1 | świat | `WorldService` += `tilesInRadius`, `terrainCost`, `weatherAt`, `modifierAt` (addytywnie, domyślne fallbacki w `core/services.ts`). Sekcja 14 „Świat — API”: kontrakt popytu miast, klucze `effects` zdarzeń, kodowanie `elevation`/`seaLevel`. |
| Etap 1 | AI/gra/audio | `core/services.ts`: nowa usługa `ai: AiService` (`buildingPrice`, `buyBuilding`) z domyślnym stubem. Sekcje 15–17 (AI / Gra / Audio — API). Nowe sfx: `victory`, `defeat`. |
| Etap 1 | logistyka | `LogisticsService` += `suggestRoutes(companyId, limit?)` (+ typ `RouteSuggestion`), `buyVehicle(…, opts?: BuyVehicleOptions {depotId?, wagons?})`, `RouteSpec.enabled?` (dla `updateRoute`) — addytywnie w `core/services.ts`, domyślny fallback `suggestRoutes: () => []`. Sekcja 18 „Logistyka — API”: reguły dostępu/stacji, przepływ towaru (B2B i eksport do budynków publicznych płaci logistyka), skala `network.traffic`, API odczytu dla renderu/UI. |
| Etap 1 | dane+ekonomia | `EconomyService` += opcjonalne `setShopPrice`, `setResearchBudget`, `queueResearch`, `cancelResearch`, `repairBuilding` (addytywnie w `core/services.ts`, bez domyślnych implementacji). Defy: opcjonalne `ProductDef.eraDemand`, `BuildingDef.tags/sellsCategories/salesPerDay/loadRate/green`. Epoki: lata startu 1850/1900/1950/1990/2020 (id bez zmian). Zamknięcie miesiąca ekonomii jako system `economy.monthClose` (order 60). Sekcja 19 „Ekonomia — API”. |
| Etap 1 | UI | `UiApi.registerOverlay(def: OverlayDef)` (+ stub headless) i typ `OverlayDef` w `ui/types.ts`; `EconomyService` += opcjonalne `setBuildingEnabled?`, `upgradeBuilding?` (UI ma fallback); `ToolDef.status?` (karta narzędzia) w `input/types.ts`; Esc bez okien otwiera `gameMenu`. Sekcja 19 „UI — API”. |
| Etap 1 | render | `RendererApi` += `listOverlays()`, `overlayInfo(id?)`, `effect(kind, x, y, opts?)`, `stats` (addytywnie w `core/context.ts` + stub headless; typy `OverlayInfo`, `OverlayLegend`, `EffectKind`, `EffectOptions`, `RenderStats` w `render/types.ts`). `RenderContext` += `ppt`, `detail`, `night`, `motion`, `helpers`. `ChunkCache` multi-LOD (`lods`), wsteczna zgodność `pxPerTile`. Warstwa `houses` usunięta (domy w terenie). Sekcja 20 „Renderowanie — API”. |
| Etap 2 | QA symulacji | **Determinizm**: AI myśli maks. `AI_MAX_THINKS_PER_DAY` firm/dzień (licznik, nie zegar ścienny); cache runtime wpływające na symulację są deterministyczne (logistyka: budżet ścieżek liczony przed cache, `envSpeed` cache per dzień+kafel; ekonomia: `siteInfo`/`pendingEmissions` zapisywane w `ext.economy.runtime` przy `game:beforeSave` i odtwarzane przy starcie) → zapis→odczyt kontynuuje się bit w bit. **Logistyka**: `freeRoom` = `economy/stock.buildingCapacity()` (bez `× level`), eksport do budynków publicznych księguje `economy/market.recordExport` (nasycenie ceny eksportu), `pickVehicleType(…, budget?, products?)` pomija pojazdy, które nie przewiozą towaru (cysterna/parowóz drogowy), drogi innych firm można przecinać/dołączać (bez modernizacji), reguły mostów tylko dla nowych kafli, stacje kolejowe/porty/dronoporty codziennie oddają towar ze `storage` własnym odbiorcom w zasięgu, logi „Awaria pojazdu” tylko dla zużytych pojazdów. **Ekonomia**: `market.priceIndex` dąży do `PRICE_INDEX_BY_ERA` (1/1,18/1,4/1,7/2), sezonowość liczona raz, powiadomienia o uszkodzeniu (koszt naprawy) i wyczerpaniu złoża, komunikat o płacach przy zmianie epoki, opcje analizy `priceIndex`/`workersMul`, cele balansu w `economy/balance.ts`. **Dane**: tech `industrial_robots` (era nowoczesna, pracownicy ×0,8; wymagany przez `robotics`), złoża ×1,8. **AI**: tempo rozwoju `DIFFICULTY.growthDays`, naprawy, relokacja wyczerpanych kopalń, sprzedaż pojazdów bez drogi >60 dni + ponowne połączenie, porzucanie niedokończonych łańcuchów, wybór pojazdu wg ładunku. **Świat**: małe miasta wyludniają się wolniej. **Testy/QA**: `core/qa.ts` (`createSimContext`, `scanState`, `checkLedgers`, `digest`), `core/longrun.test.ts` (+ `IG3_LONG=1`), gracz skryptowy `ai/scripted.ts`. |
| Etap 2 | QA symulacji (2) | Badania: `BASE_RESEARCH_POINTS` 25, `ZL_PER_RESEARCH_POINT` 25, technologie `era_*` droższe i dostępne najwcześniej `ERA_EARLY_YEARS` (20) lat przed kalendarzowym startem epoki; osiągnięcie epoki daje wszystkim firmom jej technologię-bramę `era_*`. Pociągi: pojemność/prędkość ↑ (parowóz 40/wagon, 14 pól/dzień), domyślny skład `defaultWagons(def)` = ⌈(min+max)/2⌉ wagonów (zmniejszany do ceny) w `buyVehicle`/`vehiclePrice`. Stacje/porty/magazyny/eksport dostają nazwę od najbliższego miasta (`Building.name`, np. „Stacja kolejowa Brzozów 2”); trasy z `autoConnect` nazywane „<towar>: A → B”. `PATH_BUDGET_PER_TICK` 150. AI: rozbudowa (`upgradeBuilding 'expand'`) najbardziej obciążonego budynku ~raz w roku, sprzedaż pojazdów i usuwanie tras bez przewozów przez 12 mies., `DIFFICULTY.efficiency` (modyfikator `efficiency.all` rywala). Blueprint: sieć wklejana z poziomem zastępczym i kafel po kaflu, gdy odcinek się nie mieści. |
