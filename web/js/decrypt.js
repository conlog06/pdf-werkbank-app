/* PDF Werkbank – geschützte PDFs entschlüsseln
 * Viele PDFs (z. B. Vorlesungsfolien) sind mit einem Besitzer-Passwort verschlüsselt: Lesen geht ohne Passwort,
 * Bearbeiten und Speichern mit pdf-lib aber nicht. Solche Dateien werden einmal mit leerem Passwort entschlüsselt
 * (@cantoo/pdf-lib, nur bei Bedarf geladen). Dateien mit echtem Öffnen-Passwort bleiben unverändert.
 */
(function (global) {
  'use strict';
  const SRC = 'js/vendor/pdf-lib-crypt.min.js';
  let libP = null;
  function lib() {
    if (!libP) libP = new Promise((res, rej) => {
      const prev = global.PDFLib;                 // die normale pdf-lib nicht überschreiben
      const s = document.createElement('script'); s.src = SRC; s.async = true;
      s.onload = () => { const cp = global.PDFLib; global.PDFLib = prev; cp && cp !== prev ? res(cp) : rej(new Error('Entschlüsselung nicht verfügbar')); };
      s.onerror = () => { global.PDFLib = prev; libP = null; rej(new Error('Entschlüsselung konnte nicht geladen werden')); };
      document.head.appendChild(s);
    });
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
  global.WBDecrypt = { isEncrypted, decrypt, plain };
})(window);
