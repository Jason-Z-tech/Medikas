// Medi-Lexikon – Oberfläche: Router, Ansichten, Suchfeld mit Vorschlägen und persönlicher Check.
// Alle Daten liegen lokal (data/medikamente.js); es wird nichts an einen Server gesendet.
(function () {
  'use strict';

  const M = window.MEDI || { wirkstoffe: [], kurzeintraege: [], gruppen: [], krankheiten: [] };
  const P = window.MEDI_PRAEPARATE || { liste: [] };
  const S = window.MediSuche;
  const main = document.getElementById('inhalt');
  // In einem Rahmen (z. B. eingebettete Vorschau) gibt es keinen Druckdialog
  let imRahmen = false;
  try { imRahmen = window.self !== window.top; } catch (e) { imRahmen = true; }

  /* ---------- Nachschlagetabellen ---------- */
  const WS = new Map(M.wirkstoffe.map((w) => [w.id, w]));
  const KURZ = new Map((M.kurzeintraege || []).map((w) => [w.id, w]));
  const KR = new Map(M.krankheiten.map((k) => [k.id, k]));
  const GR = new Map(M.gruppen.map((g) => [g.id, g]));
  const PR = new Map((P.liste || []).map((p) => [String(p.nr), p]));

  const push = (map, key, val) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(val);
  };
  const mitglieder = new Map(); // gruppe → [wirkstoff]
  const indiziert = new Map(); // krankheit → [{ w, text }]
  const gegenanzeige = new Map(); // krankheit → [{ w, text, stufe }]
  const verweise = new Map(); // 'gruppe:x' oder wirkstoff-id → [{ w, e, stufe }]
  const praepNachWs = new Map(); // wirkstoff → [präparat]
  for (const w of M.wirkstoffe) {
    for (const g of w.gruppen || []) push(mitglieder, g, w);
    for (const e of w.indikationen || []) for (const id of new Set(e.ids || [])) push(indiziert, id, { w, text: e.text });
    for (const e of w.kontraindikationen || []) for (const id of new Set(e.ids || [])) push(gegenanzeige, id, { w, text: e.text, stufe: 'kontra' });
    for (const e of w.vorsicht || []) for (const id of new Set(e.ids || [])) push(gegenanzeige, id, { w, text: e.text, stufe: 'vorsicht' });
    for (const e of w.kontraMedikamente || []) for (const r of e.ref || []) push(verweise, r, { w, e, stufe: 'kontra' });
    for (const e of w.interaktionen || []) for (const r of e.ref || []) push(verweise, r, { w, e, stufe: e.schwere });
  }
  for (const p of P.liste || []) for (const id of p.wid || []) push(praepNachWs, id, p);
  const INDEX = S.baueIndex(M, P);

  /* ---------- Details (lange Texte) bei Bedarf nachladen ---------- */
  const detailTeil = (id) => (/^[a-z]/.test(id) ? id[0] : '0');
  const ladend = new Map();
  const details = (id) => (window.MEDI_DETAILS || {})[id] || null;
  function ladeDetails(id) {
    const t = detailTeil(id);
    if (!ladend.has(t)) {
      ladend.set(t, new Promise((resolve) => {
        const el = document.createElement('script');
        el.src = `data/details/${t}.js`;
        el.onload = () => resolve(true);
        el.onerror = () => { ladend.delete(t); resolve(false); };
        document.head.appendChild(el);
      }));
    }
    return ladend.get(t);
  }

  /* ---------- Hilfen ---------- */
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
  const zahl = (n) => n.toLocaleString('de-CH');
  const nachName = (a, b) => a.name.localeCompare(b.name, 'de');
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const eindeutig = (arr) => Array.from(new Set(arr));
  const eintraegeVon = (list) => {
    // gleicher Wirkstoff nur einmal, Texte zusammenfassen
    const map = new Map();
    for (const x of list) {
      if (!map.has(x.w.id)) map.set(x.w.id, { ...x, texte: [] });
      const t = map.get(x.w.id);
      if (!t.texte.includes(x.text)) t.texte.push(x.text);
      if (x.stufe === 'kontra') t.stufe = 'kontra';
    }
    return Array.from(map.values()).sort((a, b) => nachName(a.w, b.w));
  };

  const ABGABE = {
    A: ['Verschärft rezeptpflichtig', 'Einmalige Abgabe auf ärztliche Verschreibung'],
    B: ['Rezeptpflichtig', 'Abgabe auf ärztliche Verschreibung'],
    C: ['Apothekenpflichtig (alt)', 'Frühere Kategorie C, seit 2019 in B oder D überführt'],
    D: ['Rezeptfrei mit Fachberatung', 'Abgabe in Apotheken und Drogerien nach Fachberatung'],
    E: ['Frei verkäuflich', 'Abgabe ohne Fachberatung, auch im Detailhandel'],
  };
  const abgabeBadge = (a) =>
    ABGABE[a] ? `<span class="abgabe abgabe--${a}" title="Abgabekategorie ${a}: ${esc(ABGABE[a][1])}"><b>${a}</b>${esc(ABGABE[a][0])}</span>` : '';

  const NW = [
    ['sehrHaeufig', 'Sehr häufig', 'mehr als 1 von 10 Behandelten', 5],
    ['haeufig', 'Häufig', '1 bis 10 von 100 Behandelten', 4],
    ['gelegentlich', 'Gelegentlich', '1 bis 10 von 1000 Behandelten', 3],
    ['selten', 'Selten', '1 bis 10 von 10’000 Behandelten', 2],
    ['sehrSelten', 'Sehr selten', 'weniger als 1 von 10’000 Behandelten', 1],
    ['unbekannt', 'Häufigkeit nicht bekannt', 'aus Meldungen nach der Markteinführung', 0],
  ];

  const ATC = {
    A: 'Verdauung und Stoffwechsel', B: 'Blut und Blutbildung', C: 'Herz und Kreislauf', D: 'Haut (Dermatika)',
    G: 'Urogenitalsystem und Sexualhormone', H: 'Hormone (systemisch)', J: 'Infektionen und Impfstoffe',
    L: 'Krebs und Immunsystem', M: 'Muskeln, Gelenke und Knochen', N: 'Nervensystem und Psyche',
    P: 'Parasiten', R: 'Atemwege', S: 'Augen und Ohren', V: 'Varia (Antidote, Diagnostika)',
  };
  const KATEGORIEN = [
    'Herz-Kreislauf', 'Blut und Gerinnung', 'Stoffwechsel und Hormone', 'Niere und Harnwege', 'Leber, Magen und Darm',
    'Atemwege und Allergien', 'Nervensystem und Schmerz', 'Psyche', 'Infektionen', 'Haut', 'Augen und Ohren',
    'Bewegungsapparat', 'Krebs und Immunsystem', 'Frauen, Schwangerschaft und Sexualität', 'Männergesundheit', 'Besondere Situationen',
  ];
  const GRUPPEN_ART = {
    wirkstoffklasse: ['Wirkstoffklassen', 'Arzneimittel mit gleichem Wirkprinzip.'],
    pharmakokinetisch: ['Enzyme und Transporter', 'Beeinflussen Abbau oder Aufnahme anderer Medikamente (z. B. über CYP3A4).'],
    pharmakodynamisch: ['Risikogruppen', 'Verstärken sich in ihrer Wirkung oder Nebenwirkung gegenseitig (z. B. QT-Verlängerung).'],
  };

  const ICON = {
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    haken: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>',
    druck: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M8 14h8v7H8z"/></svg>',
    suche: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  };

  const linkWs = (id, label) => {
    const w = WS.get(id) || KURZ.get(id);
    return w ? `<a href="#/wirkstoff/${id}">${esc(label || w.name)}</a>` : esc(label || id);
  };
  const linkKr = (id, label) => (KR.has(id) ? `<a href="#/krankheit/${id}">${esc(label || KR.get(id).name)}</a>` : esc(label || id));
  const linkGr = (id, label) => (GR.has(id) ? `<a href="#/gruppe/${id}">${esc(label || GR.get(id).name)}</a>` : esc(label || id));
  const refZiele = (refs) =>
    (refs || [])
      .map((r) => (r.startsWith('gruppe:') ? (GR.has(r.slice(7)) ? { href: `#/gruppe/${r.slice(7)}`, label: GR.get(r.slice(7)).name } : null)
        : (WS.has(r) || KURZ.has(r) ? { href: `#/wirkstoff/${r}`, label: (WS.get(r) || KURZ.get(r)).name } : null)))
      .filter(Boolean);
  const krZiele = (ids) => (ids || []).filter((id) => KR.has(id)).map((id) => ({ href: `#/krankheit/${id}`, label: KR.get(id).name }));
  /** Text verlinken: bei genau einem Ziel wird der Text selbst zum Link, sonst Links dahinter. */
  function verlinkt(text, ziele) {
    if (ziele.length === 1) return `<a href="${ziele[0].href}">${esc(text)}</a>`;
    if (ziele.length > 1) return `${esc(text)} <span class="klein">→ ${ziele.map((z) => `<a href="${z.href}">${esc(z.label)}</a>`).join(', ')}</span>`;
    return esc(text);
  }

  /* ---------- Persönliches Profil (nur im Browser gespeichert) ---------- */
  // Gesundheitsangaben bleiben standardmässig nur bis zum Schliessen des Tabs (sessionStorage);
  // dauerhaft auf diesem Gerät (localStorage) nur, wenn man es im Check ausdrücklich wählt.
  const PROFIL_KEY = 'medi-profil';
  const MERKEN_KEY = 'medi-profil-merken';
  const speicherLesen = (store, key) => { try { return window[store].getItem(key); } catch (e) { return null; } };
  const speicherSchreiben = (store, key, wert) => {
    try {
      if (wert == null) window[store].removeItem(key);
      else window[store].setItem(key, wert);
    } catch (e) { /* Speicher gesperrt (privater Modus) */ }
  };
  const dauerhaft = () => speicherLesen('localStorage', MERKEN_KEY) === '1';
  let profil = { krankheiten: [], medikamente: [] };
  function ladeProfil() {
    profil = { krankheiten: [], medikamente: [] };
    try {
      const gespeichert = JSON.parse(speicherLesen(dauerhaft() ? 'localStorage' : 'sessionStorage', PROFIL_KEY) || 'null');
      if (gespeichert) {
        profil = {
          krankheiten: eindeutig(gespeichert.krankheiten || []).filter((id) => KR.has(id)),
          medikamente: eindeutig(gespeichert.medikamente || []).filter((id) => WS.has(id) || KURZ.has(id)),
        };
      }
    } catch (e) { /* kaputter Eintrag: leeres Profil */ }
  }
  ladeProfil();
  const profilLeer = () => profil.krankheiten.length + profil.medikamente.length === 0;
  function speichereProfil() {
    const text = JSON.stringify(profil);
    if (dauerhaft()) speicherSchreiben('localStorage', PROFIL_KEY, text);
    else speicherSchreiben('sessionStorage', PROFIL_KEY, text);
    zeigeProfilZahl();
  }
  function setzeDauerhaft(an) {
    speicherSchreiben('localStorage', MERKEN_KEY, an ? '1' : null);
    if (an) {
      speicherSchreiben('localStorage', PROFIL_KEY, JSON.stringify(profil));
      speicherSchreiben('sessionStorage', PROFIL_KEY, null);
    } else {
      speicherSchreiben('sessionStorage', PROFIL_KEY, JSON.stringify(profil));
      speicherSchreiben('localStorage', PROFIL_KEY, null);
    }
  }
  function profilUmschalten(liste, id) {
    ladeProfil(); // Änderungen aus anderen Tabs nicht überschreiben
    const arr = profil[liste];
    const i = arr.indexOf(id);
    if (i >= 0) arr.splice(i, 1);
    else arr.push(id);
    speichereProfil();
    return i < 0;
  }
  function zeigeProfilZahl() {
    const el = $('#profil-zahl');
    const n = alleBefunde().filter((b) => b.stufe === 'kontra' || b.stufe === 'schwer').length;
    el.textContent = n;
    el.hidden = n === 0;
    el.title = n ? `${n} wichtige Warnungen in Ihrem Check` : '';
  }

  /* ---------- Gegenanzeigen und Wechselwirkungen prüfen ---------- */
  const RANG = { kontra: 0, schwer: 1, vorsicht: 2, mittel: 3, leicht: 4, doppelt: 5 };
  const STUFE_TEXT = { kontra: 'Kontraindiziert', schwer: 'Schwerwiegend', vorsicht: 'Vorsicht', mittel: 'Mittel', leicht: 'Gering', doppelt: 'Gleiche Gruppe' };

  /** Wirkstoff samt Bestandteilen (bei Kombinationen) und allen Gruppen. */
  function identitaet(w) {
    const ids = new Set([w.id, ...(w.kombinationAus || [])]);
    const gruppen = new Set(w.gruppen || []);
    for (const id of w.kombinationAus || []) for (const g of (WS.get(id) || {}).gruppen || []) gruppen.add(g);
    return { ids, gruppen };
  }
  const trifft = (e, ident) => (e.ref || []).some((r) => (r.startsWith('gruppe:') ? ident.gruppen.has(r.slice(7)) : ident.ids.has(r)));

  /** Alle Befunde für Wirkstoff w gegenüber dem Profil (Krankheiten und andere Medikamente). */
  function befundeFuer(w, prof) {
    const out = [];
    if (!w || !w.indikationen) return out;
    for (const kid of prof.krankheiten) {
      const k = KR.get(kid);
      if (!k) continue;
      for (const e of w.kontraindikationen || []) {
        if ((e.ids || []).includes(kid)) out.push({ stufe: 'kontra', paar: kid, titel: `${linkWs(w.id)} bei ${linkKr(kid)}`, text: e.text });
      }
      for (const e of w.vorsicht || []) {
        if ((e.ids || []).includes(kid)) out.push({ stufe: 'vorsicht', paar: kid, titel: `${linkWs(w.id)} bei ${linkKr(kid)}`, text: e.text });
      }
    }
    const idW = identitaet(w);
    for (const mid of prof.medikamente) {
      if (mid === w.id) continue;
      const m = WS.get(mid) || KURZ.get(mid); // Kurzeinträge: nur Verweise aus w zählen
      if (!m) continue;
      const idM = identitaet(m);
      const titel = `${linkWs(w.id)} + ${linkWs(m.id)}`;
      const gleich = Array.from(idW.ids).filter((x) => idM.ids.has(x));
      if (gleich.length) {
        const namen = gleich.map((x) => (WS.get(x) || KURZ.get(x) || { name: x }).name).join(', ');
        out.push({ stufe: 'vorsicht', paar: mid, titel: `${linkWs(w.id)} und ${linkWs(m.id)}`,
          text: `Beide enthalten ${namen}.`, detail: 'Gefahr der Doppeldosierung – nur nach Rücksprache gleichzeitig einnehmen.' });
      }
      for (const e of w.kontraMedikamente || []) if (trifft(e, idM)) out.push({ stufe: 'kontra', paar: mid, titel, text: e.text, detail: e.grund });
      for (const e of m.kontraMedikamente || []) if (trifft(e, idW)) out.push({ stufe: 'kontra', paar: mid, titel, text: e.text, detail: e.grund });
      for (const e of w.interaktionen || []) if (trifft(e, idM)) out.push({ stufe: e.schwere, paar: mid, titel, text: e.text, detail: e.effekt });
      for (const e of m.interaktionen || []) if (trifft(e, idW)) out.push({ stufe: e.schwere, paar: mid, titel, text: e.text, detail: e.effekt });
      const gemeinsam = Array.from(idW.gruppen).filter((g) => idM.gruppen.has(g) && (GR.get(g) || {}).art === 'wirkstoffklasse');
      if (gemeinsam.length && !gleich.length) {
        out.push({ stufe: 'doppelt', paar: mid, titel: `${linkWs(w.id)} und ${linkWs(m.id)}`,
          text: `Beide gehören zur Gruppe «${GR.get(gemeinsam[0]).name}».`, detail: 'Doppelte Einnahme mit Ärztin, Arzt oder Apotheke klären.' });
      }
    }
    const gesehen = new Set();
    return out
      .filter((b) => {
        const key = `${b.paar}|${b.text}|${b.detail || ''}`;
        if (gesehen.has(key)) return false;
        gesehen.add(key);
        return true;
      })
      .sort((a, b) => RANG[a.stufe] - RANG[b.stufe]);
  }

  /** Befunde im ganzen Profil: jedes Medikament gegen die Krankheiten, jedes Paar genau einmal. */
  function alleBefunde() {
    const out = [];
    const meds = profil.medikamente;
    for (const id of meds) if (WS.has(id)) out.push(...befundeFuer(WS.get(id), { krankheiten: profil.krankheiten, medikamente: [] }));
    for (let i = 0; i < meds.length; i++) {
      for (let j = i + 1; j < meds.length; j++) {
        const [a, b] = WS.has(meds[i]) ? [meds[i], meds[j]] : [meds[j], meds[i]];
        if (WS.has(a)) out.push(...befundeFuer(WS.get(a), { krankheiten: [], medikamente: [b] }));
      }
    }
    return out.sort((a, b) => RANG[a.stufe] - RANG[b.stufe]);
  }

  /** Einträge anderer Monografien, die auf diesen Wirkstoff (direkt oder über eine Gruppe) verweisen. */
  function rueckverweise(w) {
    const ident = identitaet(w);
    const eigenePartner = new Set();
    for (const e of (w.kontraMedikamente || []).concat(w.interaktionen || [])) {
      for (const r of e.ref || []) {
        if (!r.startsWith('gruppe:')) eigenePartner.add(r);
        else for (const m of mitglieder.get(r.slice(7)) || []) eigenePartner.add(m.id);
      }
    }
    const direkt = [];
    const gruppe = [];
    const gesehen = new Set();
    const nimm = (liste, ziel) => {
      for (const x of liste || []) {
        if (x.w.id === w.id || ident.ids.has(x.w.id) || eigenePartner.has(x.w.id)) continue;
        const key = `${x.w.id}|${x.e.text}`;
        if (gesehen.has(key)) continue;
        gesehen.add(key);
        ziel.push(x);
      }
    };
    for (const i of ident.ids) nimm(verweise.get(i), direkt);
    for (const g of ident.gruppen) nimm(verweise.get(`gruppe:${g}`), gruppe);
    const ordnen = (a, b) => RANG[a.stufe] - RANG[b.stufe] || nachName(a.w, b.w);
    return { direkt: direkt.sort(ordnen), gruppe: gruppe.sort(ordnen) };
  }

  const befundLi = (b) =>
    `<li class="stufe-${b.stufe}"><span class="stufe-label">${STUFE_TEXT[b.stufe]}</span><strong>${b.titel}</strong>` +
    `<span class="klein">${esc(b.text)}${b.detail ? ` – ${esc(b.detail)}` : ''}</span></li>`;

  function warnPunkt(r) {
    if (profilLeer() || !(r.typ === 'wirkstoff' || r.typ === 'marke')) return '';
    const b = befundeFuer(WS.get(r.id), profil);
    if (!b.length) return '';
    const rot = b[0].stufe === 'kontra' || b[0].stufe === 'schwer';
    if (!rot && !['vorsicht', 'mittel'].includes(b[0].stufe)) return '';
    return `<span class="punkt punkt--${rot ? 'rot' : 'gelb'}" title="Achtung: passt möglicherweise nicht zu Ihrem Profil">!<span class="vh"> Achtung: passt möglicherweise nicht zu Ihrem Profil</span></span>`;
  }

  /* ---------- Suchfeld mit Vorschlägen (Combobox) ---------- */
  const TYP_TEXT = { wirkstoff: 'Wirkstoff', marke: 'Marke', kurz: 'Wirkstoff', krankheit: 'Krankheit', gruppe: 'Gruppe', praeparat: 'Präparat' };
  function zielHash(r) {
    if (r.typ === 'krankheit') return `#/krankheit/${r.id}`;
    if (r.typ === 'gruppe') return `#/gruppe/${r.id}`;
    if (r.typ === 'praeparat') return `#/praeparat/${encodeURIComponent(r.id)}`;
    return `#/wirkstoff/${r.id}`;
  }
  function optionHtml(r, i, q, id) {
    const label = S.markiere(r.label, q).map((t) => (t.mark ? `<mark>${esc(t.text)}</mark>` : esc(t.text))).join('');
    let sub = r.sub || '';
    if (r.typ === 'krankheit') {
      const n = eintraegeVon(indiziert.get(r.id) || []).length;
      sub = `${sub}${n ? ` · ${n} ${n === 1 ? 'Medikament' : 'Medikamente'}` : ''}`;
    }
    if (r.treffer && r.typ !== 'marke' && S.falte(r.treffer) !== S.falte(r.label)) sub = `«${r.treffer}» · ${sub}`;
    return `<li class="option" role="option" id="${id}-opt-${i}" data-i="${i}" aria-selected="false">` +
      `<span class="option__typ"><span class="typ typ--${r.typ}">${TYP_TEXT[r.typ]}</span></span>` +
      `<span class="option__label">${label}</span><span class="option__warn">${warnPunkt(r)}</span>` +
      `<span class="option__sub">${esc(sub)}</span></li>`;
  }

  let feldZaehler = 0;
  function suchfeld(container, opt) {
    const id = opt.id || `suche-${++feldZaehler}`;
    container.innerHTML =
      `<div class="suche${opt.gross ? ' suche--gross' : ''}">` +
      `<label class="vh" for="${id}">${esc(opt.label || 'Medikament, Wirkstoff oder Krankheit suchen')}</label>` +
      `<div class="suche__feld">${ICON.suche}` +
      `<input id="${id}" type="search" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-liste" ` +
      `autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" placeholder="${esc(opt.placeholder || '')}">` +
      `<button class="suche__leeren" type="button" aria-label="Eingabe löschen" hidden>×</button></div>` +
      `<ul class="suche__liste" id="${id}-liste" role="listbox" aria-label="Vorschläge" hidden></ul>` +
      `<div class="vh" role="status" aria-live="polite"></div></div>`;
    const input = $('input', container);
    const liste = $('ul', container);
    const leeren = $('.suche__leeren', container);
    const status = $('[role="status"]', container);
    let ergebnisse = [];
    let aktiv = -1;
    let blurTimer = 0;
    let statusTimer = 0;
    const melde = (text) => {
      clearTimeout(statusTimer);
      statusTimer = setTimeout(() => { status.textContent = text; }, 400);
    };
    if (opt.wert) {
      input.value = opt.wert;
      leeren.hidden = false;
    }

    const optionen = () => $$('[role="option"]', liste);
    function schliessen() {
      liste.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      aktiv = -1;
    }
    function setzeAktiv(i, scrollen) {
      const opts = optionen();
      if (!opts.length) return;
      aktiv = (i + opts.length) % opts.length;
      opts.forEach((o, j) => o.setAttribute('aria-selected', j === aktiv ? 'true' : 'false'));
      input.setAttribute('aria-activedescendant', opts[aktiv].id);
      if (scrollen) opts[aktiv].scrollIntoView({ block: 'nearest' });
    }
    function zeichne() {
      const q = input.value.trim();
      leeren.hidden = !input.value;
      if (!q) {
        ergebnisse = [];
        schliessen();
        melde('');
        return;
      }
      ergebnisse = S.suche(INDEX, q, { limit: opt.limit || 10, typen: opt.typen });
      let html = ergebnisse.map((r, i) => optionHtml(r, i, q, id)).join('');
      if (!ergebnisse.length) {
        html = `<li class="option option--leer" role="presentation">Nichts gefunden für «${esc(q)}». Tipp: Wirkstoff, Markenname oder Krankheit eingeben.</li>`;
      } else if (!opt.typen) {
        html += `<li class="option option--alle" role="option" id="${id}-opt-alle" data-i="alle" aria-selected="false">Alle Treffer für «${esc(q)}» anzeigen</li>`;
      }
      liste.innerHTML = html;
      liste.hidden = false;
      if (ergebnisse.length) {
        input.setAttribute('aria-expanded', 'true');
        setzeAktiv(0, false);
        melde(`${ergebnisse.length} Vorschläge, erster: ${ergebnisse[0].label}. Mit Pfeiltasten auswählen.`);
      } else {
        // Keine Optionen: nicht als offene Liste ansagen, Hinweis über die Statusmeldung
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        aktiv = -1;
        melde(`Nichts gefunden für ${q}.`);
      }
    }
    function waehle(i) {
      const q = input.value.trim();
      schliessen();
      if (i === 'alle') {
        location.hash = `#/suche/${encodeURIComponent(q)}`;
        return;
      }
      const r = ergebnisse[i];
      if (!r) return;
      input.value = '';
      leeren.hidden = true;
      if (opt.onSelect) {
        opt.onSelect(r);
        input.focus();
      } else {
        const ziel = zielHash(r);
        if (location.hash === ziel) render(false); // gleiche Seite: neu zeichnen und Überschrift fokussieren
        else location.hash = ziel;
      }
    }
    input.addEventListener('input', zeichne);
    input.addEventListener('focus', () => {
      clearTimeout(blurTimer);
      if (input.value.trim()) zeichne();
    });
    input.addEventListener('blur', () => {
      clearTimeout(blurTimer);
      blurTimer = setTimeout(() => { if (document.activeElement !== input) schliessen(); }, 150);
    });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        if (liste.hidden) zeichne();
        else setzeAktiv(aktiv + 1, true);
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (!liste.hidden) setzeAktiv(aktiv - 1, true);
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        if (liste.hidden) zeichne();
        const o = optionen()[aktiv];
        if (o) waehle(o.dataset.i === 'alle' ? 'alle' : Number(o.dataset.i));
        else if (input.value.trim() && !opt.typen) waehle('alle');
      } else if (ev.key === 'Escape') {
        if (!liste.hidden) {
          ev.preventDefault();
          schliessen();
        } else if (input.value) {
          input.value = '';
          leeren.hidden = true;
        }
      }
    });
    liste.addEventListener('mousedown', (ev) => ev.preventDefault());
    liste.addEventListener('click', (ev) => {
      const li = ev.target.closest('[role="option"]');
      if (li) waehle(li.dataset.i === 'alle' ? 'alle' : Number(li.dataset.i));
    });
    leeren.addEventListener('click', () => {
      input.value = '';
      leeren.hidden = true;
      schliessen();
      input.focus();
    });
    return input;
  }

  /* ---------- Bausteine ---------- */
  function seite(krumen, inhalt) {
    const pfad = krumen.length
      ? `<nav class="krumen" aria-label="Brotkrumen"><a href="#/">Start</a>${krumen.map((k) => ` › ${k}`).join('')}</nav>`
      : '';
    return `<div class="wrap seite">${pfad}${inhalt}</div>`;
  }
  function wirkstoffKachel(w, extra) {
    const b = profilLeer() || !w.indikationen ? [] : befundeFuer(w, profil);
    const klasse = b.length && RANG[b[0].stufe] <= 1 ? ' eintrag--rot' : b.length && RANG[b[0].stufe] <= 3 ? ' eintrag--gelb' : '';
    const marken = (w.handelsnamen || []).slice(0, 4).join(', ');
    return `<li><a class="eintrag${klasse}" href="#/wirkstoff/${w.id}"><strong>${esc(w.name)}</strong>` +
      `<span>${esc(w.kurz || w.klasse || '')}</span>` +
      (marken ? `<span class="eintrag__marken">${esc(marken)}</span>` : '') +
      (extra ? `<span>${extra}</span>` : '') +
      (klasse ? `<span class="vh">Achtung: passt möglicherweise nicht zu Ihrem Profil</span>` : '') +
      `</a></li>`;
  }
  const abschnitt = (id, titel, inhalt, zaehler) =>
    `<section class="karte" id="${id}" aria-labelledby="${id}-titel"><h2 id="${id}-titel">${titel}${zaehler != null ? ` <span class="zaehler">${zaehler}</span>` : ''}</h2>${inhalt}</section>`;
  const fachinfoHinweis = () =>
    `<p class="quelle">Vereinfachte Zusammenfassung, ohne Gewähr. Verbindlich ist die von Swissmedic genehmigte Fach- und Patienteninformation auf <a href="https://www.swissmedicinfo.ch/" rel="noopener">swissmedicinfo.ch</a>. Fragen Sie Ihre Ärztin, Ihren Arzt oder Ihre Apotheke.</p>`;

  /* ---------- Ansichten ---------- */
  function viewStart() {
    const markenZahl = new Set(M.wirkstoffe.concat(M.kurzeintraege || []).flatMap((w) => w.handelsnamen || [])).size;
    const beispiele = ['Bluthochdruck', 'Aspirin', 'Ibuprofen', 'Sodbrennen', 'Diabetes', 'Dafalgan', 'Cipralex', 'Migräne']
      .filter((b) => S.suche(INDEX, b, { limit: 1 }).length);
    const profilKarte = profilLeer()
      ? `<div class="karte"><h2>Persönlicher Medikamenten-Check</h2><p>Tragen Sie Ihre Erkrankungen (z. B. Bluthochdruck, Asthma, Schwangerschaft) und Ihre Medikamente ein. Danach markiert die Suche Mittel, die nicht zu Ihnen passen könnten, und jede Wirkstoffseite zeigt Gegenanzeigen und Wechselwirkungen für Sie.</p><a class="knopf" href="#/check">${ICON.plus}Check einrichten</a></div>`
      : `<div class="karte"><h2>Ihr Profil wird berücksichtigt</h2><div class="chips">${profil.krankheiten.map((id) => `<a class="chip" href="#/krankheit/${id}">${esc(KR.get(id).name)}</a>`).join('')}${profil.medikamente.map((id) => `<a class="chip" href="#/wirkstoff/${id}">${esc((WS.get(id) || KURZ.get(id)).name)}</a>`).join('')}</div><p class="quelle">Treffer mit <span class="punkt punkt--rot" aria-hidden="true">!</span> passen möglicherweise nicht zu Ihren Angaben. <a href="#/check">Check ansehen und bearbeiten</a></p></div>`;
    main.innerHTML =
      `<section class="held"><div class="wrap">` +
      `<p class="held__kicker">Unabhängig · ohne Werbung · ohne Tracking${M.stand ? ` · Stand ${esc(M.stand)}` : ''}</p>` +
      `<h1 tabindex="-1">Medikamente in der Schweiz – verständlich erklärt</h1>` +
      `<p class="held__lead">Wirkstoff, Markenname oder Krankheit eintippen – schon beim ersten Buchstaben erscheinen Vorschläge, auch bei Tippfehlern. Zu jedem Medikament: Wirkungsweise, Gegenanzeigen, Wechselwirkungen und Nebenwirkungen nach Häufigkeit.</p>` +
      `<div id="start-suche"></div>` +
      (beispiele.length ? `<div class="beispiele"><span>Beispiele:</span>${beispiele.map((b) => `<button class="chip" type="button" data-beispiel="${esc(b)}">${esc(b)}</button>`).join('')}</div>` : '') +
      `</div></section><div class="wrap">${profilKarte}` +
      `<div class="zahlen">` +
      `<div class="zahl"><strong>${zahl(M.wirkstoffe.length + (M.kurzeintraege || []).length)}</strong><span>Wirkstoffe</span></div>` +
      `<div class="zahl"><strong>${zahl(markenZahl)}</strong><span>Schweizer Handelsnamen</span></div>` +
      `<div class="zahl"><strong>${zahl(M.krankheiten.length)}</strong><span>Krankheiten und Situationen</span></div>` +
      (P.liste && P.liste.length ? `<div class="zahl"><strong>${zahl(P.liste.length)}</strong><span>Swissmedic-Präparate</span></div>` : `<div class="zahl"><strong>${zahl(M.gruppen.length)}</strong><span>Wirkstoffgruppen</span></div>`) +
      `</div><h2 class="vh">Nachschlagen</h2><div class="kacheln">` +
      `<a class="kachel" href="#/a-z"><h3>Wirkstoffe A–Z</h3><p>Alle Wirkstoffe alphabetisch und nach Organsystem.</p></a>` +
      `<a class="kachel" href="#/krankheiten"><h3>Nach Krankheit</h3><p>Was hilft bei Bluthochdruck, Migräne oder Sodbrennen – und was ist dann tabu?</p></a>` +
      `<a class="kachel" href="#/gruppen"><h3>Wirkstoffgruppen</h3><p>NSAR, Betablocker, CYP3A4-Hemmer: wer mit wem nicht kann.</p></a>` +
      `<a class="kachel" href="#/check"><h3>Mein Check</h3><p>Eigene Medikamente und Erkrankungen gegeneinander prüfen.</p></a>` +
      `</div></div>`;
    const input = suchfeld($('#start-suche'), { id: 'suche-start', gross: true, placeholder: 'z. B. Aspirin, Bluthochdruck, Pantoprazol …' });
    $$('[data-beispiel]').forEach((b) => b.addEventListener('click', () => {
      input.value = b.dataset.beispiel;
      input.dispatchEvent(new Event('input'));
      input.focus();
    }));
    return { titel: null, fokus: window.matchMedia('(min-width: 720px)').matches ? input : null };
  }

  function viewWirkstoff(id, ziel) {
    const kern = WS.get(id);
    if (!kern) return KURZ.has(id) ? viewKurz(KURZ.get(id)) : view404();
    const d = details(id);
    if (!d) {
      main.innerHTML = seite([`<a href="#/a-z">Wirkstoffe</a>`, esc(kern.name)],
        `<div class="mono-kopf"><h1 tabindex="-1">${esc(kern.name)}</h1><p class="mono-kopf__klasse">${esc(kern.klasse)}</p></div><p class="leer" role="status">Angaben werden geladen …</p>`);
      ladeDetails(id).then((ok) => {
        if (aktuelleSeite !== `wirkstoff/${id}`) return;
        if (ok && details(id)) render(false);
        else $('[role="status"]', main).textContent = 'Die Angaben konnten nicht geladen werden. Bitte Seite neu laden.';
      });
      return { titel: kern.name, ziel };
    }
    const w = { ...kern, ...d };
    const genommen = profil.medikamente.includes(id);
    const befunde = befundeFuer(w, profil);
    let profilBox;
    if (profilLeer()) {
      profilBox = `<div class="profilbox no-print"><h2>Passt das zu mir?</h2><p>Tragen Sie im <a href="#/check">Check</a> Ihre Erkrankungen und Medikamente ein – dann sehen Sie hier, ob es Gegenanzeigen oder Wechselwirkungen gibt.</p></div>`;
    } else if (befunde.length) {
      const rot = RANG[befunde[0].stufe] <= 1;
      profilBox = `<div class="profilbox profilbox--${rot ? 'rot' : 'gelb'}"><h2>${rot ? 'Achtung bei Ihrem Profil' : 'Hinweise zu Ihrem Profil'}</h2><ul class="liste-saubere warnliste">${befunde.map(befundLi).join('')}</ul><p class="quelle">Bitte besprechen Sie das mit Ihrer Ärztin, Ihrem Arzt oder in der Apotheke. Setzen Sie nichts eigenmächtig ab.</p></div>`;
    } else {
      profilBox = `<div class="profilbox profilbox--gruen"><h2>Keine Konflikte mit Ihrem Profil gefunden</h2><p>In unseren Daten gibt es keine Gegenanzeige oder Wechselwirkung mit Ihren Angaben. Das ist keine Garantie – die Daten sind vereinfacht und nicht vollständig.</p></div>`;
    }

    const teile = [];
    const toc = [];
    const add = (aid, titel, html, n) => {
      toc.push([aid, titel]);
      teile.push(abschnitt(aid, titel, html, n));
    };
    add('anwendung', 'Wofür wird es angewendet?',
      `<ul class="punkte">${w.indikationen.map((e) => `<li>${verlinkt(e.text, krZiele(e.ids))}</li>`).join('')}</ul>`);
    add('wirkung', 'Wie wirkt es?', `<p>${esc(w.wirkmechanismus)}</p>`);
    if ((w.kontraindikationen || []).length || (w.vorsicht || []).length) {
      add('gegenanzeigen', 'Wann darf es nicht angewendet werden?',
        ((w.kontraindikationen || []).length
          ? `<h3>Gegenanzeigen (Kontraindikationen)</h3><ul class="liste-saubere warnliste">${w.kontraindikationen.map((e) => `<li class="stufe-kontra">${verlinkt(e.text, krZiele(e.ids))}</li>`).join('')}</ul>`
          : '') +
        ((w.vorsicht || []).length
          ? `<h3>Nur mit besonderer Vorsicht</h3><ul class="liste-saubere warnliste">${w.vorsicht.map((e) => `<li class="stufe-vorsicht">${verlinkt(e.text, krZiele(e.ids))}</li>`).join('')}</ul>`
          : ''));
    }
    if ((w.kontraMedikamente || []).length) {
      add('kombination', 'Nicht zusammen einnehmen mit',
        `<ul class="liste-saubere warnliste">${w.kontraMedikamente.map((e) => `<li class="stufe-kontra"><strong>${verlinkt(e.text, refZiele(e.ref))}</strong><span class="klein">${esc(e.grund)}</span></li>`).join('')}</ul>`,
        w.kontraMedikamente.length);
    }
    if ((w.interaktionen || []).length) {
      const sortiert = w.interaktionen.slice().sort((a, b) => RANG[a.schwere] - RANG[b.schwere]);
      add('wechselwirkungen', 'Wechselwirkungen',
        `<ul class="liste-saubere warnliste">${sortiert.map((e) => `<li class="stufe-${e.schwere}"><span class="stufe-label">${STUFE_TEXT[e.schwere]}</span><strong>${verlinkt(e.text, refZiele(e.ref))}</strong><span class="klein">${esc(e.effekt)}</span></li>`).join('')}</ul>`,
        w.interaktionen.length);
    }
    const rueck = rueckverweise(w);
    if (rueck.direkt.length || rueck.gruppe.length) {
      const li = (x) => `<li class="stufe-${x.stufe}"><span class="stufe-label">${STUFE_TEXT[x.stufe]}</span><strong>${linkWs(x.w.id)}: ${esc(x.e.text)}</strong><span class="klein">${esc(x.e.effekt || x.e.grund || '')}</span></li>`;
      add('rueckverweise', 'Weitere Wechselwirkungen aus anderen Monografien',
        `<p>Diese Medikamente nennen ${esc(w.name)}${rueck.gruppe.length ? ' oder eine seiner Wirkstoffgruppen' : ''} in ihren eigenen Wechselwirkungen.</p>` +
        (rueck.direkt.length ? `<ul class="liste-saubere warnliste">${rueck.direkt.map(li).join('')}</ul>` : '') +
        (rueck.gruppe.length ? `<details class="mehr"><summary>Über Wirkstoffgruppen (${rueck.gruppe.length})</summary><ul class="liste-saubere warnliste">${rueck.gruppe.map(li).join('')}</ul></details>` : ''),
        rueck.direkt.length + rueck.gruppe.length);
    }
    const nw = w.nebenwirkungen || {};
    const nwStufen = NW.filter(([key]) => (nw[key] || []).length);
    if (nwStufen.length) {
      add('nebenwirkungen', 'Nebenwirkungen nach Häufigkeit',
        `<div class="nw">${nwStufen.map(([key, label, def, n]) =>
          `<div class="nw__stufe nw--${n}"><div class="nw__kopf"><strong>${label}</strong><span>${def}</span>` +
          (n ? `<span class="skala" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>` : '') +
          `</div><ul class="nw__liste">${nw[key].map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`).join('')}</div>` +
        `<p class="quelle">Häufigkeiten nach der Konvention der Fachinformation. Nicht jede Person bekommt Nebenwirkungen. Bei schweren oder ungewöhnlichen Beschwerden ärztlichen Rat einholen.</p>`);
    }
    if (w.schwangerschaft || w.stillzeit) {
      add('schwangerschaft', 'Schwangerschaft und Stillzeit',
        `<div class="zwei">${w.schwangerschaft ? `<div><h3>Schwangerschaft</h3><p>${esc(w.schwangerschaft)}</p></div>` : ''}${w.stillzeit ? `<div><h3>Stillzeit</h3><p>${esc(w.stillzeit)}</p></div>` : ''}</div>`);
    }
    if ((w.hinweise || []).length) add('hinweise', 'Gut zu wissen', `<ul class="punkte">${w.hinweise.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>`);
    const praep = (praepNachWs.get(id) || []).slice().sort(nachName);
    if (praep.length) {
      add('praeparate', 'Zugelassene Präparate (Swissmedic)',
        `<ul class="liste-saubere eintrag-liste">${praep.slice(0, 200).map((p) => `<li><a href="#/praeparat/${encodeURIComponent(p.nr)}">${esc(p.name)}</a><span class="klein">${esc([p.inhaber, p.abgabe ? `Abgabe ${p.abgabe}` : ''].filter(Boolean).join(' · '))}</span></li>`).join('')}</ul>` +
        (praep.length > 200 ? `<p class="quelle">… und ${praep.length - 200} weitere.</p>` : ''), praep.length);
    }
    const klassenGruppe = (w.gruppen || []).find((g) => (GR.get(g) || {}).art === 'wirkstoffklasse');
    if (klassenGruppe) {
      const verwandt = (mitglieder.get(klassenGruppe) || []).filter((x) => x.id !== id).sort(nachName);
      if (verwandt.length) {
        add('verwandt', 'Ähnliche Wirkstoffe',
          `<p>Ebenfalls in der Gruppe ${linkGr(klassenGruppe)}:</p><div class="chips">${verwandt.slice(0, 30).map((x) => `<a class="chip" href="#/wirkstoff/${x.id}">${esc(x.name)}</a>`).join('')}</div>`);
      }
    }
    const gruppenLinks = (w.gruppen || []).filter((g) => GR.has(g)).map((g) => linkGr(g)).join(', ');
    add('quelle', 'Quelle und Stand',
      (gruppenLinks ? `<p>Gruppen für den Wechselwirkungs-Check: ${gruppenLinks}.</p>` : '') +
      `<p>Datenstand: ${esc(w.stand)}. ${w.zweitpruefung
        ? 'Redaktionell zusammengefasst und von einer zweiten, unabhängigen Prüfung gegen die Fachinformation gegengelesen.'
        : 'Redaktionell zusammengefasst und automatisch auf Format und Verweise geprüft; eine unabhängige Zweitprüfung steht noch aus.'}</p>${fachinfoHinweis()}`);

    main.innerHTML = seite([`<a href="#/a-z">Wirkstoffe</a>`, esc(w.name)],
      `<div class="mono-kopf"><h1 tabindex="-1">${esc(w.name)}</h1>` +
      `<p class="mono-kopf__klasse">${esc(w.klasse)}</p>` +
      (w.kurz ? `<p class="lead">${esc(w.kurz)}</p>` : '') +
      `<div class="meta">${(w.abgabe || []).map(abgabeBadge).join('')}${(w.atc || []).map((c) => `<span class="atc" title="ATC-Code">${esc(c)}</span>`).join('')}` +
      ((w.darreichung || []).length ? `<span class="meta__item">${esc(w.darreichung.join(', '))}</span>` : '') + `</div>` +
      ((w.handelsnamen || []).length ? `<p class="meta__item">In der Schweiz zum Beispiel als:</p><ul class="marken">${w.handelsnamen.map((h) => `<li><span class="marke-chip">${esc(h)}</span></li>`).join('')}</ul>` : '') +
      ((w.kombinationAus || []).length ? `<p class="meta__item">Kombination aus: ${w.kombinationAus.map((k) => linkWs(k)).join(' + ')}</p>` : '') +
      `<div class="knopfreihe"><button class="knopf" type="button" id="nehme-knopf" aria-pressed="${genommen}">${genommen ? ICON.haken : ICON.plus}${genommen ? 'In meinem Check' : 'Ich nehme dieses Medikament'}</button>` +
      `<a class="knopf knopf--leise" href="#/check">Zum Check</a></div></div>` +
      `<div class="mono"><nav class="inhalt-nav" aria-label="Inhalt dieser Seite"><ol>${toc.map(([aid, t]) => `<li><a href="#/wirkstoff/${id}/${aid}" data-scroll="${aid}">${esc(t)}</a></li>`).join('')}</ol></nav>` +
      `<div>${profilBox}${teile.join('')}</div></div>`);
    $('#nehme-knopf').addEventListener('click', () => {
      profilUmschalten('medikamente', id);
      render(true, '#nehme-knopf');
    });
    return { titel: w.name, ziel };
  }

  function viewKurz(w) {
    main.innerHTML = seite([`<a href="#/a-z">Wirkstoffe</a>`, esc(w.name)],
      `<div class="mono-kopf"><h1 tabindex="-1">${esc(w.name)}</h1><p class="mono-kopf__klasse">${esc(w.klasse || '')}</p>` +
      `<div class="meta">${(w.abgabe || []).map(abgabeBadge).join('')}${(w.atc || []).map((c) => `<span class="atc">${esc(c)}</span>`).join('')}</div>` +
      ((w.handelsnamen || []).length ? `<p class="meta__item">In der Schweiz zum Beispiel als:</p><ul class="marken">${w.handelsnamen.map((h) => `<li><span class="marke-chip">${esc(h)}</span></li>`).join('')}</ul>` : '') +
      `</div><div class="karte"><h2>Noch keine ausführliche Beschreibung</h2><p>Für diesen Wirkstoff liegt in unseren Daten noch keine Monografie mit Wirkungsweise, Gegenanzeigen und Nebenwirkungen vor.</p>${fachinfoHinweis()}</div>` +
      (() => {
        const r = rueckverweise(w);
        const alle = r.direkt.concat(r.gruppe);
        return alle.length
          ? abschnitt('rueckverweise', 'Wechselwirkungen aus anderen Monografien', `<ul class="liste-saubere warnliste">${alle.map((x) => `<li class="stufe-${x.stufe}"><span class="stufe-label">${STUFE_TEXT[x.stufe]}</span><strong>${linkWs(x.w.id)}: ${esc(x.e.text)}</strong><span class="klein">${esc(x.e.effekt || x.e.grund || '')}</span></li>`).join('')}</ul>`, alle.length)
          : '';
      })());
    return { titel: w.name };
  }

  function viewKrankheit(id) {
    const k = KR.get(id);
    if (!k) return view404();
    const betrifft = profil.krankheiten.includes(id);
    const mittel = eintraegeVon(indiziert.get(id) || []);
    const warn = eintraegeVon(gegenanzeige.get(id) || []);
    const kontra = warn.filter((x) => x.stufe === 'kontra');
    const vorsicht = warn.filter((x) => x.stufe !== 'kontra');
    // Nach Wirkstoffklasse gruppieren
    const gruppiert = new Map();
    for (const x of mittel) {
      const g = (x.w.gruppen || []).find((gid) => (GR.get(gid) || {}).art === 'wirkstoffklasse');
      push(gruppiert, g ? GR.get(g).name : 'Weitere Wirkstoffe', x);
    }
    const gruppenHtml = Array.from(gruppiert.entries())
      .sort((a, b) => (a[0] === 'Weitere Wirkstoffe') - (b[0] === 'Weitere Wirkstoffe') || b[1].length - a[1].length || a[0].localeCompare(b[0], 'de'))
      .map(([name, liste]) => `<h3>${esc(name)}</h3><ul class="raster">${liste.map((x) => wirkstoffKachel(x.w, x.texte.length ? esc(x.texte[0]) : '')).join('')}</ul>`)
      .join('');
    const warnLi = (x) => `<li class="stufe-${x.stufe}" data-filter="${esc(S.falte(x.w.name + ' ' + (x.w.handelsnamen || []).join(' ')))}"><strong>${linkWs(x.w.id)}</strong><span class="klein">${esc(x.texte.join(' · '))}</span></li>`;
    main.innerHTML = seite([`<a href="#/krankheiten">Krankheiten</a>`, esc(k.name)],
      `<div class="mono-kopf"><h1 tabindex="-1">${esc(k.name)}</h1>` +
      `<p class="mono-kopf__klasse">${esc(k.kategorie)}</p>` +
      ((k.synonyme || []).length ? `<p class="lead">Auch: ${esc(k.synonyme.join(', '))}</p>` : '') +
      `<div class="knopfreihe"><button class="knopf" type="button" id="betrifft-knopf" aria-pressed="${betrifft}">${betrifft ? ICON.haken : ICON.plus}${betrifft ? 'In meinem Check' : 'Betrifft mich – in den Check'}</button></div></div>` +
      abschnitt('mittel', `Medikamente bei ${esc(k.name)}`,
        mittel.length ? gruppenHtml : `<p class="leer">In unseren Daten ist kein Medikament mit diesem Anwendungsgebiet verzeichnet.</p>`, mittel.length) +
      abschnitt('vorsicht', `Vorsicht bei ${esc(k.name)}`,
        warn.length
          ? `<p>Diese Medikamente sind bei ${esc(k.name)} nicht geeignet oder nur mit Vorsicht anzuwenden.</p>` +
            (warn.length > 12 ? `<div class="filterleiste"><label class="vh" for="warn-filter">Liste filtern</label><input type="search" id="warn-filter" placeholder="Liste filtern, z. B. Ibuprofen"></div>` : '') +
            (kontra.length ? `<h3>Kontraindiziert</h3><ul class="liste-saubere warnliste" data-filterbar>${kontra.map(warnLi).join('')}</ul>` : '') +
            (vorsicht.length ? `<h3>Mit Vorsicht</h3><ul class="liste-saubere warnliste" data-filterbar>${vorsicht.map(warnLi).join('')}</ul>` : '')
          : `<p class="leer">In unseren Daten sind keine Gegenanzeigen für diese Situation verzeichnet.</p>`,
        warn.length) +
      `<div class="karte">${fachinfoHinweis()}</div>`);
    $('#betrifft-knopf').addEventListener('click', () => {
      profilUmschalten('krankheiten', id);
      render(true, '#betrifft-knopf');
    });
    const filter = $('#warn-filter');
    if (filter) {
      filter.addEventListener('input', () => {
        const q = S.falte(filter.value);
        $$('[data-filterbar] > li').forEach((li) => { li.hidden = !!q && !li.dataset.filter.includes(q); });
      });
    }
    return { titel: k.name };
  }

  function viewGruppe(id) {
    const g = GR.get(id);
    if (!g) return view404();
    const liste = (mitglieder.get(id) || []).slice().sort(nachName);
    const betroffen = (verweise.get(`gruppe:${id}`) || []).slice().sort((a, b) => RANG[a.stufe] - RANG[b.stufe] || nachName(a.w, b.w));
    main.innerHTML = seite([`<a href="#/gruppen">Wirkstoffgruppen</a>`, esc(g.name)],
      `<div class="mono-kopf"><h1 tabindex="-1">${esc(g.name)}</h1>` +
      `<p class="mono-kopf__klasse">${esc((GRUPPEN_ART[g.art] || ['Gruppe'])[0])}</p>` +
      (g.beschreibung ? `<p class="lead">${esc(g.beschreibung)}</p>` : '') + `</div>` +
      abschnitt('mitglieder', 'Wirkstoffe in dieser Gruppe',
        liste.length ? `<ul class="raster">${liste.map((w) => wirkstoffKachel(w)).join('')}</ul>` : `<p class="leer">Keine Wirkstoffe zugeordnet.</p>`, liste.length) +
      (betroffen.length
        ? abschnitt('betroffen', 'Wechselwirkungen mit dieser Gruppe',
          `<ul class="liste-saubere warnliste">${betroffen.map((x) => `<li class="stufe-${x.stufe}"><span class="stufe-label">${STUFE_TEXT[x.stufe]}</span><strong>${linkWs(x.w.id)}: ${esc(x.e.text)}</strong><span class="klein">${esc(x.e.effekt || x.e.grund || '')}</span></li>`).join('')}</ul>`,
          betroffen.length)
        : ''));
    return { titel: g.name };
  }

  function viewPraeparat(nr) {
    const p = PR.get(nr);
    if (!p) return view404();
    const zeilen = [
      ['Zulassungsnummer', p.nr], ['Zulassungsinhaberin', p.inhaber], ['Wirkstoff(e)', p.wirkstoffe], ['ATC-Code', p.atc],
      ['Abgabekategorie', p.abgabe ? `${p.abgabe}${ABGABE[p.abgabe] ? ` – ${ABGABE[p.abgabe][0]}` : ''}` : ''],
      ['Heilmittelcode', p.kategorie], ['Anwendungsgebiet (Swissmedic)', p.anwendung], ['Erstzulassung', p.zulassung],
    ].filter(([, v]) => v);
    main.innerHTML = seite([esc(p.name)],
      `<div class="mono-kopf"><h1 tabindex="-1">${esc(p.name)}</h1><p class="mono-kopf__klasse">Von Swissmedic zugelassenes Arzneimittel</p></div>` +
      `<div class="karte tabelle-scroll"><table class="tabelle"><tbody>${zeilen.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table></div>` +
      ((p.wid || []).length
        ? abschnitt('monografie', 'Wirkung, Gegenanzeigen und Nebenwirkungen', `<ul class="raster">${p.wid.filter((id) => WS.has(id) || KURZ.has(id)).map((id) => wirkstoffKachel(WS.get(id) || KURZ.get(id))).join('')}</ul>`)
        : `<div class="karte"><p>Zu diesem Präparat ist kein Wirkstoff in unserem Lexikon zugeordnet.</p></div>`) +
      `<div class="karte"><p class="quelle">Quelle: Swissmedic, Liste der zugelassenen Arzneimittel${P.stand ? `, Stand ${esc(P.stand)}` : ''}.</p>${fachinfoHinweis()}</div>`);
    return { titel: p.name };
  }

  function viewSuche(q) {
    const treffer = S.suche(INDEX, q, { limit: 120 });
    const teile = [
      ['Wirkstoffe', treffer.filter((t) => t.typ === 'wirkstoff' || t.typ === 'kurz')],
      ['Handelsnamen', treffer.filter((t) => t.typ === 'marke')],
      ['Krankheiten und Anwendungsgebiete', treffer.filter((t) => t.typ === 'krankheit')],
      ['Wirkstoffgruppen', treffer.filter((t) => t.typ === 'gruppe')],
      ['Swissmedic-Präparate', treffer.filter((t) => t.typ === 'praeparat')],
    ].filter(([, l]) => l.length);
    main.innerHTML = seite([`Suche`],
      `<h1 tabindex="-1">Suche: «${esc(q)}»</h1>` +
      `<div class="suche-seite" id="suche-seite"></div>` +
      (teile.length
        ? teile.map(([titel, l]) => abschnitt(`t-${S.falte(titel).replace(/ /g, '-')}`, titel,
          `<ul class="liste-saubere eintrag-liste">${l.map((t) => `<li><a href="${zielHash(t)}">${esc(t.label)}</a> <span class="typ typ--${t.typ}">${TYP_TEXT[t.typ]}</span><span class="klein">${esc(t.sub || '')}</span></li>`).join('')}</ul>`, l.length)).join('')
        : `<div class="karte"><p>Keine Treffer. Prüfen Sie die Schreibweise oder versuchen Sie den Wirkstoff (z. B. «Ibuprofen» statt einer Marke) oder eine Krankheit.</p></div>`));
    suchfeld($('#suche-seite'), { id: 'suche-seite-feld', placeholder: 'Neue Suche …', wert: q });
    return { titel: `Suche: ${q}` };
  }

  function viewAZ() {
    const alle = M.wirkstoffe.concat(M.kurzeintraege || []).slice().sort(nachName);
    const gruppenAtc = eindeutig(alle.flatMap((w) => (w.atc || []).map((c) => c[0]))).filter((c) => ATC[c]).sort();
    main.innerHTML = seite([`Wirkstoffe A–Z`],
      `<h1 tabindex="-1">Alle Wirkstoffe von A bis Z</h1>` +
      `<p class="lead">${zahl(alle.length)} Wirkstoffe, die in der Schweiz als Arzneimittel zugelassen sind – mit ihren Schweizer Handelsnamen.</p>` +
      `<div class="filterleiste"><label class="vh" for="az-filter">Wirkstoffe filtern</label><input type="search" id="az-filter" placeholder="Filtern nach Name oder Marke …">` +
      `<label class="vh" for="az-atc">Organsystem</label><select id="az-atc"><option value="">Alle Organsysteme</option>${gruppenAtc.map((c) => `<option value="${c}">${c} – ${esc(ATC[c])}</option>`).join('')}</select></div>` +
      `<ul class="buchstaben" id="az-buchstaben"></ul><div id="az-liste"></div>`);
    const filter = $('#az-filter');
    const atc = $('#az-atc');
    function zeichne() {
      const q = S.falte(filter.value);
      const a = atc.value;
      const liste = alle.filter((w) => (!a || (w.atc || []).some((c) => c[0] === a)) &&
        (!q || S.falte([w.name, ...(w.handelsnamen || []), ...(w.synonyme || [])].join(' ')).includes(q)));
      const nachBuchstabe = new Map();
      for (const w of liste) {
        const b = S.basis(w.name)[0].toUpperCase();
        push(nachBuchstabe, /[A-Z]/.test(b) ? b : '#', w);
      }
      $('#az-buchstaben').innerHTML = Array.from(nachBuchstabe.keys()).map((b) => `<li><a href="#/a-z" data-scroll="az-${b}">${b}</a></li>`).join('');
      $('#az-liste').innerHTML = liste.length
        ? Array.from(nachBuchstabe.entries()).map(([b, l]) => `<section class="az-gruppe" id="az-${b}" aria-label="Buchstabe ${b}"><h2>${b}</h2><ul class="raster">${l.map((w) => wirkstoffKachel(w)).join('')}</ul></section>`).join('')
        : `<p class="leer">Kein Wirkstoff passt zum Filter.</p>`;
    }
    filter.addEventListener('input', zeichne);
    atc.addEventListener('change', zeichne);
    zeichne();
    return { titel: 'Wirkstoffe A–Z' };
  }

  function viewKrankheiten() {
    const nachKat = new Map();
    for (const k of M.krankheiten.slice().sort(nachName)) push(nachKat, k.kategorie, k);
    const kats = Array.from(nachKat.keys()).sort((a, b) => (KATEGORIEN.indexOf(a) + 1 || 99) - (KATEGORIEN.indexOf(b) + 1 || 99));
    main.innerHTML = seite([`Krankheiten`],
      `<h1 tabindex="-1">Medikamente nach Krankheit</h1>` +
      `<p class="lead">Wählen Sie eine Krankheit oder Situation: Sie sehen, welche Medikamente dafür eingesetzt werden – und welche Sie dann meiden sollten.</p>` +
      `<div class="filterleiste"><label class="vh" for="kr-filter">Krankheiten filtern</label><input type="search" id="kr-filter" placeholder="Filtern, z. B. Blutdruck, Zucker, Niere …"></div>` +
      kats.map((kat) => `<section class="karte" data-kat><h2>${esc(kat)}</h2><ul class="raster">${nachKat.get(kat).map((k) => {
        const n = eintraegeVon(indiziert.get(k.id) || []).length;
        const v = eintraegeVon(gegenanzeige.get(k.id) || []).length;
        return `<li data-filter="${esc(S.falte([k.name, ...(k.synonyme || [])].join(' ')))}"><a class="eintrag" href="#/krankheit/${k.id}"><strong>${esc(k.name)}</strong><span>${[n ? `${n} Medikamente` : '', v ? `${v} mit Vorsicht/Gegenanzeige` : ''].filter(Boolean).join(' · ') || 'Situation'}</span></a></li>`;
      }).join('')}</ul></section>`).join(''));
    const filter = $('#kr-filter');
    filter.addEventListener('input', () => {
      const q = S.falte(filter.value);
      $$('[data-kat]').forEach((sec) => {
        let sichtbar = 0;
        $$('li', sec).forEach((li) => {
          li.hidden = !!q && !li.dataset.filter.includes(q);
          if (!li.hidden) sichtbar++;
        });
        sec.hidden = sichtbar === 0;
      });
    });
    return { titel: 'Medikamente nach Krankheit' };
  }

  function viewGruppen() {
    const nachArt = new Map();
    for (const g of M.gruppen.slice().sort(nachName)) push(nachArt, g.art || 'wirkstoffklasse', g);
    main.innerHTML = seite([`Wirkstoffgruppen`],
      `<h1 tabindex="-1">Wirkstoffgruppen</h1>` +
      `<p class="lead">Gruppen machen Wechselwirkungen verständlich: Ein Mittel, das «starke CYP3A4-Hemmer» meiden muss, verträgt sich mit allen Wirkstoffen dieser Gruppe schlecht.</p>` +
      Object.keys(GRUPPEN_ART).filter((a) => nachArt.has(a)).map((art) =>
        `<section class="karte"><h2>${GRUPPEN_ART[art][0]}</h2><p>${GRUPPEN_ART[art][1]}</p><ul class="raster">${nachArt.get(art).map((g) => {
          const n = (mitglieder.get(g.id) || []).length;
          return `<li><a class="eintrag" href="#/gruppe/${g.id}"><strong>${esc(g.name)}</strong><span>${n} ${n === 1 ? 'Wirkstoff' : 'Wirkstoffe'}</span></a></li>`;
        }).join('')}</ul></section>`).join(''));
    return { titel: 'Wirkstoffgruppen' };
  }

  function viewCheck() {
    const befunde = alleBefunde();
    const ohneDaten = profil.medikamente.filter((id) => !WS.has(id));
    const chip = (liste, id, name, href) =>
      `<span class="chip chip--entf"><a href="${href}">${esc(name)}</a><button type="button" data-entf="${liste}" data-id="${id}" aria-label="${esc(name)} entfernen">×</button></span>`;
    const rot = befunde.filter((b) => RANG[b.stufe] <= 1).length;
    const gelb = befunde.filter((b) => RANG[b.stufe] >= 2 && RANG[b.stufe] <= 3).length;
    let ergebnis;
    if (profilLeer()) ergebnis = `<p class="leer">Noch keine Angaben. Fügen Sie oben Erkrankungen und Medikamente hinzu.</p>`;
    else if (!befunde.length) ergebnis = `<div class="profilbox profilbox--gruen"><h3>Keine Konflikte gefunden</h3><p>In unseren Daten gibt es zwischen Ihren Angaben keine bekannte Gegenanzeige oder Wechselwirkung. Das ist keine Garantie – besprechen Sie Ihre Medikation regelmässig mit Ihrer Ärztin, Ihrem Arzt oder Ihrer Apotheke.</p></div>`;
    else ergebnis = `<p>${rot ? `<strong>${rot} wichtige Warnung${rot === 1 ? '' : 'en'}</strong>` : 'Keine schwerwiegenden Konflikte'}${gelb ? `, ${gelb} Hinweis${gelb === 1 ? '' : 'e'} zur Vorsicht` : ''}.</p><ul class="liste-saubere warnliste">${befunde.map(befundLi).join('')}</ul>`;
    main.innerHTML = seite([`Mein Check`],
      `<h1 tabindex="-1">Mein Medikamenten-Check</h1>` +
      `<p class="lead">Erkrankungen und Medikamente eintragen – der Check zeigt Gegenanzeigen und Wechselwirkungen. Ihre Angaben bleiben in diesem Browser und werden nirgends hin gesendet.</p>` +
      `<p class="merken"><label><input type="checkbox" id="check-merken"${dauerhaft() ? ' checked' : ''}> Auf diesem Gerät dauerhaft merken</label> <span class="quelle">Sonst werden die Angaben beim Schliessen des Tabs gelöscht. Auf geteilten Geräten nicht empfohlen.</span></p>` +
      `<div class="check-eingabe">` +
      `<div class="karte"><h2>Meine Erkrankungen und Situationen</h2><div id="check-krankheit"></div><div class="chips">${profil.krankheiten.map((id) => chip('krankheiten', id, KR.get(id).name, `#/krankheit/${id}`)).join('') || '<span class="leer">z. B. Bluthochdruck, Asthma, Schwangerschaft, Niereninsuffizienz</span>'}</div></div>` +
      `<div class="karte"><h2>Meine Medikamente</h2><div id="check-medikament"></div><div class="chips">${profil.medikamente.map((id) => chip('medikamente', id, (WS.get(id) || KURZ.get(id)).name, `#/wirkstoff/${id}`)).join('') || '<span class="leer">Wirkstoff oder Markenname, z. B. Dafalgan, Concor, Xarelto</span>'}</div></div>` +
      `</div>` +
      abschnitt('ergebnis', 'Ergebnis', ergebnis +
        (ohneDaten.length ? `<p class="hinweis">Für ${ohneDaten.map((id) => esc(KURZ.get(id).name)).join(', ')} liegen keine Wechselwirkungsdaten vor.</p>` : '') +
        (profilLeer() ? '' : `<div class="knopfreihe no-print">${imRahmen ? '' : `<button class="knopf knopf--leise" type="button" id="check-drucken">${ICON.druck}Drucken / als PDF</button>`}<button class="knopf knopf--leise" type="button" id="check-leeren">Alle Angaben löschen</button></div>`)) +
      `<div class="karte">${fachinfoHinweis()}</div>`);
    suchfeld($('#check-krankheit'), {
      id: 'check-kr', typen: ['krankheit'], label: 'Erkrankung oder Situation hinzufügen', placeholder: 'Erkrankung hinzufügen …',
      onSelect: (r) => { if (!profil.krankheiten.includes(r.id)) profilUmschalten('krankheiten', r.id); render(true, '#check-kr'); },
    });
    suchfeld($('#check-medikament'), {
      id: 'check-med', typen: ['wirkstoff', 'marke', 'kurz'], label: 'Medikament hinzufügen', placeholder: 'Medikament hinzufügen …',
      onSelect: (r) => { if (!profil.medikamente.includes(r.id)) profilUmschalten('medikamente', r.id); render(true, '#check-med'); },
    });
    $$('[data-entf]').forEach((b) => b.addEventListener('click', () => {
      profilUmschalten(b.dataset.entf, b.dataset.id);
      render(true, b.dataset.entf === 'krankheiten' ? '#check-kr' : '#check-med');
    }));
    $('#check-merken').addEventListener('change', (ev) => setzeDauerhaft(ev.target.checked));
    const drucken = $('#check-drucken');
    if (drucken) drucken.addEventListener('click', () => window.print());
    const leeren = $('#check-leeren');
    if (leeren) {
      leeren.addEventListener('click', () => {
        // Zweistufig auf der Seite bestätigen (Browser-Dialoge sind in eingebetteten Ansichten gesperrt)
        if (leeren.dataset.bestaetigen !== 'ja') {
          leeren.dataset.bestaetigen = 'ja';
          leeren.textContent = 'Wirklich alle löschen? Zum Bestätigen nochmals klicken';
          setTimeout(() => {
            if (!leeren.isConnected) return;
            leeren.dataset.bestaetigen = '';
            leeren.textContent = 'Alle Angaben löschen';
          }, 6000);
          return;
        }
        profil = { krankheiten: [], medikamente: [] };
        speichereProfil();
        render(true, '#check-kr');
      });
    }
    return { titel: 'Mein Medikamenten-Check' };
  }

  function viewInfo() {
    const nMono = M.wirkstoffe.length;
    main.innerHTML = seite([`Über die Daten`],
      `<h1 tabindex="-1">Über die Daten</h1>` +
      `<div class="karte"><h2>Was ist das Medi-Lexikon?</h2><p>Ein unabhängiges, werbefreies Nachschlagewerk zu Medikamenten, die in der Schweiz zugelassen sind. Es erklärt pro Wirkstoff, wofür er eingesetzt wird, wie er wirkt, wann er nicht angewendet werden darf, mit welchen Medikamenten er sich nicht verträgt und welche Nebenwirkungen wie häufig auftreten.</p>` +
      `<p>Aktuell enthält es ${zahl(nMono)} ausführliche Wirkstoff-Monografien${(M.kurzeintraege || []).length ? ` und ${zahl(M.kurzeintraege.length)} Kurzeinträge` : ''}, ${zahl(M.krankheiten.length)} Krankheiten und Situationen sowie ${zahl(M.gruppen.length)} Wirkstoffgruppen${P.liste && P.liste.length ? `, dazu ${zahl(P.liste.length)} Präparate aus der Swissmedic-Liste (Stand ${esc(P.stand || '?')})` : ''}.</p></div>` +
      `<div class="karte hinweis--rot"><h2>Wichtig: kein Ersatz für Beratung</h2><p>Die Texte sind vereinfachte Zusammenfassungen und können Fehler enthalten oder veraltet sein. Massgebend sind ausschliesslich die von Swissmedic genehmigten Fach- und Patienteninformationen auf <a href="https://www.swissmedicinfo.ch/" rel="noopener">swissmedicinfo.ch</a> sowie die Beratung durch Ärztin, Arzt oder Apotheke. Setzen Sie Medikamente nie eigenmächtig ab und ändern Sie keine Dosis ohne Rücksprache. Im Notfall: <strong>144</strong>, bei Vergiftungen <strong>145</strong> (Tox Info Suisse).</p></div>` +
      `<div class="karte"><h2>Häufigkeit von Nebenwirkungen</h2><div class="tabelle-scroll"><table class="tabelle"><tbody>${NW.map(([, l, d]) => `<tr><th scope="row">${l}</th><td>${d}</td></tr>`).join('')}</tbody></table></div><p class="quelle">Diese Einteilung entspricht der Konvention in den Schweizer Fachinformationen (MedDRA).</p></div>` +
      `<div class="karte"><h2>Abgabekategorien in der Schweiz</h2><div class="tabelle-scroll"><table class="tabelle"><tbody>${['A', 'B', 'D', 'E'].map((a) => `<tr><th scope="row">${abgabeBadge(a)}</th><td>${esc(ABGABE[a][1])}</td></tr>`).join('')}</tbody></table></div><p class="quelle">Die frühere Kategorie C wurde 2019 aufgehoben; die Präparate wurden den Kategorien B oder D zugeteilt.</p></div>` +
      `<div class="karte"><h2>Wie funktioniert der Check?</h2><p>Jeder Wirkstoff gehört zu Gruppen – z. B. Ibuprofen zu den NSAR, Clarithromycin zu den starken CYP3A4-Hemmern, Citalopram zu den QT-verlängernden und serotonergen Mitteln. Gegenanzeigen und Wechselwirkungen verweisen auf Krankheiten, einzelne Wirkstoffe oder solche Gruppen. Der Check gleicht Ihre Angaben in beide Richtungen ab. Er findet nur, was in den Daten steht – fehlende Warnungen bedeuten nicht, dass eine Kombination sicher ist.</p></div>` +
      `<div class="karte"><h2>Quellen</h2><ul class="punkte"><li>Swissmedic: Fach- und Patienteninformationen (<a href="https://www.swissmedicinfo.ch/" rel="noopener">swissmedicinfo.ch</a>) und Listen der zugelassenen Humanarzneimittel (<a href="https://www.swissmedic.ch/swissmedic/de/home/services/listen_neu.html" rel="noopener">swissmedic.ch</a>).</li><li>Wirkstoff-Monografien: redaktionell zusammengefasst nach pharmakologischem Standardwissen und Fachinformationen und automatisch auf Format, Verweise und Schreibweise geprüft. ${zahl(M.wirkstoffe.filter((w) => w.zweitpruefung).length)} häufig verwendete Wirkstoffe wurden zusätzlich von einer zweiten, unabhängigen Prüfung gegengelesen – das steht jeweils unten auf der Wirkstoffseite. Stand siehe jeweilige Seite.</li><li>Häufigkeitsangaben: MedDRA-Konvention der Fachinformationen.</li></ul></div>` +
      `<div class="karte"><h2>Datenschutz</h2><p>Kein Tracking, keine Cookies, keine Werbung, keine externen Schriften oder Skripte. Ihr Check-Profil bleibt nur im Browser: standardmässig bis zum Schliessen des Tabs (sessionStorage), auf Wunsch dauerhaft auf diesem Gerät (localStorage). Es wird nie übertragen und lässt sich im Check jederzeit löschen. Das Farbschema wird lokal gespeichert.</p></div>`);
    return { titel: 'Über die Daten' };
  }

  function view404() {
    main.innerHTML = seite([], `<h1 tabindex="-1">Nicht gefunden</h1><div class="karte"><p>Diesen Eintrag gibt es nicht (mehr). Suchen Sie oben nach dem Wirkstoff, der Marke oder der Krankheit.</p><p><a href="#/">Zur Startseite</a></p></div>`);
    return { titel: 'Nicht gefunden' };
  }

  /* ---------- Router ---------- */
  const ROUTEN = [
    [/^$/, () => viewStart(), 'start'],
    [/^wirkstoff\/([^/]+)(?:\/([^/]+))?$/, (m) => viewWirkstoff(m[1], m[2]), 'a-z'],
    [/^krankheit\/([^/]+)$/, (m) => viewKrankheit(m[1]), 'krankheiten'],
    [/^gruppe\/([^/]+)$/, (m) => viewGruppe(m[1]), 'gruppen'],
    [/^praeparat\/([^/]+)$/, (m) => viewPraeparat(m[1]), null],
    [/^suche\/(.*)$/, (m) => viewSuche(m[1]), null],
    [/^a-z$/, () => viewAZ(), 'a-z'],
    [/^krankheiten$/, () => viewKrankheiten(), 'krankheiten'],
    [/^gruppen$/, () => viewGruppen(), 'gruppen'],
    [/^check$/, () => viewCheck(), 'check'],
    [/^info$/, () => viewInfo(), 'info'],
  ];
  let aktuelleSeite = null;
  const scrollZu = (id) => {
    const el = document.getElementById(id);
    if (!el || !main.contains(el) || el === main) return false;
    el.scrollIntoView({ block: 'start' });
    const h = el.querySelector('h2') || el;
    if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1');
    h.focus({ preventScroll: true });
    return true;
  };

  let letzterHash = '#/';
  function render(behalteScroll, fokusSelektor) {
    const roh = location.hash;
    if (roh.length > 1 && !roh.startsWith('#/')) {
      // Sprungmarke (z. B. Skip-Link #inhalt) statt Route: Seite behalten, Adresse zurücksetzen
      history.replaceState(null, '', letzterHash);
      const el = document.getElementById(roh.slice(1));
      if (el && aktuelleSeite !== null) {
        el.focus();
        return;
      }
    }
    letzterHash = location.hash || '#/';
    let pfad = location.hash.replace(/^#\/?/, '');
    try { pfad = decodeURIComponent(pfad); } catch (e) { /* ungültige Kodierung: unverändert */ }
    // Abschnitt innerhalb derselben Wirkstoffseite: nur scrollen
    const abschnittMatch = /^wirkstoff\/([^/]+)\/([^/]+)$/.exec(pfad);
    if (!behalteScroll && abschnittMatch && aktuelleSeite === `wirkstoff/${abschnittMatch[1]}` && scrollZu(abschnittMatch[2])) return;
    const y = window.scrollY;
    let ergebnis = null;
    let nav = null;
    for (const [re, fn, n] of ROUTEN) {
      const m = re.exec(pfad);
      if (m) {
        ergebnis = fn(m);
        nav = n;
        break;
      }
    }
    if (!ergebnis) ergebnis = view404();
    aktuelleSeite = abschnittMatch ? `wirkstoff/${abschnittMatch[1]}` : pfad;
    document.body.classList.toggle('ist-start', pfad === '');
    document.title = ergebnis.titel ? `${ergebnis.titel} – Medi-Lexikon Schweiz` : 'Medi-Lexikon Schweiz – Medikamente, Wirkung, Gegenanzeigen, Nebenwirkungen';
    $$('[data-nav]').forEach((a) => {
      if (a.dataset.nav === nav) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    if (behalteScroll) {
      window.scrollTo(0, y);
      const f = fokusSelektor && $(fokusSelektor);
      if (f) f.focus({ preventScroll: true });
      return;
    }
    if (ergebnis.ziel && scrollZu(ergebnis.ziel)) return;
    window.scrollTo(0, 0);
    if (!erstesRendern) {
      const ziel = ergebnis.fokus || $('h1', main);
      if (ziel) ziel.focus({ preventScroll: true });
    } else if (ergebnis.fokus) {
      ergebnis.fokus.focus({ preventScroll: true });
    }
  }

  /* ---------- Start ---------- */
  let erstesRendern = true;
  suchfeld($('#kopf-suche'), { id: 'suche-kopf', placeholder: 'Medikament oder Krankheit suchen …' });
  $('#daten-stand').textContent =
    `Datenstand ${M.stand || '–'}: ${zahl(M.wirkstoffe.length)} Wirkstoff-Monografien` +
    (P.liste && P.liste.length ? ` · ${zahl(P.liste.length)} Swissmedic-Präparate (Stand ${P.stand || '–'})` : '') + '.';

  $('#theme-knopf').addEventListener('click', () => {
    const root = document.documentElement;
    const aktuell = root.getAttribute('data-theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const neu = aktuell === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', neu);
    try { localStorage.setItem('medi-theme', neu); } catch (e) { /* privater Modus */ }
  });
  document.addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-scroll]');
    if (!a) return;
    ev.preventDefault();
    scrollZu(a.dataset.scroll);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== '/' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const t = ev.target;
    if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
    ev.preventDefault();
    const feld = $('#suche-start') || $('#suche-kopf');
    feld.focus();
  });
  window.addEventListener('hashchange', () => render(false));
  $('.skip-link').addEventListener('click', (ev) => {
    ev.preventDefault();
    main.focus();
    main.scrollIntoView();
  });
  window.addEventListener('storage', (ev) => {
    if (ev.key !== PROFIL_KEY && ev.key !== MERKEN_KEY) return;
    ladeProfil();
    zeigeProfilZahl();
    render(true);
  });
  zeigeProfilZahl();
  render(false);
  erstesRendern = false;
})();
