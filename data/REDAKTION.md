# Redaktionsrichtlinien Medi-Lexikon

Gilt für jede Monografie in `data/src/wirkstoffe/`. Format: siehe `SCHEMA.md`.
Leitsatz: **Lieber weniger, aber korrekt.** Nichts erfinden. Im Zweifel weglassen oder die vorsichtigere Angabe wählen.

## Grundlage

- Inhaltlich massgebend ist die von Swissmedic genehmigte Fachinformation (AIPS, swissmedicinfo.ch), Stand 2026.
  Wo sie nicht bekannt ist: gleichwertige europäische Fachinformation (SmPC) des Originalpräparats.
- Bei mehreren Präparaten desselben Wirkstoffs (z. B. Ibuprofen 200 mg rezeptfrei und 600 mg rezeptpflichtig)
  die Angaben zusammenfassen und Unterschiede im Text nennen.
- Topische Mittel (Haut, Auge, Nase): nur, was für diese Anwendung gilt. Systemische Wechselwirkungen
  nur, wenn die Fachinformation sie nennt.

## Felder

**kurz** – ein Satz, laienverständlich, ≤ 160 Zeichen: wofür und welche Art Mittel.
«Blutdrucksenker aus der Gruppe der ACE-Hemmer; auch bei Herzschwäche und nach Herzinfarkt.»

**indikationen** – nur in der Schweiz zugelassene Anwendungsgebiete, kurz und verständlich.
Jede Indikation mit passender Krankheits-id (`ids`), wenn eine passt (auch wenn der Text spezifischer ist).
Impfstoffe: Vorbeugung der Krankheit, id der Krankheit (z. B. `influenza`).

**wirkmechanismus** – 2–5 Sätze. Erster Satz in Alltagssprache («Senkt den Blutdruck, indem …»),
danach präzise Pharmakologie (Zielstruktur, Folge). Bei Prodrugs den Wirkmetaboliten nennen.

**kontraindikationen** – absolute Gegenanzeigen laut Fachinformation (Krankheiten, Zustände, Alter, Schwangerschaft).
Die banale «Überempfindlichkeit gegen den Wirkstoff oder Hilfsstoffe» weglassen; Kreuzallergien
(z. B. «Penicillinallergie», «Analgetika-Asthma») dagegen aufführen. Schwangerschaft/Stillzeit hier eintragen,
wenn die Fachinformation sie als Kontraindikation führt (mit Trimester). Altersgrenzen mit id `kinder`.

**vorsicht** – wichtigste Warnhinweise und relative Gegenanzeigen (Nieren-/Leberfunktion, ältere Menschen,
Herzrhythmus, Epilepsie, Depression, Blutungsneigung …), 3–10 Einträge, jeweils mit id.

**kontraMedikamente** – nur Kombinationen, die die Fachinformation ausdrücklich als kontraindiziert bezeichnet.
`grund`: Mechanismus und Folge in einem Satz.

**interaktionen** – 4–15 klinisch wichtigste Wechselwirkungen, sortiert nach Bedeutung.
`schwere`: `schwer` = vermeiden oder nur mit enger Überwachung/Dosisanpassung; `mittel` = Vorsicht, Kontrolle;
`leicht` = geringe Bedeutung. Möglichst auf Gruppen verweisen (`gruppe:starke-cyp3a4-hemmer`) statt Einzelstoffe aufzuzählen.
`effekt`: was passiert und was zu tun ist («Spiegel von X steigt – Dosis reduzieren, Spiegel kontrollieren»).

**nebenwirkungen** – Häufigkeitsklassen exakt wie in der Fachinformation:
sehr häufig ≥ 1/10 · häufig ≥ 1/100 bis < 1/10 · gelegentlich ≥ 1/1000 bis < 1/100 · selten ≥ 1/10'000 bis < 1/1000 ·
sehr selten < 1/10'000 · unbekannt = Häufigkeit nicht bekannt / nach Markteinführung.
Pro Klasse die 3–8 wichtigsten, keine Duplikate über Klassen hinweg. Schwere Nebenwirkungen
(Agranulozytose, Anaphylaxie, Stevens-Johnson-Syndrom, Leberversagen, QT-Verlängerung …) immer nennen, auch wenn selten.
Fachbegriff + Laienwort in Klammern, wo nötig: «Obstipation (Verstopfung)».
Ist die Klasse unsicher, die Angabe unter `unbekannt` führen statt zu raten.

**schwangerschaft / stillzeit** – je 1–2 Sätze mit klarer Aussage (erlaubt / nur nach Abwägung / kontraindiziert).

**hinweise** – 1–4 praktische Tipps: Einnahme (nüchtern, mit Essen, nicht zerkauen), Alkohol, Fahrtüchtigkeit,
Kontrollen (Blutbild, INR, Spiegel), nicht abrupt absetzen, Sonnenschutz.

**handelsnamen** – in der Schweiz vertriebene Marken (ohne Stärke/Form). Keine nur im Ausland üblichen
Namen (z. B. nicht «Tylenol», «Advil», «Coumadin»). Generika höchstens 2–3 als Beispiel («Amlodipin Mepha»).
Kombipräparate mit Zusatz « (Kombi)».

**abgabe** – Schweizer Abgabekategorien A, B, D, E (C gibt es seit 2019 nicht mehr).
Bei unterschiedlichen Kategorien je nach Stärke/Packung alle nennen.

**gruppen** – alle zutreffenden Gruppen aus `gruppen.json` – Klasse **und** Pharmakokinetik **und** Risiko.
Checkliste: Wird über CYP3A4/2D6/2C9/2C19/1A2 oder P-gp abgebaut (Substrat) oder hemmt/induziert es diese?
QT-verlängernd? serotonerg? zentral dämpfend? anticholinerg? Kalium ↑/↓, Natrium ↓? nieren-, leber-, gehörschädigend?
blutungs- oder ulkusfördernd? blutdrucksenkend, bradykardisierend? krampfschwellensenkend? myelosuppressiv,
immunsuppressiv? hypoglykämisch? photosensibilisierend? fruchtschädigend? Oberbegriffe nicht vergessen
(`antikoagulanzien`, `raas-hemmer`, `diuretika`).

## Sprache

- Deutsch, Schweizer Rechtschreibung: **nie «ß»**, immer «ss» (mässig, Grösse, Massnahme, schliessen).
- Schweizer Begriffe: Spital, Apotheke, Ärztin/Arzt. Zahlen mit Apostroph als Tausendertrennzeichen (10'000).
- Sachlich, ohne Werbung, ohne Dosierungsempfehlungen (ausser sicherheitsrelevante Höchstdosen in Hinweisen).
