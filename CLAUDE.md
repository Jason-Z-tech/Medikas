# Medi-Lexikon Schweiz – Hinweise für Claude

Statische Webseite ohne Build und ohne Pakete (nur Node.js-Bordmittel für Skripte und Tests).

- Sprache: Deutsch mit **Schweizer Rechtschreibung – nie «ß», immer «ss»**. Gilt für Code-Texte, Daten und Doku.
- Strikte CSP (`index.html`): keine Inline-Skripte, keine `style`-Attribute, keine externen Quellen.
- Daten nur in `data/src/` bearbeiten (Format `data/SCHEMA.md`, Inhalt `data/REDAKTION.md`), danach
  `node scripts/validate.mjs` und `node scripts/build-data.mjs`. `data/medikamente.js` und `data/details/` sind erzeugt.
- Tests: `node tests/test.mjs` (Browser: `CHROME_PATH=… CHROME_NO_SANDBOX=1` unter Linux), schnell: `--ohne-browser`.
- Medizinische Inhalte: lieber weglassen als raten; massgebend ist die Swissmedic-Fachinformation.
