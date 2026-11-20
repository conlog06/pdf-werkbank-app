/* PDF Werkbank – Zitieren und Literaturliste (ab Version 1.9)
 *   WBCite.detect(text)                 DOI und ISBN im Text finden
 *   WBCite.lookup({ doi, isbn })        Quellenangaben nachschlagen (Crossref, Open Library)
 *   WBCite.fromMeta(meta, name)         Grundgerüst aus den PDF-Eigenschaften
 *   WBCite.inText(ref, style, page)     Kurzbeleg, z. B. (Müller, 2023, S. 12)
 *   WBCite.quote(text, ref, style, page) Zitat mit Beleg
 *   WBCite.entry(ref, style, n)         Eintrag im Literaturverzeichnis (Text und HTML)
 *   WBCite.list(refs, style)            ganzes Verzeichnis, sortiert
 *   WBCite.bibtex(refs) / WBCite.ris(refs)  für Zotero, Citavi, LaTeX
 */
(function (global) {
  'use strict';
  const STYLES = { apa: 'APA 7', harvard: 'Harvard', de: 'Deutsche Zitierweise (Fußnote)', ieee: 'IEEE' };
  const TYPES = { book: 'Buch', article: 'Zeitschriftenartikel', chapter: 'Kapitel in Sammelband', report: 'Bericht / Skript', thesis: 'Abschlussarbeit', web: 'Webseite' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  /* ---------- Erkennen ---------- */
  function detect(text) {
    const t = String(text || '');
    const doiM = /\b(10\.\d{4,9}\/[^\s"<>,;]+)/i.exec(t.replace(/doi\.org\//i, ' '));
    const doi = doiM ? doiM[1].replace(/[.)\]]+$/, '') : '';
    const isbnM = /ISBN(?:-1[03])?[:\s]*((?:97[89][-\s]?)?(?:\d[-\s]?){9}[\dXx])/.exec(t);
    let isbn = isbnM ? isbnM[1].replace(/[-\s]/g, '').toUpperCase() : '';
    if (isbn && !validIsbn(isbn)) isbn = '';
    return { doi, isbn };
  }
  function validIsbn(s) {
    if (s.length === 10) { let sum = 0; for (let i = 0; i < 10; i++) sum += (s[i] === 'X' ? 10 : +s[i]) * (10 - i); return sum % 11 === 0; }
    if (s.length === 13) { let sum = 0; for (let i = 0; i < 13; i++) sum += +s[i] * (i % 2 ? 3 : 1); return sum % 10 === 0; }
    return false;
  }
  /* „Müller, Anna; Schmidt, B.“ oder „Anna Müller und Bernd Schmidt“ → [{ family, given }] */
  function parseAuthors(s) {
    s = clean(s); if (!s) return [];
    const parts = /;/.test(s) ? s.split(/\s*;\s*/) : s.split(/\s*(?:,\s*und\s+|\s+und\s+|\s+and\s+|\s*&\s*|,\s*(?=[^,]+\s[^,]+(?:,|$)))\s*/);
    return parts.filter(Boolean).map(p => {
      p = p.trim();
      if (/,/.test(p)) { const [f, g] = p.split(/\s*,\s*/); return { family: f, given: g || '' }; }
      if (/^(Prof\.|Dr\.)/.test(p)) p = p.replace(/^((Prof\.|Dr\.)\s*)+/, '');
      const w = p.split(/\s+/); if (w.length === 1) return { family: w[0], given: '' };
      const fam = w.pop(); return { family: fam, given: w.join(' ') };
    });
  }
  const authorsText = list => (list || []).map(a => (a.given ? `${a.family}, ${a.given}` : a.family)).join('; ');
  function fromMeta(meta = {}, name = '') {
    const year = (/(19|20)\d{2}/.exec(meta.created || '') || [''])[0];
    const title = clean(meta.title) || clean(String(name).replace(/\.(pdf|werkbank)$/i, '').replace(/[_]+/g, ' '));
    return { type: 'book', authors: parseAuthors(meta.author), title, year, container: '', publisher: '', place: '', volume: '', issue: '', pages: '', doi: '', isbn: '', url: '', edition: '', accessed: '' };
  }

  /* ---------- Nachschlagen ---------- */
  async function getJson(url) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 12000);
    try { const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
    finally { clearTimeout(t); }
  }
  async function lookup({ doi, isbn }) {
    if (doi) {
      const j = await getJson('https://api.crossref.org/works/' + encodeURIComponent(doi));
      const m = j.message || {};
      const type = /journal|article/.test(m.type) ? 'article' : m.type === 'book-chapter' || m.type === 'proceedings-article' ? 'chapter' : m.type === 'report' ? 'report' : m.type === 'dissertation' ? 'thesis' : /book|monograph/.test(m.type) ? 'book' : 'article';
      const dp = (m.issued && m.issued['date-parts'] && m.issued['date-parts'][0]) || (m.published && m.published['date-parts'] && m.published['date-parts'][0]) || [];
      return {
        type, authors: (m.author || []).map(a => ({ family: a.family || a.name || '', given: a.given || '' })).filter(a => a.family),
        title: clean((m.title || [''])[0]), year: dp[0] ? String(dp[0]) : '', container: clean((m['container-title'] || [''])[0]),
        publisher: clean(m.publisher), place: clean(m['publisher-location']), volume: clean(m.volume), issue: clean(m.issue), pages: clean(m.page).replace('-', '–'),
        doi: m.DOI || doi, isbn: (m.ISBN || [])[0] || '', url: '', edition: clean(m['edition-number']), accessed: '',
      };
    }
    if (isbn) {
      const j = await getJson(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
      const m = j['ISBN:' + isbn];
      if (!m) throw new Error('Zu dieser ISBN wurde nichts gefunden.');
      return {
        type: 'book', authors: (m.authors || []).map(a => parseAuthors(a.name)[0]).filter(Boolean),
        title: clean(m.title + (m.subtitle ? ': ' + m.subtitle : '')), year: (/(\d{4})/.exec(m.publish_date || '') || ['', ''])[1],
        container: '', publisher: clean(((m.publishers || [])[0] || {}).name), place: clean(((m.publish_places || [])[0] || {}).name),
        volume: '', issue: '', pages: '', doi: '', isbn, url: '', edition: '', accessed: '',
      };
    }
    throw new Error('Keine DOI oder ISBN angegeben.');
  }

  /* ---------- Formatieren ---------- */
  const ini = g => clean(g).split(/[\s-]+/).filter(Boolean).map(x => x[0].toUpperCase() + '.').join(' ');
  const yr = r => r.year || 'o. J.';
  const pg = (p, style) => (p == null || p === '' ? '' : style === 'ieee' ? `S. ${p}` : `S. ${p}`);
  function namesShort(r, style) {
    const a = r.authors || [];
    if (!a.length) return (r.publisher || r.title.split(/\s+/).slice(0, 3).join(' '));
    if (style === 'apa') return a.length === 1 ? a[0].family : a.length === 2 ? `${a[0].family} & ${a[1].family}` : `${a[0].family} et al.`;
    return a.length === 1 ? a[0].family : a.length === 2 ? `${a[0].family}/${a[1].family}` : `${a[0].family} u. a.`;
  }
  function inText(r, style = 'apa', page) {
    const p = pg(page, style);
    if (style === 'apa') return `(${namesShort(r, style)}, ${yr(r)}${p ? ', ' + p : ''})`;
    if (style === 'harvard') return `(${namesShort(r, style)} ${yr(r)}${p ? ', ' + p : ''})`;
    if (style === 'ieee') return `[1${p ? ', ' + p : ''}]`;
    // Fußnote: Kurzform
    const a = r.authors || [];
    const who = a.length ? a.slice(0, 2).map(x => x.family).join('/') + (a.length > 2 ? ' u. a.' : '') : namesShort(r, style);
    return `${who}: ${short(r.title)}${r.year ? ', ' + r.year : ''}${p ? ', ' + p : ''}.`;
  }
  const short = t => { const w = clean(t).split(/[:.]/)[0].split(/\s+/); return w.length > 6 ? w.slice(0, 6).join(' ') + ' …' : w.join(' '); };
  function quote(text, r, style = 'apa', page) {
    const t = clean(text).replace(/^["„“]+|["“”]+$/g, '');
    if (style === 'de') return { text: `„${t}“¹`, foot: '¹ ' + entry(r, 'de', 0, page).text, cite: inText(r, style, page) };
    return { text: `„${t}“ ${inText(r, style, page)}`, cite: inText(r, style, page) };
  }
  /* Autorenliste fürs Verzeichnis */
  function namesLong(r, style) {
    const a = r.authors || [];
    if (!a.length) return '';
    if (style === 'apa') {
      const f = a.map(x => `${x.family}${x.given ? ', ' + ini(x.given) : ''}`);
      if (f.length === 1) return f[0];
      if (f.length <= 20) return f.slice(0, -1).join(', ') + ', & ' + f[f.length - 1];
      return f.slice(0, 19).join(', ') + ', … ' + f[f.length - 1];
    }
    if (style === 'ieee') {
      const f = a.map(x => `${x.given ? ini(x.given) + ' ' : ''}${x.family}`);
      if (f.length > 6) return f[0] + ' et al.';
      return f.length === 1 ? f[0] : f.slice(0, -1).join(', ') + (f.length > 2 ? ',' : '') + ' and ' + f[f.length - 1];
    }
    if (style === 'de') return a.map(x => `${x.family}${x.given ? ', ' + x.given : ''}`).join('/');
    return a.map(x => `${x.family}${x.given ? ', ' + ini(x.given) : ''}`).join('/');
  }
  const dot = s => (s && !/[.?!]$/.test(s) ? s + '.' : s);
  /* liefert { text, html } – html mit kursivem Titel bzw. Zeitschrift */
  function entry(r, style = 'apa', n = 0, page) {
    const it = s => ({ t: s, i: true }), seg = [];
    const push = (...xs) => xs.forEach(x => x && seg.push(typeof x === 'string' ? { t: x } : x));
    const names = namesLong(r, style), ed = r.edition && !/^1\.?$/.test(r.edition) ? `${String(r.edition).replace(/\.$/, '')}. Aufl.` : '';
    const doi = r.doi ? `https://doi.org/${r.doi}` : r.url || '';
    const acc = r.type === 'web' && r.accessed ? r.accessed : '';
    if (style === 'apa') {
      push(names ? names + ' ' : '', `(${yr(r)}). `);
      if (r.type === 'article') { push(dot(r.title) + ' '); if (r.container) { push(it(r.container)); if (r.volume) push(', ', it(r.volume)); if (r.issue) push(`(${r.issue})`); if (r.pages) push(`, ${r.pages}`); push('. '); } }
      else if (r.type === 'chapter') { push(dot(r.title) + ' '); if (r.container) push('In ', it(r.container), r.pages ? ` (S. ${r.pages}). ` : '. '); if (r.publisher) push(dot(r.publisher) + ' '); }
      else { push(it(r.title)); if (ed) push(` (${ed})`); push('. '); if (r.publisher) push(dot(r.publisher) + ' '); }
      if (acc) push(`Abgerufen am ${acc}, von `);
      if (doi) push(doi);
    } else if (style === 'harvard') {
      push(names ? names + ' ' : '', `(${yr(r)}): `);
      if (r.type === 'article') { push(r.title + ', in: '); push(it(r.container || '')); if (r.volume) push(`, Jg. ${r.volume}`); if (r.issue) push(`, Nr. ${r.issue}`); if (r.pages) push(`, S. ${r.pages}`); push('.'); }
      else if (r.type === 'chapter') { push(r.title + ', in: '); push(it(r.container || '')); push(r.place || r.publisher ? `, ${[r.place, r.publisher].filter(Boolean).join(': ')}` : ''); if (r.pages) push(`, S. ${r.pages}`); push('.'); }
      else { push(it(r.title)); if (ed) push(`, ${ed}`); if (r.place || r.publisher) push(`, ${[r.place, r.publisher].filter(Boolean).join(': ')}`); push('.'); }
      if (doi) push(` ${doi}`); if (acc) push(` (Zugriff: ${acc})`);
    } else if (style === 'de') {
      push(names ? names + ': ' : '');
      if (r.type === 'article') { push(r.title + ', in: ' + (r.container || '')); if (r.volume) push(` ${r.volume}`); if (r.year) push(` (${r.year})`); if (r.issue) push(`, Heft ${r.issue}`); if (r.pages) push(`, S. ${r.pages}`); }
      else if (r.type === 'chapter') { push(r.title + ', in: ' + (r.container || '')); push(r.place || r.publisher ? `, ${[r.place, r.publisher].filter(Boolean).join(': ')}` : ''); push(` ${yr(r)}`); if (r.pages) push(`, S. ${r.pages}`); }
      else { push(r.title); if (ed) push(`, ${ed}`); push(r.place || r.publisher ? `, ${[r.place, r.publisher].filter(Boolean).join(': ')} ${yr(r)}` : `, ${yr(r)}`); }
      if (page) push(`, S. ${page}`);
      push('.'); if (doi) push(` ${doi}`); if (acc) push(` (Zugriff: ${acc})`);
    } else {
      push(`[${n || 1}] `, names ? names + ', ' : '');
      if (r.type === 'article') { push(`„${r.title},“ `, it(r.container || '')); if (r.volume) push(`, Bd. ${r.volume}`); if (r.issue) push(`, Nr. ${r.issue}`); if (r.pages) push(`, S. ${r.pages}`); push(`, ${yr(r)}.`); }
      else if (r.type === 'chapter') { push(`„${r.title},“ in `, it(r.container || '')); push(r.place || r.publisher ? `, ${[r.place, r.publisher].filter(Boolean).join(': ')}` : ''); push(`, ${yr(r)}`); if (r.pages) push(`, S. ${r.pages}`); push('.'); }
      else { push(it(r.title)); if (ed) push(`, ${ed}`); push(r.place || r.publisher ? `${ed ? '' : '.'} ${[r.place, r.publisher].filter(Boolean).join(': ')}` : ''); push(`, ${yr(r)}.`); }
      if (r.doi) push(` doi: ${r.doi}.`); else if (r.url) push(` [Online]. Verfügbar: ${r.url}`);
    }
    const text = seg.map(s => s.t).join('').replace(/\s+/g, ' ').replace(/\s+([.,])/g, '$1').trim();
    const html = seg.map(s => (s.i ? `<i>${esc(s.t)}</i>` : esc(s.t))).join('').replace(/\s+/g, ' ').trim();
    return { text, html };
  }
  function list(refs, style = 'apa') {
    const sorted = style === 'ieee' ? refs : [...refs].sort((a, b) => namesLong(a, 'apa').localeCompare(namesLong(b, 'apa'), 'de') || String(a.year).localeCompare(String(b.year)));
    const es = sorted.map((r, i) => entry(r, style, i + 1));
    return { text: es.map(e => e.text).join('\n'), html: es.map(e => `<p style="margin:0 0 6pt;padding-left:2em;text-indent:-2em">${e.html}</p>`).join('') };
  }

  /* ---------- Export ---------- */
  const keyOf = (r, used) => {
    let k = ((r.authors[0] && r.authors[0].family) || 'quelle').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').replace(/[^A-Za-z]/g, '').toLowerCase() + (r.year || '');
    let n = k, i = 0; while (used.has(n)) n = k + String.fromCharCode(97 + i++); used.add(n); return n;
  };
  const tex = s => String(s || '').replace(/[{}]/g, '').replace(/&/g, '\\&').replace(/%/g, '\\%');
  function bibtex(refs) {
    const used = new Set();
    return refs.map(r => {
      const t = { article: 'article', chapter: 'incollection', report: 'techreport', thesis: 'phdthesis', web: 'online', book: 'book' }[r.type] || 'misc';
      const f = [['author', (r.authors || []).map(a => (a.given ? `${a.family}, ${a.given}` : a.family)).join(' and ')], ['title', r.title], ['year', r.year],
        [r.type === 'article' ? 'journal' : 'booktitle', r.type === 'article' || r.type === 'chapter' ? r.container : ''], ['publisher', r.publisher], ['address', r.place], ['volume', r.volume], ['number', r.issue],
        ['pages', String(r.pages || '').replace('–', '--')], ['edition', r.edition], ['doi', r.doi], ['isbn', r.isbn], ['url', r.url], ['urldate', r.accessed]].filter(([, v]) => v);
      return `@${t}{${keyOf(r, used)},\n${f.map(([k, v]) => `  ${k} = {${k === 'title' ? '{' + tex(v) + '}' : tex(v)}}`).join(',\n')}\n}`;
    }).join('\n\n') + '\n';
  }
  function ris(refs) {
    return refs.map(r => {
      const ty = { article: 'JOUR', chapter: 'CHAP', report: 'RPRT', thesis: 'THES', web: 'ELEC', book: 'BOOK' }[r.type] || 'GEN';
      const L = [['TY', ty], ...(r.authors || []).map(a => ['AU', a.given ? `${a.family}, ${a.given}` : a.family]), ['TI', r.title], ['PY', r.year],
        [r.type === 'article' ? 'JO' : 'T2', r.container], ['PB', r.publisher], ['CY', r.place], ['VL', r.volume], ['IS', r.issue],
        ['SP', String(r.pages || '').split(/[–-]/)[0]], ['EP', String(r.pages || '').split(/[–-]/)[1]], ['ET', r.edition], ['DO', r.doi], ['SN', r.isbn], ['UR', r.url], ['Y2', r.accessed], ['ER', '']].filter(([k, v]) => v || k === 'ER');
      return L.map(([k, v]) => `${k}  - ${v}`).join('\r\n');
    }).join('\r\n\r\n') + '\r\n';
  }
  /* in die Zwischenablage, mit Formatierung wo möglich */
  async function copy(text, html) {
    try {
      if (html && global.ClipboardItem && navigator.clipboard.write) { await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]); return true; }
      await navigator.clipboard.writeText(text); return true;
    } catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (er) { ok = false; } ta.remove(); return ok;
    }
  }
  global.WBCite = { STYLES, TYPES, detect, lookup, fromMeta, parseAuthors, authorsText, inText, quote, entry, list, bibtex, ris, copy };
})(window);
