/* PDF Werkbank – KI-Anbindung (ChatGPT, OpenAI, Claude)
 *   chatgpt   – „Mit ChatGPT anmelden“ (nur Desktop-App): läuft über das Plus-/Pro-Abo, Anmeldung im System-Browser
 *   openai    – eigener OpenAI-API-Schlüssel (Bezahlung pro Nutzung)
 *   anthropic – eigener Claude-API-Schlüssel (Bezahlung pro Nutzung; ein Claude-Abo darf Anthropic zufolge nicht in fremden Apps genutzt werden)
 * Schlüssel bleiben auf dem Gerät (Webseite: Browser-Speicher, Desktop: verschlüsselt im System-Schlüsselbund).
 * Antworten kommen gestreamt (onDelta), Bilder (z. B. Handschrift) gehen als data:-URL mit.
 */
(function (global) {
  'use strict';
  const DESK = global.wbDesktop || null;
  const C = () => global.WB_CONFIG || {};
  const OAI = () => C().aiOpenAIBase || 'https://api.openai.com/v1';
  const ANT = () => C().aiAnthropicBase || 'https://api.anthropic.com/v1';
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { if (v == null || v === '') localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* egal */ } };

  const NAMES = { chatgpt: 'ChatGPT', openai: 'OpenAI', anthropic: 'Claude' };
  const CLAUDE_MODELS = [['claude-sonnet-5-5', 'Claude Sonnet 5.5 (empfohlen)'], ['claude-haiku-5-5', 'Claude Haiku 5.5 (schnell, günstig)'], ['claude-opus-5-5', 'Claude Opus 5.5 (am stärksten)']];
  const S = Object.assign({ provider: '', models: {}, email: '' }, (() => { try { return JSON.parse(lsGet('pdfwb.ai') || '{}'); } catch (e) { return {}; } })());
  const save = () => lsSet('pdfwb.ai', JSON.stringify(S));
  const listeners = new Set();
  const emit = () => listeners.forEach(f => { try { f(info()); } catch (e) { console.error(e); } });
  const canChatGPT = () => !!(DESK && DESK.chatgptConnect) || !!C().aiFakeChatGPT;
  function info() {
    return { provider: S.provider, name: NAMES[S.provider] || '', model: S.models[S.provider] || ((modelCache.get(S.provider) || [])[0] || [])[0] || '', email: S.email, ready: !!S.provider, canChatGPT: canChatGPT(), names: NAMES };
  }

  /* ---------- Schlüssel ---------- */
  async function getKey(p) {
    if (DESK && DESK.aiSecret) { try { const r = await DESK.aiSecret({ name: p }); return (r && r.value) || ''; } catch (e) { return ''; } }
    return lsGet('pdfwb.ai.key.' + p) || '';
  }
  async function setKey(p, v) {
    v = (v || '').trim();
    if (DESK && DESK.aiSecret) await DESK.aiSecret({ name: p, value: v, set: true });
    else lsSet('pdfwb.ai.key.' + p, v || null);
  }
  /* Bearer bzw. Schlüssel für den gewählten Anbieter */
  async function credential(p = S.provider) {
    if (p === 'chatgpt') {
      if (C().aiFakeChatGPT) return 'fake-chatgpt';
      const r = DESK && DESK.chatgptToken ? await DESK.chatgptToken() : null;
      if (!r || !r.token) { const e = new Error('ChatGPT-Anmeldung abgelaufen. Bitte in den KI-Einstellungen neu anmelden.'); e.auth = true; throw e; }
      return r.token;
    }
    const k = await getKey(p);
    if (!k) { const e = new Error(`Für ${NAMES[p]} ist noch kein API-Schlüssel eingetragen.`); e.auth = true; throw e; }
    return k;
  }

  /* ---------- Einrichten ---------- */
  async function connectChatGPT() {
    let r = { email: 'test@example.com' };
    if (!C().aiFakeChatGPT) r = await DESK.chatgptConnect();
    S.provider = 'chatgpt'; S.email = (r && r.email) || ''; save(); emit();
    return info();
  }
  /* Schlüssel prüfen (eine Mini-Anfrage) und speichern */
  async function useKey(p, key) {
    key = (key || '').trim();
    if (p === 'openai' && !/^sk-/.test(key)) throw new Error('Ein OpenAI-Schlüssel beginnt mit „sk-“.');
    if (p === 'anthropic' && !/^sk-ant-/.test(key)) throw new Error('Ein Claude-Schlüssel beginnt mit „sk-ant-“.');
    await setKey(p, key);
    try { await models(p, true); } catch (e) { await setKey(p, ''); throw e; }
    S.provider = p; S.email = ''; save(); emit();
    return info();
  }
  async function disconnect(p = S.provider) {
    if (p === 'chatgpt') { if (DESK && DESK.chatgptDisconnect) await DESK.chatgptDisconnect(); }
    else await setKey(p, '');
    if (S.provider === p) { S.provider = ''; S.email = ''; }
    save(); emit();
  }
  function setModel(m) { S.models[S.provider] = m; save(); emit(); }

  /* ---------- Modelle ---------- */
  const modelCache = new Map();
  async function models(p = S.provider, check) {
    if (p === 'anthropic') {
      if (check) {
        const r = await fetch(ANT() + '/models?limit=50', { headers: antHeaders(await credential(p)) });
        if (!r.ok) throw await httpError(r, p);
        try {
          const j = await r.json(), ids = new Set((j.data || []).map(m => m.id));
          const known = CLAUDE_MODELS.filter(([id]) => ids.has(id));
          const extra = (j.data || []).filter(m => !CLAUDE_MODELS.some(([id]) => id === m.id)).map(m => [m.id, m.display_name || m.id]);
          if (known.length || extra.length) modelCache.set(p, known.concat(extra));
        } catch (e) { /* Liste ist optional */ }
      }
      return modelCache.get(p) || CLAUDE_MODELS;
    }
    if (modelCache.has(p) && !check) return modelCache.get(p);
    const r = await fetch(OAI() + '/models', { headers: { Authorization: 'Bearer ' + await credential(p) } });
    if (!r.ok) throw await httpError(r, p);
    const j = await r.json();
    let list = (j.data || []);
    if (p === 'chatgpt') list = list.filter(m => !m.visibility || m.visibility === 'list');
    else list = list.filter(m => /^(gpt|o\d|chatgpt)/i.test(m.id) && !/audio|realtime|tts|transcri|image|search|embed|moderation|instruct|codex|computer|preview-\d{4}/i.test(m.id));
    const ver = id => { const m = /(\d+(?:\.\d+)?)/.exec(id); return m ? parseFloat(m[1]) : 0; };
    list.sort((a, b) => ver(b.id || b.slug) - ver(a.id || a.slug) || /mini|nano/.test(a.id) - /mini|nano/.test(b.id) || String(a.id).localeCompare(String(b.id)));
    const out = list.map(m => [m.id || m.slug, m.display_name || m.id || m.slug]);
    modelCache.set(p, out);
    return out;
  }
  async function model() {
    const m = S.models[S.provider];
    if (m) return m;
    const list = await models();
    return (list[0] || [])[0] || (S.provider === 'anthropic' ? 'claude-sonnet-5-5' : 'gpt-5');
  }

  /* ---------- Anfragen ---------- */
  const antHeaders = k => ({ 'x-api-key': k, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });
  async function httpError(r, p) {
    let msg = '';
    try { const j = await r.json(); msg = (j.error && (j.error.message || j.error.type)) || j.message || ''; } catch (e) { /* egal */ }
    const e = new Error(
      r.status === 401 || r.status === 403 ? (p === 'chatgpt' ? 'ChatGPT-Anmeldung ungültig oder abgelaufen. Bitte neu anmelden.' : `Der ${NAMES[p]}-API-Schlüssel wird nicht akzeptiert.`)
        : r.status === 429 ? (p === 'chatgpt' ? 'Dein ChatGPT-Kontingent für diese App ist gerade aufgebraucht. Später erneut versuchen oder das Limit in den ChatGPT-Einstellungen erhöhen.' : 'Zu viele Anfragen oder Guthaben aufgebraucht. Bitte kurz warten oder das Guthaben prüfen.')
          : r.status === 400 && /credit|balance|billing/i.test(msg) ? 'Kein Guthaben mehr auf dem API-Konto.'
            : (msg || 'Fehler ' + r.status));
    e.status = r.status; e.auth = r.status === 401 || r.status === 403;
    return e;
  }
  /* Server-Sent Events lesen: ruft onEvent(event, data) je Ereignis */
  async function readSSE(resp, onEvent, signal) {
    const rd = resp.body.getReader(), dec = new TextDecoder();
    let buf = '';
    const flush = block => {
      let ev = 'message', data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) ev = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data || data === '[DONE]') return;
      let j; try { j = JSON.parse(data); } catch (e) { return; }
      onEvent(j.type || ev, j);
    };
    for (;;) {
      if (signal && signal.aborted) { try { rd.cancel(); } catch (e) { /* egal */ } break; }
      const { value, done } = await rd.read();
      if (done) break;
      buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) { flush(buf.slice(0, i)); buf = buf.slice(i + 2); }
    }
    if (buf.trim()) flush(buf);
  }
  const usageMsg = code => (/usage_limit|usage_unavailable/.test(code || '') ? 'Dein ChatGPT-Kontingent für diese App ist gerade aufgebraucht. Später erneut versuchen oder das Limit in den ChatGPT-Einstellungen erhöhen.' : '');
  /* msgs: [{ role: 'user'|'assistant', text, images: [dataURL] }] */
  async function ask({ instructions = '', messages, onDelta, signal, maxTokens = 2500 }) {
    if (!S.provider) { const e = new Error('Noch kein KI-Dienst eingerichtet.'); e.setup = true; throw e; }
    const p = S.provider, cred = await credential(p), mdl = await model();
    let out = '';
    const add = t => { if (!t) return; out += t; if (onDelta) onDelta(t, out); };
    if (p === 'anthropic') {
      const body = {
        model: mdl, max_tokens: maxTokens, stream: true, system: instructions || undefined,
        messages: messages.map(m => ({
          role: m.role,
          content: [...(m.images || []).map(u => { const [, mt, d] = /^data:([^;]+);base64,(.*)$/.exec(u) || []; return { type: 'image', source: { type: 'base64', media_type: mt || 'image/jpeg', data: d || '' } }; }), { type: 'text', text: m.text || ' ' }],
        })),
      };
      const r = await fetch(ANT() + '/messages', { method: 'POST', signal, headers: { ...antHeaders(cred), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw await httpError(r, p);
      let err = null;
      await readSSE(r, (t, j) => {
        if (t === 'content_block_delta' && j.delta && j.delta.type === 'text_delta') add(j.delta.text);
        else if (t === 'error') err = (j.error && j.error.message) || 'Fehler bei Claude';
      }, signal);
      if (err) throw new Error(err);
      return out;
    }
    // OpenAI Responses API (API-Schlüssel und ChatGPT-Abo)
    const body = {
      model: mdl, instructions: instructions || undefined, stream: true, store: false,
      input: messages.map(m => ({
        role: m.role,
        content: m.role === 'assistant' ? [{ type: 'output_text', text: m.text || '' }]
          : [{ type: 'input_text', text: m.text || ' ' }, ...(m.images || []).map(u => ({ type: 'input_image', image_url: u }))],
      })),
    };
    if (p === 'openai') body.max_output_tokens = maxTokens;
    const r = await fetch(OAI() + '/responses', { method: 'POST', signal, headers: { Authorization: 'Bearer ' + cred, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw await httpError(r, p);
    let err = null, done = false;
    await readSSE(r, (t, j) => {
      if (t === 'response.output_text.delta') add(j.delta);
      else if (t === 'response.completed') done = true;
      else if (t === 'response.incomplete') { done = true; if (!out) err = 'Die Antwort wurde abgebrochen (zu lang?).'; }
      else if (t === 'response.failed') { const e = (j.response && j.response.error) || {}; err = usageMsg(e.code) || e.message || 'Die Anfrage ist fehlgeschlagen.'; }
      else if (t === 'error') err = usageMsg(j.code || (j.error && j.error.code)) || j.message || (j.error && j.error.message) || 'Fehler bei der KI';
    }, signal);
    if (err) throw new Error(err);
    if (!done && !out && !(signal && signal.aborted)) throw new Error('Keine Antwort erhalten.');
    return out;
  }

  /* ---------- Einrichtung (gemeinsam für Editor und Bibliothek) ---------- */
  const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  async function renderSetup(el, opts = {}) {
    const I = info();
    if (I.ready) {
      let list = [];
      try { list = await models(); } catch (e) { list = []; }
      const cur = S.models[S.provider] || (list[0] || [])[0] || '';
      el.innerHTML = `<div class="ai-acc"><span class="ai-logo" data-p="${I.provider}">${I.provider === 'anthropic' ? 'C' : 'AI'}</span><div style="flex:1;min-width:0"><b>${esc(I.name)}${I.provider === 'chatgpt' ? ' · dein Abo' : ' · API-Schlüssel'}</b><div class="ai-sub">${esc(I.email || (I.provider === 'chatgpt' ? 'angemeldet' : 'Schlüssel auf diesem Gerät gespeichert'))}</div></div><button type="button" class="btn" data-ai="off">Trennen</button></div>
        ${list.length ? `<label class="ai-fld"><span>Modell</span><select class="field" data-ai="model">${list.map(([id, l]) => `<option value="${esc(id)}" ${id === cur ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>` : ''}
        <p class="ai-note">Beim Benutzen geht der Text des Dokuments (und auf Wunsch ein Bild der Seite) an ${esc(I.name)}. ${I.provider === 'chatgpt' ? 'Verbrauch läuft über dein ChatGPT-Abo (Limit je App in den ChatGPT-Einstellungen).' : 'Abgerechnet wird pro Nutzung über dein API-Konto.'}</p>`;
    } else {
      el.innerHTML = `${I.canChatGPT ? `<button type="button" class="btn primary ai-big" data-ai="chatgpt">Mit ChatGPT anmelden<small>nutzt dein Plus- oder Pro-Abo</small></button><div class="ai-or">oder eigener API-Schlüssel</div>` : `<p class="ai-note" style="margin:0 0 14px">Mit eigenem API-Schlüssel (Bezahlung pro Nutzung, meist Cent-Beträge). Die Anmeldung mit dem ChatGPT-Abo gibt es in der Desktop-App.</p>`}
        <label class="ai-fld"><span>OpenAI-API-Schlüssel</span><div class="ai-row"><input class="field" type="password" data-ai="okey" placeholder="sk-…" autocomplete="off"><button type="button" class="btn" data-ai="openai">Verbinden</button></div></label>
        <label class="ai-fld"><span>Claude-API-Schlüssel</span><div class="ai-row"><input class="field" type="password" data-ai="akey" placeholder="sk-ant-…" autocomplete="off"><button type="button" class="btn" data-ai="anthropic">Verbinden</button></div></label>
        <p class="ai-err" data-ai="err"></p>
        <p class="ai-note">Schlüssel erstellen: <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">OpenAI</a> · <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Claude</a>. Der Schlüssel bleibt auf diesem Gerät. Ein Claude-Abo (Pro/Max) lässt sich nicht verwenden, Anthropic erlaubt das nur in den eigenen Apps.</p>`;
    }
    el.onclick = async e => {
      const b = e.target.closest('button[data-ai]'); if (!b) return;
      const err = el.querySelector('[data-ai=err]'), k = b.dataset.ai;
      if (err) err.textContent = '';
      const orig = b.innerHTML, wait = t => { b.disabled = true; b.textContent = t; };
      try {
        if (k === 'chatgpt') { wait('Im Browser anmelden …'); await connectChatGPT(); }
        else if (k === 'openai' || k === 'anthropic') { wait('Prüfe …'); await useKey(k, el.querySelector(k === 'openai' ? '[data-ai=okey]' : '[data-ai=akey]').value); }
        else if (k === 'off') { await disconnect(); }
        await renderSetup(el, opts); if (opts.onChange) opts.onChange(info());
      } catch (x) { b.disabled = false; b.innerHTML = orig; if (err) err.textContent = x.message || String(x); }
    };
    el.onchange = e => { if (e.target.matches('[data-ai=model]')) { setModel(e.target.value); if (opts.onChange) opts.onChange(info()); } };
  }

  global.WBAI = {
    renderSetup,
    info, ask, models, model, setModel, connectChatGPT, useKey, disconnect, getKey, NAMES,
    onChange: fn => { listeners.add(fn); fn(info()); return () => listeners.delete(fn); },
  };
})(window);
