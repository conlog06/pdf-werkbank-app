/* PDF Werkbank – PDF umwandeln (ab Version 1.8)
 *   WBConvert.toDocx(bytes, opts)    Word-Dokument: Absätze, Überschriften, fett, Seitenumbrüche, Scans als Bilder
 *   WBConvert.toXlsx(bytes, opts)    Excel-Mappe: ein Blatt pro Seite, Spalten aus der Textlage, Zahlen als Zahlen
 *   WBConvert.toImages(bytes, opts)  ZIP mit allen Seiten als PNG oder JPG
 *   WBConvert.toText(bytes)          reiner Text
 * Alles läuft lokal im Browser (pdf.js liest den Text, die Dateien werden selbst zusammengesetzt).
 */
(function (global) {
  'use strict';
  const PJ = () => global.pdfjsLib;
  const xe = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const enc = new TextEncoder();
  const zip = files => global.WBFile.zip(files.map(f => ({ name: f.name, bytes: typeof f.data === 'string' ? enc.encode(f.data) : f.data })), 'application/octet-stream');

  /* ---------- Text mit Lage lesen ---------- */
  async function linesOf(page) {
    const vp = page.getViewport({ scale: 1 }), tc = await page.getTextContent();
    const styles = tc.styles || {};
    const items = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const tx = PJ().Util.transform(vp.transform, it.transform);
      const size = Math.hypot(tx[2], tx[3]) || 10;
      if (Math.abs(tx[1]) > Math.abs(tx[0]) * 0.3) continue; // gedrehter Text
      const fam = (styles[it.fontName] && styles[it.fontName].fontFamily) || '';
      items.push({ s: it.str, x: tx[4], y: tx[5], w: it.width * (vp.scale || 1), size, bold: /bold|black|heavy|semibold|-bd/i.test(it.fontName + ' ' + fam) });
    }
    items.sort((a, b) => a.y - b.y || a.x - b.x);
    const lines = [];
    for (const it of items) {
      const l = lines.find(L => Math.abs(L.y - it.y) < Math.max(L.size, it.size) * 0.45);
      if (l) { l.items.push(it); l.size = Math.max(l.size, it.size); } else lines.push({ y: it.y, size: it.size, items: [it] });
    }
    for (const l of lines) {
      l.items.sort((a, b) => a.x - b.x);
      l.x = l.items[0].x; l.x1 = Math.max(...l.items.map(i => i.x + i.w));
      // Stücke: großer Abstand trennt Spalten
      l.chunks = [];
      for (const it of l.items) {
        const c = l.chunks[l.chunks.length - 1];
        if (c && it.x - c.x1 < it.size * 1.4) { c.s += (it.x - c.x1 > it.size * 0.18 && !/\s$/.test(c.s) && !/^\s/.test(it.s) ? ' ' : '') + it.s; c.x1 = it.x + it.w; c.bold = c.bold && it.bold; }
        else l.chunks.push({ s: it.s, x: it.x, x1: it.x + it.w, bold: it.bold, size: it.size });
      }
      l.text = l.chunks.map(c => c.s).join('\t').replace(/\s+/g, m => (m.includes('\t') ? '\t' : ' ')).trim();
      l.bold = l.items.every(i => i.bold);
    }
    lines.sort((a, b) => a.y - b.y);
    return { lines, w: vp.width, h: vp.height };
  }
  const median = arr => { if (!arr.length) return 10; const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

  /* Absätze: Zeilen mit ähnlichem Abstand und Einzug gehören zusammen */
  function paragraphs(lines, body) {
    const out = [];
    let cur = null;
    for (const l of lines) {
      const head = l.size > body * 1.18 && l.text.length < 140;
      const bullet = /^([•▪◦‣–\-*]|\d{1,2}[.)]|[a-z][.)])\s/.test(l.text), tab = l.chunks.length > 1;
      if (cur && !head && !cur.head && !bullet && !tab && !cur.tab && Math.abs(l.size - cur.size) < 1 && l.y - cur.lastY < l.size * 1.75 && Math.abs(l.x - cur.x) < l.size * 3) {
        const prev = cur.text;
        cur.text = /[a-zäöüß]-$/i.test(prev) && /^[a-zäöüß]/.test(l.text) ? prev.slice(0, -1) + l.text.replace(/\t/g, ' ') : prev + ' ' + l.text.replace(/\t/g, ' ');
        cur.lastY = l.y; cur.bold = cur.bold && l.bold;
        continue;
      }
      cur = { text: head ? l.text.replace(/\t/g, ' ') : l.text, size: l.size, x: l.x, lastY: l.y, head, bullet, tab: tab && !head, cells: l.chunks.map(c => c.s.trim()), bold: l.bold };
      out.push(cur);
    }
    return out;
  }

  async function renderJpeg(page, scale, q = 0.82) {
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: x, viewport: vp }).promise;
    const b = await new Promise(r => c.toBlob(r, 'image/jpeg', q));
    const w = c.width, h = c.height; c.width = c.height = 0;
    return { bytes: new Uint8Array(await b.arrayBuffer()), w, h };
  }

  /* ---------- Word ---------- */
  async function toDocx(bytes, o = {}) {
    const prog = o.onProgress || (() => {});
    const pdf = await PJ().getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) { prog(i - 1, pdf.numPages); const pg = await pdf.getPage(i); pages.push({ pg, ...(await linesOf(pg)) }); }
    const body = median(pages.flatMap(p => p.lines.map(l => Math.round(l.size * 2) / 2)));
    const sizes = [...new Set(pages.flatMap(p => p.lines.filter(l => l.size > body * 1.18).map(l => Math.round(l.size))))].sort((a, b) => b - a);
    const level = s => { const i = sizes.indexOf(Math.round(s)); return i < 0 ? 0 : Math.min(3, i + 1); };
    const media = [];
    let xml = '';
    const run = (t, { b, sz } = {}) => `<w:r><w:rPr>${b ? '<w:b/>' : ''}${sz ? `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>` : ''}</w:rPr>${t.split('\t').map((part, i) => (i ? '<w:tab/>' : '') + `<w:t xml:space="preserve">${xe(part)}</w:t>`).join('')}</w:r>`;
    for (let k = 0; k < pages.length; k++) {
      const P = pages[k];
      prog(k, pages.length, 'Seite ' + (k + 1));
      const chars = P.lines.reduce((n, l) => n + l.text.length, 0);
      if (chars < 25 && o.images !== false) {
        // Scan oder Bildseite: als Bild übernehmen
        const img = await renderJpeg(P.pg, 2);
        const id = media.length + 1; media.push({ name: `image${id}.jpeg`, bytes: img.bytes });
        const cxMax = 6120000, cx = Math.min(cxMax, Math.round(P.w * 12700)), cy = Math.round(cx * img.h / img.w);
        xml += `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Seite ${k + 1}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="image${id}.jpeg"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rImg${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
      } else {
        const pars = paragraphs(P.lines, body);
        for (let j = 0; j < pars.length; j++) {
          const par = pars[j];
          if (par.tab) {
            // Zeilen mit Spalten werden eine Word-Tabelle
            const rows = []; while (j < pars.length && pars[j].tab) rows.push(pars[j++]); j--;
            const n = Math.max(...rows.map(r => r.cells.length));
            const bd = '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="BFBFBF"/><w:left w:val="single" w:sz="4" w:color="BFBFBF"/><w:bottom w:val="single" w:sz="4" w:color="BFBFBF"/><w:right w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideH w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideV w:val="single" w:sz="4" w:color="BFBFBF"/></w:tblBorders>';
            xml += `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>${bd}</w:tblPr><w:tblGrid>${'<w:gridCol/>'.repeat(n)}</w:tblGrid>` + rows.map(r => `<w:tr>${Array.from({ length: n }, (_, k) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p>${r.cells[k] ? run(r.cells[k], { b: r.bold }) : ''}</w:p></w:tc>`).join('')}</w:tr>`).join('') + '</w:tbl><w:p/>';
            continue;
          }
          const lv = par.head ? level(par.size) : 0;
          const sz = Math.round(par.size * 2);
          if (lv) xml += `<w:p><w:pPr><w:pStyle w:val="Heading${lv}"/></w:pPr>${run(par.text, { sz })}</w:p>`;
          else if (par.bullet) xml += `<w:p><w:pPr><w:ind w:left="360" w:hanging="360"/></w:pPr>${run(par.text, { b: par.bold, sz: Math.abs(par.size - body) > 0.8 ? sz : 0 })}</w:p>`;
          else xml += `<w:p>${run(par.text, { b: par.bold, sz: Math.abs(par.size - body) > 0.8 ? sz : 0 })}</w:p>`;
        }
      }
      if (k < pages.length - 1) xml += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    }
    pdf.destroy();
    const W = pages[0] ? pages[0].w : 595, H = pages[0] ? pages[0].h : 842;
    const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${xml}<w:sectPr><w:pgSz w:w="${Math.round(W * 20)}" w:h="${Math.round(H * 20)}"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    const half = Math.round(body * 2);
    const hs = (n, sz) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${n === 1 ? 360 : 240}" w:after="120"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${sz}"/></w:rPr></w:style>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="${half || 22}"/><w:lang w:val="de-DE"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${hs(1, 32)}${hs(2, 28)}${hs(3, 24)}</w:styles>`;
    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${media.map((m, i) => `<Relationship Id="rImg${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name}"/>`).join('')}</Relationships>`;
    const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
    const root = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
    const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xe(o.title || '')}</dc:title><dc:creator>PDF Werkbank</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`;
    prog(pages.length, pages.length);
    const blob = zip([{ name: '[Content_Types].xml', data: ct }, { name: '_rels/.rels', data: root }, { name: 'docProps/core.xml', data: core }, { name: 'word/document.xml', data: doc }, { name: 'word/styles.xml', data: styles }, { name: 'word/_rels/document.xml.rels', data: rels }, ...media.map(m => ({ name: 'word/media/' + m.name, data: m.bytes }))]);
    return new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  /* ---------- Excel ---------- */
  const NUM_DE = /^[-+]?(\d{1,3}(\.\d{3})+|\d+)(,\d+)?\s?(€|%)?$/, NUM_EN = /^[-+]?\d+(\.\d+)?$/;
  function cellVal(s) {
    const t = s.trim();
    if (NUM_DE.test(t)) { const n = parseFloat(t.replace(/[€%\s]/g, '').replace(/\./g, '').replace(',', '.')); if (isFinite(n)) return { n: t.endsWith('%') ? n / 100 : n, pct: t.endsWith('%'), eur: t.endsWith('€') }; }
    if (NUM_EN.test(t) && !/^0\d/.test(t)) return { n: parseFloat(t) };
    return { s: t };
  }
  const colName = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  async function toXlsx(bytes, o = {}) {
    const prog = o.onProgress || (() => {});
    const pdf = await PJ().getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
    const sheets = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      prog(i - 1, pdf.numPages);
      const { lines } = await linesOf(await pdf.getPage(i));
      // Spaltenanker: Anfänge aller Stücke bündeln
      const xs = lines.flatMap(l => l.chunks.map(c => c.x)).sort((a, b) => a - b), cols = [];
      for (const x of xs) { const c = cols[cols.length - 1]; if (c && x - c.max < 9) { c.max = x; c.n++; } else cols.push({ min: x, max: x, n: 1 }); }
      const anchors = cols.filter(c => c.n >= Math.max(2, lines.length * 0.08) || cols.length < 12).map(c => c.min);
      if (!anchors.length) anchors.push(0);
      const colOf = x => { let best = 0; for (let k = 0; k < anchors.length; k++) if (x >= anchors[k] - 6) best = k; return best; };
      const rows = lines.map(l => { const r = []; for (const c of l.chunks) { const k = colOf(c.x); r[k] = r[k] ? r[k] + ' ' + c.s.trim() : c.s.trim(); } return { cells: r, bold: l.bold }; });
      sheets.push({ name: 'Seite ' + i, rows, ncol: anchors.length });
    }
    pdf.destroy();
    const sheetXml = sh => {
      const widths = Array.from({ length: sh.ncol }, (_, k) => Math.min(60, Math.max(8, ...sh.rows.map(r => (r.cells[k] || '').length + 2))));
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${widths.map((w, k) => `<col min="${k + 1}" max="${k + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${sh.rows.map((r, ri) => `<row r="${ri + 1}">${r.cells.map((v, k) => {
        if (v == null || v === '') return '';
        const ref = colName(k) + (ri + 1), c = cellVal(v), st = r.bold ? 1 : c.eur ? 2 : c.pct ? 3 : 0;
        return c.n != null ? `<c r="${ref}"${st ? ` s="${st}"` : ''}><v>${c.n}</v></c>` : `<c r="${ref}" t="inlineStr"${st ? ` s="${st}"` : ''}><is><t xml:space="preserve">${xe(c.s)}</t></is></c>`;
      }).join('')}</row>`).join('')}</sheetData></worksheet>`;
    };
    const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xe(s.name)}" sheetId="${i + 1}" r:id="rS${i + 1}"/>`).join('')}</sheets></workbook>`;
    const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rS${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;€&quot;"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
    const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
    const root = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
    prog(sheets.length, sheets.length);
    const blob = zip([{ name: '[Content_Types].xml', data: ct }, { name: '_rels/.rels', data: root }, { name: 'xl/workbook.xml', data: wb }, { name: 'xl/_rels/workbook.xml.rels', data: wbRels }, { name: 'xl/styles.xml', data: styles }, ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) }))]);
    return new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  /* ---------- Bilder ---------- */
  async function toImages(bytes, o = {}) {
    const prog = o.onProgress || (() => {}), fmt = o.format === 'jpeg' ? 'jpeg' : 'png', scale = (o.dpi || 150) / 72;
    const pdf = await PJ().getDocument({ data: bytes.slice(), isEvalSupported: false }).promise, files = [], base = (o.name || 'Seite').replace(/[\\/:*?"<>|]/g, '-');
    for (let i = 1; i <= pdf.numPages; i++) {
      prog(i - 1, pdf.numPages);
      const pg = await pdf.getPage(i), vp = pg.getViewport({ scale });
      const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      await pg.render({ canvasContext: x, viewport: vp }).promise;
      const b = await new Promise(r => c.toBlob(r, 'image/' + fmt, 0.9)); c.width = c.height = 0;
      files.push({ name: `${base} ${String(i).padStart(String(pdf.numPages).length, '0')}.${fmt === 'jpeg' ? 'jpg' : 'png'}`, data: new Uint8Array(await b.arrayBuffer()) });
    }
    pdf.destroy();
    prog(1, 1);
    return new Blob([zip(files)], { type: 'application/zip' });
  }
  async function toText(bytes) {
    const pdf = await PJ().getDocument({ data: bytes.slice(), isEvalSupported: false }).promise, out = [];
    for (let i = 1; i <= pdf.numPages; i++) { const { lines } = await linesOf(await pdf.getPage(i)); out.push(lines.map(l => l.text.replace(/\t/g, '    ')).join('\n')); }
    pdf.destroy();
    return out.join('\n\n\f');
  }

  /* Tabelle lesen (CSV, TSV oder Excel .xlsx) → { cols: [..], rows: [{ Spalte: Wert }] } – für Serienbriefe */
  function parseCsv(text) {
    text = text.replace(/^\uFEFF/, '');
    const first = text.split(/\r?\n/)[0] || '';
    const sep = [';', '\t', ',', '|'].map(c => [c, first.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
      if (ch === '"' && !cell) q = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(c => c.trim())) rows.push(row); row = []; }
      else cell += ch;
    }
    row.push(cell); if (row.some(c => c.trim())) rows.push(row);
    return rows;
  }
  async function parseXlsx(u8) {
    const files = await global.WBFile.unzip(u8), dec = new TextDecoder();
    const xml = n => (files.get(n) ? new DOMParser().parseFromString(dec.decode(files.get(n)), 'application/xml') : null);
    const ss = xml('xl/sharedStrings.xml'), strings = ss ? [...ss.getElementsByTagName('si')].map(si => [...si.getElementsByTagName('t')].map(t => t.textContent).join('')) : [];
    const wb = xml('xl/workbook.xml'), rels = xml('xl/_rels/workbook.xml.rels');
    let sheet = 'xl/worksheets/sheet1.xml';
    try { const first = wb.getElementsByTagName('sheet')[0], rid = first.getAttribute('r:id') || first.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'); const rel = [...rels.getElementsByTagName('Relationship')].find(r => r.getAttribute('Id') === rid); if (rel) sheet = 'xl/' + rel.getAttribute('Target').replace(/^\/?xl\//, ''); } catch (e) { /* Standardblatt */ }
    const sh = xml(sheet); if (!sh) throw new Error('Kein Tabellenblatt gefunden.');
    const colIdx = ref => { const m = /^([A-Z]+)/.exec(ref || ''); if (!m) return -1; let n = 0; for (const c of m[1]) n = n * 26 + c.charCodeAt(0) - 64; return n - 1; };
    const rows = [];
    for (const r of sh.getElementsByTagName('row')) {
      const row = [];
      for (const c of r.getElementsByTagName('c')) {
        const i = colIdx(c.getAttribute('r')), t = c.getAttribute('t'), v = c.getElementsByTagName('v')[0], is = c.getElementsByTagName('is')[0];
        let val = t === 's' ? strings[+(v && v.textContent)] : t === 'inlineStr' ? (is ? is.textContent : '') : v ? v.textContent : '';
        if (t !== 's' && t !== 'inlineStr' && t !== 'str' && /^-?\d+(\.\d+)?(E-?\d+)?$/i.test(val)) { const n = +val; val = Number.isInteger(n) ? String(n) : n.toLocaleString('de-DE', { maximumFractionDigits: 6 }); }
        row[i >= 0 ? i : row.length] = val == null ? '' : String(val);
      }
      for (let k = 0; k < row.length; k++) if (row[k] == null) row[k] = '';
      if (row.some(c => String(c).trim())) rows.push(row);
    }
    return rows;
  }
  async function readTable(file) {
    const u8 = new Uint8Array(await file.arrayBuffer());
    let grid;
    if (/\.xlsx$/i.test(file.name) || (u8[0] === 0x50 && u8[1] === 0x4b)) grid = await parseXlsx(u8);
    else { let t = new TextDecoder('utf-8', { fatal: true }); let text; try { text = t.decode(u8); } catch (e) { text = new TextDecoder('windows-1252').decode(u8); } grid = parseCsv(text); }
    if (grid.length < 2) throw new Error('Die Tabelle braucht eine Kopfzeile und mindestens eine Datenzeile.');
    const cols = grid[0].map((c, i) => String(c || '').trim() || `Spalte ${i + 1}`);
    const rows = grid.slice(1).map(r => Object.fromEntries(cols.map((c, i) => [c, String(r[i] == null ? '' : r[i]).trim()])));
    return { cols, rows };
  }
  global.WBConvert = { toDocx, toXlsx, toImages, toText, readTable, parseCsv, _linesOf: linesOf };
})(window);
