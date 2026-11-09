/* PDF Werkbank – Stabilität: Fehler mitschreiben (letzte 60, nur lokal), Speicherplatz prüfen
 * In der Desktop-App gehen Fehler zusätzlich in die Logdatei. „Fehlerprotokoll kopieren“ in den Einstellungen. */
(function (global) {
  'use strict';
  const KEY = 'pdfwb.errlog', DESK = global.wbDesktop || null;
  let list = [];
  try { list = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { list = []; }
  let last = '', lastT = 0;
  function add(kind, msg, src) {
    msg = String(msg || '').slice(0, 600);
    if (!msg || /ResizeObserver loop|RenderingCancelled|AbortError/.test(msg)) return;
    const now = Date.now();
    if (msg === last && now - lastT < 3000) return; // keine Fehlerflut
    last = msg; lastT = now;
    list.push({ t: now, k: kind, m: msg, s: String(src || '').slice(0, 200), p: location.pathname.split('/').pop() });
    if (list.length > 60) list = list.slice(-60);
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* voll */ }
    if (DESK && DESK.reportError) try { DESK.reportError(`${kind}: ${msg} ${src || ''}`); } catch (e) { /* egal */ }
  }
  global.addEventListener('error', e => add('Fehler', e.message || (e.error && e.error.message), (e.filename || '') + ':' + (e.lineno || '')));
  global.addEventListener('unhandledrejection', e => { const r = e.reason; add('Promise', (r && (r.stack || r.message)) || r); });
  async function storage() {
    try {
      if (!navigator.storage || !navigator.storage.estimate) return null;
      const { usage, quota } = await navigator.storage.estimate();
      return { usage, quota, ratio: quota ? usage / quota : 0, persisted: navigator.storage.persisted ? await navigator.storage.persisted() : null };
    } catch (e) { return null; }
  }
  const mb = n => (n / 1048576).toFixed(n > 1e9 ? 0 : 1).replace('.', ',') + ' MB';
  async function report() {
    const st = await storage();
    let desk = null;
    if (DESK && DESK.diag) try { desk = await DESK.diag(); } catch (e) { desk = null; }
    const v = (global.WB_BUILD || '') || (document.querySelector('meta[name=wb-build]') || {}).content || '';
    return [
      'PDF Werkbank – Fehlerprotokoll', new Date().toLocaleString('de-DE'),
      desk ? `Desktop-App ${desk.version} · ${desk.platform} · Electron ${desk.electron}` : 'Webseite ' + v,
      navigator.userAgent,
      st ? `Speicher: ${mb(st.usage)} von ${mb(st.quota)} belegt${st.persisted ? ' (dauerhaft)' : ''}` : '',
      '', ...list.slice(-40).map(x => `${new Date(x.t).toLocaleString('de-DE')} [${x.p}] ${x.k}: ${x.m} ${x.s}`),
      ...(desk && desk.log ? ['', '--- Logdatei der App ---', desk.log.slice(-8000)] : []),
    ].filter(x => x !== null).join('\n');
  }
  function clear() { list = []; try { localStorage.removeItem(KEY); } catch (e) { /* egal */ } }
  /* Warnung, wenn der Browser-Speicher knapp wird (Bibliothek und Sitzung liegen in IndexedDB) */
  async function checkSpace(warn) {
    const st = await storage();
    if (st && st.ratio > 0.85 && warn) warn(`Der Speicher für die Bibliothek ist zu ${Math.round(st.ratio * 100)} % voll (${mb(st.usage)} von ${mb(st.quota)}). Alte Dokumente im Papierkorb endgültig löschen oder in Drive sichern.`);
    return st;
  }
  global.WBDiag = { report, clear, storage, checkSpace, count: () => list.length, mb };
})(window);
