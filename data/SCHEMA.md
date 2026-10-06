# Datenformat Medi-Lexikon

Alle Quelldaten liegen in `data/src/`. Daraus erzeugt `node scripts/build-data.mjs`
die Datei `data/medikamente.js`, die die Webseite lädt. Von Hand wird nur in `data/src/` gearbeitet.

| Datei | Inhalt |
|---|---|
| `src/substanzen.json` | Verzeichnis aller geplanten Wirkstoffe (id, Name, ATC, Handelsnamen, Priorität) |
| `src/gruppen.json` | Wirkstoffgruppen für Wechselwirkungen (`nsar`, `starke-cyp3a4-hemmer`, `qt-verlaengernd` …) |
| `src/krankheiten.json` | Krankheiten, Zustände und Situationen mit Synonymen (`hypertonie`, `schwangerschaft` …) |
| `src/wirkstoffe/<id>.json` | Eine Monografie pro Wirkstoff |

## Schreibweise

- Deutsch, **Schweizer Rechtschreibung: nie «ß», immer «ss»** (Grösse, mässig, Massnahme).
- Fachbegriffe, wo nötig, mit Laien-Erklärung in Klammern: «Dyspepsie (Verdauungsbeschwerden)».
- ids: Kleinbuchstaben, Ziffern, Bindestrich. ä→ae, ö→oe, ü→ue. Kombinationen: `amoxicillin-clavulansaeure`.

## Monografie `src/wirkstoffe/<id>.json`

```jsonc
{
  "id": "acetylsalicylsaeure",                 // = Dateiname
  "name": "Acetylsalicylsäure",                // deutscher INN-Name ohne Salz
  "synonyme": ["ASS", "Acetylsalicylic acid"],  // Abkürzungen, englischer INN, alte Namen – keine Marken
  "kombinationAus": [],                        // nur bei fixen Kombinationen: ids der Einzelwirkstoffe
  "atc": ["N02BA01", "B01AC06"],
  "klasse": "Nichtsteroidales Antirheumatikum (NSAR); Thrombozytenaggregationshemmer",
  "kurz": "Schmerz- und Fiebermittel; niedrig dosiert zur Hemmung der Blutplättchen.",   // ≤ 160 Zeichen, laienverständlich
  "gruppen": ["nsar", "thrombozytenaggregationshemmer", "blutungsrisiko-erhoehend"],    // ids aus gruppen.json
  "handelsnamen": ["Aspirin", "Aspirin Cardio", "Alcacyl", "Tiatral"],                   // Schweizer Marken; Kombis mit « (Kombi)»
  "abgabe": ["B", "D"],                        // Schweizer Abgabekategorien A, B, D, E
  "darreichung": ["Tabletten", "Brausetabletten", "Injektionslösung"],
  "indikationen": [
    { "text": "Leichte bis mässig starke Schmerzen", "ids": ["schmerzen"] },
    { "text": "Sekundärprävention nach Herzinfarkt oder Schlaganfall", "ids": ["herzinfarkt", "schlaganfall"] }
  ],
  "wirkmechanismus": "Hemmt irreversibel die Cyclooxygenase (COX-1 und COX-2) …",       // 2–6 Sätze
  "kontraindikationen": [                      // absolute Gegenanzeigen (Krankheiten/Zustände)
    { "text": "Aktive Magen- oder Zwölffingerdarmgeschwüre", "ids": ["magen-darm-ulkus"] },
    { "text": "Letztes Schwangerschaftsdrittel (bei Dosen > 100 mg/Tag)", "ids": ["schwangerschaft"] }
  ],
  "vorsicht": [                                // relative Gegenanzeigen / besondere Vorsicht
    { "text": "Asthma bronchiale (Analgetika-Asthma möglich)", "ids": ["asthma"] }
  ],
  "kontraMedikamente": [                       // Kombination kontraindiziert
    { "text": "Methotrexat ≥ 15 mg pro Woche", "ref": ["methotrexat"], "grund": "Erhöhte Methotrexat-Toxizität (verminderte Ausscheidung)." }
  ],
  "interaktionen": [                           // relevante Wechselwirkungen
    { "text": "Orale Antikoagulanzien", "ref": ["gruppe:vitamin-k-antagonisten", "gruppe:doak"],
      "effekt": "Deutlich erhöhtes Blutungsrisiko.", "schwere": "schwer" }   // schwer | mittel | leicht
  ],
  "nebenwirkungen": {                          // Häufigkeiten nach MedDRA-Konvention wie in der Fachinformation
    "sehrHaeufig": [],                         // ≥ 1/10
    "haeufig": ["Magenbeschwerden", "Dyspepsie (Verdauungsbeschwerden)"],            // ≥ 1/100 bis < 1/10
    "gelegentlich": ["Überempfindlichkeitsreaktionen", "Magen-Darm-Blutungen"],      // ≥ 1/1000 bis < 1/100
    "selten": ["Magen-Darm-Geschwüre", "Bronchospasmus"],                            // ≥ 1/10 000 bis < 1/1000
    "sehrSelten": ["Reye-Syndrom bei Kindern"],                                       // < 1/10 000
    "unbekannt": []                            // Häufigkeit nicht bekannt
  },
  "schwangerschaft": "Im 1. und 2. Drittel nur nach ärztlicher Abwägung; im 3. Drittel in analgetischer Dosis kontraindiziert.",
  "stillzeit": "Gelegentliche niedrige Dosen vertretbar; bei regelmässiger Einnahme abstillen.",
  "hinweise": ["Nicht bei Kindern und Jugendlichen unter 16 Jahren mit fieberhaften Virusinfekten (Reye-Syndrom)."],
  "stand": "2026-10"
}
```

### Verweise

- `ids` verweisen auf `krankheiten.json`. Passt keine id, bleibt `ids` leer – der Text wird trotzdem angezeigt.
- `ref` verweist auf einen Wirkstoff (`"methotrexat"`) aus `substanzen.json` oder eine Gruppe (`"gruppe:nsar"`).
  Mehrere Verweise sind erlaubt. Passt kein Verweis, bleibt `ref` leer.
- `gruppen` ist entscheidend für den Wechselwirkungs-Check: Nimmt jemand Clarithromycin
  (Gruppe `starke-cyp3a4-hemmer`) und schaut Simvastatin an, das auf `gruppe:starke-cyp3a4-hemmer` verweist,
  erscheint eine Warnung. Darum jede zutreffende Gruppe eintragen – auch pharmakokinetische
  (`starke-cyp3a4-hemmer`, `cyp3a4-induktoren`, `p-gp-hemmer` …) und Risikogruppen
  (`qt-verlaengernd`, `serotonerg`, `zns-daempfend`, `hyperkaliaemie-ausloesend` …).
