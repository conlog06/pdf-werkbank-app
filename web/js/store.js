/* PDF Werkbank – Bibliothek
 * Ordner und Dokumente liegen lokal in IndexedDB (Webseite und Desktop-App gleich).
 * Jede Änderung wird als „dirty“ markiert; js/sync.js gleicht sie mit der Cloud ab.
 *
 * Eintrag (items):
 *   Ordner:   { id, kind:'folder', name, parent, color, icon, createdAt, updatedAt, trashed }
 *   Dokument: { id, kind:'doc', name, folder, fav, trashed, createdAt, updatedAt, openedAt,
 *               pages, size, srcIds, rev, color }
 *   Nur lokal: dirty, contentDirty, baseRev, missing, upSrc, deleted
 * Daten (blobs): 'src:<doc>:<src>' → { name, bytes }, 'state:<doc>' → Editor-Zustand, 'thumb:<doc>' → Blob
 */
(function (global) {
  'use strict';
  const DB = 'pdf-werkbank-lib';
  let dbP = null;
  function db() {
    if (!dbP) dbP = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('items')) d.createObjectStore('items', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbP;
  }
  function run(stores, mode, fn) {
    return db().then(d => new Promise((res, rej) => {
      const tx = d.transaction(stores, mode);
      let out;
      Promise.resolve(fn(tx, v => { out = v; })).catch(rej);
      tx.oncomplete = () => res(out);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error('abgebrochen'));
    }));
  }
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  const uuid = () => (global.crypto && crypto.randomUUID ? crypto.randomUUID() : 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
  const newRev = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const LOCAL = ['dirty', 'contentDirty', 'baseRev', 'missing', 'upSrc', 'deleted'];

  /* Änderungen an alle offenen Fenster melden (Bibliothek und Editor in mehreren Tabs) */
  const listeners = new Set();
  const chan = 'BroadcastChannel' in global ? new BroadcastChannel('pdfwb-lib') : null;
  function emit(info) { listeners.forEach(f => { try { f(info); } catch (e) { console.error(e); } }); if (chan) chan.postMessage(info); }
  if (chan) chan.onmessage = e => listeners.forEach(f => { try { f(e.data); } catch (x) { console.error(x); } });
  const scheduleSync = () => { if (global.WBSync) global.WBSync.schedule(); };

  /* ---------- Einträge ---------- */
  async function all(withDeleted) {
    const list = await run('items', 'readonly', (tx, done) => req(tx.objectStore('items').getAll()).then(done));
    return withDeleted ? list : list.filter(i => !i.deleted);
  }
  const get = id => run('items', 'readonly', (tx, done) => req(tx.objectStore('items').get(id)).then(done));
  const rawPut = item => run('items', 'readwrite', tx => { tx.objectStore('items').put(item); });

  /* lokale Änderung: Zeitstempel, für den Abgleich markieren, melden */
  async function put(item, opts = {}) {
    item.updatedAt = Date.now();
    if (!opts.local) item.dirty = true;
    await rawPut(item);
    emit({ type: 'item', id: item.id });
    if (!opts.local) scheduleSync();
    return item;
  }
  /* Lesen und Schreiben in einem Schritt (eine IndexedDB-Transaktion): Editor, Bibliothek und Abgleich
     überschreiben sich so nicht gegenseitig. fn bekommt den aktuellen Eintrag und gibt den neuen zurück (oder null). */
  function mutate(id, fn) {
    return run('items', 'readwrite', (tx, done) => new Promise((res, rej) => {
      const os = tx.objectStore('items'), r = os.get(id);
      r.onsuccess = () => { const next = fn(r.result ? { ...r.result } : null); if (next) os.put(next); done(next || null); res(); };
      r.onerror = () => rej(r.error);
    }));
  }
  /* lokale Änderung an einzelnen Feldern */
  async function update(id, patch, opts = {}) {
    const it = await mutate(id, cur => (cur && !cur.deleted ? { ...cur, ...patch, updatedAt: Date.now(), dirty: opts.local ? cur.dirty : true } : null));
    if (!it) return null;
    emit({ type: 'item', id });
    if (!opts.local) scheduleSync();
    return it;
  }
  async function mutateSynced(id, fn) { const it = await mutate(id, fn); if (it) emit({ type: 'item', id, remote: true }); return it; }
  async function createFolder({ name, parent = null, color = '#3b6cf6', icon = 'folder' }) {
    return put({ id: uuid(), kind: 'folder', name: name || 'Neuer Ordner', parent, color, icon, createdAt: Date.now(), trashed: false });
  }
  /* Ordner samt Inhalt (rekursiv) */
  async function descendants(folderId, list) {
    list = list || await all();
    const out = [], stack = [folderId];
    while (stack.length) {
      const f = stack.pop();
      for (const i of list) if ((i.kind === 'folder' ? i.parent : i.folder) === f) { out.push(i); if (i.kind === 'folder') stack.push(i.id); }
    }
    return out;
  }
  async function move(ids, folderId) {
    const list = await all();
    const banned = new Set();
    for (const id of ids) { const it = list.find(i => i.id === id); if (it && it.kind === 'folder') { banned.add(id); (await descendants(id, list)).forEach(d => banned.add(d.id)); } }
    if (folderId && banned.has(folderId)) throw new Error('Ein Ordner kann nicht in sich selbst verschoben werden.');
    for (const id of ids) { const it = list.find(i => i.id === id); if (!it) continue; await update(id, it.kind === 'folder' ? { parent: folderId, trashed: false } : { folder: folderId, trashed: false }); }
  }
  const trash = async ids => { for (const id of ids) await update(id, { trashed: true, trashedAt: Date.now() }); };
  const restore = async ids => { for (const id of ids) await update(id, { trashed: false }); };

  /* endgültig löschen: Grabstein für den Abgleich, lokale Daten weg */
  async function destroy(ids) {
    const list = await all();
    const kill = new Set();
    for (const id of ids) { kill.add(id); const it = list.find(i => i.id === id); if (it && it.kind === 'folder') (await descendants(id, list)).forEach(d => kill.add(d.id)); }
    for (const id of kill) {
      const it = list.find(i => i.id === id); if (!it) continue;
      await dropBlobs(id);
      const tomb = { id, kind: it.kind, deleted: true, dirty: true, updatedAt: Date.now() };
      await rawPut(tomb);
      emit({ type: 'item', id });
    }
    scheduleSync();
  }
  async function emptyTrash() {
    const list = await all();
    const ids = list.filter(i => i.trashed).map(i => i.id);
    if (ids.length) await destroy(ids);
    return ids.length;
  }
  /* nur lokal entfernen (vom Abgleich bestätigt) */
  async function purge(id) {
    await dropBlobs(id);
    await run('items', 'readwrite', tx => { tx.objectStore('items').delete(id); });
    emit({ type: 'item', id });
  }

  /* ---------- Daten ---------- */
  const getBlob = k => run('blobs', 'readonly', (tx, done) => req(tx.objectStore('blobs').get(k)).then(done));
  const putBlob = (k, v) => run('blobs', 'readwrite', tx => { tx.objectStore('blobs').put(v, k); });
  const delBlob = k => run('blobs', 'readwrite', tx => { tx.objectStore('blobs').delete(k); });
  async function dropBlobs(docId) {
    const keys = await run('blobs', 'readonly', (tx, done) => req(tx.objectStore('blobs').getAllKeys()).then(done));
    const mine = keys.filter(k => k === 'state:' + docId || k === 'thumb:' + docId || k === 'text:' + docId || String(k).startsWith('src:' + docId + ':') || String(k).startsWith('textsrc:' + docId + ':'));
    if (mine.length) await run('blobs', 'readwrite', tx => { const s = tx.objectStore('blobs'); mine.forEach(k => s.delete(k)); });
  }
  const kvGet = k => run('kv', 'readonly', (tx, done) => req(tx.objectStore('kv').get(k)).then(done));
  const kvSet = (k, v) => run('kv', 'readwrite', tx => { tx.objectStore('kv').put(v, k); });

  /* ---------- Dokumente ---------- */
  async function importPdf(bytes, name, folder = null, extra = {}) {
    const id = uuid(), sid = 's' + Math.random().toString(36).slice(2, 9);
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    await putBlob(`src:${id}:${sid}`, { name, bytes: u8 });
    if (extra.thumb) await putBlob('thumb:' + id, extra.thumb);
    const now = Date.now();
    const doc = {
      id, kind: 'doc', name: String(name || 'Dokument').replace(/\.pdf$/i, ''), folder, fav: false, trashed: false,
      createdAt: now, openedAt: 0, pages: extra.pages || 0, size: u8.byteLength, srcIds: [sid], rev: newRev(), contentDirty: true,
    };
    if (extra.color) doc.color = extra.color;
    return put(doc);
  }
  /* alles zum Öffnen im Editor: { item, state, sources:[{id,name,bytes}] } */
  async function loadDoc(id) {
    let it = await get(id);
    if (!it || it.deleted) throw new Error('Das Dokument gibt es nicht mehr.');
    if (it.missing) {
      if (!global.WBSync || !global.WBSync.ready()) throw new Error('Das Dokument liegt nur in der Cloud. Bitte anmelden und synchronisieren.');
      await global.WBSync.fetchDoc(id);
      it = await get(id);
    }
    const state = await getBlob('state:' + id);
    const ids = state && state.srcIds ? state.srcIds : it.srcIds || [];
    const sources = [];
    for (const sid of ids) {
      const s = await getBlob(`src:${id}:${sid}`);
      if (!s) throw new Error('Eine Datei des Dokuments fehlt auf diesem Gerät.');
      sources.push({ id: sid, name: s.name, bytes: s.bytes });
    }
    return { item: it, state: state || null, sources };
  }
  /* vom Editor: Zustand, (neue) Quellen, Vorschau */
  async function saveDoc(id, { state, sources = [], thumb, pages, name }) {
    const it = await get(id); if (!it || it.deleted) throw new Error('Das Dokument gibt es nicht mehr.');
    let size = 0;
    for (const s of sources) {
      const k = `src:${id}:${s.id}`;
      size += s.bytes.byteLength || 0;
      if (!(it.srcIds || []).includes(s.id) || !(await getBlob(k))) await putBlob(k, { name: s.name, bytes: s.bytes });
    }
    // nicht mehr benutzte Quellen aufräumen
    const keep = new Set(sources.map(s => s.id));
    for (const old of it.srcIds || []) if (!keep.has(old)) await delBlob(`src:${id}:${old}`);
    await putBlob('state:' + id, state);
    if (thumb) await putBlob('thumb:' + id, thumb);
    const patch = { srcIds: sources.map(s => s.id), rev: newRev(), contentDirty: true, missing: false, size: size || it.size };
    if (pages) patch.pages = pages;
    if (name) patch.name = name;
    return update(id, patch);
  }
  async function duplicate(id, suffix = ' (Kopie)') {
    const src = await get(id); if (!src) return null;
    if (src.missing) await loadDoc(id);
    const it = await get(id);
    const nid = uuid(), now = Date.now();
    for (const sid of it.srcIds || []) { const b = await getBlob(`src:${id}:${sid}`); if (b) await putBlob(`src:${nid}:${sid}`, b); }
    const st = await getBlob('state:' + id); if (st) await putBlob('state:' + nid, st);
    const th = await getBlob('thumb:' + id); if (th) await putBlob('thumb:' + nid, th);
    const copy = { ...it, id: nid, name: it.name + suffix, createdAt: now, openedAt: 0, rev: newRev(), contentDirty: true, fav: false };
    LOCAL.forEach(k => { if (k !== 'contentDirty') delete copy[k]; });
    copy.contentDirty = true;
    return put(copy);
  }
  const markOpened = id => update(id, { openedAt: Date.now() });

  /* Hilfen für den Abgleich (ohne „dirty“) */
  async function putSynced(item) { await rawPut(item); emit({ type: 'item', id: item.id, remote: true }); }
  const publicFields = it => { const o = { ...it }; LOCAL.forEach(k => delete o[k]); delete o.id; delete o.kind; return o; };

  global.WBStore = {
    all, get, put, update, createFolder, descendants, move, trash, restore, destroy, emptyTrash, purge,
    getBlob, putBlob, delBlob, dropBlobs, kvGet, kvSet,
    importPdf, loadDoc, saveDoc, duplicate, markOpened,
    putSynced, rawPut, mutate, mutateSynced, publicFields, uuid, newRev,
    onChange: fn => { listeners.add(fn); return () => listeners.delete(fn); },
  };
})(window);
