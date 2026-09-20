# Browsertests

Twee suites die de app in een echte Chromium aansturen. Ze bestaan om aan te
tonen dat het opschonen geen enkele werking heeft weggenomen, en om dat bij
volgende wijzigingen opnieuw te kunnen aantonen.

| Bestand | Dekt |
| --- | --- |
| `mechanics.test.js` | Elke functie van de app: inkomsten en lasten, maandelijks en eenmalig, afvinken, overslaan, afwijkende datum, categorieën met en zonder budget, boekingen op rekening en contant, spaardoelen vrij en met vaste termijn, stortingen, verwijderen met ongedaan maken, beginsaldo, de doorrekening over maanden heen, en of alles een herlaadbeurt overleeft. |
| `keyboard.test.js` | Focus, Escape, Tab binnen het venster, achtergrondvergrendeling en Enter als bevestiging. |

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

Let op: `mechanics.test.js` schrijft in de opslag van de testbrowser, niet in
die van jou. De suite begint bij een leeg profiel.
