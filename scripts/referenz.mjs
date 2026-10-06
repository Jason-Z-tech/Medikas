// Schreibt data/src/_referenz.txt: alle erlaubten ids (Gruppen, Krankheiten, Wirkstoffe) auf einen Blick –
// als Nachschlagehilfe beim Schreiben von Monografien. Die Datei ist abgeleitet und nicht im Git.
// Aufruf: node scripts/referenz.mjs

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { SRC, ladeVokabular } from './daten.mjs';

const { substanzen, gruppen, krankheiten } = ladeVokabular();
const zeilen = [
  '# Erlaubte ids für Monografien (erzeugt von scripts/referenz.mjs)',
  '',
  `## GRUPPEN (${gruppen.length}) – für "gruppen": [...] und Verweise "gruppe:<id>"`,
  ...gruppen.map((g) => `${g.id} — ${g.name} [${g.art}]${g.beispiele ? ` z. B. ${g.beispiele.join(', ')}` : ''}`),
  '',
  `## KRANKHEITEN (${krankheiten.length}) – für "ids": [...] in indikationen, kontraindikationen, vorsicht`,
  ...krankheiten.map((k) => `${k.id} — ${k.name}${k.synonyme && k.synonyme.length ? ` (${k.synonyme.slice(0, 4).join(', ')})` : ''}`),
  '',
  `## WIRKSTOFFE (${substanzen.length}) – für Verweise "ref": ["<id>"] und "kombinationAus"`,
  ...substanzen.map((s) => `${s.id} — ${s.name}${s.atc && s.atc.length ? ` [${s.atc.join(', ')}]` : ''}`),
  '',
];
writeFileSync(path.join(SRC, '_referenz.txt'), zeilen.join('\n'));
console.log(`data/src/_referenz.txt: ${gruppen.length} Gruppen, ${krankheiten.length} Krankheiten, ${substanzen.length} Wirkstoffe.`);
