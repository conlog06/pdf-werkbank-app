/* PDF Werkbank – Desktop-App (Windows und macOS)
 * Lädt die Weboberfläche aus web/ über das eigene Protokoll app://werkbank,
 * damit Bibliothek (IndexedDB), Cloud-Abgleich und Editor genau wie auf der Webseite laufen.
 */
'use strict';
const { app, BrowserWindow, protocol, net, Menu, shell, ipcMain, nativeTheme, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const isMac = process.platform === 'darwin';
const WEB = path.join(__dirname, 'web');
const HOME = 'app://werkbank/library.html';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } },
]);

/* nur eine Instanz: weitere Starts (z. B. Doppelklick auf eine PDF) gehen an das offene Fenster */
if (!app.requestSingleInstanceLock()) { app.quit(); return; }

let win = null;
let rendererReady = false;
const pending = [];

/* ---------- PDFs aus dem System öffnen ---------- */
const pdfArgs = argv => argv.slice(1).filter(a => /\.pdf$/i.test(a) && fs.existsSync(a));
function queueFiles(paths) {
  for (const p of paths) {
    try { pending.push({ name: path.basename(p), bytes: fs.readFileSync(p) }); } catch (e) { console.error('Datei nicht lesbar', p, e); }
  }
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
app.on('open-file', (e, p) => { e.preventDefault(); queueFiles([p]); }); // macOS: Finder, Dock
app.on('second-instance', (e, argv) => {
  queueFiles(pdfArgs(argv));
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});
ipcMain.on('renderer-ready', e => { if (win && e.sender === win.webContents) { rendererReady = true; deliver(); } });

/* ---------- Fenster ---------- */
const stateFile = () => path.join(app.getPath('userData'), 'fenster.json');
function loadState() { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch (e) { return { width: 1360, height: 880 }; } }
function saveState() {
  if (!win || win.isDestroyed()) return;
  const b = win.getNormalBounds();
  try { fs.writeFileSync(stateFile(), JSON.stringify({ ...b, max: win.isMaximized() })); } catch (e) { /* egal */ }
}
const overlay = () => (nativeTheme.shouldUseDarkColors ? { color: '#171a21', symbolColor: '#e6e9ef', height: 44 } : { color: '#f7f8fa', symbolColor: '#1b2130', height: 44 });

function createWindow() {
  const st = loadState();
  win = new BrowserWindow({
    x: st.x, y: st.y, width: st.width || 1360, height: st.height || 880, minWidth: 880, minHeight: 600,
    title: 'PDF Werkbank', show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111419' : '#eef0f4',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 16, y: 14 } } : { titleBarOverlay: overlay() }),
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, spellcheck: true },
  });
  if (st.max) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('close', saveState);
  win.on('closed', () => { win = null; });
  win.webContents.on('did-start-navigation', (e) => { if (e.isMainFrame && !e.isSameDocument) rendererReady = false; });

  // externe Links im Browser öffnen, App-Seiten im selben Fenster
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
  // F12 / Strg+Umschalt+I: Entwicklerwerkzeuge (Windows hat kein Menü)
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12' || ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i')) { win.webContents.toggleDevTools(); e.preventDefault(); }
  });
  win.loadURL(HOME);
}
nativeTheme.on('updated', () => { if (win && !isMac) try { win.setTitleBarOverlay(overlay()); } catch (e) { /* egal */ } });

/* ---------- Menü (macOS); unter Windows steuert alles die Oberfläche selbst ---------- */
function send(k) {
  if (!win) return;
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
      { label: 'Nach Updates suchen …', click: checkUpdates }, { type: 'separator' },
      { role: 'services', label: 'Dienste' }, { type: 'separator' },
      { role: 'hide', label: 'PDF Werkbank ausblenden' }, { role: 'hideOthers', label: 'Andere ausblenden' }, { role: 'unhide', label: 'Alle einblenden' },
      { type: 'separator' }, { role: 'quit', label: 'PDF Werkbank beenden' }] },
    { label: 'Ablage', submenu: [
      item('Neues Notizbuch', 'new-notebook', 'Cmd+N'), item('Neuer Ordner', 'new-folder', 'Cmd+Shift+N'), item('PDF importieren …', 'import', 'Cmd+O'),
      { type: 'separator' }, item('Bibliothek', 'library'), item('Geräte synchronisieren …', 'sync'),
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
      { label: 'Projekt auf GitHub', click: () => shell.openExternal('https://github.com/conlog06/pdf-werkbank-app') }] },
  ]));
}

/* ---------- Updates (über GitHub-Releases) ---------- */
let updater = null;
function getUpdater() {
  if (updater || !app.isPackaged) return updater;
  try { updater = require('electron-updater').autoUpdater; updater.autoDownload = true; } catch (e) { updater = null; }
  return updater;
}
async function checkUpdates(manual) {
  const u = getUpdater();
  if (!u) { if (manual === true || manual) dialog.showMessageBox({ message: 'Updates gibt es nur in der installierten App.' }); return; }
  try {
    if (isMac) {
      // ohne Apple-Signatur kein automatisches Einspielen: auf neue Version hinweisen
      const r = await u.checkForUpdates();
      if (r && r.updateInfo && r.updateInfo.version !== app.getVersion()) {
        const { response } = await dialog.showMessageBox({ type: 'info', buttons: ['Herunterladen', 'Später'], message: `PDF Werkbank ${r.updateInfo.version} ist verfügbar.`, detail: 'Die neue Version auf der Download-Seite laden und installieren.' });
        if (response === 0) shell.openExternal('https://github.com/conlog06/pdf-werkbank-app/releases/latest');
      } else if (manual) dialog.showMessageBox({ message: 'PDF Werkbank ist aktuell.' });
    } else {
      await u.checkForUpdatesAndNotify({ title: 'Update für PDF Werkbank', body: 'Wird beim nächsten Beenden installiert.' });
    }
  } catch (e) { if (manual) dialog.showMessageBox({ type: 'warning', message: 'Nach Updates suchen hat nicht geklappt.', detail: String(e.message || e) }); }
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
  createWindow();
  queueFiles(pdfArgs(process.argv));
  setTimeout(() => checkUpdates(false), 8000);
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (!isMac) app.quit(); });
