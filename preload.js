/* Brücke zwischen Oberfläche und Desktop: nur diese Funktionen sieht die Webseite */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const aiCbs = new Map(), aiBuf = new Map();
ipcRenderer.on('ai-event', (_e, id, ev) => {
  const cb = aiCbs.get(id);
  if (cb) { cb(ev); if (ev.type === 'end' || ev.type === 'error') aiCbs.delete(id); }
  else { if (!aiBuf.has(id)) aiBuf.set(id, []); aiBuf.get(id).push(ev); }
});

contextBridge.exposeInMainWorld('wbDesktop', {
  platform: process.platform,
  // PDFs aus dem System (Doppelklick, „Öffnen mit“, Dock)
  onOpenFiles: cb => { ipcRenderer.on('open-files', (_e, files) => cb(files.map(f => ({ name: f.name, bytes: f.bytes })))); },
  // Befehle aus dem App-Menü
  onMenu: cb => { ipcRenderer.on('menu', (_e, k) => cb(k)); },
  // Google Drive (Anmeldung im System-Browser, Zugang erneuert die App selbst)
  googleConnect: cfg => ipcRenderer.invoke('google-connect', cfg).then(r => { if (r && r.error) throw new Error(r.error); return r; }),
  googleToken: cfg => ipcRenderer.invoke('google-token', cfg).then(r => { if (r && r.error) throw new Error(r.error); return r; }),
  googleDisconnect: () => ipcRenderer.invoke('google-disconnect'),
  // KI: Mit ChatGPT anmelden (Plus/Pro-Abo) und eigene API-Schlüssel, verschlüsselt gespeichert
  chatgptConnect: () => ipcRenderer.invoke('chatgpt-connect').then(r => { if (r && r.error) throw new Error(r.error); return r; }),
  chatgptToken: () => ipcRenderer.invoke('chatgpt-token').then(r => { if (r && r.error) throw new Error(r.error); return r; }),
  chatgptDisconnect: () => ipcRenderer.invoke('chatgpt-disconnect'),
  chatgptStatus: () => ipcRenderer.invoke('chatgpt-status'),
  aiSecret: o => ipcRenderer.invoke('ai-secret', o).then(r => { if (r && r.error) throw new Error(r.error); return r; }),
  // KI-Anfragen über das Hauptprogramm (gestreamt)
  aiRequest: async (req, cb) => {
    const r = await ipcRenderer.invoke('ai-request', req);
    if (!r || r.error) throw new Error((r && r.error) || 'KI-Anfrage fehlgeschlagen');
    aiCbs.set(r.id, cb);
    for (const ev of aiBuf.get(r.id) || []) cb(ev);
    aiBuf.delete(r.id);
    return r.id;
  },
  aiAbort: id => ipcRenderer.send('ai-abort', id),
  // Datei über den Speichern-Dialog des Systems sichern
  saveFile: (name, bytes) => ipcRenderer.invoke('save-file', { name, bytes }).then(r => { if (r && r.error) throw new Error(r.error); return r; }),
  // automatische Updates
  version: () => ipcRenderer.invoke('app-version'),
  onUpdate: cb => { ipcRenderer.on('update-status', (_e, s) => cb(s)); ipcRenderer.invoke('update-status').then(cb); },
  checkUpdate: () => ipcRenderer.invoke('update-check'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  // Standard-PDF-Programm: Datei direkt bearbeiten und zurückschreiben
  onOpenPath: cb => { ipcRenderer.on('open-path', (_e, f) => cb({ name: f.name, path: f.path, bytes: f.bytes, mtime: f.mtime })); },
  fileWrite: bytes => ipcRenderer.invoke('file-write', { bytes }).then(r => { if (r && r.error) throw new Error(r.error); return r; }),
  fileSaveAs: (bytes, name) => ipcRenderer.invoke('file-save-as', { bytes, name }).then(r => { if (r && r.error) throw new Error(r.error); return r; }),
  docState: st => ipcRenderer.send('doc-state', st),
  closeWindow: () => ipcRenderer.send('close-window'),
  openLibrary: () => ipcRenderer.invoke('open-library'),
  openDialog: () => ipcRenderer.invoke('open-dialog'),
  settings: patch => ipcRenderer.invoke('desk-settings', patch),
  defaultPdf: set => ipcRenderer.invoke('default-pdf', { set: !!set }).then(r => { if (r && r.error) throw new Error(r.error); return r; }),
  diag: () => ipcRenderer.invoke('diag'),
  showPath: which => ipcRenderer.invoke('show-path', which),
  reportError: msg => ipcRenderer.send('renderer-error', String(msg)),
  // Oberfläche bereit: wartende Dateien schicken
  ready: () => ipcRenderer.send('renderer-ready'),
});
