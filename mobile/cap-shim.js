/* PDF Werkbank – Android-App (Capacitor): Downloads teilen, Start in der Bibliothek */
(function () {
  'use strict';
  const C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return;
  document.documentElement.classList.add('native-app');
  window.WB_CONFIG = window.WB_CONFIG || {};
  window.WB_CONFIG.nativeApp = 'android';
  // Start: Bibliothek statt leerem Editor
  try {
    if (/\/index\.html$|\/$/.test(location.pathname) && !location.search && !sessionStorage.getItem('wb.started')) { sessionStorage.setItem('wb.started', '1'); location.replace('library.html'); return; }
    sessionStorage.setItem('wb.started', '1');
  } catch (e) { /* weiter */ }
  const P = C.Plugins || {};
  const b64 = async blob => { const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return btoa(s); };
  async function shareBlob(blob, name) {
    const safe = String(name || 'Datei').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120);
    const r = await P.Filesystem.writeFile({ path: safe, data: await b64(blob), directory: 'CACHE' });
    await P.Share.share({ title: safe, files: [r.uri], dialogTitle: 'Speichern oder teilen' });
  }
  window.wbNativeSave = shareBlob;
  // Alle Downloads (<a download>) über „Teilen“ (Dateien, Drive, Mail …)
  document.addEventListener('click', async e => {
    const a = e.target && e.target.closest ? e.target.closest('a[download]') : null;
    if (!a || !a.href) return;
    e.preventDefault(); e.stopPropagation();
    try { const blob = await (await fetch(a.href)).blob(); await shareBlob(blob, a.download); }
    catch (er) { if (!/cancel/i.test(String(er && er.message))) alert('Speichern nicht möglich: ' + (er.message || er)); }
  }, true);
})();
