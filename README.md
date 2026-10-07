# Medi-Lexikon Schweiz

Unabhängiges, werbefreies Nachschlagewerk zu den in der Schweiz zugelassenen Medikamenten:
Wirkungsweise, Gegenanzeigen (Krankheiten und Medikamente), Wechselwirkungen und Nebenwirkungen nach Häufigkeit –
mit schlauer Suche, auch nach Krankheit.

- **Schlaue Suche:** Vorschläge ab dem ersten Buchstaben – für Wirkstoffe, Schweizer Markennamen, Krankheiten
  (auch Laienbegriffe wie «Zucker» oder «hoher Blutdruck») und Wirkstoffgruppen. Tippfehler und Schreibvarianten
  werden erkannt («asperin» → Aspirin, «parazetamol» → Paracetamol, «ibuprophen» → Ibuprofen).
- **Wirkstoffseiten:** Anwendungsgebiete, Wirkungsweise, Gegenanzeigen, «nicht zusammen einnehmen», Wechselwirkungen
  nach Schweregrad, Nebenwirkungen nach Häufigkeit (sehr häufig … sehr selten), Schwangerschaft/Stillzeit, Hinweise.
- **Krankheitsseiten:** Welche Medikamente helfen – und welche sind bei dieser Krankheit tabu oder nur mit Vorsicht.
- **Wechselwirkungen in beide Richtungen:** Jede Wirkstoffseite zeigt auch, was andere Monografien über diesen
  Wirkstoff oder seine Gruppen sagen (z. B. «starke CYP3A4-Hemmer» oder «QT-verlängernd»).
- **Datenschutz:** Keine Gesundheitsangaben, kein Tracking; nur das Farbschema wird lokal gespeichert.

## Starten

`index.html` im Browser öffnen – oder mit Vorschau-Server (lädt auch die Schriften):

```powershell
node scripts/serve.mjs
```

und http://localhost:8080/ öffnen. Kein Build und keine Pakete nötig (nur Node.js ab Version 18 für die Skripte).

## Veröffentlichen (GitHub Pages)

*Settings → Pages → Deploy from a branch → main / (root)*. Die Seite ist rein statisch; die
Sicherheitsregeln (Content-Security-Policy) stehen als `<meta>`-Tag in `index.html`, `.nojekyll` sorgt dafür,
dass GitHub die Dateien unverändert ausliefert.

## Daten

| Datei | Inhalt |
|---|---|
| `data/src/wirkstoffe/*.json` | eine Monografie pro Wirkstoff (Format: `data/SCHEMA.md`, Regeln: `data/REDAKTION.md`) |
| `data/src/substanzen.json` | Verzeichnis aller Wirkstoffe mit ATC-Code und Schweizer Handelsnamen |
| `data/src/krankheiten.json` | Krankheiten, Zustände und Situationen mit Synonymen |
| `data/src/gruppen.json` | Wirkstoffgruppen für die Wechselwirkungs-Hinweise |
| `data/src/geprueft.json` | Wirkstoffe, deren Monografie eine zusätzliche unabhängige Zweitprüfung hatte |
| `data/medikamente.js` | gebündelte Daten für die Webseite (erzeugt) |
| `data/praeparate.js` | optionale Swissmedic-Präparateliste (erzeugt, siehe unten) |

Nach Änderungen in `data/src`:

```powershell
node scripts/validate.mjs     # prüft Format, Verweise und Schweizer Schreibweise
node scripts/build-data.mjs   # schreibt data/medikamente.js
```

### Alle zugelassenen Präparate von Swissmedic einlesen

Swissmedic veröffentlicht monatlich die Liste der zugelassenen Humanarzneimittel als Excel-Datei
([Listen und Verzeichnisse](https://www.swissmedic.ch/swissmedic/de/home/services/listen_neu.html)).
Herunterladen und einlesen:

```powershell
node scripts/import-swissmedic.mjs Zugelassene_Packungen_HAM.xlsx --stand 2026-09
```

Das Skript erkennt die Spalten an den Überschriften, fasst Packungen zu Präparaten zusammen und verknüpft
sie über ATC-Code und Wirkstoffnamen mit den Monografien. Danach findet die Suche jedes zugelassene Präparat,
und jede Wirkstoffseite listet die zugehörigen Präparate.

## Testen

```powershell
node tests/test.mjs
```

Prüft die Suche (Tippfehler, Synonyme, Umlaute), den Excel-Import, alle Daten und klickt die Seite in Chrome
auf Desktop-, Tablet- und Handy-Breite durch (Suche, Tastatur, Hell/Dunkel, jede Wirkstoff-, Krankheits- und
Gruppenseite). Unter Linux ggf. `CHROME_PATH=/pfad/zu/chrome CHROME_NO_SANDBOX=1` setzen.

## Wichtig

Die Texte sind vereinfachte Zusammenfassungen ohne Gewähr. Massgebend sind die von Swissmedic genehmigten
Fach- und Patienteninformationen auf [swissmedicinfo.ch](https://www.swissmedicinfo.ch/) und die Beratung durch
Ärztin, Arzt oder Apotheke.
