/* PDF Werkbank – Volltextsuche über die ganze Bibliothek
 * Für jedes Dokument wird ein Textindex angelegt: Text jeder PDF-Seite (pdf.js) plus eigene Texte,
 * Notizen, Kommentare und markierter Text. Der Index liegt lokal (IndexedDB) und wird im Hintergrund
 * nachgezogen, sobald sich ein Dokument ändert.
 */
(function (global) {
  'use strict';
  const ST = () => global.WBStore, PDFJS = () => global.pdfjsLib;
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
  const cache = new Map(); // id → index
  let running = false, again = false, progress = { done: 0, total: 0 };
  const listeners = new Set();
  const emit = () => listeners.forEach(f => { try { f({ ...progress, running }); } catch (e) { /* egal */ } });

  /* Text jeder Seite einer Quell-PDF (zwischengespeichert, Quellen ändern sich nie) */
  async function sourceText(docId, sid) {
    const key = `textsrc:${docId}:${sid}`;
    const have = await ST().getBlob(key);
    if (have) return have;
    const src = await ST().getBlob(`src:${docId}:${sid}`);
    if (!src || !PDFJS()) return [];
    const out = [];
    let pdf = null;
    try {
      pdf = await PDFJS().getDocument({ data: src.bytes.slice(), isEvalSupported: false }).promise;
      for (let i = 1; i <= pdf.numPages; i++) {
        const pg = await pdf.getPage(i);
        const tc = await pg.getTextContent();
        out.push(clean(tc.items.map(it => it.str + (it.hasEOL ? ' ' : '')).join(' ')));
        pg.cleanup();
        if (i % 8 === 0) await new Promise(r => setTimeout(r, 0)); // Oberfläche nicht blockieren
      }
    } catch (e) { console.warn('Text lesen', e); }
    finally { if (pdf) try { pdf.destroy(); } catch (e) { /* egal */ } }
    await ST().putBlob(key, out);
    return out;
  }
  /* Index eines Dokuments: Seiten in Bearbeitungsreihenfolge, dazu eigene Texte */
  async function build(item) {
    const state = await ST().getBlob('state:' + item.id);
    const srcIds = state && state.srcIds ? state.srcIds : item.srcIds || [];
    const texts = {};
    for (const sid of srcIds) texts[sid] = await sourceText(item.id, sid);
    const pages = [], own = [];
    if (state && state.pages) {
      state.pages.forEach((p, i) => {
        pages.push({ n: i + 1, t: (texts[p.src] || [])[p.idx] || '' });
        for (const a of p.annots || []) {
          if (a.text && ['text', 'note', 'stamp', 'wm'].includes(a.t)) own.push({ n: i + 1, t: clean(a.text), k: a.t === 'note' ? 'Notiz' : 'Text' });
          if (a.comment) own.push({ n: i + 1, t: clean(a.comment), k: 'Kommentar' });
        }
      });
    } else {
      (texts[srcIds[0]] || []).forEach((t, i) => pages.push({ n: i + 1, t }));
    }
    const idx = { rev: item.rev, name: item.name, pages, own };
    await ST().putBlob('text:' + item.id, idx);
    cache.set(item.id, idx);
    return idx;
  }
  async function indexOf(item) {
    const c = cache.get(item.id);
    if (c && c.rev === item.rev) return c;
    const b = await ST().getBlob('text:' + item.id);
    if (b && b.rev === item.rev) { cache.set(item.id, b); return b; }
    return null;
  }
  /* fehlende Indizes im Hintergrund anlegen */
  async function indexAll() {
    if (running) { again = true; return; }
    running = true;
    try {
      const docs = (await ST().all()).filter(i => i.kind === 'doc' && !i.missing && !i.trashed);
      const todo = [];
      for (const d of docs) if (!(await indexOf(d))) todo.push(d);
      progress = { done: 0, total: todo.length }; emit();
      for (const d of todo) {
        try { await build(d); } catch (e) { console.warn('Index', d.name, e); }
        progress.done++; emit();
        await new Promise(r => setTimeout(r, 30));
      }
    } finally {
      running = false; progress = { done: 0, total: 0 }; emit();
      if (again) { again = false; setTimeout(indexAll, 500); }
    }
  }
  let t = 0;
  const schedule = (ms = 2500) => { clearTimeout(t); t = setTimeout(indexAll, ms); };

  /* Suche: Treffer je Dokument mit Ausschnitt und Seitenzahl */
  function snippet(text, at, len) {
    const a = Math.max(0, at - 50), b = Math.min(text.length, at + len + 70);
    return { pre: (a > 0 ? '… ' : '') + text.slice(a, at), hit: text.slice(at, at + len), post: text.slice(at + len, b) + (b < text.length ? ' …' : '') };
  }
  function findIn(text, nq) {
    // Position im Originaltext über normalisierte Fassung finden (Umlaute/Akzente egal)
    const n = norm(text);
    const k = n.indexOf(nq);
    if (k < 0) return null;
    let count = 0, p = n.indexOf(nq);
    while (p >= 0 && count < 99) { count++; p = n.indexOf(nq, p + nq.length); }
    return { at: Math.min(k, text.length), count };
  }
  async function search(q, items) {
    const nq = norm(q).trim();
    if (nq.length < 2) return [];
    const res = [];
    for (const d of items) {
      if (d.kind !== 'doc') continue;
      const idx = await indexOf(d);
      if (!idx) continue;
      const hits = [];
      let total = 0;
      for (const o of idx.own) { const f = findIn(o.t, nq); if (f) { total += f.count; if (hits.length < 3) hits.push({ n: o.n, k: o.k, ...snippet(o.t, f.at, nq.length) }); } }
      for (const p of idx.pages) { const f = findIn(p.t, nq); if (f) { total += f.count; if (hits.length < 3) hits.push({ n: p.n, ...snippet(p.t, f.at, nq.length) }); } }
      if (total) res.push({ doc: d, total, hits });
    }
    res.sort((a, b) => b.total - a.total);
    return res;
  }


  /* Für Fragen an die ganze Bibliothek: passende Seiten nach Stichwörtern (BM25-artig) */
  const STOP = new Set('der die das und oder ein eine einer eines einem einen ist sind war waren wird werden wie was wer wo warum welche welcher welches nicht mit von zu im in am an auf für bei aus nach über unter dem den des sich auch als noch nur so dass daß kann können muss müssen soll sollen hat haben the and for with what how why which this that are was were from into erkläre erklär bitte mir mich gib nenne beschreibe kurz einfach unterschied zwischen'.split(' '));
  const terms = q => [...new Set(norm(q).split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 3 && !STOP.has(w)))];
  async function passages(q, items, max = 8) {
    const ts = terms(q); if (!ts.length) return [];
    const pages = [];
    for (const d of items) {
      if (d.kind !== 'doc') continue;
      const idx = await indexOf(d); if (!idx) continue;
      const own = new Map(); for (const o of idx.own) own.set(o.n, (own.get(o.n) || '') + ' ' + o.t);
      for (const p of idx.pages) { const t = (p.t + ' ' + (own.get(p.n) || '')).trim(); if (t) pages.push({ doc: d, n: p.n, t, nt: norm(t) }); }
    }
    if (!pages.length) return [];
    const N = pages.length, avg = pages.reduce((s, p) => s + p.nt.length, 0) / N;
    const df = ts.map(t => pages.filter(p => p.nt.includes(t)).length);
    for (const p of pages) {
      let sc = 0, hitTerms = 0;
      ts.forEach((t, i) => {
        if (!df[i]) return;
        let c = 0, k = p.nt.indexOf(t); while (k >= 0 && c < 50) { c++; k = p.nt.indexOf(t, k + t.length); }
        if (!c) return; hitTerms++;
        const idf = Math.log(1 + (N - df[i] + 0.5) / (df[i] + 0.5));
        sc += idf * (c * 2.2) / (c + 1.2 * (0.25 + 0.75 * p.nt.length / avg));
      });
      p.score = sc * (1 + hitTerms / ts.length);
    }
    return pages.filter(p => p.score > 0).sort((a, b) => b.score - a.score).slice(0, max).map(p => {
      // Ausschnitt um die dichteste Stelle
      let best = 0, bestAt = 0;
      for (let at = 0; at < p.t.length; at += 300) { const w = p.nt.slice(at, at + 1600); const c = ts.reduce((s, t) => s + (w.split(t).length - 1), 0); if (c > best) { best = c; bestAt = at; } }
      const a = Math.max(0, bestAt - 200);
      return { doc: p.doc, n: p.n, score: p.score, text: (a ? '… ' : '') + p.t.slice(a, a + 1800) + (a + 1800 < p.t.length ? ' …' : '') };
    });
  }

  if (ST()) ST().onChange(() => schedule(3000));
  global.WBSearch = { indexAll, schedule, search, passages, terms, progress: () => ({ ...progress, running }), onProgress: fn => { listeners.add(fn); return () => listeners.delete(fn); } };
})(window);
