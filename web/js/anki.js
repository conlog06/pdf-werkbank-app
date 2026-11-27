/* PDF Werkbank – Lernkarten mit Anki austauschen (ab Version 2.0)
 *   WBAnki.exportApkg(cards, deckName) → Uint8Array (.apkg, Anki 2.1 und AnkiDroid/AnkiMobile)
 *   WBAnki.exportText(cards)           → Text (Tab getrennt, „Datei › Importieren“ in Anki)
 *   WBAnki.importFile(file)            → [{ front, back }] aus .apkg (Altformat), .txt, .csv, .tsv
 * Die SQLite-Datenbank im .apkg entsteht mit sql.js (WebAssembly), das erst bei Bedarf geladen wird.
 */
(function (global) {
  'use strict';
  const C = () => global.WB_CONFIG || {};
  const SQLV = '1.10.3';
  let sqlP = null;
  function sql() {
    if (sqlP) return sqlP;
    sqlP = new Promise((res, rej) => {
      const base = C().sqlBase || `https://cdn.jsdelivr.net/npm/sql.js@${SQLV}/dist/`;
      const go = () => global.initSqlJs({ locateFile: f => base + f }).then(res, rej);
      if (global.initSqlJs) return go();
      const s = document.createElement('script'); s.src = base + 'sql-wasm.js';
      s.onload = go; s.onerror = () => { sqlP = null; rej(new Error('Die Anki-Unterstützung konnte nicht geladen werden (offline?).')); };
      document.head.appendChild(s);
    });
    return sqlP;
  }
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  const unhtml = s => { const d = document.createElement('div'); d.innerHTML = String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|li)>/gi, '\n'); return (d.textContent || '').replace(/\n{3,}/g, '\n\n').trim(); };
  const guid = () => { const a = crypto.getRandomValues(new Uint8Array(10)), A = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~'; return Array.from(a, b => A[b % A.length]).join(''); };
  async function csum(s) { const h = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(unhtml(s)))); return parseInt(Array.from(h.slice(0, 4), b => b.toString(16).padStart(2, '0')).join(''), 16); }
  const SCHEMA = `create table col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null);
create table notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
create table cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
create table revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
create table graves (usn integer not null, oid integer not null, type integer not null);
create index ix_notes_usn on notes (usn); create index ix_cards_usn on cards (usn); create index ix_revlog_usn on revlog (usn);
create index ix_cards_nid on cards (nid); create index ix_cards_sched on cards (did, queue, due); create index ix_revlog_cid on revlog (cid); create index ix_notes_csum on notes (csum);`;
  const CRT = 1411124400;
  async function exportApkg(cards, deckName = 'PDF Werkbank') {
    const SQL = await sql(), db = new SQL.Database();
    db.run(SCHEMA);
    const now = Date.now(), ts = Math.floor(now / 1000);
    const did = 1500000000000 + Math.floor(Math.random() * 1e9), mid = 1600000000000 + Math.floor(Math.random() * 1e9);
    const fld = (name, ord) => ({ name, ord, font: 'Arial', media: [], rtl: false, size: 20, sticky: false });
    const model = {
      css: '.card{font-family:arial;font-size:20px;text-align:center;color:black;background-color:white}', did, flds: [fld('Vorderseite', 0), fld('Rückseite', 1), fld('Quelle', 2)], id: mid,
      latexPost: '\\end{document}', latexPre: '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n',
      mod: ts, name: 'PDF Werkbank Basis', req: [[0, 'all', [0]]], sortf: 0, tags: [], type: 0, usn: -1, vers: [],
      tmpls: [{ afmt: '{{FrontSide}}<hr id=answer>{{Rückseite}}{{#Quelle}}<div style="font-size:12px;color:#888;margin-top:16px">{{Quelle}}</div>{{/Quelle}}', bafmt: '', bqfmt: '', did: null, name: 'Karte 1', ord: 0, qfmt: '{{Vorderseite}}' }],
    };
    const deck = (id, name) => ({ collapsed: false, conf: 1, desc: '', dyn: 0, extendNew: 0, extendRev: 50, id, lrnToday: [0, 0], mod: ts, name, newToday: [0, 0], revToday: [0, 0], timeToday: [0, 0], usn: -1 });
    const conf = { activeDecks: [1], addToCur: true, collapseTime: 1200, curDeck: 1, curModel: String(mid), dueCounts: true, estTimes: true, newBury: true, newSpread: 0, nextPos: cards.length + 1, sortBackwards: false, sortType: 'noteFld', timeLim: 0 };
    const dconf = { 1: { autoplay: true, id: 1, lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 }, maxTaken: 60, mod: 0, name: 'Default', new: { bury: true, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 7], order: 1, perDay: 20, separate: true }, replayq: true, rev: { bury: true, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, minSpace: 1, perDay: 100 }, timer: 0, usn: 0 } };
    db.run('insert into col values (1,?,?,?,11,0,0,0,?,?,?,?,?)', [CRT, now, now, JSON.stringify(conf), JSON.stringify({ [mid]: model }), JSON.stringify({ 1: deck(1, 'Default'), [did]: deck(did, deckName) }), JSON.stringify(dconf), '{}']);
    let k = 0;
    for (const c of cards) {
      const front = esc(c.front), back = esc(c.back), src = esc(c.source || '');
      const nid = now + k, cid = now + k + 100000;
      db.run('insert into notes values (?,?,?,?,-1,?,?,?,?,0,\'\')', [nid, guid(), mid, ts, c.tags || '', [front, back, src].join('\x1f'), front, await csum(front)]);
      // Lernstand übernehmen: gelernte Karten werden Wiederholungskarten
      const review = (c.reps || 0) > 0 && c.ivl > 0 && c.due;
      const dueDay = review ? Math.max(0, Math.floor((c.due - CRT * 1000) / 86400000)) : k + 1;
      db.run('insert into cards values (?,?,?,0,?,-1,?,?,?,?,?,?,?,0,0,0,0,\'\')', [cid, nid, did, ts, review ? 2 : 0, review ? 2 : 0, dueDay, review ? c.ivl : 0, review ? Math.round((c.ef || 2.5) * 1000) : 0, c.reps || 0, c.lapses || 0]);
      k++;
    }
    const bytes = db.export(); db.close();
    return new Uint8Array(await global.WBFile.zip([{ name: 'collection.anki2', bytes }, { name: 'media', bytes: new TextEncoder().encode('{}') }]).arrayBuffer());
  }
  function exportText(cards) {
    const f = s => String(s || '').replace(/\t/g, ' ').replace(/\r?\n/g, '<br>');
    return '#separator:tab\n#html:true\n#columns:Vorderseite\tRückseite\n' + cards.map(c => f(c.front) + '\t' + f(c.back)).join('\n') + '\n';
  }
  async function importFile(file) {
    const u8 = new Uint8Array(await file.arrayBuffer());
    if (/\.(apkg|colpkg)$/i.test(file.name) || (u8[0] === 0x50 && u8[1] === 0x4b)) {
      const files = await global.WBFile.unzip(u8);
      const db0 = files.get('collection.anki21') || files.get('collection.anki2');
      if (!db0 || files.has('collection.anki21b') && !files.get('collection.anki21')) {
        if (files.has('collection.anki21b')) throw new Error('Dieses Anki-Paket nutzt das neue Format. In Anki beim Exportieren „Unterstützung für ältere Anki-Versionen“ anhaken und erneut exportieren.');
        throw new Error('Kein Anki-Stapel in der Datei gefunden.');
      }
      const SQL = await sql(), db = new SQL.Database(db0);
      const models = JSON.parse(db.exec('select models from col')[0].values[0][0]);
      const out = [];
      const res = db.exec('select mid, flds from notes');
      for (const [mid, flds] of (res[0] ? res[0].values : [])) {
        const m = models[mid] || models[String(mid)], f = String(flds).split('\x1f');
        if (m && m.type === 1) {
          // Lückentext: jede Lücke eine Karte
          const t = f[0]; const ns = [...new Set([...t.matchAll(/\{\{c(\d+)::/g)].map(x => x[1]))];
          for (const n of ns) out.push({ front: unhtml(t.replace(new RegExp(`\\{\\{c${n}::(.*?)(::(.*?))?\\}\\}`, 'g'), (a, b, c2, hint) => `[${hint || '…'}]`).replace(/\{\{c\d+::(.*?)(::.*?)?\}\}/g, '$1')), back: unhtml(t.replace(/\{\{c\d+::(.*?)(::.*?)?\}\}/g, '$1')) });
        } else out.push({ front: unhtml(f[0]), back: unhtml(f.slice(1).filter(Boolean).join('\n\n')) });
      }
      db.close();
      return out.filter(c => c.front && c.back);
    }
    const text = new TextDecoder().decode(u8);
    const lines = text.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#'));
    const sep = lines.some(l => l.includes('\t')) ? '\t' : lines.some(l => l.includes(';')) ? ';' : ',';
    return lines.map(l => { const [a, ...b] = l.split(sep); return { front: unhtml(a), back: unhtml(b.join(sep === '\t' ? '\n' : sep)) }; }).filter(c => c.front && c.back);
  }
  global.WBAnki = { exportApkg, exportText, importFile, sql };
})(window);
