/* PDF Werkbank – Fotos und Scans als PDF-Seiten
 * Bilder (auch direkt von der Kamera) werden verkleinert, auf Wunsch wie ein Scan aufbereitet
 * (Graustufen, Weißabgleich, Kontrast) und je Bild als eigene Seite in eine PDF gesetzt.
 */
(function (global) {
  'use strict';
  const MAX = 2400; // längste Kante in Pixeln
  function loadImg(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), im = new Image();
      im.onload = () => { res({ im, url }); };
      im.onerror = () => { URL.revokeObjectURL(url); rej(new Error(`„${file.name}“ ist kein lesbares Bild.`)); };
      im.src = url;
    });
  }
  /* Scan-Look: Helligkeit je Bildpunkt, Weiß- und Schwarzpunkt aus dem Histogramm, leichte Gamma-Kurve */
  function scanify(ctx, w, h, color) {
    const d = ctx.getImageData(0, 0, w, h), px = d.data, hist = new Uint32Array(256);
    for (let i = 0; i < px.length; i += 4) hist[(px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8]++;
    const total = w * h; let acc = 0, lo = 0, hi = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > total * 0.01) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > total * 0.12) { hi = v; break; } } // Papier = hellster großer Anteil
    hi = Math.max(hi, lo + 40);
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) { const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo))); lut[v] = Math.round(255 * Math.pow(t, 1.35)); }
    for (let i = 0; i < px.length; i += 4) {
      if (color) { px[i] = lut[px[i]]; px[i + 1] = lut[px[i + 1]]; px[i + 2] = lut[px[i + 2]]; }
      else { const y = lut[(px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8]; px[i] = px[i + 1] = px[i + 2] = y; }
    }
    ctx.putImageData(d, 0, 0);
  }
  async function prepare(file, mode) {
    const { im, url } = await loadImg(file);
    try {
      const k = Math.min(1, MAX / Math.max(im.naturalWidth, im.naturalHeight));
      const w = Math.max(1, Math.round(im.naturalWidth * k)), h = Math.max(1, Math.round(im.naturalHeight * k));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: mode !== 'photo' });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(im, 0, 0, w, h);
      if (mode === 'scan' || mode === 'scancolor') scanify(ctx, w, h, mode === 'scancolor');
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', mode === 'photo' ? 0.86 : 0.8));
      return { bytes: new Uint8Array(await blob.arrayBuffer()), w, h };
    } finally { URL.revokeObjectURL(url); }
  }
  /* files: Bilder, opts.mode: photo | scan | scancolor, opts.page: 'a4' (A4, Ausrichtung nach Bild) | 'fit' (Seite = Bildgröße) */
  async function toPdf(files, opts = {}) {
    const PL = global.PDFLib, mode = opts.mode || 'photo', A4 = [595.28, 841.89];
    const doc = await PL.PDFDocument.create();
    let n = 0;
    for (const f of files) {
      if (!/^image\//.test(f.type) && !/\.(jpe?g|png|webp|gif|heic|bmp)$/i.test(f.name || '')) continue;
      const img = await prepare(f, mode);
      const jpg = await doc.embedJpg(img.bytes);
      let W, H;
      if (opts.page === 'fit') { const s = 72 / 150; W = img.w * s; H = img.h * s; } // ~150 dpi
      else { const land = img.w > img.h; W = land ? A4[1] : A4[0]; H = land ? A4[0] : A4[1]; }
      const pg = doc.addPage([W, H]);
      const m = opts.page === 'fit' ? 0 : 18, k = Math.min((W - 2 * m) / img.w, (H - 2 * m) / img.h);
      const dw = img.w * k, dh = img.h * k;
      pg.drawImage(jpg, { x: (W - dw) / 2, y: (H - dh) / 2, width: dw, height: dh });
      n++;
      if (opts.onProgress) opts.onProgress(n, files.length);
    }
    if (!n) throw new Error('Keine Bilder ausgewählt.');
    doc.setProducer('PDF Werkbank'); doc.setCreator('PDF Werkbank');
    return new Uint8Array(await doc.save());
  }
  global.WBPhotos = { toPdf };
})(window);
