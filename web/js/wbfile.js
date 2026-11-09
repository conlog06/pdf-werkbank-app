/* PDF Werkbank – eigenes Dateiformat „.werkbank“
 * Ein ZIP-Container, der alles bearbeitbar hält: Original-PDFs, alle Markierungen, Stifte, Texte,
 * Live-Graphen, Lesezeichen und Formularwerte. Lässt sich verschicken und überall wieder öffnen
 * (Webseite, Desktop-App, iPad). Aufbau:
 *   werkbank.json        { format: 'pdf-werkbank', version: 1, name, created, app }
 *   state.json           Bearbeitungsstand (Seiten mit Elementen, Bilder als data:-URLs, …)
 *   sources/<id>.pdf     Original-PDFs (unverändert)
 *   sources/<id>.json    { name } der Quelle
 *   preview.pdf          optional: fertige PDF mit allem eingebrannt, für Programme ohne Werkbank
 */
(function (global) {
  'use strict';
  const MIME = 'application/x-pdf-werkbank', EXT = '.werkbank';
  const enc = new TextEncoder(), dec = new TextDecoder();
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = u8 => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  /* ZIP ohne Kompression (PDFs sind schon komprimiert) – files: [{ name, bytes }] */
  function zip(files, type = 'application/zip') {
    const parts = [], central = [];
    let off = 0;
    const dt = new Date(), dosT = (dt.getHours() << 11) | (dt.getMinutes() << 5) | (dt.getSeconds() >> 1), dosD = ((dt.getFullYear() - 1980) << 9) | ((dt.getMonth() + 1) << 5) | dt.getDate();
    for (const f of files) {
      const bytes = f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(f.bytes);
      const name = enc.encode(f.name), crc = crc32(bytes), n = bytes.length;
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
      h.setUint16(10, dosT, true); h.setUint16(12, dosD, true); h.setUint32(14, crc, true); h.setUint32(18, n, true); h.setUint32(22, n, true); h.setUint16(26, name.length, true);
      parts.push(new Uint8Array(h.buffer), name, bytes);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint16(12, dosT, true); c.setUint16(14, dosD, true); c.setUint32(16, crc, true); c.setUint32(20, n, true); c.setUint32(24, n, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + n;
    }
    const csize = central.reduce((a, b) => a + b.length, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type });
  }
  /* ZIP lesen (gespeichert oder „deflate“, falls jemand die Datei neu verpackt hat) */
  async function unzip(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Keine gültige Werkbank-Datei (ZIP-Verzeichnis fehlt).');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const out = new Map();
    for (let k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Werkbank-Datei ist beschädigt.');
      const method = dv.getUint16(p + 10, true), csz = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), loc = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      const lnlen = dv.getUint16(loc + 26, true), lxlen = dv.getUint16(loc + 28, true), start = loc + 30 + lnlen + lxlen;
      let data = u8.subarray(start, start + csz);
      if (method === 8) {
        if (!global.DecompressionStream) throw new Error('Dieser Browser kann komprimierte Werkbank-Dateien nicht entpacken.');
        data = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      } else if (method !== 0) throw new Error('Unbekannte Kompression in der Werkbank-Datei.');
      out.set(name, data.slice());
      p += 46 + nlen + xlen + clen;
    }
    return out;
  }
  const isZip = u8 => u8 && u8.length > 4 && u8[0] === 0x50 && u8[1] === 0x4b && u8[2] === 3 && u8[3] === 4;
  const isWerkbank = (u8, name) => (name ? /\.werkbank$/i.test(name) : false) || (isZip(u8) && !(name && /\.zip$/i.test(name)));
  /* state: Bearbeitungsstand (docState), sources: [{ id, name, bytes }], preview: Uint8Array (optional) */
  function pack({ name, state, sources, preview }) {
    const files = [
      { name: 'werkbank.json', bytes: enc.encode(JSON.stringify({ format: 'pdf-werkbank', version: 1, name: name || state.docName || 'Dokument', created: new Date().toISOString(), app: 'PDF Werkbank' }, null, 1)) },
      { name: 'state.json', bytes: enc.encode(JSON.stringify(state)) },
    ];
    for (const s of sources) {
      files.push({ name: `sources/${s.id}.pdf`, bytes: s.bytes });
      files.push({ name: `sources/${s.id}.json`, bytes: enc.encode(JSON.stringify({ name: s.name || s.id + '.pdf' })) });
    }
    if (preview) files.push({ name: 'preview.pdf', bytes: preview });
    return zip(files, MIME);
  }
  async function unpack(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const files = await unzip(u8);
    const man = files.get('werkbank.json');
    if (!man) throw new Error('Das ist keine PDF-Werkbank-Datei.');
    const manifest = JSON.parse(dec.decode(man));
    if (manifest.format !== 'pdf-werkbank') throw new Error('Das ist keine PDF-Werkbank-Datei.');
    if (manifest.version > 1) throw new Error('Diese Werkbank-Datei stammt aus einer neueren Version. Bitte PDF Werkbank aktualisieren.');
    const state = files.has('state.json') ? JSON.parse(dec.decode(files.get('state.json'))) : null;
    const sources = new Map();
    for (const [n, data] of files) {
      const m = /^sources\/([^/]+)\.pdf$/.exec(n); if (!m) continue;
      let meta = {}; try { meta = JSON.parse(dec.decode(files.get(`sources/${m[1]}.json`) || enc.encode('{}'))); } catch (e) { meta = {}; }
      sources.set(m[1], { id: m[1], name: meta.name || m[1] + '.pdf', bytes: data });
    }
    return { manifest, state, sources, preview: files.get('preview.pdf') || null };
  }
  global.WBFile = { pack, unpack, zip, unzip, isWerkbank, isZip, MIME, EXT };
})(window);
