// Medi-Lexikon – Oberfläche: Router, Ansichten und Suchfeld mit Vorschlägen.
// Alle Daten liegen lokal (data/medikamente.js); es wird nichts an einen Server gesendet.
(function () {
  'use strict';

  const M = window.MEDI || { wirkstoffe: [], kurzeintraege: [], gruppen: [], krankheiten: [] };
  const P = window.MEDI_PRAEPARATE || { liste: [] };
  const S = window.MediSuche;
  const main = document.getElementById('inhalt');

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

  /**
   * Feinsatz beim Anzeigen (die Daten bleiben unverändert): Zahl und Einheit nicht trennen («15 mg»),
   * Ergänzungsstrich am folgenden Wort halten («oder -Durchbrüche»), «z. B.» zusammenhalten.
   */
  const TYPO = [
    [/(\d) (?=(?:mg|g|kg|ml|l|µg|mcg|mmHg|mmol|IE|E|Tag(?:en?)?|Wochen?|Monat(?:en?)?|Jahr(?:en?)?|Stunden?|Minuten?)\b|%)/g, '$1 '],
    [/(^|\s)-(?=[A-Za-zÄÖÜäöü])/g, '$1-⁠'],
    [/\bz\. B\./g, 'z. B.'],
  ];
  function typografie(el) {
    const gang = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = gang.nextNode(); n; n = gang.nextNode()) {
      const alt = n.nodeValue;
      // Der Seitentitel bleibt zeichengenau wie in den Daten (Suche im Text, Tests)
      if (alt.length < 4 || n.parentElement.closest('h1')) continue;
      let neu = alt;
      for (const [re, ersatz] of TYPO) neu = neu.replace(re, ersatz);
      if (neu !== alt) n.nodeValue = neu;
    }
  }

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
    ['gelegentlich', 'Gelegentlich', '1 bis 10 von 1’000 Behandelten', 3],
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
  /** Art einer Wirkstoffgruppe: [Abschnittstitel, Beschreibung, Einzahl für die Gruppenseite] */
  const GRUPPEN_ART = {
    wirkstoffklasse: ['Wirkstoffklassen', 'Arzneimittel mit gleichem Wirkprinzip.', 'Wirkstoffklasse'],
    pharmakokinetisch: ['Enzyme und Transporter', 'Beeinflussen Abbau oder Aufnahme anderer Medikamente (z. B. über CYP3A4).', 'Gruppe nach Enzym oder Transporter'],
    pharmakodynamisch: ['Risikogruppen', 'Verstärken sich in ihrer Wirkung oder Nebenwirkung gegenseitig (z. B. QT-Verlängerung).', 'Risikogruppe'],
  };

  const ICON = {
    suche: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    runter: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  };

  /*
   * Zwei Regeln für Verweise:
   * 1. Ziel einer Zeile oder Liste (der Eintrag IST das Ziel): Name fett, Pfeil dahinter (.eintrag, .ziel).
   * 2. Querverweis zu einem Text: Der Text bleibt Text, das Ziel folgt klein in Grün als «→ Ziel» (.ziele).
   */
  /** Wirkstoffname als Ziel (fett mit Pfeil), z. B. die Bestandteile einer Kombination. */
  const linkWs = (id, label) => {
    const w = WS.get(id) || KURZ.get(id);
    return w ? `<a class="ziel" href="#/wirkstoff/${id}">${esc(label || w.name)}</a>` : esc(label || id);
  };
  const linkGr = (id, label) => (GR.has(id) ? `<a href="#/gruppe/${id}">${esc(label || GR.get(id).name)}</a>` : esc(label || id));
  const refZiele = (refs) =>
    (refs || [])
      .map((r) => (r.startsWith('gruppe:') ? (GR.has(r.slice(7)) ? { href: `#/gruppe/${r.slice(7)}`, label: GR.get(r.slice(7)).name } : null)
        : (WS.has(r) || KURZ.has(r) ? { href: `#/wirkstoff/${r}`, label: (WS.get(r) || KURZ.get(r)).name } : null)))
      .filter(Boolean);
  const krZiele = (ids) => (ids || []).filter((id) => KR.has(id)).map((id) => ({ href: `#/krankheit/${id}`, label: KR.get(id).name }));
  /** Wortstämme (erste 5 Buchstaben) eines Texts – um zu prüfen, ob ein Verweisziel nur den Text wiederholt. */
  const staemme = (t) => S.falte(t).split(' ').filter((w) => w.length >= 4).map((w) => w.slice(0, 5));
  /** Querverweiszeile «→ Ziel, Ziel» (klein, grün). */
  const zieleHtml = (ziele) => (ziele.length
    ? `<span class="ziele"><span class="ziele__pfeil" aria-hidden="true">→</span><span><span class="vh">siehe </span>` +
      `${ziele.map((z) => `<a href="${z.href}">${esc(z.label)}</a>`).join(', ')}</span></span>`
    : '');
  /**
   * Text mit Verweisen: Der Text bleibt immer Text (Textfarbe), die Ziele folgen klein als «→ Ziel» –
   * auch wenn das Ziel ähnlich heisst wie der Text. So sehen Verweise überall gleich aus.
   * titel: Text fett (Partner einer Wechselwirkung).
   */
  function verweis(text, ziele, titel) {
    return { kopf: titel ? `<strong class="titel">${esc(text)}</strong>` : esc(text), ziele: zieleHtml(ziele) };
  }
  const verlinkt = (text, ziele) => {
    const v = verweis(text, ziele);
    return v.kopf + v.ziele;
  };

  /* ---------- Früheres Profil des entfernten «Mein Check» löschen ---------- */
  // Gesundheitsangaben aus älteren Versionen sollen nicht im Browser liegen bleiben.
  for (const store of ['localStorage', 'sessionStorage']) {
    try {
      window[store].removeItem('medi-profil');
      window[store].removeItem('medi-profil-merken');
    } catch (e) { /* Speicher gesperrt (privater Modus) */ }
  }

  /* ---------- Wechselwirkungen ---------- */
  const RANG = { kontra: 0, schwer: 1, vorsicht: 2, mittel: 3, leicht: 4 };
  const STUFE_TEXT = { kontra: 'Kontraindiziert', schwer: 'Schwerwiegend', vorsicht: 'Vorsicht', mittel: 'Mittel', leicht: 'Gering' };

  /** Wirkstoff samt Bestandteilen (bei Kombinationen) und allen Gruppen. */
  function identitaet(w) {
    const ids = new Set([w.id, ...(w.kombinationAus || [])]);
    const gruppen = new Set(w.gruppen || []);
    for (const id of w.kombinationAus || []) for (const g of (WS.get(id) || {}).gruppen || []) gruppen.add(g);
    return { ids, gruppen };
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
    // Eine Liste nach Schweregrad: direkte Nennungen und Nennungen über eine Wirkstoffgruppe gemischt
    return { alle: direkt.concat(gruppe).sort(ordnen) };
  }

  /** Bekannte Wirkstoffe zuerst (Priorität im Verzeichnis, Zahl der Handelsnamen), das Alphabet entscheidet nur bei Gleichstand. */
  const nachRelevanz = (a, b) => (a.prio || 4) - (b.prio || 4) || (b.handelsnamen || []).length - (a.handelsnamen || []).length || nachName(a, b);
  /** Wirkstoffe einer Liste je einmal, die bekanntesten zuerst. */
  const wichtigsteWs = (liste) => Array.from(new Map(liste.map((w) => [w.id, w])).values()).sort(nachRelevanz);

  /* ---------- Suchfeld mit Vorschlägen (Combobox) ---------- */
  const TYP_TEXT = { wirkstoff: 'Wirkstoff', marke: 'Marke', kurz: 'Wirkstoff', krankheit: 'Krankheit', gruppe: 'Gruppe', praeparat: 'Präparat' };
  function zielHash(r) {
    if (r.typ === 'krankheit') return `#/krankheit/${r.id}`;
    if (r.typ === 'gruppe') return `#/gruppe/${r.id}`;
    if (r.typ === 'praeparat') return `#/praeparat/${encodeURIComponent(r.id)}`;
    return `#/wirkstoff/${r.id}`;
  }
  /**
   * Suchtreffer gewichten. «Stark» sind genaue, Anfangs- und Worttreffer (Score ab 70), «schwach» Tippfehler,
   * Wortteile und Klangtreffer. Gibt es mindestens 3 starke Treffer, bleiben von den schwachen nur jene, deren Name
   * auf die Eingabe endet («pril» → Ramipril) oder gleich beginnt («aspe» → Aspirin), höchstens maxSchwach –
   * Zufallstreffer mitten im Wort oder im lateinischen Namen («ibu» → Eribulin, Celecoxibum) fallen weg.
   * Einzelwirkstoffe stehen vor Kombinationen mit demselben Anfang («amox» → Amoxicillin vor Amoxicillin + Clavulansäure).
   */
  const STARK = 70;
  const istKombi = (r) => (r.typ === 'wirkstoff' || r.typ === 'marke') && ((WS.get(r.id) || {}).kombinationAus || []).length > 0;
  function gewichte(q, roh, maxSchwach) {
    const qf = S.falte(q).replace(/ /g, '');
    const anfang = qf.slice(0, 3);
    const rang = (r) => r.score - (istKombi(r) ? 3 : 0);
    const stark = roh.filter((r) => r.score >= STARK).sort((a, b) => rang(b) - rang(a));
    const passt = (r) => {
      const n = S.falte(r.label);
      return n.replace(/ /g, '').startsWith(anfang) || n.split(' ').some((w) => w.endsWith(qf));
    };
    let schwach = roh.filter((r) => r.score < STARK);
    if (stark.length >= 3) schwach = qf.length >= 3 ? schwach.filter(passt) : [];
    // Dasselbe Ziel nur einmal (z. B. mehrere Marken eines Wirkstoffs)
    const ziele = new Set();
    schwach = schwach.filter((r) => !ziele.has(zielHash(r)) && ziele.add(zielHash(r)));
    return { stark, schwach: stark.length >= 3 ? schwach.slice(0, maxSchwach) : schwach };
  }
  const AEHNLICH = 'Ähnliche Schreibweise oder Wortteil';
  /** Getroffener Begriff, wenn er anders heisst als der Eintrag («Blutfette» bei «Erhöhtes Cholesterin»). */
  const trefferText = (r) => (r.treffer && r.typ !== 'marke' && !S.falte(r.label).includes(S.falte(r.treffer)) ? `«${r.treffer}»` : '');

  function optionHtml(r, i, q, id) {
    const label = S.markiere(r.label, q).map((t) => (t.mark ? `<mark>${esc(t.text)}</mark>` : esc(t.text))).join('');
    let sub = r.sub || '';
    if (r.typ === 'krankheit') {
      const n = eintraegeVon(indiziert.get(r.id) || []).length;
      sub = `${sub}${n ? ` · ${n} ${n === 1 ? 'Medikament' : 'Medikamente'}` : ''}`;
    }
    if (trefferText(r)) sub = `${trefferText(r)} · ${sub}`;
    return `<li class="option option--${r.typ}" role="option" id="${id}-opt-${i}" data-i="${i}" aria-selected="false">` +
      `<span class="option__typ">${TYP_TEXT[r.typ]}</span>` +
      `<span class="option__label">${label}</span>` +
      `<span class="option__sub">${esc(sub)}</span></li>`;
  }

  // Breakpoints in em: wachsen mit der eingestellten Standardschrift (wie im Stylesheet)
  const SCHMAL = window.matchMedia('(width < 47.5em)');
  const BREIT = window.matchMedia('(width >= 45em)');
  const RUHIG = window.matchMedia('(prefers-reduced-motion: reduce)');
  let feldHoehe = null; // passt die Vorschlagsliste des zuletzt fokussierten Felds an
  if (window.visualViewport) window.visualViewport.addEventListener('resize', () => { if (feldHoehe) feldHoehe(); });

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
      // tabindex=-1: Die scrollbare Liste ist kein eigener Tab-Halt (die Auswahl läuft über die Pfeiltasten im Feld)
      `<ul class="suche__liste" id="${id}-liste" role="listbox" aria-label="Vorschläge" tabindex="-1" hidden></ul>` +
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
    /** Vorschlagsliste endet über der Bildschirmtastatur (sichtbarer Bereich statt ganzer Fensterhöhe). */
    function passeHoehe() {
      const vv = window.visualViewport;
      if (liste.hidden || !vv) return;
      const frei = vv.offsetTop + vv.height - liste.getBoundingClientRect().top - 8;
      liste.style.setProperty('--frei', `${Math.max(150, Math.round(frei))}px`);
    }
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
      const limit = opt.limit || 10;
      const g = gewichte(q, S.suche(INDEX, q, { limit: 60, typen: opt.typen }), 3);
      const stark = g.stark.slice(0, limit);
      const schwach = g.schwach.slice(0, Math.max(0, limit - stark.length));
      ergebnisse = stark.concat(schwach);
      // Ähnliche Schreibweisen abgesetzt am Ende, als benannte Gruppe der Liste
      const opts = (l, start) => l.map((r, i) => optionHtml(r, start + i, q, id)).join('');
      let html = opts(stark, 0) + (schwach.length
        ? `<li class="option-gruppe" role="group" aria-labelledby="${id}-aehnlich"><span class="option-trenner" id="${id}-aehnlich">${AEHNLICH}</span>` +
          `<ul class="option-unterliste" role="none">${opts(schwach, stark.length)}</ul></li>`
        : '');
      if (!ergebnisse.length) {
        html = `<li class="option option--leer" role="presentation">Nichts gefunden für «${esc(q)}». Tipp: Wirkstoff, Markenname oder Krankheit eingeben.</li>`;
      } else if (!opt.typen) {
        html += `<li class="option option--alle" role="option" id="${id}-opt-alle" data-i="alle" aria-selected="false">Alle Treffer für «${esc(q)}» anzeigen</li>`;
      }
      liste.innerHTML = html;
      liste.hidden = false;
      passeHoehe();
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
      feldHoehe = passeHoehe;
      // Handy: grosses Suchfeld unter den Kopf schieben, damit neben der Tastatur Platz für Vorschläge bleibt
      if (opt.gross && SCHMAL.matches) {
        const kopf = $('.kopf');
        const y = Math.max(0, Math.round(input.getBoundingClientRect().top + window.scrollY - (kopf ? kopf.offsetHeight : 0) - 8));
        if (Math.abs(window.scrollY - y) > 4) window.scrollTo({ top: y, behavior: RUHIG.matches ? 'auto' : 'smooth' });
      }
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
  const krumenHtml = (krumen) =>
    `<nav class="krumen" aria-label="Brotkrumen"><a href="#/"><span class="nur-breit">Start</span><span class="nur-schmal">Medi-Lexikon</span></a>${krumen.map((k) => `<span class="krumen__trenner" aria-hidden="true">/</span>${k}`).join('')}</nav>`;
  /** Seitenrahmen. klasse: «seite--nummern» (nummerierte Abschnitte), «seite--schmal» (eine Lesespalte). */
  function seite(krumen, inhalt, klasse) {
    return `<div class="wrap seite${klasse ? ` ${klasse}` : ''}">${krumen.length ? krumenHtml(krumen) : ''}${inhalt}</div>`;
  }
  /** Listeneintrag: Die ganze Zeile ist der Link – Name, darunter Zusatzzeilen [klasse, html]. */
  function eintrag(href, name, zeilen, opt) {
    const o = opt || {};
    return `<li${o.attr || ''}><a class="eintrag${o.zahl != null ? ' eintrag--zahl' : ''}" href="${href}"><span class="eintrag__name">${esc(name)}</span>` +
      (o.zahl != null ? `<span class="eintrag__zahl">${o.zahl}</span>` : '') +
      zeilen.filter((z) => z[1]).map(([klasse, html]) => `<span class="eintrag__${klasse}">${html}</span>`).join('') + `</a></li>`;
  }
  /** Wirkstoff wie im Wörterbuch: Name, darunter Handelsnamen und Kurzbeschreibung (kompakt: nur der Zusatz). */
  const wirkstoffKachel = (w, extra, kompakt) =>
    eintrag(`#/wirkstoff/${w.id}`, w.name, [
      ['marken', esc((w.handelsnamen || []).slice(0, 4).join(', '))],
      ['text', kompakt ? '' : esc(w.kurz || w.klasse || '')],
      ['text', extra || ''],
    ]);
  const abschnitt = (id, titel, inhalt, zaehler) =>
    `<section class="abschnitt" id="${id}" aria-labelledby="${id}-titel"><h2 id="${id}-titel"><span class="titel">${titel}${zaehler != null ? ` <span class="zaehler">${zahl(zaehler)}</span>` : ''}</span></h2>${inhalt}</section>`;
  const fachinfoHinweis = () =>
    `<p class="quelle">Vereinfachte Zusammenfassung, ohne Gewähr. Verbindlich ist die von Swissmedic genehmigte Fach- und Patienteninformation auf <a href="https://www.swissmedicinfo.ch/" rel="noopener">swissmedicinfo.ch</a>. Fragen Sie Ihre Ärztin, Ihren Arzt oder Ihre Apotheke.</p>`;
  /** Aufklappbarer Teil einer Liste. */
  const mehr = (zu, inhalt, auf) =>
    `<details class="mehr"><summary><span class="mehr__zu">${zu}</span><span class="mehr__auf">${auf || 'Weniger anzeigen'}</span></summary>${inhalt}</details>`;
  /** Lange Listen: die ersten n Einträge zeigen, den Rest aufklappbar. opt: { attr, zu, genau } */
  function kuerze(items, n, klasse, opt) {
    const o = opt || {};
    const ul = (l) => `<ul class="${klasse}"${o.attr || ''}>${l.join('')}</ul>`;
    if (items.length <= n + (o.genau ? 0 : 3)) return ul(items);
    return ul(items.slice(0, n)) + mehr(o.zu || `${zahl(items.length - n)} weitere anzeigen`, ul(items.slice(n)));
  }
  /** Wechselwirkung: Schweregrad als Wort und Quadrat, Partner fett, Wirkung darunter. */
  const stufenLi = (stufe, titelHtml, text, zieleHtml, attr) =>
    `<li class="stufe-${stufe}"${attr || ''}><span class="stufe-label">${STUFE_TEXT[stufe]}</span><span class="stufe-titel">${titelHtml}</span>` +
    `${text ? `<span class="klein">${esc(text)}</span>` : ''}${zieleHtml || ''}</li>`;
  /** Eigene Wechselwirkung: Partner fett, Wirkung, dann die Verweise. */
  const eigenLi = (stufe, e, text) => {
    const v = verweis(e.text, refZiele(e.ref), true);
    return stufenLi(stufe, v.kopf, text, v.ziele);
  };
  /** Eintrag aus einer anderen Monografie: Wirkstoff (Link), was dort steht, Wirkung. */
  const fremdLi = (x) => stufenLi(x.stufe, `<strong class="titel">${esc(x.w.name)}: ${esc(x.e.text)}</strong>`, x.e.effekt || x.e.grund || '',
    zieleHtml([{ href: `#/wirkstoff/${x.w.id}`, label: x.w.name }]),
    ` data-filter="${esc(S.falte([x.w.name, ...(x.w.handelsnamen || []), x.e.text].join(' ')))}"`);
  const fremdUl = (liste) => `<ul class="warnliste warnliste--stufen" data-filterbar>${liste.map(fremdLi).join('')}</ul>`;
  const istWichtig = (x) => x.stufe === 'kontra' || x.stufe === 'schwer';
  /** Rückverweise: kontraindiziert und schwerwiegend immer sichtbar, mittel und gering aufklappbar. */
  function fremdListe(liste) {
    const wichtig = liste.filter(istWichtig);
    const rest = liste.filter((x) => !istWichtig(x));
    if (!rest.length || (!wichtig.length && rest.length <= 4)) return liste.length ? fremdUl(liste) : '';
    const stufen = eindeutig(rest.map((x) => STUFE_TEXT[x.stufe].toLowerCase())).join(' und ');
    return (wichtig.length ? fremdUl(wichtig) : '') +
      mehr(`${wichtig.length ? 'Weitere' : 'Alle'} ${zahl(rest.length)} anzeigen <span class="mehr__info">${stufen}</span>`, fremdUl(rest));
  }

  /** Filterfeld über einer Liste; das Ergebnis meldet eine Statuszeile (Screenreader). */
  const filterFeld = (id, label, placeholder, extra) =>
    `<div class="filterleiste"><label class="vh" for="${id}">${label}</label><input type="search" id="${id}" placeholder="${placeholder}" autocomplete="off">` +
    `${extra || ''}<p class="vh" role="status" id="${id}-status"></p></div>`;
  /** Meldet das Filterergebnis verzögert (nicht bei jedem Tastendruck). */
  function melder(id) {
    let t = 0;
    return (text) => {
      clearTimeout(t);
      t = setTimeout(() => { const el = document.getElementById(`${id}-status`); if (el) el.textContent = text; }, 450);
    };
  }
  const trefferZahl = (n, eins, mehrere) => (n ? `${zahl(n)} ${n === 1 ? eins : mehrere}` : 'Keine Treffer');
  /** Filtert die Listen [data-filterbar] in bereich nach data-filter; eingeklappte Teile werden dabei mit durchsucht. */
  function listenFilter(input, bereich, eins, mehrere) {
    const melde = melder(input.id);
    input.addEventListener('input', () => {
      const q = S.falte(input.value);
      bereich.classList.toggle('ist-gefiltert', !!q);
      let n = 0;
      $$('[data-filterbar] > li', bereich).forEach((li) => {
        li.hidden = !!q && !li.dataset.filter.includes(q);
        if (!li.hidden) n++;
      });
      $$('details.mehr', bereich).forEach((det) => {
        if (q && !det.open) { det.open = true; det.dataset.filterOffen = '1'; }
        if (!q && det.dataset.filterOffen) { det.open = false; delete det.dataset.filterOffen; }
      });
      melde(q ? trefferZahl(n, eins, mehrere) : '');
    });
  }
  /** Gegenanzeigen-Gruppe: Etikett mit Anzahl und eine durchgehende farbige Linie links. opt: { id, n, attr, klasse } */
  const kiGruppe = (stufe, titel, items, opt) => {
    const o = opt || {};
    const klasse = `ki-liste${o.klasse ? ` ${o.klasse}` : ''}`;
    return `<div class="ki-gruppe ki-gruppe--${stufe}"${o.id ? ` id="${o.id}"` : ''}><h3>${titel} <span class="zaehler">${zahl(items.length)}</span></h3>` +
      (o.n ? kuerze(items, o.n, klasse, { attr: o.attr }) : `<ul class="${klasse}"${o.attr || ''}>${items.join('')}</ul>`) + `</div>`;
  };
  /** Steckbrief als Definitionsliste; Zeile: [Etikett, Wert, Zusatzklasse]. */
  const zeile = (k, v, klasse) => `<div class="steckbrief__zeile${klasse ? ` ${klasse}` : ''}"><dt>${k}</dt><dd>${v}</dd></div>`;
  const steckbrief = (zeilen) => (zeilen.length ? `<dl class="steckbrief">${zeilen.map(([k, v, klasse]) => zeile(k, v, klasse)).join('')}</dl>` : '');
  const warnZeile = (stufe) => `steckbrief__zeile--warn stufe-${stufe}`;
  /** «Auf einen Blick»: zuerst die Warnungen, dann die Fakten. */
  const blick = (zeilen) => (zeilen.length
    ? `<section class="blick" aria-labelledby="blick-titel"><h2 class="kicker" id="blick-titel">Auf einen Blick</h2>${steckbrief(zeilen)}</section>`
    : '');
  /** Sprunglink zu einem Abschnitt derselben Seite (ganze Steckbrief-Zeile ist anklickbar). */
  const sprung = (basis, ziel, html) => `<a class="sprung" href="${basis}" data-scroll="${ziel}">${html}</a>`;
  /** Zweite Zeile mit eigenem Ziel: Querverweis «→ …» wie im Text (liegt über der Fläche des Sprunglinks). */
  const sprungZusatz = (basis, ziel, html) =>
    `<span class="ziele ziele--zusatz"><span class="ziele__pfeil" aria-hidden="true">→</span><a class="sprung-zusatz" href="${basis}" data-scroll="${ziel}">${html}</a></span>`;
  const anzahl = (n) => `<b class="anzahl">${zahl(n)}</b>`;
  const FAKT = 'steckbrief__zeile--fakt';
  const INFO = 'steckbrief__zeile--info';
  /**
   * Kurze Aufzählung für den Steckbrief: Beispiele in Klammern («z. B. …») weglassen, Trennzeichen nach Inhalt.
   * Auf dem Handy nur die ersten nSchmal Einträge (der Rest steht ohnehin im Abschnitt).
   */
  function aufzaehlung(texte, n, nSchmal) {
    const t = texte.slice(0, n).map((x) => x.replace(/\s*\(z\.\s?B\.[^)]*\)/g, '').trim());
    const trenner = t.some((x) => x.includes(',')) ? '; ' : ', ';
    const k = Math.min(nSchmal || n, t.length);
    const rest = t.length > k ? `<span class="nur-breit">${esc(trenner + t.slice(k).join(trenner))}</span>` : '';
    // Geschütztes Leerzeichen: «…» bricht nie allein auf eine neue Zeile
    const ende = texte.length > n ? '\u00a0…' : (texte.length > k ? '<span class="nur-schmal">\u00a0…</span>' : '');
    return esc(t.slice(0, k).join(trenner)) + rest + ende;
  }
  /** Fakten eines Wirkstoffs: Handelsnamen zuerst, dann Abgabe, Darreichung, ATC-Code. */
  function faktenVon(w) {
    const fakten = [];
    if ((w.handelsnamen || []).length) fakten.push(['In der Schweiz z.&nbsp;B. als', `<ul class="marken">${w.handelsnamen.map((h) => `<li>${esc(h)}</li>`).join(' ')}</ul>`, FAKT]);
    if ((w.kombinationAus || []).length) fakten.push(['Kombination aus', w.kombinationAus.map((k) => linkWs(k)).join('<span class="plus"> + </span>'), FAKT]);
    if ((w.abgabe || []).length) fakten.push(['Abgabe', `<span class="abgaben">${w.abgabe.map(abgabeBadge).join('')}</span>`, FAKT]);
    if ((w.darreichung || []).length) fakten.push(['Darreichung', esc(w.darreichung.join(', ')), FAKT]);
    if ((w.atc || []).length) fakten.push(['ATC-Code', `<span class="atcs">${w.atc.map((c) => `<span class="atc">${esc(c)}</span>`).join(' ')}</span>`, FAKT]);
    return fakten;
  }

  /* ---------- Ansichten ---------- */
  function viewStart() {
    const alle = M.wirkstoffe.length + (M.kurzeintraege || []).length;
    const markenZahl = new Set(M.wirkstoffe.concat(M.kurzeintraege || []).flatMap((w) => w.handelsnamen || [])).size;
    const eintragIndex = (href, name, n, text) =>
      `<li><a href="${href}"><span class="index__name">${name}</span>` +
      `<span class="index__zahl">${n != null ? `${zahl(n)}<span class="vh"> Einträge</span>` : ''}</span><span class="index__text">${text}</span></a></li>`;
    main.innerHTML =
      `<section class="held" aria-labelledby="start-titel"><div class="wrap held__raster">` +
      `<h1 tabindex="-1" id="start-titel">Medi-Lexikon</h1>` +
      `<div class="held__suche" id="start-suche"></div>` +
      `</div></section>` +
      `<section class="wrap index" aria-labelledby="index-titel"><h2 class="index__titel" id="index-titel">Nachschlagen</h2><ul class="index__liste">` +
      eintragIndex('#/a-z', 'Wirkstoffe A–Z', alle, `Alphabetisch und nach Organsystem, mit ${zahl(markenZahl)} Schweizer Handelsnamen.`) +
      eintragIndex('#/krankheiten', 'Krankheiten', M.krankheiten.length, 'Diagnosen und Situationen mit passenden und ungeeigneten Medikamenten.') +
      eintragIndex('#/gruppen', 'Wirkstoffgruppen', M.gruppen.length, 'Gruppen, auf denen die Wechselwirkungs-Hinweise beruhen.') +
      eintragIndex('#/info', 'Über die Daten', null, 'Quellen, Häufigkeitsangaben, Abgabekategorien und Datenschutz.') +
      `</ul></section>`;
    const input = suchfeld($('#start-suche'), { id: 'suche-start', gross: true, placeholder: 'Medikament oder Krankheit' });
    return { titel: null, fokus: BREIT.matches ? input : null };
  }

  /** Kurze Bezeichnungen fürs Inhaltsverzeichnis – die Überschriften bleiben ausführlich. */
  const TOC_KURZ = {
    anwendung: 'Anwendung', wirkung: 'Wirkung', gegenanzeigen: 'Gegenanzeigen', kombination: 'Nicht zusammen einnehmen',
    wechselwirkungen: 'Wechselwirkungen', rueckverweise: 'Weitere Wechselwirkungen', nebenwirkungen: 'Nebenwirkungen',
    schwangerschaft: 'Schwangerschaft & Stillzeit', hinweise: 'Gut zu wissen', praeparate: 'Präparate',
    verwandt: 'Ähnliche Wirkstoffe', quelle: 'Quelle',
  };

  function viewWirkstoff(id, ziel) {
    const kern = WS.get(id);
    if (!kern) return KURZ.has(id) ? viewKurz(KURZ.get(id)) : view404();
    const d = details(id);
    const krumen = [`<a href="#/a-z">Wirkstoffe A–Z</a>`, esc(kern.name)];
    if (!d) {
      main.innerHTML = seite(krumen,
        `<div class="mono-kopf"><h1 tabindex="-1">${esc(kern.name)}</h1><p class="unterzeile">${esc(kern.klasse)}</p></div><p class="leer" role="status">Angaben werden geladen …</p>`);
      ladeDetails(id).then((ok) => {
        if (aktuelleSeite !== `wirkstoff/${id}`) return;
        // Fokus nur dann auf die neue Überschrift, wenn er auf der vorläufigen lag (Seitenwechsel per Link);
        // beim ersten Laden bleibt er am Seitenanfang (Skip-Link, Suche und Navigation zuerst)
        const fokusWar = document.activeElement && document.activeElement.matches('h1') && main.contains(document.activeElement);
        if (ok && details(id)) render(false, null, !fokusWar);
        else $('[role="status"]', main).textContent = 'Die Angaben konnten nicht geladen werden. Bitte Seite neu laden.';
      });
      return { titel: kern.name, ziel };
    }
    const w = { ...kern, ...d };
    const basis = `#/wirkstoff/${id}`;
    const ki = w.kontraindikationen || [];
    const vs = w.vorsicht || [];
    const km = w.kontraMedikamente || [];
    const sortiert = (w.interaktionen || []).slice().sort((a, b) => RANG[a.schwere] - RANG[b.schwere]);
    const teile = [];
    const toc = [];
    const add = (aid, titel, html, zaehler, tocZahl) => {
      toc.push([aid, TOC_KURZ[aid] || titel, tocZahl != null ? tocZahl : zaehler]);
      teile.push(abschnitt(aid, titel, html, zaehler));
    };
    add('anwendung', 'Wofür wird es angewendet?',
      `<ul class="punkte">${w.indikationen.map((e) => `<li>${verlinkt(e.text, krZiele(e.ids))}</li>`).join('')}</ul>`);
    add('wirkung', 'Wie wirkt es?', `<p class="text">${esc(w.wirkmechanismus)}</p>`);
    if (ki.length || vs.length) {
      const li = (e) => `<li>${verlinkt(e.text, krZiele(e.ids))}</li>`;
      // Im Inhaltsverzeichnis dieselbe Zahl wie in «Auf einen Blick» (die Vorsichts-Einträge zählen nicht mit)
      add('gegenanzeigen', 'Wann darf es nicht angewendet werden?',
        (ki.length ? kiGruppe('kontra', 'Gegenanzeigen', ki.map(li)) : '') +
        (vs.length ? kiGruppe('vorsicht', 'Nur mit besonderer Vorsicht', vs.map(li)) : ''),
        null, ki.length || vs.length);
    }
    // Eigene Warnhinweise vollständig zeigen – nichts davon wird eingeklappt.
    if (km.length) {
      add('kombination', 'Nicht zusammen einnehmen',
        `<ul class="warnliste warnliste--stufen">${km.map((e) => eigenLi('kontra', e, e.grund)).join('')}</ul>`, km.length);
    }
    if (sortiert.length) {
      add('wechselwirkungen', 'Wechselwirkungen',
        `<ul class="warnliste warnliste--stufen">${sortiert.map((e) => eigenLi(e.schwere, e, e.effekt)).join('')}</ul>`, sortiert.length);
    }
    // Was andere Wirkstoffe über diesen (oder seine Gruppen) sagen: eine Liste nach Schweregrad
    const rueck = rueckverweise(w).alle;
    if (rueck.length) {
      add('rueckverweise', 'Weitere Wechselwirkungen, von anderen Wirkstoffen genannt',
        `<p class="text">Diese Wirkstoffe nennen ${esc(w.name)} oder eine seiner Wirkstoffgruppen in ihren eigenen Wechselwirkungen.</p>` +
        (rueck.length > 12 ? filterFeld('rueck-filter', 'Wechselwirkungen nach Partner filtern', 'Partner suchen …') : '') +
        fremdListe(rueck), rueck.length);
    }
    const nw = w.nebenwirkungen || {};
    const nwStufen = NW.filter(([key]) => (nw[key] || []).length);
    const nwZahl = nwStufen.reduce((s, [key]) => s + nw[key].length, 0);
    if (nwStufen.length) {
      add('nebenwirkungen', 'Nebenwirkungen nach Häufigkeit',
        `<div class="nw">${nwStufen.map(([key, label, def, n]) =>
          `<div class="nw__stufe nw--${n}"><div class="nw__kopf"><strong>${label}</strong><span>${def}</span>` +
          (n ? `<span class="skala" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>` : '') +
          `</div><ul class="nw__liste">${nw[key].map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`).join('')}</div>` +
        `<p class="quelle">Häufigkeiten nach der Konvention der Fachinformation. Nicht jede Person bekommt Nebenwirkungen. Bei schweren oder ungewöhnlichen Beschwerden ärztlichen Rat einholen.</p>`,
        nwZahl);
    }
    if (w.schwangerschaft || w.stillzeit) {
      add('schwangerschaft', 'Schwangerschaft und Stillzeit',
        `<div class="zwei">${w.schwangerschaft ? `<div><h3>Schwangerschaft</h3><p>${esc(w.schwangerschaft)}</p></div>` : ''}${w.stillzeit ? `<div><h3>Stillzeit</h3><p>${esc(w.stillzeit)}</p></div>` : ''}</div>`);
    }
    if ((w.hinweise || []).length) add('hinweise', 'Gut zu wissen', `<ul class="punkte">${w.hinweise.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>`);
    const praep = (praepNachWs.get(id) || []).slice().sort(nachName);
    if (praep.length) {
      add('praeparate', 'Zugelassene Präparate (Swissmedic)',
        kuerze(praep.slice(0, 200).map((p) => eintrag(`#/praeparat/${encodeURIComponent(p.nr)}`, p.name,
          [['text', esc([p.inhaber, p.abgabe ? `Abgabe ${p.abgabe}` : ''].filter(Boolean).join(' · '))]])), 12, 'raster') +
        (praep.length > 200 ? `<p class="quelle">… und ${praep.length - 200} weitere.</p>` : ''), praep.length);
    }
    const klassenGruppe = (w.gruppen || []).find((g) => (GR.get(g) || {}).art === 'wirkstoffklasse');
    if (klassenGruppe) {
      const verwandt = (mitglieder.get(klassenGruppe) || []).filter((x) => x.id !== id).sort(nachName);
      if (verwandt.length) {
        add('verwandt', 'Ähnliche Wirkstoffe',
          `<p class="text">Ebenfalls in der Gruppe ${linkGr(klassenGruppe)}:</p>` +
          kuerze(verwandt.map((x) => eintrag(`#/wirkstoff/${x.id}`, x.name, [])), 12, 'raster raster--kurz',
            { genau: true, zu: `Alle ${zahl(verwandt.length)} anzeigen` }));
      }
    }
    const gruppenLinks = (w.gruppen || []).filter((g) => GR.has(g)).map((g) => linkGr(g)).join(', ');
    add('quelle', 'Quelle und Stand',
      (gruppenLinks ? `<p class="text">Wirkstoffgruppen, auf denen die Wechselwirkungs-Hinweise beruhen: ${gruppenLinks}.</p>` : '') +
      `<p class="text">Datenstand: ${esc(w.stand)}. ${w.zweitpruefung
        ? 'Redaktionell zusammengefasst und von einer zweiten, unabhängigen Prüfung gegen die Fachinformation gegengelesen.'
        : 'Redaktionell zusammengefasst und automatisch auf Format und Verweise geprüft; eine unabhängige Zweitprüfung steht noch aus.'}</p>${fachinfoHinweis()}`);

    // «Auf einen Blick»: zuerst die Warnungen (nur Zeilen mit Inhalt), dann die Fakten
    const warn = [];
    if (ki.length) {
      warn.push(['Gegenanzeigen', sprung(`${basis}/gegenanzeigen`, 'gegenanzeigen', `${anzahl(ki.length)} · z.&nbsp;B. ${aufzaehlung(ki.map((e) => e.text), 2, 1)}` +
        (vs.length ? `<span class="sprung__zusatz">dazu ${zahl(vs.length)} mit besonderer Vorsicht</span>` : '')), warnZeile('kontra')]);
    } else if (vs.length) {
      warn.push(['Nur mit Vorsicht', sprung(`${basis}/gegenanzeigen`, 'gegenanzeigen', `${anzahl(vs.length)} · z.&nbsp;B. ${aufzaehlung(vs.map((e) => e.text), 2, 1)}`), warnZeile('vorsicht')]);
    }
    // Nicht zusammen einnehmen / schwerwiegend: eigene Einträge, dazu was andere Wirkstoffe über diesen sagen
    const fremdKontra = wichtigsteWs(rueck.filter((x) => x.stufe === 'kontra').map((x) => x.w));
    const fremdSchwer = wichtigsteWs(rueck.filter((x) => x.stufe === 'schwer').map((x) => x.w));
    const namenVon = (ws, n) => esc(ws.slice(0, n).map((x) => x.name).join(', ')) + (ws.length > n ? '\u00a0…' : '');
    const zuRueck = (html) => sprungZusatz(`${basis}/rueckverweise`, 'rueckverweise', html);
    const vonAnderen = '<span class="sprung__zusatz">von anderen Wirkstoffen genannt</span>';
    if (km.length) {
      warn.push(['Nicht zusammen einnehmen', sprung(`${basis}/kombination`, 'kombination', `${km.length > 1 ? `${anzahl(km.length)} · ` : ''}${aufzaehlung(km.map((e) => e.text), 3, 2)}`) +
        (fremdKontra.length ? zuRueck(`dazu ${zahl(fremdKontra.length)} von anderen Wirkstoffen genannt: ${namenVon(fremdKontra, 3)}`) : ''), warnZeile('kontra')]);
    } else if (fremdKontra.length) {
      warn.push(['Nicht zusammen einnehmen', sprung(`${basis}/rueckverweise`, 'rueckverweise',
        `${fremdKontra.length > 1 ? `${anzahl(fremdKontra.length)} · ` : ''}${namenVon(fremdKontra, 3)}${vonAnderen}`), warnZeile('kontra')]);
    }
    const schwer = sortiert.filter((e) => e.schwere === 'schwer');
    if (schwer.length) {
      warn.push(['Schwerwiegende Wechsel&shy;wirkungen', sprung(`${basis}/wechselwirkungen`, 'wechselwirkungen', `${anzahl(schwer.length)} · ${aufzaehlung(schwer.map((e) => e.text), 3, 2)}`) +
        (fremdSchwer.length ? zuRueck(`dazu ${zahl(fremdSchwer.length)} von anderen Wirkstoffen genannt`) : ''), warnZeile('schwer')]);
    } else if (fremdSchwer.length) {
      warn.push(['Schwerwiegende Wechsel&shy;wirkungen', sprung(`${basis}/rueckverweise`, 'rueckverweise',
        `${anzahl(fremdSchwer.length)} · ${namenVon(fremdSchwer, 3)}${vonAnderen}`), warnZeile('schwer')]);
    }
    // Nebenwirkungen: die höchste vorhandene Häufigkeitsstufe; Schwangerschaft mit vollem Text (nichts weglassen)
    if (nwStufen.length) {
      const [key, label] = nwStufen[0];
      warn.push(['Nebenwirkungen', sprung(`${basis}/nebenwirkungen`, 'nebenwirkungen', `<b class="anzahl">${label}</b> · ${aufzaehlung(nw[key], 3, 2)}` +
        (nwZahl > nw[key].length ? `<span class="sprung__zusatz">insgesamt ${zahl(nwZahl)} nach Häufigkeit geordnet</span>` : '')), INFO]);
    }
    if (w.schwangerschaft) warn.push(['Schwangerschaft', sprung(`${basis}/schwangerschaft`, 'schwangerschaft', esc(w.schwangerschaft)), INFO]);

    // Inhaltsleiste direkt unter Titel und Lead: auf dem Handy von Anfang an erreichbar
    main.innerHTML = seite([],
      `<div class="mono"><div class="mono-kopf">${krumenHtml(krumen)}<h1 tabindex="-1">${esc(w.name)}</h1>` +
      `<p class="unterzeile">${esc(w.klasse)}</p>` +
      (w.kurz ? `<p class="lead">${esc(w.kurz)}</p>` : '') +
      `</div>` +
      `<nav class="inhalt-nav" aria-label="Inhalt dieser Seite">` +
      `<button class="inhalt-nav__knopf" type="button" aria-expanded="false" aria-controls="inhalt-liste"><span class="inhalt-nav__titel">Inhalt</span><span class="inhalt-nav__aktuell">${toc.length} Abschnitte</span>${ICON.runter}</button>` +
      `<ol class="inhalt-nav__liste" id="inhalt-liste">${toc.map(([aid, t, n]) =>
        `<li><a href="${basis}/${aid}" data-scroll="${aid}"><span class="toc__t">${esc(t)}</span>${n ? `<span class="toc__n">${zahl(n)}</span>` : ''}</a></li>`).join('')}</ol></nav>` +
      blick(warn.concat(faktenVon(w))) +
      `<div class="mono__text">${teile.join('')}</div></div>`, 'seite--nummern');
    inhaltNav();
    const rf = $('#rueck-filter');
    if (rf) listenFilter(rf, $('#rueckverweise'), 'Eintrag', 'Einträge');
    return { titel: w.name, ziel };
  }

  function viewKurz(w) {
    const alle = rueckverweise(w).alle;
    main.innerHTML = seite([`<a href="#/a-z">Wirkstoffe A–Z</a>`, esc(w.name)],
      `<div class="mono-kopf"><h1 tabindex="-1">${esc(w.name)}</h1><p class="unterzeile">${esc(w.klasse || '')}</p></div>` +
      blick(faktenVon(w)) +
      abschnitt('beschreibung', 'Noch keine ausführliche Beschreibung',
        `<p class="text">Für diesen Wirkstoff liegt in unseren Daten noch keine Monografie mit Wirkungsweise, Gegenanzeigen und Nebenwirkungen vor.</p>${fachinfoHinweis()}`) +
      (alle.length ? abschnitt('rueckverweise', 'Wechselwirkungen, von anderen Wirkstoffen genannt', fremdListe(alle), alle.length) : ''),
      'seite--schmal');
    return { titel: w.name };
  }

  function viewKrankheit(id) {
    const k = KR.get(id);
    if (!k) return view404();
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
    // Anwendungstext nur zeigen, wenn er mehr sagt als der Name der Krankheit
    // («Bluthochdruck (essentielle Hypertonie)» nein, «Bluthochdruck, auch in der Schwangerschaft» ja)
    const bekannt = new Set(staemme([k.name, ...(k.synonyme || []), 'essentielle essenzielle arterielle primäre Erwachsenen Behandlung'].join(' ')));
    const zusatz = (x) => esc(x.texte.find((t) => staemme(t).some((s) => !bekannt.has(s))) || '');
    const gruppenHtml = Array.from(gruppiert.entries())
      .sort((a, b) => (a[0] === 'Weitere Wirkstoffe') - (b[0] === 'Weitere Wirkstoffe') || b[1].length - a[1].length || a[0].localeCompare(b[0], 'de'))
      .map(([name, liste]) => `<h3>${esc(name)} <span class="zaehler">${liste.length}</span></h3><ul class="raster">${liste.map((x) => wirkstoffKachel(x.w, zusatz(x), true)).join('')}</ul>`)
      .join('');
    const warnLi = (x) => eintrag(`#/wirkstoff/${x.w.id}`, x.w.name, [['grund', esc(x.texte.join(' · '))]],
      { attr: ` data-filter="${esc(S.falte(x.w.name + ' ' + (x.w.handelsnamen || []).join(' ')))}"` });
    const hier = `#/krankheit/${esc(id)}`;
    const wirkstoffe = (n) => `${anzahl(n)} ${n === 1 ? 'Wirkstoff' : 'Wirkstoffe'}`;
    // Beispiele: die bekanntesten Wirkstoffe, nicht die ersten im Alphabet
    const namen = (liste) => esc(wichtigsteWs(liste.map((x) => x.w)).slice(0, 3).map((w) => w.name).join(', ')) + (liste.length > 3 ? '\u00a0…' : '');
    // Weitere Namen ohne jene, die schon im Titel stehen
    const imNamen = S.falte(k.name);
    const auchGenannt = (k.synonyme || []).filter((s) => !imNamen.includes(S.falte(s)));
    const zeilen = [];
    zeilen.push(['Medikamente', mittel.length
      ? sprung(hier, 'mittel', `${wirkstoffe(mittel.length)}${gruppiert.size > 1 ? `, geordnet nach Wirkstoffklasse` : ''}`)
      : 'keine verzeichnet']);
    if (kontra.length) zeilen.push(['Kontraindiziert', sprung(hier, 'gruppe-kontra', `${wirkstoffe(kontra.length)} · z.&nbsp;B. ${namen(kontra)}`), warnZeile('kontra')]);
    if (vorsicht.length) zeilen.push(['Mit Vorsicht', sprung(hier, 'gruppe-vorsicht', `${wirkstoffe(vorsicht.length)} · z.&nbsp;B. ${namen(vorsicht)}`), warnZeile('vorsicht')]);
    if (!warn.length) zeilen.push(['Vorsicht', 'keine verzeichnet']);
    if (auchGenannt.length) zeilen.push(['Auch genannt', esc(auchGenannt.join(', ')), FAKT]);
    main.innerHTML = seite([`<a href="#/krankheiten">Krankheiten</a>`, esc(k.name)],
      `<div class="mono-kopf kopfzeile"><h1 tabindex="-1">${esc(k.name)}</h1>` +
      `<p class="unterzeile">${esc(k.kategorie)}</p></div>` +
      steckbrief(zeilen) +
      abschnitt('mittel', 'Medikamente',
        mittel.length ? gruppenHtml : `<p class="leer">In unseren Daten ist kein Medikament mit diesem Anwendungsgebiet verzeichnet.</p>`, mittel.length) +
      abschnitt('vorsicht', 'Vorsicht',
        warn.length
          ? `<p class="text">Diese Medikamente sind bei ${esc(k.name)} nicht geeignet oder nur mit Vorsicht anzuwenden.</p>` +
            (warn.length > 12 ? filterFeld('warn-filter', 'Liste nach Wirkstoff oder Marke filtern', 'Wirkstoff oder Marke suchen …') : '') +
            (kontra.length ? kiGruppe('kontra', 'Kontraindiziert', kontra.map(warnLi), { id: 'gruppe-kontra', n: 12, attr: ' data-filterbar', klasse: 'ki-liste--zwei ki-liste--eintraege' }) : '') +
            (vorsicht.length ? kiGruppe('vorsicht', 'Mit Vorsicht', vorsicht.map(warnLi), { id: 'gruppe-vorsicht', n: 12, attr: ' data-filterbar', klasse: 'ki-liste--zwei ki-liste--eintraege' }) : '')
          : `<p class="leer">In unseren Daten sind keine Gegenanzeigen für diese Situation verzeichnet.</p>`,
        warn.length) +
      `<div class="block">${fachinfoHinweis()}</div>`);
    const filter = $('#warn-filter');
    if (filter) listenFilter(filter, $('#vorsicht'), 'Wirkstoff', 'Wirkstoffe');
    return { titel: k.name };
  }

  function viewGruppe(id) {
    const g = GR.get(id);
    if (!g) return view404();
    const liste = (mitglieder.get(id) || []).slice().sort(nachName);
    const betroffen = (verweise.get(`gruppe:${id}`) || []).slice().sort((a, b) => RANG[a.stufe] - RANG[b.stufe] || nachName(a.w, b.w));
    main.innerHTML = seite([`<a href="#/gruppen">Wirkstoffgruppen</a>`, esc(g.name)],
      `<div class="mono-kopf kopfzeile"><h1 tabindex="-1">${esc(g.name)}</h1>` +
      `<p class="unterzeile">${GRUPPEN_ART[g.art] ? `<a class="unterzeile__link" href="#/gruppen/${g.art}">${GRUPPEN_ART[g.art][2]}</a>` : 'Wirkstoffgruppe'}</p>` +
      (g.beschreibung ? `<p class="lead">${esc(g.beschreibung)}</p>` : '') + `</div>` +
      abschnitt('mitglieder', 'Wirkstoffe in dieser Gruppe',
        liste.length ? kuerze(liste.map((w) => wirkstoffKachel(w)), 24, 'raster') : `<p class="leer">Keine Wirkstoffe zugeordnet.</p>`, liste.length) +
      (betroffen.length
        ? abschnitt('betroffen', 'Wechselwirkungen mit dieser Gruppe',
          kuerze(betroffen.map(fremdLi), 12, 'warnliste warnliste--stufen warnliste--zwei'), betroffen.length)
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
      `<div class="mono-kopf kopfzeile"><h1 tabindex="-1">${esc(p.name)}</h1><p class="unterzeile">Von Swissmedic zugelassenes Arzneimittel</p></div>` +
      steckbrief(zeilen.map(([k, v]) => [esc(k), esc(v)])) +
      ((p.wid || []).length
        ? abschnitt('monografie', 'Wirkung, Gegenanzeigen und Nebenwirkungen', `<ul class="raster">${p.wid.filter((wid) => WS.has(wid) || KURZ.has(wid)).map((wid) => wirkstoffKachel(WS.get(wid) || KURZ.get(wid))).join('')}</ul>`)
        : `<div class="block"><p>Zu diesem Präparat ist kein Wirkstoff in unserem Lexikon zugeordnet.</p></div>`) +
      `<div class="block"><p class="quelle">Quelle: Swissmedic, Liste der zugelassenen Arzneimittel${P.stand ? `, Stand ${esc(P.stand)}` : ''}.</p>${fachinfoHinweis()}</div>`);
    return { titel: p.name };
  }

  function viewSuche(q) {
    const { stark, schwach } = gewichte(q, S.suche(INDEX, q, { limit: 200 }), 12);
    const ARTEN = [
      ['Wirkstoffe', (t) => t.typ === 'wirkstoff' || t.typ === 'kurz'],
      ['Handelsnamen', (t) => t.typ === 'marke'],
      ['Krankheiten und Anwendungsgebiete', (t) => t.typ === 'krankheit'],
      ['Wirkstoffgruppen', (t) => t.typ === 'gruppe'],
      ['Swissmedic-Präparate', (t) => t.typ === 'praeparat'],
    ];
    // Abschnitte nach ihrem besten Treffer ordnen (bei «blut» zuerst die Krankheiten), Tippfehler abgesetzt am Ende
    const teile = ARTEN.map(([titel, passt]) => [titel, stark.filter(passt).slice(0, 120)])
      .filter(([, l]) => l.length)
      .sort((a, b) => b[1][0].score - a[1][0].score);
    if (schwach.length) teile.push([AEHNLICH, schwach]);
    const zeileVon = (t) => {
      const w = (t.typ === 'wirkstoff' || t.typ === 'kurz') && (WS.get(t.id) || KURZ.get(t.id));
      return w ? wirkstoffKachel(w, esc(trefferText(t))) : eintrag(zielHash(t), t.label, [['text', esc([trefferText(t), t.sub].filter(Boolean).join(' · '))]]);
    };
    main.innerHTML = seite([`Suche`],
      `<h1 tabindex="-1">Suche: «${esc(q)}»</h1>` +
      `<div class="suche-seite" id="suche-seite"></div>` +
      (teile.length
        ? teile.map(([titel, l]) => abschnitt(`t-${S.falte(titel).replace(/ /g, '-')}`, titel, kuerze(l.map(zeileVon), 15, 'raster'), l.length)).join('')
        : `<div class="block"><p>Keine Treffer. Prüfen Sie die Schreibweise oder suchen Sie nach dem Wirkstoff statt nach der Marke oder nach einer Krankheit.</p></div>`));
    suchfeld($('#suche-seite'), { id: 'suche-seite-feld', placeholder: 'Neue Suche …', wert: q });
    return { titel: `Suche: ${q}` };
  }

  function viewAZ() {
    const alle = M.wirkstoffe.concat(M.kurzeintraege || []).slice().sort(nachName);
    const gruppenAtc = eindeutig(alle.flatMap((w) => (w.atc || []).map((c) => c[0]))).filter((c) => ATC[c]).sort();
    main.innerHTML = seite([`Wirkstoffe A–Z`],
      `<div class="kopfzeile"><h1 tabindex="-1">Wirkstoffe A–Z</h1>` +
      `<p class="lead">${zahl(alle.length)} Wirkstoffe, die in der Schweiz als Arzneimittel zugelassen sind – mit ihren Schweizer Handelsnamen.</p></div>` +
      filterFeld('az-filter', 'Wirkstoffe filtern', 'Filtern nach Name oder Marke …',
        `<label class="vh" for="az-atc">Organsystem</label><span class="auswahl"><select id="az-atc"><option value="">Alle Organsysteme</option>${gruppenAtc.map((c) => `<option value="${c}">${c} – ${esc(ATC[c])}</option>`).join('')}</select></span>`) +
      `<nav class="buchstaben" aria-label="Buchstaben"><ul id="az-buchstaben"></ul></nav><div id="az-liste"></div>`);
    const filter = $('#az-filter');
    const atc = $('#az-atc');
    const melde = melder('az-filter');
    let ersteZeichnung = true;
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
      if (!ersteZeichnung) melde(liste.length === alle.length ? `Alle ${zahl(alle.length)} Wirkstoffe` : trefferZahl(liste.length, 'Wirkstoff', 'Wirkstoffe'));
      ersteZeichnung = false;
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
      `<div class="kopfzeile"><h1 tabindex="-1">Krankheiten</h1>` +
      `<p class="lead">Wählen Sie eine Krankheit oder Situation: Sie sehen, welche Medikamente dafür eingesetzt werden – und welche Sie dann meiden sollten.</p></div>` +
      filterFeld('kr-filter', 'Krankheiten filtern', 'Krankheit oder Situation filtern …') +
      kats.map((kat) => `<section class="kategorie" data-kat><h2><span class="titel">${esc(kat)}</span></h2><ul class="raster">${nachKat.get(kat).map((k) => {
        const n = eintraegeVon(indiziert.get(k.id) || []).length;
        const v = eintraegeVon(gegenanzeige.get(k.id) || []).length;
        return eintrag(`#/krankheit/${k.id}`, k.name,
          [['text', [n ? `${n} ${n === 1 ? 'Medikament' : 'Medikamente'}` : '', v ? `${v} mit Vorsicht/Gegenanzeige` : ''].filter(Boolean).join(' · ') || 'Situation']],
          { attr: ` data-filter="${esc(S.falte([k.name, ...(k.synonyme || [])].join(' ')))}"` });
      }).join('')}</ul></section>`).join(''));
    const filter = $('#kr-filter');
    const melde = melder('kr-filter');
    filter.addEventListener('input', () => {
      const q = S.falte(filter.value);
      let n = 0;
      $$('[data-kat]').forEach((sec) => {
        let sichtbar = 0;
        $$('li', sec).forEach((li) => {
          li.hidden = !!q && !li.dataset.filter.includes(q);
          if (!li.hidden) sichtbar++;
        });
        sec.hidden = sichtbar === 0;
        n += sichtbar;
      });
      melde(q ? trefferZahl(n, 'Krankheit', 'Krankheiten') : '');
    });
    return { titel: 'Krankheiten' };
  }

  function viewGruppen(art) {
    const nachArt = new Map();
    for (const g of M.gruppen.slice().sort(nachName)) push(nachArt, g.art || 'wirkstoffklasse', g);
    main.innerHTML = seite([`Wirkstoffgruppen`],
      `<div class="kopfzeile"><h1 tabindex="-1">Wirkstoffgruppen</h1>` +
      `<p class="lead">Gruppen machen Wechselwirkungen verständlich: Ein Mittel, das «starke CYP3A4-Hemmer» meiden muss, verträgt sich mit allen Wirkstoffen dieser Gruppe schlecht.</p></div>` +
      Object.keys(GRUPPEN_ART).filter((a) => nachArt.has(a)).map((art) =>
        `<section class="kategorie" id="art-${art}"><h2><span class="titel">${GRUPPEN_ART[art][0]} <span class="zaehler">${nachArt.get(art).length}</span></span></h2><p>${GRUPPEN_ART[art][1]}</p><ul class="raster">${nachArt.get(art).map((g) => {
          const n = (mitglieder.get(g.id) || []).length;
          return eintrag(`#/gruppe/${g.id}`, g.name, [], { zahl: `${n} ${n === 1 ? 'Wirkstoff' : 'Wirkstoffe'}` });
        }).join('')}</ul></section>`).join(''));
    return { titel: 'Wirkstoffgruppen', ziel: art && Object.prototype.hasOwnProperty.call(GRUPPEN_ART, art) ? `art-${art}` : null };
  }

  function viewInfo() {
    const nMono = M.wirkstoffe.length;
    main.innerHTML = seite([`Über die Daten`],
      `<div class="kopfzeile"><h1 tabindex="-1">Über die Daten</h1></div>` +
      abschnitt('was', 'Was ist das Medi-Lexikon?', `<div class="text"><p>Ein unabhängiges, werbefreies Nachschlagewerk zu Medikamenten, die in der Schweiz zugelassen sind. Es erklärt pro Wirkstoff, wofür er eingesetzt wird, wie er wirkt, wann er nicht angewendet werden darf, mit welchen Medikamenten er sich nicht verträgt und welche Nebenwirkungen wie häufig auftreten.</p>` +
        `<p>Aktuell enthält es ${zahl(nMono)} ausführliche Wirkstoff-Monografien${(M.kurzeintraege || []).length ? ` und ${zahl(M.kurzeintraege.length)} Kurzeinträge` : ''}, ${zahl(M.krankheiten.length)} Krankheiten und Situationen sowie ${zahl(M.gruppen.length)} Wirkstoffgruppen${P.liste && P.liste.length ? `, dazu ${zahl(P.liste.length)} Präparate aus der Swissmedic-Liste (Stand ${esc(P.stand || '?')})` : ''}.</p></div>`) +
      abschnitt('wichtig', 'Wichtig: kein Ersatz für Beratung', `<p class="text hinweis">Die Texte sind vereinfachte Zusammenfassungen und können Fehler enthalten oder veraltet sein. Massgebend sind ausschliesslich die von Swissmedic genehmigten Fach- und Patienteninformationen auf <a href="https://www.swissmedicinfo.ch/" rel="noopener">swissmedicinfo.ch</a> sowie die Beratung durch Ärztin, Arzt oder Apotheke. Setzen Sie Medikamente nie eigenmächtig ab und ändern Sie keine Dosis ohne Rücksprache. Im Notfall: <a class="tel" href="tel:144">144</a>, bei Vergiftungen <a class="tel" href="tel:145">145</a> (Tox Info Suisse).</p>`) +
      abschnitt('haeufigkeit', 'Häufigkeit von Nebenwirkungen', `<div class="tabelle-scroll"><table class="tabelle"><tbody>${NW.map(([, l, d]) => `<tr><th scope="row">${l}</th><td>${d}</td></tr>`).join('')}</tbody></table></div><p class="quelle">Diese Einteilung entspricht der Konvention in den Schweizer Fachinformationen (MedDRA).</p>`) +
      abschnitt('abgabekategorien', 'Abgabekategorien in der Schweiz', `<div class="tabelle-scroll"><table class="tabelle"><tbody>${['A', 'B', 'D', 'E'].map((a) => `<tr><th scope="row">${abgabeBadge(a)}</th><td>${esc(ABGABE[a][1])}</td></tr>`).join('')}</tbody></table></div><p class="quelle">Die frühere Kategorie C wurde 2019 aufgehoben; die Präparate wurden den Kategorien B oder D zugeteilt.</p>`) +
      abschnitt('entstehung', 'Wie entstehen die Wechselwirkungs-Hinweise?', `<p class="text">Jeder Wirkstoff gehört zu Gruppen – z. B. Ibuprofen zu den NSAR, Clarithromycin zu den starken CYP3A4-Hemmern, Citalopram zu den QT-verlängernden und serotonergen Mitteln. Gegenanzeigen und Wechselwirkungen verweisen auf Krankheiten, einzelne Wirkstoffe oder solche Gruppen. Jede Wirkstoffseite zeigt deshalb nicht nur die eigenen Wechselwirkungen, sondern auch jene, die andere Monografien über diesen Wirkstoff oder seine Gruppen nennen. Es erscheint nur, was in den Daten steht – fehlt ein Hinweis, heisst das nicht, dass eine Kombination sicher ist.</p>`) +
      abschnitt('quellen', 'Quellen', `<ul class="punkte"><li>Swissmedic: Fach- und Patienteninformationen (<a href="https://www.swissmedicinfo.ch/" rel="noopener">swissmedicinfo.ch</a>) und Listen der zugelassenen Humanarzneimittel (<a href="https://www.swissmedic.ch/swissmedic/de/home/services/listen_neu.html" rel="noopener">swissmedic.ch</a>).</li><li>Wirkstoff-Monografien: redaktionell zusammengefasst nach pharmakologischem Standardwissen und Fachinformationen und automatisch auf Format, Verweise und Schreibweise geprüft. ${zahl(M.wirkstoffe.filter((w) => w.zweitpruefung).length)} häufig verwendete Wirkstoffe wurden zusätzlich von einer zweiten, unabhängigen Prüfung gegengelesen – das steht jeweils unten auf der Wirkstoffseite. Stand siehe jeweilige Seite.</li><li>Häufigkeitsangaben: MedDRA-Konvention der Fachinformationen.</li></ul>`) +
      abschnitt('datenschutz', 'Datenschutz', `<p class="text">Kein Tracking, keine Cookies, keine Werbung, keine externen Schriften oder Skripte. Es werden keine Gesundheitsangaben erfasst oder gespeichert; Suchanfragen bleiben im Browser. Nur das gewählte Farbschema wird lokal auf diesem Gerät gespeichert.</p>`),
      'seite--nummern seite--schmal');
    return { titel: 'Über die Daten' };
  }

  function view404() {
    main.innerHTML = seite([], `<div class="kopfzeile"><h1 tabindex="-1">Nicht gefunden</h1></div><div class="block"><p>Diesen Eintrag gibt es nicht (mehr). Suchen Sie oben nach dem Wirkstoff, der Marke oder der Krankheit.</p><p><a href="#/">Zur Startseite</a></p></div>`);
    return { titel: 'Nicht gefunden' };
  }

  /* ---------- Inhaltsverzeichnis der Monografie: aufklappbar (Handy) und mitlaufend ---------- */
  let spion = null;
  let spionGrenze = 0;
  const messeGrenze = () => {
    spionGrenze = (parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0) + 8;
  };
  function inhaltNav() {
    spion = null;
    const nav = $('.inhalt-nav', main);
    if (!nav) return;
    const knopf = $('.inhalt-nav__knopf', nav);
    const aktuell = $('.inhalt-nav__aktuell', nav);
    const links = $$('a[data-scroll]', nav);
    const offen = (an) => {
      nav.classList.toggle('ist-offen', an);
      knopf.setAttribute('aria-expanded', String(an));
    };
    knopf.addEventListener('click', () => offen(!nav.classList.contains('ist-offen')));
    nav.addEventListener('click', (ev) => { if (ev.target.closest('a')) offen(false); });
    nav.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && nav.classList.contains('ist-offen')) {
        offen(false);
        knopf.focus();
      }
    });
    // Verlässt der Tastaturfokus die offene Liste, schliesst sie – sonst verdeckt sie das fokussierte Element
    nav.addEventListener('focusout', (ev) => {
      if (nav.classList.contains('ist-offen') && ev.relatedTarget && !nav.contains(ev.relatedTarget)) offen(false);
    });
    spion = { nav, links, ziele: links.map((a) => document.getElementById(a.dataset.scroll)), aktuell, offen, standard: aktuell.innerHTML, idx: -2 };
    messeGrenze();
    pruefeSpion();
  }
  function pruefeSpion() {
    if (!spion || !spion.nav.isConnected) return;
    let idx = -1;
    spion.ziele.forEach((el, i) => { if (el && el.getBoundingClientRect().top <= spionGrenze) idx = i; });
    if (idx >= 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) idx = spion.ziele.length - 1;
    if (idx === spion.idx) return;
    spion.idx = idx;
    spion.links.forEach((a, i) => {
      if (i === idx) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    });
    const t = idx < 0 ? null : $('.toc__t', spion.links[idx]);
    spion.aktuell.innerHTML = t ? `<b>${String(idx + 1).padStart(2, '0')}</b>${esc(t.textContent)}` : spion.standard;
  }
  let spionRaf = 0;
  window.addEventListener('scroll', () => {
    if (!spionRaf) spionRaf = requestAnimationFrame(() => { spionRaf = 0; pruefeSpion(); if (feldHoehe) feldHoehe(); });
  }, { passive: true });
  window.addEventListener('resize', () => { messeGrenze(); pruefeSpion(); });

  /* ---------- Router ---------- */
  const ROUTEN = [
    [/^$/, () => viewStart(), 'start'],
    [/^wirkstoff\/([^/]+)(?:\/([^/]+))?$/, (m) => viewWirkstoff(m[1], m[2]), 'a-z'],
    [/^krankheit\/([^/]+)$/, (m) => viewKrankheit(m[1]), 'krankheiten'],
    [/^gruppe\/([^/]+)$/, (m) => viewGruppe(m[1]), 'gruppen'],
    [/^praeparat\/([^/]+)$/, (m) => viewPraeparat(m[1]), 'a-z'],
    [/^suche\/(.*)$/, (m) => viewSuche(m[1]), 'start'],
    [/^a-z$/, () => viewAZ(), 'a-z'],
    [/^krankheiten$/, () => viewKrankheiten(), 'krankheiten'],
    [/^gruppen(?:\/([^/]+))?$/, (m) => viewGruppen(m[1]), 'gruppen'],
    [/^info$/, () => viewInfo(), 'info'],
  ];
  let aktuelleSeite = null;
  const scrollZu = (id) => {
    const el = document.getElementById(id);
    if (!el || !main.contains(el) || el === main) return false;
    el.scrollIntoView({ block: 'start' });
    const h = el.querySelector('h2, h3') || el;
    if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1');
    h.focus({ preventScroll: true });
    return true;
  };

  let letzterHash = '#/';
  function render(behalteScroll, fokusSelektor, ohneFokus) {
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
    spion = null;
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
    // Suchseite hat ihr eigenes Suchfeld: das Kopffeld weicht wie auf der Startseite
    document.body.classList.toggle('ist-suche', /^suche\//.test(pfad));
    typografie(main);
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
    if (ohneFokus) return;
    if (!erstesRendern) {
      const ziel = ergebnis.fokus || $('h1', main);
      if (ziel) ziel.focus({ preventScroll: true });
    } else if (ergebnis.fokus) {
      ergebnis.fokus.focus({ preventScroll: true });
    }
  }

  /* ---------- Start ---------- */
  let erstesRendern = true;
  suchfeld($('#kopf-suche'), { id: 'suche-kopf', placeholder: SCHMAL.matches ? 'Suchen …' : 'Medikament oder Krankheit' });
  $('#daten-stand').textContent =
    `Datenstand ${M.stand || '–'}: ${zahl(M.wirkstoffe.length)} Wirkstoff-Monografien` +
    (P.liste && P.liste.length ? ` · ${zahl(P.liste.length)} Swissmedic-Präparate (Stand ${P.stand || '–'})` : '') + '.';

  // Farbschema-Knopf: Schalter «Dunkles Farbschema» mit Zustand (aria-pressed)
  const themeKnopf = $('#theme-knopf');
  const SYSTEM_DUNKEL = window.matchMedia('(prefers-color-scheme: dark)');
  const themaJetzt = () => document.documentElement.getAttribute('data-theme') || (SYSTEM_DUNKEL.matches ? 'dark' : 'light');
  const zeigeThema = () => themeKnopf.setAttribute('aria-pressed', String(themaJetzt() === 'dark'));
  zeigeThema();
  if (SYSTEM_DUNKEL.addEventListener) SYSTEM_DUNKEL.addEventListener('change', zeigeThema);
  themeKnopf.addEventListener('click', () => {
    const neu = themaJetzt() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', neu);
    try { localStorage.setItem('medi-theme', neu); } catch (e) { /* privater Modus */ }
    if (window.mediThemaFarbe) window.mediThemaFarbe(neu);
    zeigeThema();
  });
  document.addEventListener('click', (ev) => {
    // Offenes Inhaltsverzeichnis schliessen, wenn daneben getippt wird
    if (spion && spion.nav.classList.contains('ist-offen') && !spion.nav.contains(ev.target)) spion.offen(false);
    const a = ev.target.closest('[data-scroll]');
    if (!a) return;
    ev.preventDefault();
    scrollZu(a.dataset.scroll);
  });

  /* Drucken: eingeklappte Listen vollständig ausgeben */
  window.addEventListener('beforeprint', () => $$('details.mehr').forEach((d) => {
    if (!d.open) { d.open = true; d.dataset.druck = '1'; }
  }));
  window.addEventListener('afterprint', () => $$('details.mehr[data-druck]').forEach((d) => {
    d.open = false;
    delete d.dataset.druck;
  }));
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
  render(false);
  erstesRendern = false;
})();
