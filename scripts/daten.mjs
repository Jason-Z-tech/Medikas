// Lädt und prüft die Quelldaten in data/src – nur Node-Bordmittel.
// Wird von validate.mjs (Prüfung) und build-data.mjs (Bündeln für die Webseite) benutzt.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MED_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SRC = path.join(MED_ROOT, 'data', 'src');
export const MONO_DIR = path.join(SRC, 'wirkstoffe');

export const NW_STUFEN = ['sehrHaeufig', 'haeufig', 'gelegentlich', 'selten', 'sehrSelten', 'unbekannt'];
export const SCHWERE = ['schwer', 'mittel', 'leicht'];
export const ABGABE = ['A', 'B', 'D', 'E'];
const FELDER = new Set([
  'id', 'name', 'synonyme', 'kombinationAus', 'atc', 'klasse', 'kurz', 'gruppen', 'handelsnamen', 'abgabe',
  'darreichung', 'indikationen', 'wirkmechanismus', 'kontraindikationen', 'vorsicht', 'kontraMedikamente',
  'interaktionen', 'nebenwirkungen', 'schwangerschaft', 'stillzeit', 'hinweise', 'stand',
]);

export function slug(text) {
  return String(text)
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const readJson = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback);

export function ladeVokabular() {
  const substanzen = readJson(path.join(SRC, 'substanzen.json'), []);
  const gruppen = readJson(path.join(SRC, 'gruppen.json'), []);
  const krankheiten = readJson(path.join(SRC, 'krankheiten.json'), []);
  return { substanzen, gruppen, krankheiten };
}

export function monografieDateien() {
  if (!existsSync(MONO_DIR)) return [];
  return readdirSync(MONO_DIR).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(MONO_DIR, f));
}

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isStrArr = (v) => Array.isArray(v) && v.every(isStr);

/** Prüft eine Monografie. Gibt { fehler: [], warnungen: [] } zurück. */
export function pruefeMonografie(m, datei, vok) {
  const fehler = [];
  const warnungen = [];
  const F = (msg) => fehler.push(msg);
  const W = (msg) => warnungen.push(msg);
  const subIds = vok.subIds;
  const grpIds = vok.grpIds;
  const kIds = vok.kIds;

  if (!m || typeof m !== 'object' || Array.isArray(m)) return { fehler: ['kein JSON-Objekt'], warnungen };
  for (const key of Object.keys(m)) if (!FELDER.has(key)) F(`unbekanntes Feld «${key}»`);

  if (!isStr(m.id) || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(m.id)) F('id fehlt oder ist kein gültiger slug');
  if (datei && m.id && path.basename(datei, '.json') !== m.id) F(`id «${m.id}» passt nicht zum Dateinamen`);
  if (!isStr(m.name)) F('name fehlt');
  if (m.synonyme !== undefined && !isStrArr(m.synonyme)) F('synonyme muss eine Liste von Texten sein');
  if (m.kombinationAus !== undefined) {
    if (!isStrArr(m.kombinationAus)) F('kombinationAus muss eine Liste von ids sein');
    else for (const id of m.kombinationAus) if (!subIds.has(id)) W(`kombinationAus: «${id}» nicht im Wirkstoffverzeichnis`);
  }
  if (!isStrArr(m.atc) || m.atc.length === 0) F('atc fehlt');
  else for (const c of m.atc) if (!/^[A-Z](\d\d([A-Z]([A-Z](\d\d)?)?)?)?$/.test(c)) F(`ATC-Code «${c}» ungültig`);
  if (!isStr(m.klasse)) F('klasse fehlt');
  if (!isStr(m.kurz)) F('kurz fehlt');
  else if (m.kurz.length > 200) W(`kurz ist ${m.kurz.length} Zeichen lang (Ziel ≤ 160)`);
  if (!isStrArr(m.gruppen)) F('gruppen muss eine Liste sein');
  else for (const g of m.gruppen) if (!grpIds.has(g)) F(`unbekannte Gruppe «${g}»`);
  if (!isStrArr(m.handelsnamen)) F('handelsnamen muss eine Liste sein');
  else if (m.handelsnamen.length === 0) W('keine Handelsnamen');
  if (!Array.isArray(m.abgabe) || m.abgabe.some((a) => !ABGABE.includes(a))) F('abgabe: nur A, B, D, E erlaubt');
  if (m.darreichung !== undefined && !isStrArr(m.darreichung)) F('darreichung muss eine Liste von Texten sein');
  if (!isStr(m.wirkmechanismus)) F('wirkmechanismus fehlt');
  else if (m.wirkmechanismus.length < 80) W('wirkmechanismus sehr kurz');

  const pruefeIdListe = (feld, pflicht) => {
    const arr = m[feld];
    if (arr === undefined && !pflicht) return;
    if (!Array.isArray(arr)) return F(`${feld} muss eine Liste sein`);
    if (pflicht && arr.length === 0) F(`${feld} ist leer`);
    arr.forEach((e, i) => {
      if (!e || !isStr(e.text)) return F(`${feld}[${i}].text fehlt`);
      for (const key of Object.keys(e)) if (!['text', 'ids'].includes(key)) F(`${feld}[${i}]: unbekanntes Feld «${key}»`);
      if (e.ids === undefined) return;
      if (!isStrArr(e.ids)) return F(`${feld}[${i}].ids muss eine Liste sein`);
      for (const id of e.ids) if (!kIds.has(id)) F(`${feld}[${i}]: unbekannte Krankheit «${id}»`);
    });
  };
  pruefeIdListe('indikationen', true);
  pruefeIdListe('kontraindikationen', false);
  pruefeIdListe('vorsicht', false);

  const pruefeRef = (feld, mitSchwere) => {
    const arr = m[feld];
    if (arr === undefined) return;
    if (!Array.isArray(arr)) return F(`${feld} muss eine Liste sein`);
    arr.forEach((e, i) => {
      if (!e || !isStr(e.text)) return F(`${feld}[${i}].text fehlt`);
      const erlaubt = mitSchwere ? ['text', 'ref', 'effekt', 'schwere'] : ['text', 'ref', 'grund'];
      for (const key of Object.keys(e)) if (!erlaubt.includes(key)) F(`${feld}[${i}]: unbekanntes Feld «${key}»`);
      if (mitSchwere) {
        if (!isStr(e.effekt)) F(`${feld}[${i}].effekt fehlt`);
        if (!SCHWERE.includes(e.schwere)) F(`${feld}[${i}].schwere muss schwer, mittel oder leicht sein`);
      } else if (!isStr(e.grund)) F(`${feld}[${i}].grund fehlt`);
      if (e.ref === undefined) return;
      if (!isStrArr(e.ref)) return F(`${feld}[${i}].ref muss eine Liste sein`);
      for (const r of e.ref) {
        if (r.startsWith('gruppe:')) {
          if (!grpIds.has(r.slice(7))) F(`${feld}[${i}]: unbekannte Gruppe «${r}»`);
        } else if (!subIds.has(r)) F(`${feld}[${i}]: unbekannter Wirkstoff «${r}» (nicht in substanzen.json)`);
        if (r === m.id) F(`${feld}[${i}]: verweist auf sich selbst`);
      }
    });
  };
  pruefeRef('kontraMedikamente', false);
  pruefeRef('interaktionen', true);

  const nw = m.nebenwirkungen;
  if (!nw || typeof nw !== 'object' || Array.isArray(nw)) F('nebenwirkungen fehlt');
  else {
    for (const key of Object.keys(nw)) if (!NW_STUFEN.includes(key)) F(`nebenwirkungen: unbekannte Stufe «${key}»`);
    let n = 0;
    for (const stufe of NW_STUFEN) {
      if (nw[stufe] === undefined) continue;
      if (!isStrArr(nw[stufe])) F(`nebenwirkungen.${stufe} muss eine Liste von Texten sein`);
      else n += nw[stufe].length;
    }
    if (n < 3) W(`nur ${n} Nebenwirkungen`);
  }
  for (const key of ['schwangerschaft', 'stillzeit']) if (m[key] !== undefined && !isStr(m[key])) F(`${key} muss Text sein`);
  if (m.hinweise !== undefined && !isStrArr(m.hinweise)) F('hinweise muss eine Liste von Texten sein');
  if (!isStr(m.stand) || !/^\d{4}-\d{2}$/.test(m.stand)) F('stand fehlt (Format JJJJ-MM)');

  const text = JSON.stringify(m);
  if (text.includes('ß')) F('enthält «ß» – Schweizer Schreibweise verlangt «ss»');
  return { fehler, warnungen };
}

export function pruefeVokabular(vok) {
  const fehler = [];
  const dup = (arr, name) => {
    const seen = new Set();
    for (const e of arr) {
      if (!e.id || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.id)) fehler.push(`${name}: ungültige id «${e.id}»`);
      if (seen.has(e.id)) fehler.push(`${name}: doppelte id «${e.id}»`);
      seen.add(e.id);
      if (!isStr(e.name)) fehler.push(`${name}: «${e.id}» ohne Namen`);
      if (JSON.stringify(e).includes('ß')) fehler.push(`${name}: «${e.id}» enthält «ß»`);
    }
  };
  dup(vok.substanzen, 'substanzen.json');
  dup(vok.gruppen, 'gruppen.json');
  dup(vok.krankheiten, 'krankheiten.json');
  return fehler;
}

export function vokabularSets(vok) {
  return {
    ...vok,
    subIds: new Set(vok.substanzen.map((s) => s.id)),
    grpIds: new Set(vok.gruppen.map((g) => g.id)),
    kIds: new Set(vok.krankheiten.map((k) => k.id)),
  };
}
