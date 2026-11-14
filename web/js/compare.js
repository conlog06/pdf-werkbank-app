/* PDF Werkbank – zwei PDFs vergleichen (ab Version 1.7)
 * Nebeneinander, Wort für Wort: Entferntes rot in der alten, Neues grün in der neuen Fassung.
 * Liste aller Änderungen mit Seitenzahl, Springen per Klick oder mit ← →, gemeinsames Scrollen.
 * WBCompare.open({ a: { name, bytes }, b: { name, bytes } })
 */
(function (global) {
  'use strict';
  const PJ = () => global.pdfjsLib;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* Wörter mit Position (in Seitenkoordinaten bei Maßstab 1) */
  async function wordsOf(pdf) {
    const out = [], pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const pg = await pdf.getPage(n), vp = pg.getViewport({ scale: 1 }), tc = await pg.getTextContent();
      pages.push({ w: vp.width, h: vp.height });
      for (const it of tc.items) {
        const s = it.str || ''; if (!s.trim()) continue;
        const tx = PJ().Util.transform(vp.transform, it.transform);
        const fh = Math.hypot(tx[2], tx[3]) || 1, ux = tx[2] / fh, uy = tx[3] / fh, dl = Math.hypot(tx[0], tx[1]) || 1, dx = tx[0] / dl, dy = tx[1] / dl, W = it.width || 0;
        const re = /\S+/g; let m;
        while ((m = re.exec(s))) {
          const s0 = m.index / s.length, s1 = (m.index + m[0].length) / s.length;
          const bx = tx[4] + dx * W * s0, by = tx[5] + dy * W * s0, L = W * (s1 - s0), pts = [];
          for (const k of [-0.22, 0.9]) for (const q of [0, L]) pts.push([bx + dx * q + ux * k * fh, by + dy * q + uy * k * fh]);
          const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), x = Math.min(...xs), y = Math.min(...ys);
          out.push({ t: m[0], k: norm(m[0]), p: n - 1, x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y });
        }
      }
    }
    return { words: out, pages };
  }
  const norm = s => s.normalize('NFKC').replace(/[­​]/g, '').replace(/[‐‑–—]/g, '-').replace(/[„“”"]/g, '"').replace(/[‚‘’']/g, "'").toLowerCase();

  /* Myers-Diff über Wortlisten; liefert Abschnitte { t: '=', '-', '+', a: [i0,i1), b: [j0,j1) } */
  function diff(A, B, maxD = 4000) {
    let s = 0; while (s < A.length && s < B.length && A[s] === B[s]) s++;
    let ea = A.length, eb = B.length; while (ea > s && eb > s && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
    const a = A.slice(s, ea), b = B.slice(s, eb), N = a.length, M = b.length, ops = [];
    const push = (t, i0, i1, j0, j1) => { if (i1 - i0 || j1 - j0) { const l = ops[ops.length - 1]; if (l && l.t === t && l.a[1] === i0 && l.b[1] === j0) { l.a[1] = i1; l.b[1] = j1; } else ops.push({ t, a: [i0, i1], b: [j0, j1] }); } };
    push('=', 0, s, 0, s);
    if (N === 0 || M === 0) { push('-', s, s + N, s, s); push('+', s + N, s + N, s, s + M); }
    else {
      const max = N + M, off = max, V = new Int32Array(2 * max + 2), trace = [];
      let found = -1;
      for (let d = 0; d <= Math.min(max, maxD); d++) {
        trace.push(V.slice(off - d - 1, off + d + 2));
        for (let k = -d; k <= d; k += 2) {
          let x = (k === -d || (k !== d && V[off + k - 1] < V[off + k + 1])) ? V[off + k + 1] : V[off + k - 1] + 1, y = x - k;
          while (x < N && y < M && a[x] === b[y]) { x++; y++; }
          V[off + k] = x;
          if (x >= N && y >= M) { found = d; break; }
        }
        if (found >= 0) break;
      }
      if (found < 0) { push('-', s, s + N, s, s); push('+', s + N, s + N, s, s + M); }
      else {
        // Pfad rückwärts
        const segs = []; let x = N, y = M;
        for (let d = found; d > 0; d--) {
          const T = trace[d], g = k => T[k + d + 1];
          const k = x - y, down = (k === -d || (k !== d && g(k - 1) < g(k + 1))), pk = down ? k + 1 : k - 1, px = g(pk), py = px - pk;
          while (x > (down ? px : px + 1) && y > (down ? py + 1 : py)) { segs.push(['=', x - 1, y - 1]); x--; y--; }
          if (down) segs.push(['+', px, py]); else segs.push(['-', px, py]);
          x = px; y = py;
        }
        while (x > 0 && y > 0) { segs.push(['=', x - 1, y - 1]); x--; y--; }
        segs.reverse();
        for (const [t, i, j] of segs) {
          if (t === '=') push('=', s + i, s + i + 1, s + j, s + j + 1);
          else if (t === '-') push('-', s + i, s + i + 1, s + j, s + j);
          else push('+', s + i, s + i, s + j, s + j + 1);
        }
      }
    }
    push('=', ea, A.length, eb, B.length);
    return ops;
  }
  /* zusammenhängende Änderungen bündeln: entfernt / eingefügt / geändert */
  function changes(ops) {
    const out = [];
    for (let i = 0; i < ops.length; i++) {
      const o = ops[i]; if (o.t === '=') continue;
      const last = out[out.length - 1];
      if (last && last.end === i - 1) { last.a[1] = Math.max(last.a[1], o.a[1]); last.b[1] = Math.max(last.b[1], o.b[1]); last.end = i; continue; }
      out.push({ a: o.a.slice(), b: o.b.slice(), end: i });
    }
    // kleine Gleichstücke (1 Wort) zwischen zwei Änderungen verbinden
    for (let i = out.length - 1; i > 0; i--) if (out[i].a[0] - out[i - 1].a[1] <= 1 && out[i].b[0] - out[i - 1].b[1] <= 1) { out[i - 1].a[1] = out[i].a[1]; out[i - 1].b[1] = out[i].b[1]; out.splice(i, 1); }
    return out.map(c => ({ a: c.a, b: c.b, kind: c.a[1] > c.a[0] && c.b[1] > c.b[0] ? 'mod' : c.a[1] > c.a[0] ? 'del' : 'ins' }));
  }

  let cssDone = false;
  function css() {
    if (cssDone) return; cssDone = true;
    const s = document.createElement('style');
    s.textContent = `.wbcmp{position:fixed;inset:0;z-index:250;background:var(--desk,#eef0f4);color:var(--ink,#1b2130);display:grid;grid-template-rows:auto minmax(0,1fr);font:14px/1.4 var(--f-sans,system-ui,sans-serif)}
.wbcmp header{display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--chrome,#f7f8fa);border-bottom:1px solid var(--line,#dde1e8);flex-wrap:wrap;padding-top:max(10px,env(safe-area-inset-top))}
.wbcmp header h3{margin:0;font-size:15px;flex:1;min-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wbcmp header .cnt{font:500 12px var(--f-mono,monospace);color:var(--muted,#5f6878)}
.wbcmp .b{border:1px solid var(--line,#dde1e8);background:var(--raise,#fff);color:inherit;border-radius:9px;padding:7px 12px;cursor:pointer;font:inherit}
.wbcmp .b[aria-pressed=true]{background:var(--accent-soft,#e5ebfc);border-color:var(--accent,#1f4fd8);color:var(--accent,#1f4fd8)}
.wbcmp .body{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) 280px;min-height:0}
.wbcmp .col{overflow:auto;padding:14px;display:flex;flex-direction:column;align-items:center;gap:14px;min-width:0}
.wbcmp .col + .col{border-left:1px solid var(--line,#dde1e8)}
.wbcmp .lbl{position:sticky;top:-14px;z-index:2;align-self:stretch;margin:-14px -14px 0;padding:8px 14px;background:color-mix(in srgb,var(--desk,#eef0f4) 88%,transparent);backdrop-filter:blur(6px);font-weight:600;font-size:13px;display:flex;gap:8px;align-items:center}
.wbcmp .lbl i{width:10px;height:10px;border-radius:3px;flex:none}
.wbcmp .pg{position:relative;background:#fff;box-shadow:0 1px 3px rgb(0 0 0/.15);flex:none}
.wbcmp .pg canvas{display:block;width:100%;height:100%}
.wbcmp .pg svg{position:absolute;inset:0;width:100%;height:100%}
.wbcmp .pg .n{position:absolute;right:6px;bottom:4px;font:11px var(--f-mono,monospace);color:#8a93a3}
.wbcmp rect.del{fill:#e5484d;fill-opacity:.28;stroke:#e5484d;stroke-width:.8}
.wbcmp rect.ins{fill:#30a46c;fill-opacity:.28;stroke:#30a46c;stroke-width:.8}
.wbcmp rect.on{stroke-width:2.2;fill-opacity:.42}
.wbcmp .list{overflow:auto;border-left:1px solid var(--line,#dde1e8);background:var(--chrome,#f7f8fa);padding:8px}
.wbcmp .ch{display:block;width:100%;text-align:left;border:1px solid transparent;background:transparent;color:inherit;border-radius:10px;padding:8px 10px;cursor:pointer;font:inherit;font-size:13px}
.wbcmp .ch:hover{background:var(--accent-soft,#e5ebfc)}
.wbcmp .ch[aria-current=true]{border-color:var(--accent,#1f4fd8);background:var(--accent-soft,#e5ebfc)}
.wbcmp .ch small{display:block;color:var(--muted,#5f6878);font:11px var(--f-mono,monospace);margin-bottom:2px}
.wbcmp .ch del{color:#c4352b;background:rgb(229 72 77/.12);text-decoration:line-through;border-radius:3px}
.wbcmp .ch ins{color:#1a7f4b;background:rgb(48 164 108/.14);text-decoration:none;border-radius:3px}
.wbcmp .msg{padding:40px;text-align:center;color:var(--muted,#5f6878)}
.wbcmp .seg{display:none}
@media (max-width:900px){.wbcmp .body{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.wbcmp .list{display:none}.wbcmp.showlist .list{display:block;position:absolute;right:0;top:56px;bottom:0;width:min(320px,90vw);z-index:5;box-shadow:-10px 0 30px rgb(0 0 0/.15)}}
@media (max-width:640px){.wbcmp .body{grid-template-columns:minmax(0,1fr)}.wbcmp .seg{display:inline-flex}.wbcmp[data-side=a] .col.b2,.wbcmp[data-side=b] .col.a2{display:none}.wbcmp .col + .col{border-left:0}}`;
    document.head.appendChild(s);
  }

  async function open({ a, b }) {
    css();
    const root = document.createElement('div'); root.className = 'wbcmp'; root.dataset.side = 'b';
    root.innerHTML = `<header><h3>Vergleich: ${esc(a.name)} ↔ ${esc(b.name)}</h3><span class="cnt">wird verglichen …</span>
      <span class="seg"><button class="b" data-side="a">Alt</button><button class="b" data-side="b" aria-pressed="true">Neu</button></span>
      <button class="b" data-x="prev" title="Vorherige Änderung (←)">‹</button><button class="b" data-x="next" title="Nächste Änderung (→)">›</button>
      <button class="b" data-x="sync" aria-pressed="true" title="Beide Seiten gemeinsam scrollen">Gemeinsam scrollen</button><button class="b" data-x="list" title="Liste">Liste</button><button class="b" data-x="close">Schließen</button></header>
      <div class="body"><div class="col a2"><div class="lbl"><i style="background:#e5484d"></i>${esc(a.name)} <span style="font-weight:400;color:var(--muted)">(alt)</span></div></div><div class="col b2"><div class="lbl"><i style="background:#30a46c"></i>${esc(b.name)} <span style="font-weight:400;color:var(--muted)">(neu)</span></div></div><div class="list"><div class="msg">Text wird gelesen …</div></div></div>`;
    document.body.appendChild(root);
    const $ = s => root.querySelector(s);
    let alive = true;
    const st = { cur: -1, ch: [], sync: true };
    const close = () => { alive = false; root.remove(); document.removeEventListener('keydown', onKey, true); for (const d of docs) try { d.destroy(); } catch (e) { /* egal */ } };
    const onKey = e => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); e.stopPropagation(); go(st.cur + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); go(st.cur - 1); }
    };
    document.addEventListener('keydown', onKey, true);
    const docs = [];
    let A, B;
    try {
      const [pa, pb] = await Promise.all([a, b].map(x => PJ().getDocument({ data: x.bytes.slice(), isEvalSupported: false }).promise));
      docs.push(pa, pb);
      [A, B] = await Promise.all([wordsOf(pa), wordsOf(pb)]);
    } catch (e) { $('.list').innerHTML = `<div class="msg">${esc(e.message || e)}</div>`; $('.cnt').textContent = ''; return { close }; }
    if (!alive) return { close };
    const ops = diff(A.words.map(w => w.k), B.words.map(w => w.k));
    st.ch = changes(ops);
    const n = st.ch.length;
    $('.cnt').textContent = !A.words.length && !B.words.length ? 'kein Text gefunden' : n === 0 ? 'keine Textunterschiede' : n === 1 ? '1 Änderung' : n + ' Änderungen';
    // Markierungen je Seite
    const marks = { a: new Map(), b: new Map() };
    st.ch.forEach((c, ci) => {
      for (let i = c.a[0]; i < c.a[1]; i++) { const w = A.words[i]; if (!marks.a.has(w.p)) marks.a.set(w.p, []); marks.a.get(w.p).push([w, ci]); }
      for (let j = c.b[0]; j < c.b[1]; j++) { const w = B.words[j]; if (!marks.b.has(w.p)) marks.b.set(w.p, []); marks.b.get(w.p).push([w, ci]); }
    });
    const snip = (W, r, max = 12) => { const s = W.slice(r[0], Math.min(r[1], r[0] + max)).map(w => w.t).join(' '); return r[1] - r[0] > max ? s + ' …' : s; };
    const ctxw = (W, i, before) => before ? W.slice(Math.max(0, i - 4), i).map(w => w.t).join(' ') : W.slice(i, i + 4).map(w => w.t).join(' ');
    $('.list').innerHTML = !n ? `<div class="msg">${!A.words.length && !B.words.length ? 'In beiden PDFs steht kein lesbarer Text. Bei Scans zuerst ⋯ › <i>Texterkennung (OCR)</i> ausführen.' : 'Der Text beider Fassungen ist gleich.'}</div>`
      : st.ch.map((c, i) => {
        const pa = c.a[1] > c.a[0] ? A.words[c.a[0]].p + 1 : null, pb = c.b[1] > c.b[0] ? B.words[c.b[0]].p + 1 : null;
        const pre = ctxw(B.words, c.b[0], true) || ctxw(A.words, c.a[0], true);
        return `<button class="ch" data-c="${i}"><small>${c.kind === 'mod' ? 'Geändert' : c.kind === 'del' ? 'Entfernt' : 'Eingefügt'} · S. ${pa && pb && pa !== pb ? pa + ' → ' + pb : pa || pb}</small>${pre ? '… ' + esc(pre) + ' ' : ''}${c.a[1] > c.a[0] ? `<del>${esc(snip(A.words, c.a))}</del> ` : ''}${c.b[1] > c.b[0] ? `<ins>${esc(snip(B.words, c.b))}</ins>` : ''}</button>`;
      }).join('');
    // Seiten
    const colA = $('.col.a2'), colB = $('.col.b2');
    const els = { a: [], b: [] };
    const width = col => Math.max(200, Math.min(900, col.clientWidth - 28));
    function build(side, info, col) {
      const W = width(col);
      info.pages.forEach((p, i) => {
        const el = document.createElement('div'); el.className = 'pg'; el.dataset.p = i;
        el.style.width = W + 'px'; el.style.height = Math.round(W * p.h / p.w) + 'px';
        const ms = marks[side].get(i) || [];
        el.innerHTML = `<svg viewBox="0 0 ${p.w} ${p.h}" preserveAspectRatio="none">${ms.map(([w, ci]) => `<rect class="${side === 'a' ? 'del' : 'ins'}" data-ci="${ci}" x="${w.x.toFixed(1)}" y="${w.y.toFixed(1)}" width="${w.w.toFixed(1)}" height="${w.h.toFixed(1)}" rx="1.2"/>`).join('')}</svg><span class="n">${i + 1}</span>`;
        col.appendChild(el); els[side].push(el);
      });
    }
    build('a', A, colA); build('b', B, colB);
    const rendered = new Set();
    const io = new IntersectionObserver(ents => {
      for (const en of ents) {
        if (!en.isIntersecting) continue;
        const el = en.target, side = el.closest('.a2') ? 'a' : 'b', i = +el.dataset.p, key = side + i;
        if (rendered.has(key)) continue; rendered.add(key);
        (async () => {
          const pg = await docs[side === 'a' ? 0 : 1].getPage(i + 1), w = el.clientWidth, base = pg.getViewport({ scale: 1 }), dpr = Math.min(2, global.devicePixelRatio || 1);
          const vp = pg.getViewport({ scale: w / base.width * dpr }), cv = document.createElement('canvas'); cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
          await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
          el.prepend(cv);
        })().catch(() => {});
      }
    }, { root: null, rootMargin: '600px' });
    [...els.a, ...els.b].forEach(e => io.observe(e));
    // gemeinsam scrollen: gleiche relative Position
    let lock = false;
    const syncFrom = (src, dst) => () => { if (!st.sync || lock) return; lock = true; const r = src.scrollTop / Math.max(1, src.scrollHeight - src.clientHeight); dst.scrollTop = r * (dst.scrollHeight - dst.clientHeight); requestAnimationFrame(() => { lock = false; }); };
    colA.addEventListener('scroll', syncFrom(colA, colB), { passive: true }); colB.addEventListener('scroll', syncFrom(colB, colA), { passive: true });
    function go(i) {
      if (!n) return;
      st.cur = (i + n) % n;
      const c = st.ch[st.cur];
      root.querySelectorAll('rect.on').forEach(r => r.classList.remove('on'));
      root.querySelectorAll(`rect[data-ci="${st.cur}"]`).forEach(r => r.classList.add('on'));
      root.querySelectorAll('.ch').forEach(b => b.setAttribute('aria-current', String(+b.dataset.c === st.cur)));
      const li = root.querySelector(`.ch[data-c="${st.cur}"]`); if (li) li.scrollIntoView({ block: 'nearest' });
      const wasSync = st.sync; st.sync = false;
      const show = (side, W, r, col) => {
        const w = r[1] > r[0] ? W.words[r[0]] : W.words[Math.min(r[0], W.words.length - 1)] || null; if (!w) return;
        const el = els[side][w.p], sc = el.clientWidth / W.pages[w.p].w;
        col.scrollTo({ top: el.offsetTop + w.y * sc - col.clientHeight / 3, behavior: 'smooth' });
      };
      show('a', A, c.a, colA); show('b', B, c.b, colB);
      setTimeout(() => { st.sync = wasSync; }, 700);
      $('.cnt').textContent = `${st.cur + 1} von ${n} Änderungen`;
    }
    root.addEventListener('click', e => {
      const c = e.target.closest('[data-c]'); if (c) { go(+c.dataset.c); if (innerWidth <= 900) root.classList.remove('showlist'); return; }
      const r = e.target.closest('rect[data-ci]'); if (r) { go(+r.dataset.ci); return; }
      const sd = e.target.closest('[data-side]'); if (sd) { root.dataset.side = sd.dataset.side; root.querySelectorAll('[data-side]').forEach(x => x.setAttribute('aria-pressed', String(x === sd))); return; }
      const x = e.target.closest('[data-x]'); if (!x) return;
      const k = x.dataset.x;
      if (k === 'close') close();
      else if (k === 'next') go(st.cur + 1);
      else if (k === 'prev') go(st.cur - 1);
      else if (k === 'sync') { st.sync = !st.sync; x.setAttribute('aria-pressed', String(st.sync)); }
      else if (k === 'list') root.classList.toggle('showlist');
    });
    return { close, changes: st.ch, go };
  }

  global.WBCompare = { open, diff, changes, _wordsOf: wordsOf };
})(window);
