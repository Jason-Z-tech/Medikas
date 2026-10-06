// Schlaue Suche: Präfix, Teilwort, Tippfehler (Damerau-Levenshtein) und Klang (Kölner Phonetik).
// «aspe» → Aspirin/Aspégic, «asperin» → Aspirin, «parazetamol» → Paracetamol, «zucker» → Diabetes.
// Läuft im Browser (window.MediSuche) und in Node (Tests).
(function (root) {
  'use strict';

  /** Kleinschreibung, Umlaute und Akzente vereinheitlichen, Satzzeichen zu Leerzeichen. */
  function basis(text) {
    return String(text)
      .toLowerCase()
      .replace(/ß/g, 'ss')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  /** Schreibvarianten angleichen: ae/ä, ph/f, c/k/z, y/i, th/t, Doppelbuchstaben. */
  function falte(text) {
    return basis(text)
      .replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u')
      .replace(/ph/g, 'f').replace(/th/g, 't').replace(/rh/g, 'r')
      .replace(/ck/g, 'k').replace(/c(?=[eiy])/g, 'z').replace(/c(?!h)/g, 'k')
      .replace(/y/g, 'i')
      .replace(/([a-z])\1+/g, '$1');
  }

  /** Kölner Phonetik – deutscher Klangcode. «Asperin» und «Aspirin» → gleicher Code. */
  function koelner(text) {
    const w = basis(text).replace(/[^a-z]/g, '');
    let roh = '';
    for (let i = 0; i < w.length; i++) {
      const c = w[i];
      const vor = w[i - 1] || '';
      const nach = w[i + 1] || '';
      let code = '';
      if ('aeijouy'.includes(c)) code = '0';
      else if (c === 'h') code = '';
      else if (c === 'b') code = '1';
      else if (c === 'p') code = nach === 'h' ? '3' : '1';
      else if (c === 'd' || c === 't') code = 'csz'.includes(nach) && nach ? '8' : '2';
      else if ('fvw'.includes(c)) code = '3';
      else if ('gkq'.includes(c)) code = '4';
      else if (c === 'c') {
        if (i === 0) code = 'ahkloqrux'.includes(nach) && nach ? '4' : '8';
        else code = 'ahkoqux'.includes(nach) && nach && !'sz'.includes(vor) ? '4' : '8';
      } else if (c === 'x') code = 'ckq'.includes(vor) && vor ? '8' : '48';
      else if (c === 'l') code = '5';
      else if (c === 'm' || c === 'n') code = '6';
      else if (c === 'r') code = '7';
      else if (c === 's' || c === 'z') code = '8';
      roh += code;
    }
    let out = '';
    for (let i = 0; i < roh.length; i++) if (roh[i] !== roh[i - 1]) out += roh[i];
    return out.length ? out[0] + out.slice(1).replace(/0/g, '') : '';
  }

  /** Damerau-Levenshtein (eingeschränkte Variante) mit Abbruch über max. */
  function distanz(a, b, max) {
    const la = a.length;
    const lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    let vv = new Array(lb + 1);
    let v = new Array(lb + 1);
    let n = new Array(lb + 1);
    for (let j = 0; j <= lb; j++) v[j] = j;
    for (let i = 1; i <= la; i++) {
      n[0] = i;
      let zeilenMin = n[0];
      for (let j = 1; j <= lb; j++) {
        const kosten = a[i - 1] === b[j - 1] ? 0 : 1;
        let d = Math.min(v[j] + 1, n[j - 1] + 1, v[j - 1] + kosten);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, vv[j - 2] + 1);
        n[j] = d;
        if (d < zeilenMin) zeilenMin = d;
      }
      if (zeilenMin > max) return max + 1;
      const t = vv; vv = v; v = n; n = t;
    }
    return v[lb];
  }

  const erlaubteFehler = (len) => (len < 4 ? 0 : len <= 5 ? 1 : len <= 8 ? 2 : 3);

  function bereiteBegriff(text) {
    const f = falte(text);
    const woerter = f.split(' ').filter(Boolean);
    return { text, f, fk: f.replace(/ /g, ''), woerter, k: koelner(text), wk: woerter.map(koelner) };
  }

  /** Bewertet, wie gut die (gefaltete) Anfrage zu einem Begriff passt. 0 = gar nicht. */
  function bewerte(q, begriff) {
    const { f, fk, woerter } = begriff;
    const qk = q.f.replace(/ /g, '');
    if (f === q.f || fk === qk) return 100;
    if (f.startsWith(q.f) || fk.startsWith(qk)) return 92 - Math.min(8, (f.length - q.f.length) / 4);
    if (q.woerter.length === 1) {
      for (const w of woerter) if (w.startsWith(q.f)) return 80 - Math.min(6, (w.length - q.f.length) / 4);
    } else {
      // Mehrere Wörter: jedes Anfragewort muss am Anfang eines Begriffsworts stehen.
      if (q.woerter.every((qw) => woerter.some((w) => w.startsWith(qw)))) return 78;
    }
    if (qk.length >= 3 && fk.includes(qk)) return 48;
    // Tippfehler: Anfrage gegen den gleich langen Anfang des Begriffs (und jedes Worts).
    const max = erlaubteFehler(qk.length);
    if (max > 0) {
      let best = max + 1;
      const kandidaten = woerter.length > 1 ? [fk, ...woerter] : [fk];
      for (const kand of kandidaten) {
        if (kand[0] !== qk[0] && kand[1] !== qk[1]) continue;
        for (let d = -1; d <= 1; d++) {
          const len = qk.length + d;
          if (len < 3 || len > kand.length) continue;
          const dist = distanz(qk, kand.slice(0, len), max);
          if (dist < best) best = dist;
        }
      }
      if (best <= max) return 58 - best * 8;
    }
    // Klang: «Ibuprophen», «Zitalopram» … – Klangcode der Anfrage gegen den gleich langen Anfang des
    // Begriffs (erst ab 5 Buchstaben, sonst zu viele Zufallstreffer).
    if (qk.length >= 6 && q.k.length >= 5) {
      const kandidaten = woerter.length > 1 ? [[fk, begriff.k], ...woerter.map((w, i) => [w, begriff.wk[i]])] : [[fk, begriff.k]];
      for (const [kand, code] of kandidaten) {
        if (kand.length < qk.length - 1 || !code.startsWith(q.k.slice(0, 2))) continue;
        for (let d = -1; d <= 1; d++) if (koelner(kand.slice(0, qk.length + d)) === q.k) return 44;
      }
    }
    return 0;
  }

  const TYP_BONUS = { wirkstoff: 4, marke: 3, krankheit: 3, gruppe: 1, kurz: 2, praeparat: 0 };

  /**
   * Baut den Suchindex aus den Daten (window.MEDI) und optional der Swissmedic-Präparateliste.
   * Jeder Eintrag: { typ, id, label, sub, begriffe[], gewicht }
   */
  function baueIndex(medi, praeparate) {
    const eintraege = [];
    const markeGesehen = new Set();
    const add = (typ, id, label, sub, texte, gewicht) => {
      const begriffe = [];
      const gesehen = new Set();
      for (const t of texte) {
        if (!t) continue;
        const b = bereiteBegriff(t);
        if (!b.f || gesehen.has(b.f)) continue;
        gesehen.add(b.f);
        begriffe.push(b);
      }
      if (begriffe.length) eintraege.push({ typ, id, label, sub, begriffe, gewicht: gewicht || 0 });
    };
    const markeOhneZusatz = (m) => m.replace(/\s*\((Kombi|Kombination)[^)]*\)\s*$/i, '');

    // Häufig verwendete Wirkstoffe (Priorität 1/2 im Verzeichnis) leicht bevorzugen.
    const bekannt = (w) => (w.prio === 1 ? 4 : w.prio === 2 ? 2 : 0);
    for (const w of medi.wirkstoffe || []) {
      add('wirkstoff', w.id, w.name, w.kurz || w.klasse, [w.name, ...(w.synonyme || []), ...(w.atc || [])], 2 + bekannt(w));
      for (const m of w.handelsnamen || []) {
        const key = `${falte(markeOhneZusatz(m))}|${w.id}`;
        if (markeGesehen.has(key)) continue;
        markeGesehen.add(key);
        add('marke', w.id, m, `Wirkstoff: ${w.name}`, [markeOhneZusatz(m)], 1 + bekannt(w));
      }
    }
    for (const w of medi.kurzeintraege || []) {
      add('kurz', w.id, w.name, w.klasse, [w.name, ...(w.atc || [])], bekannt(w));
      for (const m of w.handelsnamen || []) {
        const key = `${falte(markeOhneZusatz(m))}|${w.id}`;
        if (markeGesehen.has(key)) continue;
        markeGesehen.add(key);
        add('marke', w.id, m, `Wirkstoff: ${w.name}`, [markeOhneZusatz(m)], bekannt(w));
      }
    }
    for (const k of medi.krankheiten || []) add('krankheit', k.id, k.name, k.kategorie, [k.name, ...(k.synonyme || [])], 1);
    for (const g of medi.gruppen || []) add('gruppe', g.id, g.name, 'Wirkstoffgruppe', [g.name], 0);
    if (praeparate && praeparate.liste) {
      for (const p of praeparate.liste) {
        if (markeGesehen.has(`${falte(p.name)}|praeparat`)) continue;
        markeGesehen.add(`${falte(p.name)}|praeparat`);
        add('praeparat', p.nr, p.name, p.wirkstoffe ? `Swissmedic · ${p.wirkstoffe}` : 'Swissmedic-Zulassung', [p.name], 0);
      }
    }
    return { eintraege };
  }

  /**
   * Sucht im Index. optionen: { limit, typen: ['wirkstoff', …] }
   * Rückgabe: [{ typ, id, label, sub, score, treffer }] – bester Treffer zuerst.
   */
  function suche(index, anfrage, optionen) {
    const opt = optionen || {};
    // Dosisangaben ignorieren: «Dafalgan 500», «Ibuprofen 400 mg», «Xarelto 20»
    const ohneDosis = basis(anfrage || '').split(' ')
      .filter((w) => w && !/^\d+([.,]\d+)?(mg|g|ml|mcg|ug|ie|i e|prozent)?$/.test(w) && !/^(mg|g|ml|mcg|ug|ie|tabletten?|kapseln?|tropfen|sirup|spray|filmtabletten?|retard)$/.test(w))
      .join(' ');
    const text = ohneDosis || anfrage || '';
    const f = falte(text);
    if (!f) return [];
    const q = { f, woerter: f.split(' ').filter(Boolean), k: koelner(text) };
    // Beim Tippen fehlt nach «c» bzw. «p» noch der Folgebuchstabe («Ci…» → z, «Ph…» → f): Variante mitprüfen
    const b = basis(text);
    const varianten = [q];
    if (/c$/.test(b)) varianten.push({ ...q, f: falte(`${b}e`).slice(0, -1) || q.f });
    if (/p$/.test(b)) varianten.push({ ...q, f: falte(`${b}h`) });
    for (const v of varianten.slice(1)) v.woerter = v.f.split(' ').filter(Boolean);
    const typen = opt.typen ? new Set(opt.typen) : null;
    const treffer = [];
    for (const e of index.eintraege) {
      if (typen && !typen.has(e.typ)) continue;
      let best = 0;
      let bestText = '';
      for (const begriff of e.begriffe) {
        for (const v of varianten) {
          const s = bewerte(v, begriff);
          if (s > best) { best = s; bestText = begriff.text; }
        }
        if (best >= 100) break;
      }
      if (best > 0) {
        treffer.push({ typ: e.typ, id: e.id, label: e.label, sub: e.sub, treffer: bestText,
          score: best + (TYP_BONUS[e.typ] || 0) + e.gewicht });
      }
    }
    treffer.sort((a, b) => b.score - a.score || a.label.length - b.label.length || a.label.localeCompare(b.label, 'de'));
    // Gleiche Marke für denselben Wirkstoff nur einmal; Marke direkt nach ihrem Wirkstoff ist ok.
    const out = [];
    const gesehen = new Set();
    for (const t of treffer) {
      const key = `${t.typ}|${t.id}|${falte(t.label)}`;
      if (gesehen.has(key)) continue;
      gesehen.add(key);
      out.push(t);
      if (out.length >= (opt.limit || 12)) break;
    }
    return out;
  }

  /** Markiert den passenden Anfang/Teil im Label, sofern er wörtlich vorkommt. */
  function markiere(label, anfrage) {
    const q = basis(anfrage);
    if (!q) return [{ text: label, mark: false }];
    // basis() eines Einzelzeichens kann 2 Zeichen lang sein (ß → ss); Positionen nachführen.
    const map = [];
    let flat = '';
    Array.from(label).forEach((ch, i) => {
      const b = basis(ch) || ' ';
      for (const c of b) { flat += c; map.push(i); }
    });
    const pos = flat.indexOf(q);
    if (pos < 0) return [{ text: label, mark: false }];
    const zeichen = Array.from(label);
    const start = map[pos];
    const ende = map[Math.min(map.length - 1, pos + q.length - 1)] + 1;
    return [
      { text: zeichen.slice(0, start).join(''), mark: false },
      { text: zeichen.slice(start, ende).join(''), mark: true },
      { text: zeichen.slice(ende).join(''), mark: false },
    ].filter((t) => t.text);
  }

  const api = { basis, falte, koelner, distanz, baueIndex, suche, markiere };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MediSuche = api;
})(typeof window !== 'undefined' ? window : globalThis);
