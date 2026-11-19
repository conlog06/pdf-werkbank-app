/* PDF Werkbank – Vorlagen (ab Version 1.8)
 * Rechnung und Angebot mit Assistent (eigene Daten werden gemerkt, Nummern zählen hoch, Kleinunternehmer nach § 19 UStG),
 * dazu Cornell-Notizen, Wochenplaner, Stundenplan, Lernplan, To-do-Liste und Besprechungsprotokoll.
 * WBTemplates.pick() → Promise<{ name, bytes } | null>
 */
(function (global) {
  'use strict';
  const PL = () => global.PDFLib;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* egal */ } };
  const A4 = [595.28, 841.89], MM = 72 / 25.4;
  const eur = n => (Math.round(n * 100) / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  const num = v => { const s = String(v == null ? '' : v).trim().replace(/\s|€/g, ''); if (!s) return 0; const n = parseFloat(/,/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s); return isFinite(n) ? n : 0; };
  const today = () => new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const PROFILE_KEYS = [['name', 'Name'], ['company', 'Firma (optional)'], ['street', 'Straße und Nr.'], ['city', 'PLZ und Ort'], ['email', 'E-Mail'], ['phone', 'Telefon'], ['web', 'Webseite'], ['taxId', 'Steuernummer'], ['iban', 'IBAN'], ['bic', 'BIC'], ['bank', 'Bank']];
  const profile = () => Object.assign({ kleinunternehmer: true, vat: 19, terms: 14 }, JSON.parse(lsGet('pdfwb.profile') || '{}'));
  const saveProfile = p => lsSet('pdfwb.profile', JSON.stringify(p));
  function nextNo(kind) {
    const y = new Date().getFullYear(), key = `pdfwb.no.${kind}.${y}`, n = (+lsGet(key) || 0) + 1;
    return { no: `${kind === 'invoice' ? 'RE' : 'AN'}-${y}-${String(n).padStart(3, '0')}`, commit: () => lsSet(key, String(n)) };
  }

  /* ---------- Zeichenhilfen ---------- */
  async function doc() {
    const { PDFDocument, StandardFonts } = PL();
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica), b = await d.embedFont(StandardFonts.HelveticaBold);
    d.setCreator('PDF Werkbank'); d.setProducer('PDF Werkbank');
    return { d, f, b };
  }
  const safe = (font, s) => Array.from(String(s == null ? '' : s)).map(ch => { try { font.encodeText(ch); return ch; } catch (e) { return ch === '\t' ? ' ' : '?'; } }).join('');
  function wrap(font, text, size, width) {
    const out = [];
    for (const para of safe(font, text).split('\n')) {
      let line = '';
      for (const w of para.split(/\s+/)) {
        const t = line ? line + ' ' + w : w;
        if (font.widthOfTextAtSize(t, size) <= width || !line) line = t; else { out.push(line); line = w; }
      }
      out.push(line);
    }
    return out;
  }
  const G = () => { const { rgb } = PL(); return { ink: rgb(0.11, 0.13, 0.19), mute: rgb(0.42, 0.45, 0.52), line: rgb(0.78, 0.8, 0.84), soft: rgb(0.95, 0.96, 0.98), acc: rgb(0.12, 0.31, 0.85) }; };
  const T = (pg, s, x, y, size, font, color, opts = {}) => {
    const t = safe(font, s);
    const w = font.widthOfTextAtSize(t, size);
    pg.drawText(t, { x: opts.align === 'right' ? x - w : opts.align === 'center' ? x - w / 2 : x, y, size, font, color });
    return w;
  };
  const L = (pg, x1, y1, x2, y2, color, w = 0.6, dash) => pg.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: w, color, ...(dash ? { dashArray: dash } : {}) });

  /* ---------- Rechnung und Angebot ---------- */
  async function invoicePdf(kind, data) {
    const { d, f, b } = await doc(), C = G(), [W, H] = A4, P = data.profile;
    const left = 25 * MM, right = W - 20 * MM, width = right - left;
    const title = kind === 'invoice' ? 'Rechnung' : 'Angebot';
    let pg, y;
    const sender = [P.company, P.name].filter(Boolean)[0] || '';
    const footer = page => {
      const fy = 18 * MM, cols = [
        [P.company || P.name, P.street, P.city].filter(Boolean),
        [P.phone && 'Tel. ' + P.phone, P.email, P.web].filter(Boolean),
        [P.bank, P.iban && 'IBAN ' + P.iban, P.bic && 'BIC ' + P.bic].filter(Boolean),
        [P.taxId && 'Steuernr. ' + P.taxId, P.vatId && 'USt-IdNr. ' + P.vatId].filter(Boolean),
      ].filter(c => c.length);
      L(page, left, fy + 30, right, fy + 30, C.line, 0.5);
      cols.forEach((c, i) => c.forEach((t, k) => T(page, t, left + i * width / cols.length, fy + 20 - k * 9, 7, f, C.mute)));
    };
    const newPage = first => {
      pg = d.addPage(A4); footer(pg);
      y = H - 20 * MM;
      // Kopf rechts: Absender
      T(pg, sender, right, y, 14, b, C.ink, { align: 'right' });
      [P.company && P.name, P.street, P.city, P.email, P.phone].filter(Boolean).forEach((t, i) => T(pg, t, right, y - 16 - i * 11, 9, f, C.mute, { align: 'right' }));
      if (!first) { y = H - 60 * MM; T(pg, `${title} ${data.no} – Fortsetzung`, left, y, 10, b, C.ink); y -= 24; }
    };
    newPage(true);
    // Anschriftfeld (DIN 5008, Fensterumschlag)
    const ay = H - 50 * MM;
    T(pg, [sender, P.street, P.city].filter(Boolean).join(' · '), left, ay, 7, f, C.mute);
    L(pg, left, ay - 3, left + 85 * MM, ay - 3, C.line, 0.4);
    wrap(f, data.to || '', 11, 85 * MM).slice(0, 7).forEach((t, i) => T(pg, t, left, ay - 18 - i * 14, 11, f, C.ink));
    // Infoblock rechts
    const info = [[kind === 'invoice' ? 'Rechnungsnummer' : 'Angebotsnummer', data.no], ['Datum', data.date], ...(data.service ? [[kind === 'invoice' ? 'Leistungsdatum' : 'Gültig bis', data.service]] : []), ...(data.customerNo ? [['Kundennummer', data.customerNo]] : [])];
    info.forEach(([k, v], i) => { T(pg, k, right - 62 * MM, ay - 18 - i * 14, 9, f, C.mute); T(pg, v, right, ay - 18 - i * 14, 9, b, C.ink, { align: 'right' }); });
    y = H - 103 * MM;
    T(pg, `${title} ${data.no}`, left, y, 17, b, C.ink); y -= 26;
    if (data.intro) { for (const ln of wrap(f, data.intro, 10, width)) { T(pg, ln, left, y, 10, f, C.ink); y -= 14; } y -= 8; }
    // Tabelle
    const cx = { pos: left, desc: left + 12 * MM, qty: right - 70 * MM, price: right - 30 * MM, sum: right };
    const head = () => {
      pg.drawRectangle({ x: left - 4, y: y - 5, width: width + 8, height: 18, color: C.soft });
      T(pg, 'Pos.', cx.pos, y, 8.5, b, C.mute); T(pg, 'Beschreibung', cx.desc, y, 8.5, b, C.mute);
      T(pg, 'Menge', cx.qty, y, 8.5, b, C.mute, { align: 'right' }); T(pg, 'Einzelpreis', cx.price, y, 8.5, b, C.mute, { align: 'right' }); T(pg, 'Gesamt', cx.sum, y, 8.5, b, C.mute, { align: 'right' });
      y -= 20;
    };
    head();
    let net = 0;
    data.items.forEach((it, i) => {
      const q = num(it.qty) || 0, pr = num(it.price), sum = q * pr; net += sum;
      const lines = wrap(f, it.desc || '', 10, cx.qty - cx.desc - 30 * MM + 14 * MM);
      const h = lines.length * 13 + 6;
      if (y - h < 45 * MM) { newPage(false); head(); }
      T(pg, String(i + 1), cx.pos, y, 10, f, C.ink);
      lines.forEach((ln, k) => T(pg, ln, cx.desc, y - k * 13, 10, f, C.ink));
      T(pg, (q % 1 ? q.toLocaleString('de-DE') : String(q)) + (it.unit ? ' ' + it.unit : ''), cx.qty, y, 10, f, C.ink, { align: 'right' });
      T(pg, eur(pr), cx.price, y, 10, f, C.ink, { align: 'right' }); T(pg, eur(sum), cx.sum, y, 10, f, C.ink, { align: 'right' });
      y -= h; L(pg, left, y + 8, right, y + 8, C.line, 0.4);
    });
    // Summen
    if (y < 75 * MM) { newPage(false); }
    y -= 8;
    const vat = P.kleinunternehmer ? 0 : (+P.vat || 19);
    const rows = P.kleinunternehmer ? [['Gesamtbetrag', eur(net), true]] : [['Nettobetrag', eur(net)], [`zzgl. ${vat} % USt.`, eur(net * vat / 100)], ['Gesamtbetrag', eur(net * (1 + vat / 100)), true]];
    for (const [k, v, strong] of rows) {
      if (strong) { L(pg, right - 75 * MM, y + 12, right, y + 12, C.ink, 0.8); }
      T(pg, k, right - 75 * MM, y, strong ? 11 : 10, strong ? b : f, C.ink); T(pg, v, right, y, strong ? 11 : 10, strong ? b : f, C.ink, { align: 'right' }); y -= strong ? 22 : 15;
    }
    y -= 6;
    const notes = [];
    if (P.kleinunternehmer) notes.push('Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.');
    if (kind === 'invoice') notes.push(`Bitte überweise${data.formal ? 'n Sie' : ''} den Betrag ${data.terms > 0 ? `innerhalb von ${data.terms} Tagen` : 'sofort'} ohne Abzug${P.iban ? ` auf das Konto IBAN ${P.iban}` : ''}, Verwendungszweck: ${data.no}.`);
    else notes.push(data.service ? `Dieses Angebot ist gültig bis ${data.service}.` : 'Dieses Angebot ist 30 Tage gültig.');
    if (data.note) notes.push(data.note);
    notes.push(data.formal ? 'Vielen Dank für Ihren Auftrag!' : 'Vielen Dank!');
    for (const n of notes) for (const ln of wrap(f, n, 10, width)) { if (y < 35 * MM) newPage(false); T(pg, ln, left, y, 10, f, C.ink); y -= 14; }
    d.setTitle(`${title} ${data.no}`); d.setAuthor(sender);
    return { bytes: await d.save(), name: `${title} ${data.no}${data.toName ? ' ' + data.toName : ''}`, total: P.kleinunternehmer ? net : net * (1 + vat / 100) };
  }

  /* ---------- Lern- und Planungsvorlagen ---------- */
  const DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
  function weekOf(date = new Date()) { const d = new Date(date); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; }
  const BUILD = {
    async cornell(o) {
      const { d, f, b } = await doc(), C = G(), [W, H] = A4, m = 14 * MM;
      for (let n = 0; n < (o.pages || 1); n++) {
        const pg = d.addPage(A4);
        T(pg, 'Thema', m, H - m - 4, 8, b, C.mute); L(pg, m + 34, H - m - 6, W * 0.62, H - m - 6, C.line);
        T(pg, 'Datum', W * 0.66, H - m - 4, 8, b, C.mute); L(pg, W * 0.66 + 34, H - m - 6, W - m, H - m - 6, C.line);
        const top = H - m - 22, bottom = 52 * MM, cue = m + 58 * MM;
        L(pg, m, top, W - m, top, C.ink, 1); L(pg, cue, top, cue, bottom, C.ink, 1); L(pg, m, bottom, W - m, bottom, C.ink, 1);
        T(pg, 'Stichworte und Fragen', m + 4, top - 12, 7.5, b, C.mute); T(pg, 'Notizen', cue + 6, top - 12, 7.5, b, C.mute); T(pg, 'Zusammenfassung', m + 4, bottom - 12, 7.5, b, C.mute);
        for (let yy = top - 24; yy > bottom + 4; yy -= 8 * MM) L(pg, cue + 6, yy, W - m, yy, C.line, 0.35);
        for (let yy = bottom - 24; yy > m; yy -= 8 * MM) L(pg, m, yy, W - m, yy, C.line, 0.35);
      }
      return { bytes: await d.save(), name: 'Cornell-Notizen' };
    },
    async week(o) {
      const { d, f, b } = await doc(), C = G(), W = A4[1], H = A4[0], m = 12 * MM;
      const start = weekOf(o.date ? new Date(o.date) : new Date());
      for (let n = 0; n < (o.pages || 1); n++) {
        const pg = d.addPage([W, H]), s = new Date(start); s.setDate(s.getDate() + n * 7);
        const e = new Date(s); e.setDate(e.getDate() + 6);
        const kw = Math.ceil(((s - new Date(s.getFullYear(), 0, 4)) / 864e5 + ((new Date(s.getFullYear(), 0, 4).getDay() + 6) % 7) + 1) / 7);
        T(pg, `Woche ${kw}`, m, H - m - 14, 18, b, C.ink);
        T(pg, `${s.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })} – ${e.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })}`, m + 110, H - m - 13, 11, f, C.mute);
        const top = H - m - 32, cw = (W - 2 * m) / 4, ch = (top - m) / 2;
        for (let i = 0; i < 8; i++) {
          const cxx = m + (i % 4) * cw, cyy = top - Math.floor(i / 4) * ch;
          pg.drawRectangle({ x: cxx + 3, y: cyy - ch + 3, width: cw - 6, height: ch - 6, borderColor: C.line, borderWidth: 0.7 });
          if (i < 7) { const dd = new Date(s); dd.setDate(dd.getDate() + i); T(pg, DAYS[i], cxx + 10, cyy - 18, 11, b, i > 4 ? C.mute : C.ink); T(pg, dd.toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' }), cxx + cw - 10, cyy - 18, 9, f, C.mute, { align: 'right' }); }
          else T(pg, 'Notizen und Ziele', cxx + 10, cyy - 18, 11, b, C.acc);
          for (let yy = cyy - 34; yy > cyy - ch + 12; yy -= 7 * MM) L(pg, cxx + 10, yy, cxx + cw - 10, yy, C.line, 0.3);
        }
      }
      return { bytes: await d.save(), name: 'Wochenplaner' };
    },
    async timetable(o) {
      const { d, f, b } = await doc(), C = G(), W = A4[1], H = A4[0], m = 14 * MM;
      const pg = d.addPage([W, H]);
      T(pg, o.title || 'Stundenplan', m, H - m - 16, 18, b, C.ink);
      const slots = ['08:00 – 09:30', '09:45 – 11:15', '11:30 – 13:00', '14:00 – 15:30', '15:45 – 17:15', '17:30 – 19:00'];
      const top = H - m - 40, tw = 30 * MM, cw = (W - 2 * m - tw) / 5, rh = (top - m) / (slots.length + 0.6);
      DAYS.slice(0, 5).forEach((dname, i) => { pg.drawRectangle({ x: m + tw + i * cw, y: top - rh * 0.6, width: cw, height: rh * 0.6, color: C.soft, borderColor: C.line, borderWidth: 0.6 }); T(pg, dname, m + tw + i * cw + cw / 2, top - rh * 0.4, 10, b, C.ink, { align: 'center' }); });
      slots.forEach((s, r) => {
        const yy = top - rh * 0.6 - (r + 1) * rh;
        pg.drawRectangle({ x: m, y: yy, width: tw, height: rh, color: C.soft, borderColor: C.line, borderWidth: 0.6 });
        T(pg, s, m + tw / 2, yy + rh / 2 - 3, 8.5, f, C.ink, { align: 'center' });
        for (let i = 0; i < 5; i++) pg.drawRectangle({ x: m + tw + i * cw, y: yy, width: cw, height: rh, borderColor: C.line, borderWidth: 0.6 });
      });
      return { bytes: await d.save(), name: o.title || 'Stundenplan' };
    },
    async study(o) {
      const { d, f, b } = await doc(), C = G(), [W, H] = A4, m = 18 * MM;
      const pg = d.addPage(A4);
      T(pg, 'Lernplan', m, H - m - 10, 20, b, C.ink);
      [['Fach / Modul', 0], ['Prüfung am', W * 0.55]].forEach(([k, x]) => { T(pg, k, m + x, H - m - 40, 8, b, C.mute); L(pg, m + x, H - m - 56, x ? W - m : W * 0.5, H - m - 56, C.line); });
      let y = H - m - 86;
      T(pg, 'Thema', m + 22, y, 8.5, b, C.mute); ['Gelesen', 'Geübt', 'Sicher'].forEach((k, i) => T(pg, k, W - m - 120 + i * 45, y, 8.5, b, C.mute, { align: 'center' })); T(pg, 'Datum', W - m, y, 8.5, b, C.mute, { align: 'right' });
      y -= 10; L(pg, m, y, W - m, y, C.ink, 0.8);
      for (let i = 0; i < 22; i++) {
        y -= 26;
        T(pg, String(i + 1), m, y + 8, 9, f, C.mute);
        L(pg, m + 22, y + 4, W - m - 150, y + 4, C.line, 0.4);
        for (let k = 0; k < 3; k++) pg.drawRectangle({ x: W - m - 126 + k * 45, y: y + 2, width: 11, height: 11, borderColor: C.mute, borderWidth: 0.7 });
        L(pg, W - m - 22, y + 4, W - m, y + 4, C.line, 0.4);
      }
      return { bytes: await d.save(), name: 'Lernplan' };
    },
    async todo(o) {
      const { d, f, b } = await doc(), C = G(), [W, H] = A4, m = 18 * MM;
      for (let n = 0; n < (o.pages || 1); n++) {
        const pg = d.addPage(A4);
        T(pg, 'To-do', m, H - m - 10, 22, b, C.ink); T(pg, today(), W - m, H - m - 8, 10, f, C.mute, { align: 'right' });
        let y = H - m - 50;
        for (let i = 0; i < 24; i++) { pg.drawRectangle({ x: m, y: y - 2, width: 11, height: 11, borderColor: C.mute, borderWidth: 0.8 }); L(pg, m + 20, y - 2, W - m, y - 2, C.line, 0.4); y -= 28; }
      }
      return { bytes: await d.save(), name: 'To-do-Liste' };
    },
    async meeting(o) {
      const { d, f, b } = await doc(), C = G(), [W, H] = A4, m = 18 * MM;
      const pg = d.addPage(A4);
      T(pg, 'Besprechungsprotokoll', m, H - m - 10, 20, b, C.ink);
      let y = H - m - 44;
      for (const k of ['Thema', 'Datum und Ort', 'Teilnehmende', 'Protokoll']) { T(pg, k, m, y, 8, b, C.mute); L(pg, m + 80, y - 2, W - m, y - 2, C.line); y -= 22; }
      y -= 10;
      for (const [k, n] of [['Tagesordnung', 5], ['Ergebnisse und Beschlüsse', 8]]) {
        T(pg, k, m, y, 11, b, C.acc); y -= 18;
        for (let i = 0; i < n; i++) { L(pg, m, y, W - m, y, C.line, 0.35); y -= 20; }
        y -= 10;
      }
      T(pg, 'Aufgaben', m, y, 11, b, C.acc); y -= 16;
      [['Was', m], ['Wer', W - m - 190], ['Bis wann', W - m - 90]].forEach(([k, x]) => T(pg, k, x, y, 8, b, C.mute)); y -= 8; L(pg, m, y, W - m, y, C.ink, 0.7);
      while (y > m + 20) { y -= 22; L(pg, m, y, W - m, y, C.line, 0.35); L(pg, W - m - 196, y, W - m - 196, y + 22, C.line, 0.35); L(pg, W - m - 96, y, W - m - 96, y + 22, C.line, 0.35); }
      return { bytes: await d.save(), name: 'Besprechungsprotokoll' };
    },
  };
  const LIST = [
    ['invoice', 'Rechnung', 'Mit Positionen, Summen und Bankdaten. Nummern zählen hoch.', 'Büro'],
    ['offer', 'Angebot', 'Wie die Rechnung, mit Gültigkeitsdatum.', 'Büro'],
    ['meeting', 'Besprechungsprotokoll', 'Tagesordnung, Beschlüsse, Aufgaben mit Fristen.', 'Büro'],
    ['cornell', 'Cornell-Notizen', 'Stichworte links, Notizen rechts, Zusammenfassung unten.', 'Lernen'],
    ['study', 'Lernplan', 'Themen mit Kästchen für gelesen, geübt, sicher.', 'Lernen'],
    ['timetable', 'Stundenplan', 'Montag bis Freitag, sechs Blöcke (Querformat).', 'Lernen'],
    ['week', 'Wochenplaner', 'Sieben Tage plus Notizen, mit Datum (Querformat).', 'Planen'],
    ['todo', 'To-do-Liste', '24 Kästchen zum Abhaken.', 'Planen'],
  ];
  const ICON = {
    invoice: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3"/>', offer: '<path d="M6 3h9l3 3v15H6zM9 9h6M9 13h6M9 17h4"/>', meeting: '<path d="M4 5h16v11H8l-4 4zM8 9h8M8 12h5"/>',
    cornell: '<path d="M4 3h16v18H4zM9 3v13M4 16h16"/>', study: '<path d="M4 6l8-3 8 3-8 3zM7 8v5c0 1.5 2.2 3 5 3s5-1.5 5-3V8M20 6v6"/>', timetable: '<path d="M3 5h18v15H3zM3 9h18M8 5v15M13 5v15"/>',
    week: '<path d="M4 5h16v15H4zM4 9h16M8 3v4M16 3v4M8 13h3M13 13h3M8 16h3"/>', todo: '<path d="M4 5h4v4H4zM4 14h4v4H4zM11 7h9M11 16h9M5 6.5l1 1 2-2"/>',
  };

  /* ---------- Oberfläche ---------- */
  let cssDone = false;
  function css() {
    if (cssDone) return; cssDone = true;
    const s = document.createElement('style');
    s.textContent = `.wbt-back{position:fixed;inset:0;z-index:300;background:rgb(10 14 22/.42);display:grid;place-items:center;padding:16px}
.wbt{width:min(760px,100%);max-height:min(90vh,820px);display:flex;flex-direction:column;background:var(--raise,#fff);color:var(--ink,#1b2130);border:1px solid var(--line,#dde1e8);border-radius:16px;box-shadow:0 24px 70px rgb(0 0 0/.3);overflow:hidden;font:14px/1.4 var(--f-ui,var(--f-sans,system-ui,sans-serif))}
.wbt header{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line,#dde1e8)}
.wbt header h3{margin:0;font-size:17px;flex:1}
.wbt .x{border:0;background:transparent;font-size:22px;cursor:pointer;color:var(--muted,#5f6878);border-radius:8px;padding:2px 8px}
.wbt main{overflow:auto;padding:14px 18px 18px}
.wbt h4{margin:12px 0 8px;font:600 10.5px/1 var(--f-mono,monospace);letter-spacing:.07em;text-transform:uppercase;color:var(--muted,#5f6878)}
.wbt .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}
.wbt .card{display:flex;gap:12px;align-items:flex-start;text-align:left;border:1px solid var(--line,#dde1e8);background:var(--raise,#fff);color:inherit;border-radius:12px;padding:12px;cursor:pointer;font:inherit}
.wbt .card:hover,.wbt .card:focus-visible{border-color:var(--accent,#1f4fd8);background:var(--accent-soft,#e5ebfc);outline:none}
.wbt .card svg{flex:none;width:34px;height:34px;padding:7px;border-radius:9px;background:var(--accent-soft,#e5ebfc);color:var(--accent,#1f4fd8);fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.wbt .card b{display:block}.wbt .card small{display:block;color:var(--muted,#5f6878);font-size:12px;margin-top:2px}
.wbt label.f{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--muted,#5f6878);min-width:0}
.wbt input,.wbt textarea,.wbt select{font:inherit;color:var(--ink,#1b2130);background:var(--raise,#fff);border:1px solid var(--line,#dde1e8);border-radius:8px;padding:7px 9px;min-width:0;width:100%;box-sizing:border-box}
.wbt textarea{resize:vertical}
.wbt .row{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:10px}
.wbt table{width:100%;border-collapse:collapse;margin:6px 0}
.wbt td{padding:3px 3px;vertical-align:top}.wbt td:nth-child(2),.wbt td:nth-child(3){width:80px}.wbt td:nth-child(4){width:110px}.wbt td:last-child{width:34px}
.wbt .tot{display:flex;justify-content:flex-end;gap:16px;font-weight:600;margin:6px 0 2px}
.wbt details{border:1px solid var(--line,#dde1e8);border-radius:10px;padding:8px 12px;margin:10px 0}
.wbt summary{cursor:pointer;font-weight:600}
.wbt .acts{display:flex;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:1px solid var(--line,#dde1e8)}
.wbt .b{border:1px solid var(--line,#dde1e8);background:var(--raise,#fff);color:inherit;border-radius:10px;padding:9px 14px;cursor:pointer;font:inherit;font-weight:500}
.wbt .b.p{background:var(--accent,#1f4fd8);border-color:var(--accent,#1f4fd8);color:var(--accent-ink,#fff)}
.wbt .ib{border:0;background:transparent;color:var(--muted,#5f6878);cursor:pointer;font-size:18px;padding:4px 8px;border-radius:6px}
.wbt .chk{display:flex;gap:8px;align-items:center;font-size:13px;color:inherit}.wbt .chk input{width:auto}
.wbt .err{color:var(--danger,#c4352b);margin:6px 0 0;font-size:13px}`;
    document.head.appendChild(s);
  }
  function modal(title, inner, foot) {
    css();
    const back = document.createElement('div'); back.className = 'wbt-back';
    back.innerHTML = `<div class="wbt" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><h3>${esc(title)}</h3><button class="x" data-x="close" aria-label="Schließen">×</button></header><main>${inner}</main>${foot ? `<div class="acts">${foot}</div>` : ''}</div>`;
    document.body.appendChild(back);
    return back;
  }
  function pick() {
    return new Promise(resolve => {
      const groups = [...new Set(LIST.map(l => l[3]))];
      const back = modal('Neu aus Vorlage', groups.map(g => `<h4>${g}</h4><div class="grid">${LIST.filter(l => l[3] === g).map(([k, n, d]) => `<button class="card" data-t="${k}"><svg viewBox="0 0 24 24">${ICON[k]}</svg><span><b>${n}</b><small>${d}</small></span></button>`).join('')}</div>`).join(''));
      const done = v => { back.remove(); document.removeEventListener('keydown', key, true); resolve(v); };
      const key = e => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
      document.addEventListener('keydown', key, true);
      back.addEventListener('click', async e => {
        if (e.target === back || e.target.closest('[data-x=close]')) { done(null); return; }
        const c = e.target.closest('[data-t]'); if (!c) return;
        const k = c.dataset.t;
        back.remove(); document.removeEventListener('keydown', key, true);
        if (k === 'invoice' || k === 'offer') { resolve(await assistant(k)); return; }
        try { resolve(await BUILD[k]({})); } catch (er) { alert(er.message || er); resolve(null); }
      });
    });
  }
  /* Assistent für Rechnung und Angebot */
  function assistant(kind) {
    return new Promise(resolve => {
      const P = profile(), N = nextNo(kind), inv = kind === 'invoice';
      const missing = !P.name && !P.company;
      const prof = `<details ${missing ? 'open' : ''}><summary>Meine Daten${missing ? ' (einmal eintragen, wird gemerkt)' : ': ' + esc(P.company || P.name)}</summary><div class="row" style="margin-top:10px">${PROFILE_KEYS.map(([k, l]) => `<label class="f">${l}<input data-p="${k}" value="${esc(P[k] || '')}"></label>`).join('')}</div>
        <label class="chk"><input type="checkbox" data-p="kleinunternehmer" ${P.kleinunternehmer ? 'checked' : ''}> Kleinunternehmer nach § 19 UStG (keine Umsatzsteuer)</label>
        <div class="row" style="margin-top:8px"><label class="f">Umsatzsteuer %<input data-p="vat" value="${esc(P.vat)}" inputmode="decimal"></label><label class="f">USt-IdNr. (optional)<input data-p="vatId" value="${esc(P.vatId || '')}"></label></div></details>`;
      const item = (it = {}) => `<tr><td><textarea rows="1" data-i="desc" placeholder="Leistung, z. B. Webseite erstellen">${esc(it.desc || '')}</textarea></td><td><input data-i="qty" value="${esc(it.qty || '1')}" inputmode="decimal"></td><td><input data-i="unit" value="${esc(it.unit || '')}" placeholder="Std."></td><td><input data-i="price" value="${esc(it.price || '')}" inputmode="decimal" placeholder="0,00"></td><td><button class="ib" data-x="rm" title="Entfernen">×</button></td></tr>`;
      const back = modal(inv ? 'Rechnung erstellen' : 'Angebot erstellen', `${prof}
        <div class="row"><label class="f">Empfänger (Name und Anschrift)<textarea data-k="to" rows="4" placeholder="Max Mustermann&#10;Musterstraße 1&#10;12345 Musterstadt"></textarea></label>
        <div style="display:grid;gap:10px"><label class="f">${inv ? 'Rechnungsnummer' : 'Angebotsnummer'}<input data-k="no" value="${esc(N.no)}"></label><label class="f">Datum<input data-k="date" value="${today()}"></label><label class="f">${inv ? 'Leistungsdatum oder -zeitraum' : 'Gültig bis'}<input data-k="service" placeholder="${inv ? today() : ''}"></label></div></div>
        <label class="f">Einleitung (optional)<input data-k="intro" placeholder="${inv ? 'Für meine Leistungen berechne ich Ihnen:' : 'Gern biete ich Ihnen an:'}"></label>
        <h4>Positionen</h4><table><tbody>${item()}</tbody></table><button class="b" data-x="add">+ Position</button>
        <div class="tot"><span>Summe</span><span data-sum>0,00 €</span></div>
        <div class="row">${inv ? `<label class="f">Zahlungsziel (Tage)<input data-k="terms" value="${esc(P.terms)}" inputmode="numeric"></label>` : ''}<label class="f">Anrede<select data-k="formal"><option value="1">Sie</option><option value="">du</option></select></label></div>
        <label class="f">Hinweis (optional)<textarea data-k="note" rows="2"></textarea></label><p class="err"></p>`,
        `<button class="b" data-x="close">Abbrechen</button><button class="b p" data-x="go">${inv ? 'Rechnung erstellen' : 'Angebot erstellen'}</button>`);
      const $ = s => back.querySelector(s), $$ = s => [...back.querySelectorAll(s)];
      const readP = () => { const p = profile(); $$('[data-p]').forEach(i => { p[i.dataset.p] = i.type === 'checkbox' ? i.checked : i.value.trim(); }); return p; };
      const items = () => $$('tbody tr').map(tr => Object.fromEntries([...tr.querySelectorAll('[data-i]')].map(i => [i.dataset.i, i.value]))).filter(it => it.desc.trim() || num(it.price));
      const total = () => { const p = readP(), net = items().reduce((s, it) => s + num(it.qty) * num(it.price), 0); $('[data-sum]').textContent = eur(p.kleinunternehmer ? net : net * (1 + num(p.vat) / 100)) + (p.kleinunternehmer ? '' : ' brutto'); };
      back.addEventListener('input', total); back.addEventListener('change', total);
      const done = v => { back.remove(); resolve(v); };
      back.addEventListener('click', async e => {
        if (e.target === back) return;
        const x = e.target.closest('[data-x]'); if (!x) return;
        if (x.dataset.x === 'close') done(null);
        else if (x.dataset.x === 'add') { $('tbody').insertAdjacentHTML('beforeend', item()); $$('tbody tr').pop().querySelector('textarea').focus(); }
        else if (x.dataset.x === 'rm') { if ($$('tbody tr').length > 1) x.closest('tr').remove(); total(); }
        else if (x.dataset.x === 'go') {
          const p = readP(), its = items(), v = k => ($(`[data-k="${k}"]`) || {}).value || '';
          const err = m => { $('.err').textContent = m; };
          if (!p.name && !p.company) return err('Bitte unter „Meine Daten“ mindestens Namen oder Firma eintragen.');
          if (!v('to').trim()) return err('Bitte den Empfänger eintragen.');
          if (!its.length) return err('Bitte mindestens eine Position eintragen.');
          saveProfile({ ...p, terms: num(v('terms')) || p.terms });
          x.disabled = true; x.textContent = 'Wird erstellt …';
          try {
            const r = await invoicePdf(kind, { profile: p, to: v('to'), toName: v('to').split('\n')[0].trim().slice(0, 40), no: v('no').trim() || N.no, date: v('date'), service: v('service').trim(), intro: v('intro').trim(), items: its, terms: num(v('terms')), formal: !!v('formal'), note: v('note').trim() });
            if ((v('no').trim() || N.no) === N.no) N.commit();
            done(r);
          } catch (er) { x.disabled = false; x.textContent = 'Erneut versuchen'; err(er.message || String(er)); }
        }
      });
      total();
      setTimeout(() => { const f = missing ? $('[data-p="name"]') : $('[data-k="to"]'); if (f) f.focus(); }, 50);
    });
  }
  global.WBTemplates = { pick, assistant, build: (k, o = {}) => (k === 'invoice' || k === 'offer' ? null : BUILD[k](o)), invoicePdf, LIST, profile, saveProfile };
})(window);
