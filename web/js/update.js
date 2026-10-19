/* PDF Werkbank – automatische Updates
 * Webseite / Home-Bildschirm-App: prüft regelmäßig version.json und bietet die neue Version mit einem Tipp an
 *   (Service Worker holt dann alle Dateien frisch).
 * Desktop-App: zeigt den Stand des App-Updaters (Laden, bereit, Neustart).
 */
(function (global) {
  'use strict';
  const BUILD = '__WB_BUILD__'; // wird beim Veröffentlichen durch die Version ersetzt
  const DESK = global.wbDesktop || null;
  let bar = null, shown = '';

  function banner(html, actions) {
    if (!bar) {
      bar = document.createElement('div');
      bar.setAttribute('role', 'status');
      bar.style.cssText = 'position:fixed;z-index:9999;left:50%;transform:translateX(-50%);bottom:calc(16px + env(safe-area-inset-bottom,0px));display:flex;align-items:center;gap:10px;max-width:calc(100vw - 24px);padding:10px 10px 10px 16px;border-radius:14px;background:#1b2130;color:#fff;font:500 14px/1.35 "IBM Plex Sans",system-ui,sans-serif;box-shadow:0 10px 30px rgb(0 0 0 / .3)';
      document.body.appendChild(bar);
    }
    bar.innerHTML = `<span style="flex:1;min-width:0">${html}</span>` + actions.map((a, i) => `<button data-u="${i}" style="height:34px;padding:0 14px;border-radius:9px;border:0;cursor:pointer;font:600 13px system-ui,sans-serif;${a.primary ? 'background:#7598ff;color:#0c1120' : 'background:transparent;color:#cdd3df'}">${a.label}</button>`).join('');
    bar.onclick = e => { const b = e.target.closest('[data-u]'); if (b) actions[+b.dataset.u].run(); };
  }
  function hide() { if (bar) { bar.remove(); bar = null; } }
  function note(text) { banner(text, [{ label: 'OK', run: hide }]); setTimeout(hide, 4000); }

  /* vor dem Neuladen offene Änderungen sichern (Editor stellt global.wbFlush bereit) */
  async function flush() { try { if (global.wbFlush) await global.wbFlush(); } catch (e) { /* egal */ } }

  if (DESK && DESK.onUpdate) {
    DESK.onUpdate(s => {
      if (!s) return;
      if (s.state === 'downloading' && s.version) banner(`Update ${s.version} wird geladen … ${s.percent ? s.percent + ' %' : ''}`, []);
      else if (s.state === 'ready') banner(`<b>PDF Werkbank ${s.version}</b> ist bereit.`, [
        { label: 'Später', run: hide },
        { label: 'Jetzt neu starten', primary: true, run: async () => { await flush(); DESK.installUpdate(); } },
      ]);
      else if (s.state !== 'downloading') hide();
    });
    global.WBUpdate = { check: () => DESK.checkUpdate() };
    return;
  }

  async function check(manual) {
    if (BUILD.startsWith('__') || !/^https?:/.test(location.protocol)) { if (manual === true) note('Diese Ansicht hat keine Versionsprüfung.'); return; }
    try {
      const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      const v = (await r.json()).version;
      if (!v || v === BUILD) { if (manual === true) note(`Du hast die neueste Version (${BUILD}).`); return; }
      if (v === shown && manual !== true) return;
      shown = v;
      banner('<b>Neue Version</b> der PDF Werkbank ist da.', [
        { label: 'Später', run: hide },
        { label: 'Aktualisieren', primary: true, run: apply },
      ]);
    } catch (e) { /* offline */ }
  }
  async function apply() {
    banner('Wird aktualisiert …', []);
    await flush();
    try { const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); } catch (e) { /* egal */ }
    location.reload();
  }
  setTimeout(check, 4000);
  setInterval(check, 15 * 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  global.WBUpdate = { check, build: BUILD };
})(window);
