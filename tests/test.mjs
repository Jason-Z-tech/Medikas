// Tests für das Medi-Lexikon: Suche, Swissmedic-Import, Datenprüfung und Browser (Desktop, Tablet, Handy).
// Aufruf: node tests/test.mjs            (alles)
//         node tests/test.mjs --ohne-browser
// Browser: Chrome/Edge wird automatisch gesucht, sonst CHROME_PATH setzen (Linux-Container: CHROME_NO_SANDBOX=1).

import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ladeVokabular, vokabularSets, pruefeVokabular, pruefeMonografie, monografieDateien } from '../scripts/daten.mjs';
import { leseXlsx, verarbeite } from '../scripts/import-swissmedic.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const S = require('../js/suche.js');

let passed = 0;
const failures = [];
function check(condition, message) {
  if (condition) passed++;
  else failures.push(message);
}

/* ---------- Suche ---------- */
function testSuche() {
  const medi = {
    wirkstoffe: [
      { id: 'acetylsalicylsaeure', name: 'Acetylsalicylsäure', synonyme: ['ASS'], atc: ['N02BA01'], kurz: 'Schmerzmittel', handelsnamen: ['Aspirin', 'Aspirin Cardio', 'Alcacyl'] },
      { id: 'paracetamol', name: 'Paracetamol', atc: ['N02BE01'], handelsnamen: ['Dafalgan', 'Panadol', 'Influbene (Kombi)'] },
      { id: 'ibuprofen', name: 'Ibuprofen', atc: ['M01AE01'], handelsnamen: ['Algifor', 'Irfen'] },
      { id: 'citalopram', name: 'Citalopram', atc: ['N06AB04'], handelsnamen: ['Seropram'] },
    ],
    krankheiten: [
      { id: 'hypertonie', name: 'Bluthochdruck (Hypertonie)', synonyme: ['Hypertonie', 'hoher Blutdruck'], kategorie: 'Herz-Kreislauf' },
      { id: 'diabetes-typ-2', name: 'Diabetes Typ 2', synonyme: ['Zucker', 'Zuckerkrankheit'], kategorie: 'Stoffwechsel und Hormone' },
      { id: 'magen-darm-ulkus', name: 'Magen-Darm-Geschwür', synonyme: ['Magengeschwür'], kategorie: 'Leber, Magen und Darm' },
    ],
    gruppen: [{ id: 'nsar', name: 'Nichtsteroidale Antirheumatika (NSAR)' }],
  };
  const idx = S.baueIndex(medi);
  const erster = (q, opt) => S.suche(idx, q, opt)[0] || {};
  check(erster('aspe').id === 'acetylsalicylsaeure', '[Suche] «aspe» → Aspirin');
  check(erster('asperin').label === 'Aspirin', '[Suche] Tippfehler «asperin» → Aspirin');
  check(erster('parazetamol').id === 'paracetamol', '[Suche] «parazetamol» → Paracetamol');
  check(erster('ibuprophen').id === 'ibuprofen', '[Suche] «ibuprophen» → Ibuprofen');
  check(erster('zitalopram').id === 'citalopram', '[Suche] «zitalopram» → Citalopram');
  check(erster('bluthoch').id === 'hypertonie', '[Suche] «bluthoch» → Hypertonie');
  check(erster('blutdruck').id === 'hypertonie', '[Suche] «blutdruck» → Hypertonie (Wortanfang)');
  check(erster('zucker').id === 'diabetes-typ-2', '[Suche] Synonym «zucker» → Diabetes');
  check(erster('magengeschwur').id === 'magen-darm-ulkus', '[Suche] ohne Umlaut «magengeschwur»');
  check(erster('influbene').label === 'Influbene (Kombi)', '[Suche] Marke mit Zusatz «(Kombi)»');
  check(erster('N02BE').id === 'paracetamol', '[Suche] ATC-Code');
  check(S.suche(idx, 'xyzq').length === 0, '[Suche] Unsinn liefert nichts');
  check(erster('Dafalgan 500 mg').label === 'Dafalgan', '[Suche] Dosisangabe wird ignoriert («Dafalgan 500 mg»)');
  check(S.suche(idx, 'ci', { limit: 5 }).some((r) => r.id === 'citalopram'), '[Suche] «ci» (c vor i, noch unvollständig) findet Citalopram');
  check(S.suche(idx, '   ').length === 0, '[Suche] nur Leerzeichen liefert nichts');
  check(S.suche(idx, 'a', { typen: ['krankheit'] }).every((r) => r.typ === 'krankheit'), '[Suche] Typfilter');
  check(S.koelner('Asperin') === S.koelner('Aspirin'), '[Suche] Kölner Phonetik');
  const m = S.markiere('Acetylsalicylsäure', 'säure');
  check(m.length === 2 && m[1].mark && m[1].text === 'säure', '[Suche] Markierung mit Umlaut');
}

/* ---------- Swissmedic-Import mit kleiner Test-Excel ---------- */
function baueXlsx(zeilen) {
  const strings = [];
  const si = (t) => {
    let i = strings.indexOf(t);
    if (i < 0) { strings.push(t); i = strings.length - 1; }
    return i;
  };
  const col = (i) => String.fromCharCode(65 + i);
  const sheet = '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
    zeilen.map((z, r) => `<row r="${r + 1}">${z.map((v, c) => (typeof v === 'number'
      ? `<c r="${col(c)}${r + 1}"><v>${v}</v></c>`
      : `<c r="${col(c)}${r + 1}" t="s"><v>${si(v)}</v></c>`)).join('')}</row>`).join('') + '</sheetData></worksheet>';
  const sst = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map((s) => `<si><t>${s.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></si>`).join('')}</sst>`;
  const dateien = [['xl/worksheets/sheet1.xml', sheet], ['xl/sharedStrings.xml', sst]];
  const teile = [];
  const zentral = [];
  let offset = 0;
  for (const [name, inhalt] of dateien) {
    const roh = Buffer.from(inhalt);
    const daten = deflateRawSync(roh);
    const n = Buffer.from(name);
    const lokal = Buffer.alloc(30);
    lokal.writeUInt32LE(0x04034b50, 0); lokal.writeUInt16LE(20, 4); lokal.writeUInt16LE(8, 8);
    lokal.writeUInt32LE(daten.length, 18); lokal.writeUInt32LE(roh.length, 22); lokal.writeUInt16LE(n.length, 26);
    const z = Buffer.alloc(46);
    z.writeUInt32LE(0x02014b50, 0); z.writeUInt16LE(20, 4); z.writeUInt16LE(20, 6); z.writeUInt16LE(8, 10);
    z.writeUInt32LE(daten.length, 20); z.writeUInt32LE(roh.length, 24); z.writeUInt16LE(n.length, 28); z.writeUInt32LE(offset, 42);
    teile.push(lokal, n, daten);
    zentral.push(z, n);
    offset += lokal.length + n.length + daten.length;
  }
  const zBuf = Buffer.concat(zentral);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(dateien.length, 8); eocd.writeUInt16LE(dateien.length, 10);
  eocd.writeUInt32LE(zBuf.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...teile, zBuf, eocd]);
}

function testImport() {
  const xlsx = baueXlsx([
    ['Zugelassene Packungen', ''],
    ['Stand 31.08.2026', ''],
    ['Zulassungs-Nummer', 'Dosisstärke-nummer', 'Bezeichnung des Arzneimittels', 'Zulassungsinhaberin', 'Heilmittelcode', 'ATC-Code', 'Erstzulassungsdatum', 'Abgabekategorie Arzneimittel', 'Wirkstoff(e)', 'Anwendungsgebiet Arzneimittel'],
    [12345, 1, 'Dafalgan 500 mg, Tabletten', 'UPSA Switzerland AG', 'Synthetika', 'N02BE01', 29587, 'D', 'paracetamolum', 'Analgetikum & Antipyretikum'],
    [12345, 2, 'Dafalgan 1 g, Tabletten', 'UPSA Switzerland AG', 'Synthetika', 'N02BE01', 29587, 'B', 'paracetamolum', 'Analgetikum'],
    [67890, 1, 'Ibuprofen Beispiel', 'Beispiel AG', 'Synthetika', '', 40000, 'D', 'ibuprofenum', 'Schmerzen'],
    ['', '', '', '', '', '', '', '', '', ''],
  ]);
  const zeilen = leseXlsx(xlsx);
  check(zeilen.length === 7 && zeilen[3][2] === 'Dafalgan 500 mg, Tabletten', '[Import] XLSX wird gelesen');
  const { liste, verknuepft } = verarbeite(zeilen, [{ id: 'paracetamol', atc: ['N02BE01'] }, { id: 'ibuprofen', atc: ['M01AE01'] }]);
  check(liste.length === 2, `[Import] 2 Präparate erwartet, erhalten ${liste.length}`);
  const daf = liste.find((p) => p.nr === '12345');
  check(daf && daf.wid.join() === 'paracetamol', '[Import] Verknüpfung über ATC-Code');
  check(daf && daf.anwendung === 'Analgetikum & Antipyretikum', '[Import] XML-Entities dekodiert');
  check(daf && daf.zulassung === '1981-01-01', `[Import] Excel-Datum umgerechnet (${daf && daf.zulassung})`);
  const ibu = liste.find((p) => p.nr === '67890');
  check(ibu && ibu.wid.join() === 'ibuprofen', '[Import] Verknüpfung über lateinischen Wirkstoffnamen');
  check(verknuepft === 2, '[Import] beide verknüpft');
}

/* ---------- Daten ---------- */
function testDaten() {
  const vok = vokabularSets(ladeVokabular());
  const vf = pruefeVokabular(vok);
  check(vf.length === 0, `[Daten] Vokabular: ${vf.slice(0, 5).join(' | ')}`);
  const dateien = monografieDateien();
  let fehler = 0;
  const beispiele = [];
  for (const f of dateien) {
    const p = pruefeMonografie(JSON.parse(readFileSync(f, 'utf8')), f, vok);
    fehler += p.fehler.length;
    if (p.fehler.length && beispiele.length < 5) beispiele.push(`${path.basename(f)}: ${p.fehler[0]}`);
  }
  check(fehler === 0, `[Daten] ${fehler} Fehler in Monografien: ${beispiele.join(' | ')}`);
  const gebaut = JSON.parse(readFileSync(path.join(HIER, '..', 'data', 'medikamente.js'), 'utf8').replace(/^[\s\S]*?window\.MEDI = /, '').replace(/;\s*$/, ''));
  const n = gebaut.wirkstoffe.length;
  check(n === dateien.length, `[Daten] data/medikamente.js ist veraltet (${n} statt ${dateien.length} Monografien) – node scripts/build-data.mjs`);
  const details = {};
  for (const t of gebaut.detailTeile || []) {
    const datei = path.join(HIER, '..', 'data', 'details', `${t}.js`);
    if (!existsSync(datei)) { check(false, `[Daten] Detail-Teil fehlt: data/details/${t}.js`); continue; }
    Object.assign(details, JSON.parse(readFileSync(datei, 'utf8').replace(/^[\s\S]*?Object\.assign\(window\.MEDI_DETAILS \|\| \{\}, /, '').replace(/\);\s*$/, '')));
  }
  const ohne = gebaut.wirkstoffe.filter((w) => !details[w.id] || !details[w.id].wirkmechanismus).map((w) => w.id);
  check(ohne.length === 0, `[Daten] Details fehlen für: ${ohne.slice(0, 5).join(', ')}`);
}

/* ---------- Browser ---------- */
const VIEWPORTS = [
  { label: 'Desktop', width: 1280, height: 900 },
  { label: 'Tablet', width: 820, height: 1180, mobile: true },
  { label: 'Handy', width: 390, height: 844, mobile: true },
  { label: 'Klein', width: 320, height: 640, mobile: true },
];

async function waitFor(page, expression, ms = 3000) {
  for (let i = 0; i < ms / 100; i++) {
    if (await page.eval(expression)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function testBrowser() {
  const { launchBrowser } = await import('./browser.mjs');
  const { startServer } = await import('../scripts/serve.mjs');
  const server = await startServer(8900 + Math.floor(Math.random() * 90));
  const BASE = `http://127.0.0.1:${server.address().port}/index.html`;
  const daten = JSON.parse(readFileSync(path.join(HIER, '..', 'data', 'medikamente.js'), 'utf8').replace(/^[\s\S]*?window\.MEDI = /, '').replace(/;\s*$/, ''));
  const hat = (id) => daten.wirkstoffe.some((w) => w.id === id);
  const ROUTEN = ['', 'a-z', 'krankheiten', 'gruppen', 'info', 'suche/blut', 'gibt-es-nicht'];
  if (daten.wirkstoffe[0]) ROUTEN.push(`wirkstoff/${daten.wirkstoffe[0].id}`);
  if (daten.krankheiten[0]) ROUTEN.push(`krankheit/${daten.krankheiten[0].id}`);
  if (daten.gruppen[0]) ROUTEN.push(`gruppe/${daten.gruppen[0].id}`);

  for (const vp of VIEWPORTS) {
    const page = await launchBrowser(vp);
    try {
      for (const r of ROUTEN) {
        const tag = `[${vp.label} · #/${r}]`;
        page.errors.length = 0;
        await page.goto(`${BASE}#/${r}`);
        const info = await page.eval(`(() => ({ h1: document.querySelectorAll('h1').length, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, title: document.title, lang: document.documentElement.lang }))()`);
        check(info.h1 === 1, `${tag} genau eine h1 erwartet, gefunden: ${info.h1}`);
        check(info.overflow <= 0, `${tag} läuft seitlich über (${info.overflow}px)`);
        check(info.lang === 'de-CH' && info.title.length > 5, `${tag} Titel/Sprache`);
        check(page.errors.length === 0, `${tag} Browser-Fehler: ${page.errors.join(' | ')}`);
      }

      // Suche: Tippen zeigt sofort Vorschläge, Enter öffnet den ersten
      const tag = `[${vp.label} · Suche]`;
      await page.goto(`${BASE}#/`);
      const feld = vp.width >= 720 ? '#suche-start' : '#suche-start';
      if (hat('acetylsalicylsaeure')) {
        await page.type(feld, 'aspe');
        check(await waitFor(page, `!document.getElementById('suche-start-liste').hidden`), `${tag} Vorschlagsliste öffnet nicht`);
        const labels = await page.eval(`[...document.querySelectorAll('#suche-start-liste [role=option]')].map((o) => o.textContent)`);
        check(labels.some((l) => /Aspirin|Aspégic|Acetylsalicyl/.test(l)), `${tag} «aspe» findet Aspirin nicht: ${labels.slice(0, 4).join(' / ')}`);
        await page.key('ArrowDown');
        await page.key('ArrowUp');
        await page.key('Enter');
        check(await waitFor(page, `location.hash.startsWith('#/')  && location.hash.length > 2`), `${tag} Enter navigiert nicht`);
        await page.goto(`${BASE}#/`);
        await page.type(feld, 'asperin');
        await waitFor(page, `!document.getElementById('suche-start-liste').hidden`);
        await page.click('#suche-start-opt-0');
        check(await waitFor(page, `location.hash === '#/wirkstoff/acetylsalicylsaeure'`), `${tag} Klick auf «Aspirin» (Tippfehler) öffnet ASS nicht: ${await page.eval('location.hash')}`);
        check(await page.eval(`!!document.getElementById('nebenwirkungen')`), `${tag} Nebenwirkungen fehlen auf der Wirkstoffseite`);
        await page.key('Escape');
      }
      if (daten.krankheiten.some((k) => k.id === 'hypertonie')) {
        await page.goto(`${BASE}#/`);
        await page.type(feld, 'bluthoch');
        await waitFor(page, `!document.getElementById('suche-start-liste').hidden`);
        const erstes = await page.eval(`document.querySelector('#suche-start-opt-0')?.textContent || ''`);
        check(/Bluthochdruck/.test(erstes), `${tag} «bluthoch» → Bluthochdruck, erhalten: ${erstes}`);
      }

      // Wechselwirkungen auf der Wirkstoffseite; früheres Check-Profil wird gelöscht
      if (vp.label === 'Desktop' && hat('acetylsalicylsaeure') && hat('ibuprofen')) {
        const t = '[Desktop · Wechselwirkungen]';
        await page.goto(`${BASE}#/wirkstoff/acetylsalicylsaeure`);
        check(await page.eval(`!!document.querySelector('#wechselwirkungen li, #rueckverweise li')`), `${t} ASS-Seite zeigt keine Wechselwirkungen`);
        check(await page.eval(`!document.querySelector('a[href="#/check"]')`), `${t} Link auf den entfernten Check`);
        await page.eval(`sessionStorage.setItem('medi-profil', '{"krankheiten":[],"medikamente":["ibuprofen"]}'); localStorage.setItem('medi-profil-merken', '1')`);
        await page.reload();
        check(await page.eval(`sessionStorage.getItem('medi-profil') === null && localStorage.getItem('medi-profil-merken') === null`), `${t} altes Profil wird nicht gelöscht`);
        await page.goto(`${BASE}#/check`);
        check(await page.eval(`document.querySelector('h1').textContent === 'Nicht gefunden'`), `${t} #/check sollte «Nicht gefunden» zeigen`);
      }

      // Skip-Link: springt zum Inhalt, ohne die Seite zu wechseln
      if (daten.wirkstoffe[0]) {
        const sk = `[${vp.label} · Skip-Link]`;
        await page.goto(`${BASE}#/wirkstoff/${daten.wirkstoffe[0].id}`);
        await page.eval(`document.querySelector('.skip-link').focus()`);
        await page.key('Enter');
        check(await page.eval(`document.querySelector('h1').textContent === ${JSON.stringify(daten.wirkstoffe[0].name)} && location.hash.startsWith('#/wirkstoff/')`), `${sk} Skip-Link zerstört die Seite`);
        check(await page.eval(`document.activeElement === document.getElementById('inhalt')`), `${sk} Fokus nicht im Inhalt`);
      }

      // Hell/Dunkel
      const d = `[${vp.label} · Design]`;
      await page.goto(`${BASE}#/info`);
      const vorher = await page.eval(`getComputedStyle(document.body).backgroundColor`);
      await page.click('#theme-knopf');
      const nachher = await page.eval(`getComputedStyle(document.body).backgroundColor`);
      check(vorher !== nachher, `${d} Umschalter ändert die Farbe nicht`);
      await page.reload();
      check((await page.eval(`getComputedStyle(document.body).backgroundColor`)) === nachher, `${d} Wahl bleibt nicht erhalten`);
      await page.eval(`localStorage.removeItem('medi-theme')`);

      // Jede Monografie rendert ohne Fehler (nur Desktop)
      if (vp.label === 'Desktop') {
        await page.goto(`${BASE}#/`);
        page.errors.length = 0;
        const kaputt = await page.eval(`(async () => {
          const out = [];
          // Wartet, bis der Router nach dem hashchange die erwartete Überschrift gezeichnet hat (max. 1 s).
          // Chrome ignoriert mehr als ~200 Adresswechsel in 10 s («navigation throttling») – daher Pausen.
          let n = 0;
          const zeige = async (hash, name, extra) => {
            if (++n % 150 === 0) await new Promise((r) => setTimeout(r, 10500));
            location.hash = hash;
            for (let i = 0; i < 100; i++) {
              await new Promise((r) => setTimeout(r, 10));
              if (document.querySelector('h1')?.textContent === name && (!extra || document.getElementById(extra))) return true;
            }
            return false;
          };
          for (const w of window.MEDI.wirkstoffe) if (!(await zeige('#/wirkstoff/' + w.id, w.name, 'wirkung'))) out.push(w.id);
          for (const k of window.MEDI.krankheiten) if (!(await zeige('#/krankheit/' + k.id, k.name))) out.push(k.id);
          for (const g of window.MEDI.gruppen) if (!(await zeige('#/gruppe/' + g.id, g.name))) out.push(g.id);
          return out;
        })()`);
        check(kaputt.length === 0, `[Desktop · alle Seiten] fehlerhaft: ${kaputt.slice(0, 10).join(', ')}`);
        check(page.errors.length === 0, `[Desktop · alle Seiten] Browser-Fehler: ${page.errors.slice(0, 3).join(' | ')}`);
      }
    } finally {
      await page.close();
    }
  }
  server.close();
}

/* ---------- Statische Prüfungen der Seite ---------- */
function testStatisch() {
  const html = readFileSync(path.join(HIER, '..', 'index.html'), 'utf8');
  check(!/\sstyle="/.test(html), '[CSP] index.html: style-Attribut');
  check(!/\son[a-z]+="/.test(html), '[CSP] index.html: Inline-Eventhandler');
  check(!/<script>(?!<\/script>)/.test(html), '[CSP] index.html: Inline-Skript');
  for (const [, src] of html.matchAll(/\s(?:src|href)="([^"#:]+)"/g)) check(existsSync(path.join(HIER, '..', src)), `[Links] Datei fehlt: ${src}`);
  const app = readFileSync(path.join(HIER, '..', 'js', 'app.js'), 'utf8');
  check(!/style="/.test(app), '[CSP] app.js erzeugt style-Attribute (von der CSP blockiert)');
  for (const f of ['index.html', 'js/app.js']) {
    const text = readFileSync(path.join(HIER, '..', f), 'utf8');
    check(!/ß/.test(text), `[Text] ${f}: «ß» statt «ss»`);
  }
}

testSuche();
testImport();
testDaten();
testStatisch();
if (!process.argv.includes('--ohne-browser')) await testBrowser();

if (failures.length) {
  console.log(`\n✗ ${failures.length} Fehler, ${passed} bestanden:\n`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ Alle ${passed} Prüfungen bestanden.`);
