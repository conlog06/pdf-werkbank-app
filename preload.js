/* Brücke zwischen Oberfläche und Desktop: nur diese Funktionen sieht die Webseite */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

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
  // Datei über den Speichern-Dialog des Systems sichern
  saveFile: (name, bytes) => ipcRenderer.invoke('save-file', { name, bytes }).then(r => { if (r && r.error) throw new Error(r.error); return r; }),
  // automatische Updates
  version: () => ipcRenderer.invoke('app-version'),
  onUpdate: cb => { ipcRenderer.on('update-status', (_e, s) => cb(s)); ipcRenderer.invoke('update-status').then(cb); },
  checkUpdate: () => ipcRenderer.invoke('update-check'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  // Oberfläche bereit: wartende Dateien schicken
  ready: () => ipcRenderer.send('renderer-ready'),
});
