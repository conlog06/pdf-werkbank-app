/* PDF Werkbank – Lernstatistik und Pomodoro (ab Version 1.9)
 * Zählt aktive Lernzeit je Tag und Dokument, wiederholte Karten, Probeklausuren und Pomodoros.
 * Gespeichert nur auf diesem Gerät (localStorage „pdfwb.stats“).
 *   WBStats.tick(docId, name, sec)  aktive Zeit gutschreiben
 *   WBStats.card(ok) / exam(pct) / pomo()
 *   WBStats.summary()               { today, week, streak, best, total, days, docs }
 *   WBStats.chart(days)             SVG-Balkendiagramm (HTML)
 */
(function (global) {
  'use strict';
  const KEY = 'pdfwb.stats';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
  let S = null, saveT = 0;
  const st = () => { if (!S) { S = load(); S.days = S.days || {}; S.docs = S.docs || {}; } return S; };
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(st())); } catch (e) { /* voll */ } }, 400); };
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = () => { const s = st(), k = dayKey(); return (s.days[k] = s.days[k] || { sec: 0, cards: 0, ok: 0, pomo: 0, exams: 0 }); };
  function tick(docId, name, sec) {
    if (!(sec > 0)) return;
    const t = today(); t.sec += sec;
    if (docId) { const s = st(), d = (s.docs[docId] = s.docs[docId] || { name: '', sec: 0, last: 0 }); d.name = name || d.name; d.sec += sec; d.last = Date.now(); }
    save();
  }
  function card(ok) { const t = today(); t.cards++; if (ok) t.ok++; save(); }
  function exam(pct) { const t = today(); t.exams = (t.exams || 0) + 1; t.examPct = Math.max(t.examPct || 0, pct || 0); save(); }
  function pomo() { const t = today(); t.pomo = (t.pomo || 0) + 1; save(); }
  /* ein Tag zählt, wenn mindestens 10 Minuten gelernt oder 10 Karten wiederholt wurden */
  const active = d => d && (d.sec >= 600 || d.cards >= 10 || d.pomo > 0 || d.exams > 0);
  function summary() {
    const s = st(), days = [];
    for (let i = 29; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); const k = dayKey(d); days.push({ k, d, ...(s.days[k] || { sec: 0, cards: 0, ok: 0, pomo: 0, exams: 0 }) }); }
    let streak = 0;
    for (let i = days.length - 1; i >= 0; i--) { if (active(days[i])) streak++; else if (i === days.length - 1) continue; else break; }
    // längste Serie insgesamt
    const keys = Object.keys(s.days).sort(); let best = 0, run = 0, prev = null;
    for (const k of keys) { if (!active(s.days[k])) { run = 0; prev = k; continue; } const p = new Date(k); p.setDate(p.getDate() - 1); run = prev === dayKey(p) && run ? run + 1 : 1; best = Math.max(best, run); prev = k; }
    const week = days.slice(-7).reduce((a, d) => ({ sec: a.sec + d.sec, cards: a.cards + d.cards, pomo: a.pomo + (d.pomo || 0) }), { sec: 0, cards: 0, pomo: 0 });
    const total = Object.values(s.days).reduce((a, d) => ({ sec: a.sec + d.sec, cards: a.cards + d.cards }), { sec: 0, cards: 0 });
    const docs = Object.entries(s.docs).map(([id, d]) => ({ id, ...d })).sort((a, b) => b.sec - a.sec).slice(0, 8);
    return { today: days[days.length - 1], week, streak, best: Math.max(best, streak), total, days, docs };
  }
  const fmt = sec => { const m = Math.round(sec / 60); return m < 60 ? `${m} Min.` : `${Math.floor(m / 60)} Std. ${m % 60 ? (m % 60) + ' Min.' : ''}`.trim(); };
  /* Balken der letzten n Tage, Minuten */
  function chart(n = 14) {
    const sm = summary(), ds = sm.days.slice(-n), max = Math.max(30, ...ds.map(d => d.sec / 60));
    const W = 520, H = 150, pad = 22, bw = (W - pad) / ds.length;
    const wd = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
    const bars = ds.map((d, i) => {
      const m = d.sec / 60, h = Math.max(m ? 2 : 0, (H - 30) * m / max), x = pad + i * bw + bw * 0.18, y = H - 18 - h;
      return `<g><title>${d.d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}: ${fmt(d.sec)}${d.cards ? `, ${d.cards} Karten` : ''}${d.pomo ? `, ${d.pomo} Pomodoro` : ''}</title><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${h.toFixed(1)}" rx="3" class="${active(d) ? 'on' : ''}"/><text x="${(x + bw * 0.32).toFixed(1)}" y="${H - 4}" text-anchor="middle">${i === ds.length - 1 ? 'heute' : wd[d.d.getDay()]}</text></g>`;
    }).join('');
    const gl = [0.5, 1].map(f => { const y = H - 18 - (H - 30) * f; return `<line x1="${pad}" x2="${W}" y1="${y}" y2="${y}"/><text x="${pad - 4}" y="${y + 3}" text-anchor="end">${Math.round(max * f)}</text>`; }).join('');
    return `<svg class="wbchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Lernzeit der letzten ${n} Tage in Minuten">${gl}${bars}</svg>`;
  }
  function html() {
    const s = summary();
    return `<div class="wbstats"><div class="wbtiles">
      <div><b>${fmt(s.today.sec)}</b><small>heute</small></div>
      <div><b>${fmt(s.week.sec)}</b><small>letzte 7 Tage</small></div>
      <div><b>${s.streak} ${s.streak === 1 ? 'Tag' : 'Tage'}</b><small>Serie${s.best > s.streak ? ` · Rekord ${s.best}` : ''}</small></div>
      <div><b>${s.week.cards}</b><small>Karten in 7 Tagen</small></div></div>
      ${chart(14)}<p class="note" style="margin:4px 0 0">Minuten pro Tag. Ein Tag zählt für die Serie ab 10 Minuten, 10 Karten oder einem Pomodoro.</p>
      ${s.docs.length ? `<div class="wbdocs">${s.docs.map(d => `<div><span>${(d.name || 'Dokument').replace(/[&<>]/g, '')}</span><b>${fmt(d.sec)}</b></div>`).join('')}</div>` : ''}</div>`;
  }
  const CSS = `.wbstats .wbtiles{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:2px 0 10px}.wbstats .wbtiles div{border:1px solid var(--line,#dde1e8);border-radius:10px;padding:8px 10px}.wbstats .wbtiles b{display:block;font-size:15px}.wbstats .wbtiles small{color:var(--muted,#5f6878);font-size:11.5px}
.wbchart{width:100%;max-width:620px;height:auto;display:block}.wbchart rect{fill:var(--line,#cfd5df)}.wbchart rect.on{fill:var(--accent,#1f4fd8)}.wbchart text{font:9.5px var(--f-ui,system-ui,sans-serif);fill:var(--muted,#5f6878)}.wbchart line{stroke:var(--line,#dde1e8);stroke-dasharray:3 3}
.wbdocs{margin-top:10px;display:grid;gap:4px}.wbdocs div{display:flex;justify-content:space-between;gap:10px;font-size:13px;border-bottom:1px dashed var(--line,#dde1e8);padding:3px 0}.wbdocs span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (max-width:520px){.wbstats .wbtiles{grid-template-columns:repeat(2,1fr)}}`;
  if (typeof document !== 'undefined') { const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); }
  global.WBStats = { tick, card, exam, pomo, summary, chart, html, fmt, dayKey };
})(window);
