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
  // Oberfläche bereit: wartende Dateien schicken
  ready: () => ipcRenderer.send('renderer-ready'),
});
