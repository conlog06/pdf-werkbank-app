/* PDF Werkbank – Stapelverarbeitung (ab Version 1.9)
 * Eine Kette von Schritten auf viele PDFs anwenden: Texterkennung, Verkleinern, Wasserzeichen, Seitenzahlen,
 * PDF/A, Passwort, Umwandeln (Word/Text/Bilder), Umbenennen nach Inhalt, alles zusammenführen.
 *   WBBatch.open({ files: [{ name, bytes }], title, onSave: async results => {}, saveLabel, pick: true })
 */
(function (global) {
  'use strict';
  const PL = () => global.PDFLib;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* egal */ } };
  const base = n => String(n || 'Dokument').replace(/\.(pdf|werkbank)$/i, '');
  const fmtMB = n => (global.WBTools ? global.WBTools.fmtMB(n) : Math.round(n / 1024) + ' kB');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  /* ---------- Schritte ---------- */
  async function watermark(bytes, o) {
    const { PDFDocument, StandardFonts, rgb, degrees } = PL();
    const d = await PDFDocument.load(bytes, { updateMetadata: false }), f = await d.embedFont(StandardFonts.HelveticaBold);
    const hex = (o.color || '#d0342c').replace('#', ''), col = rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255);
    const text = Array.from(o.text || 'ENTWURF').map(ch => { try { f.encodeText(ch); return ch; } catch (e) { return '?'; } }).join('');
    for (const p of d.getPages()) {
      const { width: W, height: H } = p.getSize(), ang = Math.atan2(H, W), span = Math.hypot(W, H) * 0.6;
      const size = Math.max(16, Math.min(150, 72 * span / f.widthOfTextAtSize(text, 72))), tw = f.widthOfTextAtSize(text, size);
      const cx = W / 2 - Math.cos(ang) * tw / 2 + Math.sin(ang) * size * 0.35, cy = H / 2 - Math.sin(ang) * tw / 2 - Math.cos(ang) * size * 0.35;
      p.drawText(text, { x: cx, y: cy, size, font: f, color: col, opacity: (o.opacity || 18) / 100, rotate: degrees(ang * 180 / Math.PI) });
    }
    return d.save();
  }
  async function pageNumbers(bytes, o) {
    const { PDFDocument, StandardFonts, rgb } = PL();
    const d = await PDFDocument.load(bytes, { updateMetadata: false }), f = await d.embedFont(StandardFonts.Helvetica);
    const ps = d.getPages(), N = ps.length;
    ps.forEach((p, i) => {
      if (o.skipFirst && i === 0) return;
      const t = (o.fmt || 'Seite {n} von {N}').replace('{n}', i + 1 - (o.skipFirst ? 1 : 0)).replace('{N}', N - (o.skipFirst ? 1 : 0));
      const { width: W } = p.getSize(), w = f.widthOfTextAtSize(t, 9);
      const x = o.pos === 'br' ? W - 42 - w : o.pos === 'bl' ? 42 : (W - w) / 2;
      p.drawText(t, { x, y: 24, size: 9, font: f, color: rgb(0.3, 0.32, 0.36) });
    });
    return d.save();
  }
  async function textOf(bytes, pages = 2) {
    const pdf = await global.pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
    let out = '', meta = {};
    try { meta = ((await pdf.getMetadata()) || {}).info || {}; } catch (e) { /* egal */ }
    for (let i = 1; i <= Math.min(pages, pdf.numPages); i++) {
      const tc = await (await pdf.getPage(i)).getTextContent(); let y = null;
      for (const it of tc.items) { if (y != null && Math.abs(it.transform[5] - y) > 2) out += '\n'; else if (out && !out.endsWith('\n')) out += ' '; out += it.str; y = it.transform[5]; }
      out += '\n';
    }
    const n = pdf.numPages; pdf.destroy();
    return { text: out.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim(), meta, pages: n };
  }
  const cleanName = s => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);
  async function guessName(bytes, file, pattern, useAI) {
    let info = { text: '', meta: {}, pages: 0 };
    try { info = await textOf(bytes); } catch (e) { /* Scan ohne Text */ }
    const t = info.text, lines = t.split('\n').map(l => l.trim()).filter(l => l.length >= 4 && /[a-zäöü]{3}/i.test(l));
    const dm = /\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/.exec(t) || /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t);
    const docDate = dm ? (dm[1].length === 4 ? `${dm[1]}-${dm[2]}-${dm[3]}` : `${dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`) : '';
    const nr = (/(?:rechnungs?|beleg|angebots?|auftrags?|kunden)[-\s]*(?:nr|nummer)\.?[:\s]*([A-Z0-9][A-Z0-9/-]{2,20})/i.exec(t) || [])[1] || '';
    let title = String(info.meta.Title || '').trim();
    if (!title || /^(untitled|unbenannt|microsoft word|document)/i.test(title)) title = (lines.find(l => l.length <= 70 && !/^(seite|page|tel|www|http|datum)/i.test(l)) || '').slice(0, 70);
    const kind = /\brechnung\b/i.test(t) ? 'Rechnung' : /\bangebot\b/i.test(t) ? 'Angebot' : /\bvertrag\b/i.test(t) ? 'Vertrag' : /\bkündigung\b/i.test(t) ? 'Kündigung' : /\bbescheid\b/i.test(t) ? 'Bescheid' : '';
    if (useAI && global.WBAI && global.WBAI.info().ready && t.length > 20) {
      try {
        const a = (await global.WBAI.ask({ instructions: 'Du schlägst einen kurzen, sprechenden deutschen Dateinamen für ein Dokument vor. Format: JJJJ-MM-TT Art Absender oder Thema (falls Datum erkennbar), höchstens 8 Wörter, keine Dateiendung, keine Anführungszeichen. Antworte nur mit dem Namen.', messages: [{ role: 'user', text: t.slice(0, 3000) }], maxTokens: 60 })).trim().split('\n')[0];
        if (a) return cleanName(a);
      } catch (e) { /* Muster nutzen */ }
    }
    const titel = title || base(file);
    const v = { name: base(file), datum: docDate || today(), heute: today(), titel, nr: nr && !titel.includes(nr) ? nr : '', art: kind && !titel.toLowerCase().includes(kind.toLowerCase()) ? kind : '', seiten: String(info.pages || '') };
    return cleanName((pattern || '{datum} {titel}').replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m))) || base(file);
  }

  /* ---------- Oberfläche ---------- */
  const STEPS = [
    ['ocr', 'Texterkennung', 'Scans durchsuchbar machen'],
    ['compress', 'Verkleinern', 'Bilder neu komprimieren'],
    ['wm', 'Wasserzeichen', 'Text quer über jede Seite'],
    ['pn', 'Seitenzahlen', 'unten auf jeder Seite'],
    ['pdfa', 'PDF/A', 'für Archiv und Behörden'],
    ['pw', 'Passwort', 'AES-256, zuletzt'],
  ];
  function css() {
    if (document.getElementById('wbb-css')) return;
    const s = document.createElement('style'); s.id = 'wbb-css';
    s.textContent = `.wbb-back{position:fixed;inset:0;z-index:300;background:rgb(10 14 22/.42);display:grid;place-items:center;padding:16px}
.wbb{width:min(820px,100%);max-height:min(92vh,880px);display:flex;flex-direction:column;background:var(--raise,#fff);color:var(--ink,#1b2130);border:1px solid var(--line,#dde1e8);border-radius:16px;box-shadow:0 24px 70px rgb(0 0 0/.3);overflow:hidden;font:14px/1.4 var(--f-ui,var(--f-sans,system-ui,sans-serif))}
.wbb header{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line,#dde1e8)}.wbb header h3{margin:0;font-size:17px;flex:1}
.wbb .x{border:0;background:transparent;font-size:22px;cursor:pointer;color:var(--muted,#5f6878);border-radius:8px;padding:2px 8px}
.wbb main{overflow:auto;padding:12px 18px 16px}.wbb h4{margin:14px 0 8px;font:600 10.5px/1 var(--f-mono,monospace);letter-spacing:.07em;text-transform:uppercase;color:var(--muted,#5f6878)}
.wbb .files{border:1.5px dashed var(--line,#dde1e8);border-radius:12px;padding:8px;max-height:190px;overflow:auto}.wbb .files.drag{border-color:var(--accent,#1f4fd8);background:var(--accent-soft,#e5ebfc)}
.wbb .fl{display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;padding:5px 6px;border-radius:8px;font-size:13px}.wbb .fl:nth-child(odd){background:var(--sunk,#f4f6f9)}.wbb .fl small{color:var(--muted,#5f6878)}.wbb .fl .st{font-size:12px;color:var(--muted,#5f6878)}.wbb .fl .st.ok{color:#1a7f45}.wbb .fl .st.err{color:var(--danger,#c4352b)}
.wbb .steps{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px}
.wbb .step{border:1px solid var(--line,#dde1e8);border-radius:12px;padding:9px 11px}.wbb .step.on{border-color:var(--accent,#1f4fd8);background:var(--accent-soft,#e5ebfc)}
.wbb .step label.h{display:flex;gap:8px;align-items:center;cursor:pointer;font-weight:600}.wbb .step small{display:block;color:var(--muted,#5f6878);font-weight:400;margin-left:24px}
.wbb .opt{display:none;margin:8px 0 0 24px;gap:6px;flex-wrap:wrap}.wbb .step.on .opt{display:flex}
.wbb input:not([type=checkbox]):not([type=radio]),.wbb select{font:inherit;color:var(--ink,#1b2130);background:var(--raise,#fff);border:1px solid var(--line,#dde1e8);border-radius:8px;padding:5px 8px;min-width:0}
.wbb .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.wbb .row label{display:flex;gap:6px;align-items:center}
.wbb .acts{display:flex;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:1px solid var(--line,#dde1e8);align-items:center}.wbb .acts .info{flex:1;color:var(--muted,#5f6878);font-size:12.5px}
.wbb .b{border:1px solid var(--line,#dde1e8);background:var(--raise,#fff);color:inherit;border-radius:10px;padding:9px 14px;cursor:pointer;font:inherit;font-weight:500}.wbb .b.p{background:var(--accent,#1f4fd8);border-color:var(--accent,#1f4fd8);color:var(--accent-ink,#fff)}.wbb .b:disabled{opacity:.5;cursor:default}
.wbb .ib{border:0;background:transparent;color:var(--muted,#5f6878);cursor:pointer;font-size:16px;padding:2px 6px}
@media (max-width:560px){.wbb .fl{grid-template-columns:1fr auto}.wbb .fl .sz{display:none}}`;
    document.head.appendChild(s);
  }
  function open(o = {}) {
    css();
    const files = (o.files || []).map(f => ({ ...f, st: '', cls: '' }));
    const saved = JSON.parse(lsGet('pdfwb.batch') || '{}');
    const has = k => (k === 'ocr' ? !!global.WBTools : k === 'compress' ? !!global.WBTools : k === 'pdfa' ? !!global.WBPdfA : k === 'pw' ? !!global.WBDecrypt : true);
    const opt = {
      ocr: `<select data-o="langs">${Object.entries((global.WBTools && global.WBTools.LANGS) || { 'deu+eng': 'Deutsch und Englisch' }).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>`,
      compress: `<select data-o="level">${Object.entries((global.WBTools && global.WBTools.LEVELS) || {}).map(([k, v]) => `<option value="${k}" ${k === 'medium' ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select>`,
      wm: '<input data-o="text" value="ENTWURF" maxlength="40" style="width:120px"><input data-o="color" type="color" value="#d0342c" style="width:38px;padding:2px">',
      pn: '<select data-o="fmt"><option value="Seite {n} von {N}">Seite 1 von 5</option><option value="{n} / {N}">1 / 5</option><option value="{n}">1</option></select><select data-o="pos"><option value="bc">mittig</option><option value="br">rechts</option></select>',
      pdfa: '<span style="font-size:12px;color:var(--muted)">Schriften werden eingebettet</span>',
      pw: '<input data-o="pw" type="password" placeholder="Passwort" autocomplete="new-password" style="width:150px">',
    };
    const back = document.createElement('div'); back.className = 'wbb-back';
    back.innerHTML = `<div class="wbb" role="dialog" aria-modal="true" aria-label="Stapelverarbeitung"><header><h3>${esc(o.title || 'Stapelverarbeitung')}</h3><button class="x" data-x="close" aria-label="Schließen">×</button></header><main>
      <h4>Dateien</h4><div class="files" data-files></div>
      <div class="row" style="margin-top:6px"><button class="b" data-x="add">+ PDFs hinzufügen</button><span style="font-size:12px;color:var(--muted,#5f6878)">oder hierher ziehen</span></div>
      <h4>Schritte (in dieser Reihenfolge)</h4><div class="steps">${STEPS.filter(([k]) => has(k)).map(([k, n, d]) => `<div class="step${saved[k] ? ' on' : ''}" data-step="${k}"><label class="h"><input type="checkbox" data-s="${k}" ${saved[k] ? 'checked' : ''}>${n}</label><small>${d}</small><div class="opt">${opt[k]}</div></div>`).join('')}</div>
      <h4>Ergebnis</h4>
      <div class="row"><label>Format <select data-g="out"><option value="pdf">PDF</option>${global.WBConvert ? '<option value="docx">Word (.docx)</option><option value="txt">Text (.txt)</option><option value="png">Bilder (PNG, ZIP je Datei)</option>' : ''}</select></label>
        <label><input type="checkbox" data-g="merge"> Alles zu einer PDF zusammenführen</label></div>
      <div class="row" style="margin-top:8px"><label><input type="checkbox" data-g="rename" ${saved.rename ? 'checked' : ''}> Umbenennen nach Inhalt</label>
        <input data-g="pattern" value="${esc(saved.pattern || '{datum} {art} {titel}')}" style="flex:1;min-width:200px" title="Platzhalter: {datum} {titel} {art} {nr} {name} {seiten} {heute}">
        ${global.WBAI && global.WBAI.info().ready ? `<label><input type="checkbox" data-g="ai" ${saved.ai ? 'checked' : ''}> mit KI</label>` : ''}</div>
      <p style="margin:6px 0 0;font-size:12px;color:var(--muted,#5f6878)">Platzhalter: {datum} Datum im Dokument, {titel} Überschrift, {art} Rechnung/Angebot/…, {nr} Rechnungs- oder Belegnummer, {name} alter Name.</p>
    </main><div class="acts"><span class="info" data-info></span><button class="b" data-x="close">Schließen</button>${o.onSave ? `<button class="b" data-x="save" hidden>${esc(o.saveLabel || 'In die Bibliothek')}</button>` : ''}<button class="b" data-x="zip" hidden>Alle herunterladen (ZIP)</button><button class="b p" data-x="go">Starten</button></div></div>`;
    document.body.appendChild(back);
    const $ = s => back.querySelector(s), $$ = s => [...back.querySelectorAll(s)];
    let results = [], running = false;
    const renderFiles = () => {
      $('[data-files]').innerHTML = files.length ? files.map((f, i) => `<div class="fl"><span>${esc(f.name)}${f.out ? `<br><small>→ ${esc(f.out)}</small>` : ''}</span><span class="sz"><small>${fmtMB(f.bytes.length)}</small></span><span class="st ${f.cls}">${f.st ? esc(f.st) : `<button class="ib" data-rm="${i}" title="Entfernen">×</button>`}</span></div>`).join('') : '<p style="margin:10px;color:var(--muted,#5f6878)">Noch keine Dateien.</p>';
      $('[data-info]').textContent = files.length ? `${files.length} ${files.length === 1 ? 'Datei' : 'Dateien'} · ${fmtMB(files.reduce((s, f) => s + f.bytes.length, 0))}` : '';
    };
    renderFiles();
    const addFiles = async list => {
      for (const f of list) { if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') continue; files.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()), st: '', cls: '' }); }
      renderFiles();
    };
    const drop = $('[data-files]');
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('drag'); addFiles([...e.dataTransfer.files]); });
    back.addEventListener('change', e => { const c = e.target.closest('[data-s]'); if (c) c.closest('.step').classList.toggle('on', c.checked); });
    const close = () => { back.remove(); document.removeEventListener('keydown', key, true); };
    const key = e => { if (e.key === 'Escape' && !running) { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', key, true);
    const download = (bytes, name, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 8000); };
    back.addEventListener('click', async e => {
      const rm = e.target.closest('[data-rm]'); if (rm && !running) { files.splice(+rm.dataset.rm, 1); renderFiles(); return; }
      const x = e.target.closest('[data-x]'); if (!x) return;
      if (x.dataset.x === 'close') { if (!running) close(); return; }
      if (x.dataset.x === 'add') { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/pdf,.pdf'; inp.multiple = true; inp.onchange = () => addFiles([...inp.files]); inp.click(); return; }
      if (x.dataset.x === 'zip') { const used = new Set(); download(await global.WBFile.zip(results.map(r => { let n = r.name, k = 2; while (used.has(n)) n = r.name.replace(/(\.\w+)$/, ` (${k++})$1`); used.add(n); return { name: n, bytes: r.bytes }; })).arrayBuffer(), `Stapel ${today()}.zip`, 'application/zip'); return; }
      if (x.dataset.x === 'save') { x.disabled = true; try { await o.onSave(results.filter(r => /\.pdf$/i.test(r.name))); x.textContent = 'Gespeichert ✓'; } catch (er) { x.disabled = false; alert(er.message || er); } return; }
      if (x.dataset.x !== 'go' || running) return;
      if (!files.length) { $('[data-info]').textContent = 'Bitte zuerst PDFs hinzufügen.'; return; }
      const on = Object.fromEntries($$('[data-s]').map(c => [c.dataset.s, c.checked]));
      const ov = k => { const st = $(`[data-step="${k}"]`); return st ? Object.fromEntries([...st.querySelectorAll('[data-o]')].map(i => [i.dataset.o, i.value])) : {}; };
      const g = k => { const el = $(`[data-g="${k}"]`); return el ? (el.type === 'checkbox' ? el.checked : el.value) : null; };
      if (on.pw && (ov('pw').pw || '').length < 4) { $('[data-info]').textContent = 'Das Passwort braucht mindestens 4 Zeichen.'; return; }
      lsSet('pdfwb.batch', JSON.stringify({ ...Object.fromEntries(Object.entries(on).filter(([k]) => k !== 'pw')), rename: g('rename'), pattern: g('pattern'), ai: g('ai') }));
      running = true; x.disabled = true; results = [];
      const out = g('out'), merge = g('merge');
      let done = 0, failed = 0;
      const mergeList = [];
      for (const f of files) {
        try {
          let b = f.bytes;
          const step = (t) => { f.st = t; f.cls = ''; renderFiles(); };
          if (global.WBDecrypt && await global.WBDecrypt.isEncrypted(b)) throw new Error('verschlüsselt');
          if (on.ocr) { step('Texterkennung …'); const r = await global.WBTools.ocr(b, { langs: ov('ocr').langs, onProgress: (d, n, m) => step(m) }); if (r.bytes) b = r.bytes; }
          if (on.compress) { step('Verkleinern …'); const r = await global.WBTools.compress(b, { level: ov('compress').level }); if (r.after < r.before) b = r.bytes; }
          if (on.wm) { step('Wasserzeichen …'); b = await watermark(b, ov('wm')); }
          if (on.pn) { step('Seitenzahlen …'); b = await pageNumbers(b, ov('pn')); }
          if (on.pdfa) { step('PDF/A …'); b = (await global.WBPdfA.make(b, { lang: 'de-DE' })).bytes; }
          let name = base(f.name);
          if (g('rename')) { step('Name wird gesucht …'); name = await guessName(b, f.name, g('pattern'), g('ai')); }
          if (merge) { mergeList.push(b); f.st = 'bereit'; f.cls = 'ok'; renderFiles(); done++; continue; }
          if (on.pw && out === 'pdf') { step('Verschlüsseln …'); b = await global.WBDecrypt.encrypt(b, ov('pw').pw, { print: true, copy: false, edit: false }); }
          if (out === 'pdf') results.push({ name: name + '.pdf', bytes: b });
          else if (out === 'docx') { step('Word …'); results.push({ name: name + '.docx', bytes: new Uint8Array(await (await global.WBConvert.toDocx(b)).arrayBuffer()) }); }
          else if (out === 'txt') { step('Text …'); const t = await global.WBConvert.toText(b); results.push({ name: name + '.txt', bytes: typeof t === 'string' ? new TextEncoder().encode(t) : new Uint8Array(await t.arrayBuffer()) }); }
          else { step('Bilder …'); results.push({ name: name + '.zip', bytes: new Uint8Array(await (await global.WBConvert.toImages(b, { format: 'png' })).arrayBuffer()) }); }
          f.out = results[results.length - 1].name; f.st = '✓ ' + fmtMB(results[results.length - 1].bytes.length); f.cls = 'ok'; done++;
        } catch (er) { console.warn(er); f.st = 'Fehler: ' + (er.message || er).toString().slice(0, 60); f.cls = 'err'; failed++; }
        renderFiles();
      }
      if (merge && mergeList.length) {
        $('[data-info]').textContent = 'Wird zusammengeführt …';
        let b = await global.WBTools.merge(mergeList);
        if (on.pdfa) b = (await global.WBPdfA.make(b, { lang: 'de-DE' })).bytes;
        if (on.pw) b = await global.WBDecrypt.encrypt(b, ov('pw').pw, { print: true, copy: false, edit: false });
        results.push({ name: `Zusammengeführt ${today()}.pdf`, bytes: b });
      }
      running = false; x.disabled = false; x.textContent = 'Erneut starten';
      $('[data-info]').textContent = `${done} fertig${failed ? `, ${failed} mit Fehler` : ''}.`;
      if (results.length === 1) download(results[0].bytes, results[0].name, results[0].name.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
      $('[data-x="zip"]').hidden = results.length < 2;
      const sv = $('[data-x="save"]'); if (sv) sv.hidden = !results.some(r => /\.pdf$/i.test(r.name)) || (on.pw && out === 'pdf');
    });
    if (o.pick && !files.length) setTimeout(() => $('[data-x="add"]').click(), 60);
    return back;
  }
  global.WBBatch = { open, watermark, pageNumbers, guessName, textOf };
})(window);
