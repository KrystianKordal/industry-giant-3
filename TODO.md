# Industry Giant 3 — TODO & architektura

Źródło wymagań: `industry_giant_2_analiza_i_sequel.md`.

## Zakres (co realnie budujemy)

Gra przeglądarkowa (desktop), **TypeScript + Vite, Canvas 2D, vanilla DOM UI, zero backendu**.
Odpowiednik „Fazy 1 (Early Access)” z roadmapy, rozszerzony o kampanię:

- Sandbox na proceduralnej mapie + kampania (5 scenariuszy, pierwszy = tutorial)
- 5 epok (1850 → 2020), ~50 produktów, wieloetapowe łańcuchy produkcyjne
- Logistyka: drogi, tory, woda; ciężarówki, pociągi, statki, (późno) drony; huby/magazyny
- Żywe miasta, konkurencja AI, finanse, R&D, ekologia, pracownicy
- Nowoczesne UI: dashboard CEO, widok łańcuchów, nakładki/heatmapy, minimapa, blueprinty
- Proceduralny dźwięk (WebAudio), zapis/odczyt, modding przez JSON

**Poza zakresem** (świadomie): grafika 3D, multiplayer sieciowy, Steam Workshop, giełda z prawdziwym obrotem akcjami.
Zastępstwa: czytelna grafika 2D „top-down” z animacjami, import modów JSON, wycena spółki + przejęcia budynków AI.

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
- [ ] Scaffold Vite + TS strict, skrypty `dev`/`build`/`typecheck`, Vitest
- [ ] `core/types.ts` — pełny model stanu (mapa, kafle, budynki, magazyny towarów z jakością, pojazdy, trasy, miasta, firmy, finanse, badania, zdarzenia, ustawienia)
- [ ] EventBus, seedowany RNG, pętla symulacji (pauza, x1/x2/x4), kalendarz (dzień/miesiąc/rok, pory roku)
- [ ] Rejestr danych + szkielety plików danych
- [ ] Renderer: kamera (pan/zoom), rysowanie kafli, pętla rAF oddzielona od symulacji
- [ ] Framework UI (panele, okna, przyciski, wykresy sparkline), HUD
- [ ] Zapis/odczyt (localStorage + eksport pliku)
- [ ] `docs/CONTRACTS.md` — API modułów dla pozostałych agentów

### Etap 1 — systemy (równolegle)
**A. Dane i ekonomia produkcji**
- [ ] 5 epok, ~50 produktów, receptury (w tym alternatywne tańsze/premium), produkty uboczne i odpady
- [ ] Budynki: surowcowe, fabryki, sklepy, magazyny, laboratorium R&D, recykling, zielona energia
- [ ] Symulacja produkcji: bufory wejść/wyjść, jakość (surowiec → produkt), wydajność zależna od pracowników i badań
- [ ] Rynek: ceny od podaży/popytu, sezonowość, eksport (centrum eksportowe)
- [ ] Finanse: koszty stałe, P&L miesięczny, kredyty, wycena firmy, bankructwo
- [ ] R&D: drzewo technologii, odblokowania produktów/pojazdów, bonusy wydajności, automatyzacja
- [ ] Ekologia: emisje, zanieczyszczenie mapy, reputacja, pozwolenia, zielone produkty
- [ ] Pracownicy: rynek pracy per miasto, zasięg dojazdu, płace
- [ ] Testy jednostkowe balansu (łańcuch musi być opłacalny, ale nie trywialnie)

**B. Świat i miasta**
- [ ] Proceduralna mapa (szum: morze, rzeki, równiny, lasy, wzgórza, góry, pustynie, klimat)
- [ ] Złoża z jakością, żyzność gleby
- [ ] Miasta: nazwy, populacja, klasy (biedni/średni/bogaci), preferencje, zapotrzebowanie per produkt i epoka
- [ ] Wzrost/spadek miast od zaspokojenia popytu, rozbudowa zabudowy na mapie
- [ ] Pogoda i katastrofy (susza, sztorm, powódź, trzęsienie), wydarzenia polityczne (podatek emisyjny, subsydia, strajki, boom)

**C. Logistyka**
- [ ] Budowa dróg/torów/mostów, koszty terenu, rozbiórka
- [ ] Pathfinding A* na grafie sieci, cache tras
- [ ] Pojazdy: ciężarówki, pociągi, statki, drony (epoka cyfrowa), ładowność, prędkość, koszty, starzenie
- [ ] Trasy: lista przystanków z rozkazami załadunku/rozładunku, priorytety, auto-connect
- [ ] Huby/magazyny, stacje, porty; intermodalność
- [ ] Przepustowość i korki (spowolnienie), statystyki tras

**D. Renderowanie**
- [ ] Teren z cieniowaniem, woda animowana, lasy, zabudowa miast
- [ ] Budynki rysowane proceduralnie z ikonami produktów i animacją pracy (dym, kółka)
- [ ] Pojazdy w ruchu, ładunek widoczny
- [ ] Zoom semantyczny (blisko detale, daleko ikony i przepływy)
- [ ] Nakładki: popyt, zanieczyszczenie, rentowność, przepustowość, złoża
- [ ] Cykl dnia/nocy i pory roku (tint), opcjonalny tilt-shift

**E. UI/UX**
- [ ] Menu główne, nowa gra (seed, rozmiar, trudność, liczba rywali), ustawienia
- [ ] Menu budowy per kategoria, podgląd kosztu, walidacja miejsca
- [ ] Inspektor budynku / miasta / pojazdu / trasy
- [ ] Dashboard CEO (KPI + wykresy), widok łańcuchów (żywy diagram), lista firm/rankingi
- [ ] Minimapa z nakładkami, powiadomienia, podpowiedzi kontekstowe
- [ ] Encyklopedia, tooltipy, skróty klawiszowe
- [ ] Blueprinty (zapis/wklejanie układów)

**F. Gra, AI, dźwięk**
- [ ] AI konkurenci (3 poziomy trudności): wybór łańcucha, budowa, trasy, sklepy
- [ ] Kampania: 5 scenariuszy z celami (tutorial → era cyfrowa), ekran zwycięstwa/porażki
- [ ] Mentor/doradca + samouczek krokowy
- [ ] Cele sandboxa (kamienie milowe)
- [ ] Audio: ambient generatywny, SFX UI, dźwięki kontekstowe wg kamery, głośności w ustawieniach
- [ ] Mody: import JSON z produktami/budynkami

### Etap 2 — integracja i QA
- [ ] Spięcie wszystkich systemów, `npm run build` i `typecheck` bez błędów
- [ ] Playtest w przeglądarce: pełny łańcuch od farmy do sklepu, pociąg, statek, awans epoki
- [ ] Balans ekonomii (pierwsze 10 min zyskowne, średnia gra wymaga optymalizacji)
- [ ] Wydajność (mapa 256×256, 300 pojazdów, 60 FPS)
- [ ] README z instrukcją uruchomienia i sterowaniem
