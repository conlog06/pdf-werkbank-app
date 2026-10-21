/* „Mit ChatGPT anmelden“ für die Desktop-App (OpenAI: Sign in with ChatGPT für Open-Source- und lokale Apps)
 * Ablauf laut https://developers.openai.com/siwc/token-sharing-open-source/sign-in :
 *   1. Rückruf-Server auf 127.0.0.1 starten, System-Browser öffnen (PKCE, state, nonce)
 *   2. Erstanmeldung mit client_id=dynamic_agent_client → Rückruf liefert code und die eigene client_id (oaiapp_…)
 *   3. code gegen Tokens tauschen, Bereich chatgpt.tokens.use.direct prüfen, ID-Token prüfen
 *   4. Zugang (1 Stunde) per Refresh-Token erneuern, Refresh-Token rotiert
 * Ohne Electron-Abhängigkeiten, damit es sich auch in Node testen lässt.
 */
'use strict';
const http = require('node:http');
const crypto = require('node:crypto');

const DEF = {
  authorize: 'https://auth.openai.com/api/accounts/authorize',
  token: 'https://auth.openai.com/api/accounts/oauth/token',
  issuer: 'https://auth.openai.com',
  resource: 'https://api.openai.com/v1',
  scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
  port: 1455, path: '/auth/callback', appName: 'PDF Werkbank',
};
const b64url = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwtPart = (t, i) => { try { return JSON.parse(Buffer.from(String(t).split('.')[i], 'base64url').toString('utf8')); } catch (e) { return null; } };

/* store: { read(): obj|null, write(obj), clear() }  host: { id }  openExternal(url) */
function createChatGPTAuth({ store, hostId, openExternal, focus, endpoints = {}, fetchImpl = fetch }) {
  const E = { ...DEF, ...endpoints };
  let access = null; // { token, exp }

  async function tokenReq(params) {
    const r = await fetchImpl(E.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams(params).toString() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error_description || (j.error && j.error.message) || j.error || 'ChatGPT-Anmeldung fehlgeschlagen'); e.code = typeof j.error === 'string' ? j.error : (j.error && j.error.code); throw e; }
    return j;
  }
  /* ID-Token: Aussteller, Empfänger, Ablauf, nonce; Signatur gegen die veröffentlichten Schlüssel (falls erreichbar) */
  async function checkIdToken(idt, clientId, nonce) {
    const h = jwtPart(idt, 0), c = jwtPart(idt, 1);
    if (!c) throw new Error('Ungültige Antwort der ChatGPT-Anmeldung.');
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
    if (c.iss && E.issuer && c.iss !== E.issuer) throw new Error('ChatGPT-Anmeldung: unerwarteter Aussteller.');
    if (clientId && !aud.includes(clientId)) throw new Error('ChatGPT-Anmeldung: Token gehört zu einer anderen App.');
    if (nonce && c.nonce && c.nonce !== nonce) throw new Error('ChatGPT-Anmeldung: Sicherheitsprüfung fehlgeschlagen.');
    if (c.exp && c.exp * 1000 < Date.now() - 300000) throw new Error('ChatGPT-Anmeldung: Token abgelaufen.');
    if (E.skipSignature) return c;
    try {
      const conf = await (await fetchImpl(E.issuer + '/.well-known/openid-configuration')).json();
      const jwks = await (await fetchImpl(conf.jwks_uri)).json();
      const jwk = (jwks.keys || []).find(k => !h.kid || k.kid === h.kid);
      if (jwk) {
        const [a, b, s] = String(idt).split('.');
        const ok = crypto.verify('RSA-SHA256', Buffer.from(a + '.' + b), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(s, 'base64url'));
        if (!ok) throw new Error('ChatGPT-Anmeldung: Signatur ungültig.');
      }
    } catch (e) {
      if (/Signatur ungültig/.test(e.message)) throw e;
      console.warn('ID-Token-Signatur nicht prüfbar (kommt direkt per TLS von OpenAI):', e.message);
    }
    return c;
  }
  function scopesOf(tk) {
    if (tk.scope) return String(tk.scope).split(/\s+/);
    const c = jwtPart(tk.access_token, 1);
    return c && c.scope ? String(c.scope).split(/\s+/) : [];
  }
  function saveTokens(prev, tk, extra = {}) {
    const rec = { ...prev, ...extra, refresh: tk.refresh_token || (prev && prev.refresh), scope: scopesOf(tk).join(' ') || (prev && prev.scope) };
    store.write(rec);
    access = { token: tk.access_token, exp: Date.now() + ((tk.expires_in || 3600) - 120) * 1000 };
    return rec;
  }

  /* Rückruf-Server: bevorzugt Port 1455, sonst ein freier */
  function listen(handler) {
    return new Promise((res, rej) => {
      const srv = http.createServer(handler);
      srv.once('error', e => {
        if (e.code === 'EADDRINUSE') { const s2 = http.createServer(handler); s2.once('error', rej); s2.listen(0, '127.0.0.1', () => res(s2)); }
        else rej(e);
      });
      srv.listen(E.port, '127.0.0.1', () => res(srv));
    });
  }
  const page = (ok, msg) => `<!doctype html><meta charset="utf-8"><title>PDF Werkbank</title><body style="font:16px system-ui;display:grid;place-items:center;height:90vh;color:#1b2130"><div style="text-align:center;max-width:460px"><h2>${ok ? 'ChatGPT ist verbunden' : 'Anmeldung nicht abgeschlossen'}</h2><p>${msg || 'Du kannst dieses Fenster schließen und zur PDF Werkbank zurückkehren.'}</p></div>`;

  async function connect() {
    const saved = store.read() || {};
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16)), nonce = b64url(crypto.randomBytes(16));
    let redirect = '', srv = null, to = null;
    const cb = await new Promise((res, rej) => {
      listen((req, resp) => {
        const u = new URL(req.url, 'http://127.0.0.1');
        if (u.pathname !== E.path) { resp.writeHead(404, { Connection: 'close' }); resp.end(); return; }
        const q = Object.fromEntries(u.searchParams);
        const ok = !!q.code && q.state === state;
        const err = q.error === 'access_denied' ? 'Zugriff wurde nicht erlaubt.' : q.error ? (q.error_description || q.error) : !ok ? 'Anmeldung abgebrochen.' : '';
        resp.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' }); resp.end(page(ok, err));
        clearTimeout(to); srv.close(); if (srv.closeIdleConnections) setTimeout(() => srv.closeAllConnections(), 200);
        if (ok) res(q); else rej(new Error(err));
      }).then(s => {
        srv = s;
        to = setTimeout(() => { srv.close(); rej(new Error('Zeitüberschreitung bei der Anmeldung.')); }, 5 * 60000);
        redirect = `http://127.0.0.1:${srv.address().port}${E.path}`;
        const p = {
          client_id: saved.clientId || 'dynamic_agent_client', ext_agent_host_id: hostId, response_type: 'code', redirect_uri: redirect,
          scope: E.scope, resource: E.resource, state, nonce, code_challenge: challenge, code_challenge_method: 'S256',
        };
        if (!saved.clientId) p.agent_name_hint = E.appName;
        else if (saved.email) p.login_hint = saved.email;
        openExternal(E.authorize + '?' + new URLSearchParams(p).toString());
      }, rej);
    });
    const clientId = saved.clientId || cb.client_id;
    if (!clientId || clientId === 'dynamic_agent_client') throw new Error('Registrierung bei ChatGPT unvollständig. Bitte erneut versuchen.');
    let tk;
    try { tk = await tokenReq({ grant_type: 'authorization_code', client_id: clientId, code: cb.code, code_verifier: verifier, redirect_uri: redirect, resource: E.resource }); }
    catch (e) { if (e.code === 'invalid_grant' && saved.clientId) { store.write({ ...saved, clientId: null }); } throw e; }
    if (!scopesOf(tk).includes('chatgpt.tokens.use.direct')) throw new Error('ChatGPT hat die Nutzung deines Abos nicht freigegeben (nur mit Plus oder Pro möglich).');
    const claims = tk.id_token ? await checkIdToken(tk.id_token, clientId, nonce) : {};
    saveTokens(saved, tk, { clientId, email: claims.email || saved.email || '', sub: claims.sub || saved.sub || '' });
    if (focus) focus();
    return { email: claims.email || '' };
  }
  async function token() {
    if (access && access.exp > Date.now()) return { token: access.token };
    const rec = store.read();
    if (!rec || !rec.refresh || !rec.clientId) return { token: null };
    try {
      const tk = await tokenReq({ grant_type: 'refresh_token', client_id: rec.clientId, refresh_token: rec.refresh, resource: E.resource });
      saveTokens(rec, tk);
      return { token: access.token };
    } catch (e) {
      if (e.code === 'invalid_grant') { store.write({ clientId: rec.clientId, email: rec.email }); access = null; return { token: null }; }
      throw e;
    }
  }
  function disconnect() {
    const rec = store.read() || {};
    access = null;
    store.write({ clientId: rec.clientId || null }); // App-Registrierung behalten, Zugang verwerfen
    return {};
  }
  function status() { const r = store.read(); return { connected: !!(r && r.refresh), email: (r && r.email) || '' }; }
  return { connect, token, disconnect, status };
}
module.exports = { createChatGPTAuth, DEF };
