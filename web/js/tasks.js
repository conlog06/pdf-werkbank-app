/* PDF Werkbank – Aufgaben aus Kommentaren und Notizen (ab Version 1.8)
 * Erkennt Aufgaben in Kommentaren, Notizen und eigenen Texten:
 *   „[ ] Folien wiederholen“, „[x] erledigt“, „TODO: …“, „Aufgabe: …“, „@todo …“
 *   und alles mit Frist: „bis Freitag“, „bis 24.11.“, „bis morgen“, „fällig 3.12.2026“, „in 3 Tagen“, „nächste Woche“
 * WBTasks.parse(text) → [{ line, text, due, done }]
 * WBTasks.fromState(state) → [{ pid, page, aid, line, text, due, done }]
 */
(function (global) {
  'use strict';
  const DAY = 864e5;
  const WD = { so: 0, sonntag: 0, mo: 1, montag: 1, di: 2, dienstag: 2, mi: 3, mittwoch: 3, do: 4, donnerstag: 4, fr: 5, freitag: 5, sa: 6, samstag: 6 };
  const startOf = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  /* Frist im Text finden; now = Bezugszeit (Erstellung des Kommentars oder jetzt) */
  function dueOf(text, now = Date.now()) {
    const t = ' ' + String(text).toLowerCase() + ' ', base = startOf(now);
    let m;
    if (/\bheute\b/.test(t)) return +base;
    if (/\b(bis\s+)?übermorgen\b/.test(t)) return +base + 2 * DAY;
    if (/\b(bis\s+)?morgen\b/.test(t) && !/morgens/.test(t)) return +base + DAY;
    if ((m = /\bin\s+(\d{1,3}|einem|einer|zwei|drei|vier|fünf)\s+(tag|tagen|woche|wochen)\b/.exec(t))) {
      const n = { einem: 1, einer: 1, zwei: 2, drei: 3, vier: 4, fünf: 5 }[m[1]] || +m[1];
      return +base + n * (m[2].startsWith('woche') ? 7 : 1) * DAY;
    }
    if (/\b(bis\s+)?(nächste|kommende)\s+woche\b/.test(t)) { const d = new Date(base); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); return +d; }
    if (/\b(bis\s+)?(ende der woche|wochenende)\b/.test(t)) { const d = new Date(base); d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7)); return +d; }
    if ((m = /\b(\d{1,2})\.\s?(\d{1,2})\.(\s?(\d{4}|\d{2}))?(?!\d)/.exec(t)) && /\b(bis|fällig|frist|abgabe|deadline|am|zum|spätestens|termin)\b|^\s*\[|todo|aufgabe/.test(t)) {
      const dd = +m[1], mm = +m[2] - 1;
      let yy = m[4] ? +m[4] : new Date(base).getFullYear(); if (yy < 100) yy += 2000;
      const d = new Date(yy, mm, dd);
      if (d.getMonth() !== mm) return null;
      if (!m[4] && +d < +base - 60 * DAY) d.setFullYear(yy + 1); // „bis 10.1.“ im Dezember = nächstes Jahr
      return +d;
    }
    if ((m = /\b(bis|am|zum|fällig|spätestens)\s+(nächsten\s+)?(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|mo|di|mi|do|fr|sa|so)\b\.?/.exec(t))) {
      const want = WD[m[3]], d = new Date(base);
      let add = (want - d.getDay() + 7) % 7; if (add === 0 || m[2]) add += add === 0 ? 7 : 0;
      d.setDate(d.getDate() + add); return +d;
    }
    return null;
  }
  const TASK_RX = /^\s*(?:[-•*]\s*)?(\[( |x|X|✓)?\]|☐|☑|✅|todo\b:?|to-?do\b:?|aufgabe\b:?|@todo\b:?)/i;
  function parse(text, now) {
    const out = [];
    String(text || '').split('\n').forEach((ln, i) => {
      const s = ln.trim(); if (!s) return;
      const m = TASK_RX.exec(s), due = dueOf(s, now);
      if (!m && due == null) return;
      // bei Frist ohne Kennzeichen: nur wenn „bis/fällig/Abgabe …“ wirklich vorkommt
      if (!m && !/\b(bis|fällig|frist|abgabe|deadline|spätestens|erledigen|zu tun)\b/i.test(s)) return;
      const done = !!m && /\[(x|X|✓)\]|☑|✅/.test(m[1]);
      const clean = s.replace(TASK_RX, '').replace(/^[:\s-]+/, '').trim() || s;
      out.push({ line: i, text: clean, due, done });
    });
    return out;
  }
  /* Text eines Elements, in dem Aufgaben stehen können */
  const textOf = a => [a.t === 'note' ? a.text : '', a.comment || '', a.t === 'text' && !a.pn && !a.hf ? a.text : ''].filter(Boolean).join('\n');
  function fromState(state) {
    const out = [];
    if (!state || !state.pages) return out;
    state.pages.forEach((p, i) => {
      for (const a of p.annots || []) {
        const src = a.t === 'note' ? 'note' : a.comment ? 'comment' : a.t === 'text' ? 'text' : null;
        if (!src) continue;
        const full = a.t === 'note' ? a.text || '' : a.comment || (a.t === 'text' ? a.text || '' : '');
        for (const t of parse(full, a.ts || Date.now())) out.push({ pid: p.id, page: i + 1, aid: a.id, src, ...t, done: t.done || !!(a.tdone && a.tdone[t.line]) });
      }
    });
    return out;
  }
  /* Häkchen setzen: „[ ]“ wird zu „[x]“, sonst wird es am Element gemerkt */
  function toggle(a, line, done) {
    const key = a.t === 'note' ? 'text' : a.comment ? 'comment' : 'text';
    const lines = String(a[key] || '').split('\n');
    const ln = lines[line] || '';
    if (/\[( |x|X|✓)?\]/.test(ln)) { lines[line] = ln.replace(/\[( |x|X|✓)?\]/, done ? '[x]' : '[ ]'); a[key] = lines.join('\n'); }
    else if (/☐|☑/.test(ln)) { lines[line] = ln.replace(/☐|☑/, done ? '☑' : '☐'); a[key] = lines.join('\n'); }
    else { a.tdone = { ...(a.tdone || {}) }; if (done) a.tdone[line] = true; else delete a.tdone[line]; }
  }
  const fmtDue = (due, now = Date.now()) => {
    if (due == null) return '';
    const d = Math.round((due - +startOf(now)) / DAY);
    if (d < -1) return `seit ${-d} Tagen fällig`;
    if (d === -1) return 'seit gestern fällig';
    if (d === 0) return 'heute';
    if (d === 1) return 'morgen';
    if (d < 7) return new Date(due).toLocaleDateString('de-DE', { weekday: 'long' });
    return new Date(due).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', ...(new Date(due).getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}) });
  };
  const urgency = (due, now = Date.now()) => due == null ? 'none' : due < +startOf(now) ? 'late' : due < +startOf(now) + DAY ? 'today' : due < +startOf(now) + 3 * DAY ? 'soon' : 'later';
  /* Kalenderdatei (.ics) mit ganztägigen Terminen */
  function ics(tasks, title = 'PDF Werkbank') {
    const pad = n => String(n).padStart(2, '0'), d8 = t => { const d = new Date(t); return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()); };
    const escI = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const fold = l => { const out = []; let s = l; while (s.length > 72) { out.push(s.slice(0, 72)); s = ' ' + s.slice(72); } out.push(s); return out.join('\r\n'); };
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PDF Werkbank//DE', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:' + escI(title)];
    for (const t of tasks) {
      if (t.due == null) continue;
      lines.push('BEGIN:VEVENT', 'UID:' + (t.aid || 'x') + '-' + t.line + '-' + d8(t.due) + '@pdf-werkbank', 'DTSTAMP:' + stamp,
        'DTSTART;VALUE=DATE:' + d8(t.due), 'DTEND;VALUE=DATE:' + d8(t.due + DAY), fold('SUMMARY:' + escI(t.text)),
        fold('DESCRIPTION:' + escI((t.doc ? t.doc + ', ' : '') + 'Seite ' + t.page)), 'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + escI(t.text), 'TRIGGER:-PT15H', 'END:VALARM', 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/calendar' });
  }
  /* Erinnerung (einmal pro Tag), solange die Werkbank offen ist */
  async function remind(tasks, onClick) {
    const now = Date.now(), open = tasks.filter(t => !t.done && t.due != null && t.due < +startOf(now) + DAY);
    if (!open.length || !('Notification' in global) || Notification.permission !== 'granted') return false;
    const key = 'pdfwb.tasks.reminded', today = new Date().toDateString();
    try { if (localStorage.getItem(key) === today) return false; localStorage.setItem(key, today); } catch (e) { /* egal */ }
    const late = open.filter(t => t.due < +startOf(now)).length;
    const n = new Notification(open.length === 1 ? 'Aufgabe fällig' : `${open.length} Aufgaben fällig`, { body: open.slice(0, 3).map(t => '• ' + t.text).join('\n') + (late ? `\n(${late} überfällig)` : ''), tag: 'pdfwb-tasks' });
    n.onclick = () => { global.focus(); if (onClick) onClick(); n.close(); };
    return true;
  }
  global.WBTasks = { parse, fromState, toggle, dueOf, fmtDue, urgency, ics, remind, textOf };
})(window);
