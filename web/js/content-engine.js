/* PDF Werkbank – Inhalts-Engine
 * Liest den Inhaltsstrom einer PDF-Seite, ermittelt jedes gezeichnete Objekt
 * (Text, Pfad, Bild, Formular-XObject) mit Position und schreibt den Strom
 * mit gelöschten oder geänderten Objekten neu.
 */
function createContentEngine(PL) {
  'use strict';
  const { PDFName, PDFNumber, PDFArray, PDFDict, PDFRawStream, decodePDFRawStream } = PL;

  /* ---------- Bytes und Zeichen ---------- */
  function bytesToStr(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
    return s;
  }
  function strToBytes(s) {
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255;
    return u;
  }
  const WIN = { 0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6, 0x89: 0x2030, 0x8A: 0x0160, 0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D,
    0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A, 0x9C: 0x0153, 0x9E: 0x017E, 0x9F: 0x0178 };
  const WIN_REV = new Map();
  for (let c = 32; c < 256; c++) { const u = WIN[c] || (c >= 0x80 && c <= 0x9F ? 0 : c); if (u) WIN_REV.set(String.fromCharCode(u), c); }
  const winChar = c => String.fromCharCode(WIN[c] || c);

  /* ---------- pdf-lib Hilfen ---------- */
  const look = (d, k) => (d && typeof d.lookup === 'function' ? d.lookup(PDFName.of(k)) : undefined);
  const num = o => (o instanceof PDFNumber ? o.asNumber() : undefined);
  const nameOf = o => (o instanceof PDFName ? o.toString().slice(1) : undefined);
  const arr = o => (o instanceof PDFArray ? o.asArray().map((_, i) => o.lookup(i)) : []);
  function streamBytes(o) {
    if (!o) return new Uint8Array(0);
    if (o instanceof PDFRawStream) return decodePDFRawStream(o).decode();
    if (typeof o.getUnencodedContents === 'function') return o.getUnencodedContents();
    if (typeof o.getContents === 'function') return o.getContents();
    return new Uint8Array(0);
  }
  function pageContentString(page) {
    const c = page.node.Contents();
    if (!c) return '';
    if (c instanceof PDFArray) return arr(c).map(s => bytesToStr(streamBytes(s))).join('\n');
    return bytesToStr(streamBytes(c));
  }
  function setPageContent(doc, page, str) {
    const stream = doc.context.flateStream(strToBytes(str));
    page.node.set(PDFName.of('Contents'), doc.context.register(stream));
  }

  /* ---------- Lexer ---------- */
  const isWS = c => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0;
  const isDelim = c => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;
  const NUM = /^[+-]?(\d+\.?\d*|\.\d+)$/;
  function lex(s) {
    const n = s.length; let i = 0;
    const skip = () => {
      while (i < n) {
        const c = s.charCodeAt(i);
        if (isWS(c)) i++;
        else if (c === 37) { while (i < n && s.charCodeAt(i) !== 10 && s.charCodeAt(i) !== 13) i++; }
        else break;
      }
    };
    const read = () => {
      skip();
      if (i >= n) return undefined;
      const c = s.charCodeAt(i);
      if (c === 40) {
        let depth = 1; i++; const out = [];
        while (i < n && depth) {
          const ch = s.charCodeAt(i++);
          if (ch === 92) {
            const e = s.charCodeAt(i++);
            if (e === 110) out.push(10); else if (e === 114) out.push(13); else if (e === 116) out.push(9);
            else if (e === 98) out.push(8); else if (e === 102) out.push(12);
            else if (e >= 48 && e <= 55) { let v = e - 48; for (let k = 0; k < 2; k++) { const d = s.charCodeAt(i); if (d >= 48 && d <= 55) { v = v * 8 + d - 48; i++; } else break; } out.push(v & 255); }
            else if (e === 13) { if (s.charCodeAt(i) === 10) i++; }
            else if (e !== 10) out.push(e);
          } else if (ch === 40) { depth++; out.push(ch); }
          else if (ch === 41) { depth--; if (depth) out.push(ch); }
          else out.push(ch);
        }
        return { str: out };
      }
      if (c === 60) {
        if (s.charCodeAt(i + 1) === 60) {
          i += 2; const d = {};
          for (;;) {
            skip();
            if (i >= n) break;
            if (s.charCodeAt(i) === 62 && s.charCodeAt(i + 1) === 62) { i += 2; break; }
            const k = read(), v = read();
            if (k && k.name !== undefined) d[k.name] = v;
          }
          return { dict: d };
        }
        i++; let h = '';
        while (i < n && s.charCodeAt(i) !== 62) { const ch = s[i++]; if (/[0-9a-fA-F]/.test(ch)) h += ch; }
        i++;
        if (h.length % 2) h += '0';
        const out = [];
        for (let k = 0; k < h.length; k += 2) out.push(parseInt(h.substr(k, 2), 16));
        return { str: out, hex: true };
      }
      if (c === 91) {
        i++; const a = [];
        for (;;) { skip(); if (i >= n) break; if (s.charCodeAt(i) === 93) { i++; break; } const v = read(); if (v === undefined) break; a.push(v); }
        return a;
      }
      if (c === 47) {
        i++; const st = i;
        while (i < n) { const ch = s.charCodeAt(i); if (isWS(ch) || isDelim(ch)) break; i++; }
        return { name: s.slice(st, i).replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) };
      }
      const st = i;
      while (i < n) { const ch = s.charCodeAt(i); if (isWS(ch) || isDelim(ch)) break; i++; }
      if (i === st) { i++; return { kw: s[st], junk: true }; }
      const tok = s.slice(st, i);
      if (NUM.test(tok)) return +tok;
      if (tok === 'true') return true;
      if (tok === 'false') return false;
      if (tok === 'null') return null;
      return { kw: tok };
    };
    const ops = [];
    let args = [], argStart = -1;
    for (;;) {
      skip();
      if (i >= n) break;
      const st = i, v = read();
      if (v === undefined) break;
      if (v && typeof v === 'object' && v.kw !== undefined) {
        if (v.junk) { args = []; argStart = -1; continue; }
        if (v.kw === 'BI') {
          const dict = {};
          for (;;) {
            const k = read();
            if (k === undefined || (k && k.kw === 'ID')) break;
            const val = read();
            if (k && k.name !== undefined) dict[k.name] = val;
          }
          i++;
          let j = i;
          while (j < n) {
            if (s.charCodeAt(j) === 69 && s.charCodeAt(j + 1) === 73 && isWS(s.charCodeAt(j - 1)) && (j + 2 >= n || isWS(s.charCodeAt(j + 2)) || isDelim(s.charCodeAt(j + 2)))) break;
            j++;
          }
          i = Math.min(n, j + 2);
          ops.push({ op: 'BI', args: [dict], start: argStart >= 0 ? argStart : st, end: i });
        } else ops.push({ op: v.kw, args, start: argStart >= 0 ? argStart : st, end: i });
        args = []; argStart = -1;
      } else { if (argStart < 0) argStart = st; args.push(v); }
    }
    return ops;
  }

  /* ---------- Matrizen ---------- */
  const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
  const tp = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const boxOf = pts => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    return [x0, y0, x1, y1];
  };

  /* ---------- Schriften ---------- */
  function parseCMap(str) {
    const map = new Map();
    const u16 = h => { let o = ''; for (let k = 0; k < h.length; k += 4) o += String.fromCharCode(parseInt(h.substr(k, 4).padEnd(4, '0'), 16)); return o; };
    for (const b of str.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
      for (const m of b[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(parseInt(m[1], 16), u16(m[2]));
    for (const b of str.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const m of b[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]*)>|\[([^\]]*)\])/g)) {
        const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16);
        if (hi - lo > 65535) continue;
        if (m[3] !== undefined) {
          const head = m[3].slice(0, -4), last = parseInt(m[3].slice(-4) || '0', 16);
          for (let c = lo; c <= hi; c++) map.set(c, u16(head + (last + c - lo).toString(16).padStart(4, '0')));
        } else {
          const list = [...m[4].matchAll(/<([0-9a-fA-F]*)>/g)].map(x => u16(x[1]));
          for (let c = lo; c <= hi; c++) map.set(c, list[c - lo] || '');
        }
      }
    }
    return map;
  }
  function fontInfo(fd) {
    const sub = nameOf(look(fd, 'Subtype')) || 'Type1';
    const base = nameOf(look(fd, 'BaseFont')) || '';
    const f = { sub, base, subset: /^[A-Z]{6}\+/.test(base), bpc: 1, scale: 0.001, widths: new Map(), dw: 0, asc: 0.8, desc: -0.2, toUni: null, used: new Set(), uniToCode: null };
    let desc = look(fd, 'FontDescriptor');
    if (sub === 'Type0') {
      f.bpc = 2;
      const d = look(fd, 'DescendantFonts');
      const df = d instanceof PDFArray ? d.lookup(0) : null;
      if (df) {
        desc = look(df, 'FontDescriptor');
        f.dw = num(look(df, 'DW')) ?? 1000;
        const W = arr(look(df, 'W')).map(x => (x instanceof PDFArray ? arr(x).map(num) : num(x)));
        for (let k = 0; k < W.length;) {
          const c = W[k];
          if (Array.isArray(W[k + 1])) { W[k + 1].forEach((w, j) => f.widths.set(c + j, w)); k += 2; }
          else { for (let cc = c; cc <= W[k + 1]; cc++) f.widths.set(cc, W[k + 2]); k += 3; }
        }
      } else f.dw = 1000;
    } else {
      const first = num(look(fd, 'FirstChar')) ?? 0;
      arr(look(fd, 'Widths')).forEach((w, j) => f.widths.set(first + j, num(w) ?? 0));
      f.dw = num(look(desc, 'MissingWidth')) ?? (f.widths.size ? 0 : 500);
      if (sub === 'Type3') { const fm = arr(look(fd, 'FontMatrix')).map(num); f.scale = fm[0] || 0.001; }
    }
    if (desc) {
      const a = num(look(desc, 'Ascent')), d = num(look(desc, 'Descent'));
      if (a) f.asc = a / 1000;
      if (d) f.desc = d / 1000;
      if (f.asc < 0.5) f.asc = 0.8;
      if (f.desc > -0.05) f.desc = -0.2;
    }
    if (f.bpc === 1 && sub !== 'Type3' && !f.widths.size) f.std = stdKey(base);
    const tu = look(fd, 'ToUnicode');
    if (tu && typeof tu === 'object' && !(tu instanceof PDFName)) { try { f.toUni = parseCMap(bytesToStr(streamBytes(tu))); } catch (e) { f.toUni = null; } }
    return f;
  }
  /* Standardschriften ohne Breitentabelle: Breiten kommen über setStdWidths aus pdf-lib */
  let stdWidth = null;
  function stdKey(base) {
    const b = base.replace(/^[A-Z]{6}\+/, '').replace(/[\s_]/g, '');
    const bold = /bold|black|heavy/i.test(b), ital = /italic|oblique/i.test(b);
    let fam = null;
    if (/^(helvetica|arial)/i.test(b)) fam = 'Helvetica';
    else if (/^(times|timesnewroman)/i.test(b)) fam = 'Times';
    else if (/^courier/i.test(b)) fam = 'Courier';
    if (!fam) return null;
    if (fam === 'Times') return 'Times-' + (bold && ital ? 'BoldItalic' : bold ? 'Bold' : ital ? 'Italic' : 'Roman');
    return fam + (bold && ital ? '-BoldOblique' : bold ? '-Bold' : ital ? '-Oblique' : '');
  }
  function width(f, code) {
    if (!f.widths.has(code) && f.std && stdWidth) { const w = stdWidth(f.std, winChar(code)); if (w != null) return w * 0.001; }
    return (f.widths.has(code) ? f.widths.get(code) : f.dw) * f.scale;
  }
  function codesOf(f, bytes) {
    const out = [];
    if (f.bpc === 2) { for (let k = 0; k + 1 < bytes.length; k += 2) out.push((bytes[k] << 8) | bytes[k + 1]); }
    else for (const b of bytes) out.push(b);
    return out;
  }
  function uniOf(f, code) {
    if (f.toUni && f.toUni.has(code)) return f.toUni.get(code);
    if (f.bpc === 1) return winChar(code);
    return '';
  }
  function encoder(f) {
    if (f.uniToCode) return f.uniToCode;
    const m = new Map();
    if (f.toUni) for (const [c, u] of f.toUni) { if (u && !m.has(u) && (!f.subset || f.used.has(c))) m.set(u, c); }
    if (f.bpc === 1 && !f.toUni) for (const [u, c] of WIN_REV) { if (!f.subset || f.used.has(c)) m.set(u, c); }
    if (f.bpc === 1 && f.toUni && !f.subset) for (const [u, c] of WIN_REV) if (!m.has(u)) m.set(u, c);
    f.uniToCode = m;
    return m;
  }

  /* ---------- Interpreter ---------- */
  function cmyk2rgb(c, m, y, k) { return [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)]; }
  function analyse(str, resources) {
    const ops = lex(str);
    const fontDicts = look(resources, 'Font'), xobjs = look(resources, 'XObject');
    const fontCache = new Map();
    const getFont = name => {
      if (fontCache.has(name)) return fontCache.get(name);
      let f = null;
      const fd = look(fontDicts, name);
      if (fd instanceof PDFDict) { try { f = fontInfo(fd); } catch (e) { f = null; } }
      if (!f) f = { sub: 'Type1', base: name, subset: false, bpc: 1, scale: 0.001, widths: new Map(), dw: 500, asc: 0.8, desc: -0.2, toUni: null, used: new Set(), uniToCode: null };
      fontCache.set(name, f);
      return f;
    };
    /* Grafikzustand inkl. Quelltext der Zustandsoperatoren, damit verschobene Objekte
       später mit identischem Aussehen neu ausgegeben werden können */
    let gs = { ctm: [1, 0, 0, 1, 0, 0], fill: [0, 0, 0], fillCs: '', fillSrc: '', strokeCs: '', strokeSrc: '', line: {}, gsSrc: [], clips: [] };
    const stack = [];
    const copyGs = g => ({ ...g, ctm: g.ctm.slice(), fill: g.fill.slice(), line: { ...g.line }, gsSrc: g.gsSrc.slice() });
    let ts = { Tc: 0, Tw: 0, Th: 1, TL: 0, Tf: null, Tfs: 0, Tr: 0, Ts: 0 };
    let Tm = [1, 0, 0, 1, 0, 0], Tlm = [1, 0, 0, 1, 0, 0], lineX = 0;
    let path = [], ps = -1, clipOp = -1, bt = -1, btCount = 0;
    const objects = [];
    const src = o => str.slice(o.start, o.end);
    const setFill = a => { const v = a.filter(x => typeof x === 'number'); if (v.length === 1) gs.fill = [v[0], v[0], v[0]]; else if (v.length === 3) gs.fill = v; else if (v.length === 4) gs.fill = cmyk2rgb(...v); };
    const stateOf = () => ({ fill: gs.fillCs + ' ' + gs.fillSrc, stroke: gs.strokeCs + ' ' + gs.strokeSrc, line: Object.values(gs.line).join(' '), gs: gs.gsSrc.join(' '), clips: gs.clips, ctm: gs.ctm.slice() });
    const startPath = idx => { if (!path.length && ps < 0) ps = idx; };

    function show(op, idx, items) {
      const f = ts.Tf ? getFont(ts.Tf) : getFont('');
      const Tfs = ts.Tfs, Th = ts.Th;
      let x = 0, minX = 0, maxX = 0, text = '';
      const codes = [], glyphs = [];
      for (const it of items) {
        if (typeof it === 'number') { x += -it / 1000 * Tfs * Th; }
        else if (it && it.str) {
          for (const c of codesOf(f, it.str)) {
            codes.push(c); f.used.add(c); text += uniOf(f, c);
            const adv = (width(f, c) * Tfs + ts.Tc + (f.bpc === 1 && c === 32 ? ts.Tw : 0)) * Th;
            glyphs.push([x, adv]);
            x += adv;
          }
        }
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      }
      const M = mul(Tm, gs.ctm);
      const y0 = ts.Ts + f.desc * Tfs, y1 = ts.Ts + f.asc * Tfs;
      const bbox = boxOf([tp(M, minX, y0), tp(M, maxX, y0), tp(M, minX, y1), tp(M, maxX, y1)]);
      const fsEff = Math.hypot(M[2], M[3]) * Tfs;
      objects.push({
        i: idx, kind: 'text', op, bbox, text, codes, font: ts.Tf, adv: x, bt,
        base: tp(M, 0, ts.Ts), end: tp(M, x, ts.Ts), dir: [M[0], M[1]], fs: fsEff,
        st: { Tfs, Th, Tc: ts.Tc, Tw: ts.Tw, Tr: ts.Tr, TL: ts.TL, Ts: ts.Ts }, fill: gs.fill.slice(), blank: !text.trim(),
        Tm: Tm.slice(), Tlm: Tlm.slice(), lineX, items, gstate: stateOf(),
        M, gy: [y0, y1], glyphs, bpc: f.bpc,
      });
      Tm = mul([1, 0, 0, 1, x, 0], Tm); lineX += x;
    }
    const nextLine = () => { Tlm = mul([1, 0, 0, 1, 0, -ts.TL], Tlm); Tm = Tlm.slice(); lineX = 0; };

    ops.forEach((o, idx) => {
      const a = o.args;
      switch (o.op) {
        case 'q': stack.push(copyGs(gs)); break;
        case 'Q': if (stack.length) gs = stack.pop(); break;
        case 'cm': if (a.length >= 6) gs.ctm = mul(a.slice(0, 6), gs.ctm); break;
        case 'g': case 'rg': case 'k': gs.fillCs = ''; gs.fillSrc = src(o); setFill(a); break;
        case 'sc': case 'scn': gs.fillSrc = src(o); setFill(a); break;
        case 'cs': gs.fillCs = src(o); gs.fillSrc = ''; gs.fill = [0, 0, 0]; break;
        case 'G': case 'RG': case 'K': gs.strokeCs = ''; gs.strokeSrc = src(o); break;
        case 'SC': case 'SCN': gs.strokeSrc = src(o); break;
        case 'CS': gs.strokeCs = src(o); gs.strokeSrc = ''; break;
        case 'w': case 'J': case 'j': case 'M': case 'd': case 'ri': case 'i': gs.line[o.op] = src(o); break;
        case 'gs': if (gs.gsSrc.length < 6) gs.gsSrc = gs.gsSrc.concat(src(o)); break;
        case 'W': case 'W*': clipOp = idx; break;
        case 'BT': Tm = [1, 0, 0, 1, 0, 0]; Tlm = [1, 0, 0, 1, 0, 0]; lineX = 0; bt = btCount++; break;
        case 'ET': bt = -1; break;
        case 'Tc': ts.Tc = a[0] || 0; break;
        case 'Tw': ts.Tw = a[0] || 0; break;
        case 'Tz': ts.Th = (a[0] ?? 100) / 100; break;
        case 'TL': ts.TL = a[0] || 0; break;
        case 'Ts': ts.Ts = a[0] || 0; break;
        case 'Tr': ts.Tr = a[0] || 0; break;
        case 'Tf': ts.Tf = a[0] && a[0].name; ts.Tfs = a[1] || 0; break;
        case 'Td': Tlm = mul([1, 0, 0, 1, a[0] || 0, a[1] || 0], Tlm); Tm = Tlm.slice(); lineX = 0; break;
        case 'TD': ts.TL = -(a[1] || 0); Tlm = mul([1, 0, 0, 1, a[0] || 0, a[1] || 0], Tlm); Tm = Tlm.slice(); lineX = 0; break;
        case 'Tm': if (a.length >= 6) { Tlm = a.slice(0, 6); Tm = Tlm.slice(); lineX = 0; } break;
        case 'T*': nextLine(); break;
        case 'Tj': show('Tj', idx, [a[0]]); break;
        case 'TJ': show('TJ', idx, Array.isArray(a[0]) ? a[0] : []); break;
        case "'": nextLine(); show("'", idx, [a[0]]); break;
        case '"': ts.Tw = a[0] || 0; ts.Tc = a[1] || 0; nextLine(); show('"', idx, [a[2]]); break;
        case 'm': case 'l': startPath(idx); path.push(tp(gs.ctm, a[0], a[1])); break;
        case 'c': startPath(idx); path.push(tp(gs.ctm, a[0], a[1]), tp(gs.ctm, a[2], a[3]), tp(gs.ctm, a[4], a[5])); break;
        case 'v': case 'y': startPath(idx); path.push(tp(gs.ctm, a[0], a[1]), tp(gs.ctm, a[2], a[3])); break;
        case 'h': startPath(idx); break;
        case 're': { startPath(idx); const [x, y, w, h] = a; path.push(tp(gs.ctm, x, y), tp(gs.ctm, x + w, y), tp(gs.ctm, x, y + h), tp(gs.ctm, x + w, y + h)); break; }
        case 'S': case 's': case 'f': case 'F': case 'f*': case 'B': case 'B*': case 'b': case 'b*': case 'n': {
          const st = stateOf();
          if (clipOp >= 0 && ps >= 0 && path.length) {
            gs.clips = gs.clips.concat({ src: str.slice(ops[ps].start, ops[clipOp].end) + ' n', ctm: gs.ctm.slice(), bbox: boxOf(path) });
          }
          if (o.op !== 'n' && path.length && ps >= 0) objects.push({ i: idx, kind: 'path', op: o.op, ps, bbox: boxOf(path), fill: gs.fill.slice(), gstate: st, clipped: clipOp >= 0 });
          path = []; ps = -1; clipOp = -1; break;
        }
        case 'Do': {
          const nm = a[0] && a[0].name;
          const xo = look(xobjs, nm);
          const sub = xo && xo.dict ? nameOf(xo.dict.lookup(PDFName.of('Subtype'))) : '';
          if (sub === 'Form') {
            const bb = arr(xo.dict.lookup(PDFName.of('BBox'))).map(num);
            const mx = arr(xo.dict.lookup(PDFName.of('Matrix'))).map(num);
            const M = mul(mx.length === 6 ? mx : [1, 0, 0, 1, 0, 0], gs.ctm);
            if (bb.length === 4) objects.push({ i: idx, kind: 'form', bbox: boxOf([tp(M, bb[0], bb[1]), tp(M, bb[2], bb[1]), tp(M, bb[0], bb[3]), tp(M, bb[2], bb[3])]), gstate: stateOf() });
          } else {
            const M = gs.ctm;
            objects.push({ i: idx, kind: 'image', bbox: boxOf([tp(M, 0, 0), tp(M, 1, 0), tp(M, 0, 1), tp(M, 1, 1)]), gstate: stateOf() });
          }
          break;
        }
        case 'BI': { const M = gs.ctm; objects.push({ i: idx, kind: 'image', bbox: boxOf([tp(M, 0, 0), tp(M, 1, 0), tp(M, 0, 1), tp(M, 1, 1)]), gstate: stateOf() }); break; }
      }
    });
    return { ops, objects, fonts: fontCache };
  }

  /* Text mehrerer Textobjekte einer Zeile zusammensetzen (Leerzeichen bei sichtbaren Lücken) */
  function joinText(objs) {
    let t = '';
    objs.forEach((o, k) => {
      if (k) {
        const p = objs[k - 1], gap = Math.hypot(o.base[0] - p.end[0], o.base[1] - p.end[1]);
        if (gap > o.fs * 0.18 && !/\s$/.test(t) && !/^\s/.test(o.text)) t += ' ';
      }
      t += o.text;
    });
    return t;
  }

  /* Textzeilen bilden: aufeinanderfolgende Textobjekte im selben BT auf derselben Grundlinie */
  function groupLines(objects) {
    const groups = [];
    let cur = null, prev = null;
    for (const o of objects) {
      if (o.kind !== 'text') continue;
      let join = false;
      if (cur && prev && prev.bt === o.bt && o.bt >= 0) {
        const dl = Math.hypot(o.dir[0], o.dir[1]) || 1, ux = o.dir[0] / dl, uy = o.dir[1] / dl;
        const dx = o.base[0] - prev.end[0], dy = o.base[1] - prev.end[1];
        const along = dx * ux + dy * uy, across = Math.abs(-dx * uy + dy * ux);
        const fs = Math.max(o.fs, prev.fs, 1);
        join = across < fs * 0.35 && along > -fs * 0.6 && along < fs * 1.6;
      }
      if (!join) { cur = { ids: [], objs: [] }; groups.push(cur); }
      cur.ids.push(o.i); cur.objs.push(o); prev = o;
    }
    for (const g of groups) {
      g.text = joinText(g.objs);
      g.bbox = boxOf(g.objs.flatMap(o => [[o.bbox[0], o.bbox[1]], [o.bbox[2], o.bbox[3]]]));
      g.first = g.objs.find(o => !o.blank) || g.objs[0];
      g.fs = g.first.fs;
    }
    return groups.filter(g => g.objs.some(o => !o.blank));
  }

  /* ---------- Neu schreiben ---------- */
  const fmt = v => { const r = Math.round(v * 1000) / 1000; return Object.is(r, -0) ? '0' : String(r); };
  function advanceTJ(o, prefix) {
    const { Tfs, Th } = o.st;
    if (!Tfs || !Th) return null;
    return `${prefix}[${fmt(-1000 * o.adv / (Tfs * Th))}] TJ`;
  }
  function prefixFor(o) {
    if (o.op === "'") return 'T* ';
    if (o.op === '"') return `${fmt(o.st.Tw)} Tw ${fmt(o.st.Tc)} Tc T* `;
    return '';
  }
  function deletionText(o, original) {
    if (o.kind === 'text') {
      const r = advanceTJ(o, prefixFor(o));
      return r || ` 3 Tr ${original} ${fmt(o.st.Tr)} Tr `;
    }
    if (o.kind === 'path') return ' n ';
    return ' ';
  }
  function encodeText(an, o, text) {
    const f = an.fonts.get(o.font);
    if (!f) return null;
    const m = encoder(f), codes = [];
    for (const ch of text) { const c = m.get(ch); if (c === undefined) return null; codes.push(c); }
    return { f, codes };
  }
  function replacementText(an, o, text) {
    const enc = encodeText(an, o, text);
    if (!enc) return null;
    const { f, codes } = enc, { Tfs, Th, Tc, Tw } = o.st;
    let adv = 0;
    for (const c of codes) adv += (width(f, c) * Tfs + Tc + (f.bpc === 1 && c === 32 ? Tw : 0)) * Th;
    const hex = codes.map(c => c.toString(16).padStart(f.bpc * 2, '0')).join('');
    const comp = Tfs && Th ? fmt(-1000 * (o.adv - adv) / (Tfs * Th)) : '0';
    return `${prefixFor(o)}[<${hex}> ${comp}] TJ`;
  }
  function canEncode(an, o, text) { return !!encodeText(an, o, text); }

  /* ---------- Verschieben, Skalieren, Drehen ----------
     Ein transformiertes Objekt wird an seiner alten Stelle entfernt und am Ende der Seite
     als Kopie neu gezeichnet: mit Matrix CTM × A, seinem Farb- und Linienzustand und den
     eigenen Beschneidungspfaden. So bleibt es sichtbar, auch wenn es aus einem
     Beschneidungsbereich herausgeschoben wird. */
  const inv = m => { const d = m[0] * m[3] - m[1] * m[2] || 1e-9; return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]; };
  const m6 = m => m.map(fmt).join(' ');
  const isId = A => !A || (Math.abs(A[0] - 1) < 1e-9 && Math.abs(A[1]) < 1e-9 && Math.abs(A[2]) < 1e-9 && Math.abs(A[3] - 1) < 1e-9 && Math.abs(A[4]) < 1e-6 && Math.abs(A[5]) < 1e-6);
  const area = b => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  function xbox(b, A) { return isId(A) ? b : boxOf([tp(A, b[0], b[1]), tp(A, b[2], b[1]), tp(A, b[0], b[3]), tp(A, b[2], b[3])]); }
  const pdfName = n => '/' + String(n).replace(/[^!-~]|[#()<>[\]{}/%]/g, c => '#' + c.charCodeAt(0).toString(16).padStart(2, '0'));
  const hexStr = bytes => '<' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('') + '>';
  function itemsSrc(items) { return items.map(it => (typeof it === 'number' ? fmt(it) : it && it.str ? hexStr(it.str) : '')).join(' '); }

  /* ---------- Schwärzen ----------
     Zeichen, deren Box einen geschwärzten Bereich berührt, werden aus dem Textoperator
     entfernt und durch einen gleich breiten Leerschritt ersetzt. Der Rest der Zeile
     bleibt an seiner Stelle. Flächen und Bilder werden entfernt, wenn sie zu mindestens
     90 % im Bereich liegen. */
  const overlaps = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
  const covered = (b, r) => { const ix = Math.max(0, Math.min(b[2], r[2]) - Math.max(b[0], r[0])), iy = Math.max(0, Math.min(b[3], r[3]) - Math.max(b[1], r[1])); return (ix * iy) / Math.max(area(b), 1e-6); };
  function redactMask(o, A, rects) {
    if (!rects || !rects.length || o.kind !== 'text' || !o.glyphs) return null;
    if (!rects.some(r => overlaps(xbox(o.bbox, A), r))) return null;
    // Kernhöhe der Zeichen (Grundlinie bis etwa Versalhöhe), damit Nachbarzeilen unberührt bleiben
    const y0 = o.st.Ts - 0.05 * o.st.Tfs, y1 = o.st.Ts + 0.6 * o.st.Tfs, M = A ? mul(o.M, A) : o.M;
    let hit = false;
    const mask = o.glyphs.map(([gx, adv]) => {
      const b = boxOf([tp(M, gx, y0), tp(M, gx + adv, y0), tp(M, gx, y1), tp(M, gx + adv, y1)]);
      const s = [b[0] + (b[2] - b[0]) * 0.2, b[1], b[2] - (b[2] - b[0]) * 0.2, b[3]];
      const r = rects.some(rr => overlaps(s, rr));
      if (r) hit = true;
      return r;
    });
    return hit ? mask : null;
  }
  function redactedItems(o, mask) {
    const { Tfs, Th } = o.st, out = [];
    let g = 0;
    for (const it of o.items) {
      if (typeof it === 'number') { out.push(fmt(it)); continue; }
      if (!it || !it.str) continue;
      const bytes = it.str, step = o.bpc === 2 ? 2 : 1;
      let run = [];
      const flush = () => { if (run.length) { out.push(hexStr(run)); run = []; } };
      for (let k = 0; k + step - 1 < bytes.length; k += step) {
        const gl = o.glyphs[g];
        if (mask[g]) { flush(); out.push(fmt(-1000 * (gl ? gl[1] : 0) / ((Tfs * Th) || 1))); }
        else for (let j = 0; j < step; j++) run.push(bytes[k + j]);
        g++;
      }
      flush();
    }
    return out.join(' ');
  }
  function redactsObject(o, A, rects) {
    if (!rects || !rects.length || o.kind === 'text') return false;
    const b = xbox(o.bbox, A);
    return rects.some(r => covered(b, r) >= 0.9);
  }
  function copyText(an, str, o, A, repText, mask) {
    const g = o.gstate || { fill: '', stroke: '', line: '', gs: '', clips: [], ctm: [1, 0, 0, 1, 0, 0] };
    let s = 'q ';
    // nur eng anliegende Beschneidungen mitnehmen (z. B. zugeschnittene Bilder), nicht ganze Spalten oder Seiten
    for (const c of g.clips || []) {
      if (area(c.bbox) > area(o.bbox) * 2.5 + 4) continue;
      const M = mul(c.ctm, A);
      s += `${m6(M)} cm ${c.src} ${m6(inv(M))} cm `;
    }
    const M = mul(o.kind === 'text' ? g.ctm : (o.gstate ? o.gstate.ctm : [1, 0, 0, 1, 0, 0]), A);
    s += `${m6(M)} cm ${g.gs} ${g.line} ${g.fill} ${g.stroke} `;
    if (o.kind === 'path') s += str.slice(an.ops[o.ps].start, an.ops[o.i].end);
    else if (o.kind === 'text') {
      let items = mask ? redactedItems(o, mask) : itemsSrc(o.items);
      if (repText != null && !mask) {
        const enc = encodeText(an, o, repText);
        if (enc) items = hexStr(enc.codes.flatMap(c => (enc.f.bpc === 2 ? [c >> 8, c & 255] : [c])));
      }
      const st = o.st;
      s += `BT ${pdfName(o.font)} ${fmt(st.Tfs)} Tf ${fmt(st.Tc)} Tc ${fmt(st.Tw)} Tw ${fmt(st.Th * 100)} Tz ${fmt(st.TL)} TL ${fmt(st.Ts)} Ts ${fmt(st.Tr)} Tr ${m6(o.Tm)} Tm [${items}] TJ ET`;
    } else s += str.slice(an.ops[o.i].start, an.ops[o.i].end);
    return s + ' Q';
  }
  function applyEdits(str, an, ce) {
    if (!ce || (!ce.del?.length && !ce.rep && !ce.tf && !ce.red?.length && !ce.dup?.length && !ce.zf?.length && !ce.zb?.length)) return str;
    const byIdx = new Map(an.objects.map(o => [o.i, o]));
    const orig = i => str.slice(an.ops[i].start, an.ops[i].end);
    const del = new Set(ce.del || []), rep = ce.rep || {}, tf = ce.tf || {}, red = ce.red || [];
    const repl = new Map(), copies = [], masks = new Map();
    // Schwärzen: ganze Objekte im Bereich löschen, Textoperatoren zeichengenau ausdünnen
    if (red.length) for (const o of an.objects) {
      if (del.has(o.i)) continue;
      const A = tf[o.i];
      if (redactsObject(o, A, red)) { del.add(o.i); continue; }
      const m = redactMask(o, A, red);
      if (m) { if (rep[o.i] !== undefined || m.every(Boolean)) del.add(o.i); else masks.set(o.i, m); }
    }
    for (const i of del) { const o = byIdx.get(i); if (o) repl.set(i, deletionText(o, orig(i))); }
    // Ebenen: zf = nach vorne (am Ende gezeichnet), zb = nach hinten (ganz am Anfang gezeichnet)
    const zf = (ce.zf || []).filter(i => typeof i === 'number'), zb = (ce.zb || []).filter(i => typeof i === 'number');
    const zset = new Set([...zf, ...zb]);
    for (const [k, A] of Object.entries(tf)) {
      const i = +k, o = byIdx.get(i);
      if (!o || del.has(i) || isId(A) || zset.has(i)) continue;
      repl.set(i, deletionText(o, orig(i)));
      copies.push([i, A]);
    }
    const zcopy = i => { const o = byIdx.get(i); if (!o || del.has(i)) return null; repl.set(i, deletionText(o, orig(i))); return [i, tf[i] || [1, 0, 0, 1, 0, 0]]; };
    const front = zf.map(zcopy).filter(Boolean), back = zb.map(zcopy).filter(Boolean);
    for (const [k, t] of Object.entries(rep)) {
      const i = +k, o = byIdx.get(i);
      if (!o || del.has(i) || (tf[k] && !isId(tf[k])) || zset.has(i)) continue;
      const r = replacementText(an, o, t);
      repl.set(i, r == null ? deletionText(o, orig(i)) : r);
    }
    for (const [i, m] of masks) {
      if (repl.has(i)) continue;
      repl.set(i, `${prefixFor(byIdx.get(i))}[${redactedItems(byIdx.get(i), m)}] TJ`);
    }
    const idxs = [...repl.keys()].sort((a, b) => an.ops[a].start - an.ops[b].start);
    let out = '', pos = 0;
    for (const i of idxs) {
      const op = an.ops[i];
      out += str.slice(pos, op.start) + ' ' + repl.get(i) + ' ';
      pos = op.end;
    }
    out += str.slice(pos);
    // Kopien (Einfügen auf derselben Seite): zusätzlich zeichnen, Original bleibt
    const extra = [], backExtra = [];
    for (const d of ce.dup || []) for (const [i, A] of d.items) {
      const o = byIdx.get(i); if (!o) continue;
      const info = red.length ? (o.kind === 'text' ? redactMask(o, A, red) : (redactsObject(o, A, red) ? 'all' : null)) : null;
      if (info === 'all' || (Array.isArray(info) && info.every(Boolean))) continue;
      (d.back ? backExtra : extra).push(copyText(an, str, o, A, rep[i], Array.isArray(info) ? info : null));
    }
    if (!copies.length && !extra.length && !front.length && !back.length && !backExtra.length) return out;
    copies.sort((a, b) => a[0] - b[0]);
    const cp = ([i, A]) => copyText(an, str, byIdx.get(i), A, rep[i], masks.get(i));
    const under = back.map(cp).concat(backExtra);
    return (under.length ? under.join('\n') + '\n' : '') + 'q\n' + out + '\nQ\n' + copies.map(cp).concat(extra, front.map(cp)).join('\n') + '\n';
  }

  /* Öffentliche Schnittstelle */
  function analysePage(page) {
    const str = pageContentString(page);
    const an = analyse(str, page.node.Resources());
    an.str = str;
    an.groups = groupLines(an.objects);
    return an;
  }
  function editPage(doc, page, an, ce) {
    setPageContent(doc, page, applyEdits(an.str, an, ce));
  }
  const setStdWidths = fn => { stdWidth = fn; };
  const STD_FONTS = ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique', 'Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic', 'Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'];
  /* Für die Oberfläche: ist ein Objekt durch Schwärzen ganz ('all') oder teilweise (Maske) entfernt? */
  function redactInfo(o, A, rects) {
    if (!rects || !rects.length) return null;
    if (o.kind !== 'text') return redactsObject(o, A, rects) ? 'all' : null;
    const m = redactMask(o, A, rects);
    return m && m.every(Boolean) ? 'all' : m;
  }
  return { analysePage, editPage, applyEdits, canEncode, joinText, lex, parseCMap, setStdWidths, STD_FONTS, xbox, mul, inv, isId, redactInfo };
}
if (typeof module !== 'undefined') module.exports = createContentEngine;
