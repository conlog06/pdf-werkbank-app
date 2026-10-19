/* PDF Werkbank – Befehlspalette (Strg+K / ⌘K)
 * Jede Seite meldet Anbieter an: fn(query) → [{ label, hint, group, keys, run }].
 * Unscharfe Suche über Bezeichnung und Stichwörter, Pfeiltasten und Enter.
 */
(function (global) {
  'use strict';
  const providers = [];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');
  let root = null, list = [], sel = 0, recent = [];
  try { recent = JSON.parse(localStorage.getItem('pdfwb.palette.recent') || '[]'); } catch (e) { recent = []; }

  /* Punkte: Wortanfang > Teilwort > Buchstabenfolge */
  function score(item, q) {
    if (!q) return 1 + (recent.indexOf(item.label) >= 0 ? 10 - recent.indexOf(item.label) : 0);
    const t = norm(item.label), k = norm(item.keys || '') + ' ' + norm(item.group || '');
    if (t.startsWith(q)) return 100 - t.length / 100;
    const w = t.indexOf(' ' + q); if (w >= 0) return 80 - w / 100;
    const i = t.indexOf(q); if (i >= 0) return 60 - i / 100;
    if (k.includes(q)) return 40;
    let p = 0; for (const ch of q) { p = t.indexOf(ch, p); if (p < 0) return 0; p++; }
    return 10;
  }
  function css() {
    if (document.getElementById('wbPalCss')) return;
    const s = document.createElement('style'); s.id = 'wbPalCss';
    s.textContent = `.wbpal{position:fixed;inset:0;z-index:200;background:rgb(10 13 20 / .35);display:flex;justify-content:center;align-items:flex-start;padding:min(14vh,120px) 12px 12px;animation:wbpf .1s}
@keyframes wbpf{from{opacity:0}}
.wbpal .box{width:min(620px,100%);max-height:min(70vh,560px);display:flex;flex-direction:column;background:var(--raise,#fff);color:var(--ink,#1b2130);border:1px solid var(--line,#d1d6df);border-radius:16px;box-shadow:0 24px 70px rgb(0 0 0 / .35);overflow:hidden}
.wbpal input{border:0;outline:0;background:transparent;padding:16px 18px;font:500 17px/1.3 var(--f-ui,system-ui);color:inherit;border-bottom:1px solid var(--line,#d1d6df)}
.wbpal ul{list-style:none;margin:0;padding:6px;overflow:auto}
.wbpal li{display:flex;align-items:center;gap:12px;padding:9px 12px;border-radius:10px;cursor:pointer}
.wbpal li[aria-selected="true"]{background:var(--accent-soft,#e3e9fb)}
.wbpal li .g{font:600 10.5px/1 var(--f-mono,monospace);letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#5a6374);min-width:74px}
.wbpal li .l{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wbpal li .h{color:var(--muted,#5a6374);font:12px var(--f-mono,monospace);white-space:nowrap}
.wbpal .empty{padding:18px;color:var(--muted,#5a6374);text-align:center}
.wbpal .foot{display:flex;gap:14px;padding:8px 14px;border-top:1px solid var(--line,#d1d6df);color:var(--muted,#5a6374);font-size:12px}
.wbpal kbd{font:11px var(--f-mono,monospace);padding:1px 5px;border:1px solid var(--line,#d1d6df);border-radius:4px;background:var(--desk,#eef0f4)}`;
    document.head.appendChild(s);
  }
  function collect(q) {
    const all = [];
    for (const p of providers) { try { all.push(...(p(q) || [])); } catch (e) { console.warn(e); } }
    const nq = norm(q).trim();
    return all.map(it => ({ it, s: score(it, nq) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 60).map(x => x.it);
  }
  function render() {
    const ul = root.querySelector('ul');
    ul.innerHTML = list.length ? list.map((it, i) => `<li role="option" data-i="${i}" aria-selected="${i === sel}"><span class="g">${esc(it.group || '')}</span><span class="l">${esc(it.label)}</span>${it.hint ? `<span class="h">${esc(it.hint)}</span>` : ''}</li>`).join('') : '<div class="empty">Nichts gefunden</div>';
    const cur = ul.querySelector('[aria-selected="true"]'); if (cur) cur.scrollIntoView({ block: 'nearest' });
  }
  function run(i) {
    const it = list[i]; if (!it) return;
    close();
    recent = [it.label, ...recent.filter(l => l !== it.label)].slice(0, 8);
    try { localStorage.setItem('pdfwb.palette.recent', JSON.stringify(recent)); } catch (e) { /* egal */ }
    setTimeout(() => it.run(), 0);
  }
  function open(prefill = '') {
    if (root) return;
    css();
    root = document.createElement('div'); root.className = 'wbpal';
    const mac = /Mac|iPad|iPhone/.test(navigator.platform);
    root.innerHTML = `<div class="box" role="dialog" aria-label="Befehle"><input type="text" placeholder="Befehl, Werkzeug oder Dokument …" aria-label="Befehl suchen" autocomplete="off" spellcheck="false"><ul role="listbox"></ul><div class="foot"><span><kbd>↑</kbd> <kbd>↓</kbd> auswählen</span><span><kbd>Enter</kbd> ausführen</span><span><kbd>Esc</kbd> schließen</span><span style="margin-left:auto"><kbd>${mac ? '⌘' : 'Strg'}</kbd> <kbd>K</kbd></span></div></div>`;
    document.body.appendChild(root);
    const inp = root.querySelector('input');
    inp.value = prefill;
    const update = () => { list = collect(inp.value); sel = 0; render(); };
    inp.addEventListener('input', update);
    inp.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(list.length - 1, sel + 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
      e.stopPropagation();
    });
    root.addEventListener('pointerdown', e => { if (e.target === root) close(); });
    root.querySelector('ul').addEventListener('click', e => { const li = e.target.closest('[data-i]'); if (li) run(+li.dataset.i); });
    update();
    setTimeout(() => inp.focus(), 10);
  }
  function close() { if (root) { root.remove(); root = null; } }
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); e.stopPropagation(); if (root) close(); else open(); }
  }, true);
  global.WBPalette = { add: fn => providers.push(fn), open, close, isOpen: () => !!root };
})(window);
