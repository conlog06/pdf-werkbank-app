/* PDF Werkbank – Cloud-Dienste (ab Version 1.7)
 * Dropbox, iCloud Drive bzw. ein beliebiger Ordner, WebDAV (Nextcloud, ownCloud, MagentaCLOUD, GMX, WEB.DE, pCloud, HiDrive, NAS).
 * Google Drive bleibt in gdrive.js (WBDrive) und erscheint hier nur in der Übersicht.
 *
 * Jeder Dienst kann
 *   - die Bibliothek automatisch als PDFs sichern („PDF Werkbank/<Ordner>/<Name>.pdf“, wie das Google-Drive-Backup),
 *   - Dateien zum Öffnen anbieten (Datei-Browser) und
 *   - einzelne PDFs dorthin speichern.
 *
 * Anmeldung:
 *   Webseite    – OAuth mit PKCE über eine Weiterleitung auf library.html (Dropbox)
 *   Desktop-App – Anmeldung im System-Browser mit Rücksprung auf http://localhost:53682/, Anfragen laufen über das
 *                 Hauptprogramm (kein CORS), Zugangsdaten verschlüsselt im System-Schlüsselbund (window.wbDesktop)
 */
(function (global) {
  'use strict';
  const DESK = global.wbDesktop || null;
  const C = () => global.WB_CONFIG || {};
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* egal */ } };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const LOOP = 'http://localhost:53682/';
  const ROOT = 'PDF Werkbank';
  const MODES = { change: 'Nach jeder Änderung', hourly: 'Höchstens einmal pro Stunde', close: 'Beim Schließen eines Dokuments', daily: 'Einmal am Tag', manual: 'Nur manuell' };
  const PERIOD = { hourly: 3600e3, daily: 20 * 3600e3 };

  class NeedAuth extends Error { constructor(m) { super(m || 'Bitte neu anmelden.'); this.needAuth = true; } }
  class NotFound extends Error { constructor() { super('nicht gefunden'); this.notFound = true; } }

  /* ---------- HTTP: in der Desktop-App über das Hauptprogramm (kein CORS) ---------- */
  async function http(url, o = {}) {
    let body = o.body;
    if (body instanceof Blob) body = new Uint8Array(await body.arrayBuffer());
    if (body instanceof ArrayBuffer) body = new Uint8Array(body);
    if (DESK && DESK.http && !C().cloudFake) {
      const r = await DESK.http({ url, method: o.method || 'GET', headers: o.headers || {}, body: body == null ? null : body });
      const bytes = r.body ? new Uint8Array(r.body) : new Uint8Array(0);
      return { status: r.status, ok: r.status >= 200 && r.status < 300, headers: r.headers || {}, bytes: async () => bytes, text: async () => new TextDecoder().decode(bytes), json: async () => JSON.parse(new TextDecoder().decode(bytes) || 'null') };
    }
    let r;
    try { r = await fetch(url, { method: o.method || 'GET', headers: o.headers || {}, body: body == null ? undefined : body }); }
    catch (e) { const x = new Error(o.corsHint || 'Keine Verbindung zum Dienst.'); x.network = true; throw x; }
    const hd = {}; r.headers.forEach((v, k) => { hd[k] = v; });
    return { status: r.status, ok: r.ok, headers: hd, bytes: async () => new Uint8Array(await r.arrayBuffer()), text: () => r.text(), json: () => r.json() };
  }

  /* ---------- Geheimnisse (Refresh-Token, WebDAV-Passwort) ---------- */
  async function secretGet(name) {
    if (DESK && DESK.cloudSecret) { const r = await DESK.cloudSecret({ name }); return r && r.value ? JSON.parse(r.value) : null; }
    return JSON.parse(lsGet('pdfwb.cloud.sec.' + name) || 'null');
  }
  async function secretSet(name, obj) {
    if (DESK && DESK.cloudSecret) { await DESK.cloudSecret({ name, value: obj == null ? '' : JSON.stringify(obj), set: true }); return; }
    lsSet('pdfwb.cloud.sec.' + name, obj == null ? null : JSON.stringify(obj));
  }

  /* ---------- OAuth mit PKCE ---------- */
  const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const rand = n => b64url(crypto.getRandomValues(new Uint8Array(n)));
  async function pkce() {
    const verifier = rand(48);
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    return { verifier, challenge };
  }
  const webRedirect = () => location.origin + location.pathname.replace(/[^/]*$/, '') + 'library.html';
  const form = o => Object.entries(o).filter(([, v]) => v != null).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');

  /* Anbieter mit OAuth: Dropbox */
  const OAUTH = {
    dropbox: {
      clientId: () => C().dropboxAppKey,
      auth: 'https://www.dropbox.com/oauth2/authorize',
      token: 'https://api.dropboxapi.com/oauth2/token',
      scope: null,
      extra: { token_access_type: 'offline' },
    },
  };
  async function tokenRequest(pid, params) {
    const o = OAUTH[pid];
    const r = await http(o.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ client_id: o.clientId(), ...params }) });
    let j = {}; try { j = await r.json(); } catch (e) { /* leer */ }
    if (!r.ok) { const e = new Error(j.error_description || j.error || 'Anmeldung fehlgeschlagen (' + r.status + ')'); e.code = j.error; throw e; }
    return j;
  }
  function authUrl(pid, redirect, challenge, state) {
    const o = OAUTH[pid];
    return o.auth + '?' + form({ client_id: o.clientId(), response_type: 'code', redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state, scope: o.scope, ...o.extra });
  }
  /* startet die Anmeldung; Webseite: Weiterleitung (kommt über handleRedirect zurück), Desktop: wartet auf den Rücksprung */
  async function oauthConnect(pid) {
    const { verifier, challenge } = await pkce(), state = pid + '.' + rand(12);
    if (C().cloudFake) { // Tests: Anmeldung überspringen
      await saveTokens(pid, { access_token: 'fake-' + pid, refresh_token: 'r', expires_in: 3600 });
      return finishConnect(pid);
    }
    if (DESK && DESK.oauthLoopback) {
      const r = await DESK.oauthLoopback({ url: authUrl(pid, LOOP, challenge, state), port: 53682 });
      if (!r || r.state !== state || !r.code) throw new Error(r && r.error === 'access_denied' ? 'Zugriff wurde nicht erlaubt.' : 'Anmeldung abgebrochen.');
      await saveTokens(pid, await tokenRequest(pid, { grant_type: 'authorization_code', code: r.code, code_verifier: verifier, redirect_uri: LOOP }));
      return finishConnect(pid);
    }
    try { sessionStorage.setItem('pdfwb.cloud.oauth', JSON.stringify({ pid, verifier, state, back: location.href })); } catch (e) { throw new Error('Anmeldung in diesem Browser nicht möglich.'); }
    location.href = authUrl(pid, webRedirect(), challenge, state);
    return new Promise(() => {}); // Seite wird verlassen
  }
  /* Webseite: Rücksprung von Microsoft/Dropbox auf library.html?code=…&state=… */
  async function handleRedirect() {
    const q = new URLSearchParams(location.search);
    const state = q.get('state'); if (!state || !/^dropbox\./.test(state)) return null;
    let pend = null; try { pend = JSON.parse(sessionStorage.getItem('pdfwb.cloud.oauth') || 'null'); sessionStorage.removeItem('pdfwb.cloud.oauth'); } catch (e) { /* egal */ }
    history.replaceState(null, '', location.pathname);
    if (!pend || pend.state !== state) return { error: 'Anmeldung abgelaufen, bitte noch einmal verbinden.' };
    if (q.get('error')) return { pid: pend.pid, error: q.get('error') === 'access_denied' ? 'Zugriff wurde nicht erlaubt.' : (q.get('error_description') || q.get('error')) };
    try {
      await saveTokens(pend.pid, await tokenRequest(pend.pid, { grant_type: 'authorization_code', code: q.get('code'), code_verifier: pend.verifier, redirect_uri: webRedirect() }));
      await finishConnect(pend.pid);
      return { pid: pend.pid, ok: true };
    } catch (e) { return { pid: pend.pid, error: e.message || String(e) }; }
  }
  const tokMem = {};
  async function saveTokens(pid, tk) {
    const old = (await secretGet(pid)) || {};
    const rec = { refresh: tk.refresh_token || old.refresh || '', access: tk.access_token, exp: Date.now() + ((tk.expires_in || 3600) - 120) * 1000 };
    tokMem[pid] = rec;
    await secretSet(pid, rec);
  }
  async function accessToken(pid) {
    if (C().cloudFake) return 'fake-' + pid;
    let rec = tokMem[pid] || await secretGet(pid);
    if (!rec) throw new NeedAuth();
    if (rec.access && rec.exp > Date.now()) return rec.access;
    if (!rec.refresh) throw new NeedAuth();
    try {
      const tk = await tokenRequest(pid, { grant_type: 'refresh_token', refresh_token: rec.refresh, ...(OAUTH[pid].scope ? { scope: OAUTH[pid].scope } : {}) });
      await saveTokens(pid, tk);
      return tokMem[pid].access;
    } catch (e) {
      if (e.network) throw e;
      if (/invalid_grant|expired|revoked/i.test(e.code || e.message)) { await secretSet(pid, null); delete tokMem[pid]; throw new NeedAuth('Anmeldung abgelaufen, bitte neu verbinden.'); }
      throw e;
    }
  }
  async function authed(pid, url, o = {}, retry = true) {
    const t = await accessToken(pid);
    const r = await http(url, { ...o, headers: { ...(o.headers || {}), Authorization: 'Bearer ' + t } });
    if (r.status === 401) {
      const rec = tokMem[pid]; if (rec) rec.exp = 0;
      if (retry) return authed(pid, url, o, false);
      throw new NeedAuth();
    }
    return r;
  }
  async function fail(r, what) {
    let m = String(r.status);
    try { const j = await r.json(); m = (j && (j.error_summary || (j.error && (j.error.message || j.error)) || j.message)) || m; } catch (e) { /* egal */ }
    if (r.status === 507 || /quota|insufficient_space/i.test(m)) m = 'Kein Speicherplatz mehr frei.';
    throw new Error((what ? what + ': ' : '') + m);
  }

  /* ---------- Anbieter ----------
     Pfade sind Listen von Ordnernamen, z. B. ['PDF Werkbank', 'Uni', 'Mathe.pdf'] */
  const enc = parts => parts.map(encodeURIComponent).join('/');
  const dbxArg = o => JSON.stringify(o).replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  const kindOf = name => /\.pdf$/i.test(name) ? 'pdf' : /\.werkbank$/i.test(name) ? 'werkbank' : 'file';

  const P = {};
  P.dropbox = {
    id: 'dropbox', label: 'Dropbox', short: 'Dropbox', color: '#0061fe', oauth: true,
    configured: () => !!(C().dropboxAppKey || C().cloudFake),
    A: () => C().dropboxApi || 'https://api.dropboxapi.com', CT: () => C().dropboxContent || 'https://content.dropboxapi.com',
    path: parts => (parts.length ? '/' + parts.join('/') : ''),
    async rpc(ep, arg) {
      const r = await authed('dropbox', this.A() + '/2/' + ep, arg === undefined ? { method: 'POST' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(arg) });
      if (r.status === 409) { let j = {}; try { j = await r.json(); } catch (e) { /* egal */ } if (/not_found/.test(j.error_summary || '')) throw new NotFound(); throw new Error('Dropbox: ' + (j.error_summary || r.status)); }
      if (!r.ok) await fail(r, 'Dropbox');
      return r.json();
    },
    async account() { const j = await this.rpc('users/get_current_account'); return j.email || (j.name && j.name.display_name) || ''; },
    async put(parts, bytes) {
      const r = await authed('dropbox', this.CT() + '/2/files/upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': dbxArg({ path: this.path(parts), mode: 'overwrite', mute: true, autorename: false }) }, body: bytes });
      if (!r.ok) await fail(r, 'Dropbox');
    },
    async del(parts) { try { await this.rpc('files/delete_v2', { path: this.path(parts) }); } catch (e) { if (!e.notFound) throw e; } },
    async list(parts) {
      let j = await this.rpc('files/list_folder', { path: this.path(parts), limit: 2000 });
      const out = [];
      for (;;) {
        for (const it of j.entries || []) out.push({ name: it.name, dir: it['.tag'] === 'folder', size: it.size || 0, mtime: Date.parse(it.server_modified) || 0, kind: it['.tag'] === 'folder' ? 'dir' : kindOf(it.name) });
        if (!j.has_more) break;
        j = await this.rpc('files/list_folder/continue', { cursor: j.cursor });
      }
      return out;
    },
    async get(parts) {
      const r = await authed('dropbox', this.CT() + '/2/files/download', { method: 'POST', headers: { 'Dropbox-API-Arg': dbxArg({ path: this.path(parts) }) } });
      if (r.status === 409) throw new NotFound(); if (!r.ok) await fail(r, 'Dropbox');
      return r.bytes();
    },
    webUrl: () => 'https://www.dropbox.com/home/' + encodeURIComponent(ROOT),
  };

  /* WebDAV: Nextcloud, ownCloud, MagentaCLOUD, GMX, WEB.DE, pCloud, Strato HiDrive, Synology/QNAP … */
  const DAV_PRESETS = [
    ['nextcloud', 'Nextcloud', 'https://DEIN-SERVER/remote.php/dav/files/BENUTZERNAME/'],
    ['owncloud', 'ownCloud', 'https://DEIN-SERVER/remote.php/webdav/'],
    ['magenta', 'MagentaCLOUD (Telekom)', 'https://magentacloud.de/remote.php/webdav/'],
    ['gmx', 'GMX Cloud', 'https://webdav.mc.gmx.net/'],
    ['webde', 'WEB.DE Online-Speicher', 'https://webdav.smartdrive.web.de/'],
    ['pcloud', 'pCloud (EU)', 'https://ewebdav.pcloud.com/'],
    ['hidrive', 'Strato HiDrive', 'https://webdav.hidrive.strato.com/'],
    ['nas', 'NAS / anderer WebDAV-Server', 'https://'],
  ];
  P.webdav = {
    id: 'webdav', label: 'WebDAV · Nextcloud & Co.', short: 'WebDAV', color: '#0082c9',
    configured: () => true,
    cfg: null,
    async creds() { if (!this.cfg) this.cfg = await secretGet('webdav'); if (!this.cfg) throw new NeedAuth('WebDAV ist nicht eingerichtet.'); return this.cfg; },
    async req(method, parts, o = {}) {
      const c = await this.creds();
      const url = c.url.replace(/\/?$/, '/') + enc(parts) + (o.dir ? '/' : '');
      const r = await http(url, { method, headers: { Authorization: 'Basic ' + btoa(unescape(encodeURIComponent(c.user + ':' + c.pass))), ...(o.headers || {}) }, body: o.body, corsHint: DESK ? null : 'Der Server erlaubt keinen Zugriff aus dem Browser (CORS). In der Desktop-App funktioniert WebDAV immer; im Browser muss der Server CORS erlauben.' });
      if (r.status === 401) throw new NeedAuth('Benutzername oder Passwort stimmen nicht.');
      return r;
    },
    async account() { const c = await this.creds(); const r = await this.req('PROPFIND', [], { dir: true, headers: { Depth: '0' } }); if (r.status >= 400) await fail(r, 'WebDAV'); return c.user + ' · ' + new URL(c.url).host; },
    async mkdirs(parts) {
      for (let i = 1; i <= parts.length; i++) {
        const r = await this.req('MKCOL', parts.slice(0, i), { dir: true });
        if (!(r.ok || r.status === 405 || r.status === 301)) await fail(r, 'WebDAV-Ordner');
      }
    },
    known: new Set(),
    async put(parts, bytes) {
      const dir = parts.slice(0, -1), key = dir.join('/');
      if (!this.known.has(key)) { await this.mkdirs(dir); this.known.add(key); }
      let r = await this.req('PUT', parts, { headers: { 'Content-Type': 'application/pdf' }, body: bytes });
      if (r.status === 409) { await this.mkdirs(dir); r = await this.req('PUT', parts, { headers: { 'Content-Type': 'application/pdf' }, body: bytes }); }
      if (!r.ok) await fail(r, 'WebDAV');
    },
    async del(parts) { const r = await this.req('DELETE', parts); if (!(r.ok || r.status === 404)) await fail(r, 'WebDAV'); },
    async list(parts) {
      const r = await this.req('PROPFIND', parts, { dir: true, headers: { Depth: '1', 'Content-Type': 'application/xml' }, body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>' });
      if (r.status === 404) throw new NotFound(); if (r.status >= 400) await fail(r, 'WebDAV');
      const doc = new DOMParser().parseFromString(await r.text(), 'application/xml');
      const NS = 'DAV:', out = [];
      const self = decodeURIComponent(new URL((await this.creds()).url.replace(/\/?$/, '/') + enc(parts) + '/').pathname).replace(/\/+$/, '');
      for (const resp of doc.getElementsByTagNameNS(NS, 'response')) {
        const href = (resp.getElementsByTagNameNS(NS, 'href')[0] || {}).textContent || '';
        let p; try { p = decodeURIComponent(new URL(href, 'http://x').pathname).replace(/\/+$/, ''); } catch (e) { continue; }
        if (p === self) continue;
        const dir = resp.getElementsByTagNameNS(NS, 'collection').length > 0, name = p.split('/').pop();
        if (!name) continue;
        const len = resp.getElementsByTagNameNS(NS, 'getcontentlength')[0], lm = resp.getElementsByTagNameNS(NS, 'getlastmodified')[0];
        out.push({ name, dir, size: len ? +len.textContent : 0, mtime: lm ? Date.parse(lm.textContent) || 0 : 0, kind: dir ? 'dir' : kindOf(name) });
      }
      return out;
    },
    async get(parts) { const r = await this.req('GET', parts); if (r.status === 404) throw new NotFound(); if (!r.ok) await fail(r, 'WebDAV'); return r.bytes(); },
    async setup({ url, user, pass }) {
      url = String(url || '').trim(); if (!/^https?:\/\/[^/]+/.test(url)) throw new Error('Bitte die WebDAV-Adresse eintragen (https://…).');
      this.cfg = { url: url.replace(/\/?$/, '/'), user: String(user || '').trim(), pass: String(pass || '') };
      this.known.clear();
      try { await this.account(); } catch (e) { this.cfg = null; throw e; }
      await secretSet('webdav', this.cfg);
    },
    async forget() { this.cfg = null; this.known.clear(); await secretSet('webdav', null); },
    webUrl: () => null,
  };

  /* Ordner: iCloud Drive (Mac/Windows mit iCloud), ein synchronisierter OneDrive-/Dropbox-Ordner, USB-Stick, NAS-Laufwerk …
     Desktop-App: echter Ordner über das Hauptprogramm. Webseite (Chrome, Edge): Ordner über den Ordner-Dialog des Browsers. */
  const fsApi = () => !!global.showDirectoryPicker;
  function handleDb() {
    return new Promise((res, rej) => { const r = indexedDB.open('pdfwb-cloud', 1); r.onupgradeneeded = () => r.result.createObjectStore('h'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  }
  async function handleIO(mode, key, val) {
    const db = await handleDb();
    return new Promise((res, rej) => { const tx = db.transaction('h', mode), st = tx.objectStore('h'), q = mode === 'readonly' ? st.get(key) : val == null ? st.delete(key) : st.put(val, key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  }
  function folderProvider(id, label, color) {
    return {
      id, label, short: label, color, folder: true,
      configured: () => !!(DESK ? DESK.fsOp : fsApi()),
      h: null,
      async dirHandle(parts, create, ask) {
        if (!this.h) this.h = await handleIO('readonly', id);
        if (!this.h) throw new NeedAuth('Kein Ordner gewählt.');
        let perm = await this.h.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted' && ask) perm = await this.h.requestPermission({ mode: 'readwrite' });
        if (perm !== 'granted') throw new NeedAuth('Zugriff auf den Ordner bestätigen.');
        let d = this.h;
        for (const n of parts) { try { d = await d.getDirectoryHandle(n, { create }); } catch (e) { if (e.name === 'NotFoundError') throw new NotFound(); throw e; } }
        return d;
      },
      async fs(op, parts, bytes) {
        const st = cfgOf(id);
        const r = await DESK.fsOp({ op, root: st.path, rel: parts, bytes: bytes || null });
        if (r && r.error) { if (/ENOENT/.test(r.error)) throw new NotFound(); throw new Error(r.error); }
        return r;
      },
      async account() {
        if (DESK) { const st = cfgOf(id); if (!st.path) throw new NeedAuth('Kein Ordner gewählt.'); await this.fs('stat', []); return st.path; }
        await this.dirHandle([], false); return this.h.name;
      },
      async put(parts, bytes) {
        if (DESK) { await this.fs('write', parts, bytes); return; }
        const d = await this.dirHandle(parts.slice(0, -1), true);
        const f = await d.getFileHandle(parts[parts.length - 1], { create: true }), w = await f.createWritable();
        await w.write(bytes); await w.close();
      },
      async del(parts) {
        if (DESK) { try { await this.fs('trash', parts); } catch (e) { if (!e.notFound) throw e; } return; }
        try { const d = await this.dirHandle(parts.slice(0, -1), false); await d.removeEntry(parts[parts.length - 1]); } catch (e) { if (!(e.notFound || e.name === 'NotFoundError')) throw e; }
      },
      async list(parts) {
        if (DESK) { const r = await this.fs('list', parts); return (r.entries || []).map(e => ({ ...e, kind: e.dir ? 'dir' : kindOf(e.name) })); }
        const d = await this.dirHandle(parts, false), out = [];
        for await (const [name, h] of d.entries()) {
          if (name.startsWith('.')) continue;
          if (h.kind === 'directory') out.push({ name, dir: true, size: 0, mtime: 0, kind: 'dir' });
          else { const f = await h.getFile(); out.push({ name, dir: false, size: f.size, mtime: f.lastModified, kind: kindOf(name) }); }
        }
        return out;
      },
      async get(parts) {
        if (DESK) { const r = await this.fs('read', parts); return new Uint8Array(r.bytes); }
        const d = await this.dirHandle(parts.slice(0, -1), false);
        try { return new Uint8Array(await (await (await d.getFileHandle(parts[parts.length - 1])).getFile()).arrayBuffer()); } catch (e) { if (e.name === 'NotFoundError') throw new NotFound(); throw e; }
      },
      /* Ordner wählen (muss aus einem Klick heraus kommen) */
      async choose(preset) {
        if (DESK) {
          const r = preset ? await DESK.folderAllow({ path: preset }) : await DESK.folderPick();
          if (!r || r.error) throw new Error((r && r.error) || 'Kein Ordner gewählt.');
          if (!r.path) return false;
          setCfg(id, { path: r.path });
          return true;
        }
        if (!fsApi()) throw new Error('Dieser Browser kann keine Ordner verbinden. In Chrome oder Edge am Computer oder in der Desktop-App geht es.');
        let h;
        try { h = await global.showDirectoryPicker({ id: 'wb-' + id, mode: 'readwrite', startIn: 'documents' }); }
        catch (e) { if (e.name === 'AbortError') return false; throw e; }
        this.h = h; await handleIO('readwrite', id, h);
        setCfg(id, { path: h.name });
        return true;
      },
      async resume() { if (!DESK) await this.dirHandle([], false, true); },
      async forget() { this.h = null; if (!DESK) await handleIO('readwrite', id, null).catch(() => {}); setCfg(id, { path: '' }); },
      webUrl: () => null,
    };
  }
  P.icloud = folderProvider('icloud', 'iCloud Drive', '#3693f3');
  P.folder = folderProvider('folder', 'Ordner auf dem Gerät', '#6b7280');
  const ORDER = ['dropbox', 'icloud', 'webdav', 'folder'];

  /* ---------- Einstellungen und Zustand je Dienst ---------- */
  const DEF = { enabled: false, account: '', mode: 'change', exclude: [], lastRun: 0, backup: true, path: '' };
  const cfgOf = id => Object.assign({}, DEF, JSON.parse(lsGet('pdfwb.cloud.' + id) || '{}'));
  function setCfg(id, patch) { const c = Object.assign(cfgOf(id), patch); lsSet('pdfwb.cloud.' + id, JSON.stringify(c)); return c; }
  const run = { status: {}, error: {}, running: false, again: false, timer: 0, done: 0, total: 0, failed: [] };
  const listeners = new Set();
  function info(id) {
    const c = cfgOf(id), p = P[id];
    return { id, label: p.label, short: p.short, color: p.color, folder: !!p.folder, oauth: !!p.oauth, configured: p.configured(), desktop: !!DESK, enabled: c.enabled, account: c.account, path: c.path, mode: c.mode, exclude: c.exclude.slice(), lastRun: c.lastRun, backup: c.backup !== false, status: c.enabled ? (run.status[id] || 'idle') : 'off', error: run.error[id] || '', modes: MODES };
  }
  const infoAll = () => ORDER.map(info);
  const emit = () => { const all = infoAll(); listeners.forEach(f => { try { f(all, { running: run.running, done: run.done, total: run.total }); } catch (e) { console.error(e); } }); };
  const setStatus = (id, s, err = '') => { run.status[id] = s; run.error[id] = err; emit(); };
  const enabledIds = () => ORDER.filter(id => cfgOf(id).enabled);

  async function finishConnect(id) {
    let account = '';
    try { account = await P[id].account(); } catch (e) { if (e.needAuth) throw e; console.warn('Konto', e); }
    setCfg(id, { enabled: true, account });
    setStatus(id, 'idle');
    schedule(600);
    return info(id);
  }
  async function connect(id, opts = {}) {
    const p = P[id];
    if (!p.configured()) throw new Error(p.folder ? 'Ordner lassen sich hier nicht verbinden.' : p.label + ' ist noch nicht eingerichtet (siehe README).');
    if (p.oauth) return oauthConnect(id);
    if (id === 'webdav') { await p.setup(opts); return finishConnect(id); }
    if (p.folder) { if (!await p.choose(opts.preset)) return null; return finishConnect(id); }
    return null;
  }
  async function resume(id) {
    const p = P[id];
    if (p.folder && p.resume) { await p.resume(); setStatus(id, 'idle'); schedule(200); return; }
    if (p.oauth) return oauthConnect(id);
  }
  async function disconnect(id) {
    const p = P[id];
    if (p.oauth) { await secretSet(id, null); delete tokMem[id]; }
    if (p.forget) await p.forget();
    setCfg(id, { enabled: false, account: '' });
    for (const k of Object.keys(localStorage)) if (k.startsWith(`pdfwb.cl.${id}.`)) lsSet(k, null);
    setStatus(id, 'off');
  }
  function setOptions(id, o) {
    const patch = {};
    if (o.mode && MODES[o.mode]) patch.mode = o.mode;
    if (Array.isArray(o.exclude)) patch.exclude = o.exclude.filter(Boolean);
    if (o.backup != null) patch.backup = !!o.backup;
    setCfg(id, patch); emit();
    if (watching) trigger('start', 1500);
  }

  /* ---------- Backup der Bibliothek ---------- */
  const safeName = s => String(s || 'Ohne Namen').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/^\.+/, '').trim().slice(0, 180) || 'Ohne Namen';
  const fileKey = (id, doc) => `pdfwb.cl.${id}.f.${doc}`;
  const known = (id, doc) => JSON.parse(lsGet(fileKey(id, doc)) || 'null');
  function alive(i, byId) {
    let cur = i, n = 0;
    while (cur && n++ < 64) { if (cur.trashed || cur.deleted) return false; const p = cur.kind === 'folder' ? cur.parent : cur.folder; cur = p ? byId.get(p) : null; }
    return true;
  }
  function excluded(i, byId, ex) {
    if (!ex.length) return false;
    let f = i.folder ? byId.get(i.folder) : null, n = 0;
    while (f && n++ < 64) { if (ex.includes(f.id)) return true; f = f.parent ? byId.get(f.parent) : null; }
    return false;
  }
  function folderParts(i, byId) {
    const parts = []; let f = i.folder ? byId.get(i.folder) : null, n = 0;
    while (f && n++ < 64) { parts.unshift(safeName(f.name)); f = f.parent ? byId.get(f.parent) : null; }
    return parts;
  }
  /* Zielpfad je Dokument; gleiche Namen im selben Ordner bekommen einen Zusatz */
  function pathsFor(items, byId) {
    const out = new Map(), seen = new Map();
    const docs = items.filter(i => i.kind === 'doc' && !i.deleted && alive(i, byId)).sort((a, b) => (a.created || 0) - (b.created || 0) || String(a.id).localeCompare(String(b.id)));
    for (const d of docs) {
      const dir = [ROOT, ...folderParts(d, byId)];
      let name = safeName(d.name), key = (dir.join('/') + '/' + name).toLowerCase();
      if (seen.has(key)) { name += ' (' + String(d.id).slice(-4) + ')'; key = (dir.join('/') + '/' + name).toLowerCase(); }
      seen.set(key, d.id);
      out.set(d.id, [...dir, name + '.pdf']);
    }
    return out;
  }
  function due(id, reason) {
    const c = cfgOf(id); if (!c.enabled || c.backup === false) return false;
    if (reason === 'manual') return true;
    const m = c.mode;
    if (m === 'manual') return false;
    if (m === 'change') return reason !== 'close';
    if (m === 'close') return reason === 'close' || reason === 'start';
    const per = PERIOD[m];
    return !!per && Date.now() - (c.lastRun || 0) >= per;
  }
  async function pending(ids) {
    const items = await global.WBStore.all(true), byId = new Map(items.map(i => [i.id, i])), paths = pathsFor(items, byId);
    const todo = new Map(), gone = [];
    for (const id of ids) {
      const ex = cfgOf(id).exclude;
      for (const i of items) {
        if (i.kind !== 'doc') continue;
        const k = known(id, i.id);
        if (i.deleted || !alive(i, byId)) { if (k) gone.push([id, i.id, k.path]); continue; }
        if (i.missing || excluded(i, byId, ex)) continue;
        const path = paths.get(i.id);
        if (!k || k.rev !== i.rev || k.path.join('/') !== path.join('/')) { if (!todo.has(i.id)) todo.set(i.id, { item: i, path, ids: [] }); todo.get(i.id).ids.push(id); }
      }
      for (const k of Object.keys(localStorage)) {
        const pre = `pdfwb.cl.${id}.f.`;
        if (k.startsWith(pre)) { const doc = k.slice(pre.length); if (!byId.has(doc)) { const kk = known(id, doc); if (kk) gone.push([id, doc, kk.path]); } }
      }
    }
    return { todo: [...todo.values()], gone, items };
  }
  async function pdfOf(item) {
    if (global.WBDrive && global.WBDrive.pdfOf) return global.WBDrive.pdfOf(item);
    const s = (item.srcIds || [])[0] && await global.WBStore.getBlob(`src:${item.id}:${item.srcIds[0]}`);
    if (s) return s.bytes;
    throw new Error('PDF nicht verfügbar');
  }
  async function runBackup(force, reason = 'change') {
    if (!global.WBStore) return;
    const ids = enabledIds().filter(id => force || due(id, reason)).filter(id => run.status[id] !== 'auth');
    if (!ids.length) return;
    if (run.running) { run.again = true; return; }
    if (!navigator.onLine && ids.some(id => !P[id].folder)) { ids.filter(id => !P[id].folder).forEach(id => setStatus(id, 'offline')); }
    const live = ids.filter(id => P[id].folder || navigator.onLine);
    if (!live.length) return;
    run.running = true; run.failed = [];
    const bad = new Set();
    try {
      const { todo, gone } = await pending(live);
      run.total = todo.length; run.done = 0;
      if (todo.length || gone.length) live.forEach(id => setStatus(id, 'running'));
      for (const [id, doc, path] of gone) {
        if (bad.has(id)) continue;
        try { await P[id].del(path); lsSet(fileKey(id, doc), null); }
        catch (e) { if (e.needAuth) { bad.add(id); setStatus(id, 'auth', e.message); } else console.warn('Cloud löschen', id, e); }
      }
      for (const t of todo) {
        const targets = t.ids.filter(id => !bad.has(id)); if (!targets.length) { run.done++; continue; }
        let bytes;
        try { bytes = await pdfOf(t.item); }
        catch (e) {
          const s0 = (t.item.srcIds || [])[0] && await global.WBStore.getBlob(`src:${t.item.id}:${t.item.srcIds[0]}`);
          if (!s0) { run.failed.push(t.item.name); run.done++; emit(); continue; }
          bytes = s0.bytes; run.failed.push(t.item.name + ' (ohne Markierungen)');
        }
        for (const id of targets) {
          try {
            const old = known(id, t.item.id);
            await P[id].put(t.path, bytes);
            if (old && old.path.join('/') !== t.path.join('/')) { try { await P[id].del(old.path); } catch (e) { if (e.needAuth) throw e; } }
            lsSet(fileKey(id, t.item.id), JSON.stringify({ path: t.path, rev: t.item.rev, at: Date.now() }));
          } catch (e) {
            if (e.needAuth) { bad.add(id); setStatus(id, 'auth', e.message); }
            else { console.warn('Cloud-Backup', id, t.item.name, e); run.error[id] = e.message || String(e); bad.add(id); setStatus(id, 'error', run.error[id]); }
          }
        }
        run.done++; emit();
      }
      for (const id of live) if (!bad.has(id)) { setCfg(id, { lastRun: Date.now() }); setStatus(id, 'ok', run.failed.length ? run.failed.length + ' mit Problem: ' + run.failed.slice(0, 2).join(', ') : ''); }
    } catch (e) {
      console.warn('Cloud-Backup', e);
      live.forEach(id => { if (!bad.has(id)) setStatus(id, e.needAuth ? 'auth' : 'error', e.message || String(e)); });
    } finally {
      run.running = false;
      if (run.again) { run.again = false; schedule(1500, force); }
    }
  }
  function schedule(ms = 4000, force) { if (!enabledIds().length) return; clearTimeout(run.timer); run.timer = setTimeout(() => runBackup(force, force ? 'manual' : 'change'), ms); }
  function trigger(reason, ms) {
    const ids = enabledIds().filter(id => due(id, reason)); if (!ids.length) return;
    clearTimeout(run.timer); run.timer = setTimeout(() => runBackup(false, reason), ms == null ? 8000 : ms);
  }
  let watching = false;
  function watch() {
    if (watching || !global.WBStore) return;
    watching = true;
    global.WBStore.onChange(() => trigger('change'));
    global.addEventListener('online', () => trigger('change', 1500));
    setInterval(() => trigger('tick', 100), 5 * 60000);
    trigger(/[?&]closed=1/.test(location.search) ? 'close' : 'start', 3000);
  }
  /* Editor: PDF dieses Dokuments liegt schon vor */
  async function backupNow(docId, bytes) {
    const ids = enabledIds().filter(id => due(id, 'change') && run.status[id] !== 'auth'); if (!ids.length) return false;
    const items = await global.WBStore.all(), byId = new Map(items.map(i => [i.id, i])), item = byId.get(docId);
    if (!item || item.deleted || !alive(item, byId)) return false;
    const path = pathsFor(items, byId).get(docId);
    let any = false;
    for (const id of ids) {
      if (excluded(item, byId, cfgOf(id).exclude)) continue;
      const k = known(id, docId);
      if (k && k.rev === item.rev && k.path.join('/') === path.join('/')) { any = true; continue; }
      try {
        await P[id].put(path, bytes);
        if (k && k.path.join('/') !== path.join('/')) await P[id].del(k.path).catch(() => {});
        lsSet(fileKey(id, docId), JSON.stringify({ path, rev: item.rev, at: Date.now() }));
        setCfg(id, { lastRun: Date.now() }); setStatus(id, 'ok'); any = true;
      } catch (e) { setStatus(id, e.needAuth ? 'auth' : 'error', e.message || String(e)); }
    }
    return any;
  }
  const wants = () => enabledIds().some(id => due(id, 'change'));

  /* ---------- Datei-Browser: aus der Cloud öffnen und dorthin speichern ---------- */
  const ICO = {
    onedrive: '<path d="M10 9.5a5 5 0 0 1 9.4 1.6A3.5 3.5 0 0 1 19 18H7a4 4 0 0 1-.6-8 5 5 0 0 1 3.6-.5z"/>',
    dropbox: '<path d="M7 3l5 3.2-5 3.2-5-3.2zM17 3l5 3.2-5 3.2-5-3.2zM2 12.6l5-3.2 5 3.2-5 3.2zM17 9.4l5 3.2-5 3.2-5-3.2zM7 17l5-3.2 5 3.2-5 3.2z"/>',
    icloud: '<path d="M6.5 19a4.5 4.5 0 0 1-.9-8.9A6 6 0 0 1 17.3 8.6 5.2 5.2 0 0 1 17.5 19z"/>',
    webdav: '<path d="M4 6h16v5H4zM4 13h16v5H4zM8 8.5h.01M8 15.5h.01"/>',
    folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z"/>',
    google: '<path d="M8.5 3h7l6 10.5-3.5 6h-12L2.5 13.5zM8.5 3l6.5 10.5h6.5M15.5 3L9 13.5 6 19.5M2.5 13.5H15l3 6"/>',
    dir: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z"/>',
    pdf: '<path d="M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 16.5h6"/>',
    file: '<path d="M6 3h8l4 4v14H6zM14 3v4h4"/>',
  };
  const icon = (k, col) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="${col || 'currentColor'}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICO[k] || ICO.file}</svg>`;
  let cssDone = false;
  function css() {
    if (cssDone) return; cssDone = true;
    const s = document.createElement('style');
    s.textContent = `.wbc-back{position:fixed;inset:0;z-index:300;background:rgb(10 14 22/.42);display:grid;place-items:center;padding:16px;animation:wbcf .12s ease-out}
@keyframes wbcf{from{opacity:0}}
.wbc{width:min(640px,100%);max-height:min(86vh,720px);display:flex;flex-direction:column;background:var(--raise,#fff);color:var(--ink,#1b2130);border:1px solid var(--line,#dde1e8);border-radius:16px;box-shadow:0 24px 70px rgb(0 0 0/.3);overflow:hidden;font:14px/1.4 var(--f-sans,system-ui,sans-serif)}
.wbc header{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line,#dde1e8)}
.wbc header h3{margin:0;font-size:16px;flex:1}
.wbc .wbc-x{border:0;background:transparent;font-size:22px;line-height:1;cursor:pointer;color:var(--muted,#5f6878);padding:2px 6px;border-radius:8px}
.wbc .wbc-prov{display:flex;gap:6px;padding:10px 16px;overflow-x:auto;border-bottom:1px solid var(--line,#dde1e8)}
.wbc .wbc-prov button{display:flex;align-items:center;gap:6px;flex:none;border:1px solid var(--line,#dde1e8);background:transparent;color:var(--ink,#1b2130);border-radius:999px;padding:6px 12px;cursor:pointer;font:inherit}
.wbc .wbc-prov button[aria-pressed=true]{background:var(--accent-soft,#e5ebfc);border-color:var(--accent,#1f4fd8);color:var(--accent,#1f4fd8)}
.wbc .wbc-crumb{display:flex;flex-wrap:wrap;gap:2px;align-items:center;padding:8px 16px;font-size:13px;color:var(--muted,#5f6878)}
.wbc .wbc-crumb button{border:0;background:transparent;color:var(--accent,#1f4fd8);cursor:pointer;padding:2px 4px;border-radius:6px;font:inherit}
.wbc .wbc-list{flex:1;overflow:auto;padding:4px 8px 8px;min-height:180px}
.wbc .wbc-row{display:flex;align-items:center;gap:10px;width:100%;border:0;background:transparent;color:inherit;text-align:left;padding:9px 10px;border-radius:10px;cursor:pointer;font:inherit}
.wbc .wbc-row:hover{background:var(--accent-soft,#e5ebfc)}
.wbc .wbc-row[aria-selected=true]{background:var(--accent-soft,#e5ebfc);box-shadow:inset 0 0 0 1.5px var(--accent,#1f4fd8)}
.wbc .wbc-row[disabled]{opacity:.45;cursor:default}
.wbc .wbc-row .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wbc .wbc-row small{color:var(--muted,#5f6878);font-size:12px;white-space:nowrap}
.wbc .wbc-msg{padding:28px 16px;text-align:center;color:var(--muted,#5f6878)}
.wbc footer{display:flex;gap:8px;align-items:center;padding:12px 16px;border-top:1px solid var(--line,#dde1e8);flex-wrap:wrap}
.wbc footer input{flex:1;min-width:160px;padding:9px 11px;border:1px solid var(--line,#dde1e8);border-radius:10px;background:var(--raise,#fff);color:inherit;font:inherit}
.wbc .wbc-b{border:1px solid var(--line,#dde1e8);background:var(--raise,#fff);color:var(--ink,#1b2130);border-radius:10px;padding:9px 14px;cursor:pointer;font:inherit;font-weight:500}
.wbc .wbc-b.p{background:var(--accent,#1f4fd8);border-color:var(--accent,#1f4fd8);color:var(--accent-ink,#fff)}
.wbc .wbc-b[disabled]{opacity:.5;cursor:default}
.wbc .wbc-spin{display:inline-block;width:16px;height:16px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:wbcs .7s linear infinite;vertical-align:-3px;margin-right:6px}
@keyframes wbcs{to{transform:rotate(360deg)}}`;
    document.head.appendChild(s);
  }
  const fmtSize = n => n > 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' MB' : n > 0 ? Math.max(1, Math.round(n / 1e3)) + ' kB' : '';
  const fmtDate = t => t ? new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '';
  /* mode 'open': Dateien wählen → [{ name, bytes, provider, path }]
     mode 'save': Ordner wählen und speichern (o.name, o.bytes oder o.make() → Bytes) → { provider, path } */
  function pick(o = {}) {
    css();
    const mode = o.mode === 'folder' ? 'save' : (o.mode || 'open'), folderOnly = o.mode === 'folder', multi = !!o.multiple;
    const usable = enabledIds();
    return new Promise(resolve => {
      const back = document.createElement('div'); back.className = 'wbc-back';
      back.innerHTML = `<div class="wbc" role="dialog" aria-modal="true" aria-label="${mode === 'open' ? 'Aus der Cloud öffnen' : 'In der Cloud speichern'}">
        <header><h3>${mode === 'open' ? 'Aus der Cloud öffnen' : 'In der Cloud speichern'}</h3><button class="wbc-x" data-x="close" aria-label="Schließen">×</button></header>
        <div class="wbc-prov"></div><div class="wbc-crumb"></div><div class="wbc-list"></div>
        <footer>${folderOnly ? `<span style="flex:1;color:var(--muted)">${esc(o.hint || 'Zielordner wählen')}</span>` : mode === 'save' ? `<input class="wbc-name" value="${esc(o.name || 'Dokument.pdf')}" aria-label="Dateiname">` : '<span class="wbc-sel" style="flex:1;color:var(--muted)"></span>'}
          <button class="wbc-b" data-x="close">Abbrechen</button><button class="wbc-b p" data-x="go" disabled>${mode === 'open' ? 'Öffnen' : 'Hier speichern'}</button></footer></div>`;
      document.body.appendChild(back);
      const $ = s => back.querySelector(s);
      const st = { pid: usable.includes(o.provider) ? o.provider : usable[0], path: [], items: [], sel: new Set(), tok: 0 };
      const done = v => { back.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
      const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
      document.addEventListener('keydown', onKey, true);
      const accept = it => !it.dir && (o.accept ? o.accept.includes(it.kind) : it.kind !== 'file');
      function provs() {
        $('.wbc-prov').innerHTML = usable.map(id => `<button data-p="${id}" aria-pressed="${id === st.pid}">${icon(id, P[id].color)}${esc(P[id].short)}</button>`).join('');
      }
      function crumbs() {
        const segs = [[P[st.pid].short, 0], ...st.path.map((n, i) => [n, i + 1])];
        $('.wbc-crumb').innerHTML = segs.map(([n, i], k) => (k ? '<span>›</span>' : '') + `<button data-c="${i}">${esc(n)}</button>`).join('');
      }
      function list() {
        const L = $('.wbc-list');
        if (!st.items.length) { L.innerHTML = `<div class="wbc-msg">${mode === 'open' ? 'Keine PDFs in diesem Ordner.' : 'Leerer Ordner – hier speichern?'}</div>`; return; }
        L.innerHTML = st.items.map((it, i) => {
          const can = it.dir || (mode === 'open' && accept(it));
          return `<button class="wbc-row" data-i="${i}" ${can ? '' : 'disabled'} aria-selected="${st.sel.has(i)}">${icon(it.dir ? 'dir' : it.kind === 'file' ? 'file' : 'pdf', it.dir ? '#c58b10' : it.kind === 'werkbank' ? '#1f4fd8' : it.kind === 'pdf' ? '#c4352b' : null)}<span class="n">${esc(it.name)}</span><small>${it.dir ? '' : fmtSize(it.size) + (it.mtime ? ' · ' + fmtDate(it.mtime) : '')}</small></button>`;
        }).join('');
      }
      function foot() {
        const go = $('[data-x=go]');
        if (mode === 'open') { go.disabled = !st.sel.size; const s = $('.wbc-sel'); s.textContent = st.sel.size ? (st.sel.size === 1 ? st.items[[...st.sel][0]].name : st.sel.size + ' Dateien') : ''; }
        else go.disabled = !st.pid || (!folderOnly && !$('.wbc-name').value.trim());
      }
      async function load() {
        const tok = ++st.tok, L = $('.wbc-list');
        st.sel.clear(); foot(); crumbs();
        L.innerHTML = '<div class="wbc-msg"><span class="wbc-spin"></span>Wird geladen …</div>';
        try {
          let items;
          try { items = await P[st.pid].list(st.path); }
          catch (e) { if (e.notFound && st.path.length === 0) items = []; else if (e.notFound) { st.path = []; return load(); } else throw e; }
          if (tok !== st.tok) return;
          st.items = items.filter(it => it.dir || mode === 'save' || it.kind !== 'file' || !o.accept).sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, 'de', { numeric: true }));
          list();
        } catch (e) {
          if (tok !== st.tok) return;
          L.innerHTML = `<div class="wbc-msg">${esc(e.message || String(e))}${e.needAuth ? `<p><button class="wbc-b p" data-x="resume">${P[st.pid].folder ? 'Zugriff erlauben' : 'Neu anmelden'}</button></p>` : ''}</div>`;
        }
      }
      if (!usable.length) {
        $('.wbc-list').innerHTML = `<div class="wbc-msg">Noch kein Cloud-Dienst verbunden.<br>In der Bibliothek unten links unter <b>Cloud-Dienste</b> Dropbox, iCloud Drive oder Nextcloud verbinden.</div>`;
        $('.wbc-prov').hidden = true;
      } else {
        provs();
        if (mode === 'save') st.path = [ROOT];
        load();
      }
      back.addEventListener('input', e => { if (e.target.classList.contains('wbc-name')) foot(); });
      back.addEventListener('click', async e => {
        if (e.target === back) { done(null); return; }
        const p = e.target.closest('[data-p]'); if (p) { st.pid = p.dataset.p; st.path = mode === 'save' ? [ROOT] : []; provs(); load(); return; }
        const c = e.target.closest('[data-c]'); if (c) { st.path = st.path.slice(0, +c.dataset.c); load(); return; }
        const r = e.target.closest('[data-i]');
        if (r) {
          const i = +r.dataset.i, it = st.items[i];
          if (it.dir) { st.path = [...st.path, it.name]; load(); return; }
          if (mode !== 'open' || !accept(it)) return;
          if (multi && (e.ctrlKey || e.metaKey || e.shiftKey || st.sel.size)) { if (st.sel.has(i)) st.sel.delete(i); else st.sel.add(i); }
          else { st.sel.clear(); st.sel.add(i); }
          list(); foot();
          return;
        }
        const x = e.target.closest('[data-x]'); if (!x) return;
        if (x.dataset.x === 'close') { done(null); return; }
        if (x.dataset.x === 'resume') { try { await resume(st.pid); load(); } catch (er) { $('.wbc-list').innerHTML = `<div class="wbc-msg">${esc(er.message || er)}</div>`; } return; }
        if (x.dataset.x === 'go') {
          x.disabled = true; const lbl = x.textContent; x.innerHTML = '<span class="wbc-spin"></span>' + (mode === 'open' ? 'Lädt …' : 'Speichert …');
          try {
            if (mode === 'open') {
              const out = [];
              for (const i of st.sel) { const it = st.items[i], path = [...st.path, it.name]; out.push({ name: it.name, bytes: await P[st.pid].get(path), provider: st.pid, path }); }
              done(out);
            } else if (folderOnly) {
              done({ provider: st.pid, path: st.path.slice(), label: P[st.pid].short });
            } else {
              let name = safeName($('.wbc-name').value); if (o.ext && !name.toLowerCase().endsWith(o.ext)) name += o.ext;
              const path = [...st.path, name];
              if (st.items.some(it => !it.dir && it.name.toLowerCase() === name.toLowerCase()) && !confirm(`„${name}“ gibt es dort schon. Ersetzen?`)) { x.disabled = false; x.textContent = lbl; return; }
              const bytes = o.bytes || await o.make();
              await P[st.pid].put(path, bytes);
              done({ provider: st.pid, path, label: P[st.pid].short });
            }
          } catch (er) {
            x.disabled = false; x.textContent = lbl;
            $('.wbc-list').insertAdjacentHTML('afterbegin', `<div class="wbc-msg" style="color:var(--danger,#c4352b)">${esc(er.message || er)}</div>`);
          }
        }
      });
    });
  }

  /* Desktop: gefundene Cloud-Ordner (iCloud Drive, OneDrive, Dropbox …) */
  async function presets() { if (!DESK || !DESK.folderPresets) return []; try { return await DESK.folderPresets(); } catch (e) { return []; } }

  global.WBCloud = {
    providers: P, ORDER, MODES, DAV_PRESETS, icon,
    info, infoAll, connect, resume, disconnect, setOptions, handleRedirect,
    run: (force = true) => runBackup(force, force ? 'manual' : 'change'), schedule, watch, backupNow, wants, pending,
    pick, presets, folderApi: () => !!(DESK ? DESK.fsOp : fsApi()),
    enabledIds, anyEnabled: () => enabledIds().length > 0,
    onStatus: fn => { listeners.add(fn); fn(infoAll(), { running: run.running, done: run.done, total: run.total }); return () => listeners.delete(fn); },
    _http: http,
  };
})(window);
