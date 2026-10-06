// Prüft die Quelldaten des Medi-Lexikons.
// Aufruf: node scripts/validate.mjs                 (alles)
//         node scripts/validate.mjs datei.json …    (nur diese Monografien)
//         --streng   Warnungen zählen als Fehler

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ladeVokabular, vokabularSets, pruefeVokabular, pruefeMonografie, monografieDateien } from './daten.mjs';

const args = process.argv.slice(2);
const streng = args.includes('--streng');
const dateien = args.filter((a) => !a.startsWith('--'));

const vok = vokabularSets(ladeVokabular());
let fehlerTotal = 0;
let warnTotal = 0;

if (dateien.length === 0) {
  for (const f of pruefeVokabular(vok)) {
    console.log(`FEHLER  Vokabular: ${f}`);
    fehlerTotal++;
  }
}

const liste = dateien.length ? dateien.map((d) => path.resolve(d)) : monografieDateien();
for (const datei of liste) {
  let m;
  try {
    m = JSON.parse(readFileSync(datei, 'utf8'));
  } catch (e) {
    console.log(`FEHLER  ${path.basename(datei)}: kein gültiges JSON (${e.message})`);
    fehlerTotal++;
    continue;
  }
  const { fehler, warnungen } = pruefeMonografie(m, datei, vok);
  for (const f of fehler) console.log(`FEHLER  ${path.basename(datei)}: ${f}`);
  for (const w of warnungen) console.log(`WARNUNG ${path.basename(datei)}: ${w}`);
  fehlerTotal += fehler.length;
  warnTotal += warnungen.length;
}

console.log(`\n${liste.length} Monografien geprüft: ${fehlerTotal} Fehler, ${warnTotal} Warnungen.`);
process.exit(fehlerTotal > 0 || (streng && warnTotal > 0) ? 1 : 0);
