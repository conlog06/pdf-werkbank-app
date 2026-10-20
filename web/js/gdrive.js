/* PDF Werkbank – automatisches Backup in Google Drive (wie bei GoodNotes)
 * Jedes Dokument der Bibliothek liegt als PDF in „PDF Werkbank/<Ordner>/<Unterordner>/<Name>.pdf“.
 * Nach Änderungen, Umbenennen oder Verschieben wird die Datei in Drive angepasst.
 *
 * Anmeldung:
 *   Webseite      – Google Identity Services (Token gilt 1 Stunde, danach ein Klick auf „Fortsetzen“)
 *   Desktop-App   – Anmeldung im System-Browser, die App erneuert den Zugang selbst (window.wbDesktop)
 * Zugriff nur auf Dateien, die die Werkbank selbst angelegt hat (Bereich drive.file).
 */
(function (global) {
  'use strict';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file openid email';
  const FOLDER = 'application/vnd.google-apps.folder';
  const DESK = global.wbDesktop || null;
  const C = () => global.WB_CONFIG || {};
  const API = () => (C().googleApiBase || 'https://www.googleapis.com');
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* egal */ } };

  /* Einstellungen und Zustand (pro Gerät) */
  const S = Object.assign({ enabled: false, email: '', root: 'PDF Werkbank', rootId: '', lastRun: 0, mode: 'change', exclude: [], noCellular: false }, JSON.parse(lsGet('pdfwb.gdrive') || '{}'));
  /* Wann gesichert wird: change = kurz nach jeder Änderung, hourly = höchstens stündlich, close = beim Schließen eines Dokuments,
     daily = einmal am Tag, manual = nur über „Jetzt sichern“ */
  const MODES = { change: 'Nach jeder Änderung', hourly: 'Höchstens einmal pro Stunde', close: 'Beim Schließen eines Dokuments', daily: 'Einmal am Tag', manual: 'Nur manuell' };
  const PERIOD = { hourly: 3600e3, daily: 20 * 3600e3 };
  const save = () => lsSet('pdfwb.gdrive', JSON.stringify(S));
  let tok = JSON.parse(lsGet('pdfwb.gdrive.tok') || 'null'); // nur Webseite: { token, exp }
  const st = { status: S.enabled ? 'idle' : 'off', error: '', failed: [], running: false, again: false, timer: 0, done: 0, total: 0 };
  const listeners = new Set();
  const info = () => ({ ...st, enabled: S.enabled, email: S.email, root: S.root, rootId: S.rootId, lastRun: S.lastRun, configured: configured(), desktop: !!DESK, mode: S.mode, exclude: S.exclude.slice(), noCellular: !!S.noCellular, modes: MODES, next: nextRun() });
  const cellular = () => { const c = navigator.connection; return !!(c && (c.type === 'cellular' || c.saveData)); };
  const emit = () => listeners.forEach(f => { try { f(info()); } catch (e) { console.error(e); } });
  const set = (status, error = '') => { st.status = status; st.error = error; emit(); };

  function configured() {
    const c = C();
    if (c.googleApiBase && c.googleFake) return true; // Tests
    return DESK ? !!(c.googleDesktopClientId && c.googleDesktopSecret) : !!c.googleClientId;
  }
  class NeedAuth extends Error { constructor() { super('Google Drive muss neu verbunden werden.'); this.needAuth = true; } }

  /* ---------- Anmeldung ---------- */
  let gisP = null;
  function loadGis() {
    if (global.google && global.google.accounts && global.google.accounts.oauth2) return Promise.resolve();
    if (!gisP) gisP = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = () => res(); s.onerror = () => { gisP = null; rej(new Error('Google-Anmeldung konnte nicht geladen werden.')); };
      document.head.appendChild(s);
    });
    return gisP;
  }
  /* Webseite: Token holen – muss aus einem Klick heraus aufgerufen werden (Popup) */
  async function webAuth(consent) {
    await loadGis();
    return new Promise((res, rej) => {
      const client = global.google.accounts.oauth2.initTokenClient({
        client_id: C().googleClientId, scope: SCOPE, hint: S.email || undefined,
        callback: r => {
          if (r.error) { rej(new Error(r.error_description || r.error)); return; }
          tok = { token: r.access_token, exp: Date.now() + (r.expires_in - 120) * 1000 };
          lsSet('pdfwb.gdrive.tok', JSON.stringify(tok));
          res(tok.token);
        },
        error_callback: e => rej(new Error(e && e.type === 'popup_closed' ? 'Anmeldung abgebrochen.' : (e && e.message) || 'Anmeldung fehlgeschlagen.')),
      });
      client.requestAccessToken({ prompt: consent ? 'consent' : '' });
    });
  }
  async function token() {
    const c = C();
    if (c.googleFake) return 'test';
    if (DESK) {
      const r = await DESK.googleToken({ clientId: c.googleDesktopClientId, secret: c.googleDesktopSecret });
      if (!r || !r.token) throw new NeedAuth();
      return r.token;
    }
    if (tok && tok.exp > Date.now()) return tok.token;
    throw new NeedAuth();
  }
  async function connect() {
    const c = C();
    let email = '';
    if (c.googleFake) email = 'test@example.com';
    else if (DESK) {
      const r = await DESK.googleConnect({ clientId: c.googleDesktopClientId, secret: c.googleDesktopSecret });
      email = (r && r.email) || '';
    } else {
      const t = await webAuth(true);
      try { const u = await (await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + t } })).json(); email = u.email || ''; } catch (e) { /* egal */ }
    }
    S.enabled = true; S.email = email; S.rootId = ''; save();
    set('idle');
    schedule(300);
    return info();
  }
  /* Webseite: abgelaufene Anmeldung mit einem Klick erneuern */
  async function resume() {
    if (DESK) { schedule(100); return; }
    await webAuth(false);
    set('idle'); schedule(100);
  }
  async function disconnect() {
    const c = C();
    try {
      if (DESK && DESK.googleDisconnect) await DESK.googleDisconnect();
      else if (tok && global.google && global.google.accounts) global.google.accounts.oauth2.revoke(tok.token, () => {});
    } catch (e) { /* egal */ }
    tok = null; lsSet('pdfwb.gdrive.tok', null);
    S.enabled = false; S.email = ''; S.rootId = ''; save();
    // Zuordnungen vergessen, beim nächsten Verbinden wird neu abgeglichen
    for (const k of Object.keys(localStorage)) if (k.startsWith('pdfwb.gd.')) lsSet(k, null);
    set('off');
  }

  /* ---------- Drive-API ---------- */
  async function api(path, opts = {}, retry = true) {
    const t = await token();
    const r = await fetch(API() + path, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + t } });
    if (r.status === 401) {
      tok = null; lsSet('pdfwb.gdrive.tok', null);
      if (DESK && retry) return api(path, opts, false);
      throw new NeedAuth();
    }
    if (r.status === 404) { const e = new Error('nicht gefunden'); e.notFound = true; throw e; }
    if (!r.ok) {
      let m = r.status + '';
      try { const j = await r.json(); m = (j.error && j.error.message) || m; } catch (e) { /* egal */ }
      if (r.status === 403 && /has not been used|disabled/i.test(m)) m = 'Die Google-Drive-API ist im Cloud-Projekt nicht aktiviert.';
      throw new Error(m);
    }
    return r.status === 204 ? null : r.json();
  }
  const q = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  async function findOne(name, parent, folder) {
    const query = `name = ${q(name)} and ${q(parent)} in parents and trashed = false and mimeType ${folder ? '=' : '!='} '${FOLDER}'`;
    const r = await api('/drive/v3/files?fields=files(id,name,parents)&pageSize=10&q=' + encodeURIComponent(query));
    return (r.files || [])[0] || null;
  }
  async function makeFolder(name, parent) {
    return api('/drive/v3/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }) });
  }
  /* Hauptordner „PDF Werkbank“ */
  async function rootId() {
    if (S.rootId) return S.rootId;
    const r = await api('/drive/v3/files?fields=files(id)&q=' + encodeURIComponent(`name = ${q(S.root)} and mimeType = '${FOLDER}' and 'root' in parents and trashed = false`));
    S.rootId = (r.files && r.files[0] && r.files[0].id) || (await makeFolder(S.root, 'root')).id;
    save();
    return S.rootId;
  }
  /* Ordnerpfad anlegen bzw. finden; Zuordnung Bibliotheksordner → Drive-Ordner merken */
  const folderKey = id => 'pdfwb.gd.folder.' + id;
  async function folderFor(libFolderId, byId) {
    if (!libFolderId) return rootId();
    const f = byId.get(libFolderId);
    if (!f) return rootId();
    const parent = await folderFor(f.parent || null, byId);
    const known = JSON.parse(lsGet(folderKey(f.id)) || 'null');
    const name = safeName(f.name);
    if (known && known.parent === parent) {
      if (known.name !== name) {
        try { await api(`/drive/v3/files/${known.id}?fields=id`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }); }
        catch (e) { if (!e.notFound) throw e; lsSet(folderKey(f.id), null); return folderFor(libFolderId, byId); }
        lsSet(folderKey(f.id), JSON.stringify({ ...known, name }));
      }
      return known.id;
    }
    if (known && known.parent !== parent) {
      // Ordner wurde verschoben: in Drive mitziehen
      try {
        await api(`/drive/v3/files/${known.id}?addParents=${parent}&removeParents=${known.parent}&fields=id`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
        lsSet(folderKey(f.id), JSON.stringify({ id: known.id, parent, name }));
        return known.id;
      } catch (e) { if (!e.notFound) throw e; }
    }
    const found = await findOne(name, parent, true);
    const id = found ? found.id : (await makeFolder(name, parent)).id;
    lsSet(folderKey(f.id), JSON.stringify({ id, parent, name }));
    return id;
  }
  const safeName = s => String(s || 'Ohne Namen').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim().slice(0, 180) || 'Ohne Namen';

  /* ---------- ein Dokument sichern ---------- */
  const fileKey = id => 'pdfwb.gd.file.' + id;
  const backupInfo = id => JSON.parse(lsGet(fileKey(id)) || 'null');
  async function upload(meta, bytes, fileId) {
    const boundary = 'wb' + Math.random().toString(36).slice(2);
    const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`;
    const body = new Blob([head, bytes, `\r\n--${boundary}--`]);
    const url = fileId ? `/upload/drive/v3/files/${fileId}?uploadType=multipart&fields=id` : '/upload/drive/v3/files?uploadType=multipart&fields=id';
    return api(url, { method: fileId ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  }
  /* item: Dokument aus der Bibliothek, bytes: fertige PDF */
  async function backupDoc(item, bytes, items) {
    items = items || await global.WBStore.all();
    const byId = new Map(items.map(i => [i.id, i]));
    const parent = await folderFor(item.folder || null, byId);
    const name = safeName(item.name) + '.pdf';
    let known = backupInfo(item.id);
    let fileId = known && known.id;
    if (fileId) {
      try {
        const meta = { name };
        if (known.parent !== parent) {
          await api(`/drive/v3/files/${fileId}?addParents=${parent}&removeParents=${known.parent}&fields=id`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta) });
        }
        await upload(meta, bytes, fileId);
      } catch (e) { if (!e.notFound) throw e; fileId = null; }
    }
    if (!fileId) {
      // vielleicht hat ein anderes Gerät die Datei schon angelegt
      const found = await findOne(name, parent, false);
      fileId = found ? (await upload({ name }, bytes, found.id)).id : (await upload({ name, parents: [parent], mimeType: 'application/pdf', description: 'PDF Werkbank' }, bytes)).id;
    }
    lsSet(fileKey(item.id), JSON.stringify({ id: fileId, parent, name, rev: item.rev, at: Date.now() }));
    return fileId;
  }
  /* Dokument in Drive in den Papierkorb (gelöscht oder in den Werkbank-Papierkorb gelegt) */
  async function trashDoc(id) {
    const known = backupInfo(id); if (!known) return;
    try { await api(`/drive/v3/files/${known.id}?fields=id`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) }); }
    catch (e) { if (!e.notFound) throw e; }
    lsSet(fileKey(id), null);
  }

  /* ---------- Abgleich: welche Dokumente brauchen ein neues Backup? ---------- */
  function alive(i, byId) {
    let cur = i, n = 0;
    while (cur && n++ < 64) { if (cur.trashed || cur.deleted) return false; const p = cur.kind === 'folder' ? cur.parent : cur.folder; cur = p ? byId.get(p) : null; }
    return true;
  }
  /* liegt das Dokument in einem vom Backup ausgenommenen Ordner (oder darunter)? */
  function excluded(i, byId) {
    if (!S.exclude.length) return false;
    let f = i.folder ? byId.get(i.folder) : null, n = 0;
    while (f && n++ < 64) { if (S.exclude.includes(f.id)) return true; f = f.parent ? byId.get(f.parent) : null; }
    return false;
  }
  function pathKey(i, byId) {
    const parts = []; let f = i.folder ? byId.get(i.folder) : null, n = 0;
    while (f && n++ < 64) { parts.unshift(f.id + ':' + f.name); f = f.parent ? byId.get(f.parent) : null; }
    return parts.join('/') + '/' + i.name;
  }
  async function pending() {
    const items = await global.WBStore.all(true), byId = new Map(items.map(i => [i.id, i]));
    const todo = [], gone = [];
    for (const i of items) {
      if (i.kind !== 'doc') continue;
      const known = backupInfo(i.id);
      if (i.deleted || !alive(i, byId)) { if (known) gone.push(i.id); continue; }
      if (i.missing) continue; // liegt noch nicht auf diesem Gerät
      if (excluded(i, byId)) continue; // ausgenommener Ordner: vorhandenes Backup bleibt unangetastet
      if (!known || known.rev !== i.rev || known.path !== pathKey(i, byId)) todo.push(i);
    }
    // gelöschte Dokumente, die das Gerät nicht mehr kennt
    for (const k of Object.keys(localStorage)) if (k.startsWith('pdfwb.gd.file.')) { const id = k.slice(14); if (!byId.has(id)) gone.push(id); }
    return { todo, gone, items, byId };
  }
  /* PDF eines Dokuments erzeugen: unbearbeitete Importe direkt, sonst über den Editor (unsichtbar) */
  let renderer = null;
  async function pdfOf(item) {
    const state = await global.WBStore.getBlob('state:' + item.id);
    if (!state && (item.srcIds || []).length === 1) {
      const s = await global.WBStore.getBlob(`src:${item.id}:${item.srcIds[0]}`);
      if (s) return s.bytes;
    }
    if (renderer) return renderer(item.id);
    return renderInFrame(item.id);
  }
  function renderInFrame(id) {
    return new Promise((res, rej) => {
      const f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;height:900px;border:0;visibility:hidden';
      f.src = 'index.html?doc=' + encodeURIComponent(id) + '&render=1';
      const done = (fn, v) => { clearTimeout(to); global.removeEventListener('message', onMsg); f.remove(); fn(v); };
      const onMsg = e => {
        if (e.source !== f.contentWindow || !e.data || e.data.wbRender !== id) return;
        if (e.data.error) done(rej, new Error(e.data.error)); else done(res, new Uint8Array(e.data.bytes));
      };
      const to = setTimeout(() => done(rej, new Error('Zeitüberschreitung beim Erzeugen der PDF')), 120000);
      global.addEventListener('message', onMsg);
      document.body.appendChild(f);
    });
  }

  /* Zeitpunkt der nächsten automatischen Sicherung (nur stündlich/täglich) */
  function nextRun() {
    const per = PERIOD[S.mode];
    return per && S.enabled ? Math.max(Date.now(), (S.lastRun || 0) + per) : 0;
  }
  function schedule(ms = 4000, force) {
    if (!S.enabled) return;
    clearTimeout(st.timer);
    st.timer = setTimeout(() => run(force), ms);
  }
  /* automatischer Anlass (Änderung, Start, Intervall): nur wenn der gewählte Modus es vorsieht */
  function trigger(reason, ms) {
    if (!S.enabled) return;
    const m = S.mode;
    if (m === 'manual') return;
    if (m === 'change') { if (reason !== 'close') schedule(ms == null ? 8000 : ms); return; }
    if (m === 'close') { if (reason === 'close' || reason === 'start') schedule(ms == null ? 2500 : ms); return; }
    const per = PERIOD[m];
    if (per && Date.now() - (S.lastRun || 0) >= per) schedule(ms == null ? 3000 : ms);
  }
  /* alle fälligen Dokumente sichern (force: „Jetzt sichern“ – auch über mobile Daten) */
  async function run(force) {
    if (!S.enabled || !global.WBStore) return;
    if (st.running) { st.again = true; return; }
    if (!navigator.onLine) { set('offline'); return; }
    if (!force && S.noCellular && cellular()) { set('wait', 'Wartet auf WLAN'); return; }
    st.running = true;
    try {
      const { todo, gone, items, byId } = await pending();
      st.total = todo.length; st.done = 0;
      if (todo.length || gone.length) set('running');
      for (const id of gone) await trashDoc(id);
      st.failed = [];
      for (const item of todo) {
        // ein Dokument, das nicht geht, hält die anderen nicht auf
        const failKey = 'pdfwb.gd.fail.' + item.id;
        if (lsGet(failKey) === item.rev + '|' + item.name) { st.failed.push(item.name); st.done++; continue; }
        try {
          let bytes;
          try { bytes = await pdfOf(item); }
          catch (e) {
            // PDF mit Markierungen ließ sich nicht erzeugen: wenigstens das Original sichern
            const s0 = (item.srcIds || [])[0] && await global.WBStore.getBlob(`src:${item.id}:${item.srcIds[0]}`);
            if (!s0) throw e;
            bytes = s0.bytes; st.failed.push(item.name + ' (ohne Markierungen)');
          }
          const fresh = await global.WBStore.get(item.id);
          if (!fresh || fresh.deleted) continue;
          await backupDoc(item, bytes, items);
          const k = backupInfo(item.id); if (k) { k.path = pathKey(item, byId); lsSet(fileKey(item.id), JSON.stringify(k)); }
          lsSet(failKey, null);
        } catch (e) {
          if (e.needAuth) throw e;
          console.warn('Drive-Backup', item.name, e);
          st.failed.push(item.name); lsSet(failKey, item.rev + '|' + item.name);
        }
        st.done++; emit();
      }
      S.lastRun = Date.now(); save();
      set('ok', st.failed.length ? (st.failed.length === 1 ? '1 Dokument ging nicht: ' : st.failed.length + ' Dokumente gingen nicht: ') + st.failed.slice(0, 3).join(', ') + (st.failed.length > 3 ? ' …' : '') : '');
    } catch (e) {
      if (e.needAuth) set('auth'); else { console.warn('Drive-Backup', e); set('error', e.message || String(e)); }
    } finally {
      st.running = false;
      if (st.again) { st.again = false; schedule(1500, force); }
    }
  }
  /* vom Editor: dieses Dokument gerade gespeichert, PDF liegt schon vor */
  async function backupNow(id, bytes, reason = 'change') {
    if (!S.enabled || !wants(reason)) return false;
    if (S.noCellular && cellular()) return false;
    const item = await global.WBStore.get(id); if (!item || item.deleted) return false;
    const items = await global.WBStore.all(), byId = new Map(items.map(i => [i.id, i]));
    if (!alive(item, byId) || excluded(item, byId)) return false;
    const known = backupInfo(id);
    if (known && known.rev === item.rev && known.path === pathKey(item, byId)) return true; // schon aktuell
    try {
      set('running');
      await backupDoc(item, bytes, items);
      const k = backupInfo(id); if (k) { k.path = pathKey(item, byId); lsSet(fileKey(id), JSON.stringify(k)); }
      S.lastRun = Date.now(); save(); set('ok');
      return true;
    } catch (e) { if (e.needAuth) set('auth'); else set('error', e.message || String(e)); return false; }
  }

  /* soll der Editor jetzt selbst sichern? (er hat die PDF schon fertig) */
  function wants(reason) {
    const m = S.mode;
    if (reason === 'manual') return true;
    if (m === 'change') return reason === 'change';
    if (m === 'close') return reason === 'close';
    const per = PERIOD[m];
    return !!per && reason === 'change' && Date.now() - (S.lastRun || 0) >= per;
  }
  /* nur die Bibliothek überwacht alle Dokumente; der Editor sichert sein eigenes Dokument direkt */
  let watching = false;
  function watch() {
    if (watching || !global.WBStore) return;
    watching = true;
    global.WBStore.onChange(() => trigger('change')); // etwas verzögert, damit nicht jede Kleinigkeit hochlädt
    global.addEventListener('online', () => trigger('change', 1000));
    setInterval(() => trigger('tick', 100), 5 * 60000);
    // Bibliothek öffnet sich nach dem Schließen eines Dokuments → im Modus „beim Schließen“ jetzt sichern
    trigger(/[?&]closed=1/.test(location.search) ? 'close' : 'start', 2500);
  }
  function setOptions(o) {
    if (o.mode && MODES[o.mode]) S.mode = o.mode;
    if (Array.isArray(o.exclude)) S.exclude = o.exclude.filter(Boolean);
    if (o.noCellular != null) S.noCellular = !!o.noCellular;
    save(); emit();
    if (watching) trigger('start', 1500);
  }

  global.WBDrive = {
    info, connect, resume, disconnect, run, schedule, watch, backupNow, backupInfo, pending, pdfOf, setOptions, wants, MODES,
    enabled: () => S.enabled, configured,
    folderUrl: () => (S.rootId ? 'https://drive.google.com/drive/folders/' + S.rootId : 'https://drive.google.com/drive/my-drive'),
    setRenderer: fn => { renderer = fn; },
    onStatus: fn => { listeners.add(fn); fn(info()); return () => listeners.delete(fn); },
  };
})(window);
