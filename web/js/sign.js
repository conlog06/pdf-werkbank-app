/* PDF Werkbank – digitale Signatur mit Zertifikat (ab Version 1.8)
 * Signiert PDFs nach dem PDF-Standard (PKCS#7 / CMS „adbe.pkcs7.detached“, SHA-256), so wie Acrobat es prüft.
 * Zertifikat: eigene .p12/.pfx-Datei (z. B. von der Hochschule, dem Arbeitgeber oder einem Anbieter) oder ein selbst
 * erstelltes Zertifikat. Es liegt nur auf diesem Gerät, mit deinem Passwort verschlüsselt.
 * Prüfen: zeigt für jede Signatur einer PDF, wer signiert hat, wann, und ob die Datei danach verändert wurde.
 * Kryptografie: node-forge (wird beim ersten Gebrauch geladen).
 */
(function (global) {
  'use strict';
  const C = () => global.WB_CONFIG || {};
  const PL = () => global.PDFLib;
  const KEY = 'pdfwb.cert';
  const SIGLEN = 12000; // Bytes für die Signatur (reicht für Zertifikatsketten mit 3–4 Zertifikaten)
  let forgeP = null;
  function loadForge() {
    if (global.forge && global.forge.pkcs7) return Promise.resolve(global.forge);
    if (!forgeP) forgeP = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = C().forgeScript || 'https://cdn.jsdelivr.net/npm/node-forge@1.3.1/dist/forge.min.js';
      s.onload = () => res(global.forge); s.onerror = () => { forgeP = null; rej(new Error('Signatur-Bibliothek konnte nicht geladen werden (offline?).')); };
      document.head.appendChild(s);
    });
    return forgeP;
  }
  const lsGet = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } };
  const lsSet = v => { try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch (e) { throw new Error('Zertifikat konnte nicht gespeichert werden.'); } };
  const toBin = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return s; };
  const fromBin = s => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };

  function field(subject, short) { const f = subject.getField(short); return f ? String(f.value) : ''; }
  function metaOf(forge, cert) {
    return {
      name: field(cert.subject, 'CN') || field(cert.subject, 'O') || 'Unbekannt',
      email: field(cert.subject, 'E') || (cert.subject.attributes.find(a => a.name === 'emailAddress') || {}).value || '',
      org: field(cert.subject, 'O'),
      issuer: field(cert.issuer, 'CN') || field(cert.issuer, 'O') || '',
      selfSigned: cert.subject.hash === cert.issuer.hash,
      from: +cert.validity.notBefore, to: +cert.validity.notAfter,
      serial: cert.serialNumber,
      fingerprint: forge.md.sha256.create().update(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes()).digest().toHex().slice(0, 32).replace(/(..)(?!$)/g, '$1:').toUpperCase(),
    };
  }
  /* PKCS#12 öffnen: Schlüssel und passendes Zertifikat (plus Kette) */
  function openP12(forge, der, password) {
    let p12;
    try { p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), false, password || ''); }
    catch (e) { const er = new Error(/mac|password|Invalid/i.test(e.message || '') ? 'Das Passwort stimmt nicht.' : 'Die Zertifikatsdatei kann nicht gelesen werden.'); er.password = /mac|password|Invalid/i.test(e.message || ''); throw er; }
    const keyBags = [...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || []), ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [])];
    const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || []).map(b => b.cert).filter(Boolean);
    const key = keyBags[0] && keyBags[0].key;
    if (!key) throw new Error('In der Datei ist kein privater Schlüssel (nur RSA-Schlüssel werden unterstützt).');
    const cert = certs.find(c => c.publicKey && c.publicKey.n && c.publicKey.n.equals(key.n)) || certs[0];
    if (!cert) throw new Error('In der Datei ist kein Zertifikat.');
    return { key, cert, chain: certs.filter(c => c !== cert) };
  }
  const info = () => { const c = lsGet(); return c ? c.meta : null; };
  async function importP12(bytes, password) {
    const forge = await loadForge(), der = toBin(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    const { cert } = openP12(forge, der, password);
    const meta = metaOf(forge, cert);
    lsSet({ p12: btoa(der), meta });
    return meta;
  }
  async function createSelfSigned({ name, email, org, password }) {
    if (!name) throw new Error('Bitte einen Namen eintragen.');
    if (!password || password.length < 6) throw new Error('Das Passwort muss mindestens 6 Zeichen haben.');
    const forge = await loadForge();
    const keys = await new Promise((res, rej) => forge.pki.rsa.generateKeyPair({ bits: 2048, workers: -1, workerScript: C().forgeWorker || undefined }, (e, k) => (e ? rej(e) : res(k))))
      .catch(() => forge.pki.rsa.generateKeyPair({ bits: 2048 }));
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01' + forge.util.bytesToHex(forge.random.getBytesSync(9));
    cert.validity.notBefore = new Date(Date.now() - 60000);
    cert.validity.notAfter = new Date(); cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 5);
    const attrs = [{ name: 'commonName', value: name }, ...(org ? [{ name: 'organizationName', value: org }] : []), { name: 'countryName', value: 'DE' }, ...(email ? [{ name: 'emailAddress', value: email }] : [])];
    cert.setSubject(attrs); cert.setIssuer(attrs);
    cert.setExtensions([{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: true, nonRepudiation: true }, { name: 'extKeyUsage', emailProtection: true }, ...(email ? [{ name: 'subjectAltName', altNames: [{ type: 1, value: email }] }] : [])]);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: '3des', friendlyName: name });
    const der = forge.asn1.toDer(p12).getBytes();
    const meta = metaOf(forge, cert);
    lsSet({ p12: btoa(der), meta });
    return meta;
  }
  const exportP12 = () => { const c = lsGet(); return c ? fromBin(atob(c.p12)) : null; };
  const remove = () => lsSet(null);
  async function checkPassword(password) { const forge = await loadForge(), c = lsGet(); if (!c) throw new Error('Kein Zertifikat eingerichtet.'); openP12(forge, atob(c.p12), password); return true; }

  /* ---------- Signieren ---------- */
  async function sign(bytes, o = {}) {
    const forge = await loadForge(), c = lsGet();
    if (!c) throw new Error('Kein Zertifikat eingerichtet.');
    const { key, cert, chain } = openP12(forge, atob(c.p12), o.password);
    if (Date.now() > +cert.validity.notAfter) throw new Error('Das Zertifikat ist abgelaufen.');
    const { PDFDocument, PDFName, PDFNumber, PDFHexString, PDFString, PDFArray, StandardFonts, rgb } = PL();
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const ctx = doc.context, pages = doc.getPages(), meta = metaOf(forge, cert), now = new Date();
    const vis = o.visible && pages[o.visible.page] ? o.visible : null;
    const pg = vis ? pages[vis.page] : pages[0];
    let rect = [0, 0, 0, 0];
    if (vis) {
      const [x, y, w, h] = vis.rect;
      rect = [x, y, x + w, y + h];
      const f = await doc.embedFont(StandardFonts.Helvetica), fb = await doc.embedFont(StandardFonts.HelveticaBold);
      const clean = s => Array.from(String(s)).map(ch => { try { f.encodeText(ch); return ch; } catch (e) { return '?'; } }).join('');
      pg.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(0.12, 0.31, 0.85), borderWidth: 0.8, color: rgb(0.95, 0.97, 1), opacity: 0.9, borderOpacity: 1 });
      const fs = Math.max(5, Math.min(9, h / 5.2));
      const lines = [[fb, 'Digital signiert von ' + meta.name], [f, now.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })], ...(o.reason ? [[f, 'Grund: ' + o.reason]] : []), ...(o.location ? [[f, 'Ort: ' + o.location]] : [])];
      lines.slice(0, Math.max(1, Math.floor((h - 4) / (fs * 1.3)))).forEach(([font, t], i) => {
        let s = clean(t); while (s.length > 4 && font.widthOfTextAtSize(s, fs) > w - 10) s = s.slice(0, -2) + '…';
        pg.drawText(s, { x: x + 5, y: y + h - 4 - fs - i * fs * 1.3, size: fs, font, color: rgb(0.11, 0.13, 0.19) });
      });
    }
    const byteRange = PDFArray.withContext(ctx);
    byteRange.push(PDFNumber.of(0)); for (let i = 0; i < 3; i++) byteRange.push(PDFName.of('**********'));
    const sigDict = ctx.obj({ Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: 'adbe.pkcs7.detached', ByteRange: byteRange, Contents: PDFHexString.of('0'.repeat(SIGLEN * 2)), M: PDFString.fromDate(now), Name: PDFString.of(meta.name) });
    if (o.reason) sigDict.set(PDFName.of('Reason'), PDFHexString.fromText(o.reason));
    if (o.location) sigDict.set(PDFName.of('Location'), PDFHexString.fromText(o.location));
    if (meta.email) sigDict.set(PDFName.of('ContactInfo'), PDFString.of(meta.email));
    const sigRef = ctx.register(sigDict);
    const form = doc.getForm();
    const taken = new Set(form.getFields().map(x => x.getName()));
    let n = 1; while (taken.has('Signatur' + n)) n++;
    const ap = ctx.register(ctx.stream('', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, rect[2] - rect[0], rect[3] - rect[1]] }));
    const widget = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', Rect: rect, V: sigRef, T: PDFHexString.fromText('Signatur' + n), F: 132, P: pg.ref, AP: { N: ap } }));
    pg.node.addAnnot(widget);
    form.acroForm.addField(widget);
    form.acroForm.dict.set(PDFName.of('SigFlags'), PDFNumber.of(3));
    const out = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
    // Platzhalter finden und Bereich eintragen
    const str = toBin(out);
    const hex0 = '<' + '0'.repeat(SIGLEN * 2) + '>';
    const cs = str.indexOf(hex0); if (cs < 0) throw new Error('Signaturplatz nicht gefunden.');
    const ce = cs + hex0.length;
    const brRx = /\/ByteRange\s*\[\s*0\s+\/\*{10}\s+\/\*{10}\s+\/\*{10}\s*\]/;
    const m = brRx.exec(str); if (!m) throw new Error('Signaturbereich nicht gefunden.');
    const br = [0, cs, ce, out.length - ce];
    let brTxt = `/ByteRange [${br.join(' ')}]`;
    if (brTxt.length > m[0].length) throw new Error('Signaturbereich zu lang.');
    brTxt = brTxt.padEnd(m[0].length, ' ');
    const signed = str.slice(0, m.index) + brTxt + str.slice(m.index + m[0].length);
    const data = signed.slice(0, cs) + signed.slice(ce);
    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer(data, 'raw');
    p7.addCertificate(cert); chain.forEach(x => p7.addCertificate(x));
    p7.addSigner({ key, certificate: cert, digestAlgorithm: forge.pki.oids.sha256, authenticatedAttributes: [{ type: forge.pki.oids.contentType, value: forge.pki.oids.data }, { type: forge.pki.oids.messageDigest }, { type: forge.pki.oids.signingTime, value: now }] });
    p7.sign({ detached: true });
    const hex = forge.util.bytesToHex(forge.asn1.toDer(p7.toAsn1()).getBytes());
    if (hex.length > SIGLEN * 2) throw new Error('Die Signatur ist zu groß.');
    const final = signed.slice(0, cs + 1) + hex.padEnd(SIGLEN * 2, '0') + signed.slice(ce - 1);
    return { bytes: fromBin(final), meta, time: now };
  }

  /* ---------- Prüfen ---------- */
  const MD = { '2.16.840.1.101.3.4.2.1': 'sha256', '1.3.14.3.2.26': 'sha1', '2.16.840.1.101.3.4.2.2': 'sha384', '2.16.840.1.101.3.4.2.3': 'sha512' };
  const pdfStr = (s, key) => { const m = new RegExp('/' + key + '\\s*(\\((?:\\\\.|[^\\\\)])*\\)|<[0-9A-Fa-f\\s]*>)').exec(s); if (!m) return ''; let v = m[1]; if (v[0] === '<') { const h = v.slice(1, -1).replace(/\s/g, ''); let b = ''; for (let i = 0; i < h.length; i += 2) b += String.fromCharCode(parseInt(h.substr(i, 2), 16)); v = b; } else v = v.slice(1, -1).replace(/\\([()\\])/g, '$1'); if (v.charCodeAt(0) === 254 && v.charCodeAt(1) === 255) { let o = ''; for (let i = 2; i + 1 < v.length; i += 2) o += String.fromCharCode((v.charCodeAt(i) << 8) | v.charCodeAt(i + 1)); return o; } return v; };
  const hasSignatures = bytes => /\/ByteRange\s*\[/.test(toBin(bytes.subarray(0, Math.min(bytes.length, 50e6))));
  async function verify(bytes) {
    const str = toBin(bytes), out = [], rx = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
    let m;
    if (!rx.test(str)) return out;
    rx.lastIndex = 0;
    const forge = await loadForge();
    while ((m = rx.exec(str))) {
      const [a, b, c, d] = m.slice(1, 5).map(Number), r = { coversAll: c + d === bytes.length, intact: false, valid: false };
      const around = str.slice(Math.max(0, m.index - 3000), b) + ' ' + str.slice(c, Math.min(str.length, c + 3000));
      r.reason = pdfStr(around, 'Reason'); r.location = pdfStr(around, 'Location');
      try {
        const hex = str.slice(b + 1, c - 1).replace(/[^0-9a-fA-F]/g, '');
        const der = forge.util.hexToBytes(hex.replace(/(00)+$/, '') || '00');
        const msg = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(der, { strict: false, parseAllBytes: false }));
        const rc = msg.rawCapture || {};
        const algo = MD[forge.asn1.derToOid(rc.digestAlgorithm)] || 'sha256';
        const content = str.slice(a, a + b) + str.slice(c, c + d);
        const dig = forge.md[algo].create(); dig.update(content, 'raw');
        const attrs = rc.authenticatedAttributes || [];
        let attrDigest = null, time = null;
        for (const at of attrs) {
          const oid = forge.asn1.derToOid(at.value[0].value);
          if (oid === forge.pki.oids.messageDigest) attrDigest = at.value[1].value[0].value;
          if (oid === forge.pki.oids.signingTime) { const v = at.value[1].value[0]; time = v.type === forge.asn1.Type.UTCTIME ? forge.asn1.utcTimeToDate(v.value) : forge.asn1.generalizedTimeToDate(v.value); }
        }
        r.intact = attrDigest != null && attrDigest === dig.digest().bytes();
        const set = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, attrs);
        const certs = msg.certificates || [];
        const signer = certs.find(cert => { try { const h = forge.md[algo].create(); h.update(forge.asn1.toDer(set).getBytes()); return cert.publicKey.verify(h.digest().bytes(), rc.signature); } catch (e) { return false; } });
        r.valid = !!signer;
        const cert = signer || certs[0];
        if (cert) Object.assign(r, metaOf(forge, cert));
        r.time = time ? +time : null;
        if (!time) { const mm = pdfStr(around, 'M'); const t = /D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(mm); if (t) r.time = +new Date(+t[1], t[2] - 1, +t[3], +t[4], +t[5], +t[6]); }
        r.expired = cert ? (r.time || Date.now()) > +cert.validity.notAfter : false;
        r.trusted = !!cert && !r.selfSigned && certs.some(x => x !== cert && x.subject.hash === cert.issuer.hash);
      } catch (e) { r.error = 'Signatur nicht lesbar (' + (e.message || e) + ')'; }
      out.push(r);
    }
    return out;
  }
  global.WBSign = { loadForge, info, importP12, createSelfSigned, exportP12, remove, checkPassword, sign, verify, hasSignatures };
})(window);
