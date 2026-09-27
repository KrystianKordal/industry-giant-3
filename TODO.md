# Industry Giant 3 — TODO & architektura

Źródło wymagań: `industry_giant_2_analiza_i_sequel.md`.

## Zakres (co realnie budujemy)

Gra przeglądarkowa (desktop), **TypeScript + Vite, Canvas 2D, vanilla DOM UI, zero backendu**.
Odpowiednik „Fazy 1 (Early Access)” z roadmapy, rozszerzony o kampanię:

- Sandbox na proceduralnej mapie + kampania (5 scenariuszy, pierwszy = tutorial)
- 5 epok (1850 → 2020), ~64 produkty, wieloetapowe łańcuchy produkcyjne
- Logistyka: drogi, tory, woda; ciężarówki, pociągi, statki, (późno) drony; huby/magazyny
- Żywe miasta, konkurencja AI, finanse, R&D, ekologia, pracownicy
- Nowoczesne UI: dashboard CEO, widok łańcuchów, nakładki/heatmapy, minimapa, blueprinty
- Proceduralny dźwięk (WebAudio), zapis/odczyt, modding przez JSON

**Poza zakresem** (świadomie): grafika 3D, multiplayer sieciowy, Steam Workshop, giełda z prawdziwym obrotem akcjami.
Zastępstwa: czytelna grafika 2D „top-down” z animacjami, import modów JSON, wycena spółki + przejęcia budynków
i całych firm AI (wrogie przejęcie), cel „Monopolista”.

## Architektura

```
src/
  main.ts                 bootstrap, menu główne
  core/                   types.ts (CAŁY stan gry), state.ts, bus.ts (EventBus), rng.ts,
                          sim.ts (pętla fixed-step + rejestr systemów), save.ts
  data/                   products.ts, buildings.ts, eras.ts, vehicles.ts, tech.ts, names.ts,
                          registry.ts (ładowanie + mody JSON)
  world/                  mapgen.ts, cities.ts, weather.ts, events.ts
  economy/                production.ts, market.ts, finance.ts, research.ts, ecology.ts, workforce.ts
  logistics/              network.ts (drogi/tory), pathfinding.ts, vehicles.ts, routes.ts, hubs.ts
  ai/                     competitor.ts
  game/                   scenarios.ts, goals.ts, advisor.ts (mentor + podpowiedzi), blueprints.ts
  render/                 renderer.ts, camera.ts, layers/*, sprites.ts (proceduralne rysowanie)
  ui/                     ui.ts (framework paneli), hud.ts, panels/*, dashboard.ts, chainView.ts,
                          minimap.ts, overlays.ts, encyclopedia.ts, tooltips.ts, menus.ts
  input/                  input.ts, tools/* (build, road, rail, bulldoze, route, blueprint)
  audio/                  audio.ts (muzyka ambient + SFX + dźwięk kontekstowy)
```

Zasady:
- **Stan gry = jeden serializowalny obiekt** (`GameState` w `core/types.ts`). Żadnych klas z metodami w stanie.
- **Systemy** to funkcje `(state, dtDays, ctx) => void` rejestrowane w `sim.ts` w stałej kolejności:
  weather → workforce → production → logistics → market/cities → ecology → research → finance → ai → goals/advisor.
- Komunikacja przez `bus` (zdarzenia: `building:built`, `cash:changed`, `notify`, `sfx` itd.).
- Dane (produkty, budynki, pojazdy, technologie) są czysto deklaratywne → łatwy balans i mody.
- Każdy moduł ma własny katalog — agenci pracują równolegle bez konfliktów.

## TODO

### Etap 0 — fundament (blokuje resztę)
- [x] Scaffold Vite + TS strict, skrypty `dev`/`build`/`typecheck`, Vitest
- [x] `core/types.ts` — pełny model stanu (mapa, kafle, budynki, magazyny towarów z jakością, pojazdy, trasy, miasta, firmy, finanse, badania, zdarzenia, ustawienia)
- [x] EventBus, seedowany RNG, pętla symulacji (pauza, x1/x2/x4), kalendarz (dzień/miesiąc/rok, pory roku)
- [x] Rejestr danych + szkielety plików danych
- [x] Renderer: kamera (pan/zoom), rysowanie kafli, pętla rAF oddzielona od symulacji
- [x] Framework UI (panele, okna, przyciski, wykresy sparkline), HUD
- [x] Zapis/odczyt (localStorage + eksport pliku)
- [x] `docs/CONTRACTS.md` — API modułów dla pozostałych agentów

### Etap 1 — systemy (równolegle)
**A. Dane i ekonomia produkcji**
- [x] 5 epok, ~64 produkty, receptury (w tym alternatywne tańsze/premium), produkty uboczne i odpady
- [x] Budynki: surowcowe, fabryki, sklepy, magazyny, laboratorium R&D, recykling, zielona energia
- [x] Symulacja produkcji: bufory wejść/wyjść, jakość (surowiec → produkt), wydajność zależna od pracowników i badań
- [x] Rynek: ceny od podaży/popytu, sezonowość, eksport (centrum eksportowe)
- [x] Finanse: koszty stałe, P&L miesięczny, kredyty, wycena firmy, bankructwo
- [x] R&D: drzewo technologii, odblokowania produktów/pojazdów, bonusy wydajności, automatyzacja
- [x] Ekologia: emisje, zanieczyszczenie mapy, reputacja, pozwolenia, zielone produkty
- [x] Pracownicy: rynek pracy per miasto, zasięg dojazdu, płace
- [x] Testy jednostkowe balansu (łańcuch musi być opłacalny, ale nie trywialnie)

**B. Świat i miasta**
- [x] Proceduralna mapa (szum: morze, rzeki, równiny, lasy, wzgórza, góry, pustynie, klimat)
- [x] Złoża z jakością, żyzność gleby
- [x] Miasta: nazwy, populacja, klasy (biedni/średni/bogaci), preferencje, zapotrzebowanie per produkt i epoka
- [x] Wzrost/spadek miast od zaspokojenia popytu, rozbudowa zabudowy na mapie
- [x] Pogoda i katastrofy (susza, sztorm, powódź, trzęsienie), wydarzenia polityczne (podatek emisyjny, subsydia, strajki, boom)

**C. Logistyka**
- [x] Budowa dróg/torów/mostów, koszty terenu, rozbiórka
- [x] Pathfinding A* na grafie sieci, cache tras
- [x] Pojazdy: ciężarówki, pociągi, statki, drony (epoka cyfrowa), ładowność, prędkość, koszty, starzenie
- [x] Trasy: lista przystanków z rozkazami załadunku/rozładunku, priorytety, auto-connect
- [x] Huby/magazyny, stacje, porty; intermodalność
- [x] Przepustowość i korki (spowolnienie), statystyki tras

**D. Renderowanie**
- [x] Teren z cieniowaniem, woda animowana, lasy, zabudowa miast
- [x] Budynki rysowane proceduralnie z ikonami produktów i animacją pracy (dym, kółka)
- [x] Pojazdy w ruchu, ładunek widoczny
- [x] Zoom semantyczny (blisko detale, daleko ikony i przepływy)
- [x] Nakładki: popyt, zanieczyszczenie, rentowność, przepustowość, złoża
- [x] Cykl dnia/nocy i pory roku (tint), opcjonalny tilt-shift

**E. UI/UX**
- [x] Menu główne, nowa gra (seed, rozmiar, trudność, liczba rywali), ustawienia
- [x] Menu budowy per kategoria, podgląd kosztu, walidacja miejsca
- [x] Inspektor budynku / miasta / pojazdu / trasy
- [x] Dashboard CEO (KPI + wykresy), widok łańcuchów (żywy diagram), lista firm/rankingi
- [x] Minimapa z nakładkami, powiadomienia, podpowiedzi kontekstowe
- [x] Encyklopedia, tooltipy, skróty klawiszowe
- [x] Blueprinty (zapis/wklejanie układów)

**F. Gra, AI, dźwięk**
- [x] AI konkurenci (3 poziomy trudności): wybór łańcucha, budowa, trasy, sklepy
- [x] Kampania: 5 scenariuszy z celami (tutorial → era cyfrowa), ekran zwycięstwa/porażki
- [x] Mentor/doradca + samouczek krokowy
- [x] Cele sandboxa (kamienie milowe)
- [x] Audio: ambient generatywny, SFX UI, dźwięki kontekstowe wg kamery, głośności w ustawieniach
- [x] Mody: import JSON z produktami/budynkami

### Etap 2 — integracja i QA
- [x] Spięcie wszystkich systemów, `npm run build` i `typecheck` bez błędów
- [x] Playtest w przeglądarce: pełny łańcuch od farmy do sklepu, pociąg, statek, awans epoki
- [x] Balans ekonomii (pierwsze 10 min zyskowne, średnia gra wymaga optymalizacji)
- [x] Wydajność (mapa 256×256, 300 pojazdów, 60 FPS)
- [x] README z instrukcją uruchomienia i sterowaniem

### Etap 3 — dopracowanie po playteście
- [x] Podświetlenie dobrych miejsc budowy (zielony = można postawić, jaśniej = lepsza gleba/złoże, reszta przyciemniona), liczone raz na typ budynku i zmianę mapy (`input/tools/suitability.ts`); „Najbliższe dobre miejsce” na karcie + klawisz F
- [x] Okres ochronny bez niszczących katastrof (24/12/6 mies. wg trudności), katastrofy rzadsze na łatwym/normalnym, susza min. 20 dni
- [x] Wrogie przejęcie całej firmy rywala (wycena × premia; budynki, pojazdy, trasy, sieć, gotówka i kredyty przechodzą na gracza)
- [x] Zwycięstwo w grze swobodnej „Monopolista” (wszyscy rywale przejęci/zbankrutowani albo 60% sprzedaży) z możliwością gry dalej
- [x] Projekty prestiżowe: Pomnik przemysłu, Uniwersytet techniczny, Wieżowiec korporacyjny (po jednym na firmę)
- [x] Wykres liniowy: „ładne” podziałki osi Y bez powtórzonych etykiet przy płaskich/zerowych danych

### Świadomie poza zakresem (możliwe rozszerzenia)
- [ ] Grafika 3D / izometryczna, multiplayer, Steam Workshop
- [ ] Prawdziwa giełda (kursy akcji, obrót udziałami, częściowe pakiety)
- [ ] Przejęcia firm przez AI (między rywalami i próby przejęcia gracza); budowa projektów prestiżowych przez AI
- [ ] Sterowanie dotykowe / układ mobilny
- [ ] Zapis w chmurze (obecnie localStorage + eksport pliku)
- [ ] Dalszy balans: tempo badań bez budżetu R&D, opłacalność kolei na krótkich dystansach
