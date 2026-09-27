# Industry Giant 3

Przeglądarkowy tycoon przemysłowy inspirowany klasycznym *Industry Giant 2*. Budujesz imperium
od farmy zboża w 1850 roku po smartfony i recykling w erze cyfrowej: zakładasz farmy, kopalnie,
fabryki i sklepy, łączysz je drogami, torami i szlakami wodnymi, obsługujesz żywe miasta i
rywalizujesz z firmami sterowanymi przez AI.

Gra działa w całości w przeglądarce (TypeScript + Vite, Canvas 2D, vanilla DOM, dźwięk
syntezowany w WebAudio), bez serwera i bez zależności runtime.

## Uruchomienie

Wymagany Node.js 18+ (zalecany 20+).

```bash
npm install        # instalacja zależności deweloperskich
npm run dev        # serwer deweloperski (domyślnie http://localhost:5173)
npm run build      # typecheck + build produkcyjny do katalogu dist/
npm run preview    # podgląd zbudowanej wersji
npm run typecheck  # tylko sprawdzenie typów
npm test           # testy (Vitest)
```

Zbudowaną grę (`dist/`) można wystawić na dowolnym statycznym hostingu — ścieżki są względne.

Tryb deweloperski: `http://localhost:5173/?autostart&seed=123&size=64` od razu startuje grę,
a w konsoli przeglądarki dostępny jest `window.ig3` (kontekst gry).

## Sterowanie

### Mysz

| Akcja | Działanie |
|---|---|
| LPM | wybór obiektu / użycie narzędzia |
| LPM + przeciągnij | przesuwanie mapy (w trybie inspekcji), rysowanie dróg/torów, zaznaczanie obszaru |
| PPM / ŚPM + przeciągnij | przesuwanie mapy |
| PPM (klik) | anulowanie narzędzia / odznaczenie |
| Kółko | przybliżanie / oddalanie (do kursora) |
| Klik na minimapie | skok kamery |

### Klawiatura

| Klawisz | Działanie |
|---|---|
| W A S D / strzałki | przesuwanie mapy (Shift = szybciej) |
| Spacja | pauza / wznowienie |
| 1 / 2 / 3 | prędkość ×1 / ×2 / ×4 |
| Esc | anuluj narzędzie → zamknij okno → menu gry (pauza) |
| B | menu budowy |
| R / T | drogi / tory (w narzędziu budowy R = obrót budynku) |
| L | nowa trasa (klikaj przystanki, Enter = utwórz) |
| K | auto-połączenie (producent → odbiorca: droga + trasa + pojazd) |
| X | rozbiórka |
| C | panel CEO (finanse, budynki, trasy, kredyty, badania, konkurencja) |
| J | widok łańcuchów produkcji |
| U | lista tras |
| I | badania |
| E | encyklopedia |
| P | blueprinty |
| N | powiadomienia |
| M | minimapa pokaż/ukryj |
| G | siatka kafli |
| O / Shift+O | następna nakładka mapy / wyłącz nakładkę |
| = / - | przybliż / oddal |
| Ctrl+S | szybki zapis |
| F1 / H | pomoc i skróty |

## Szybki start — pierwszy łańcuch (farma → młyn → piekarnia → sklep)

Najłatwiej zacząć od kampanii: **Kampania → 1. Chleb powszedni** prowadzi krok po kroku.
W trybie swobodnym:

1. **Farma zboża** — `🌾 Surowce` → „Farma zboża”. Postaw ją na żyznej równinie blisko miasta
   (karta przy kursorze pokazuje koszt, żyzność gleby i najbliższe miasto).
2. **Młyn** i **piekarnia** — `🏭 Fabryki`. Stawiaj je między farmą a miastem: krótsze trasy = niższe koszty.
3. **Sklep spożywczy** — `🏪 Handel`, w mieście lub tuż przy nim. Karta pokaże popyt na towary i liczbę klientów w zasięgu.
4. **Połącz budynki** — narzędzie `🔗 Auto-połącz` [K]: kliknij producenta, potem odbiorcę
   (farma → młyn, młyn → piekarnia, piekarnia → sklep). Droga, trasa i wóz powstaną automatycznie.
   Alternatywnie w inspektorze budynku: „Połącz z…”.
5. **Przyspiesz czas** (2 lub 3) i obserwuj: wozy kursują, sklep sprzedaje, gotówka rośnie.
6. Jeśli coś nie działa, **kliknij budynek** — inspektor wyjaśnia, czego brakuje (surowców, odbioru,
   pracowników…), a widok łańcuchów [J] pokazuje wąskie gardła na czerwono.
7. Zysk inwestuj w kolejne łańcuchy, pojazdy i badania (🔬 — ustaw budżet R&D, aby badać szybciej).

## Funkcje

- **Tryb swobodny** na proceduralnej mapie (rozmiar, typ: kontynent/wybrzeże/wyspy/archipelag/śródlądzie,
  liczba miast i rywali, poziom wody, zasoby, epoka startowa, katastrofy i polityka)
  oraz **kampania** — 5 scenariuszy od samouczka (1850) po erę cyfrową (2020), z celami, terminami i nagrodami.
- **5 epok** (1850–2020), ~64 produkty, ~80 receptur (w tym alternatywne tańsze/premium), ~70 budynków,
  jakość towarów, produkty uboczne i odpady, psucie się żywności.
- **Logistyka**: drogi (gruntowe/utwardzone/autostrady), tory (zwykłe/zelektryfikowane/KDP), mosty,
  szlaki wodne i drony; ciężarówki, pociągi z wagonami, statki; stacje, porty, magazyny/huby,
  trasy wieloprzystankowe z rozkazami załadunku/rozładunku, korki i przepustowość.
- **Żywe miasta**: popyt zależny od klas społecznych, epoki, pory roku i preferencji; wzrost miast
  zależny od zadowolenia; rynek pracy i opinia miasta o firmie (pozwolenia na budowę).
- **Ekonomia**: ceny z podaży i popytu, eksport, P&L, kredyty, wycena firmy, podatki, bankructwo.
- **Badania** — drzewo 37 technologii z kolejką, odblokowania budynków/pojazdów/produktów, bonusy wydajności.
- **Ekologia** — emisje, zanieczyszczenie mapy, eko-ocena, reputacja, podatek emisyjny, recykling, zielona energia.
- **Konkurencja AI** o różnych osobowościach i trzech poziomach trudności; przejmowanie budynków rywali.
- **Zdarzenia**: pogoda, susze, powodzie, sztormy, trzęsienia ziemi, strajki, boom/recesja, dotacje.
- **Interfejs**: panel CEO z wykresami, widok łańcuchów, inspektory z wyjaśnieniem statusu,
  8 nakładek (popyt, zanieczyszczenie, żyzność, wartość gruntu, przepustowość, rentowność, złoża, własność),
  minimapa, doradca, powiadomienia z „Pokaż”, encyklopedia, blueprinty (zapis i wklejanie układów).
- **Grafika**: proceduralne budynki i pojazdy, zoom semantyczny, cykl dnia i nocy, pory roku,
  pogoda, opcjonalny tilt-shift; **dźwięk**: generatywna muzyka, efekty i ambient zależny od widoku.
- **Zapis/odczyt**: 6 slotów + autozapis (localStorage), eksport/import pliku `.ig3save`.
- **Ustawienia**: głośności, autozapis, skala interfejsu (85–150%), dzień/noc, tilt-shift, ograniczenie animacji.
- **Mody**: import pakietów JSON z produktami/budynkami (przykład: `src/data/mods/example.json`).

## Znane ograniczenia

- Gra jest przeznaczona na komputery stacjonarne (mysz + klawiatura); na ekranach węższych niż ~800 px
  interfejs jest ciasny, a sterowanie dotykiem nie jest wspierane.
- Grafika 2D „z góry” (bez 3D), brak trybu wieloosobowego.
- Balans ekonomii jest wstępny — szczególnie tempo badań bez budżetu R&D i opłacalność kolei na krótkich
  dystansach mogą wymagać dopracowania.
- Nazwy tras między stacjami są generyczne („Stacja kolejowa → Stacja kolejowa”) — można je zmienić w oknie trasy.
- Zapisy są trzymane w localStorage przeglądarki — wyczyszczenie danych strony usuwa zapisy
  (użyj eksportu do pliku, aby zachować kopię).
- Dźwięk startuje dopiero po pierwszym kliknięciu lub naciśnięciu klawisza (polityka autoodtwarzania przeglądarek).
