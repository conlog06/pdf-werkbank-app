/* PDF Werkbank – geschützte PDFs entschlüsseln
 * Viele PDFs (z. B. Vorlesungsfolien) sind mit einem Besitzer-Passwort verschlüsselt: Lesen geht ohne Passwort,
 * Bearbeiten und Speichern mit pdf-lib aber nicht. Solche Dateien werden einmal mit leerem Passwort entschlüsselt
 * (@cantoo/pdf-lib, nur bei Bedarf geladen). Dateien mit echtem Öffnen-Passwort bleiben unverändert.
 */
(function (global) {
  'use strict';
  // lokal mitgeliefert (Webseite, Desktop-App), sonst vom CDN (z. B. in der Artifact-Fassung)
  const SRCS = ['js/vendor/pdf-lib-crypt.min.js', 'https://cdn.jsdelivr.net/npm/@cantoo/pdf-lib@2.11.1/dist/pdf-lib.min.js'];
  let libP = null;
  function load(src) {
    return new Promise((res, rej) => {
      const prev = global.PDFLib;                 // die normale pdf-lib nicht überschreiben
      const s = document.createElement('script'); s.src = src; s.async = true;
      s.onload = () => { const cp = global.PDFLib; global.PDFLib = prev; cp && cp !== prev ? res(cp) : rej(new Error('Entschlüsselung nicht verfügbar')); };
      s.onerror = () => { global.PDFLib = prev; s.remove(); rej(new Error('Entschlüsselung konnte nicht geladen werden')); };
      document.head.appendChild(s);
    });
  }
  function lib() {
    if (!libP) libP = (async () => { let err; for (const src of SRCS) { try { return await load(src); } catch (e) { err = e; } } throw err; })().catch(e => { libP = null; throw e; });
    return libP;
  }
  /* prüfen, ob der gültige (letzte) Trailer ein /Encrypt-Wörterbuch nennt */
  function isEncrypted(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const latin = (a, b) => { let t = ''; for (let i = Math.max(0, a); i < Math.min(u8.length, b); i++) t += String.fromCharCode(u8[i]); return t; };
    const tail = latin(u8.length - 2048, u8.length);
    const sx = tail.lastIndexOf('startxref');
    if (sx >= 0) {
      const off = parseInt(tail.slice(sx + 9).trim(), 10);
      if (off >= 0 && off < u8.length) {
        let head = latin(off, off + 65536);
        if (/^\s*xref/.test(head)) { const t = head.indexOf('trailer'); head = t >= 0 ? head.slice(t, head.indexOf('startxref', t) > 0 ? head.indexOf('startxref', t) : t + 4096) : ''; }
        else { const st = head.indexOf('stream'); head = st > 0 ? head.slice(0, st) : head.slice(0, 4096); }
        if (head) return /\/Encrypt\b/.test(head);
      }
    }
    // Trailer nicht lesbar: ganze Datei durchsuchen
    return /\/Encrypt\b/.test(latin(0, u8.length));
  }
  /* liefert die entschlüsselten Bytes oder null (z. B. wenn ein Öffnen-Passwort nötig ist) */
  async function decrypt(bytes) {
    try {
      const CP = await lib();
      const doc = await CP.PDFDocument.load(bytes, { password: '', updateMetadata: false });
      return new Uint8Array(await doc.save({ useObjectStreams: true }));
    } catch (e) { console.warn('Entschlüsseln nicht möglich', e); return null; }
  }
  /* bequem: nur wenn nötig entschlüsseln */
  async function plain(bytes) {
    if (!isEncrypted(bytes)) return { bytes, changed: false };
    const d = await decrypt(bytes);
    return d ? { bytes: d, changed: true } : { bytes, changed: false, locked: true };
  }
  /* mit Passwort schützen (AES-256); perms: { print, copy, edit } */
  async function encrypt(bytes, password, perms = {}) {
    const CP = await lib();
    const doc = await CP.PDFDocument.load(bytes, { updateMetadata: false });
    const owner = perms.owner || password + ':' + Math.random().toString(36).slice(2, 10);
    doc.encrypt({
      userPassword: password, ownerPassword: owner,
      permissions: { printing: perms.print === false ? false : 'highResolution', copying: perms.copy !== false, modifying: !!perms.edit, annotating: !!perms.edit, fillingForms: true, contentAccessibility: true, documentAssembly: !!perms.edit },
    });
    return new Uint8Array(await doc.save({ useObjectStreams: false }));
  }
  global.WBDecrypt = { isEncrypted, decrypt, plain, encrypt };
})(window);
