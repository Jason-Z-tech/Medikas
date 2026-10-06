// Bündelt die Quelldaten (data/src) zu data/medikamente.js, die die Webseite lädt.
// Aufruf: node scripts/build-data.mjs
// Bricht ab, wenn die Prüfung (validate.mjs) Fehler findet.

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { MED_ROOT, NW_STUFEN, ladeVokabular, vokabularSets, pruefeVokabular, pruefeMonografie, monografieDateien } from './daten.mjs';

const vok = vokabularSets(ladeVokabular());
const fehler = pruefeVokabular(vok);
const wirkstoffe = [];

for (const datei of monografieDateien()) {
  const m = JSON.parse(readFileSync(datei, 'utf8'));
  const p = pruefeMonografie(m, datei, vok);
  for (const f of p.fehler) fehler.push(`${path.basename(datei)}: ${f}`);
  // Leere Stufen und leere Listen weglassen – spart Platz.
  const nw = {};
  for (const s of NW_STUFEN) if (m.nebenwirkungen?.[s]?.length) nw[s] = m.nebenwirkungen[s];
  m.nebenwirkungen = nw;
  for (const key of Object.keys(m)) if (Array.isArray(m[key]) && m[key].length === 0) delete m[key];
  wirkstoffe.push(m);
}

if (fehler.length) {
  console.error(fehler.map((f) => `FEHLER ${f}`).join('\n'));
  console.error(`\n${fehler.length} Fehler – data/medikamente.js wurde nicht geschrieben. Details: node scripts/validate.mjs`);
  process.exit(1);
}

// Priorität aus dem Verzeichnis (1 = sehr häufig verwendet) – die Suche bevorzugt bekannte Wirkstoffe leicht.
const prio = new Map(vok.substanzen.map((s) => [s.id, s.prioritaet]));
for (const w of wirkstoffe) if (prio.has(w.id)) w.prio = prio.get(w.id);
const mitMono = new Set(wirkstoffe.map((w) => w.id));
// Wirkstoffe aus dem Verzeichnis ohne eigene Monografie erscheinen als Kurzeintrag in der Suche.
const kurzeintraege = vok.substanzen
  .filter((s) => !mitMono.has(s.id))
  .map(({ id, name, atc, klasse, handelsnamen, abgabe, prioritaet }) => ({ id, name, atc, klasse, handelsnamen, abgabe, prio: prioritaet }));

const stand = wirkstoffe.map((w) => w.stand).sort().at(-1) ?? null;
const daten = {
  stand,
  wirkstoffe: wirkstoffe.sort((a, b) => a.name.localeCompare(b.name, 'de')),
  kurzeintraege,
  gruppen: vok.gruppen.map(({ id, name, beschreibung, art }) => ({ id, name, beschreibung, art })),
  krankheiten: vok.krankheiten.map(({ id, name, synonyme, kategorie }) => ({ id, name, synonyme, kategorie })),
};

// Lange Texte, die nur die Wirkstoffseite braucht, kommen in Teildateien nach Anfangsbuchstabe
// (data/details/a.js …) und werden erst beim Öffnen einer Seite geladen. Der Kern bleibt klein.
export const DETAIL_FELDER = ['wirkmechanismus', 'nebenwirkungen', 'schwangerschaft', 'stillzeit', 'hinweise', 'darreichung'];
export const detailTeil = (id) => (/^[a-z]/.test(id) ? id[0] : '0');
const teile = new Map();
for (const w of daten.wirkstoffe) {
  const d = {};
  for (const f of DETAIL_FELDER) {
    if (w[f] !== undefined) d[f] = w[f];
    delete w[f];
  }
  const t = detailTeil(w.id);
  if (!teile.has(t)) teile.set(t, {});
  teile.get(t)[w.id] = d;
}
daten.detailTeile = [...teile.keys()].sort();

const kopf = '// Erzeugt von scripts/build-data.mjs – nicht von Hand bearbeiten (Quelle: data/src).\n';
const ziel = path.join(MED_ROOT, 'data', 'medikamente.js');
writeFileSync(ziel, `${kopf}window.MEDI = ${JSON.stringify(daten)};\n`);
const detailOrdner = path.join(MED_ROOT, 'data', 'details');
rmSync(detailOrdner, { recursive: true, force: true });
mkdirSync(detailOrdner, { recursive: true });
let detailKb = 0;
for (const [t, inhalt] of teile) {
  const text = `${kopf}window.MEDI_DETAILS = Object.assign(window.MEDI_DETAILS || {}, ${JSON.stringify(inhalt)});\n`;
  writeFileSync(path.join(detailOrdner, `${t}.js`), text);
  detailKb += text.length / 1024;
}
const kb = Math.round(readFileSync(ziel).length / 1024);
console.log(`data/medikamente.js geschrieben: ${wirkstoffe.length} Monografien, ${kurzeintraege.length} Kurzeinträge, ` +
  `${daten.krankheiten.length} Krankheiten, ${daten.gruppen.length} Gruppen (${kb} KB, Details ${Math.round(detailKb)} KB in ${teile.size} Teilen).`);
