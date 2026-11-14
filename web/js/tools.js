/* PDF Werkbank – PDF-Werkzeuge ohne Oberfläche (ab Version 1.7)
 *   WBTools.ocr(bytes, opts)       Texterkennung für Scans: unsichtbare, durchsuchbare Textebene (Tesseract, läuft lokal im Browser)
 *   WBTools.compress(bytes, opts)  PDF verkleinern: Bilder verkleinern und neu komprimieren, ungenutzte Objekte entfernen
 *   WBTools.merge(list)            mehrere PDFs zu einer zusammenfügen
 * Seitengröße, Seitenzahl und Lage der Inhalte bleiben gleich, deshalb passen Markierungen der Werkbank weiter.
 */
(function (global) {
  'use strict';
  const C = () => global.WB_CONFIG || {};
  const PL = () => global.PDFLib;
  const PJ = () => global.pdfjsLib;
  const TV = '5.1.1';

  /* ---------- Texterkennung ---------- */
  let tessP = null;
  function loadTesseract() {
    if (global.Tesseract) return Promise.resolve();
    if (!tessP) tessP = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = (C().ocr && C().ocr.script) || `https://cdn.jsdelivr.net/npm/tesseract.js@${TV}/dist/tesseract.min.js`;
      s.onload = () => res(); s.onerror = () => { tessP = null; rej(new Error('Die Texterkennung konnte nicht geladen werden (offline?).')); };
      document.head.appendChild(s);
    });
    return tessP;
  }
  const abs = u => (u ? new URL(u, location.href).href : undefined);
  let wk = null, wkLangs = '';
  async function makeWorker(langs, onLog, local) {
    const o = local ? (C().ocr || {}) : {};
    const own = !o.localLangs || langs.split('+').every(l => o.localLangs.includes(l));
    let w = null;
    w = await global.Tesseract.createWorker(langs, 1, {
      workerPath: abs(o.workerPath) || `https://cdn.jsdelivr.net/npm/tesseract.js@${TV}/dist/worker.min.js`,
      corePath: abs(o.corePath) || `https://cdn.jsdelivr.net/npm/tesseract.js-core@${TV}`,
      ...(o.langPath && own ? { langPath: abs(o.langPath) } : {}),
      logger: m => { const h = w ? w.__log : onLog; if (h) try { h(m); } catch (e) { /* egal */ } },
    });
    w.__log = onLog;
    return w;
  }
  async function worker(langs, onLog) {
    await loadTesseract();
    if (wk && wkLangs === langs) { wk.__log = onLog; return wk; }
    if (wk) { try { await wk.terminate(); } catch (e) { /* egal */ } wk = null; }
    let w;
    try { w = await makeWorker(langs, onLog, true); }
    catch (e) { if (!C().ocr) throw e; console.warn('Texterkennung lokal nicht verfügbar, nutze CDN', e); w = await makeWorker(langs, onLog, false); }
    wk = w; wkLangs = langs;
    return w;
  }
  const LANGS = { 'deu+eng': 'Deutsch und Englisch', deu: 'Deutsch', eng: 'Englisch', fra: 'Französisch', spa: 'Spanisch', ita: 'Italienisch' };
  /* Seiten, die schon Text haben, überspringen (mode 'auto'); 'all' erkennt jede Seite neu */
  async function ocr(bytes, opts = {}) {
    const { PDFDocument, StandardFonts, pushGraphicsState, popGraphicsState, beginText, endText, setFontAndSize, setTextRenderingMode, TextRenderingMode, setTextMatrix, setCharacterSqueeze, showText } = PL();
    const langs = opts.langs || 'deu+eng', prog = opts.onProgress || (() => {});
    prog(0, 1, 'Texterkennung wird geladen …');
    const w = await worker(langs, m => { if (m.status === 'recognizing text' && opts.onPage) opts.onPage(m.progress); });
    const pdf = await PJ().getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
    const out = await PDFDocument.load(bytes, { updateMetadata: false });
    const font = await out.embedFont(StandardFonts.Helvetica);
    const n = pdf.numPages, pages = out.getPages();
    const want = Array.isArray(opts.pages) ? new Set(opts.pages) : null;
    let done = 0, words = 0, skipped = 0;
    const todo = [];
    for (let i = 0; i < n; i++) if (!want || want.has(i)) todo.push(i);
    for (const i of todo) {
      const page = await pdf.getPage(i + 1);
      if (opts.mode !== 'all') {
        const tc = await page.getTextContent();
        const chars = tc.items.reduce((s, it) => s + (it.str || '').replace(/\s/g, '').length, 0);
        if (chars > 25) { skipped++; done++; prog(done, todo.length, `Seite ${i + 1} hat schon Text`); continue; }
      }
      prog(done, todo.length, `Seite ${i + 1} von ${n} wird gelesen …`);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(4, Math.max(1.5, 2400 / Math.max(base.width, base.height)));
      const vp = page.getViewport({ scale });
      const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const { data } = await w.recognize(c, {}, { blocks: true });
      c.width = c.height = 0;
      const pg = pages[i];
      const key = pg.node.newFontDictionary(font.name, font.ref);
      const ops = [pushGraphicsState()];
      for (const wd of wordsOf(data)) {
        if (wd.confidence < 35) continue;
        const txt = Array.from(wd.text.trim()).filter(ch => { try { font.encodeText(ch); return true; } catch (e) { return false; } }).join('');
        if (!txt) continue;
        const b = wd.bbox, yb = wd.baseline && wd.baseline.y0 != null && wd.baseline.y0 > b.y0 && wd.baseline.y0 <= b.y1 + 2 ? (wd.baseline.y0 + wd.baseline.y1) / 2 : b.y1 - (b.y1 - b.y0) * 0.2;
        const p0 = vp.convertToPdfPoint(b.x0, yb), p1 = vp.convertToPdfPoint(b.x1, yb), pt = vp.convertToPdfPoint(b.x0, b.y0);
        const dx = p1[0] - p0[0], dy = p1[1] - p0[1], len = Math.hypot(dx, dy);
        if (len < 1) continue;
        const cs = dx / len, sn = dy / len;
        const h = Math.max(2, Math.abs((pt[0] - p0[0]) * -sn + (pt[1] - p0[1]) * cs) * 1.25);
        const nat = font.widthOfTextAtSize(txt, h) || 1;
        ops.push(beginText(), setFontAndSize(key, h), setTextRenderingMode(TextRenderingMode.Invisible), setCharacterSqueeze(Math.max(10, Math.min(400, len / nat * 100))), setTextMatrix(cs, sn, -sn, cs, p0[0], p0[1]), showText(font.encodeText(txt + ' ')), endText());
        words++;
      }
      ops.push(popGraphicsState());
      if (ops.length > 2) pg.pushOperators(...ops);
      done++; prog(done, todo.length, `Seite ${i + 1} erkannt`);
    }
    pdf.destroy();
    if (words === 0) return { bytes: null, words, skipped, pages: todo.length };
    return { bytes: await out.save({ useObjectStreams: true }), words, skipped, pages: todo.length };
  }
  function wordsOf(data) {
    if (data.words && data.words.length) return data.words;
    const out = [];
    for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || []) out.push({ ...w, baseline: w.baseline || l.baseline });
    return out;
  }
  async function stopOcr() { if (wk) { try { await wk.terminate(); } catch (e) { /* egal */ } wk = null; } }

  /* ---------- PDF verkleinern ---------- */
  const LEVELS = {
    light: { label: 'Leicht (beste Qualität)', max: 2600, q: 0.85 },
    medium: { label: 'Mittel (empfohlen)', max: 1800, q: 0.72 },
    strong: { label: 'Stark (kleinste Datei)', max: 1150, q: 0.56 },
  };
  async function inflate(u8) {
    const ds = new DecompressionStream('deflate');
    const buf = await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(buf);
  }
  /* PNG-Prädiktoren (Predictor ≥ 10) zurückrechnen */
  function unpredict(raw, colors, cols) {
    const bpr = colors * cols, out = new Uint8Array(Math.floor(raw.length / (bpr + 1)) * bpr);
    let prev = new Uint8Array(bpr);
    for (let r = 0, ip = 0, op = 0; ip + bpr < raw.length + 1 && op < out.length; r++) {
      const t = raw[ip++], line = out.subarray(op, op + bpr);
      for (let i = 0; i < bpr; i++) {
        const x = raw[ip + i], a = i >= colors ? line[i - colors] : 0, b = prev[i], c = i >= colors ? prev[i - colors] : 0;
        let v;
        if (t === 0) v = x; else if (t === 1) v = x + a; else if (t === 2) v = x + b; else if (t === 3) v = x + ((a + b) >> 1);
        else { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
        line[i] = v & 255;
      }
      ip += bpr; op += bpr; prev = line;
    }
    return out;
  }
  async function compress(bytes, opts = {}) {
    const { PDFDocument, PDFName, PDFRawStream, PDFDict, PDFArray, PDFRef, PDFNumber, PDFStream } = PL();
    const L = LEVELS[opts.level] || LEVELS.medium, prog = opts.onProgress || (() => {});
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const ctx = doc.context, N = s => PDFName.of(s);
    const look = v => (v instanceof PDFRef ? ctx.lookup(v) : v);
    const objs = ctx.enumerateIndirectObjects();
    // Bilder, die als Maske dienen, bleiben unverändert
    const masks = new Set();
    for (const [, o] of objs) if (o instanceof PDFStream && o.dict.get(N('Subtype')) === N('Image')) { const m = o.dict.get(N('SMask')); if (m instanceof PDFRef) masks.add(m.toString()); }
    const imgs = objs.filter(([r, o]) => o instanceof PDFRawStream && o.dict.get(N('Subtype')) === N('Image') && !masks.has(r.toString()));
    let changed = 0, k = 0;
    for (const [ref, o] of imgs) {
      k++; prog(k, imgs.length, `Bild ${k} von ${imgs.length}`);
      try {
        const d = o.dict;
        if (look(d.get(N('ImageMask'))) && String(look(d.get(N('ImageMask')))) === 'true') continue;
        if (look(d.get(N('Mask'))) instanceof PDFArray || d.get(N('Decode'))) continue;
        const w = look(d.get(N('Width'))).asNumber(), h = look(d.get(N('Height'))).asNumber();
        const bpc = d.get(N('BitsPerComponent')) ? look(d.get(N('BitsPerComponent'))).asNumber() : 8;
        let f = look(d.get(N('Filter')));
        if (f instanceof PDFArray) { if (f.size() !== 1) continue; f = look(f.get(0)); }
        const filter = f ? f.toString() : '';
        let cs = look(d.get(N('ColorSpace'))), comps = 0;
        if (cs === N('DeviceGray')) comps = 1; else if (cs === N('DeviceRGB')) comps = 3;
        else if (cs instanceof PDFArray && look(cs.get(0)) === N('ICCBased')) { const icc = look(cs.get(1)); const nn = icc && icc.dict && look(icc.dict.get(N('N'))); comps = nn ? nn.asNumber() : 0; }
        if (comps !== 1 && comps !== 3) continue;
        if (w * h < 120 * 120) continue;
        const sc = Math.min(1, L.max / Math.max(w, h));
        let bmp;
        if (filter === '/DCTDecode') {
          if (sc > 0.98 && o.contents.length < 60000) continue;
          bmp = await createImageBitmap(new Blob([o.contents], { type: 'image/jpeg' }));
        } else if (filter === '/FlateDecode' && bpc === 8) {
          let raw = await inflate(o.contents);
          const dp = look(d.get(N('DecodeParms')));
          const pred = dp instanceof PDFDict && dp.get(N('Predictor')) ? look(dp.get(N('Predictor'))).asNumber() : 1;
          if (pred >= 10) raw = unpredict(raw, comps, w); else if (pred !== 1) continue;
          if (raw.length < w * h * comps) continue;
          const id = new ImageData(w, h), px = id.data;
          for (let i = 0, j = 0; i < w * h; i++, j += comps) { const r = raw[j], g = comps === 3 ? raw[j + 1] : r, b = comps === 3 ? raw[j + 2] : r; px[i * 4] = r; px[i * 4 + 1] = g; px[i * 4 + 2] = b; px[i * 4 + 3] = 255; }
          bmp = await createImageBitmap(id);
        } else continue;
        const W = Math.max(1, Math.round(w * sc)), H = Math.max(1, Math.round(h * sc));
        const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, W, H); cx.imageSmoothingQuality = 'high'; cx.drawImage(bmp, 0, 0, W, H);
        bmp.close && bmp.close();
        const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', L.q));
        cv.width = cv.height = 0;
        const jpg = new Uint8Array(await blob.arrayBuffer());
        if (jpg.length >= o.contents.length * 0.9) continue;
        const nd = ctx.obj({});
        for (const [key, val] of d.entries()) if (!['/Filter', '/DecodeParms', '/Length', '/Width', '/Height', '/BitsPerComponent', '/ColorSpace'].includes(key.toString())) nd.set(key, val);
        nd.set(N('Width'), PDFNumber.of(W)); nd.set(N('Height'), PDFNumber.of(H)); nd.set(N('BitsPerComponent'), PDFNumber.of(8));
        nd.set(N('ColorSpace'), N('DeviceRGB')); nd.set(N('Filter'), N('DCTDecode')); nd.set(N('Length'), PDFNumber.of(jpg.length));
        ctx.assign(ref, PDFRawStream.of(nd, jpg));
        changed++;
      } catch (e) { console.warn('Bild übersprungen', e); }
    }
    // ungenutzte Objekte (z. B. Reste früherer Bearbeitungen) entfernen
    const keep = new Set(), stack = [];
    const add = v => { if (v instanceof PDFRef) { const s = v.toString(); if (!keep.has(s)) { keep.add(s); stack.push(ctx.lookup(v)); } } else if (v) stack.push(v); };
    add(ctx.trailerInfo.Root); add(ctx.trailerInfo.Info); add(ctx.trailerInfo.Encrypt);
    let guard = 0;
    while (stack.length && guard++ < 2e6) {
      const v = stack.pop();
      if (v instanceof PDFDict) for (const [, x] of v.entries()) add(x);
      else if (v instanceof PDFArray) for (let i = 0; i < v.size(); i++) add(v.get(i));
      else if (v instanceof PDFStream) for (const [, x] of v.dict.entries()) add(x);
    }
    let removed = 0;
    if (guard < 2e6) for (const [r] of ctx.enumerateIndirectObjects()) if (!keep.has(r.toString())) { ctx.delete(r); removed++; }
    prog(imgs.length, imgs.length, 'Wird gespeichert …');
    const outBytes = await doc.save({ useObjectStreams: true });
    return { bytes: outBytes, before: bytes.length, after: outBytes.length, images: changed, removed };
  }

  /* ---------- Zusammenführen ---------- */
  async function merge(list) {
    const { PDFDocument } = PL();
    const out = await PDFDocument.create();
    for (const b of list) {
      const src = await PDFDocument.load(b, { updateMetadata: false });
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach(p => out.addPage(p));
    }
    return out.save({ useObjectStreams: true });
  }

  const fmtMB = n => (n / 1048576 >= 0.1 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' kB');
  global.WBTools = { ocr, stopOcr, compress, merge, LEVELS, LANGS, fmtMB, loadTesseract };
})(window);
