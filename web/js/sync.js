/* PDF Werkbank – Cloud-Abgleich über Supabase
 * Gleicht die lokale Bibliothek (js/store.js) zwischen Webseite und Desktop-App ab.
 *   Tabelle wb_items: eine Zeile pro Ordner/Dokument (Metadaten als JSON), Grabsteine für Gelöschtes
 *   Speicher „werkbank“: <user>/<doc>/src/<quelle>.pdf, <user>/<doc>/state-<rev>.json, <user>/<doc>/thumb-<rev>.jpg
 * Regeln: neuere Änderung gewinnt; wurde ein Dokument auf zwei Geräten gleichzeitig bearbeitet,
 * bleibt die eigene Fassung als „Konflikt“-Kopie erhalten.
 */
(function (global) {
  'use strict';
  const BUCKET = 'werkbank', TABLE = 'wb_items';
  const st = { client: null, user: null, status: 'off', error: '', lastSync: 0, running: false, again: false, timer: 0, chan: null, inited: false };
  const listeners = new Set();
  const emit = () => listeners.forEach(f => { try { f(info()); } catch (e) { console.error(e); } });
  const info = () => ({ status: st.status, error: st.error, user: st.user ? { id: st.user.id, email: st.user.email } : null, lastSync: st.lastSync, configured: !!config() });
  const set = (status, error = '') => { st.status = status; st.error = error; emit(); };
  const S = () => global.WBStore;

  /* Zugangsdaten: fest in js/config.js oder in den Einstellungen eingetragen */
  function config() {
    const c = global.WB_CONFIG || {};
    if (c.supabaseUrl && c.supabaseKey) return { url: c.supabaseUrl, key: c.supabaseKey, fixed: true };
    try { const o = JSON.parse(localStorage.getItem('pdfwb.sync') || 'null'); if (o && o.url && o.key) return o; } catch (e) { /* egal */ }
    return null;
  }
  function setConfig(url, key) {
    try { localStorage.setItem('pdfwb.sync', JSON.stringify({ url: url.trim().replace(/\/+$/, ''), key: key.trim() })); } catch (e) { /* egal */ }
    st.client = null; st.inited = false;
    return init();
  }

  async function init() {
    if (st.inited) return info();
    st.inited = true;
    const c = config();
    if (!c) { set('unconfigured'); return info(); }
    if (!global.supabase || !global.supabase.createClient) { set('error', 'Die Sync-Bibliothek fehlt.'); return info(); }
    st.client = global.supabase.createClient(c.url, c.key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'pdfwb-auth', detectSessionInUrl: true } });
    try {
      const { data } = await st.client.auth.getSession();
      st.user = data && data.session ? data.session.user : null;
    } catch (e) { st.user = null; }
    st.client.auth.onAuthStateChange((ev, session) => {
      const u = session ? session.user : null;
      const changed = (u && u.id) !== (st.user && st.user.id);
      st.user = u;
      if (changed) { if (u) start(); else stop(); }
      emit();
    });
    if (st.user) start(); else set('signedout');
    return info();
  }

  let iv = 0;
  function start() {
    set('idle');
    subscribe();
    clearInterval(iv); iv = setInterval(() => syncNow(), 60000);
    syncNow();
  }
  function stop() {
    clearInterval(iv); iv = 0;
    if (st.chan) { try { st.client.removeChannel(st.chan); } catch (e) { /* egal */ } st.chan = null; }
    set(config() ? 'signedout' : 'unconfigured');
  }
  /* Änderungen anderer Geräte sofort holen */
  function subscribe() {
    if (!st.client || !st.user || st.chan) return;
    try {
      st.chan = st.client.channel('wb-' + st.user.id)
        .on('postgres_changes', { event: '*', schema: 'public', table: TABLE, filter: 'user_id=eq.' + st.user.id }, () => schedule(400))
        .subscribe();
    } catch (e) { st.chan = null; }
  }

  async function signIn(email, password) {
    await init();
    if (!st.client) throw new Error('Sync ist noch nicht eingerichtet.');
    const { error } = await st.client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(authMsg(error));
  }
  async function signUp(email, password) {
    await init();
    if (!st.client) throw new Error('Sync ist noch nicht eingerichtet.');
    const redirect = /^https?:/.test(location.protocol) ? location.origin + location.pathname : undefined;
    const { data, error } = await st.client.auth.signUp({ email, password, options: redirect ? { emailRedirectTo: redirect } : {} });
    if (error) throw new Error(authMsg(error));
    return { confirm: !(data && data.session) };
  }
  async function signOut() { if (st.client) await st.client.auth.signOut(); }
  function authMsg(e) {
    const m = (e && e.message) || '';
    if (/invalid login/i.test(m)) return 'E-Mail oder Passwort stimmt nicht.';
    if (/not confirmed/i.test(m)) return 'Bitte zuerst den Link in der Bestätigungs-E-Mail anklicken.';
    if (/already registered/i.test(m)) return 'Für diese E-Mail gibt es schon ein Konto. Bitte anmelden.';
    if (/password/i.test(m) && /6/.test(m)) return 'Das Passwort braucht mindestens 6 Zeichen.';
    if (/fetch|network/i.test(m)) return 'Keine Verbindung zum Sync-Server.';
    return m || 'Anmeldung fehlgeschlagen.';
  }

  function schedule(ms = 1500) {
    if (!st.user) return;
    clearTimeout(st.timer);
    st.timer = setTimeout(syncNow, ms);
  }
  async function syncNow() {
    if (!st.client || !st.user) return;
    if (!navigator.onLine) { set('offline'); return; }
    if (st.running) { st.again = true; return; }
    st.running = true; set('syncing');
    try {
      await bindAccount();
      await pull();
      await push();
      await downloadMissing();
      st.lastSync = Date.now();
      set('ok');
    } catch (e) {
      console.warn('Sync', e);
      set('error', errMsg(e));
    } finally {
      st.running = false;
      if (st.again) { st.again = false; schedule(300); }
    }
  }
  const errMsg = e => {
    const m = (e && (e.message || e.error_description || e.error)) || String(e);
    if (/relation .* does not exist|wb_items/i.test(m)) return 'Die Datenbank ist noch nicht eingerichtet (supabase/schema.sql ausführen).';
    if (/bucket not found/i.test(m)) return 'Der Speicher „werkbank“ fehlt (supabase/schema.sql ausführen).';
    if (/fetch|network/i.test(m)) return 'Keine Verbindung zum Sync-Server.';
    return m;
  };

  /* Anderes Konto als beim letzten Mal: alles Lokale in das neue Konto hochladen */
  async function bindAccount() {
    const last = await S().kvGet('syncUser');
    if (last === st.user.id) return;
    const items = await S().all(true);
    for (const it of items) {
      if (it.deleted) { await S().purge(it.id); continue; }
      it.dirty = true; if (it.kind === 'doc') { it.contentDirty = true; it.upSrc = []; }
      await S().rawPut(it);
    }
    await S().kvSet('lastPull', null);
    await S().kvSet('syncUser', st.user.id);
  }

  const T = () => st.client.from(TABLE);
  const B = () => st.client.storage.from(BUCKET);
  const dir = id => `${st.user.id}/${id}`;
  const check = r => { if (r && r.error) throw r.error; return r ? r.data : null; };

  /* ---------- holen ---------- */
  async function pull() {
    const since = await S().kvGet('lastPull');
    // 10 s Überlappung, falls Zeilen mit älterem Zeitstempel später sichtbar werden
    const from = since ? new Date(new Date(since).getTime() - 10000).toISOString() : '1970-01-01T00:00:00Z';
    let max = since, off = 0;
    for (;;) {
      const rows = check(await T().select('id,kind,data,deleted,updated_at').gt('updated_at', from).order('updated_at', { ascending: true }).range(off, off + 499));
      for (const r of rows) { await apply(r); if (!max || r.updated_at > max) max = r.updated_at; }
      if (rows.length < 500) break;
      off += 500;
    }
    if (max) await S().kvSet('lastPull', max);
  }
  async function apply(row) {
    const local = await S().get(row.id);
    if (row.deleted) { if (local) await S().purge(row.id); return; }
    const remote = { ...(row.data || {}), id: row.id, kind: row.kind };
    if (!local) {
      await S().putSynced({ ...remote, dirty: false, contentDirty: false, baseRev: remote.rev, missing: row.kind === 'doc', upSrc: remote.srcIds || [] });
      return;
    }
    if (local.deleted) return; // lokales Löschen wird gleich hochgeladen
    if (!local.dirty && local.rev === remote.rev && local.updatedAt === remote.updatedAt) return; // eigenes Echo
    const contentChanged = row.kind === 'doc' && remote.rev !== local.baseRev && remote.rev !== local.rev;
    if (local.dirty) {
      if (row.kind === 'doc' && local.contentDirty && contentChanged) {
        // gleichzeitig auf zwei Geräten bearbeitet: eigene Fassung als Kopie behalten
        await S().duplicate(local.id, ' (Konflikt ' + new Date().toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) + ')');
        await S().dropBlobs(local.id);
        await S().putSynced({ ...remote, dirty: false, contentDirty: false, baseRev: remote.rev, missing: true, upSrc: remote.srcIds || [] });
        return;
      }
      if ((remote.updatedAt || 0) > (local.updatedAt || 0)) {
        // fremde Metadaten sind neuer
        await S().putSynced({ ...local, ...remote, dirty: false, contentDirty: false, baseRev: remote.rev, missing: local.missing || contentChanged, upSrc: remote.srcIds || [] });
      } else if (contentChanged) {
        // eigene Metadaten neuer, aber Inhalt kam von woanders: Inhalt holen, Metadaten behalten
        await S().putSynced({ ...local, rev: remote.rev, baseRev: remote.rev, srcIds: remote.srcIds, pages: remote.pages, size: remote.size, missing: true, contentDirty: false, upSrc: remote.srcIds || [] });
      }
      return;
    }
    await S().putSynced({ ...local, ...remote, dirty: false, contentDirty: false, baseRev: remote.rev, missing: local.missing || contentChanged, upSrc: remote.srcIds || [] });
  }

  /* ---------- hochladen ---------- */
  async function push() {
    const items = (await S().all(true)).filter(i => i.dirty);
    // Ordner zuerst, damit Dokumente ihren Ordner schon vorfinden
    items.sort((a, b) => (a.kind === 'folder' ? 0 : 1) - (b.kind === 'folder' ? 0 : 1));
    for (const it of items) {
      if (it.deleted) { await pushDelete(it); continue; }
      if (it.kind === 'doc' && it.contentDirty && !it.missing) await pushContent(it);
      const snap = { ...it };
      check(await T().upsert({ id: it.id, kind: it.kind, data: S().publicFields(it), deleted: false }));
      const now = await S().get(it.id);
      if (!now) continue;
      const untouched = now.updatedAt === snap.updatedAt;
      if (untouched) now.dirty = false;
      if (snap.kind === 'doc' && !snap.missing && snap.contentDirty && now.rev === snap.rev) { now.contentDirty = false; now.baseRev = snap.rev; now.upSrc = snap.srcIds; }
      await S().rawPut(now);
    }
  }
  async function pushContent(it) {
    const d = dir(it.id), done = new Set(it.upSrc || []);
    for (const sid of it.srcIds || []) {
      if (done.has(sid)) continue;
      const s = await S().getBlob(`src:${it.id}:${sid}`);
      if (!s) continue;
      check(await B().upload(`${d}/src/${sid}.pdf`, new Blob([s.bytes], { type: 'application/pdf' }), { upsert: true, contentType: 'application/pdf' }));
    }
    const state = await S().getBlob('state:' + it.id);
    if (state) check(await B().upload(`${d}/state-${it.rev}.json`, new Blob([JSON.stringify(state)], { type: 'application/json' }), { upsert: true, contentType: 'application/json' }));
    const thumb = await S().getBlob('thumb:' + it.id);
    if (thumb) check(await B().upload(`${d}/thumb-${it.rev}.jpg`, thumb, { upsert: true, contentType: thumb.type || 'image/jpeg' }));
    // ältere Fassungen und nicht mehr benutzte Quellen aufräumen
    try {
      const keepSrc = new Set((it.srcIds || []).map(s => s + '.pdf'));
      const top = check(await B().list(d, { limit: 1000 })) || [];
      const old = top.filter(f => /^(state|thumb)-/.test(f.name) && !f.name.includes(it.rev)).map(f => `${d}/${f.name}`);
      const srcs = check(await B().list(d + '/src', { limit: 1000 })) || [];
      srcs.filter(f => !keepSrc.has(f.name)).forEach(f => old.push(`${d}/src/${f.name}`));
      if (old.length) await B().remove(old);
    } catch (e) { /* Aufräumen ist nicht wichtig */ }
  }
  async function pushDelete(it) {
    check(await T().upsert({ id: it.id, kind: it.kind, data: {}, deleted: true }));
    if (it.kind === 'doc') {
      try {
        const d = dir(it.id);
        const top = check(await B().list(d, { limit: 1000 })) || [];
        const srcs = check(await B().list(d + '/src', { limit: 1000 })) || [];
        const paths = top.filter(f => f.id).map(f => `${d}/${f.name}`).concat(srcs.map(f => `${d}/src/${f.name}`));
        if (paths.length) await B().remove(paths);
      } catch (e) { /* egal */ }
    }
    await S().purge(it.id);
  }

  /* ---------- Inhalte herunterladen ---------- */
  async function fetchDoc(id) {
    if (!st.client || !st.user) throw new Error('Nicht angemeldet.');
    const it = await S().get(id);
    if (!it || !it.missing) return;
    const d = dir(id);
    const dl = async path => { const r = await B().download(path); if (r.error) throw r.error; return r.data; };
    let state = null;
    try { state = JSON.parse(await (await dl(`${d}/state-${it.rev}.json`)).text()); } catch (e) { state = null; }
    const ids = state && state.srcIds ? state.srcIds : it.srcIds || [];
    for (const sid of ids) {
      if (await S().getBlob(`src:${id}:${sid}`)) continue;
      const blob = await dl(`${d}/src/${sid}.pdf`);
      await S().putBlob(`src:${id}:${sid}`, { name: it.name + '.pdf', bytes: new Uint8Array(await blob.arrayBuffer()) });
    }
    if (state) await S().putBlob('state:' + id, state); else await S().delBlob('state:' + id);
    try { await S().putBlob('thumb:' + id, await dl(`${d}/thumb-${it.rev}.jpg`)); } catch (e) { /* keine Vorschau */ }
    const now = await S().get(id);
    if (now && now.rev === it.rev) { now.missing = false; now.upSrc = ids; await S().putSynced(now); }
  }
  async function downloadMissing() {
    const docs = (await S().all()).filter(i => i.kind === 'doc' && i.missing);
    // Vorschaubilder zuerst, damit die Bibliothek schnell vollständig aussieht
    docs.sort((a, b) => (b.openedAt || b.updatedAt || 0) - (a.openedAt || a.updatedAt || 0));
    for (const it of docs) {
      try { await fetchDoc(it.id); } catch (e) { console.warn('Download', it.name, e); }
    }
  }

  global.addEventListener('online', () => schedule(200));
  global.addEventListener('focus', () => schedule(800));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(800); });

  global.WBSync = {
    init, config, setConfig, signIn, signUp, signOut, syncNow, schedule, fetchDoc, info,
    ready: () => !!(st.client && st.user),
    onStatus: fn => { listeners.add(fn); fn(info()); return () => listeners.delete(fn); },
  };
})(window);
