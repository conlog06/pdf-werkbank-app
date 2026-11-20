/* PDF Werkbank – Dokument-Scanner und Belegerkennung (ab Version 1.9)
 *   WBScan.load(file)                 Bild laden (verkleinert auf 2400 px) → canvas
 *   WBScan.findCorners(canvas)        Blatt/Beleg im Foto finden → 4 Ecken [{x,y}] (oben links, oben rechts, unten rechts, unten links)
 *   WBScan.warp(canvas, corners)      perspektivisch entzerren → canvas
 *   WBScan.enhance(canvas, mode)      'color' | 'gray' | 'bw' Scan-Look
 *   WBScan.editCorners(canvas, corners) Ecken von Hand nachziehen (Promise<corners|null>)
 *   WBScan.receipt(text)              Händler, Datum, Betrag, MwSt. aus erkanntem Text
 */
(function (global) {
  'use strict';
  const MAX = 2400;
  async function load(file) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(async () => {
      const url = URL.createObjectURL(file), im = new Image(); im.src = url; await im.decode(); URL.revokeObjectURL(url); return im;
    });
    const w = bmp.width, h = bmp.height, s = Math.min(1, MAX / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); if (bmp.close) bmp.close();
    return c;
  }
  /* Kanten finden: kleine Graustufen-Kopie, Otsu-Schwelle, größte helle Fläche, deren Extrempunkte als Ecken */
  function findCorners(src) {
    const S = 360 / Math.max(src.width, src.height), w = Math.max(8, Math.round(src.width * S)), h = Math.max(8, Math.round(src.height * S));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.filter = 'blur(2px)'; ctx.drawImage(src, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data, g = new Uint8Array(w * h), hist = new Uint32Array(256);
    for (let i = 0; i < w * h; i++) { const v = (px[i * 4] * 77 + px[i * 4 + 1] * 150 + px[i * 4 + 2] * 29) >> 8; g[i] = v; hist[v]++; }
    // Otsu
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sB = 0, wB = 0, best = 0, th = 128; const tot = w * h;
    for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; const wF = tot - wB; if (!wF) break; sB += t * hist[t]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) ** 2; if (v > best) { best = v; th = t; } }
    // größte zusammenhängende helle Fläche (4er-Nachbarschaft)
    const lab = new Int32Array(w * h).fill(-1); let bestN = 0, bestL = -1; const stack = [];
    for (let i = 0; i < w * h; i++) {
      if (lab[i] !== -1 || g[i] <= th) continue;
      let n = 0; stack.push(i); lab[i] = i;
      while (stack.length) { const k = stack.pop(); n++; const x = k % w, y = (k / w) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const j = yy * w + xx; if (lab[j] === -1 && g[j] > th) { lab[j] = i; stack.push(j); } } }
      if (n > bestN) { bestN = n; bestL = i; }
    }
    const full = [{ x: 0, y: 0 }, { x: src.width, y: 0 }, { x: src.width, y: src.height }, { x: 0, y: src.height }];
    if (bestN < tot * 0.08 || bestN > tot * 0.985) return { corners: full, found: false };
    // Extrempunkte: min(x+y), max(x−y), max(x+y), min(x−y)
    let tl = [1e9], tr = [-1e9], br = [-1e9], bl = [1e9];
    for (let i = 0; i < w * h; i++) {
      if (lab[i] !== bestL) continue;
      const x = i % w, y = (i / w) | 0, s = x + y, d = x - y;
      if (s < tl[0]) tl = [s, x, y]; if (s > br[0]) br = [s, x, y]; if (d > tr[0]) tr = [d, x, y]; if (d < bl[0]) bl = [d, x, y];
    }
    const k = 1 / S, P = p => ({ x: Math.max(0, Math.min(src.width, (p[1] + 0.5) * k)), y: Math.max(0, Math.min(src.height, (p[2] + 0.5) * k)) });
    const corners = [P(tl), P(tr), P(br), P(bl)];
    const area = Math.abs(corners.reduce((a, p, i) => { const q = corners[(i + 1) % 4]; return a + p.x * q.y - q.x * p.y; }, 0) / 2);
    if (area < src.width * src.height * 0.08) return { corners: full, found: false };
    return { corners, found: true };
  }
  /* Homographie aus 4 Punktpaaren (Gauß-Elimination) */
  function homography(from, to) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const { x, y } = from[i], { x: u, y: v } = to[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    for (let c = 0; c < 8; c++) {
      let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
      for (let r = 0; r < 8; r++) { if (r === c) continue; const f = A[r][c] / A[c][c]; for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
    }
    const h = b.map((v, i) => v / A[i][i]); h.push(1); return h;
  }
  function warp(src, cs) {
    const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    let W = Math.round(Math.max(d(cs[0], cs[1]), d(cs[3], cs[2]))), H = Math.round(Math.max(d(cs[0], cs[3]), d(cs[1], cs[2])));
    const s = Math.min(1, MAX / Math.max(W, H)); W = Math.max(8, Math.round(W * s)); H = Math.max(8, Math.round(H * s));
    // Abbildung Ziel → Quelle
    const h = homography([{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], cs);
    const sctx = src.getContext('2d', { willReadFrequently: true }), sd = sctx.getImageData(0, 0, src.width, src.height).data, sw = src.width, sh = src.height;
    const out = document.createElement('canvas'); out.width = W; out.height = H;
    const octx = out.getContext('2d'), od = octx.createImageData(W, H), o = od.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const z = h[6] * x + h[7] * y + 1, sx = (h[0] * x + h[1] * y + h[2]) / z, sy = (h[3] * x + h[4] * y + h[5]) / z;
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0, j = (y * W + x) * 4;
      if (x0 < 0 || y0 < 0 || x0 >= sw - 1 || y0 >= sh - 1) { o[j] = o[j + 1] = o[j + 2] = 255; o[j + 3] = 255; continue; }
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      for (let c = 0; c < 3; c++) o[j + c] = (sd[i00 + c] * (1 - fx) + sd[i10 + c] * fx) * (1 - fy) + (sd[i01 + c] * (1 - fx) + sd[i11 + c] * fx) * fy;
      o[j + 3] = 255;
    }
    octx.putImageData(od, 0, 0);
    return out;
  }
  /* Scan-Look: Weißabgleich über Hintergrundschätzung, dann Kontrast */
  function enhance(c, mode = 'gray') {
    if (mode === 'none') return c;
    const ctx = c.getContext('2d', { willReadFrequently: true }), w = c.width, h = c.height;
    // Hintergrund: stark verkleinert und weichgezeichnet
    const bw = Math.max(4, Math.round(w / 24)), bh = Math.max(4, Math.round(h / 24)), b = document.createElement('canvas'); b.width = bw; b.height = bh;
    const bctx = b.getContext('2d', { willReadFrequently: true }); bctx.filter = 'blur(2px)'; bctx.drawImage(c, 0, 0, bw, bh);
    const bg = bctx.getImageData(0, 0, bw, bh).data, im = ctx.getImageData(0, 0, w, h), p = im.data;
    for (let y = 0; y < h; y++) {
      const by = Math.min(bh - 1, (y * bh / h) | 0);
      for (let x = 0; x < w; x++) {
        const bx = Math.min(bw - 1, (x * bw / w) | 0), bi = (by * bw + bx) * 4, i = (y * w + x) * 4;
        let r = Math.min(255, p[i] * 255 / Math.max(40, bg[bi])), g = Math.min(255, p[i + 1] * 255 / Math.max(40, bg[bi + 1])), bl = Math.min(255, p[i + 2] * 255 / Math.max(40, bg[bi + 2]));
        if (mode === 'color') { p[i] = r; p[i + 1] = g; p[i + 2] = bl; continue; }
        let v = (r * 77 + g * 150 + bl * 29) >> 8;
        v = mode === 'bw' ? (v > 170 ? 255 : v < 110 ? 0 : (v - 110) * 255 / 60) : Math.min(255, Math.max(0, (v - 40) * 255 / 200));
        p[i] = p[i + 1] = p[i + 2] = v;
      }
    }
    ctx.putImageData(im, 0, 0);
    return c;
  }
  /* Ecken von Hand: Overlay mit 4 Griffen */
  function editCorners(src, corners) {
    return new Promise(resolve => {
      const back = document.createElement('div'); back.className = 'wbscan';
      back.innerHTML = `<div class="wbscan-box"><header><b>Ecken anpassen</b><span>Zieh die Punkte auf die Ecken des Belegs.</span></header><div class="wbscan-st"><canvas></canvas><svg></svg></div><footer><button class="b" data-x="full">Ganzes Bild</button><span style="flex:1"></span><button class="b" data-x="no">Abbrechen</button><button class="b p" data-x="ok">Übernehmen</button></footer></div>`;
      document.body.appendChild(back);
      const cv = back.querySelector('canvas'), svg = back.querySelector('svg'), st = back.querySelector('.wbscan-st');
      const maxW = Math.min(window.innerWidth - 48, 900), maxH = window.innerHeight - 180, s = Math.min(maxW / src.width, maxH / src.height, 1);
      cv.width = Math.round(src.width * s); cv.height = Math.round(src.height * s); cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
      st.style.width = cv.width + 'px'; st.style.height = cv.height + 'px';
      svg.setAttribute('viewBox', `0 0 ${cv.width} ${cv.height}`);
      let cs = corners.map(p => ({ x: p.x * s, y: p.y * s }));
      const draw = () => { svg.innerHTML = `<polygon points="${cs.map(p => `${p.x},${p.y}`).join(' ')}"/>${cs.map((p, i) => `<circle data-i="${i}" cx="${p.x}" cy="${p.y}" r="11"/>`).join('')}`; };
      draw();
      let drag = -1;
      svg.addEventListener('pointerdown', e => { const t = e.target.closest('circle'); if (!t) return; drag = +t.dataset.i; svg.setPointerCapture(e.pointerId); e.preventDefault(); });
      svg.addEventListener('pointermove', e => { if (drag < 0) return; const r = svg.getBoundingClientRect(); cs[drag] = { x: Math.max(0, Math.min(cv.width, e.clientX - r.left)), y: Math.max(0, Math.min(cv.height, e.clientY - r.top)) }; draw(); });
      svg.addEventListener('pointerup', () => { drag = -1; });
      const done = v => { back.remove(); resolve(v); };
      back.addEventListener('click', e => {
        const x = e.target.closest('[data-x]'); if (!x) return;
        if (x.dataset.x === 'full') { cs = [{ x: 0, y: 0 }, { x: cv.width, y: 0 }, { x: cv.width, y: cv.height }, { x: 0, y: cv.height }]; draw(); }
        else if (x.dataset.x === 'ok') done(cs.map(p => ({ x: p.x / s, y: p.y / s })));
        else done(null);
      });
    });
  }

  /* ---------- Belegtext auswerten ---------- */
  const amt = s => { s = String(s).replace(/\s/g, '').replace(/[€EUR]/gi, ''); if (/,\d{2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); else if (/\.\d{2}$/.test(s)) s = s.replace(/,/g, ''); const n = parseFloat(s); return isFinite(n) ? Math.round(n * 100) / 100 : null; };
  const AMT = '(-?\\d{1,3}(?:[.\\s]\\d{3})*[.,]\\d{2}|-?\\d+[.,]\\d{2})';
  const CATS = [
    [/tank|aral|shell|esso|jet\b|total|diesel|super e|benzin/i, 'Fahrtkosten'], [/bahn|db fern|ticket|flixbus|parken|park|taxi|uber|bvg|rheinbahn|moBiel/i, 'Fahrtkosten'],
    [/restaurant|café|cafe|bäckerei|backerei|imbiss|pizza|bewirtung|mcdonald|burger/i, 'Bewirtung'], [/hotel|übernacht|booking/i, 'Reisekosten'],
    [/media ?markt|saturn|cyberport|notebooksbilliger|apple|computer|laptop|monitor|maus|tastatur|usb|hdmi/i, 'Hardware'], [/hosting|domain|strato|ionos|hetzner|netcup|all-inkl|software|lizenz|abo|adobe|microsoft|google|github|openai|anthropic/i, 'Software und Dienste'],
    [/telekom|vodafone|o2|congstar|1&1|internet|mobilfunk/i, 'Telefon und Internet'], [/porto|post|dhl|hermes|dpd|briefmarke/i, 'Porto'],
    [/buch|thalia|hugendubel|fachbuch|schreibwaren|staples|büro|papier|druck/i, 'Büromaterial'], [/edeka|rewe|aldi|lidl|netto|kaufland|penny|dm\b|rossmann/i, 'Lebensmittel und Drogerie'],
  ];
  function receipt(text) {
    const lines = String(text || '').split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const all = lines.join('\n');
    // Betrag: Schlüsselwörter in Reihenfolge der Verlässlichkeit
    let total = null;
    for (const re of [/(?:zu\s*zahlen|gesamtbetrag|endbetrag|rechnungsbetrag|summe\s*eur|total|gesamt|summe|betrag|bar|ec[- ]?karte|kartenzahlung|girocard|visa|mastercard)[^\d\n-]{0,20}/i]) {
      for (const l of lines) { const m = new RegExp(re.source + AMT, 'i').exec(l); if (m) { const v = amt(m[1]); if (v != null && (total == null || /zu\s*zahlen|gesamt|summe|total/i.test(l))) { total = v; if (/zu\s*zahlen|gesamtbetrag|endbetrag/i.test(l)) break; } } }
    }
    if (total == null) { const all2 = [...all.matchAll(new RegExp(AMT, 'g'))].map(m => amt(m[1])).filter(v => v != null && v < 100000); if (all2.length) total = Math.max(...all2); }
    // Datum
    let date = '';
    const dm = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/.exec(all) || /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(all);
    if (dm) { let [, a, b2, c] = dm; if (a.length === 4) [a, c] = [c, a]; if (c.length === 2) c = '20' + c; if (+b2 >= 1 && +b2 <= 12 && +a >= 1 && +a <= 31) date = `${a.padStart(2, '0')}.${b2.padStart(2, '0')}.${c}`; }
    // Mehrwertsteuer
    let vatRate = null, vat = null;
    const vm = /(19|7)[,.]?0?0?\s*%[^\n]{0,30}?(\d+[.,]\d{2})/.exec(all) || /(?:mwst|ust|mehrwertsteuer)[^\n]{0,12}?(19|7)\s*%[^\n]{0,30}?(\d+[.,]\d{2})/i.exec(all);
    if (vm) { vatRate = +vm[1]; vat = amt(vm[2]); if (total != null && vat != null && vat > total * 0.2) vat = Math.round(total * vatRate / (100 + vatRate) * 100) / 100; }
    else if (/(19|7)\s*%/.test(all)) { vatRate = +/(19|7)\s*%/.exec(all)[1]; if (total != null) vat = Math.round(total * vatRate / (100 + vatRate) * 100) / 100; }
    // Händler: erste Zeile mit Buchstaben, keine Adresse/Datum
    const merchant = (lines.find(l => /[a-zäöü]{3}/i.test(l) && !/^(rechnung|beleg|kassenbon|quittung|datum|tel|www|steuer|ust|filiale|kasse|bon)/i.test(l) && !/\d{5}\s+\w/.test(l) && !/(str\.|straße|strasse)\s*\d/i.test(l)) || '').replace(/[^\p{L}\d&.,' -]/gu, '').trim().slice(0, 60);
    const no = (/(?:beleg|bon|rechnung|rg|re)[- .]*(?:nr|nummer)?[.:\s#]*([A-Z0-9-]{3,20})/i.exec(all) || [])[1] || '';
    const pay = /bar\b|bargeld/i.test(all) ? 'bar' : /ec|girocard|karte|visa|mastercard|maestro|kontaktlos|paypal/i.test(all) ? 'Karte' : '';
    const cat = (CATS.find(([re]) => re.test(all)) || [null, 'Sonstiges'])[1];
    return { merchant, date, total, vatRate, vat, no, pay, cat };
  }
  const CSS = `.wbscan{position:fixed;inset:0;z-index:400;background:rgb(10 14 22/.6);display:grid;place-items:center;padding:12px}
.wbscan-box{background:var(--raise,#fff);color:var(--ink,#1b2130);border-radius:14px;overflow:hidden;box-shadow:0 24px 70px rgb(0 0 0/.35);max-width:100%;font:14px/1.4 var(--f-ui,system-ui,sans-serif)}
.wbscan-box header{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline;padding:12px 16px}.wbscan-box header span{color:var(--muted,#5f6878);font-size:12.5px}
.wbscan-st{position:relative;margin:0 16px;touch-action:none}.wbscan-st canvas,.wbscan-st svg{position:absolute;inset:0;width:100%;height:100%}
.wbscan-st polygon{fill:rgb(31 79 216/.12);stroke:var(--accent,#1f4fd8);stroke-width:2}.wbscan-st circle{fill:#fff;stroke:var(--accent,#1f4fd8);stroke-width:3;cursor:grab}
.wbscan-box footer{display:flex;gap:8px;padding:12px 16px}.wbscan .b{border:1px solid var(--line,#dde1e8);background:var(--raise,#fff);color:inherit;border-radius:10px;padding:8px 14px;cursor:pointer;font:inherit}.wbscan .b.p{background:var(--accent,#1f4fd8);border-color:var(--accent,#1f4fd8);color:#fff}`;
  if (typeof document !== 'undefined') { const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); }
  global.WBScan = { load, findCorners, warp, enhance, editCorners, receipt, amt, CATS };
})(window);
