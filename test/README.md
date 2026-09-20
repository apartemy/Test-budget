# Browsertests

Twee suites die de app in een echte Chromium aansturen. Ze bestaan om aan te
tonen dat het opschonen geen enkele werking heeft weggenomen, en om dat bij
volgende wijzigingen opnieuw te kunnen aantonen.

| Bestand | Dekt |
| --- | --- |
| `mechanics.test.js` | Elke functie van de app: inkomsten en lasten, maandelijks en eenmalig, afvinken, overslaan, afwijkende datum, categorieën met en zonder budget, boekingen op rekening en contant, spaardoelen vrij en met vaste termijn, stortingen, verwijderen met ongedaan maken, beginsaldo, de doorrekening over maanden heen, en of alles een herlaadbeurt overleeft. |
| `features.test.js` | Boekingen die bij hun eigen maand horen en de eenmalige verhuizing van oude gegevens, de weekendregel voor vaste lasten, de weergavekeuze, de exportherinnering, de eigen bevestigingsvensters in plaats van `confirm()`, en vegen tussen maanden. |
| `keyboard.test.js` | Focus, Escape, Tab binnen het venster, achtergrondvergrendeling en Enter als bevestiging. |
| `offline.test.js` | Of de service worker zich registreert, of de app-shell inclusief `app.css` en `app.js` in de cache staat, of caches van oudere versies zijn opgeruimd, en of de app zonder internet nog opstart. De verwachte cachenaam leest hij uit `sw.js`, dus een versieverhoging breekt deze test niet. |

## Draaien

```sh
cd test
npm install
npm test
```

`run.js` start zelf een statische server op `budget/` en geeft de suites de
URL mee. Geen losse server nodig.

Op een machine waar Chromium al klaarstaat buiten npm om, wijs je die aan met
`CHROMIUM_PATH=/pad/naar/chromium npm test`. Tegen een draaiende kopie testen
kan met `BUDGET_URL=https://... node mechanics.test.js`.

Let op: de suites schrijven in de opslag van de testbrowser, niet in die van
jou. Elke suite begint bij een leeg profiel.

## Schermafbeeldingen voor het installatievenster

`screenshots.js` vult de app met een voorbeeldmaand en schrijft
`budget/screenshots/narrow.png` en `wide.png`, waar `manifest.webmanifest`
naar verwijst. Draai het opnieuw als de vormgeving verandert:

```sh
cd test
node screenshots.js
```
