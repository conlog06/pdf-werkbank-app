/* PDF Werkbank – Gemeinsam bearbeiten per Link
 * Der Besitzer erstellt einen Link (Bibliothek › Dokument › „Gemeinsam bearbeiten …“). Wer den Link hat,
 * öffnet das Dokument im Browser – ohne Konto – und sieht Änderungen der anderen in Sekunden.
 *
 * Supabase (einmalig das SQL aus der README ausführen):
 *   Tabelle wb_shares      Freigaben mit Stand (jsonb) und Versionszähler rev
 *   RPC wb_share_get/put   Lesen/Schreiben per Link-Token (auch ohne Anmeldung)
 *   RPC wb_share_add_src   Gäste fügen neue Seiten-PDFs hinzu (z. B. Notizpapier, Fotos)
 *   Bucket werkbank-share  Original-PDFs des Besitzers (öffentlich lesbar unter dem geheimen Token)
 *   Realtime-Kanal         „wbshare:<token>“ meldet neue Versionen und wer gerade da ist
 *
 * Zusammenführen: Jede Seite und jedes Element hat eine eindeutige ID. Wer etwas ändert, gewinnt für genau
 * dieses Element; gleichzeitige Änderungen an verschiedenen Elementen bleiben beide erhalten.
 */
(function (global) {
  'use strict';
  const SITE = 'https://conlog06.github.io/pdf-werkbank/';
  const BUCKET = 'werkbank-share';
  const J = x => JSON.stringify(x === undefined ? null : x);
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* egal */ } };
  const token = () => { const a = new Uint8Array(18); crypto.getRandomValues(a); return Array.from(a, b => 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 57]).join(''); };
  const linkOf = t => (/^https?:/.test(location.protocol) && !/localhost|127\.0\.0\.1/.test(location.host) ? location.origin + location.pathname.replace(/[^/]*$/, '') : SITE) + 'index.html?share=' + t;
  const COLORS = ['#e5484d', '#3e63dd', '#30a46c', '#f76b15', '#8e4ec6', '#12a594', '#d6409f', '#ad7f58'];
  const me = (() => {
    let id = lsGet('pdfwb.share.me'); if (!id) { id = token().slice(0, 8); lsSet('pdfwb.share.me', id); }
    return { id, name: lsGet('pdfwb.share.name') || '', color: COLORS[parseInt(id, 36) % COLORS.length] };
  })();

  async function client() {
    if (!global.WBSync) throw new Error('Gemeinsames Bearbeiten braucht die Sync-Funktion.');
    const c = await global.WBSync.client();
    if (!c) throw new Error('Gemeinsames Bearbeiten ist noch nicht eingerichtet (Supabase fehlt).');
    return c;
  }
  const setupHint = e => (/wb_share|does not exist|schema cache|relation/i.test(String(e && (e.message || e))) ? 'Die Freigabe-Tabelle fehlt noch in Supabase. Bitte einmal das SQL „Gemeinsam bearbeiten“ aus der README im SQL-Editor ausführen.' : String((e && e.message) || e));

  /* ---------- Dreiwege-Zusammenführung: B = gemeinsamer Stand, L = lokal, R = Server ---------- */
  function merge(B, L, R) {
    if (!B) return R;
    const bP = new Map((B.pages || []).map(p => [p.id, p])), lP = new Map((L.pages || []).map(p => [p.id, p])), rP = new Map((R.pages || []).map(p => [p.id, p]));
    const ids = a => a.map(p => p.id);
    let order;
    if (J(ids(B.pages)) !== J(ids(L.pages)) && J(ids(B.pages)) === J(ids(R.pages))) order = ids(L.pages); // nur lokal umsortiert/geändert
    else {
      order = ids(R.pages).filter(id => !(bP.has(id) && !lP.has(id))); // lokal gelöschte Seiten raus
      L.pages.forEach((p, i) => {
        if (bP.has(p.id) || rP.has(p.id) || order.includes(p.id)) return; // lokal neue Seite einfügen
        const prev = L.pages.slice(0, i).reverse().find(q => order.includes(q.id));
        order.splice(prev ? order.indexOf(prev.id) + 1 : 0, 0, p.id);
      });
    }
    const pages = order.map(id => {
      const b = bP.get(id), l = lP.get(id), r = rP.get(id);
      if (!r) return l; if (!l) return r; if (!b) return r;
      const out = {};
      for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) if (k !== 'annots') out[k] = J(l[k]) !== J(b[k]) ? l[k] : r[k];
      const bA = new Map(b.annots.map(a => [a.id, a])), lA = new Map(l.annots.map(a => [a.id, a]));
      const ann = [], seen = new Set();
      for (const a of r.annots) {
        seen.add(a.id);
        const ba = bA.get(a.id), la = lA.get(a.id);
        if (ba && !la) continue;                                // lokal gelöscht
        ann.push(la && ba && J(la) !== J(ba) ? la : a);         // lokal geändert gewinnt
      }
      for (const a of l.annots) if (!seen.has(a.id) && !bA.has(a.id)) ann.push(a); // lokal neu
      out.annots = ann;
      return out;
    }).filter(Boolean);
    const pick = k => (J(L[k]) !== J(B[k]) ? L[k] : R[k]);
    const fv = { ...(R.formVals || {}) };
    for (const k of new Set([...Object.keys(L.formVals || {}), ...Object.keys(B.formVals || {})])) if (J((L.formVals || {})[k]) !== J((B.formVals || {})[k])) { if ((L.formVals || {})[k] === undefined) delete fv[k]; else fv[k] = L.formVals[k]; }
    const used = new Set(); for (const p of pages) for (const a of p.annots) if (a.img) used.add(a.img);
    const imgs = new Map([...(R.images || []), ...(L.images || [])].filter(([id]) => used.has(id)));
    const srcIds = [...new Set([...(R.srcIds || []), ...(L.srcIds || [])])];
    const paper = new Map([...(R.paperSrc || []), ...(L.paperSrc || [])]);
    return { ...R, pages, images: [...imgs], srcIds, paperSrc: [...paper], formVals: fv, bookmarks: pick('bookmarks'), meta: pick('meta'), docName: pick('docName'), uidN: Math.max(L.uidN || 0, R.uidN || 0), dirty: false };
  }

  /* ---------- Quellen (Original-PDFs) ---------- */
  const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function fetchSource(c, tok, sid) {
    const { data } = c.storage.from(BUCKET).getPublicUrl(`${tok}/${sid}.pdf`);
    try { const r = await fetch(data.publicUrl, { cache: 'force-cache' }); if (r.ok) return { name: sid + '.pdf', bytes: new Uint8Array(await r.arrayBuffer()) }; } catch (e) { /* weiter mit der Datenbank */ }
    const { data: d, error } = await c.rpc('wb_share_src', { p_token: tok, p_sid: sid });
    if (error) throw new Error(setupHint(error));
    if (!d) throw new Error('Eine Datei des geteilten Dokuments fehlt.');
    return { name: d.name || sid + '.pdf', bytes: unb64(d.data) };
  }
  async function uploadSource(c, tok, src, owner) {
    if (owner) {
      const { error } = await c.storage.from(BUCKET).upload(`${tok}/${src.id}.pdf`, new Blob([src.bytes], { type: 'application/pdf' }), { upsert: true, contentType: 'application/pdf', cacheControl: '31536000' });
      if (!error) return;
      console.warn('Speicher-Upload, weiter per Datenbank', error);
    }
    if (src.bytes.byteLength > 12e6) throw new Error('Neue Seiten über 12 MB können Gäste nicht teilen.');
    const { error } = await c.rpc('wb_share_add_src', { p_token: tok, p_sid: src.id, p_name: src.name || '', p_data: b64(src.bytes) });
    if (error) throw new Error(setupHint(error));
  }

  /* ---------- Sitzung im Editor ----------
     hooks: getState() → Stand, getSource(id) → { id, name, bytes }, apply(state, structural) → Promise, onStatus(info), onPeers(list) */
  async function connect(tok, hooks) {
    const c = await client();
    const { data: row, error } = await c.rpc('wb_share_get', { p_token: tok });
    if (error) throw new Error(setupHint(error));
    if (!row) throw new Error('Dieser Link ist ungültig oder wurde vom Besitzer beendet.');
    const user = global.WBSync.user && global.WBSync.user();
    const S = { tok, rev: row.rev, base: row.state, mode: row.mode, name: row.name, owner: !!(user && row.owner === user.id), uploaded: new Set(row.src_ids || []), saving: false, again: false, chan: null, peers: [], closed: false, started: false };
    // Stand übernehmen: zuerst warten, bis lokal nicht mehr gezeichnet/getippt wird, dann gegen den
    // neuesten lokalen Stand zusammenführen – so geht nichts verloren, was inzwischen dazugekommen ist
    async function applySafe(next, L) {
      for (let i = 0; i < 300 && hooks.busy && hooks.busy(); i++) await new Promise(r => setTimeout(r, 100));
      const C = hooks.getState();
      const same = J(C.pages) === J(L.pages) && J(C.formVals) === J(L.formVals) && J(C.bookmarks) === J(L.bookmarks);
      const fin = same ? next : merge(L, C, next);
      await hooks.apply(fin, J((C.pages || []).map(p => p.id)) !== J(fin.pages.map(p => p.id)) || J(C.srcIds) !== J(fin.srcIds));
      return !same;
    }
    const status = (st, extra) => hooks.onStatus && hooks.onStatus({ status: st, rev: S.rev, mode: S.mode, ...extra });
    // Schreiben und Lesen strikt nacheinander: sonst rechnet ein Speichervorgang mit einem Stand,
    // den ein gleichzeitiges Laden schon ersetzt hat, und Striche der anderen gingen verloren
    let chain = Promise.resolve(), pushQueued = false;
    const serial = fn => (chain = chain.then(fn, fn));
    function push() {
      if (pushQueued) return chain;
      pushQueued = true;
      return serial(() => { pushQueued = false; return doPush(); });
    }
    async function doPush() {
      if (!S.started || S.closed || S.mode !== 'edit' && !S.owner) return;
      S.saving = true; status('saving');
      try {
        let L = hooks.getState();
        for (let tries = 0; tries < 6; tries++) {
          for (const sid of L.srcIds || []) if (!S.uploaded.has(sid)) { const src = hooks.getSource(sid); if (src) { await uploadSource(c, tok, src, S.owner); S.uploaded.add(sid); } }
          const { data, error: e } = await c.rpc('wb_share_put', { p_token: tok, p_base: S.rev, p_state: L, p_src_ids: [...S.uploaded] });
          if (e) throw new Error(setupHint(e));
          if (data.ok) {
            S.rev = data.rev; S.base = L;
            if (S.chan) S.chan.send({ type: 'broadcast', event: 'rev', payload: { rev: S.rev, by: me.id } });
            status('saved'); break;
          }
          // jemand war schneller: zusammenführen und erneut versuchen
          const merged = merge(S.base, L, data.state);
          S.base = data.state; S.rev = data.rev;
          for (const sid of merged.srcIds || []) if (!hooks.hasSource(sid)) await hooks.addSource(sid, await fetchSource(c, tok, sid));
          await applySafe(merged, L);
          L = hooks.getState();
        }
      } catch (e) { console.warn('Freigabe speichern', e); status('error', { error: e.message }); }
      finally { S.saving = false; }
    }
    let pullT = 0;
    const pull = () => serial(doPull);
    async function doPull() {
      if (!S.started || S.closed) return;
      const { data: r, error: e } = await c.rpc('wb_share_get', { p_token: tok });
      if (e || !r) { if (!r && !e) status('ended'); return; }
      if (r.rev <= S.rev) return;
      S.mode = r.mode;
      const L = hooks.getState(), dirty = J(L.pages) !== J(S.base.pages) || J(L.formVals) !== J(S.base.formVals) || J(L.bookmarks) !== J(S.base.bookmarks);
      const next = dirty ? merge(S.base, L, r.state) : r.state;
      for (const sid of next.srcIds || []) if (!hooks.hasSource(sid)) await hooks.addSource(sid, await fetchSource(c, tok, sid));
      S.base = r.state; S.rev = r.rev;
      const later = await applySafe(next, L);
      status('synced');
      if (dirty || later) push();
    }
    // Echtzeit: neue Versionen und wer gerade da ist
    try {
      S.chan = c.channel('wbshare:' + tok, { config: { broadcast: { self: false }, presence: { key: me.id + ':' + Math.random().toString(36).slice(2, 6) } } });
      S.chan.on('broadcast', { event: 'rev' }, ({ payload }) => { if (payload && payload.rev > S.rev) { clearTimeout(pullT); pullT = setTimeout(pull, 150); } });
      S.chan.on('presence', { event: 'sync' }, () => {
        const st = S.chan.presenceState(), seen = new Map();
        for (const k of Object.keys(st)) for (const p of st[k]) if (p.id !== me.id) seen.set(p.id, p);
        S.peers = [...seen.values()]; if (hooks.onPeers) hooks.onPeers(S.peers);
      });
      S.chan.subscribe(stt => { if (stt === 'SUBSCRIBED') S.chan.track({ id: me.id, name: me.name || 'Gast', color: me.color, page: 0 }); });
    } catch (e) { console.warn('Echtzeit', e); }
    const poll = setInterval(pull, 20000); // falls Echtzeit blockiert ist
    const onVis = () => { if (document.visibilityState === 'visible') pull(); };
    document.addEventListener('visibilitychange', onVis);
    return {
      row, info: () => ({ rev: S.rev, mode: S.mode, owner: S.owner, name: S.name, peers: S.peers }),
      canEdit: () => S.mode === 'edit' || S.owner,
      start(rev, base) { if (rev != null) { S.rev = rev; S.base = base ? JSON.parse(J(base)) : { pages: [] }; } if (!S.base) S.base = { pages: [] }; S.started = true; },
      rebase(rev, base) { S.rev = rev; S.base = base; },
      sourceOf: sid => fetchSource(c, tok, sid),
      changed: (() => { let t = 0; return () => { clearTimeout(t); t = setTimeout(push, 700); }; })(),
      flush: push, pull,
      setPage: n => { try { if (S.chan) S.chan.track({ id: me.id, name: me.name || 'Gast', color: me.color, page: n }); } catch (e) { /* egal */ } },
      close() { S.closed = true; clearInterval(poll); document.removeEventListener('visibilitychange', onVis); try { if (S.chan) c.removeChannel(S.chan); } catch (e) { /* egal */ } },
    };
  }

  /* ---------- Besitzer: Link erstellen, Rechte ändern, beenden (Bibliothek) ---------- */
  async function findShare(c, docId) {
    const { data, error } = await c.from('wb_shares').select('token, mode, rev, revoked, created_at').eq('doc_id', docId).eq('revoked', false).order('created_at', { ascending: false }).limit(1);
    if (error) throw new Error(setupHint(error));
    return data && data[0] || null;
  }
  async function createShare(item, mode) {
    const c = await client();
    if (!global.WBSync.ready()) throw new Error('Zum Teilen bitte unten links unter „Sync“ anmelden.');
    const { state, sources } = await global.WBStore.loadDoc(item.id);
    const tok = token();
    const st = state || { v: 1, pages: null };
    const { error } = await c.from('wb_shares').insert({ token: tok, doc_id: item.id, name: item.name, mode, state: st, rev: 1, src_ids: [] });
    if (error) throw new Error(setupHint(error));
    for (const s of sources) await uploadSource(c, tok, s, true);
    const { error: e2 } = await c.from('wb_shares').update({ src_ids: sources.map(s => s.id) }).eq('token', tok);
    if (e2) throw new Error(setupHint(e2));
    return { token: tok, mode, rev: 1 };
  }
  function qrSVG(text, size = 168) {
    if (!global.qrcode) return '';
    const q = global.qrcode(0, 'M'); q.addData(text); q.make();
    const n = q.getModuleCount(), m = 2, k = size / (n + 2 * m);
    let d = '';
    for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (q.isDark(r, col)) d += `M${((col + m) * k).toFixed(2)} ${((r + m) * k).toFixed(2)}h${k.toFixed(2)}v${k.toFixed(2)}h-${k.toFixed(2)}z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#111"/></svg>`;
  }
  const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  /* eigenes, schlichtes Fenster (gleich in Bibliothek und Editor) */
  function modal(html, onOpen) {
    return new Promise(res => {
      const bg = document.createElement('div'); bg.className = 'wbshm';
      bg.innerHTML = `<div class="box" role="dialog" aria-modal="true">${html}</div>`;
      document.body.appendChild(bg);
      const close = v => { bg.remove(); document.removeEventListener('keydown', kd, true); res(v); };
      const kd = e => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
      document.addEventListener('keydown', kd, true);
      bg.addEventListener('pointerdown', e => { if (e.target === bg) close(null); });
      onOpen(bg.firstChild, close);
    });
  }
  function css() {
    if (document.getElementById('wbshCss')) return;
    const st = document.createElement('style'); st.id = 'wbshCss';
    st.textContent = `.wbshm{position:fixed;inset:0;z-index:210;background:rgb(10 13 20 / .4);display:grid;place-items:center;padding:16px}
.wbshm .box{width:min(620px,100%);max-height:calc(100vh - 32px);overflow:auto;background:var(--raise,#fff);color:var(--ink,#1b2130);border:1px solid var(--line,#d1d6df);border-radius:16px;box-shadow:0 24px 70px rgb(0 0 0 / .35);padding:20px 22px}
.wbshm h2{margin:0 0 10px;font-size:19px}.wbshm .lead,.wbshm .note{color:var(--muted,#5a6374);font-size:13.5px;line-height:1.5}
.wbshm .fld{display:flex;flex-direction:column;gap:5px;margin:10px 0;font-size:12.5px;color:var(--muted,#5a6374)}
.wbshm .fld>span{font:600 11px var(--f-mono,monospace);letter-spacing:.05em;text-transform:uppercase}
.wbshm .acts{display:flex;gap:8px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap}
.wbshm .share-box{display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap}.wbshm .qr{flex:none;border:1px solid var(--line,#d1d6df);border-radius:12px;overflow:hidden;line-height:0}
.wbshm .share-r{flex:1;min-width:240px}.wbshm .row{display:flex;align-items:center}
.wbshm .btn{display:inline-flex;align-items:center;gap:6px}.wbshm .btn svg{width:16px;height:16px}`;
    document.head.appendChild(st);
  }
  const IC = { copy: 'M9 9h10v10H9zM5 15V5h10', users: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 19v-1a4 4 0 0 0-3-3.9M15.5 3.2a3.5 3.5 0 0 1 0 6.6', link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1' };
  const ico = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${IC[k] || ''}"/></svg>`;
  async function ownerDialog(item, H = {}) {
    const toast = H.toast || (m => alert(m)), busy = H.busy || (() => {});
    css();
    const dialog = (html, o) => modal(html, o.onOpen);
    if (global.WBSync && !global.WBSync.ready()) { try { await global.WBSync.client(); } catch (e) { /* unten */ } } // Anmeldung wird evtl. gerade wiederhergestellt
    if (!global.WBSync || !global.WBSync.ready()) { toast('Zum gemeinsamen Bearbeiten bitte unten links unter „Sync“ anmelden.'); return; }
    let sh = null;
    busy('Freigabe wird geprüft …');
    try { sh = await findShare(await client(), item.id); } catch (e) { busy(false); toast(e.message); return; }
    busy(false);
    const body = () => sh ? `<div class="share-box"><div class="qr">${qrSVG(linkOf(sh.token))}</div><div class="share-r">
        <label class="fld"><span>Link</span><div class="row" style="gap:6px"><input class="field" readonly value="${esc(linkOf(sh.token))}" id="shLink" style="flex:1;min-width:0"><button class="btn primary" data-s="copy">${ico('copy')}Kopieren</button></div></label>
        <label class="fld"><span>Wer den Link hat, darf</span><select class="field" id="shMode"><option value="edit"${sh.mode === 'edit' ? ' selected' : ''}>bearbeiten (Stifte, Markierungen, Texte …)</option><option value="view"${sh.mode === 'view' ? ' selected' : ''}>nur ansehen (sieht deine Änderungen live)</option></select></label>
        <p class="note">Kein Konto nötig. Änderungen erscheinen bei allen in Sekunden, auch in deiner Bibliothek.</p></div></div>
        <div class="acts" style="justify-content:space-between"><button class="btn danger" data-s="stop">Freigabe beenden</button><span>${navigator.share ? `<button class="btn" data-s="native">${ico('link')}Senden …</button> ` : ''}<button class="btn" data-s="0">Fertig</button></span></div>`
      : `<p class="lead">Erstellt einen Link zu „${esc(item.name)}“. Wer ihn öffnet, arbeitet live im selben Dokument mit – im Browser, ohne Konto.</p>
        <label class="fld"><span>Wer den Link hat, darf</span><select class="field" id="shMode"><option value="edit">bearbeiten</option><option value="view">nur ansehen</option></select></label>
        <div class="acts"><button class="btn" data-s="0">Abbrechen</button><button class="btn primary" data-s="create">${ico('users')}Link erstellen</button></div>`;
    await dialog(`<h2>Gemeinsam bearbeiten</h2><div id="shBody">${body()}</div>`, {
      wide: true,
      onOpen: (d, close) => {
        const re = () => { d.querySelector('#shBody').innerHTML = body(); };
        d.addEventListener('change', async e => {
          if (e.target.id !== 'shMode' || !sh) return;
          const c = await client(); const { error } = await c.from('wb_shares').update({ mode: e.target.value }).eq('token', sh.token);
          if (error) toast(setupHint(error)); else { sh.mode = e.target.value; toast(sh.mode === 'edit' ? 'Alle mit dem Link dürfen bearbeiten' : 'Mit dem Link nur noch ansehen'); }
        });
        d.addEventListener('click', async e => {
          const b = e.target.closest('[data-s]'); if (!b) return;
          const k = b.dataset.s;
          if (k === '0') close();
          else if (k === 'copy') { const v = linkOf(sh.token); try { await navigator.clipboard.writeText(v); toast('Link kopiert'); } catch (er) { d.querySelector('#shLink').select(); } }
          else if (k === 'native') navigator.share({ title: item.name, text: `„${item.name}“ gemeinsam bearbeiten`, url: linkOf(sh.token) }).catch(() => {});
          else if (k === 'create') {
            b.disabled = true; b.textContent = 'Wird hochgeladen …';
            try { sh = await createShare(item, d.querySelector('#shMode').value); re(); toast('Link erstellt'); }
            catch (er) { b.disabled = false; b.innerHTML = ico('users') + 'Link erstellen'; toast(er.message); }
          } else if (k === 'stop') {
            const c = await client();
            const { error } = await c.from('wb_shares').update({ revoked: true }).eq('token', sh.token);
            if (error) { toast(setupHint(error)); return; }
            try { const { data: files } = await c.storage.from(BUCKET).list(sh.token); if (files && files.length) await c.storage.from(BUCKET).remove(files.map(f => sh.token + '/' + f.name)); } catch (er) { /* egal */ }
            sh = null; re(); toast('Freigabe beendet · der Link funktioniert nicht mehr');
          }
        });
      },
    });
  }
  /* Editor (Bibliothek): gibt es für dieses Dokument eine aktive Freigabe? */
  async function tokenForDoc(docId) {
    try { if (!global.WBSync || !global.WBSync.ready()) return null; const sh = await findShare(await client(), docId); return sh ? sh.token : null; } catch (e) { return null; }
  }
  function setName(n) { me.name = String(n || '').trim().slice(0, 40); lsSet('pdfwb.share.name', me.name); }
  global.WBShare = { connect, merge, ownerDialog, tokenForDoc, linkOf, qrSVG, me, setName };
})(window);
