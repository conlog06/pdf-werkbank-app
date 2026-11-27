/* PDF Werkbank – Rechnungsbuch: offene Posten, Zahlungserinnerungen, EÜR-Export (ab Version 2.0)
 * Jede mit dem Rechnungsassistenten erstellte Rechnung wird hier vermerkt (nur auf diesem Gerät, localStorage).
 *   WBLedger.add(inv) / list() / update(no, patch) / remove(no)
 *   WBLedger.status(inv)               'paid' | 'overdue' | 'open'
 *   WBLedger.reminderPdf(inv, level)   Zahlungserinnerung (1) oder Mahnung (2, 3) als PDF
 *   WBLedger.euer(year, expenses)      { rows, income, expense, profit, csv }
 */
(function (global) {
  'use strict';
  const KEY = 'pdfwb.ledger';
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* voll */ } };
  const load = () => { try { return JSON.parse(lsGet(KEY) || '[]'); } catch (e) { return []; } };
  const save = l => lsSet(KEY, JSON.stringify(l));
  const listeners = new Set();
  const emit = () => listeners.forEach(f => { try { f(); } catch (e) { /* egal */ } });
  const pDate = s => { const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(String(s || '')); if (m) return new Date(+m[3], +m[2] - 1, +m[1]); const d = new Date(s); return isNaN(d) ? null : d; };
  const de = d => (d ? new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
  const eur = n => (+n || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  const DAY = 86400000;
  function add(inv) {
    const l = load().filter(x => x.no !== inv.no);
    l.push({ paid: null, reminders: [], created: Date.now(), ...inv });
    save(l); emit();
  }
  function update(no, patch) { const l = load(); const i = l.findIndex(x => x.no === no); if (i < 0) return; l[i] = { ...l[i], ...patch }; save(l); emit(); }
  function remove(no) { save(load().filter(x => x.no !== no)); emit(); }
  const list = () => load().sort((a, b) => (pDate(b.date) || 0) - (pDate(a.date) || 0) || String(b.no).localeCompare(String(a.no)));
  function dueOf(inv) { if (inv.due) return new Date(inv.due); const d = pDate(inv.date); if (!d) return null; return new Date(+d + (+inv.terms || 14) * DAY); }
  function status(inv) {
    if (inv.paid) return 'paid';
    const d = dueOf(inv); if (d && Date.now() > +d + DAY - 1) return 'overdue';
    return 'open';
  }
  const LEVEL = { 1: 'Zahlungserinnerung', 2: '1. Mahnung', 3: '2. Mahnung' };
  async function reminderPdf(inv, level = 1, fee = 0) {
    const { PDFDocument, StandardFonts, rgb } = global.PDFLib;
    const P = (global.WBTemplates && global.WBTemplates.profile()) || {};
    const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica), b = await d.embedFont(StandardFonts.HelveticaBold);
    const W = 595.28, H = 841.89, L = 70, R = W - 60, ink = rgb(0.11, 0.13, 0.19), mute = rgb(0.42, 0.45, 0.52);
    const safe = s => Array.from(String(s == null ? '' : s)).map(ch => { if (ch === '\n') return ch; try { f.encodeText(ch); return ch; } catch (e) { return '?'; } }).join('');
    const pg = d.addPage([W, H]);
    const T = (s, x, y, size = 10.5, font = f, color = ink, align) => { const t = safe(s), w = font.widthOfTextAtSize(t, size); pg.drawText(t, { x: align === 'r' ? x - w : x, y, size, font, color }); };
    const wrap = (s, size, width) => { const out = []; for (const para of safe(s).split('\n')) { let ln = ''; for (const w of para.split(' ')) { const t = ln ? ln + ' ' + w : w; if (f.widthOfTextAtSize(t, size) <= width || !ln) ln = t; else { out.push(ln); ln = w; } } out.push(ln); } return out; };
    const sender = P.company || P.name || '';
    T(sender, R, H - 70, 13, b, ink, 'r');
    [P.company ? P.name : '', P.street, P.city, P.email, P.phone].filter(Boolean).forEach((t, i) => T(t, R, H - 86 - i * 12, 9, f, mute, 'r'));
    T([sender, P.street, P.city].filter(Boolean).join(' · '), L, H - 150, 7.5, f, mute);
    String(inv.to || inv.customer || '').split('\n').filter(Boolean).slice(0, 6).forEach((t, i) => T(t, L, H - 168 - i * 14, 11, i ? f : b));
    const today = new Date(), deadline = new Date(+today + (level === 1 ? 10 : 7) * DAY);
    T(de(today), R, H - 260, 10, f, ink, 'r');
    T(`${LEVEL[level]} zur Rechnung ${inv.no}`, L, H - 300, 15, b);
    const formal = inv.formal !== false;
    const due = dueOf(inv), total = (+inv.total || 0) + (+fee || 0);
    let intro = level === 1
      ? `${formal ? 'Sehr geehrte Damen und Herren' : 'Hallo ' + (String(inv.customer || '').split(/[\s,]/)[0] || '')},\n\nsicher ist es Ihrer Aufmerksamkeit entgangen: Für die Rechnung ${inv.no} vom ${de(pDate(inv.date))} über ${eur(inv.total)} ist bis heute kein Zahlungseingang zu verzeichnen. Sie war fällig am ${de(due)}.\n\nBitte überweisen Sie den Betrag bis zum ${de(deadline)}. Sollte sich Ihre Zahlung mit diesem Schreiben überschnitten haben, betrachten Sie es bitte als gegenstandslos.`
      : `${formal ? 'Sehr geehrte Damen und Herren' : 'Hallo'},\n\ntrotz ${level === 2 ? 'unserer Zahlungserinnerung' : 'unserer Erinnerung und 1. Mahnung'} ist die Rechnung ${inv.no} vom ${de(pDate(inv.date))} über ${eur(inv.total)} (fällig am ${de(due)}) weiterhin offen.\n\nBitte überweisen Sie den offenen Betrag${fee ? ' zuzüglich Mahngebühr' : ''} bis spätestens ${de(deadline)}.${level === 3 ? ' Nach Ablauf dieser Frist sehen wir uns gezwungen, weitere Schritte einzuleiten.' : ''}`;
    if (!formal) intro = intro.replace(/\b(Sie|Ihrer|Ihre|Ihr)\b/g, m => ({ Sie: 'du', Ihrer: 'deiner', Ihre: 'deine', Ihr: 'dein' }[m])).replace('Bitte überweisen du', 'Bitte überweise').replace('betrachten du es', 'betrachte es').replace('Sollte sich deine Zahlung', 'Sollte sich deine Zahlung');
    let y = H - 336;
    for (const ln of wrap(intro, 10.5, R - L)) { T(ln, L, y); y -= 15; }
    y -= 10;
    const rows = [['Rechnungsbetrag', eur(inv.total)], ...(fee ? [['Mahngebühr', eur(fee)]] : []), ['Offener Betrag', eur(total), 1]];
    for (const [k, v, s] of rows) { T(k, R - 220, y, s ? 11 : 10.5, s ? b : f); T(v, R, y, s ? 11 : 10.5, s ? b : f, ink, 'r'); y -= s ? 22 : 16; }
    y -= 8;
    const bank = [P.iban && `IBAN ${P.iban}`, P.bic && `BIC ${P.bic}`, P.bank].filter(Boolean).join(' · ');
    if (bank) { for (const ln of wrap(`Bankverbindung: ${bank}\nVerwendungszweck: ${inv.no}`, 10.5, R - L)) { T(ln, L, y); y -= 15; } y -= 10; }
    T('Mit freundlichen Grüßen', L, y); T(P.name || sender, L, y - 32);
    T([P.taxId && 'Steuernr. ' + P.taxId, P.vatId && 'USt-IdNr. ' + P.vatId].filter(Boolean).join(' · '), L, 40, 7.5, f, mute);
    d.setTitle(`${LEVEL[level]} ${inv.no}`); d.setAuthor(sender); d.setCreator('PDF Werkbank');
    return d.save();
  }
  /* Einnahmen-Überschuss-Rechnung: Zufluss/Abfluss im Kalenderjahr (Kleinunternehmer: Bruttobeträge) */
  function euer(year, expenses = []) {
    const rows = [];
    for (const inv of load()) { if (!inv.paid) continue; const d = new Date(inv.paid); if (d.getFullYear() !== year) continue; rows.push({ date: d, kind: 'Einnahme', no: inv.no, who: inv.customer || '', cat: 'Umsatzerlöse', amount: +inv.total || 0 }); }
    for (const e of expenses) { const d = pDate(e.date); if (!d || d.getFullYear() !== year || e.total == null) continue; rows.push({ date: d, kind: 'Ausgabe', no: e.no || '', who: e.merchant || '', cat: e.cat || 'Sonstiges', amount: -(+e.total || 0), doc: e.doc || '' }); }
    rows.sort((a, b) => a.date - b.date);
    const income = rows.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0), expense = -rows.filter(r => r.amount < 0).reduce((s, r) => s + r.amount, 0);
    const byCat = {}; rows.forEach(r => { if (r.amount < 0) byCat[r.cat] = (byCat[r.cat] || 0) - r.amount; });
    const f2 = n => (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');
    const q = s => (/[;"\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : s);
    const csv = '﻿' + [['Datum', 'Art', 'Beleg/Rechnung', 'Kunde/Händler', 'Kategorie', 'Betrag'], ...rows.map(r => [de(r.date), r.kind, r.no, r.who, r.cat, f2(r.amount)]), [], ['', '', '', '', 'Summe Einnahmen', f2(income)], ['', '', '', '', 'Summe Ausgaben', f2(-expense)], ['', '', '', '', 'Gewinn', f2(income - expense)]].map(r => r.map(q).join(';')).join('\r\n');
    return { rows, income, expense, profit: income - expense, byCat, csv };
  }
  global.WBLedger = { add, update, remove, list, status, dueOf, reminderPdf, euer, LEVEL, onChange: f => { listeners.add(f); return () => listeners.delete(f); }, fmt: { de, eur, pDate } };
})(window);
