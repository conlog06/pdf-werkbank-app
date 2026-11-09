/* PDF Werkbank – Desktop-App (Windows und macOS)
 * Lädt die Weboberfläche aus web/ über das eigene Protokoll app://werkbank,
 * damit Bibliothek (IndexedDB), Cloud-Abgleich und Editor genau wie auf der Webseite laufen.
 */
'use strict';
const { app, BrowserWindow, protocol, net, Menu, shell, ipcMain, nativeTheme, dialog, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const isMac = process.platform === 'darwin';
const WEB = path.join(__dirname, 'web');
const HOME = 'app://werkbank/library.html';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } },
]);

/* nur eine Instanz: weitere Starts (z. B. Doppelklick auf eine PDF) gehen an das offene Fenster */
if (!app.requestSingleInstanceLock()) { app.quit(); return; }

let win = null; // Bibliotheksfenster
let rendererReady = false;
const pending = [];

/* ---------- Protokoll: Fehler und Abstürze landen in einer Logdatei (Hilfe › Fehlerprotokoll) ---------- */
const logFile = () => path.join(app.getPath('userData'), 'logs', 'werkbank.log');
function log(...a) {
  try {
    const f = logFile(); fs.mkdirSync(path.dirname(f), { recursive: true });
    try { if (fs.statSync(f).size > 1e6) fs.renameSync(f, f + '.old'); } catch (e) { /* neu */ }
    fs.appendFileSync(f, `[${new Date().toISOString()}] ${a.map(x => (x instanceof Error ? x.stack || x.message : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}\n`);
  } catch (e) { /* Protokoll darf nie selbst Fehler werfen */ }
}
process.on('uncaughtException', e => { log('main uncaught', e); });
process.on('unhandledRejection', e => { log('main rejection', e); });

/* ---------- Einstellungen der Desktop-App ---------- */
const setFile = () => path.join(app.getPath('userData'), 'einstellungen.json');
let SET = null;
function settings() {
  if (!SET) { try { SET = JSON.parse(fs.readFileSync(setFile(), 'utf8')); } catch (e) { SET = {}; } SET = { openMode: 'edit', askDefault: true, ...SET }; }
  return SET;
}
function saveSettings(patch) { SET = { ...settings(), ...patch }; try { fs.writeFileSync(setFile(), JSON.stringify(SET, null, 2)); } catch (e) { log('settings', e); } return SET; }

/* ---------- PDFs aus dem System öffnen ----------
   openMode „edit“ (Standard): jede PDF in einem eigenen Fenster, Speichern schreibt in dieselbe Datei.
   openMode „library“: wie bisher in die Bibliothek importieren. */
const docWins = new Map(); // webContents.id → { win, path, dirty, force }
const early = [];
const pdfArgs = argv => argv.slice(1).filter(a => /\.pdf$/i.test(a) && !a.startsWith('--') && fs.existsSync(a));
function openPaths(paths) {
  if (!paths.length) return;
  if (!app.isReady()) { early.push(...paths); return; }
  if (settings().openMode === 'library') { queueFiles(paths); return; }
  for (const p of paths) openDocWindow(p);
}
function queueFiles(paths) {
  for (const p of paths) {
    try { pending.push({ name: path.basename(p), bytes: fs.readFileSync(p) }); app.addRecentDocument(p); } catch (e) { log('Datei nicht lesbar', p, e); }
  }
  if (!win) createLibraryWindow();
  deliver();
}
function deliver() {
  if (!pending.length || !win) return;
  const url = win.webContents.getURL();
  if (!/library\.html/.test(url)) { rendererReady = false; win.loadURL(HOME); return; } // Bibliothek nimmt Dateien an
  if (!rendererReady) return;
  win.webContents.send('open-files', pending.splice(0));
  if (win.isMinimized()) win.restore();
  win.focus();
}
const samePath = (a, b) => (process.platform === 'linux' ? a === b : a.toLowerCase() === b.toLowerCase());
function openDocWindow(p) {
  p = path.resolve(p);
  for (const d of docWins.values()) if (samePath(d.path, p) && !d.win.isDestroyed()) { if (d.win.isMinimized()) d.win.restore(); d.win.focus(); return d.win; }
  const w = createAppWindow('app://werkbank/index.html?file=1', 'doc');
  docWins.set(w.webContents.id, { win: w, path: p, dirty: false, force: false });
  w.setTitle(path.basename(p) + ' – PDF Werkbank');
  if (isMac) w.setRepresentedFilename(p);
  app.addRecentDocument(p);
  return w;
}
const docOf = sender => docWins.get(sender.id);
app.on('open-file', (e, p) => { e.preventDefault(); openPaths([p]); }); // macOS: Finder, Dock, „Öffnen mit“
app.on('second-instance', (e, argv) => {
  const ps = pdfArgs(argv);
  if (ps.length) openPaths(ps);
  else { const w = win || BrowserWindow.getAllWindows()[0] || createLibraryWindow(); if (w.isMinimized()) w.restore(); w.focus(); }
});
ipcMain.on('renderer-ready', async e => {
  const d = docOf(e.sender);
  if (d) {
    try {
      const st = await fs.promises.stat(d.path);
      e.sender.send('open-path', { name: path.basename(d.path), path: d.path, bytes: await fs.promises.readFile(d.path), mtime: st.mtimeMs });
    } catch (err) { log('open', d.path, err); dialog.showMessageBox(d.win, { type: 'error', message: 'Die Datei konnte nicht geöffnet werden.', detail: String(err.message || err) }); d.force = true; d.win.close(); }
    return;
  }
  if (win && e.sender === win.webContents) { rendererReady = true; deliver(); }
});
/* in die geöffnete Datei zurückschreiben: zuerst in eine Zwischendatei, dann austauschen (nie halb geschriebene PDFs).
   Vor dem ersten Überschreiben je Sitzung eine Sicherheitskopie des Originals (die letzten 30 bleiben). */
const backupDir = () => path.join(app.getPath('userData'), 'Sicherheitskopien');
async function backupOriginal(p) {
  const dir = backupDir(); await fs.promises.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  await fs.promises.copyFile(p, path.join(dir, `${stamp} ${path.basename(p)}`));
  const all = (await fs.promises.readdir(dir)).sort();
  for (const f of all.slice(0, Math.max(0, all.length - 30))) await fs.promises.unlink(path.join(dir, f)).catch(() => {});
}
async function writeAtomic(p, bytes) {
  const tmp = path.join(path.dirname(p), `.${path.basename(p)}.${process.pid}.wbtmp`);
  try {
    await fs.promises.writeFile(tmp, Buffer.from(bytes));
    try { await fs.promises.rename(tmp, p); }
    catch (e) { if (e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EXDEV') { await fs.promises.copyFile(tmp, p); await fs.promises.unlink(tmp).catch(() => {}); } else throw e; }
  } catch (e) {
    await fs.promises.unlink(tmp).catch(() => {});
    if (e.code === 'EACCES' || e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EROFS') throw new Error('Die Datei ist schreibgeschützt oder in einem anderen Programm geöffnet.');
    throw e;
  }
}
ipcMain.handle('file-write', wrapE(async (e, { bytes }) => {
  const d = docOf(e.sender); if (!d) throw new Error('Kein Dokument zu diesem Fenster');
  let backup = false;
  if (!d.backedUp) { try { await backupOriginal(d.path); d.backedUp = true; backup = true; } catch (err) { log('backup', err); } }
  await writeAtomic(d.path, bytes);
  d.dirty = false; if (isMac) d.win.setDocumentEdited(false);
  return { path: d.path, backup };
}));
ipcMain.handle('file-save-as', wrapE(async (e, { bytes, name }) => {
  const d = docOf(e.sender);
  const w = BrowserWindow.fromWebContents(e.sender);
  const r = await dlgSave(w, { defaultPath: d ? d.path : path.join(app.getPath('documents'), String(name || 'Dokument.pdf')), filters: FILTERS.pdf });
  if (r.canceled || !r.filePath) return { path: null };
  await writeAtomic(r.filePath, bytes);
  if (d) { d.path = r.filePath; d.backedUp = true; d.dirty = false; w.setTitle(path.basename(r.filePath) + ' – PDF Werkbank'); if (isMac) { w.setRepresentedFilename(r.filePath); w.setDocumentEdited(false); } }
  app.addRecentDocument(r.filePath);
  return { path: r.filePath };
}));
ipcMain.on('doc-state', (e, { dirty, title }) => {
  const d = docOf(e.sender); if (!d || d.win.isDestroyed()) return;
  d.dirty = !!dirty;
  if (title) d.win.setTitle(String(title));
  if (isMac) d.win.setDocumentEdited(!!dirty);
});
ipcMain.on('close-window', e => { const d = docOf(e.sender); if (d) { d.force = true; d.win.close(); } });
ipcMain.handle('open-library', () => { const w = win || createLibraryWindow(); if (w.isMinimized()) w.restore(); w.focus(); return true; });
ipcMain.handle('open-dialog', async e => {
  const r = await dlgOpen(BrowserWindow.fromWebContents(e.sender), { properties: ['openFile', 'multiSelections'], filters: FILTERS.pdf });
  if (!r.canceled) for (const p of r.filePaths) openDocWindow(p);
  return { count: r.canceled ? 0 : r.filePaths.length };
});
ipcMain.handle('desk-settings', (e, patch) => (patch ? saveSettings(patch) : settings()));
/* Standard-PDF-Programm */
const DEF = require('./default-app');
ipcMain.handle('default-pdf', wrapE(async (e, { set } = {}) => {
  const o = { bundleId: 'de.loggx.pdfwerkbank', appPath: isMac ? path.resolve(app.getPath('exe'), '..', '..', '..') : undefined, openExternal: u => shell.openExternal(u) };
  const r = set ? await DEF.makeDefault(o) : await DEF.status(o);
  if (set) log('default-pdf', r);
  return r;
}));
ipcMain.handle('diag', () => {
  let text = '';
  try { text = fs.readFileSync(logFile(), 'utf8').slice(-20000); } catch (e) { text = ''; }
  return { version: app.getVersion(), platform: process.platform + ' ' + process.arch + ' ' + os.release(), electron: process.versions.electron, log: text, logPath: logFile(), backups: backupDir() };
});
ipcMain.handle('show-path', (e, which) => { shell.openPath(which === 'backups' ? backupDir() : path.dirname(logFile())); return true; });
ipcMain.on('renderer-error', (e, msg) => log('renderer', String(msg).slice(0, 4000)));

/* ---------- Google Drive: Anmeldung im System-Browser, Zugang bleibt verschlüsselt gespeichert ----------
   Ablauf für installierte Apps (OAuth mit PKCE und Rücksprung auf 127.0.0.1), Google erlaubt keine Anmeldung im App-Fenster. */
const G_SCOPE = 'https://www.googleapis.com/auth/drive.file openid email';
const gFile = () => path.join(app.getPath('userData'), 'google.bin');
let gAccess = null;
const b64url = b => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function readRefresh() {
  try { const b = fs.readFileSync(gFile()); return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(b) : b.toString('utf8'); } catch (e) { return null; }
}
function writeRefresh(rt) { fs.writeFileSync(gFile(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(rt) : Buffer.from(rt, 'utf8')); }
async function tokenReq(params) {
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error_description || j.error || 'Google-Anmeldung fehlgeschlagen'); e.code = j.error; throw e; }
  return j;
}
const donePage = ok => `<!doctype html><meta charset="utf-8"><title>PDF Werkbank</title><body style="font:16px system-ui;display:grid;place-items:center;height:90vh;color:#1b2130"><div style="text-align:center"><h2>${ok ? 'Google Drive ist verbunden' : 'Anmeldung abgebrochen'}</h2><p>Du kannst dieses Fenster schließen und zur PDF Werkbank zurückkehren.</p></div>`;
async function googleConnect({ clientId, secret }) {
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  let redirect = '';
  const code = await new Promise((res, rej) => {
    const srv = http.createServer((req, resp) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== '/') { resp.writeHead(404); resp.end(); return; }
      const ok = !!u.searchParams.get('code') && u.searchParams.get('state') === state;
      resp.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); resp.end(donePage(ok));
      clearTimeout(to); srv.close();
      if (ok) res(u.searchParams.get('code')); else rej(new Error(u.searchParams.get('error') === 'access_denied' ? 'Zugriff wurde nicht erlaubt.' : 'Anmeldung abgebrochen.'));
    });
    const to = setTimeout(() => { srv.close(); rej(new Error('Zeitüberschreitung bei der Anmeldung.')); }, 5 * 60000);
    srv.listen(0, '127.0.0.1', () => {
      redirect = `http://127.0.0.1:${srv.address().port}/`;
      shell.openExternal('https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
        client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: G_SCOPE,
        code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent', state,
      }));
    });
  });
  const tk = await tokenReq({ client_id: clientId, client_secret: secret, code, code_verifier: verifier, redirect_uri: redirect, grant_type: 'authorization_code' });
  if (!tk.refresh_token) throw new Error('Google hat keinen dauerhaften Zugang erteilt.');
  writeRefresh(tk.refresh_token);
  gAccess = { token: tk.access_token, exp: Date.now() + (tk.expires_in - 120) * 1000 };
  let email = '';
  try { email = JSON.parse(Buffer.from(tk.id_token.split('.')[1], 'base64url').toString('utf8')).email || ''; } catch (e) { /* egal */ }
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  return { email };
}
async function googleToken({ clientId, secret }) {
  if (gAccess && gAccess.exp > Date.now()) return { token: gAccess.token };
  const rt = readRefresh();
  if (!rt) return { token: null };
  try {
    const tk = await tokenReq({ client_id: clientId, client_secret: secret, refresh_token: rt, grant_type: 'refresh_token' });
    gAccess = { token: tk.access_token, exp: Date.now() + (tk.expires_in - 120) * 1000 };
    return { token: gAccess.token };
  } catch (e) {
    if (e.code === 'invalid_grant') { try { fs.unlinkSync(gFile()); } catch (x) { /* egal */ } return { token: null }; }
    throw e;
  }
}
async function googleDisconnect() {
  const rt = readRefresh();
  gAccess = null;
  try { fs.unlinkSync(gFile()); } catch (e) { /* egal */ }
  if (rt) try { await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(rt), { method: 'POST' }); } catch (e) { /* egal */ }
  return {};
}
const wrap = fn => async (_e, arg) => { try { return await fn(arg || {}); } catch (e) { return { error: e.message || String(e) }; } };
ipcMain.handle('google-connect', wrap(googleConnect));
ipcMain.handle('google-token', wrap(googleToken));
ipcMain.handle('google-disconnect', wrap(googleDisconnect));

/* ---------- KI: „Mit ChatGPT anmelden“ und eigene API-Schlüssel (verschlüsselt im System-Schlüsselbund) ---------- */
const { createChatGPTAuth } = require('./chatgpt-auth');
const secretFile = name => path.join(app.getPath('userData'), name);
function readSecret(name) {
  try { const b = fs.readFileSync(secretFile(name)); return JSON.parse(safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(b) : b.toString('utf8')); } catch (e) { return null; }
}
function writeSecret(name, obj) {
  const s = JSON.stringify(obj);
  fs.writeFileSync(secretFile(name), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(s) : Buffer.from(s, 'utf8'), { mode: 0o600 });
}
/* feste, nicht persönliche Kennung dieses Geräts (von OpenAI verlangt) */
function hostId() {
  const f = secretFile('chatgpt-host.json');
  try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); if (j.id) return j.id; } catch (e) { /* neu anlegen */ }
  const id = 'urn:uuid:' + crypto.randomUUID();
  fs.writeFileSync(f, JSON.stringify({ id }), { mode: 0o600 });
  return id;
}
let chatgpt = null;
const cg = () => chatgpt || (chatgpt = createChatGPTAuth({
  store: { read: () => readSecret('chatgpt.bin'), write: o => writeSecret('chatgpt.bin', o) },
  hostId: hostId(), openExternal: u => shell.openExternal(u),
  focus: () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } },
}));
const dlgSave = (w, o) => (w ? dialog.showSaveDialog(w, o) : dialog.showSaveDialog(o));
const dlgOpen = (w, o) => (w ? dialog.showOpenDialog(w, o) : dialog.showOpenDialog(o));
function wrapE(fn) { return async (e, arg) => { try { return await fn(e, arg); } catch (err) { log('ipc', err); return { error: String(err.message || err) }; } }; }
ipcMain.handle('chatgpt-connect', wrap(() => cg().connect()));
ipcMain.handle('chatgpt-token', wrap(() => cg().token()));
ipcMain.handle('chatgpt-disconnect', wrap(() => cg().disconnect()));
ipcMain.handle('chatgpt-status', wrap(() => cg().status()));
ipcMain.handle('ai-secret', wrap(({ name, value, set }) => {
  if (!/^(openai|anthropic)$/.test(name || '')) throw new Error('unbekannt');
  const all = readSecret('ai-keys.bin') || {};
  if (set) { if (value) all[name] = value; else delete all[name]; writeSecret('ai-keys.bin', all); return {}; }
  return { value: all[name] || '' };
}));

/* KI-Anfragen über das Hauptprogramm (die Oberfläche läuft unter app://, dort blockiert CORS manche APIs).
   Nur an die bekannten KI-Dienste, Antwort wird stückweise an das Fenster gestreamt. */
const AI_HOSTS = /^https:\/\/(api\.openai\.com|api\.anthropic\.com|chatgpt\.com|auth\.openai\.com)\//;
const aiReqs = new Map(); let aiN = 0;
ipcMain.handle('ai-request', (e, req) => {
  if (!req || !AI_HOSTS.test(String(req.url))) return { error: 'Ziel nicht erlaubt' };
  const id = ++aiN, ctrl = new AbortController(), wc = e.sender;
  aiReqs.set(id, ctrl);
  const emit = ev => { if (!wc.isDestroyed()) wc.send('ai-event', id, ev); };
  setImmediate(async () => {
    try {
      const r = await fetch(req.url, { method: req.method || 'GET', headers: req.headers || {}, body: req.body || undefined, signal: ctrl.signal });
      emit({ type: 'head', status: r.status });
      const dec = new TextDecoder();
      if (r.body) for await (const c of r.body) emit({ type: 'data', data: dec.decode(c, { stream: true }) });
      emit({ type: 'end' });
    } catch (err) {
      if (err.name !== 'AbortError') log('ai-request', req.url, err);
      emit({ type: 'error', message: err.name === 'AbortError' ? 'aborted' : String((err.cause && err.cause.message) || err.message || err) });
    } finally { aiReqs.delete(id); }
  });
  return { id };
});
ipcMain.on('ai-abort', (e, id) => { const c = aiReqs.get(id); if (c) c.abort(); });

/* Speichern-Dialog des Systems für exportierte PDFs, Bilder und Texte */
const FILTERS = { pdf: [{ name: 'PDF-Dokument', extensions: ['pdf'] }], png: [{ name: 'PNG-Bild', extensions: ['png'] }], txt: [{ name: 'Text', extensions: ['txt'] }] };
ipcMain.handle('save-file', wrapE(async (ev, { name, bytes }) => {
  const ext = (String(name).split('.').pop() || '').toLowerCase();
  const r = await dlgSave(BrowserWindow.fromWebContents(ev.sender), { defaultPath: path.join(app.getPath('downloads'), String(name).replace(/[\\/:*?"<>|]/g, '-')), filters: FILTERS[ext] || [] });
  if (r.canceled || !r.filePath) return { path: null };
  await fs.promises.writeFile(r.filePath, Buffer.from(bytes));
  return { path: r.filePath };
}));

/* ---------- Fenster ---------- */
const stateFile = () => path.join(app.getPath('userData'), 'fenster.json');
function loadState() { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch (e) { return { width: 1360, height: 880 }; } }
function saveState() {
  if (!win || win.isDestroyed()) return;
  const b = win.getNormalBounds();
  try { fs.writeFileSync(stateFile(), JSON.stringify({ ...b, max: win.isMaximized() })); } catch (e) { /* egal */ }
}
const overlay = () => (nativeTheme.shouldUseDarkColors ? { color: '#171a21', symbolColor: '#e6e9ef', height: 44 } : { color: '#f7f8fa', symbolColor: '#1b2130', height: 44 });

function createAppWindow(url, kind = 'library') {
  const st = loadState(), lib = kind === 'library';
  const others = BrowserWindow.getAllWindows().length;
  const w = new BrowserWindow({
    x: lib ? st.x : undefined, y: lib ? st.y : undefined,
    width: st.width || 1360, height: st.height || 880, minWidth: 880, minHeight: 600,
    title: 'PDF Werkbank', show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111419' : '#eef0f4',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 16, y: 14 } } : { titleBarOverlay: overlay() }),
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, spellcheck: true },
  });
  if (!lib && others) { const [x, y] = w.getPosition(); w.setPosition(x + 28 * (others % 8), y + 28 * (others % 8)); }
  if (lib && st.max) w.maximize();
  w.once('ready-to-show', () => w.show());
  const wc = w.webContents, id = wc.id;
  if (lib) {
    w.on('close', saveState);
    w.on('closed', () => { if (win === w) win = null; });
    wc.on('did-start-navigation', (e) => { if (e.isMainFrame && !e.isSameDocument) rendererReady = false; });
  } else {
    // ungespeicherte Änderungen: wie in Acrobat nachfragen
    w.on('close', e => {
      const d = docWins.get(id);
      if (!d || d.force || !d.dirty) return;
      e.preventDefault();
      const r = dialog.showMessageBoxSync(w, { type: 'question', buttons: ['Speichern', 'Nicht speichern', 'Abbrechen'], defaultId: 0, cancelId: 2, message: `Änderungen an „${path.basename(d.path)}“ speichern?`, detail: 'Ohne Speichern gehen die Änderungen verloren.' });
      if (r === 0) wc.send('menu', 'save-close');
      else if (r === 1) { d.force = true; w.close(); }
    });
    w.on('closed', () => docWins.delete(id));
  }
  // Stabilität: abgestürzte oder hängende Seiten wiederbeleben statt ein leeres Fenster zu zeigen
  wc.on('render-process-gone', (e, det) => {
    log('render-process-gone', kind, det);
    if (det.reason === 'clean-exit' || w.isDestroyed()) return;
    const r = dialog.showMessageBoxSync(w, { type: 'warning', buttons: ['Neu laden', 'Fenster schließen'], defaultId: 0, message: 'Die Ansicht ist abgestürzt.', detail: 'Deine Bibliothek ist sicher. Bei Dateien werden ungespeicherte Änderungen nach dem Neuladen angeboten.' });
    if (r === 0) wc.reload(); else { const d = docWins.get(id); if (d) d.force = true; w.close(); }
  });
  w.on('unresponsive', () => {
    log('unresponsive', kind);
    const r = dialog.showMessageBoxSync(w, { type: 'warning', buttons: ['Warten', 'Neu laden'], defaultId: 0, message: 'PDF Werkbank reagiert gerade nicht.', detail: 'Große Dateien brauchen manchmal etwas länger.' });
    if (r === 1) wc.reload();
  });
  wc.on('console-message', (e, level, message, line, source) => {
    const lv = e && e.level != null ? e.level : level, msg = e && e.message != null ? e.message : message;
    if (lv === 3 || lv === 'error') log('console', kind, msg, (e && e.sourceId) || source || '', (e && e.lineNumber) || line || '');
  });
  wc.on('preload-error', (e, p, err) => log('preload', err));

  // externe Links im Browser öffnen, App-Seiten im selben Fenster
  wc.setWindowOpenHandler(({ url: u }) => {
    if (/^https?:/i.test(u)) shell.openExternal(u);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, u) => {
    if (!u.startsWith('app://')) { e.preventDefault(); if (/^https?:/i.test(u)) shell.openExternal(u); }
  });
  // F12 / Strg+Umschalt+I: Entwicklerwerkzeuge (Windows hat kein Menü)
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12' || ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i')) { wc.toggleDevTools(); e.preventDefault(); }
  });
  wc.session.on('will-download', (e, item) => { item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('downloads'), item.getFilename()) }); });
  w.loadURL(url);
  return w;
}
function createLibraryWindow() { win = createAppWindow(HOME, 'library'); return win; }
nativeTheme.on('updated', () => { if (!isMac) for (const w of BrowserWindow.getAllWindows()) try { w.setTitleBarOverlay(overlay()); } catch (e) { /* egal */ } });

/* ---------- Menü (macOS); unter Windows steuert alles die Oberfläche selbst ---------- */
function send(k) {
  const f = BrowserWindow.getFocusedWindow(), fd = f && docWins.get(f.webContents.id);
  if (fd && (k === 'save' || k === 'save-as')) { f.webContents.send('menu', k); return; }
  if (k === 'open') { dlgOpen(f, { properties: ['openFile', 'multiSelections'], filters: FILTERS.pdf }).then(r => { if (!r.canceled) for (const p of r.filePaths) openDocWindow(p); }); return; }
  if (k === 'save' || k === 'save-as') return;
  if (!win) { createLibraryWindow(); if (k === 'library') return; }
  win.focus();
  const url = win.webContents.getURL();
  if (/library\.html/.test(url)) win.webContents.send('menu', k);
  else if (k === 'new-notebook') win.loadURL(HOME + '?new=notebook');
  else if (k === 'import') win.loadURL(HOME + '?import=1');
  else win.loadURL(HOME);
}
function buildMenu() {
  if (!isMac) { Menu.setApplicationMenu(null); return; }
  const item = (label, k, accel) => ({ label, accelerator: accel, registerAccelerator: false, click: () => send(k) });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu', label: 'PDF Werkbank', submenu: [
      { role: 'about', label: 'Über PDF Werkbank' }, { type: 'separator' },
      { label: 'Nach Updates suchen …', click: () => checkUpdates(true) }, { type: 'separator' },
      { role: 'services', label: 'Dienste' }, { type: 'separator' },
      { role: 'hide', label: 'PDF Werkbank ausblenden' }, { role: 'hideOthers', label: 'Andere ausblenden' }, { role: 'unhide', label: 'Alle einblenden' },
      { type: 'separator' }, { role: 'quit', label: 'PDF Werkbank beenden' }] },
    { label: 'Ablage', submenu: [
      { label: 'PDF öffnen …', accelerator: 'Cmd+O', click: () => send('open') }, { role: 'recentDocuments', label: 'Zuletzt geöffnet', submenu: [{ role: 'clearRecentDocuments', label: 'Liste löschen' }] },
      { label: 'Speichern', accelerator: 'Cmd+S', registerAccelerator: false, click: () => send('save') }, { label: 'Speichern unter …', accelerator: 'Cmd+Shift+S', registerAccelerator: false, click: () => send('save-as') },
      { type: 'separator' },
      item('Neues Notizbuch', 'new-notebook', 'Cmd+N'), item('Neuer Ordner', 'new-folder', 'Cmd+Shift+N'), item('In Bibliothek importieren …', 'import', 'Cmd+Shift+O'),
      { type: 'separator' }, item('Bibliothek', 'library'), item('Geräte synchronisieren …', 'sync'), item('Backup in Google Drive …', 'drive'),
      { type: 'separator' }, { role: 'close', label: 'Fenster schließen' }] },
    { label: 'Bearbeiten', submenu: [
      { role: 'undo', label: 'Widerrufen', registerAccelerator: false }, { role: 'redo', label: 'Wiederholen', registerAccelerator: false }, { type: 'separator' },
      { role: 'cut', label: 'Ausschneiden' }, { role: 'copy', label: 'Kopieren' }, { role: 'paste', label: 'Einsetzen' },
      { role: 'selectAll', label: 'Alles auswählen', registerAccelerator: false }] },
    { label: 'Darstellung', submenu: [
      { role: 'reload', label: 'Neu laden' }, { role: 'toggleDevTools', label: 'Entwicklerwerkzeuge' }, { type: 'separator' },
      { role: 'togglefullscreen', label: 'Vollbild' }] },
    { role: 'windowMenu', label: 'Fenster' },
    { role: 'help', label: 'Hilfe', submenu: [
      { label: 'PDF Werkbank im Web', click: () => shell.openExternal('https://conlog06.github.io/pdf-werkbank/library.html') },
      { label: 'Projekt auf GitHub', click: () => shell.openExternal('https://github.com/conlog06/pdf-werkbank-app') },
      { type: 'separator' },
      { label: 'Als Standard-PDF-Programm festlegen', click: async () => { const r = await DEF.makeDefault({ bundleId: 'de.loggx.pdfwerkbank', appPath: path.resolve(app.getPath('exe'), '..', '..', '..'), openExternal: u => shell.openExternal(u) }).catch(e => ({ error: e.message })); dialog.showMessageBox({ message: r.done ? 'PDF Werkbank öffnet jetzt alle PDFs.' : 'Bitte im Finder festlegen', detail: r.done ? '' : 'Rechtsklick auf eine PDF › Informationen › „Öffnen mit“: PDF Werkbank › „Alle ändern …“' + (r.error ? '\n\n' + r.error : '') }); } },
      { label: 'Fehlerprotokoll anzeigen', click: () => shell.showItemInFolder(logFile()) },
      { label: 'Sicherheitskopien anzeigen', click: () => shell.openPath(backupDir()) }] },
  ]));
}

/* ---------- Automatische Updates (GitHub-Releases) ----------
   Windows: electron-updater lädt im Hintergrund, die Oberfläche bietet „Jetzt neu starten“ an.
   macOS:   ohne Apple-Signatur geht Squirrel nicht – eigener Updater: ZIP laden, Prüfsumme prüfen,
            entpacken, beim Neustart das App-Paket austauschen. */
const { spawn, execFile } = require('child_process');
const os = require('os');
let updater = null, upd = { state: 'idle' };
function sendUpdate(patch) {
  upd = { ...upd, ...patch };
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('update-status', upd);
}
ipcMain.handle('update-status', () => upd);
ipcMain.handle('app-version', () => app.getVersion());
ipcMain.handle('update-check', () => checkUpdates(true));
ipcMain.handle('update-install', () => installUpdate());
function getUpdater() {
  if (updater || !app.isPackaged) return updater;
  try {
    updater = require('electron-updater').autoUpdater;
    updater.autoDownload = !isMac;
    updater.autoInstallOnAppQuit = true;
    updater.on('update-available', i => sendUpdate({ state: 'downloading', version: i.version, percent: 0 }));
    updater.on('download-progress', p => sendUpdate({ state: 'downloading', percent: Math.round(p.percent || 0) }));
    updater.on('update-downloaded', i => sendUpdate({ state: 'ready', version: i.version }));
    updater.on('error', e => { if (upd.state === 'downloading') sendUpdate({ state: 'error', error: String(e.message || e) }); });
  } catch (e) { updater = null; }
  return updater;
}
const execP = (cmd, args) => new Promise((res, rej) => execFile(cmd, args, (e, so, se) => (e ? rej(new Error(se || e.message)) : res(so))));
async function macDownload(info) {
  const files = info.files || [];
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const f = files.find(x => x.url.endsWith('.zip') && x.url.includes(arch)) || files.find(x => x.url.endsWith('.zip'));
  if (!f) throw new Error('Kein Update-Paket für diesen Mac gefunden.');
  const bundle = path.resolve(app.getPath('exe'), '..', '..', '..');
  fs.accessSync(path.dirname(bundle), fs.constants.W_OK); // Ordner muss beschreibbar sein (Programme-Ordner)
  sendUpdate({ state: 'downloading', version: info.version, percent: 0 });
  const url = `https://github.com/conlog06/pdf-werkbank-app/releases/download/v${info.version}/${encodeURIComponent(f.url)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('Download fehlgeschlagen (' + r.status + ')');
  const total = +r.headers.get('content-length') || f.size || 0, chunks = [], hash = crypto.createHash('sha512');
  let got = 0, last = 0;
  for await (const c of r.body) {
    chunks.push(c); hash.update(c); got += c.length;
    const pct = total ? Math.round(got / total * 100) : 0;
    if (pct !== last) { last = pct; sendUpdate({ percent: pct }); }
  }
  if (f.sha512 && hash.digest('base64') !== f.sha512) throw new Error('Prüfsumme des Updates stimmt nicht.');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfwb-update-'));
  const zip = path.join(dir, 'update.zip');
  fs.writeFileSync(zip, Buffer.concat(chunks));
  await execP('/usr/bin/ditto', ['-x', '-k', zip, dir]);
  const appDir = fs.readdirSync(dir).find(n => n.endsWith('.app'));
  if (!appDir) throw new Error('Update-Paket ist unvollständig.');
  const fresh = path.join(dir, appDir);
  try { await execP('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', fresh]); } catch (e) { /* egal */ }
  upd.mac = { fresh, bundle, dir };
  sendUpdate({ state: 'ready', version: info.version });
}
async function checkUpdates(manual) {
  const u = getUpdater();
  if (!u) { if (manual) dialog.showMessageBox({ message: 'Updates gibt es nur in der installierten App.' }); return upd; }
  if (upd.state === 'downloading' || upd.state === 'ready') return upd;
  try {
    const r = await u.checkForUpdates();
    const info = r && r.updateInfo;
    const newer = info && info.version !== app.getVersion() && require('semver').gt(info.version, app.getVersion());
    if (!newer) { sendUpdate({ state: 'current' }); if (manual) dialog.showMessageBox({ message: `PDF Werkbank ${app.getVersion()} ist aktuell.` }); return upd; }
    if (isMac) {
      try { await macDownload(info); }
      catch (e) {
        sendUpdate({ state: 'error', error: String(e.message || e) });
        if (manual) {
          const { response } = await dialog.showMessageBox({ type: 'info', buttons: ['Download-Seite öffnen', 'Später'], message: `PDF Werkbank ${info.version} ist verfügbar.`, detail: 'Automatisch einspielen ging nicht: ' + (e.message || e) });
          if (response === 0) shell.openExternal('https://github.com/conlog06/pdf-werkbank-app/releases/latest');
        }
      }
    }
    // Windows: electron-updater lädt selbst und meldet „update-downloaded“
  } catch (e) {
    if (manual) dialog.showMessageBox({ type: 'warning', message: 'Nach Updates suchen hat nicht geklappt.', detail: String(e.message || e) });
  }
  return upd;
}
function installUpdate() {
  if (upd.state !== 'ready') return false;
  if (!isMac) { setImmediate(() => getUpdater().quitAndInstall(false, true)); return true; }
  const { fresh, bundle } = upd.mac || {};
  if (!fresh) return false;
  // nach dem Beenden das alte App-Paket ersetzen und die neue Version starten
  const script = path.join(path.dirname(fresh), 'install.sh');
  fs.writeFileSync(script, `#!/bin/sh
while kill -0 ${process.pid} 2>/dev/null; do sleep 0.3; done
rm -rf "${bundle}.old"
mv "${bundle}" "${bundle}.old" && mv "${fresh}" "${bundle}" && rm -rf "${bundle}.old"
open "${bundle}"
`);
  spawn('/bin/sh', [script], { detached: true, stdio: 'ignore' }).unref();
  setImmediate(() => app.quit());
  return true;
}

/* ---------- Start ---------- */
app.whenReady().then(() => {
  app.setAppUserModelId('de.loggx.pdfwerkbank');
  protocol.handle('app', req => {
    const u = new URL(req.url);
    let p = decodeURIComponent(u.pathname);
    if (p === '/' || p === '') p = '/library.html';
    const file = path.normalize(path.join(WEB, p));
    if (!file.startsWith(WEB)) return new Response('Nicht erlaubt', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  buildMenu();
  const initial = [...early.splice(0), ...pdfArgs(process.argv)];
  if (initial.length && settings().openMode !== 'library') initial.forEach(openDocWindow); // Doppelklick: nur das Dokument öffnen
  else { createLibraryWindow(); if (initial.length) queueFiles(initial); }
  // Windows: „Zuletzt geöffnet“ in der Taskleiste (Sprungliste)
  if (process.platform === 'win32') try { app.setUserTasks([{ program: process.execPath, arguments: '', iconPath: process.execPath, iconIndex: 0, title: 'Bibliothek', description: 'PDF Werkbank-Bibliothek öffnen' }]); } catch (e) { /* egal */ }
  setTimeout(() => checkUpdates(false), 8000);
  setInterval(() => checkUpdates(false), 4 * 3600 * 1000); // alle 4 Stunden nachsehen
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createLibraryWindow(); });
});
app.on('window-all-closed', () => { if (!isMac) app.quit(); });
