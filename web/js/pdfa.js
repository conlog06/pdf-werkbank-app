/* PDF Werkbank – PDF/A (Langzeitarchiv) und Vorabprüfung (ab Version 1.9)
 *   WBPdfA.make(bytes, opts)   → { bytes, part, issues }  PDF/A-2b, mit Anhängen PDF/A-3b
 *        opts: { title, author, subject, keywords, lang, part, attachments: [{ name, bytes, mime, desc, rel }], fx: { level, file } }
 *   WBPdfA.preflight(bytes)    → { fonts, encrypted, js, cmyk, annotsNoAp, attachments, issues }
 * Nicht eingebettete Standardschriften (Helvetica, Times, Courier) werden durch maßgleiche, freie Schriften
 * (Liberation, als „WB Sans/Serif/Mono“) ersetzt und eingebettet. Farbprofil: sRGB (Compact ICC, CC0).
 */
(function (global) {
  'use strict';
  const PL = () => global.PDFLib;
  const ICC_B64 = 'AAAByGxjbXMCEAAAbW50clJHQiBYWVogB+IAAwAUAAkADgAdYWNzcE1TRlQAAAAAc2F3c2N0cmwAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1oYW5knZEAPUCAsD1AdCyBnqUijgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJZGVzYwAAAPAAAABfY3BydAAAAQwAAAAMd3RwdAAAARgAAAAUclhZWgAAASwAAAAUZ1hZWgAAAUAAAAAUYlhZWgAAAVQAAAAUclRSQwAAAWgAAABgZ1RSQwAAAWgAAABgYlRSQwAAAWgAAABgZGVzYwAAAAAAAAAFdVJHQgAAAAAAAAAAAAAAAHRleHQAAAAAQ0MwAFhZWiAAAAAAAADzVAABAAAAARbJWFlaIAAAAAAAAG+gAAA48gAAA49YWVogAAAAAAAAYpYAALeJAAAY2lhZWiAAAAAAAAAkoAAAD4UAALbEY3VydgAAAAAAAAAqAAAAfAD4AZwCdQODBMkGTggSChgMYg70Ec8U9hhqHC4gQySsKWoufjPrObM/1kZXTTZUdlwXZB1shnVWfo2ILJI2nKunjLLbvpnKx9dl5Hfx+f//';
  const WIN_NAMES = 'space exclam quotedbl numbersign dollar percent ampersand quotesingle parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore grave a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde uni007F Euro - quotesinglbase florin quotedblbase ellipsis dagger daggerdbl circumflex perthousand Scaron guilsinglleft OE - Zcaron - - quoteleft quoteright quotedblleft quotedblright bullet endash emdash tilde trademark scaron guilsinglright oe - zcaron Ydieresis uni00A0 exclamdown cent sterling currency yen brokenbar section dieresis copyright ordfeminine guillemotleft logicalnot uni00AD registered macron degree plusminus uni00B2 uni00B3 acute mu paragraph periodcentered cedilla uni00B9 ordmasculine guillemotright onequarter onehalf threequarters questiondown Agrave Aacute Acircumflex Atilde Adieresis Aring AE Ccedilla Egrave Eacute Ecircumflex Edieresis Igrave Iacute Icircumflex Idieresis Eth Ntilde Ograve Oacute Ocircumflex Otilde Odieresis multiply Oslash Ugrave Uacute Ucircumflex Udieresis Yacute Thorn germandbls agrave aacute acircumflex atilde adieresis aring ae ccedilla egrave eacute ecircumflex edieresis igrave iacute icircumflex idieresis eth ntilde ograve oacute ocircumflex otilde odieresis divide oslash ugrave uacute ucircumflex udieresis yacute thorn ydieresis'.split(' ');
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const C = () => global.WB_CONFIG || {};
  const STD = {
    Helvetica: 'Sans-Regular', 'Helvetica-Bold': 'Sans-Bold', 'Helvetica-Oblique': 'Sans-Italic', 'Helvetica-BoldOblique': 'Sans-BoldItalic',
    'Times-Roman': 'Serif-Regular', 'Times-Bold': 'Serif-Bold', 'Times-Italic': 'Serif-Italic', 'Times-BoldItalic': 'Serif-BoldItalic',
    Courier: 'Mono-Regular', 'Courier-Bold': 'Mono-Bold', 'Courier-Oblique': 'Mono-Italic', 'Courier-BoldOblique': 'Mono-BoldItalic',
    Arial: 'Sans-Regular', 'Arial,Bold': 'Sans-Bold', 'Arial,Italic': 'Sans-Italic', 'Arial,BoldItalic': 'Sans-BoldItalic', ArialMT: 'Sans-Regular', 'Arial-BoldMT': 'Sans-Bold', 'Arial-ItalicMT': 'Sans-Italic', 'Arial-BoldItalicMT': 'Sans-BoldItalic',
    TimesNewRoman: 'Serif-Regular', 'TimesNewRoman,Bold': 'Serif-Bold', 'TimesNewRoman,Italic': 'Serif-Italic', 'TimesNewRoman,BoldItalic': 'Serif-BoldItalic', TimesNewRomanPSMT: 'Serif-Regular', 'TimesNewRomanPS-BoldMT': 'Serif-Bold', 'TimesNewRomanPS-ItalicMT': 'Serif-Italic', 'TimesNewRomanPS-BoldItalicMT': 'Serif-BoldItalic',
    CourierNew: 'Mono-Regular', 'CourierNew,Bold': 'Mono-Bold', CourierNewPSMT: 'Mono-Regular', 'CourierNewPS-BoldMT': 'Mono-Bold',
  };
  const NAME2U = (() => { const m = new Map(), dec = new TextDecoder('windows-1252'); WIN_NAMES.forEach((n, i) => { if (n !== '-') m.set(n, dec.decode(new Uint8Array([i + 32])).codePointAt(0)); }); m.set('quoteright', 0x2019); m.set('quoteleft', 0x2018); m.set('minus', 0x2212); m.set('fi', 0xfb01); m.set('fl', 0xfb02); return m; })();
  const uOfName = n => (NAME2U.has(n) ? NAME2U.get(n) : /^uni([0-9A-F]{4})$/i.test(n) ? parseInt(n.slice(3), 16) : /^u([0-9A-F]{4,6})$/i.test(n) ? parseInt(n.slice(1), 16) : null);

  /* ---------- kleine TrueType-Auswertung ---------- */
  function ttf(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), n = dv.getUint16(4), T = {};
    for (let i = 0; i < n; i++) { const o = 12 + i * 16; T[String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3])] = dv.getUint32(o + 8); }
    const upm = dv.getUint16(T.head + 18), bbox = [0, 2, 4, 6].map(k => dv.getInt16(T.head + 36 + k));
    const asc = dv.getInt16(T.hhea + 4), desc = dv.getInt16(T.hhea + 6), nh = dv.getUint16(T.hhea + 34);
    const adv = g => dv.getUint16(T.hmtx + 4 * Math.min(g, nh - 1));
    let cap = Math.round(asc * 0.7);
    if (T['OS/2'] && dv.getUint16(T['OS/2']) >= 2) cap = dv.getInt16(T['OS/2'] + 88);
    const italic = T.post ? dv.getInt32(T.post + 4) / 65536 : 0, fixed = T.post ? dv.getUint32(T.post + 12) !== 0 : false;
    // cmap 3/1 Format 4
    let sub = 0; const cn = dv.getUint16(T.cmap + 2);
    for (let i = 0; i < cn; i++) { const o = T.cmap + 4 + i * 8; if (dv.getUint16(o) === 3 && dv.getUint16(o + 2) === 1) sub = T.cmap + dv.getUint32(o + 4); }
    const glyph = cp => {
      if (!sub || dv.getUint16(sub) !== 4) return 0;
      const segX2 = dv.getUint16(sub + 6), ends = sub + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
      for (let i = 0; i < segX2 / 2; i++) {
        if (cp > dv.getUint16(ends + i * 2)) continue;
        const st = dv.getUint16(starts + i * 2); if (cp < st) return 0;
        const ro = dv.getUint16(ranges + i * 2), d = dv.getUint16(deltas + i * 2);
        if (!ro) return (cp + d) & 0xffff;
        const g = dv.getUint16(ranges + i * 2 + ro + (cp - st) * 2); return g ? (g + d) & 0xffff : 0;
      }
      return 0;
    };
    const k = 1000 / upm;
    return { upm, bbox: bbox.map(v => Math.round(v * k)), asc: Math.round(asc * k), desc: Math.round(desc * k), cap: Math.round(cap * k), italic, fixed, width: cp => { const g = glyph(cp); return Math.round(adv(g) * k); }, has: cp => glyph(cp) > 0 };
  }
  const fontCache = new Map();
  function fontBytes(key) {
    const file = `WB${key}.ttf`;
    if (!fontCache.has(file)) {
      const urls = [(C().pdfaFonts || 'fonts/pdfa/') + file, 'https://cdn.jsdelivr.net/gh/conlog06/pdf-werkbank@main/fonts/pdfa/' + file];
      fontCache.set(file, (async () => {
        for (const u of urls) { try { const r = await fetch(u); if (r.ok) return new Uint8Array(await r.arrayBuffer()); } catch (e) { /* nächste Quelle */ } }
        fontCache.delete(file); throw new Error('Die Schriften für PDF/A konnten nicht geladen werden (offline?).');
      })());
    }
    return fontCache.get(file);
  }

  /* ---------- Hilfen ---------- */
  const xmlEsc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const isoDate = d => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  function xmp({ part, title, author, subject, keywords, date, fx }) {
    const t = isoDate(date);
    return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><pdfaid:part>${part}</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance></rdf:Description>
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:format>application/pdf</dc:format>${title ? `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEsc(title)}</rdf:li></rdf:Alt></dc:title>` : ''}${author ? `<dc:creator><rdf:Seq><rdf:li>${xmlEsc(author)}</rdf:li></rdf:Seq></dc:creator>` : ''}${subject ? `<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xmlEsc(subject)}</rdf:li></rdf:Alt></dc:description>` : ''}</rdf:Description>
<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><xmp:CreatorTool>PDF Werkbank</xmp:CreatorTool><xmp:CreateDate>${t}</xmp:CreateDate><xmp:ModifyDate>${t}</xmp:ModifyDate><xmp:MetadataDate>${t}</xmp:MetadataDate></rdf:Description>
<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/"><pdf:Producer>PDF Werkbank</pdf:Producer>${keywords ? `<pdf:Keywords>${xmlEsc(keywords)}</pdf:Keywords>` : ''}</rdf:Description>
${fx ? `<rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#"><pdfaExtension:schemas><rdf:Bag><rdf:li rdf:parseType="Resource"><pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema><pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI><pdfaSchema:prefix>fx</pdfaSchema:prefix><pdfaSchema:property><rdf:Seq>${[['DocumentFileName', 'The name of the embedded XML document'], ['DocumentType', 'The type of the hybrid document in capital letters, e.g. INVOICE or ORDER'], ['Version', 'The actual version of the standard applying to the embedded XML document'], ['ConformanceLevel', 'The conformance level of the embedded XML document']].map(([n, d]) => `<rdf:li rdf:parseType="Resource"><pdfaProperty:name>${n}</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>${d}</pdfaProperty:description></rdf:li>`).join('')}</rdf:Seq></pdfaSchema:property></rdf:li></rdf:Bag></pdfaExtension:schemas></rdf:Description>
<rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#"><fx:DocumentType>INVOICE</fx:DocumentType><fx:DocumentFileName>${xmlEsc(fx.file || 'factur-x.xml')}</fx:DocumentFileName><fx:Version>1.0</fx:Version><fx:ConformanceLevel>${xmlEsc(fx.level || 'EN 16931')}</fx:ConformanceLevel></rdf:Description>` : ''}
</rdf:RDF>
</x:xmpmeta>
${' '.repeat(2000)}
<?xpacket end="w"?>`;
  }
  function eachDict(ctx, fn) {
    const { PDFDict, PDFStream } = PL();
    for (const [ref, o] of ctx.enumerateIndirectObjects()) {
      if (o instanceof PDFDict) fn(o, ref); else if (o instanceof PDFStream) fn(o.dict, ref, o);
    }
  }

  /* ---------- Vorabprüfung ---------- */
  async function preflight(bytes) {
    const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef } = PL();
    const N = PDFName.of, out = { fonts: [], encrypted: false, js: false, cmyk: false, annotsNoAp: 0, attachments: 0, issues: [] };
    let doc;
    try { doc = await PDFDocument.load(bytes, { updateMetadata: false }); }
    catch (e) { if (/encrypt/i.test(e.message)) { out.encrypted = true; out.issues.push('Die PDF ist verschlüsselt.'); return out; } throw e; }
    const ctx = doc.context, look = v => (v instanceof PDFRef ? ctx.lookup(v) : v);
    if (ctx.trailerInfo.Encrypt) { out.encrypted = true; out.issues.push('Die PDF ist verschlüsselt.'); }
    const seen = new Set();
    eachDict(ctx, (d, ref, stream) => {
      const type = d.get(N('Type')), sub = d.get(N('Subtype')), s = sub ? sub.toString() : '';
      if (type === N('Font') && s !== '/Type0' && s !== '/Type3') {
        const base = String(d.get(N('BaseFont')) || '').replace(/^\//, '').replace(/^[A-Z]{6}\+/, '');
        const fd = look(d.get(N('FontDescriptor')));
        const emb = fd instanceof PDFDict && ['FontFile', 'FontFile2', 'FontFile3'].some(k => fd.get(N(k)));
        if (!seen.has(base + emb)) { seen.add(base + emb); out.fonts.push({ name: base, embedded: !!emb, fixable: !emb && !!STD[base] }); }
      }
      if (s === '/JavaScript' || (d.get(N('S')) && d.get(N('S')).toString() === '/JavaScript')) out.js = true;
      if (d.get(N('ColorSpace')) === N('DeviceCMYK')) out.cmyk = true;
      if (type === N('Filespec') && d.get(N('EF'))) out.attachments++;
      if (type === N('Annot') && !d.get(N('AP')) && !['/Popup', '/Link'].includes(s)) out.annotsNoAp++;
    });
    const bad = out.fonts.filter(f => !f.embedded && !f.fixable);
    if (bad.length) out.issues.push(`Nicht eingebettete Schriften: ${bad.map(f => f.name).join(', ')}. Sie lassen sich nicht automatisch ersetzen.`);
    if (out.js) out.issues.push('Die PDF enthält JavaScript (wird entfernt).');
    if (out.cmyk) out.issues.push('Die PDF nutzt CMYK-Farben ohne Farbprofil. Prüfprogramme können das bemängeln.');
    return out;
  }

  /* ---------- Standardschriften einbetten ---------- */
  async function embedStdFonts(doc, issues) {
    const { PDFName, PDFDict, PDFArray, PDFNumber, PDFRef } = PL();
    const ctx = doc.context, N = PDFName.of, look = v => (v instanceof PDFRef ? ctx.lookup(v) : v);
    const todo = [];
    eachDict(ctx, (d, ref, stream) => {
      if (stream || d.get(N('Type')) !== N('Font')) return;
      const sub = d.get(N('Subtype')); if (!sub || !['/Type1', '/TrueType', '/MMType1'].includes(sub.toString())) return;
      const fd = look(d.get(N('FontDescriptor')));
      if (fd instanceof PDFDict && ['FontFile', 'FontFile2', 'FontFile3'].some(k => fd.get(N(k)))) return;
      todo.push(d);
    });
    const files = new Map(), dec = new TextDecoder('windows-1252');
    for (const d of todo) {
      const base = String(d.get(N('BaseFont')) || '').replace(/^\//, '');
      const key = STD[base];
      if (!key) { issues.push(`Schrift „${base}“ ist nicht eingebettet und kann nicht ersetzt werden.`); continue; }
      if (!files.has(key)) {
        const u8 = await fontBytes(key), m = ttf(u8);
        const ff = ctx.flateStream(u8, { Length1: u8.length });
        files.set(key, { m, ref: ctx.register(ff) });
      }
      const { m, ref } = files.get(key);
      // Kodierung: WinAnsi (+ Differences), sonst wie StandardEncoding behandeln
      let enc = look(d.get(N('Encoding'))), diffs = new Map();
      if (enc instanceof PDFDict) {
        const arr = look(enc.get(N('Differences')));
        if (arr instanceof PDFArray) { let c = 0; for (let i = 0; i < arr.size(); i++) { const v = look(arr.get(i)); if (v instanceof PDFNumber) c = v.asNumber(); else { diffs.set(c, v.toString().slice(1)); c++; } } }
      } else if (!enc) { diffs.set(39, 'quoteright'); diffs.set(96, 'quoteleft'); }
      else if (enc !== N('WinAnsiEncoding')) issues.push(`Schrift „${base}“ nutzt die Kodierung ${enc}, sie wird als WinAnsi eingebettet.`);
      const widths = [];
      for (let c = 32; c <= 255; c++) {
        const name = diffs.get(c), cp = name ? uOfName(name) : dec.decode(new Uint8Array([c])).codePointAt(0);
        widths.push(cp != null && m.has(cp) ? m.width(cp) : m.width(32));
      }
      const fam = key.split('-')[0], style = key.split('-')[1];
      const flags = 32 | (fam === 'Mono' ? 1 : 0) | (fam === 'Serif' ? 2 : 0) | (/Italic/.test(style) ? 64 : 0);
      const fname = `WB${fam}-${style}`;
      const desc = ctx.obj({ Type: 'FontDescriptor', FontName: fname, Flags: flags, FontBBox: m.bbox, ItalicAngle: m.italic, Ascent: m.asc, Descent: m.desc, CapHeight: m.cap, StemV: /Bold/.test(style) ? 140 : 80, FontFile2: ref });
      const encNew = diffs.size ? ctx.obj({ Type: 'Encoding', BaseEncoding: 'WinAnsiEncoding', Differences: [...diffs].sort((a, b) => a[0] - b[0]).flatMap(([c, n]) => [c, N(uOfName(n) != null ? n : 'space')]) }) : N('WinAnsiEncoding');
      for (const k of [...d.keys()]) d.delete(k);
      d.set(N('Type'), N('Font')); d.set(N('Subtype'), N('TrueType')); d.set(N('BaseFont'), N(fname));
      d.set(N('FirstChar'), PDFNumber.of(32)); d.set(N('LastChar'), PDFNumber.of(255));
      d.set(N('Widths'), ctx.obj(widths)); d.set(N('FontDescriptor'), ctx.register(desc)); d.set(N('Encoding'), encNew);
    }
    return todo.length;
  }

  /* ---------- PDF/A erzeugen ---------- */
  async function make(bytes, o = {}) {
    const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFHexString, PDFString, PDFNumber, PDFStream, AFRelationship } = PL();
    const N = PDFName.of, issues = [];
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const ctx = doc.context, cat = doc.catalog, look = v => (v instanceof PDFRef ? ctx.lookup(v) : v);
    if (ctx.trailerInfo.Encrypt) throw new Error('Verschlüsselte PDFs können nicht als PDF/A gespeichert werden.');
    const atts = o.attachments || [];
    // Vorhandene Anhänge: in PDF/A-2 nur PDF/A erlaubt → dann Teil 3
    let hasEmb = false;
    const names = look(cat.get(N('Names')));
    if (names instanceof PDFDict) {
      names.delete(N('JavaScript'));
      if (names.get(N('EmbeddedFiles'))) hasEmb = true;
    }
    const part = o.part || (atts.length || hasEmb ? 3 : 2);
    // JavaScript, Aktionen und Formularautomatik entfernen
    cat.delete(N('AA'));
    const oa = look(cat.get(N('OpenAction')));
    if (oa instanceof PDFDict) cat.delete(N('OpenAction'));
    const acro = look(cat.get(N('AcroForm')));
    if (acro instanceof PDFDict) { acro.delete(N('NeedAppearances')); acro.delete(N('XFA')); }
    eachDict(ctx, (d, ref, stream) => {
      const s = d.get(N('S'));
      if (s && ['/JavaScript', '/Launch', '/Sound', '/Movie', '/ResetForm', '/ImportData', '/Hide', '/SetOCGState', '/Rendition', '/Trans', '/GoTo3DView'].includes(s.toString()) && d.get(N('Type')) !== N('Group')) {
        // Aktion neutralisieren
        for (const k of [...d.keys()]) if (k !== N('Type')) d.delete(k);
        d.set(N('S'), N('GoTo')); d.set(N('D'), ctx.obj([doc.getPage(0).ref, N('Fit')]));
      }
      if (d.get(N('Type')) === N('Annot') || d.get(N('Subtype')) && ['/Widget', '/Link', '/Text', '/FreeText', '/Square', '/Circle', '/Line', '/Ink', '/Highlight', '/Underline', '/StrikeOut', '/Squiggly', '/Stamp', '/Polygon', '/PolyLine', '/FileAttachment'].includes(d.get(N('Subtype')).toString()) && d.get(N('Rect'))) {
        d.delete(N('AA'));
        const f = look(d.get(N('F'))), fv = f instanceof PDFNumber ? f.asNumber() : 0;
        d.set(N('F'), PDFNumber.of((fv | 4) & ~(1 | 2 | 32)));
        const sub = d.get(N('Subtype')) ? d.get(N('Subtype')).toString() : '';
        if (!d.get(N('AP')) && !['/Popup', '/Link'].includes(sub)) {
          const r = look(d.get(N('Rect'))), w = r instanceof PDFArray ? Math.abs(look(r.get(2)).asNumber() - look(r.get(0)).asNumber()) : 0, h = r instanceof PDFArray ? Math.abs(look(r.get(3)).asNumber() - look(r.get(1)).asNumber()) : 0;
          const ops = sub === '/Text' ? `q 1 0.83 0 rg 0.55 0.45 0 RG 0.6 w 0.5 0.5 ${Math.max(1, w - 1)} ${Math.max(1, h - 1)} re B 0.55 0.45 0 RG 3 ${h * 0.65} m ${w - 3} ${h * 0.65} l 3 ${h * 0.45} m ${w - 3} ${h * 0.45} l 3 ${h * 0.25} m ${w * 0.6} ${h * 0.25} l S Q` : '';
          const ap = ctx.stream(ops, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, w || 1, h || 1] });
          d.set(N('AP'), ctx.obj({ N: ctx.register(ap) }));
        }
      }
      if (d.get(N('Subtype')) === N('Image') && d.get(N('Interpolate'))) d.delete(N('Interpolate'));
      if (d.get(N('Subtype')) === N('Form') && d.get(N('OPI'))) d.delete(N('OPI'));
    });
    // Schriften
    await embedStdFonts(doc, issues);
    // Anhänge (z. B. factur-x.xml)
    for (const a of atts) {
      await doc.attach(a.bytes, a.name, { mimeType: a.mime || 'application/octet-stream', description: a.desc || a.name, creationDate: new Date(), modificationDate: new Date(), afRelationship: AFRelationship[a.rel || 'Data'] });
    }
    // Ausgabe-Farbprofil
    const icc = ctx.flateStream(b64(ICC_B64), { N: 3 });
    cat.set(N('OutputIntents'), ctx.obj([ctx.obj({ Type: 'OutputIntent', S: 'GTS_PDFA1', OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'), Info: PDFString.of('sRGB IEC61966-2.1'), RegistryName: PDFString.of('http://www.color.org'), DestOutputProfile: ctx.register(icc) })]));
    // Metadaten (Info und XMP müssen übereinstimmen)
    const now = new Date(); now.setMilliseconds(0);
    const info = doc.getInfoDict ? doc.getInfoDict() : null;
    const title = o.title != null ? o.title : (doc.getTitle() || '');
    const author = o.author != null ? o.author : (doc.getAuthor() || '');
    const subject = o.subject != null ? o.subject : (doc.getSubject() || '');
    const keywords = o.keywords != null ? o.keywords : (doc.getKeywords() || '');
    if (info) for (const k of ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate', 'Trapped']) info.delete(N(k));
    if (title) doc.setTitle(title, { showInWindowTitleBar: true });
    if (author) doc.setAuthor(author);
    if (subject) doc.setSubject(subject);
    if (keywords) { doc.setKeywords([keywords]); }
    doc.setCreator('PDF Werkbank'); doc.setProducer('PDF Werkbank'); doc.setCreationDate(now); doc.setModificationDate(now);
    if (o.lang) cat.set(N('Lang'), PDFString.of(o.lang));
    const meta = ctx.stream(new TextEncoder().encode(xmp({ part, title, author, subject, keywords, date: now, fx: o.fx })), { Type: 'Metadata', Subtype: 'XML' });
    cat.set(N('Metadata'), ctx.register(meta));
    // Dokument-ID
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
    ctx.trailerInfo.ID = ctx.obj([PDFHexString.of(id), PDFHexString.of(id)]);
    const outBytes = await doc.save({ useObjectStreams: false });
    return { bytes: outBytes, part, issues };
  }
  global.WBPdfA = { make, preflight, ttf, fontBytes, STD };
})(window);
