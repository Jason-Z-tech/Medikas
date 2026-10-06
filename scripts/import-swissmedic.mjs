// Liest die offizielle Swissmedic-Liste der zugelassenen Humanarzneimittel (Excel) ein und erzeugt
// data/praeparate.js – damit findet die Suche jedes in der Schweiz zugelassene Präparat.
//
// 1. Auf https://www.swissmedic.ch/swissmedic/de/home/services/listen_neu.html die Liste
//    «Zugelassene Packungen» (oder «Zugelassene Arzneimittel HAM») als .xlsx herunterladen.
// 2. node scripts/import-swissmedic.mjs Pfad/zur/Liste.xlsx [--stand 2026-09]
//
// Die Spalten werden an ihren Überschriften erkannt (Swissmedic ändert die Reihenfolge gelegentlich).
// Präparate werden über den ATC-Code und den Wirkstoffnamen mit den Monografien verknüpft.
// Nur Node-Bordmittel, keine Pakete.

import { readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MED_ROOT, slug, monografieDateien, ladeVokabular } from './daten.mjs';

/* ---------- Minimaler XLSX-Leser ---------- */
const MAX_GROESSE = 300 * 1024 * 1024; // Schutz vor «Zip-Bomben»
export function entpacke(buffer, gesucht) {
  const sig = 0x06054b50;
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 66000); i--) {
    if (buffer.readUInt32LE(i) === sig) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Keine gültige .xlsx-Datei (ZIP-Verzeichnis fehlt).');
  const anzahl = buffer.readUInt16LE(eocd + 10);
  let p = buffer.readUInt32LE(eocd + 16);
  const out = {};
  for (let i = 0; i < anzahl; i++) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) break;
    const methode = buffer.readUInt16LE(p + 10);
    const groesse = buffer.readUInt32LE(p + 20);
    const entpackt = buffer.readUInt32LE(p + 24);
    const nameLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const kommentarLen = buffer.readUInt16LE(p + 32);
    const lokal = buffer.readUInt32LE(p + 42);
    const name = buffer.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + kommentarLen;
    if (gesucht && !gesucht(name)) continue;
    if (entpackt > MAX_GROESSE) throw new Error(`${name} ist entpackt zu gross (${Math.round(entpackt / 1e6)} MB).`);
    const start = lokal + 30 + buffer.readUInt16LE(lokal + 26) + buffer.readUInt16LE(lokal + 28);
    const daten = buffer.subarray(start, start + groesse);
    out[name] = (methode === 0 ? daten : inflateRawSync(daten, { maxOutputLength: MAX_GROESSE })).toString('utf8');
  }
  return out;
}

const ENT = Object.assign(Object.create(null), { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" });
const dekodiere = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] !== '#') return ENT[e] ?? m;
    const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
  });
const texte = (xml) => Array.from(xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)).map((m) => dekodiere(m[1])).join('');

function spalteIndex(ref) {
  const buchstaben = /^[A-Z]+/.exec(ref)[0];
  let n = 0;
  for (const c of buchstaben) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/** Liefert die Zeilen des ersten Tabellenblatts als Arrays von Texten. */
export function leseXlsx(buffer) {
  const dateien = entpacke(buffer, (n) => n === 'xl/sharedStrings.xml' || n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const strings = dateien['xl/sharedStrings.xml']
    ? Array.from(dateien['xl/sharedStrings.xml'].matchAll(/<si>([\s\S]*?)<\/si>/g)).map((m) => texte(m[1]))
    : [];
  // Erstes Blatt gemäss workbook.xml, sonst sheet1.xml
  let blatt = 'xl/worksheets/sheet1.xml';
  const wb = dateien['xl/workbook.xml'];
  const rels = dateien['xl/_rels/workbook.xml.rels'];
  if (wb && rels) {
    const rid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(wb)?.[1];
    const attr = (tag, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
    const rel = rid && Array.from(rels.matchAll(/<Relationship\b[^>]*>/g)).map((m) => m[0]).find((tag) => attr(tag, 'Id') === rid);
    const t = rel && attr(rel, 'Target');
    if (t) blatt = t.startsWith('/') ? t.slice(1) : `xl/${t}`;
  }
  const xml = dateien[blatt] || dateien['xl/worksheets/sheet1.xml'];
  if (!xml) throw new Error('Kein Tabellenblatt gefunden.');
  const zeilen = [];
  for (const zm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const zeile = [];
    for (const cm of zm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attr = cm[1];
      const inhalt = cm[2] || '';
      const ref = /\br="([A-Z]+)\d+"/.exec(attr)?.[1];
      const typ = /\bt="([^"]+)"/.exec(attr)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(inhalt)?.[1];
      let wert = '';
      if (typ === 's') wert = strings[Number(v)] ?? '';
      else if (typ === 'inlineStr') wert = texte(inhalt);
      else if (v !== undefined) wert = dekodiere(v);
      const spalte = ref ? spalteIndex(ref) : zeile.length;
      if (spalte > 16383) continue; // mehr Spalten als Excel erlaubt: ungültig
      zeile[spalte] = wert.trim();
    }
    zeilen.push(Array.from(zeile, (x) => x ?? ''));
  }
  return zeilen;
}

/* ---------- Spalten erkennen ---------- */
const SPALTEN = {
  nr: [/zulassungs.?n(umme)?r|^zul\.?.?nr/i],
  name: [/bezeichnung des arzneimittels/i, /bezeichnung|präparat|arzneimittel$/i],
  inhaber: [/zulassungsinhaber/i],
  kategorie: [/heilmittelcode/i],
  atc: [/atc/i],
  wirkstoffe: [/wirkstoff/i],
  abgabe: [/abgabekategorie (des )?arzneimittel/i, /abgabekategorie/i],
  anwendung: [/anwendungsgebiet/i],
  zulassung: [/erstzulassung/i],
};

export function erkenneSpalten(zeilen) {
  for (let z = 0; z < Math.min(zeilen.length, 40); z++) {
    const kopf = zeilen[z].map((x) => String(x).replace(/\s+/g, ' ').trim());
    const map = {};
    for (const [feld, muster] of Object.entries(SPALTEN)) {
      for (const re of muster) {
        const i = kopf.findIndex((h, idx) => re.test(h) && !Object.values(map).includes(idx));
        if (i >= 0) { map[feld] = i; break; }
      }
    }
    if (map.nr !== undefined && map.name !== undefined) return { kopfZeile: z, map };
  }
  throw new Error('Kopfzeile nicht gefunden (erwartet Spalten «Zulassungsnummer» und «Bezeichnung des Arzneimittels»).');
}

const excelDatum = (v) => {
  if (/^\d{5}(\.\d+)?$/.test(v)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(v)) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  return v;
};

/** Lateinische Swissmedic-Wirkstoffnamen grob auf unsere ids abbilden: «paracetamolum» → paracetamol. */
function wirkstoffKandidaten(text) {
  return String(text)
    .split(/[,;/+]| et /i)
    .map((t) => t.replace(/\(.*?\)/g, '').replace(/\b(ut|corresp\.?|anhydricum|hydricum|hydrochloridum|natricum|kalicum)\b.*$/i, '').trim())
    .filter(Boolean)
    .map((t) => slug(t.replace(/(um|us|i|is)$/i, '')));
}

export function verarbeite(zeilen, monografien) {
  const { kopfZeile, map } = erkenneSpalten(zeilen);
  const atcIndex = new Map();
  const idSet = new Set();
  for (const m of monografien) {
    idSet.add(m.id);
    for (const c of m.atc || []) {
      if (!atcIndex.has(c)) atcIndex.set(c, []);
      atcIndex.get(c).push(m.id);
    }
  }
  const nachNr = new Map();
  for (const zeile of zeilen.slice(kopfZeile + 1)) {
    const wert = (f) => (map[f] === undefined ? '' : String(zeile[map[f]] ?? '').replace(/\s+/g, ' ').trim());
    const nr = wert('nr').replace(/\.0$/, '');
    const name = wert('name');
    if (!/^\d+$/.test(nr) || !name) continue;
    if (nachNr.has(nr)) {
      const p = nachNr.get(nr);
      // Fehlende Angaben aus weiteren Packungen/Dosisstärken ergänzen
      for (const f of ['atc', 'wirkstoffe', 'abgabe', 'anwendung', 'inhaber']) if (!p[f] && wert(f)) p[f] = wert(f);
      continue;
    }
    nachNr.set(nr, {
      nr, name, inhaber: wert('inhaber'), atc: wert('atc'), wirkstoffe: wert('wirkstoffe'),
      abgabe: wert('abgabe'), kategorie: wert('kategorie'), anwendung: wert('anwendung'),
      zulassung: wert('zulassung') ? excelDatum(wert('zulassung')) : '',
    });
  }
  const liste = Array.from(nachNr.values());
  let verknuepft = 0;
  for (const p of liste) {
    const wid = new Set(atcIndex.get(p.atc) || []);
    if (!wid.size && p.wirkstoffe) {
      for (const k of wirkstoffKandidaten(p.wirkstoffe)) {
        const treffer = Array.from(idSet).find((id) => id === k || (k.length >= 6 && id.startsWith(k)));
        if (treffer) wid.add(treffer);
      }
    }
    p.wid = Array.from(wid);
    if (p.wid.length) verknuepft++;
    for (const key of Object.keys(p)) if (p[key] === '' || (Array.isArray(p[key]) && !p[key].length)) delete p[key];
  }
  liste.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return { liste, verknuepft, spalten: map };
}

/* ---------- Aufruf ---------- */
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const standIdx = args.indexOf('--stand');
  const stand = standIdx >= 0 ? args.splice(standIdx, 2)[1] : new Date().toISOString().slice(0, 7);
  if (!args.length) {
    console.error('Aufruf: node scripts/import-swissmedic.mjs Liste.xlsx [weitere.xlsx] [--stand JJJJ-MM]');
    process.exit(1);
  }
  const monografien = monografieDateien().map((f) => JSON.parse(readFileSync(f, 'utf8')));
  // Wirkstoffe ohne Monografie (Kurzeinträge) ebenfalls verknüpfen
  for (const s of ladeVokabular().substanzen) if (!monografien.some((m) => m.id === s.id)) monografien.push(s);
  const alle = new Map();
  for (const datei of args) {
    const { liste, verknuepft, spalten } = verarbeite(leseXlsx(readFileSync(datei)), monografien);
    console.log(`${path.basename(datei)}: ${liste.length} Präparate, ${verknuepft} mit Wirkstoff-Monografie verknüpft. Spalten: ${Object.keys(spalten).join(', ')}`);
    for (const p of liste) if (!alle.has(p.nr)) alle.set(p.nr, p);
  }
  const ziel = path.join(MED_ROOT, 'data', 'praeparate.js');
  const daten = { stand, quelle: 'Swissmedic – Zugelassene Humanarzneimittel', liste: Array.from(alle.values()) };
  writeFileSync(ziel, `// Erzeugt von scripts/import-swissmedic.mjs – Quelle: Swissmedic.\nwindow.MEDI_PRAEPARATE = ${JSON.stringify(daten)};\n`);
  console.log(`data/praeparate.js geschrieben: ${daten.liste.length} Präparate (Stand ${stand}).`);
}
