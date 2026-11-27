/* PDF Werkbank – Fragen an die ganze Bibliothek (ab Version 2.0)
 * Sucht passende Seiten in allen Dokumenten (WBSearch.passages), schickt nur diese Ausschnitte an die KI
 * und zeigt die Antwort mit anklickbaren Quellen (Dokument und Seite).
 *   WBLibChat.open({ items: async () => [...], open: (docId, page) => {}, scope: 'Bibliothek' })
 */
(function (global) {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const md = s => esc(s)
    .replace(/^### (.*)$/gm, '<h4>$1</h4>').replace(/^## (.*)$/gm, '<h4>$1</h4>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/^\s*[-*•] (.*)$/gm, '<li>$1</li>').replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, '<ul>$1</ul>')
    .replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>').replace(/<\/li><br>/g, '</li>').replace(/<ul><br>/g, '<ul>');
  const CSS = `.wblc-back{position:fixed;inset:0;z-index:290;background:rgb(10 14 22/.38);display:flex;justify-content:flex-end}
.wblc{width:min(560px,100%);height:100%;display:flex;flex-direction:column;background:var(--raise,#fff);color:var(--ink,#1b2130);box-shadow:-20px 0 60px rgb(0 0 0/.25);font:14px/1.5 var(--f-ui,var(--f-sans,system-ui,sans-serif))}
.wblc header{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line,#dde1e8)}.wblc header h3{margin:0;font-size:16px;flex:1}
.wblc header small{color:var(--muted,#5f6878);font-size:12px}
.wblc .x{border:0;background:transparent;font-size:22px;cursor:pointer;color:var(--muted,#5f6878);border-radius:8px;padding:0 8px}
.wblc main{flex:1;overflow:auto;padding:14px 16px;display:flex;flex-direction:column;gap:14px}
.wblc .q{align-self:flex-end;max-width:85%;background:var(--accent,#1f4fd8);color:var(--accent-ink,#fff);padding:8px 12px;border-radius:14px 14px 4px 14px;white-space:pre-wrap}
.wblc .a{max-width:100%;padding:2px 0}.wblc .a h4{margin:10px 0 4px;font-size:14px}.wblc .a ul{margin:4px 0;padding-left:20px}
.wblc .cite{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;margin:0 1px;border-radius:9px;background:var(--accent-soft,#e5ebfc);color:var(--accent,#1f4fd8);font:600 11px/1 var(--f-mono,monospace);cursor:pointer;border:0;vertical-align:1px}
.wblc .srcs{display:flex;flex-direction:column;gap:4px;margin-top:8px}
.wblc .src{display:flex;gap:8px;align-items:baseline;text-align:left;border:1px solid var(--line,#dde1e8);background:var(--chrome,#f6f7f9);border-radius:10px;padding:6px 10px;cursor:pointer;color:inherit;font:12.5px/1.4 inherit}
.wblc .src b{flex:none;font:600 11px var(--f-mono,monospace);color:var(--accent,#1f4fd8)}.wblc .src span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wblc .src:hover{border-color:var(--accent,#1f4fd8)}
.wblc .hint{color:var(--muted,#5f6878);font-size:13px}.wblc .hint button{margin:4px 6px 0 0}
.wblc footer{display:flex;gap:8px;padding:12px 16px calc(12px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--line,#dde1e8)}
.wblc textarea{flex:1;resize:none;font:inherit;color:inherit;background:var(--raise,#fff);border:1px solid var(--line,#dde1e8);border-radius:12px;padding:9px 12px;min-height:44px;max-height:140px}
.wblc .b{border:1px solid var(--line,#dde1e8);background:var(--raise,#fff);color:inherit;border-radius:10px;padding:0 14px;cursor:pointer;font:inherit;font-weight:500}.wblc .b.p{background:var(--accent,#1f4fd8);border-color:var(--accent,#1f4fd8);color:var(--accent-ink,#fff)}
.wblc .chip{border:1px solid var(--line,#dde1e8);background:var(--raise,#fff);border-radius:999px;padding:4px 10px;cursor:pointer;font:inherit;font-size:12.5px;color:inherit}
.wblc .dots::after{content:'…';animation:wblcd 1s steps(3) infinite}@keyframes wblcd{0%{content:'.'}50%{content:'..'}100%{content:'...'}}
@media (max-width:600px){.wblc{width:100%}}`;
  function open(o = {}) {
    if (!document.getElementById('wblc-css')) { const s = document.createElement('style'); s.id = 'wblc-css'; s.textContent = CSS; document.head.appendChild(s); }
    const AI = global.WBAI, SR = global.WBSearch;
    const back = document.createElement('div'); back.className = 'wblc-back';
    back.innerHTML = `<div class="wblc" role="dialog" aria-label="Bibliothek fragen"><header><h3>Bibliothek fragen</h3><small>Antworten nur aus deinen Dokumenten</small><button class="x" data-x="close" aria-label="Schließen">×</button></header><main data-log></main>
      <footer><textarea data-in rows="1" placeholder="Frag etwas zu deinen Skripten …"></textarea><button class="b p" data-x="send">Fragen</button></footer></div>`;
    document.body.appendChild(back);
    const log = back.querySelector('[data-log]'), inp = back.querySelector('[data-in]');
    const hist = [];
    const intro = () => {
      log.innerHTML = `<div class="hint">${AI && AI.info().ready ? 'Ich durchsuche alle Dokumente der Bibliothek, wähle die passendsten Seiten aus und antworte mit Quellenangabe. Tipp auf eine Quelle, um die Seite zu öffnen.' : '<b>Dafür braucht es die KI.</b> Richte sie im Editor über das Funken-Symbol ein (ChatGPT-Konto, OpenAI- oder Claude-Schlüssel).'}
        <div style="margin-top:8px">${['Fasse die wichtigsten Definitionen zusammen', 'Welche Formeln brauche ich für die Klausur?', 'Wo wird Kostenrechnung erklärt?'].map(t => `<button class="chip" data-ex="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>`;
    };
    intro();
    const close = () => { back.remove(); document.removeEventListener('keydown', key, true); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', key, true);
    let busy = false;
    const ask = async q => {
      q = q.trim(); if (!q || busy) return;
      if (!AI || !AI.info().ready) { intro(); return; }
      if (log.querySelector('.hint')) log.innerHTML = '';
      busy = true; inp.value = '';
      log.insertAdjacentHTML('beforeend', `<div class="q">${esc(q)}</div>`);
      const box = document.createElement('div'); box.className = 'a'; box.innerHTML = '<span class="hint dots">Suche passende Seiten</span>'; log.appendChild(box); log.scrollTop = log.scrollHeight;
      try {
        const items = await o.items();
        const query = hist.length ? hist[hist.length - 1].q + ' ' + q : q;
        let ps = await SR.passages(query, items, 8);
        if (ps.length < 3 && hist.length) ps = await SR.passages(q, items, 8);
        if (!ps.length) { box.innerHTML = '<p>Dazu habe ich in deinen Dokumenten nichts gefunden. Versuch andere Begriffe oder prüfe, ob die Texterkennung bei Scans gelaufen ist.</p>'; busy = false; return; }
        box.innerHTML = '<span class="hint dots">Die KI liest ' + ps.length + ' Seiten</span>';
        const ctx = ps.map((p, i) => `[${i + 1}] ${p.doc.name}, Seite ${p.n}:\n${p.text}`).join('\n\n');
        const prev = hist.slice(-3).flatMap(h => [{ role: 'user', text: h.q }, { role: 'assistant', text: h.a }]);
        let out = ''; box._ps = ps;
        const render = t => {
          box.innerHTML = md(t).replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (m, g) => g.split(/\s*,\s*/).map(n => ps[+n - 1] ? `<button class="cite" data-c="${+n - 1}" title="${esc(ps[+n - 1].doc.name)}, S. ${ps[+n - 1].n}">${n}</button>` : '').join(''));
        };
        out = await AI.ask({
          instructions: 'Du beantwortest Fragen ausschließlich anhand der Ausschnitte aus den Dokumenten des Nutzers. Antworte auf Deutsch, klar und knapp (Stichpunkte, wo sinnvoll). Belege jede Aussage mit der Nummer des Ausschnitts in eckigen Klammern, z. B. [2]. Wenn die Ausschnitte die Frage nicht beantworten, sag das ehrlich und nenne, was fehlt. Erfinde nichts.',
          messages: [...prev, { role: 'user', text: `Ausschnitte:\n${ctx}\n\nFrage: ${q}` }], maxTokens: 1800,
          onDelta: (d, all) => { render(all); log.scrollTop = log.scrollHeight; },
        });
        render(out);
        const used = new Set([...out.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)].flatMap(m => m[1].split(/\s*,\s*/).map(n => +n - 1)));
        const srcs = ps.map((p, i) => [p, i]).filter(([, i]) => used.has(i));
        box.insertAdjacentHTML('beforeend', `<div class="srcs">${(srcs.length ? srcs : ps.slice(0, 3).map((p, i) => [p, i])).map(([p, i]) => `<button class="src" data-c="${i}"><b>[${i + 1}]</b><span>${esc(p.doc.name)} · Seite ${p.n}</span></button>`).join('')}</div>`);
        hist.push({ q, a: out });
      } catch (e) { box.innerHTML = `<p class="hint">Das hat nicht geklappt: ${esc(e.message || e)}</p>`; }
      busy = false; log.scrollTop = log.scrollHeight;
    };
    back.addEventListener('click', e => {
      if (e.target === back) { close(); return; }
      const c = e.target.closest('[data-c]');
      if (c) { const a = c.closest('.a'); const p = a && a._ps ? a._ps[+c.dataset.c] : null; if (p) { o.open(p.doc.id, p.n); if (o.closeOnOpen !== false) close(); } return; }
      const ex = e.target.closest('[data-ex]'); if (ex) { ask(ex.dataset.ex); return; }
      const x = e.target.closest('[data-x]'); if (!x) return;
      if (x.dataset.x === 'close') close(); else if (x.dataset.x === 'send') ask(inp.value);
    });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(inp.value); } });
    inp.addEventListener('input', () => { inp.style.height = 'auto'; inp.style.height = Math.min(140, inp.scrollHeight) + 'px'; });
    setTimeout(() => inp.focus(), 50);
    if (o.q) ask(o.q);
    return { ask, close };
  }
  global.WBLibChat = { open };
})(window);
