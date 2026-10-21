(() => {
'use strict';
const PDFJS = window.pdfjsLib;
const PL = window.PDFLib;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const SVGNS = 'http://www.w3.org/2000/svg';
const LH = 1.2;
const A4 = [595.28, 841.89];

/* Schriften: die drei PDF-Standardschriften plus mitgelieferte Google Fonts (fonts/*.ttf, Open Font License),
   die beim Speichern als Teilmenge in die PDF eingebettet werden. bl = Grundlinie bei Zeilenhöhe 1,2 */
const FONTS = {
  Helvetica: { css: 'Helvetica, Arial, "Liberation Sans", sans-serif', bl: 0.947, std: ['Helvetica', 'HelveticaBold'], g: 'Standard' },
  Times: { css: '"Times New Roman", Times, "Liberation Serif", serif', bl: 0.937, std: ['TimesRoman', 'TimesRomanBold'], g: 'Standard' },
  Courier: { css: '"Courier New", Courier, "Liberation Mono", monospace', bl: 0.866, std: ['Courier', 'CourierBold'], g: 'Standard' },
};
[['Roboto', 'Roboto', 0.942, 'Serifenlos'], ['OpenSans', 'Open Sans', 0.988, 'Serifenlos'], ['Inter', 'Inter', 0.964, 'Serifenlos'], ['Montserrat', 'Montserrat', 0.959, 'Serifenlos'], ['Nunito', 'Nunito', 0.929, 'Serifenlos'],
  ['Merriweather', 'Merriweather', 0.955, 'Serif'], ['Lora', 'Lora', 0.966, 'Serif'], ['PlayfairDisplay', 'Playfair Display', 1.015, 'Serif'],
  ['JetBrainsMono', 'JetBrains Mono', 0.96, 'Schreibmaschine'],
  ['Caveat', 'Caveat', 0.93, 'Handschrift'], ['DancingScript', 'Dancing Script', 0.92, 'Handschrift'], ['PatrickHand', 'Patrick Hand', 0.965, 'Handschrift', true], ['PermanentMarker', 'Permanent Marker', 0.996, 'Handschrift', true],
].forEach(([key, label, bl, g, noBold]) => { FONTS[key] = { css: `"WB ${label}", "${label}", ${g === 'Serif' ? 'serif' : g === 'Handschrift' ? 'cursive' : g === 'Schreibmaschine' ? 'monospace' : 'sans-serif'}`, family: 'WB ' + label, label, bl, file: key, noBold: !!noBold, g }; });
const FONT = name => FONTS[name] || FONTS.Helvetica;
const fw = a => (a.bold && !FONT(a.font).noBold ? 700 : 400);
/* eigene Schrift fürs Anzeigen laden, danach neu messen und zeichnen */
const fontLoads = new Map();
function ensureFont(name, bold) {
  const f = FONTS[name]; if (!f || !f.file || !document.fonts) return Promise.resolve(true);
  const k = name + (bold && !f.noBold ? 'b' : '');
  if (!fontLoads.has(k)) fontLoads.set(k, document.fonts.load(`${bold && !f.noBold ? 700 : 400} 16px "${f.family}"`).then(r => r.length > 0).catch(() => false));
  return fontLoads.get(k);
}
async function ensureFontsOf(pages) {
  const need = new Set();
  for (const p of pages) for (const a of p.annots) if (a.t === 'text' && FONT(a.font) && FONT(a.font).file) need.add(a.font + '|' + (a.bold ? 1 : 0));
  if (!need.size) return;
  await Promise.all([...need].map(k => { const [n, b] = k.split('|'); return ensureFont(n, b === '1'); }));
  for (const p of pages) if (p.annots.some(a => a.t === 'text' && FONT(a.font) && FONT(a.font).file)) drawAnnots(p);
}
/* fontkit (zum Einbetten eigener Schriften) erst laden, wenn er gebraucht wird */
let fontkitP = null;
function loadFontkit() {
  if (window.fontkit) return Promise.resolve(window.fontkit);
  if (!fontkitP) fontkitP = new Promise((res, rej) => {
    const urls = ['js/vendor/fontkit.umd.min.js', 'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js'];
    const next = () => {
      const u = urls.shift(); if (!u) { fontkitP = null; rej(new Error('Schrift-Modul konnte nicht geladen werden (offline?).')); return; }
      const sc = document.createElement('script'); sc.src = u; sc.onload = () => (window.fontkit ? res(window.fontkit) : next()); sc.onerror = () => { sc.remove(); next(); };
      document.head.appendChild(sc);
    };
    next();
  });
  return fontkitP;
}
const fontBytes = new Map();
function fontFile(name, bold) {
  const f = FONT(name), file = `fonts/${f.file}-${bold && !f.noBold ? 'Bold' : 'Regular'}.ttf`;
  if (!fontBytes.has(file)) fontBytes.set(file, fetch(file).then(r => { if (!r.ok) throw new Error('Schrift fehlt: ' + file); return r.arrayBuffer(); }).catch(e => { fontBytes.delete(file); throw e; }));
  return fontBytes.get(file);
}

const ICONS = {
  open: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  add: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M12 11v6M9 14h6',
  save: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  zin: 'M11 4a7 7 0 1 1 0 14a7 7 0 0 1 0-14zM20 20l-4-4M8 11h6M11 8v6',
  zout: 'M11 4a7 7 0 1 1 0 14a7 7 0 0 1 0-14zM20 20l-4-4M8 11h6',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  search: 'M11 5a6 6 0 1 1 0 12a6 6 0 0 1 0-12zM20 20l-4.5-4.5',
  up: 'M6 15l6-6 6 6', down: 'M6 9l6 6 6-6',
  sidebar: 'M4 5h16v14H4zM9 5v14',
  select: 'M6 3l12 7.5-5.5 1.5-2.5 5.5z',
  text: 'M5 7V5h14v2M12 5v14M9 19h6',
  edittext: 'M3 7V5h11v2M8.5 5v12M6.5 17h4M14 20l6.5-6.5-2-2L12 18v2z',
  objects: 'M4 4h4M4 4v4M20 4h-4M20 4v4M4 20h4M4 20v-4M20 20h-4M20 20v-4M9 9l7 3-3 1-1 3z',
  white: 'M4 16l8.5-8.5 5 5L13 17H8zM15 5l2-2 4 4-2 2M9 20h11',
  pen: 'M4 20l4-1L19 8a2.1 2.1 0 0 0-3-3L5 16zM14 7l3 3',
  hl: 'M4 20h16M7 16l1.5-5L16 3.5l4 4L12.5 15z',
  rect: 'M4 6h16v12H4z',
  ellipse: 'M12 6c4.4 0 8 2.7 8 6s-3.6 6-8 6-8-2.7-8-6 3.6-6 8-6z',
  line: 'M5 19L19 5',
  arrow: 'M5 19L19 5M10 5h9v9',
  check: 'M5 12.5l4.5 4.5L19 7',
  cross: 'M6 6l12 12M18 6L6 18',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 8.5h.01',
  sign: 'M3 16c3-1 4-9 6-9s-1 9 1 9 3-4 4-4 1 3 3 3 2-1 4-1M3 20.5h18',
  rotl: 'M4.5 13a7.5 7.5 0 1 0 2.2-6.3L4 9M4 4v5h5',
  rotr: 'M19.5 13a7.5 7.5 0 1 1-2.2-6.3L20 9M20 4v5h-5',
  blank: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M12 11v6M9 14h6',
  extract: 'M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5M13 3l5 5v3M13 3v5h5M15 17h7M19 14l3 3-3 3',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  copy: 'M8 8h11v12H8zM5 16V4h11',
  more: 'M5 11a1 1 0 1 0 0 2a1 1 0 1 0 0-2zM12 11a1 1 0 1 0 0 2a1 1 0 1 0 0-2zM19 11a1 1 0 1 0 0 2a1 1 0 1 0 0-2z',
  stamp: 'M9 4h6l-1 7h4a2 2 0 0 1 2 2v2H4v-2a2 2 0 0 1 2-2h4zM5 19h14',
  note: 'M5 4h14v11l-5 5H5zM14 20v-5h5M8 9h8M8 12h5',
  ul: 'M7 4v7a5 5 0 0 0 10 0V4M5 20h14',
  so: 'M5 12h14M16 6.5C15 5 13.6 4.5 12 4.5c-2.5 0-4 1.3-4 3 0 1.5 1 2.3 3 3M8 17c1 1.6 2.4 2.5 4.3 2.5 2.6 0 4.2-1.4 4.2-3.3 0-.9-.3-1.6-.9-2.2',
  close: 'M6 6l12 12M18 6L6 18',
  front: 'M8 8h12v12H8zM4 16V4h12',
  under: 'M12 3L2 8l10 5 10-5zM2 12.5l10 5 10-5M2 17l10 5 10-5',
  mark: 'M3 6h18v5H3zM3 15h12M3 19h8',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6z',
  eyeoff: 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
  back: 'M4 4h12v12H4zM8 20h12V8',
  gear: 'M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6zM12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1',
  comment: 'M4 5h16v11H9l-5 4z',
  paste: 'M9 4h6v3H9zM7 5H5v16h14V5h-2M9 12h6M9 16h4',
  dup: 'M9 9h11v11H9zM5 15V4h11M14.5 12v5M12 14.5h5',
  calc: 'M6 3h12v18H6zM9 7h6M9 11h.01M12 11h.01M15 11h.01M9 14h.01M12 14h.01M15 14h.01M9 17h.01M12 17h.01M15 17h.01',
  eraser: 'M8 20h12M5.5 14.5l9-9a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L12 18H8.5l-3-3a.7.7 0 0 1 0-.5zM9 11l5 5',
  redact: 'M4 6h16v5H4zM4 15h9M4 19h12',
  measure: 'M3 15l12-12 6 6-12 12zM7 11l2 2M10 8l2 2M13 5l2 2',
  book: 'M4 5c3-1 6-1 8 1v14c-2-2-5-2-8-1zM20 5c-3-1-6-1-8 1v14c2-2 5-2 8-1z',
  library: 'M4 4h4v16H4zM10 4h4v16h-4zM16.5 4.5l3.8 1-3.9 14.5-3.8-1z',
  laser: 'M4 20l8.5-8.5M14.5 9.5a2 2 0 1 0 0-.01M14.5 3v2M20.5 9.5h-2M18.7 5.3l-1.4 1.4M18.7 13.7l-1.4-1.4M10.3 5.3l1.4 1.4',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  pages: 'M7 3h10v7H7zM7 14h10v7H7z',
  bookmark: 'M7 3h10v18l-5-4-5 4z',
  pencil: 'M4 20l3-1 12-12-2-2L5 17zM15 5l2-2 2 2-2 2',
  spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z',
  restart: 'M4 12a8 8 0 1 0 2.4-5.7L4 9M4 4v5h5', send: 'M4 12l16-8-6 16-2.4-6.6z',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01', bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.8.6 1.5 1.6 1.5 2.6V17h4v-.5c0-1 .7-2 1.5-2.6A6 6 0 0 0 12 3z',
  cards: 'M8 4h12v12H8zM4 8v12h12', quiz: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01',
  checks: 'M4 7l2 2 4-4M4 17l2 2 4-4M13 7h7M13 17h7', translate: 'M4 5h8M8 3v2M5.5 5c.5 3 2.5 5.5 5.5 7M11 5c-.5 3-3 6.5-6.5 8M13 21l4-10 4 10M14.5 17.5h5',
  hand: 'M3 17c2.5-3 4-9 6-9s-1 9 1.5 9 3-5 5-5 1 3 3 3 2-1 2.5-1.5',
  sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  aleft: 'M4 6h16M4 10h10M4 14h16M4 18h10', acenter: 'M4 6h16M7 10h10M4 14h16M7 18h10', aright: 'M4 6h16M10 10h10M4 14h16M10 18h10',
  lsolid: 'M3 12h18', ldash: 'M3 12h4M10 12h4M17 12h4', ldot: 'M4 12h.01M8 12h.01M12 12h.01M16 12h.01M20 12h.01',
};

const TOOL_NAMES = { laser: 'Laserpointer', mark: 'Textmarkierung', select: 'Auswählen', objects: 'Inhalte', text: 'Text', edittext: 'Text ändern', pen: 'Stift', eraser: 'Radierer', hl: 'Markieren', ul: 'Unterstreichen', so: 'Durchstreichen', rect: 'Rechteck', ellipse: 'Ellipse', line: 'Linie', arrow: 'Pfeil', measure: 'Messen', white: 'Abdecken', redact: 'Schwärzen', check: 'Haken', cross: 'Kreuz', img: 'Bild', stamp: 'Stempel', note: 'Notiz', wm: 'Wasserzeichen' };
const PROPS_OF = { multi: ['color'], mark: ['color', 'opacity'], text: ['color', 'font', 'align'], pen: ['penkind', 'color', 'stroke', 'opacity'], eraser: ['esize'], hl: ['color', 'opacity'], ul: ['color'], so: ['color'], rect: ['color', 'stroke', 'fill', 'dash'], ellipse: ['color', 'stroke', 'fill', 'dash'], line: ['color', 'stroke', 'dash'], arrow: ['color', 'stroke', 'dash'], measure: ['color', 'scale'], check: ['color', 'stroke'], cross: ['color', 'stroke'], white: [], redact: [], img: [], stamp: ['color', 'stamp'], note: ['color'], wm: ['color', 'opacity'] };
const DRAW_TOOLS = new Set(['laser', 'pen', 'eraser', 'hl', 'ul', 'so', 'rect', 'ellipse', 'line', 'arrow', 'measure', 'white', 'redact', 'check', 'cross', 'objects']);
const SNAP_TOOLS = new Set(['hl', 'ul', 'so']);
const KEYS = { j: 'laser', v: 'select', m: 'objects', t: 'text', e: 'edittext', p: 'pen', g: 'eraser', h: 'hl', n: 'ul', d: 'so', r: 'rect', o: 'ellipse', l: 'line', a: 'arrow', q: 'measure', w: 'white', b: 'redact', k: 'check', x: 'cross', s: 'stamp', c: 'note' };
const STAMPS = [['GENEHMIGT', '#1e8a4c'], ['ERLEDIGT', '#1e8a4c'], ['BEZAHLT', '#1e8a4c'], ['ENTWURF', '#1f4fd8'], ['KOPIE', '#1f4fd8'], ['VERTRAULICH', '#d0342c'], ['ABGELEHNT', '#d0342c'], ['DRINGEND', '#e07b00'], ['{datum}', '#1b2130']];
const COARSE = matchMedia('(pointer: coarse)').matches || matchMedia('(any-pointer: coarse)').matches;
/* Stiftarten: jede Art merkt sich eigene Stärke, Deckkraft und Farbe */
const PEN_KINDS = {
  fount: { sw: 2, op: 100, color: '#1b2a6b' },
  ball: { sw: 1.25, op: 100, color: '#1f4fd8' },
  marker: { sw: 12, op: 40, color: '#ffd400' },
};
const today = () => new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const SWATCHES = ['#1b2130', '#1f4fd8', '#d0342c', '#1e8a4c', '#e07b00', '#7a3fd0', '#ffd400', '#ffffff'];
const HINTS = {
  select: 'Element anklicken zum Verschieben · Ecke ziehen zum Skalieren · Doppelklick auf Text zum Bearbeiten',
  edittext: 'Auf vorhandenen Text klicken und direkt in der PDF ändern · leer lassen entfernt die Zeile',
  objects: 'Element der PDF antippen oder Rahmen aufziehen, dann ziehen zum Verschieben · Doppelklick auf Text bearbeitet ihn',
  white: 'Bereich aufziehen, um Inhalte mit Weiß abzudecken',
  text: '', img: 'Bild ausgewählt · Ecke ziehen zum Skalieren',
  hl: 'Auf eine Textzeile tippen oder einen Bereich aufziehen',
  ul: 'Auf eine Textzeile tippen oder eine Linie ziehen',
  so: 'Auf eine Textzeile tippen oder eine Linie ziehen',
  note: 'Auf die Seite tippen, um eine Notiz anzuheften · wird als echter PDF-Kommentar gespeichert',
  stamp: 'Stempel wählen und auf die Seite tippen',
  eraser: 'Über eigene Striche und Elemente wischen, um sie zu löschen',
  redact: 'Bereich aufziehen: Text und Grafik darunter werden dauerhaft aus der PDF entfernt',
  measure: 'Linie ziehen, um die Strecke in mm zu messen · Umschalt rastet auf 45° ein',
  pen: 'Strich am Ende kurz halten: wird zu gerader Linie, Rechteck oder Ellipse',
};
const TOUCH_HINT = 'Zwei Finger scrollen und zoomen · zwei Finger tippen = rückgängig';
if (COARSE) for (const k of ['pen', 'eraser', 'rect', 'ellipse', 'line', 'arrow', 'measure', 'white', 'redact', 'check', 'cross', 'objects']) HINTS[k] = (HINTS[k] ? HINTS[k] + ' · ' : '') + TOUCH_HINT;

const TP = {
  text: { color: '#1b2130', size: 12, font: 'Helvetica', bold: false, bg: '', align: 'left' },
  pen: { kind: 'fount', color: '#1b2a6b', sw: 2, op: 100, shapes: true },
  eraser: { size: 12 },
  measure: { color: '#d0342c', sw: 1, scale: 1, unit: 'mm' },
  hl: { color: '#ffd400', op: 40 },
  rect: { color: '#d0342c', sw: 2, fill: '', dash: '' }, ellipse: { color: '#d0342c', sw: 2, fill: '', dash: '' },
  line: { color: '#1b2130', sw: 2, dash: '' }, arrow: { color: '#d0342c', sw: 2, dash: '' },
  check: { color: '#1b2130', sw: 2 }, cross: { color: '#1b2130', sw: 2 },
  ul: { color: '#1f4fd8' }, so: { color: '#d0342c' },
  stamp: { color: '#1e8a4c', text: 'GENEHMIGT' }, note: { color: '#ffd400' },
};

const S = {
  decrypted: new Set(),
  sources: new Map(), proxies: new Map(), images: new Map(), textCache: new Map(),
  pages: [], zoom: 1, tool: 'select', sel: null, cur: 0, selPages: new Set(),
  docName: 'Beispiel-Dokument.pdf', sample: true, dirty: false,
  hist: [], fut: [], clip: null, find: null, editing: null, busy: false, blankSrc: null, propEdit: false,
  libDocs: new Map(), analysis: new Map(), derived: new Map(), csel: null, hover: null, cedit: null,
  meta: { title: '', author: '', subject: '', keywords: '' }, touchDrag: false,
  pencil: { seen: false, only: false }, forms: new Map(), formVals: {}, formTouched: new Set(), bookmarks: [], paperSrc: new Map(),
  sideTab: 'pages', reading: false, night: false, msel: null, prefs: null,
};
/* Einheiten fürs Messen: Faktor von PDF-Punkt (1/72 Zoll) */
const UNITS = { mm: [25.4 / 72, 'mm', 'Millimeter'], cm: [2.54 / 72, 'cm', 'Zentimeter'], m: [0.0254 / 72, 'm', 'Meter'], in: [1 / 72, 'in', 'Zoll'], ft: [1 / 864, 'ft', 'Fuß'], pt: [1, 'pt', 'Punkt'] };
const PREF_DEFAULTS = { author: '', unit: 'mm', decimals: 1, scale: 1, exportMarks: 'annots', askComment: false, snap: true, showMarks: true, hlColor: '#ffd400', ulColor: '#1f4fd8', soColor: '#d0342c' };
const ENG = PL && window.createContentEngine ? window.createContentEngine(PL) : null;
const els = new Map(), tels = new Map();
let uidN = 1;
const uid = (p = 'a') => p + (uidN++).toString(36);

const pagesEl = $('#pages'), viewer = $('#viewer'), thumbsEl = $('#thumbs'), work = $('#work'), propbar = $('#propbar');

/* ---------- Hilfsfunktionen ---------- */
const r2 = n => Math.round(n * 100) / 100;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const pageById = id => S.pages.find(p => p.id === id);
const hasCE = p => !!(p && p.ce && ((p.ce.del && p.ce.del.length) || (p.ce.rep && Object.keys(p.ce.rep).length) || (p.ce.tf && Object.keys(p.ce.tf).length) || (p.ce.red && p.ce.red.length) || (p.ce.dup && p.ce.dup.length) || (p.ce.zf && p.ce.zf.length) || (p.ce.zb && p.ce.zb.length)));
function ceKey(p) {
  if (!hasCE(p)) return '';
  const s = JSON.stringify(p.ce); let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36) + '.' + s.length;
}
const pkey = p => p.src + ':' + p.idx + (hasCE(p) ? '#' + ceKey(p) : '');
const proxyOf = p => {
  if (hasCE(p)) { const d = S.derived.get(pkey(p)); if (d) return d.page; }
  return S.proxies.get(p.src + ':' + p.idx);
};
const rotOf = p => ((p.baseRot + p.rot) % 360 + 360) % 360;
const dims = p => (p.rot % 180 ? [p.h0, p.w0] : [p.w0, p.h0]);
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* nicht verfügbar */ } };
S.prefs = (() => { try { return { ...PREF_DEFAULTS, ...JSON.parse(lsGet('pdfwb.prefs') || '{}') }; } catch (e) { return { ...PREF_DEFAULTS }; } })();
const savePrefs = () => lsSet('pdfwb.prefs', JSON.stringify(S.prefs));
/* Hell, dunkel oder wie das System (gilt für Editor und Bibliothek) */
function setTheme(v) {
  if (v === 'light' || v === 'dark') { document.documentElement.dataset.theme = v; lsSet('pdfwb.theme', v); }
  else { delete document.documentElement.dataset.theme; try { localStorage.removeItem('pdfwb.theme'); } catch (e) { /* egal */ } }
}
setTheme(lsGet('pdfwb.theme'));
TP.measure.unit = S.prefs.unit; TP.measure.scale = S.prefs.scale;
TP.hl.color = S.prefs.hlColor; TP.ul.color = S.prefs.ulColor; TP.so.color = S.prefs.soColor;
/* Länge in PDF-Punkt in der gewählten Einheit, deutsch formatiert */
function fmtLen(pt, unit, scale = 1, dec = S.prefs.decimals) {
  const u = UNITS[unit] || UNITS.mm, v = pt * u[0] * scale;
  return v.toFixed(dec).replace('.', ',') + ' ' + u[1];
}
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const icon = name => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name] || ''}"/></svg>`;
function hex2rgb(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(h || '');
  const n = m ? parseInt(m[1], 16) : 0;
  return PL.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3200); }
function setMsg(msg, spin) { $('#stMsg').innerHTML = (spin ? '<span class="spin"></span>' : '') + esc(msg || ''); }
function busy(on, msg) { S.busy = on; $('#btnSave').disabled = on; setMsg(on ? msg : '', on); document.body.style.cursor = on ? 'progress' : ''; }

const mctx = document.createElement('canvas').getContext('2d');
function measure(str, a) { mctx.font = `${fw(a)} ${a.size}px ${FONT(a.font).css}`; return mctx.measureText(str).width; }
function textWidth(a) { return Math.max(4, ...a.text.split('\n').map(l => measure(l || ' ', a))); }
/* Textausrichtung: linker Rand je Zeile innerhalb der Textbox */
function lineX(a, ln, W) {
  if (!a.align || a.align === 'left') return a.x;
  const w = measure(ln || ' ', a);
  W = W == null ? textWidth(a) : W;
  return a.x + (a.align === 'center' ? (W - w) / 2 : W - w);
}
/* Linienstil und Füllung für Formen */
const dashOf = a => (a.dash === 'dash' ? [a.sw * 3, a.sw * 2] : a.dash === 'dot' ? [0.01, a.sw * 2] : null);
const FILL_OP = { soft: 0.22, solid: 1 };
const NOTE = 20;
function stampGeom(a) {
  const tw = measure(a.text, { bold: true, size: a.size, font: 'Helvetica' });
  const pad = a.size * 0.65;
  return { w: tw + 2 * pad, h: a.size * 1.75, pad, base: a.size * 1.75 / 2 + a.size * 0.36, sw: Math.max(1, a.size * 0.12) };
}

/* ---------- Geometrie der Elemente ---------- */
function bbox(a) {
  switch (a.t) {
    case 'pen': {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of a.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      return { x: x0, y: y0, w: Math.max(x1 - x0, 1), h: Math.max(y1 - y0, 1) };
    }
    case 'line': case 'arrow':
      return { x: Math.min(a.x1, a.x2), y: Math.min(a.y1, a.y2), w: Math.max(Math.abs(a.x2 - a.x1), 1), h: Math.max(Math.abs(a.y2 - a.y1), 1) };
    case 'measure': {
      const m = 9;
      return { x: Math.min(a.x1, a.x2) - m, y: Math.min(a.y1, a.y2) - m, w: Math.abs(a.x2 - a.x1) + 2 * m, h: Math.abs(a.y2 - a.y1) + 2 * m };
    }
    case 'text': return { x: a.x, y: a.y, w: textWidth(a), h: a.text.split('\n').length * LH * a.size };
    case 'check': case 'cross': return { x: a.x, y: a.y, w: a.s, h: a.s };
    case 'mark': {
      const x = Math.min(...a.rects.map(r => r.x)), y = Math.min(...a.rects.map(r => r.y));
      return { x, y, w: Math.max(...a.rects.map(r => r.x + r.w)) - x, h: Math.max(...a.rects.map(r => r.y + r.h)) - y };
    }
    case 'stamp': { const g = stampGeom(a); return { x: a.x, y: a.y, w: g.w, h: g.h }; }
    case 'note': return { x: a.x, y: a.y, w: NOTE, h: NOTE };
    case 'wm': {
      const w = measure(a.text, { bold: true, size: a.size, font: 'Helvetica' }), h = a.size * 0.75;
      const c = Math.cos(a.ang * Math.PI / 180), s = Math.sin(a.ang * Math.PI / 180);
      const bw = Math.abs(w * c) + Math.abs(h * s), bh = Math.abs(w * s) + Math.abs(h * c);
      return { x: a.x - bw / 2, y: a.y - bh / 2, w: bw, h: bh };
    }
    default: return { x: a.x, y: a.y, w: a.w, h: a.h };
  }
}
function segs(a) {
  const { x, y, w, h } = a;
  switch (a.t) {
    case 'pen': {
      if (a.pts.length === 1) return [['M', a.pts[0][0], a.pts[0][1]], ['L', a.pts[0][0] + 0.01, a.pts[0][1]]];
      return a.pts.map((p, i) => [i ? 'L' : 'M', p[0], p[1]]);
    }
    case 'rect': case 'hl': case 'white': case 'redact':
      return [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']];
    case 'measure': {
      const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1), nx = -Math.sin(ang) * 5, ny = Math.cos(ang) * 5;
      return [['M', a.x1, a.y1], ['L', a.x2, a.y2], ['M', a.x1 - nx, a.y1 - ny], ['L', a.x1 + nx, a.y1 + ny], ['M', a.x2 - nx, a.y2 - ny], ['L', a.x2 + nx, a.y2 + ny]];
    }
    case 'ellipse': {
      const k = 0.5523, rx = w / 2, ry = h / 2, cx = x + rx, cy = y + ry;
      return [['M', cx + rx, cy], ['C', cx + rx, cy + k * ry, cx + k * rx, cy + ry, cx, cy + ry], ['C', cx - k * rx, cy + ry, cx - rx, cy + k * ry, cx - rx, cy],
        ['C', cx - rx, cy - k * ry, cx - k * rx, cy - ry, cx, cy - ry], ['C', cx + k * rx, cy - ry, cx + rx, cy - k * ry, cx + rx, cy], ['Z']];
    }
    case 'line': return [['M', a.x1, a.y1], ['L', a.x2, a.y2]];
    case 'arrow': {
      const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1), L = Math.max(9, a.sw * 4.5);
      const h1 = [a.x2 - L * Math.cos(ang - 0.45), a.y2 - L * Math.sin(ang - 0.45)];
      const h2 = [a.x2 - L * Math.cos(ang + 0.45), a.y2 - L * Math.sin(ang + 0.45)];
      return [['M', a.x1, a.y1], ['L', a.x2, a.y2], ['M', h1[0], h1[1]], ['L', a.x2, a.y2], ['L', h2[0], h2[1]]];
    }
    case 'check': { const s = a.s; return [['M', x + 0.15 * s, y + 0.55 * s], ['L', x + 0.4 * s, y + 0.8 * s], ['L', x + 0.85 * s, y + 0.2 * s]]; }
    case 'cross': { const s = a.s; return [['M', x + 0.2 * s, y + 0.2 * s], ['L', x + 0.8 * s, y + 0.8 * s], ['M', x + 0.8 * s, y + 0.2 * s], ['L', x + 0.2 * s, y + 0.8 * s]]; }
  }
  return [];
}
function dOf(sg, map) {
  return sg.map(s => {
    if (s[0] === 'Z') return 'Z';
    const out = [s[0]];
    for (let i = 1; i < s.length; i += 2) { const pt = map ? map(s[i], s[i + 1]) : [s[i], s[i + 1]]; out.push(r2(pt[0]), r2(pt[1])); }
    return out.join(' ');
  }).join(' ');
}
/* Füller: Umriss aus Mittellinie und Druck (0–1) je Punkt, als geschlossene Fläche */
function penOutline(a) {
  const n = a.pts.length, pr = q => (q[2] == null ? 0.5 : q[2]);
  const P = n > 2 ? a.pts.map((q, i) => (i === 0 || i === n - 1 ? q : [(a.pts[i - 1][0] + 2 * q[0] + a.pts[i + 1][0]) / 4, (a.pts[i - 1][1] + 2 * q[1] + a.pts[i + 1][1]) / 4, (pr(a.pts[i - 1]) + 2 * pr(q) + pr(a.pts[i + 1])) / 4])) : a.pts;
  const rad = P.map(q => Math.max(0.15, a.sw * (0.28 + 1.05 * pr(q)) / 2));
  if (n === 1 || (n === 2 && Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]) < 0.3)) {
    const [cx, cy] = P[0], r = rad[0], k = 0.5523 * r;
    return [['M', cx + r, cy], ['C', cx + r, cy + k, cx + k, cy + r, cx, cy + r], ['C', cx - k, cy + r, cx - r, cy + k, cx - r, cy], ['C', cx - r, cy - k, cx - k, cy - r, cx, cy - r], ['C', cx + k, cy - r, cx + r, cy - k, cx + r, cy], ['Z']];
  }
  const L = [], R = [];
  let nxp = 0, nyp = 1;
  for (let i = 0; i < n; i++) {
    const a0 = P[Math.max(0, i - 1)], a1 = P[Math.min(n - 1, i + 1)];
    let dx = a1[0] - a0[0], dy = a1[1] - a0[1];
    const l = Math.hypot(dx, dy);
    if (l > 1e-6) { dx /= l; dy /= l; nxp = -dy; nyp = dx; }
    L.push([P[i][0] + nxp * rad[i], P[i][1] + nyp * rad[i]]);
    R.push([P[i][0] - nxp * rad[i], P[i][1] - nyp * rad[i]]);
  }
  const cap = (c, r, from) => {
    const out = [];
    for (let k = 1; k < 6; k++) { const t = from - Math.PI * k / 6; out.push(['L', c[0] + Math.cos(t) * r, c[1] + Math.sin(t) * r]); }
    return out;
  };
  const angOf = (p, q) => Math.atan2(q[1] - p[1], q[0] - p[0]);
  const end = P[n - 1], start = P[0];
  return [['M', L[0][0], L[0][1]], ...L.slice(1).map(q => ['L', q[0], q[1]]),
    ...cap(end, rad[n - 1], angOf(end, L[n - 1])),
    ...R.slice().reverse().map(q => ['L', q[0], q[1]]),
    ...cap(start, rad[0], angOf(start, R[0])), ['Z']];
}
const penKind = a => a.kind || 'ball';
/* Textmarkierung: je Zeile ein Rechteck; Unter- und Durchstreichen als Linie (bei gedrehter Seite senkrecht) */
function markSegs(a) {
  return a.rects.map(r => {
    const rect = [['M', r.x, r.y], ['L', r.x + r.w, r.y], ['L', r.x + r.w, r.y + r.h], ['L', r.x, r.y + r.h], ['Z']];
    if (a.kind === 'hl') return ['fill', rect];
    const v = !!a.vert, size = v ? r.w : r.h, w = Math.max(0.8, size * 0.075);
    const f = a.kind === 'ul' ? 0.9 : 0.55;
    if (!v) { const y = r.y + r.h * f; return ['line', { d: [['M', r.x, y], ['L', r.x + r.w, y]], w }]; }
    const x = r.x + r.w * (1 - f);
    return ['line', { d: [['M', x, r.y], ['L', x, r.y + r.h]], w }];
  });
}
function measureLabel(a) {
  return fmtLen(Math.hypot(a.x2 - a.x1, a.y2 - a.y1), a.unit || S.prefs.unit, a.scale || 1, a.dec != null ? a.dec : S.prefs.decimals);
}
function measureGeom(a) {
  let ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1) * 180 / Math.PI;
  if (ang > 90) ang -= 180; else if (ang < -90) ang += 180;
  const label = measureLabel(a), size = 8, w = measure(label, { bold: false, size, font: 'Helvetica' });
  return { ang, label, size, w, mx: (a.x1 + a.x2) / 2, my: (a.y1 + a.y2) / 2 };
}
function annotSVG(a) {
  const c = a.color;
  switch (a.t) {
    case 'pen': {
      const k = penKind(a);
      if (k === 'fount') return `<path d="${dOf(penOutline(a))}" fill="${c}" fill-opacity="${a.op / 100}"/>`;
      return `<path d="${dOf(segs(a))}" fill="none" stroke="${c}" stroke-width="${a.sw}" stroke-linecap="round" stroke-linejoin="round" ${k === 'marker' ? `stroke-opacity="${a.op / 100}"` : `opacity="${a.op / 100}"`}/>`;
    }
    case 'measure': {
      const g = measureGeom(a);
      return `<g><path d="${dOf(segs(a))}" fill="none" stroke="${c}" stroke-width="${a.sw}" stroke-linecap="round"/>` +
        `<g transform="translate(${r2(g.mx)} ${r2(g.my)}) rotate(${r2(g.ang)})"><rect x="${r2(-g.w / 2 - 2)}" y="${-g.size - 4}" width="${r2(g.w + 4)}" height="${g.size + 3}" rx="1.5" fill="#ffffff" fill-opacity="0.85"/>` +
        `<text x="0" y="-4" text-anchor="middle" font-family='${FONTS.Helvetica.css}' font-size="${g.size}" fill="${c}">${esc(g.label)}</text></g></g>`;
    }
    case 'redact': return `<path d="${dOf(segs(a))}" fill="#000000"/>`;
    case 'mark': return markSegs(a).map(([k, q]) => k === 'fill'
      ? `<path d="${dOf(q)}" fill="${c}" fill-opacity="${(a.op || 40) / 100}"/>`
      : `<path d="${dOf(q.d)}" fill="none" stroke="${c}" stroke-width="${r2(q.w)}" stroke-linecap="butt"/>`).join('');
    case 'hl': return `<path d="${dOf(segs(a))}" fill="${c}" fill-opacity="${a.op / 100}"/>`;
    case 'white': return `<path d="${dOf(segs(a))}" fill="#ffffff"/>`;
    case 'rect': case 'ellipse': {
      const da = dashOf(a), fo = FILL_OP[a.fill];
      return `<path d="${dOf(segs(a))}" fill="${fo ? c : 'none'}"${fo ? ` fill-opacity="${fo}"` : ''} stroke="${c}" stroke-width="${a.sw}"${da ? ` stroke-dasharray="${da.map(r2).join(' ')}"${a.dash === 'dot' ? ' stroke-linecap="round"' : ''}` : ''}/>`;
    }
    case 'line': case 'arrow': {
      const da = dashOf(a);
      if (da && a.t === 'arrow') { const sg = segs(a); return `<path d="${dOf(sg.slice(0, 2))}" fill="none" stroke="${c}" stroke-width="${a.sw}" stroke-linecap="round" stroke-dasharray="${da.map(r2).join(' ')}"/><path d="${dOf(sg.slice(2))}" fill="none" stroke="${c}" stroke-width="${a.sw}" stroke-linecap="round" stroke-linejoin="round"/>`; }
      return `<path d="${dOf(segs(a))}" fill="none" stroke="${c}" stroke-width="${a.sw}" stroke-linecap="round" stroke-linejoin="round"${da ? ` stroke-dasharray="${da.map(r2).join(' ')}"` : ''}/>`;
    }
    case 'check': case 'cross':
      return `<path d="${dOf(segs(a))}" fill="none" stroke="${c}" stroke-width="${a.sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
    case 'text': {
      const f = FONT(a.font);
      const lines = a.text.split('\n'), W = a.align && a.align !== 'left' ? textWidth(a) : 0;
      const bgr = a.bg ? (() => { const b = bbox(a), pd = a.size * 0.18; return `<rect x="${r2(b.x - pd)}" y="${r2(b.y - pd * 0.4)}" width="${r2(b.w + 2 * pd)}" height="${r2(b.h + pd * 0.8)}" fill="${a.bg}"/>`; })() : '';
      return bgr + `<text font-family='${f.css}' font-size="${a.size}" font-weight="${fw(a)}" fill="${c}" xml:space="preserve">` +
        lines.map((ln, i) => `<tspan x="${r2(lineX(a, ln, W))}" y="${r2(a.y + f.bl * a.size + i * LH * a.size)}">${esc(ln) || ' '}</tspan>`).join('') + '</text>';
    }
    case 'stamp': {
      const g = stampGeom(a);
      return `<g><rect x="${r2(a.x + g.sw / 2)}" y="${r2(a.y + g.sw / 2)}" width="${r2(g.w - g.sw)}" height="${r2(g.h - g.sw)}" rx="${r2(a.size * 0.22)}" fill="${c}" fill-opacity="0.07" stroke="${c}" stroke-width="${r2(g.sw)}"/>` +
        `<text x="${r2(a.x + g.pad)}" y="${r2(a.y + g.base)}" font-family='${FONTS.Helvetica.css}' font-size="${a.size}" font-weight="700" fill="${c}">${esc(a.text)}</text></g>`;
    }
    case 'note':
      return `<g><title>${esc(a.text || 'Notiz')}</title><path d="M${r2(a.x)} ${r2(a.y)}h${NOTE}v${NOTE * 0.68}l-${NOTE * 0.32} ${NOTE * 0.32}H${r2(a.x)}z" fill="${c}" stroke="#7a5c00" stroke-width="0.8" stroke-linejoin="round"/>` +
        `<path d="M${r2(a.x + NOTE * 0.22)} ${r2(a.y + NOTE * 0.3)}h${NOTE * 0.56}M${r2(a.x + NOTE * 0.22)} ${r2(a.y + NOTE * 0.5)}h${NOTE * 0.4}" stroke="#7a5c00" stroke-width="1" stroke-linecap="round"/></g>`;
    case 'wm':
      return `<text x="${r2(a.x)}" y="${r2(a.y + a.size * 0.35)}" text-anchor="middle" transform="rotate(${-a.ang} ${r2(a.x)} ${r2(a.y)})" font-family='${FONTS.Helvetica.css}' font-size="${a.size}" font-weight="700" fill="${c}" fill-opacity="${a.op / 100}">${esc(a.text)}</text>`;
    case 'img': {
      const im = S.images.get(a.img);
      return im ? `<image href="${im.url}" x="${r2(a.x)}" y="${r2(a.y)}" width="${r2(a.w)}" height="${r2(a.h)}" preserveAspectRatio="none"/>` : '';
    }
  }
  return '';
}
function distSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
function hitsAnnot(a, pt, tol) {
  if (a.t === 'mark') return a.rects.some(r => pt[0] >= r.x - tol && pt[0] <= r.x + r.w + tol && pt[1] >= r.y - tol && pt[1] <= r.y + r.h + tol);
  const b = bbox(a);
  const inBox = pt[0] >= b.x - tol && pt[0] <= b.x + b.w + tol && pt[1] >= b.y - tol && pt[1] <= b.y + b.h + tol;
  if (a.t === 'pen' || a.t === 'line' || a.t === 'arrow' || a.t === 'measure') {
    if (!inBox && a.t !== 'arrow') return false;
    const t = tol + (a.sw || 1) / 2 * (a.t === 'pen' && penKind(a) === 'fount' ? 1.4 : 1);
    let prev = null;
    for (const s of segs(a)) {
      if (s[0] === 'M') prev = [s[1], s[2]];
      else if (s[0] === 'L') { const q = [s[1], s[2]]; if (distSeg(pt, prev, q) <= t) return true; prev = q; }
    }
    return false;
  }
  return inBox;
}
function hitTest(p, pt, type) {
  const tol = (COARSE ? 10 : 4) / S.zoom;
  for (let i = p.annots.length - 1; i >= 0; i--) {
    const a = p.annots[i];
    if (type && a.t !== type) continue;
    if (S.editing && S.editing.a.id === a.id) continue;
    if (hitsAnnot(a, pt, tol)) return a;
  }
  return null;
}
function translated(o, dx, dy) {
  const a = clone(o);
  if (a.pts) a.pts = a.pts.map(([x, y, p]) => (p == null ? [r2(x + dx), r2(y + dy)] : [r2(x + dx), r2(y + dy), p]));
  else if ('x1' in a) { a.x1 += dx; a.x2 += dx; a.y1 += dy; a.y2 += dy; }
  else if (a.rects) a.rects = a.rects.map(r => ({ ...r, x: r.x + dx, y: r.y + dy }));
  else { a.x += dx; a.y += dy; }
  return a;
}
function scaled(o, ob, fx, fy) {
  const a = clone(o);
  const sx = x => ob.x + (x - ob.x) * fx, sy = y => ob.y + (y - ob.y) * fy;
  if (a.pts) { a.pts = a.pts.map(([x, y, p]) => (p == null ? [r2(sx(x)), r2(sy(y))] : [r2(sx(x)), r2(sy(y)), p])); if (a.t === 'pen') a.sw = Math.max(0.25, r2(a.sw * Math.sqrt(fx * fy))); }
  else if ('x1' in a) { a.x1 = sx(a.x1); a.x2 = sx(a.x2); a.y1 = sy(a.y1); a.y2 = sy(a.y2); }
  else if (a.rects) a.rects = a.rects.map(r => ({ x: sx(r.x), y: sy(r.y), w: r.w * fx, h: r.h * fy }));
  else if (a.t === 'text') a.size = Math.max(4, Math.round(a.size * fx * 2) / 2);
  else if (a.t === 'check' || a.t === 'cross') a.s = Math.max(4, a.s * fx);
  else if (a.t === 'stamp' || a.t === 'wm') a.size = Math.max(4, Math.round(a.size * fx * 2) / 2);
  else if (a.t === 'note') { /* feste Größe */ }
  else { a.w = Math.max(2, a.w * fx); a.h = Math.max(2, a.h * fy); }
  return a;
}
function rotAnnot(o, W, H, d) {
  const f = d > 0 ? ([x, y]) => [H - y, x] : ([x, y]) => [y, W - x];
  const a = clone(o);
  if (a.pts) { a.pts = a.pts.map(p => (p[2] == null ? f(p).map(r2) : [...f(p).map(r2), p[2]])); return a; }
  if ('x1' in a) { [a.x1, a.y1] = f([a.x1, a.y1]); [a.x2, a.y2] = f([a.x2, a.y2]); return a; }
  if (a.rects) {
    a.rects = a.rects.map(r => { const p1 = f([r.x, r.y]), p2 = f([r.x + r.w, r.y + r.h]); return { x: Math.min(p1[0], p2[0]), y: Math.min(p1[1], p2[1]), w: Math.abs(p2[0] - p1[0]), h: Math.abs(p2[1] - p1[1]) }; });
    a.vert = !a.vert;
    return a;
  }
  if (['rect', 'hl', 'white', 'ellipse', 'redact'].includes(a.t)) {
    const p1 = f([a.x, a.y]), p2 = f([a.x + a.w, a.y + a.h]);
    a.x = Math.min(p1[0], p2[0]); a.y = Math.min(p1[1], p2[1]); a.w = Math.abs(p2[0] - p1[0]); a.h = Math.abs(p2[1] - p1[1]);
    return a;
  }
  const b = bbox(a), c = [b.x + b.w / 2, b.y + b.h / 2], n = f(c);
  a.x += n[0] - c[0]; a.y += n[1] - c[1];
  return a;
}

/* ---------- Verlauf ---------- */
const snap = () => JSON.stringify(S.pages);
const structKey = pages => pages.map(p => p.id + ':' + p.rot).join('|');
function pushHist() { S.hist.push(snap()); if (S.hist.length > 150) S.hist.shift(); S.fut.length = 0; updateUndo(); }
async function restore(json) {
  const old = structKey(S.pages);
  const oldCE = new Map(S.pages.map(p => [p.id, ceKey(p)]));
  const next = JSON.parse(json);
  S.sel = null; S.csel = null; S.hover = null;
  const need = next.filter(p => hasCE(p) && !S.derived.has(pkey(p)));
  if (need.length) {
    busy(true, 'Seite wird neu aufgebaut …');
    try { await Promise.all(need.map(ensureDerived)); } catch (e) { console.error(e); }
    busy(false);
  }
  S.pages = next;
  S.cur = Math.min(S.cur, S.pages.length - 1);
  if (structKey(S.pages) !== old) buildViewer();
  else S.pages.forEach(p => { if (oldCE.get(p.id) !== ceKey(p)) refreshPage(p); else drawAnnots(p); });
  markDirty(); renderProps(); updateUndo();
  if (S.find) runFind(S.find.q);
}
let restoring = false;
async function undo() { commitEdit(); if (!S.hist.length || restoring) return; restoring = true; S.fut.push(snap()); try { await restore(S.hist.pop()); } finally { restoring = false; } }
async function redo() { commitEdit(); if (!S.fut.length || restoring) return; restoring = true; S.hist.push(snap()); try { await restore(S.fut.pop()); } finally { restoring = false; } }
function updateUndo() { $('#btnUndo').disabled = !S.hist.length; $('#btnRedo').disabled = !S.fut.length; }
function markDirty() { S.dirty = true; updateTitle(); scheduleAutosave(); }
function updateTitle() {
  const n = $('#docName');
  n.textContent = S.docName + (S.sample ? ' · Beispiel' : '') + (S.dirty && !S.sample ? ' ●' : '');
  n.title = S.docName;
}

/* ---------- Quellen laden ---------- */
async function addSource(bytes, name, fixedId) {
  const id = fixedId || uid('s');
  // mit Besitzer-Passwort geschützte PDFs entschlüsseln, sonst lassen sie sich nicht bearbeiten und speichern
  if (window.WBDecrypt && window.WBDecrypt.isEncrypted(bytes)) {
    const r = await window.WBDecrypt.plain(bytes);
    if (r.changed) { bytes = r.bytes; S.decrypted.add(id); setMsg(`„${name}“ war geschützt und wurde zum Bearbeiten entschlüsselt`); }
  }
  const pdf = await PDFJS.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  S.sources.set(id, { id, name, bytes, pdf });
  const out = [];
  for (let i = 0; i < pdf.numPages; i++) {
    const pg = await pdf.getPage(i + 1);
    S.proxies.set(id + ':' + i, pg);
    const vp = pg.getViewport({ scale: 1 });
    out.push({ id: uid('p'), src: id, idx: i, baseRot: pg.rotate || 0, rot: 0, w0: vp.width, h0: vp.height, annots: [] });
  }
  return out;
}
function dropSource(id) {
  const s = S.sources.get(id); if (!s) return;
  try { s.pdf.destroy(); } catch (e) { /* egal */ }
  S.sources.delete(id);
  for (const k of [...S.proxies.keys()]) if (k.startsWith(id + ':')) S.proxies.delete(k);
  for (const k of [...S.textCache.keys()]) if (k.startsWith(id + ':')) S.textCache.delete(k);
  for (const k of [...S.analysis.keys()]) if (k.startsWith(id + ':')) S.analysis.delete(k);
  for (const [k, d] of [...S.derived]) if (k.startsWith(id + ':')) { try { d.pdf.destroy(); } catch (e) { /* egal */ } S.derived.delete(k); }
  for (const k of [...S.forms.keys()]) if (k.startsWith(id + ':')) S.forms.delete(k);
  S.libDocs.delete(id);
}

/* ---------- Inhalte der PDF direkt bearbeiten ---------- */
async function libDocOf(src) {
  if (!S.libDocs.has(src)) S.libDocs.set(src, PL.PDFDocument.load(S.sources.get(src).bytes, { updateMetadata: false }));
  return S.libDocs.get(src);
}
const anPending = new Map();
function analysisOf(p) {
  const k = p.src + ':' + p.idx;
  if (S.analysis.has(k)) { const a = S.analysis.get(k); return a === 'error' ? Promise.reject(new Error('analyse')) : Promise.resolve(a); }
  if (!anPending.has(k)) {
    anPending.set(k, (async () => {
      try {
        if (!ENG) throw new Error('engine');
        const ld = await libDocOf(p.src);
        const an = ENG.analysePage(ld.getPage(p.idx));
        S.analysis.set(k, an); return an;
      } catch (e) { console.warn('Analyse fehlgeschlagen', e); S.analysis.set(k, 'error'); throw e; }
      finally { anPending.delete(k); }
    })());
  }
  return anPending.get(k);
}
async function ensureDerived(p) {
  if (!hasCE(p)) return;
  const k = pkey(p);
  if (S.derived.has(k)) return;
  const ld = await libDocOf(p.src), an = await analysisOf(p);
  const out = await PL.PDFDocument.create();
  const [pg] = await out.copyPages(ld, [p.idx]);
  out.addPage(pg);
  ENG.editPage(out, pg, an, p.ce);
  const bytes = await out.save();
  const pdf = await PDFJS.getDocument({ data: bytes, isEvalSupported: false }).promise;
  S.derived.set(k, { pdf, page: await pdf.getPage(1) });
  if (S.derived.size > 60) {
    const live = new Set(S.pages.map(pkey));
    for (const [dk, d] of S.derived) { if (S.derived.size <= 40) break; if (!live.has(dk)) { try { d.pdf.destroy(); } catch (e) { /* egal */ } S.derived.delete(dk); } }
  }
}
function newCE(p) { const c = p.ce || {}; return { del: [...(c.del || [])], rep: { ...(c.rep || {}) }, tf: { ...(c.tf || {}) }, red: (c.red || []).map(r => r.slice()), dup: (c.dup || []).map(d => ({ id: d.id, back: d.back, items: d.items.map(([i, A]) => [i, A.slice()]) })), zf: [...(c.zf || [])], zb: [...(c.zb || [])] }; }
async function applyCE(p) {
  busy(true, 'Seite wird neu aufgebaut …');
  try { await ensureDerived(p); }
  catch (e) { console.error(e); toast('Diese Seite konnte nicht verändert werden.'); }
  finally { busy(false); }
  refreshPage(p); markDirty(); renderProps();
  if (S.find) runFind(S.find.q);
}
const citemCache = new Map();
function cItems(p) {
  const an = S.analysis.get(p.src + ':' + p.idx);
  if (!an) { analysisOf(p).then(() => drawCUI(p), () => {}); return null; }
  if (an === 'error') return [];
  const k = p.id + '|' + ceKey(p) + '|' + rotOf(p);
  if (citemCache.has(k)) return citemCache.get(k);
  const proxy = proxyOf(p); if (!proxy) return [];
  const del = new Set((p.ce && p.ce.del) || []), rep = (p.ce && p.ce.rep) || {}, tf = (p.ce && p.ce.tf) || {}, red = (p.ce && p.ce.red) || [];
  // durch Schwärzen entfernte Objekte gelten als gelöscht, teilweise geschwärzter Text verliert die Zeichen
  const masked = new Map();
  if (red.length) for (const o of an.objects) {
    if (del.has(o.i)) continue;
    const info = ENG.redactInfo(o, tf[o.i], red);
    if (info === 'all') del.add(o.i);
    else if (info && o.kind === 'text') {
      const chars = Array.from(o.text);
      const t = chars.length === info.length ? chars.map((ch, k) => (info[k] ? ' ' : ch)).join('') : '';
      if (!t.trim()) del.add(o.i); else masked.set(o.i, t);
    }
  }
  const X = (b, i) => ENG.xbox(b, tf[i]);
  const tpt = (m, q) => (m ? [m[0] * q[0] + m[2] * q[1] + m[4], m[1] * q[0] + m[3] * q[1] + m[5]] : q);
  const vp = proxy.getViewport({ scale: 1, rotation: rotOf(p) });
  const db = b => {
    const pts = [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]].map(q => vp.convertToViewportPoint(q[0], q[1]));
    const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]), x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  };
  const union = objs => [Math.min(...objs.map(o => o.bbox[0])), Math.min(...objs.map(o => o.bbox[1])), Math.max(...objs.map(o => o.bbox[2])), Math.max(...objs.map(o => o.bbox[3]))];
  const items = [];
  for (const g of an.groups) {
    const first = g.first, rt = rep[first.i], A = tf[first.i];
    const alive = g.objs.filter(o => !del.has(o.i));
    let text, ub;
    if (rt !== undefined) {
      text = rt;
      const w = measure(rt, { bold: false, size: first.fs, font: 'Helvetica' });
      ub = first.dir[0] > 0 && Math.abs(first.dir[1]) < 1e-6 ? [first.bbox[0], first.bbox[1], Math.max(first.bbox[2], first.base[0] + w), first.bbox[3]] : first.bbox;
    } else {
      if (!alive.some(o => !o.blank)) continue;
      text = ENG.joinText(alive.map(o => (masked.has(o.i) ? { ...o, text: masked.get(o.i) } : o))).replace(/\s{2,}/g, ' ').trim(); ub = union(alive);
    }
    const scale = A ? Math.sqrt(Math.abs(A[0] * A[3] - A[1] * A[2])) : 1;
    items.push({ kind: 'text', ids: g.objs.map(o => o.i), firstId: first.i, text: text.trimEnd(), box: db(ENG.xbox(ub, A)), fs: first.fs * scale, font: first.font, fill: first.fill, base: tpt(A, first.base), dir: first.dir, redacted: g.objs.some(o => masked.has(o.i) || (red.length && del.has(o.i) && !(p.ce.del || []).includes(o.i))) });
  }
  for (const o of an.objects) if (o.kind !== 'text' && !del.has(o.i)) items.push({ kind: o.kind, ids: [o.i], box: db(X(o.bbox, o.i)) });
  // eingefügte Kopien von PDF-Inhalten als eigene Elemente
  const byI = new Map(an.objects.map(o => [o.i, o]));
  for (const d of (p.ce && p.ce.dup) || []) {
    const bs = d.items.map(([i, A]) => byI.get(i) && ENG.xbox(byI.get(i).bbox, A)).filter(Boolean);
    if (!bs.length) continue;
    const ub = [Math.min(...bs.map(b => b[0])), Math.min(...bs.map(b => b[1])), Math.max(...bs.map(b => b[2])), Math.max(...bs.map(b => b[3]))];
    const txt = d.items.map(([i]) => byI.get(i)).filter(o => o && o.kind === 'text').map(o => o.text).join('').replace(/\s+/g, ' ').trim();
    items.push({ kind: 'copy', ids: [d.id], box: db(ub), text: txt });
  }
  citemCache.set(k, items);
  return items;
}
function itemAt(p, pt, kind) {
  const items = cItems(p); if (!items) return null;
  const tol = (COARSE ? 6 : 2) / S.zoom;
  let best = null;
  for (const it of items) {
    if (kind && it.kind !== kind) continue;
    const b = it.box;
    if (pt[0] >= b.x - tol && pt[0] <= b.x + b.w + tol && pt[1] >= b.y - tol && pt[1] <= b.y + b.h + tol) {
      const area = Math.max(b.w, 0.5) * Math.max(b.h, 0.5) * (it.kind === 'text' ? 0.5 : 1);
      if (!best || area < best.area) best = { it, area };
    }
  }
  return best ? best.it : null;
}
const KIND_NAMES = { text: 'Text', path: 'Fläche', image: 'Bild', form: 'Grafik', copy: 'Kopie' };
function cuiSVG(p) {
  let out = '';
  const box = (b, cls) => `<rect class="${cls}" x="${r2(b.x)}" y="${r2(b.y)}" width="${r2(Math.max(b.w, 1))}" height="${r2(Math.max(b.h, 1))}"/>`;
  if (S.csel && S.csel.pid === p.id) {
    for (const it of S.csel.items) out += box(it.box, 'csel');
    const u = cselBox(), pad = 4 / S.zoom, hs = (COARSE ? 16 : 9) / S.zoom;
    if (S.csel.items.length > 1) out += box({ x: u.x - pad, y: u.y - pad, w: u.w + 2 * pad, h: u.h + 2 * pad }, 'cunion');
    out += `<rect class="handle" x="${r2(u.x + u.w + pad - hs / 2)}" y="${r2(u.y + u.h + pad - hs / 2)}" width="${r2(hs)}" height="${r2(hs)}"/>`;
  }
  if (S.hover && S.hover.pid === p.id && !(S.csel && S.csel.items.includes(S.hover.it))) out += box(S.hover.it.box, 'chov');
  return out;
}
function cselBox(items) {
  items = items || (S.csel ? S.csel.items : []);
  const x = Math.min(...items.map(i => i.box.x)), y = Math.min(...items.map(i => i.box.y));
  return { x, y, w: Math.max(...items.map(i => i.box.x + i.box.w)) - x, h: Math.max(...items.map(i => i.box.y + i.box.h)) - y };
}
function onCselHandle(pt) {
  if (!S.csel) return false;
  const u = cselBox(), pad = 4 / S.zoom, hs = (COARSE ? 22 : 11) / S.zoom;
  return Math.abs(pt[0] - (u.x + u.w + pad)) <= hs && Math.abs(pt[1] - (u.y + u.h + pad)) <= hs;
}
function inCsel(pt) {
  if (!S.csel) return false;
  const tol = (COARSE ? 6 : 2) / S.zoom;
  return S.csel.items.some(it => pt[0] >= it.box.x - tol && pt[0] <= it.box.x + it.box.w + tol && pt[1] >= it.box.y - tol && pt[1] <= it.box.y + it.box.h + tol);
}

/* Transformation der ausgewählten PDF-Inhalte (Matrix im PDF-Koordinatensystem) */
function d2u(p) { const vp = proxyOf(p).getViewport({ scale: 1, rotation: rotOf(p) }); return (x, y) => vp.convertToPdfPoint(x, y); }
async function transformContent(p, items, M, msg) {
  if (!items.length || ENG.isId(M)) return;
  pushHist();
  const ce = newCE(p), ids = new Set(items.flatMap(it => it.ids));
  for (const i of ids) {
    const d = typeof i === 'string' && ce.dup.find(x => x.id === i);
    if (d) d.items = d.items.map(([j, A]) => [j, ENG.mul(A, M)]);
    else ce.tf[i] = ENG.mul(ce.tf[i] || [1, 0, 0, 1, 0, 0], M);
  }
  p.ce = ce;
  S.hover = null;
  await applyCE(p);
  const fresh = cItems(p) || [];
  setCsel(p.id, fresh.filter(it => it.ids.some(i => ids.has(i))));
  if (msg) toast(msg);
}
function moveMatrix(p, dx, dy, from) {
  const f = d2u(p), a = f(from[0], from[1]), b = f(from[0] + dx, from[1] + dy);
  return [1, 0, 0, 1, b[0] - a[0], b[1] - a[1]];
}
function scaleMatrix(p, k, anchor) {
  const [ax, ay] = d2u(p)(anchor[0], anchor[1]);
  return [k, 0, 0, k, ax * (1 - k), ay * (1 - k)];
}
function rotateContent(dir) {
  const cs = S.csel; if (!cs) return;
  const p = pageById(cs.pid), u = cselBox();
  const [cx, cy] = d2u(p)(u.x + u.w / 2, u.y + u.h / 2);
  const t = -dir * Math.PI / 2, c = Math.round(Math.cos(t)), s = Math.round(Math.sin(t));
  transformContent(p, cs.items, [c, s, -s, c, cx - cx * c + cy * s, cy - cx * s - cy * c]);
}
/* Ebenen der PDF-Inhalte: ganz nach vorne oder ganz nach hinten.
   Ein seitenfüllender Hintergrund (Bild oder Fläche) bleibt dabei ganz hinten, sonst würde er alles verdecken. */
async function zContent(front) {
  const cs = S.csel; if (!cs) return;
  const p = pageById(cs.pid), ids = cs.items.flatMap(it => it.ids);
  const num = ids.filter(i => typeof i === 'number').sort((a, b) => a - b), strs = new Set(ids.filter(i => typeof i === 'string'));
  pushHist();
  const ce = newCE(p);
  ce.zf = ce.zf.filter(i => !num.includes(i)); ce.zb = ce.zb.filter(i => !num.includes(i));
  if (front) ce.zf.push(...num);
  else {
    const [W, H] = dims(p), first = num.length ? num[0] : Infinity;
    const bg = (cItems(p) || []).filter(it => it.kind !== 'text' && it.kind !== 'copy' && it.ids[0] < first && it.box.w * it.box.h >= 0.8 * W * H).map(it => it.ids[0]);
    ce.zb = bg.sort((a, b) => a - b).concat(num, ce.zb.filter(i => !bg.includes(i)));
  }
  for (const d of ce.dup) if (strs.has(d.id)) { if (front) delete d.back; else d.back = true; }
  if (front && strs.size) ce.dup = ce.dup.filter(d => !strs.has(d.id)).concat(ce.dup.filter(d => strs.has(d.id)));
  p.ce = ce; S.hover = null;
  await applyCE(p);
  const set = new Set(ids);
  setCsel(p.id, (cItems(p) || []).filter(it => it.ids.some(i => set.has(i))));
  toast(front ? 'In den Vordergrund gebracht' : 'In den Hintergrund gelegt');
}
/* Ausgewählte PDF-Inhalte hervorheben: Textmarkierung über den Elementen, mit deren Text */
function markContent() {
  const cs = S.csel; if (!cs) return;
  const p = pageById(cs.pid), tp = TP.hl;
  const rects = cs.items.map(it => ({ x: r2(it.box.x - 1), y: r2(it.box.y - 1), w: r2(it.box.w + 2), h: r2(it.box.h + 2) }));
  const text = cs.items.map(it => it.text || '').filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const a = { id: uid(), t: 'mark', kind: 'hl', rects, text, color: tp.color, op: tp.op };
  if (rotOf(p) % 180) a.vert = true;
  pushHist(); p.annots.push(a); markDirty(); drawAnnots(p);
  setCsel(null, []);
  setMsg(text ? `Hervorgehoben: „${text.length > 60 ? text.slice(0, 59) + '…' : text}“` : 'Hervorgehoben');
  if (S.prefs.askComment) editComment(p, a);
}
let nudge = null;
function nudgeContent(dx, dy) {
  const cs = S.csel; if (!cs) return;
  const p = pageById(cs.pid);
  if (!nudge) nudge = { dx: 0, dy: 0, p, items: cs.items };
  nudge.dx += dx; nudge.dy += dy;
  showGhost(p, cs.items, nudge.dx, nudge.dy, 1);
  clearTimeout(nudge.t);
  nudge.t = setTimeout(() => {
    const n = nudge; nudge = null; hideGhost();
    transformContent(n.p, n.items, moveMatrix(n.p, n.dx, n.dy, [cselBox(n.items).x, cselBox(n.items).y]));
  }, 450);
}

/* Vorschau beim Ziehen: Ausschnitt der gerenderten Seite folgt dem Finger */
function showGhost(p, items, dx, dy, k) {
  const e = els.get(p.id); if (!e || !e.cv || e.cv.width < 2) return;
  const [W] = dims(p), z = S.zoom, s = e.cv.width / W, u = cselBox(items);
  let g = e.ghost;
  if (!g || g.dataset.key !== JSON.stringify(u)) {
    if (g) g.remove();
    g = document.createElement('canvas'); g.className = 'ghost'; g.dataset.key = JSON.stringify(u);
    g.width = Math.max(1, Math.round(u.w * s)); g.height = Math.max(1, Math.round(u.h * s));
    const ctx = g.getContext('2d');
    for (const it of items) {
      const b = it.box;
      ctx.drawImage(e.cv, b.x * s, b.y * s, b.w * s, b.h * s, (b.x - u.x) * s, (b.y - u.y) * s, b.w * s, b.h * s);
    }
    Object.assign(g.style, { left: u.x * z + 'px', top: u.y * z + 'px', width: u.w * z + 'px', height: u.h * z + 'px' });
    e.wrap.append(g); e.ghost = g;
  }
  g.style.transform = `translate(${dx * z}px, ${dy * z}px) scale(${k})`;
}
function hideGhost() { for (const e of els.values()) if (e.ghost) { e.ghost.remove(); e.ghost = null; } }

/* Ausrichtungshilfen: Kanten und Mitten von Seite, Kommentaren und PDF-Inhalten */
function snapLines(p, skipIds, skipAnnot, skipAnnotIds) {
  const [W, H] = dims(p), xs = [0, W / 2, W], ys = [0, H / 2, H];
  for (const a of p.annots) if (a !== skipAnnot && !(skipAnnotIds && skipAnnotIds.has(a.id))) { const b = bbox(a); xs.push(b.x, b.x + b.w / 2, b.x + b.w); ys.push(b.y, b.y + b.h / 2, b.y + b.h); }
  const items = S.analysis.get(p.src + ':' + p.idx) ? cItems(p) || [] : [];
  for (const it of items) {
    if (skipIds && it.ids.some(i => skipIds.has(i))) continue;
    const b = it.box; if (b.w * b.h > W * H * 0.6) continue;
    xs.push(b.x, b.x + b.w / 2, b.x + b.w); ys.push(b.y, b.y + b.h / 2, b.y + b.h);
  }
  return { xs, ys, W, H };
}
function snapBox(lines, b, noSnap) {
  if (noSnap || !S.prefs.snap) return { dx: 0, dy: 0, svg: '' };
  const tol = 5 / S.zoom;
  const pick = (cands, vals) => {
    let best = null;
    for (const v of vals) for (const c of cands) { const d = c - v; if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: c }; }
    return best;
  };
  const bx = pick(lines.xs, [b.x, b.x + b.w / 2, b.x + b.w]), by = pick(lines.ys, [b.y, b.y + b.h / 2, b.y + b.h]);
  let svg = '';
  if (bx) svg += `<line class="guide" x1="${r2(bx.at)}" y1="0" x2="${r2(bx.at)}" y2="${r2(lines.H)}"/>`;
  if (by) svg += `<line class="guide" x1="0" y1="${r2(by.at)}" x2="${r2(lines.W)}" y2="${r2(by.at)}"/>`;
  return { dx: bx ? bx.d : 0, dy: by ? by.d : 0, svg };
}
function drawCUI(p) { const e = p && els.get(p.id); if (e) { const g = $('.cui', e.svg); if (g) g.innerHTML = cuiSVG(p); } }
function setCsel(pid, items) {
  const prev = S.csel ? pageById(S.csel.pid) : null;
  S.csel = pid && items.length ? { pid, items } : null;
  if (prev) drawCUI(prev);
  if (pid) drawCUI(pageById(pid));
  renderProps();
}
function deleteContent() {
  const cs = S.csel; if (!cs || !cs.items.length) return;
  const p = pageById(cs.pid); if (!p) return;
  pushHist();
  const ce = newCE(p);
  for (const it of cs.items) for (const i of it.ids) {
    if (typeof i === 'string') { ce.dup = ce.dup.filter(d => d.id !== i); continue; }
    if (!ce.del.includes(i)) ce.del.push(i); delete ce.rep[i]; delete ce.tf[i];
  }
  p.ce = ce;
  const n = cs.items.length;
  S.csel = null; S.hover = null;
  applyCE(p).then(() => toast(n === 1 ? 'Element aus der PDF entfernt' : `${n} Elemente aus der PDF entfernt`));
}
function fontGuess(p, it) {
  const an = S.analysis.get(p.src + ':' + p.idx);
  const f = an && an !== 'error' ? an.fonts.get(it.font) : null;
  const b = ((f && f.base) || '').replace(/^[A-Z]{6}\+/, '');
  return { name: /mono|courier|consol/i.test(b) ? 'Courier' : /times|serif|garamond|georgia|minion|cambria|book/i.test(b) && !/sans/i.test(b) ? 'Times' : 'Helvetica', bold: /bold|black|heavy|semibold/i.test(b), base: b };
}
const toHex = c => '#' + (c || [0, 0, 0]).map(v => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
function editContentText(p, it) {
  commitEdit();
  const el = els.get(p.id); if (!el || !it || it.kind !== 'text') return;
  const fg = fontGuess(p, it);
  const ta = document.createElement('textarea');
  ta.className = 'ted ced'; ta.value = it.text; ta.spellcheck = false; ta.rows = 1;
  ta.setAttribute('aria-label', 'Text in der PDF bearbeiten');
  const z = S.zoom, size = it.fs;
  const fit = () => {
    const w = Math.max(it.box.w, measure(ta.value || ' ', { bold: fg.bold, size, font: fg.name }) + size);
    ta.style.width = (w + 6) * z + 'px';
  };
  Object.assign(ta.style, { left: (it.box.x - 3) * z + 'px', top: it.box.y * z + 'px', height: it.box.h * z + 'px', font: `${fg.bold ? 700 : 400} ${size * z}px/${it.box.h / size} ${FONT(fg.name).css}`, paddingLeft: 3 * z + 'px' });
  fit();
  el.wrap.append(ta);
  S.cedit = { p, it, ta };
  setCsel(null, []);
  requestAnimationFrame(() => { ta.focus(); ta.select(); });
  ta.addEventListener('input', fit);
  ta.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' || ev.key === 'Escape') { ev.preventDefault(); if (ev.key === 'Escape') ta.value = it.text; commitEdit(); }
    ev.stopPropagation();
  });
  ta.addEventListener('blur', () => setTimeout(() => { if (S.cedit && S.cedit.ta === ta && document.activeElement !== ta) commitEdit(); }, 0));
  renderProps();
}
function commitCEdit() {
  const ed = S.cedit; if (!ed) return;
  S.cedit = null;
  const { p, it, ta } = ed;
  const txt = ta.value.replace(/\s*\n\s*/g, ' ').replace(/\s+$/, '');
  ta.remove();
  if (txt === it.text) { renderProps(); return; }
  const an = S.analysis.get(p.src + ':' + p.idx);
  if (!an || an === 'error') return;
  pushHist();
  const ce = newCE(p);
  const delAll = () => { for (const i of it.ids) { if (!ce.del.includes(i)) ce.del.push(i); delete ce.rep[i]; } };
  const first = an.objects.find(o => o.i === it.firstId);
  let fallback = false;
  if (!txt.trim()) delAll();
  else if (first && !it.redacted && ENG.canEncode(an, first, txt)) {
    for (const i of it.ids) if (i !== it.firstId) { if (!ce.del.includes(i)) ce.del.push(i); delete ce.rep[i]; }
    ce.del = ce.del.filter(i => i !== it.firstId);
    ce.rep[it.firstId] = txt;
  } else {
    delAll(); fallback = true;
    const fg = fontGuess(p, it), vp = proxyOf(p).getViewport({ scale: 1, rotation: rotOf(p) });
    const [bx, by] = vp.convertToViewportPoint(it.base[0], it.base[1]);
    const size = Math.max(4, Math.round(it.fs * 2) / 2);
    p.annots.push({ id: uid(), t: 'text', x: bx, y: by - FONT(fg.name).bl * size, text: txt, color: toHex(it.fill), size, font: fg.name, bold: fg.bold });
  }
  p.ce = ce;
  applyCE(p).then(() => {
    if (fallback) toast('Die Originalschrift enthält nicht alle Zeichen. Der Text wurde in Helvetica neu gesetzt.');
    else if (!txt.trim()) toast('Textzeile aus der PDF entfernt');
  });
}
async function openFiles(files, mode, noAsk) {
  const pdfs = [...files].filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (!pdfs.length) { toast('Bitte eine PDF-Datei wählen.'); return; }
  if (S.busy) return;
  commitEdit();
  if (mode === 'replace' && S.lib && LIB) { await openIntoLibrary(pdfs); return; }
  if (mode === 'replace' && S.dirty && !S.sample && !noAsk) {
    if (!await ask('Ungespeicherte Änderungen verwerfen?', `Wenn du „${pdfs[0].name}“ öffnest, gehen die Änderungen an „${S.docName}“ verloren.`)) return;
  }
  busy(true, 'PDF wird geladen …');
  const oldIds = [...S.sources.keys()];
  const newIds = [];
  try {
    const added = [];
    for (const f of pdfs) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const before = new Set(S.sources.keys());
      added.push(...await addSource(bytes, f.name));
      for (const k of S.sources.keys()) if (!before.has(k)) newIds.push(k);
    }
    // Inhaltsverzeichnis der geöffneten Dateien als Lesezeichen übernehmen
    const marks = [];
    for (const id of newIds) marks.push(...await importOutline(id, added.filter(p => p.src === id)));
    if (mode === 'replace') {
      oldIds.forEach(dropSource);
      S.blankSrc = null; S.paperSrc.clear();
      S.bookmarks = marks; S.formVals = {}; S.formTouched.clear();
      S.pages = added; S.docName = pdfs[0].name; S.sample = false;
      S.hist = []; S.fut = []; S.dirty = false; S.cur = 0; S.sel = null; S.selPages.clear(); S.find = null;
      $('#findInput').value = ''; $('#findCount').textContent = '';
      S.zoom = initialZoom();
      S.meta = { title: '', author: '', subject: '', keywords: '' };
      try {
        const info = (await S.sources.get(added[0].src).pdf.getMetadata()).info || {};
        S.meta = { title: info.Title || '', author: info.Author || '', subject: info.Subject || '', keywords: info.Keywords || '' };
      } catch (e) { /* keine Metadaten */ }
      buildViewer(); viewer.scrollTop = 0;
      scheduleAutosave();
    } else {
      pushHist();
      const at = S.pages.length;
      S.pages.push(...added);
      S.bookmarks.push(...marks);
      markDirty(); buildViewer(); scrollToPage(at);
      toast(`${added.length} Seite${added.length === 1 ? '' : 'n'} angehängt`);
    }
    updateTitle(); updateUndo();
  } catch (err) {
    console.error(err);
    newIds.forEach(dropSource);
    toast(err && err.name === 'PasswordException' ? 'Diese PDF ist passwortgeschützt und kann hier nicht geöffnet werden.' : 'Die Datei konnte nicht als PDF gelesen werden.');
  } finally { busy(false); }
}

/* ---------- Ansicht ---------- */
const io = new IntersectionObserver(entries => {
  for (const en of entries) {
    const p = pageById(en.target.dataset.id); if (!p) continue;
    if (en.isIntersecting) renderPage(p); else releasePage(p);
  }
}, { root: viewer, rootMargin: '1200px 0px' });

function sizePageEl(p, e) {
  const [W, H] = dims(p);
  e.wrap.style.width = W * S.zoom + 'px';
  e.wrap.style.height = H * S.zoom + 'px';
  e.wrap.style.setProperty('--z', S.zoom);
  e.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  if (e.under) e.under.setAttribute('viewBox', `0 0 ${W} ${H}`);
}
function buildViewer() {
  io.disconnect();
  for (const e of els.values()) if (e.task) try { e.task.cancel(); } catch (x) { /* egal */ }
  els.clear(); pagesEl.textContent = ''; S.csel = null; S.hover = null;
  S.pages.forEach((p, i) => {
    const wrap = document.createElement('div'); wrap.className = 'page'; wrap.dataset.id = p.id;
    const cv = document.createElement('canvas'); cv.className = 'pcv'; cv.width = 1; cv.height = 1;
    const svg = document.createElementNS(SVGNS, 'svg'); svg.classList.add('ov');
    const under = document.createElementNS(SVGNS, 'svg'); under.classList.add('ov', 'un'); // eigene Elemente hinter dem PDF-Inhalt
    const num = document.createElement('div'); num.className = 'pnum'; num.textContent = i + 1;
    const hbl = document.createElement('div'); hbl.className = 'hbl';
    const forml = document.createElement('div'); forml.className = 'forml';
    wrap.append(under, cv, svg, hbl, forml, num);
    pagesEl.append(wrap);
    const e = { wrap, cv, svg, under, hbl, forml, key: null, task: null };
    els.set(p.id, e); sizePageEl(p, e); drawAnnots(p); io.observe(wrap);
    buildFormLayer(p);
  });
  S.cur = clamp(S.cur, 0, S.pages.length - 1);
  buildThumbs(); updateStatus(); renderProps(); updateSideLater();
  ensureFontsOf(S.pages);
}
async function renderPage(p) {
  const e = els.get(p.id); if (!e) return;
  const R = rotOf(p), key = S.zoom + '|' + R + '|' + ceKey(p);
  if (e.key === key) return;
  e.key = key;
  if (e.task) { try { e.task.cancel(); } catch (x) { /* egal */ } e.task = null; }
  const proxy = proxyOf(p); if (!proxy) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const base = proxy.getViewport({ scale: 1, rotation: R });
  let scale = S.zoom * dpr;
  const maxPx = 16e6;
  if (base.width * base.height * scale * scale > maxPx) scale = Math.sqrt(maxPx / (base.width * base.height));
  const vp = proxy.getViewport({ scale, rotation: R });
  const c = document.createElement('canvas'); c.className = 'pcv';
  c.width = Math.max(1, Math.floor(vp.width)); c.height = Math.max(1, Math.floor(vp.height));
  // Formularfelder zeichnet die Werkbank selbst als bearbeitbare Felder darüber
  const task = proxy.render({ canvasContext: c.getContext('2d'), viewport: vp, annotationMode: PDFJS.AnnotationMode ? PDFJS.AnnotationMode.ENABLE_FORMS : undefined, background: 'rgba(0,0,0,0)' });
  e.task = task;
  try { await task.promise; } catch (err) { if (err && err.name !== 'RenderingCancelledException') console.error(err); return; }
  if (e.key !== key || els.get(p.id) !== e) return;
  e.task = null; e.cv.replaceWith(c); e.cv = c;
}
function releasePage(p) {
  const e = els.get(p.id); if (!e || !e.key) return;
  if (e.task) { try { e.task.cancel(); } catch (x) { /* egal */ } e.task = null; }
  e.key = null; e.cv.width = 1; e.cv.height = 1;
}
function nearView(el) { const r = el.getBoundingClientRect(), v = viewer.getBoundingClientRect(); return r.bottom > v.top - 1200 && r.top < v.bottom + 1200; }
function renderVisible() { for (const p of S.pages) { const e = els.get(p.id); if (e && nearView(e.wrap)) renderPage(p); } }
function refreshPage(p) {
  const e = els.get(p.id);
  if (e) { sizePageEl(p, e); e.key = null; if (nearView(e.wrap)) renderPage(p); else releasePage(p); drawAnnots(p); buildFormLayer(p); }
  const t = tels.get(p.id);
  if (t) { sizeThumb(p); t.key = null; renderThumb(p); }
}
function selUI(a) {
  const b = bbox(a), z = S.zoom, pad = 3 / z, hs = (COARSE ? 16 : 9) / z;
  if (a.t === 'note') return `<rect class="selbox" x="${r2(b.x - pad)}" y="${r2(b.y - pad)}" width="${r2(b.w + 2 * pad)}" height="${r2(b.h + 2 * pad)}"/>`;
  return `<rect class="selbox" x="${r2(b.x - pad)}" y="${r2(b.y - pad)}" width="${r2(b.w + 2 * pad)}" height="${r2(b.h + 2 * pad)}"/>` +
    `<rect class="handle" x="${r2(b.x + b.w + pad - hs / 2)}" y="${r2(b.y + b.h + pad - hs / 2)}" width="${r2(hs)}" height="${r2(hs)}"/>`;
}
function drawAnnots(p) {
  if (!p) return;
  const e = els.get(p.id); if (!e) return;
  // neues Element bei ausgeblendeten Markierungen: wieder einblenden, sonst wirkt es, als sei nichts passiert
  if (e.nAnn != null && p.annots.length > e.nAnn && !S.prefs.showMarks) {
    S.prefs.showMarks = true; savePrefs(); pagesEl.classList.remove('hidemarks'); updateSideLater();
    toast('Markierungen und Kommentare werden wieder angezeigt (war in den Einstellungen ausgeschaltet)');
  }
  e.nAnn = p.annots.length;
  const editId = S.editing ? S.editing.a.id : null;
  const vis = p.annots.filter(a => a.id !== editId);
  const ann = vis.filter(a => !a.under).map(annotSVG).join('') + vis.filter(a => a.comment && a.t !== 'note').map(a => {
    const b = bbox(a);
    return `<g class="cmk" transform="translate(${r2(b.x + b.w + 1)} ${r2(b.y - 1)})"><title>${esc(a.comment)}</title><path d="M0 -10h11a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H5l-3.5 3v-3H0a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 0 -10z"/></g>`;
  }).join('');
  // Griffflächen als HTML, damit touch-action greift: ein Finger auf einem Element verschiebt es statt zu scrollen
  if (e.hbl) {
    const [W, H] = dims(p), tol = COARSE ? 8 : 2;
    e.hbl.innerHTML = vis.map(a => {
      const b = bbox(a);
      return `<div style="left:${(b.x - tol) / W * 100}%;top:${(b.y - tol) / H * 100}%;width:${(b.w + 2 * tol) / W * 100}%;height:${(b.h + 2 * tol) / H * 100}%"></div>`;
    }).join('');
  }
  const a = selAnnot();
  let ui = a && S.sel.pid === p.id ? selUI(a) : '';
  if (S.msel && S.msel.pid === p.id) {
    const list = p.annots.filter(x => S.msel.ids.includes(x.id)), pad = 3 / S.zoom;
    if (list.length) {
      const u = unionBox(list);
      ui = list.map(x => { const b = bbox(x); return `<rect class="msel" x="${r2(b.x)}" y="${r2(b.y)}" width="${r2(b.w)}" height="${r2(b.h)}"/>`; }).join('') +
        `<rect class="selbox" x="${r2(u.x - pad)}" y="${r2(u.y - pad)}" width="${r2(u.w + 2 * pad)}" height="${r2(u.h + 2 * pad)}"/>`;
    }
  }
  if (e.under) e.under.innerHTML = `<g class="ann">${vis.filter(a => a.under).map(annotSVG).join('')}</g>`;
  e.svg.innerHTML = `<g class="ann">${ann}</g><g class="hits">${hitsSVG(p)}</g><g class="cui">${cuiSVG(p)}</g><g class="draft"></g><g class="ui">${ui}</g>`;
  drawQbar(p, e);
  queueThumb(p);
  updateSideLater();
}
function drawDraft(p, a) { const e = els.get(p.id); if (e) $('.draft', e.svg).innerHTML = a ? annotSVG(a) : ''; }

/* ---------- Miniaturen ---------- */
const tio = new IntersectionObserver(entries => {
  for (const en of entries) if (en.isIntersecting) { const p = pageById(en.target.dataset.id); if (p) renderThumb(p); }
}, { root: thumbsEl, rootMargin: '400px 0px' });
function buildThumbs() {
  tio.disconnect(); tels.clear(); thumbsEl.textContent = '';
  S.pages.forEach((p, i) => {
    const t = document.createElement('div'); t.className = 'thumb'; t.dataset.id = p.id; t.draggable = true;
    t.title = `Seite ${i + 1} · ziehen zum Umsortieren`;
    const box = document.createElement('div'); box.className = 'tbox';
    const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1;
    const svg = document.createElementNS(SVGNS, 'svg');
    box.append(cv, svg);
    const n = document.createElement('span'); n.className = 'tn'; n.textContent = i + 1;
    t.append(box, n); thumbsEl.append(t);
    tels.set(p.id, { t, box, cv, svg, key: null, s: 1 });
    sizeThumb(p); updThumbSvg(p); tio.observe(t);
  });
  markThumbSel();
}
function sizeThumb(p) {
  const e = tels.get(p.id); if (!e) return;
  const [W, H] = dims(p), s = Math.min(112 / W, 148 / H);
  e.s = s; e.box.style.width = W * s + 'px'; e.box.style.height = H * s + 'px';
  e.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
}
async function renderThumb(p) {
  const e = tels.get(p.id); if (!e) return;
  const R = rotOf(p), key = R + '|' + ceKey(p);
  if (e.key === key) return;
  e.key = key;
  const proxy = proxyOf(p); if (!proxy) return;
  const vp = proxy.getViewport({ scale: e.s * Math.min(window.devicePixelRatio || 1, 2), rotation: R });
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.floor(vp.width)); c.height = Math.max(1, Math.floor(vp.height));
  try { await proxy.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise; } catch (err) { return; }
  if (e.key !== key || tels.get(p.id) !== e) return;
  e.cv.replaceWith(c); e.cv = c;
}
function updThumbSvg(p) { const e = tels.get(p.id); if (e) e.svg.innerHTML = p.annots.map(annotSVG).join(''); }
const thumbQ = new Set(); let thumbRaf = 0;
function queueThumb(p) {
  thumbQ.add(p.id);
  if (!thumbRaf) thumbRaf = requestAnimationFrame(() => { thumbRaf = 0; for (const id of thumbQ) { const q = pageById(id); if (q) updThumbSvg(q); } thumbQ.clear(); });
}
function markThumbSel() {
  S.pages.forEach((p, i) => {
    const e = tels.get(p.id); if (!e) return;
    e.t.classList.toggle('cur', i === S.cur);
    e.t.classList.toggle('sel', S.selPages.size > 1 && S.selPages.has(p.id));
  });
}

/* ---------- Seite, Zoom, Status ---------- */
function setCurrent(i, fromScroll) {
  if (i < 0 || i >= S.pages.length) return;
  const changed = i !== S.cur;
  S.cur = i;
  if (fromScroll && S.selPages.size <= 1) S.selPages.clear();
  markThumbSel(); updateStatus();
  if (changed) rememberPos();
  if (changed && fromScroll) { const e = tels.get(S.pages[i].id); if (e && !work.classList.contains('nothumbs')) e.t.scrollIntoView({ block: 'nearest' }); }
}
function scrollToPage(i) {
  const p = S.pages[i]; if (!p) return;
  const e = els.get(p.id);
  viewer.scrollTo({ top: e.wrap.offsetTop - 16, behavior: reduceMotion ? 'auto' : 'smooth' });
  setCurrent(i);
}
let scrollRaf = 0;
viewer.addEventListener('scroll', () => {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    const v = viewer.getBoundingClientRect(), line = v.top + v.height * 0.35;
    for (let i = 0; i < S.pages.length; i++) {
      const r = els.get(S.pages[i].id).wrap.getBoundingClientRect();
      if (r.bottom >= line) { if (i !== S.cur) setCurrent(i, true); break; }
    }
  });
}, { passive: true });

function paperLabel(W, H) {
  const mw = Math.round(W * 25.4 / 72), mh = Math.round(H * 25.4 / 72);
  const a = Math.min(mw, mh), b = Math.max(mw, mh);
  const known = [['A3', 297, 420], ['A4', 210, 297], ['A5', 148, 210], ['A6', 105, 148], ['Letter', 216, 279], ['Legal', 216, 356]];
  const k = known.find(([, x, y]) => Math.abs(a - x) <= 3 && Math.abs(b - y) <= 3);
  return (k ? `${k[0]} ${mw > mh ? 'quer' : 'hoch'} · ` : '') + `${mw} × ${mh} mm`;
}
function updateStatus() {
  const p = S.pages[S.cur];
  $('#stPage').textContent = p ? `Seite ${S.cur + 1} / ${S.pages.length}` : '–';
  $('#stSize').textContent = p ? paperLabel(...dims(p)) : '';
  const z = Math.round(S.zoom * 100) + ' %';
  $('#stZoom').textContent = 'Zoom ' + z; $('#zoomLbl').textContent = z;
  $('#readPage').textContent = p ? `${S.cur + 1} / ${S.pages.length}` : '';
}
function fitZoom() {
  const maxW = Math.max(...S.pages.map(p => dims(p)[0]), 100);
  return clamp((viewer.clientWidth - (innerWidth <= 760 ? 24 : 48)) / maxW, 0.25, ZMAX);
}
/* Startzoom: auf Tablets und Handys immer Seitenbreite, am Rechner höchstens 125 % */
function initialZoom() {
  const f = fitZoom();
  if (COARSE) { S.fitMode = true; return clamp(f, 0.3, 3); }
  S.fitMode = f <= 1.25;
  return clamp(Math.min(f, 1.25), 0.3, 1.25);
}
const ZMAX = 6;
let zoomT;
function setZoom(z, anchor, fit) {
  commitEdit();
  if (S.live) { S.live = null; pagesEl.style.transform = ''; pagesEl.style.transformOrigin = ''; pagesEl.classList.remove('live'); }
  S.fitMode = !!fit;
  z = clamp(z, 0.25, ZMAX);
  if (Math.abs(z - S.zoom) < 0.001) return;
  const vr = viewer.getBoundingClientRect();
  const cx = vr.left + (anchor ? anchor.x : vr.width / 2), cy = vr.top + (anchor ? anchor.y : vr.height * 0.35);
  let ref = null, rx = 0.5, ry = 0;
  for (const p of S.pages) {
    const r = els.get(p.id).wrap.getBoundingClientRect();
    if (r.bottom >= cy) { ref = p; rx = (cx - r.left) / r.width; ry = (cy - r.top) / r.height; break; }
  }
  S.zoom = z;
  for (const p of S.pages) sizePageEl(p, els.get(p.id));
  if (ref) {
    const r = els.get(ref.id).wrap.getBoundingClientRect();
    viewer.scrollTop += (r.top + ry * r.height) - cy;
    viewer.scrollLeft += (r.left + rx * r.width) - cx;
  }
  if (S.sel || S.msel) drawAnnots(pageById((S.sel || S.msel).pid));
  updateStatus();
  clearTimeout(zoomT); zoomT = setTimeout(renderVisible, 140);
}
const fitWidth = () => setZoom(fitZoom(), null, true);
/* Flüssiges Zoomen: während der Geste nur per GPU skalieren (CSS-Transform), erst am Ende neu setzen und rendern */
function liveStart(cx, cy) {
  const r = pagesEl.getBoundingClientRect();
  S.live = { z0: S.zoom, z: S.zoom, ox: cx, oy: cy, cx, cy };
  pagesEl.style.transformOrigin = `${cx - r.left}px ${cy - r.top}px`;
  pagesEl.classList.add('live');
}
function liveMove(z, cx, cy) {
  const L = S.live; if (!L) return;
  L.z = clamp(z, 0.25, ZMAX); L.cx = cx; L.cy = cy;
  pagesEl.style.transform = `translate(${cx - L.ox}px, ${cy - L.oy}px) scale(${L.z / L.z0})`;
  $('#zoomLbl').textContent = Math.round(L.z * 100) + ' %';
}
function liveEnd() {
  const L = S.live; if (!L) return;
  S.live = null;
  pagesEl.style.transform = ''; pagesEl.style.transformOrigin = ''; pagesEl.classList.remove('live');
  const vr = viewer.getBoundingClientRect();
  // auf Seitenbreite einrasten, wenn knapp daneben
  const f = fitZoom(), snapFit = Math.abs(L.z / f - 1) < 0.06;
  setZoom(snapFit ? f : L.z, { x: L.ox - vr.left, y: L.oy - vr.top }, snapFit);
  viewer.scrollLeft -= L.cx - L.ox; viewer.scrollTop -= L.cy - L.oy;
  updateStatus();
}
const ZSTEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6];
const zoomStep = d => setZoom(d > 0 ? (ZSTEPS.find(s => s > S.zoom + 0.01) || ZMAX) : ([...ZSTEPS].reverse().find(s => s < S.zoom - 0.01) || 0.25));
/* Strg/⌘ + Mausrad bzw. Trackpad-Pinch: live skalieren, nach kurzer Pause festschreiben */
let wheelT = 0;
viewer.addEventListener('wheel', e => {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  if (!S.live) liveStart(e.clientX, e.clientY);
  liveMove(S.live.z * Math.exp(-e.deltaY * 0.0022), e.clientX, e.clientY);
  clearTimeout(wheelT); wheelT = setTimeout(liveEnd, 160);
}, { passive: false });
// Safari am Mac: Trackpad-Pinch kommt als Gesture-Event (auf iPad übernehmen das die Touch-Events)
if (!window.TouchEvent) {
  let g0 = 1;
  document.addEventListener('gesturestart', e => { if (!viewer.contains(e.target)) return; e.preventDefault(); liveStart(e.clientX, e.clientY); g0 = S.zoom; }, { passive: false });
  document.addEventListener('gesturechange', e => { if (!S.live) return; e.preventDefault(); liveMove(g0 * e.scale, e.clientX, e.clientY); }, { passive: false });
  document.addEventListener('gestureend', e => { if (!S.live) return; e.preventDefault(); liveEnd(); }, { passive: false });
}
/* Seitenbreite bleibt beim Drehen des Tablets oder Ändern der Fenstergröße erhalten */
let fitRO = 0;
new ResizeObserver(() => { clearTimeout(fitRO); fitRO = setTimeout(() => { if (S.fitMode && S.pages.length && !S.live) setZoom(fitZoom(), null, true); }, 120); }).observe(viewer);

/* Touch: zwei Finger zoomen und verschieben, ein Finger zieht ausgewählte Elemente.
   Der Apple Pencil (touchType „stylus“) zählt nicht als Finger und scrollt nie. */
const tdist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
const tmid = (a, b) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });
const fingers = list => Array.from(list).filter(t => t.touchType !== 'stylus');
let tap = null, lastTap = null;
/* Doppeltipp mit einem Finger: zwischen Seitenbreite und Vergrößerung wechseln (nur wo der Finger nicht zeichnet) */
function fingerIsFree(target) {
  if (target && target.closest && target.closest('.hbl div, .forml, textarea, .cmk')) return false;
  return S.reading || S.tool === 'select' || S.tool === 'laser' || (S.pencil.only && PENCIL_TOOLS.has(S.tool));
}
function doubleTapZoom(x, y) {
  const vr = viewer.getBoundingClientRect(), f = fitZoom();
  if (S.zoom > f * 1.15) setZoom(f, { x: x - vr.left, y: y - vr.top }, true);
  else setZoom(Math.min(ZMAX, Math.max(f * 2, 1.5)), { x: x - vr.left, y: y - vr.top });
}
viewer.addEventListener('touchstart', e => {
  const stylus = Array.from(e.changedTouches).some(t => t.touchType === 'stylus');
  if (stylus) {
    notePencil();
    const onField = e.target && e.target.closest && e.target.closest('.forml .ff, textarea');
    if (!onField && (PENCIL_TOOLS.has(S.tool) || S.tool === 'objects' || S.tool === 'select')) e.preventDefault();
    return;
  }
  const f = fingers(e.touches), now = performance.now();
  // Mehrfinger-Tippen erkennen: zwei Finger = rückgängig, drei = wiederholen
  if (!tap || f.length === 1) tap = { t0: now, n: f.length, start: new Map(), moved: false, z0: S.zoom, target: e.target };
  tap.n = Math.max(tap.n, f.length);
  for (const t of e.changedTouches) tap.start.set(t.identifier, [t.clientX, t.clientY]);
  if (f.length === 2) {
    e.preventDefault();
    if (!(drag && drag.ptype === 'pen')) cancelDrag();
    commitEdit();
    const [a, b] = f, m = tmid(a, b);
    S.pinch = { d0: Math.max(10, tdist(a, b)) };
    liveStart(m.x, m.y);
  } else if (f.length > 2) e.preventDefault();
}, { passive: false });
viewer.addEventListener('touchmove', e => {
  if (tap) for (const t of e.changedTouches) {
    const s = tap.start.get(t.identifier);
    if (s && Math.hypot(t.clientX - s[0], t.clientY - s[1]) > 12) tap.moved = true;
  }
  const f = fingers(e.touches);
  if (S.pinch && f.length === 2 && S.live) {
    e.preventDefault();
    const [a, b] = f, m = tmid(a, b);
    liveMove(S.live.z0 * tdist(a, b) / S.pinch.d0, m.x, m.y);
    return;
  }
  if (Array.from(e.touches).some(t => t.touchType === 'stylus') && e.cancelable) { e.preventDefault(); return; }
  if (S.touchDrag && e.cancelable) e.preventDefault();
}, { passive: false });
const endPinch = e => {
  const f = fingers(e.touches);
  if (f.length < 2 && S.pinch) { S.pinch = null; liveEnd(); }
  if (tap && f.length === 0) {
    const t = tap; tap = null;
    const quick = e.type === 'touchend' && !t.moved && performance.now() - t.t0 < 350 && Math.abs(S.zoom / t.z0 - 1) < 0.03;
    if (quick) {
      if (t.n === 2) { undo(); setMsg('Rückgängig (zwei Finger)'); }
      else if (t.n === 3) { redo(); setMsg('Wiederholt (drei Finger)'); }
      else if (t.n === 1) {
        const pt = [...t.start.values()][0], now = performance.now();
        if (lastTap && now - lastTap.t < 320 && Math.hypot(pt[0] - lastTap.x, pt[1] - lastTap.y) < 40 && fingerIsFree(t.target)) {
          lastTap = null; if (e.cancelable) e.preventDefault(); doubleTapZoom(pt[0], pt[1]);
        } else lastTap = { t: now, x: pt[0], y: pt[1] };
      }
    }
    if (!quick || t.n !== 1) lastTap = null;
  }
};
viewer.addEventListener('touchend', endPinch);
viewer.addEventListener('touchcancel', endPinch);
// Safari: Seiten-Zoom des Browsers unterdrücken, die App zoomt selbst
if (window.TouchEvent) for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, e => e.preventDefault(), { passive: false });

/* ---------- Auswahl, Werkzeuge, Eigenschaften ---------- */
function selAnnot() {
  if (!S.sel) return null;
  const p = pageById(S.sel.pid);
  return (p && p.annots.find(a => a.id === S.sel.aid)) || null;
}
function select(pid, aid) {
  const prev = S.sel ? pageById(S.sel.pid) : S.msel ? pageById(S.msel.pid) : null;
  S.msel = null;
  S.sel = pid ? { pid, aid } : null;
  if (prev) drawAnnots(prev);
  if (pid && (!prev || prev.id !== pid)) drawAnnots(pageById(pid));
  renderProps();
}
function setTool(t) {
  commitEdit();
  if (S.qbar) { const qp = pageById(S.qbar.pid); S.qbar = null; if (qp) setTimeout(() => drawAnnots(qp), 0); }
  S.tool = t;
  if (t !== 'select' && (S.sel || S.msel)) setMulti(null, []);
  if (t !== 'objects' && (S.csel || S.hover)) { const hp = S.hover && pageById(S.hover.pid); S.hover = null; setCsel(null, []); if (hp) drawCUI(hp); }
  if ((t === 'objects' || t === 'edittext') && S.pages[S.cur]) analysisOf(S.pages[S.cur]).catch(() => toast('Die Inhalte dieser PDF lassen sich nicht auslesen (z. B. verschlüsselt).'));
  if (SNAP_TOOLS.has(t) && S.pages[S.cur]) analysisOf(S.pages[S.cur]).catch(() => {});
  if (tbCompact && TB_DEFAULT) { const g = groupOf(t), el = g && tbEl(t); if (el && el.classList.contains('gh')) { lsSet('pdfwb.tbrep.' + g, t); applyToolbar(); } }
  $$('[data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
  pagesEl.dataset.tool = t;
  if (DRAW_TOOLS.has(t)) pagesEl.dataset.draw = ''; else delete pagesEl.dataset.draw;
  renderProps();
}
function propTarget() {
  if (S.editing) return { obj: S.editing.a, type: 'text', editing: true };
  if (S.msel) { const s = selectedAnnots(); if (s && s.list.length) return { obj: s.list.find(a => a.color) || s.list[0], objs: s.list, type: 'multi', isAnnot: true, multi: true }; }
  const a = selAnnot();
  if (a) return { obj: a, type: a.t, isAnnot: true };
  if (TP[S.tool]) return { obj: TP[S.tool], type: S.tool };
  return null;
}
function renderProps() {
  const cs = S.csel && S.tool === 'objects' ? S.csel.items : null;
  const oneText = cs && cs.length === 1 && cs[0].kind === 'text';
  $('#cEditBtn').hidden = !oneText;
  $('#cRotL').hidden = $('#cRotR').hidden = !cs;
  const selA = !cs && !S.cedit ? selAnnot() : null;
  $('#zFront').hidden = $('#zBack').hidden = !(selA || cs);
  $('#zUnder').hidden = !selA || selA.t === 'note';
  if (selA) $('#zUnder').setAttribute('aria-pressed', String(!!selA.under));
  $('#cMark').hidden = !cs;
  $('#cmtBtn').hidden = !selA;
  $('#copyBtn').hidden = !(selA || S.msel || cs);
  $('#pasteBtn').hidden = !S.clip;
  $('#cmtBtn').setAttribute('aria-pressed', String(!!(selA && (selA.comment || (selA.t === 'note' && selA.text)))));
  if (cs || S.cedit) {
    $$('[data-for]', propbar).forEach(el => { el.hidden = true; });
    $('#dupBtn').hidden = true; $('#delBtn').hidden = !cs;
    if (S.cedit) { $('#pTarget').textContent = 'PDF-Text bearbeiten'; $('#pHint').textContent = 'Enter übernimmt · Esc bricht ab · leer lassen entfernt die Zeile'; return; }
    const kinds = {};
    cs.forEach(it => { kinds[it.kind] = (kinds[it.kind] || 0) + 1; });
    $('#pTarget').textContent = cs.length === 1 ? 'Auswahl · ' + KIND_NAMES[cs[0].kind] : `Auswahl · ${cs.length} Elemente`;
    $('#pHint').textContent = (oneText ? `„${cs[0].text.slice(0, 50)}“ · Doppelklick bearbeitet` : Object.entries(kinds).map(([k, n]) => `${n}× ${KIND_NAMES[k]}`).join(' · ')) + ' · Ziehen verschiebt, Ecke skaliert, Entf entfernt';
    return;
  }
  const tg = propTarget();
  const type = tg ? tg.type : S.tool;
  const show = new Set(PROPS_OF[type] || []);
  $$('[data-for]', propbar).forEach(el => { el.hidden = !show.has(el.dataset.for); });
  const sel = !!selAnnot() || !!S.msel;
  $('#delBtn').hidden = !sel; $('#dupBtn').hidden = !sel;
  $('#pTarget').textContent = tg && tg.multi ? `Auswahl · ${tg.objs.length} Elemente` : tg && (tg.isAnnot || tg.editing) ? 'Auswahl · ' + (TOOL_NAMES[type] || type) + (type === 'mark' ? ' (' + { hl: 'Markieren', ul: 'Unterstreichen', so: 'Durchstreichen' }[tg.obj.kind] + ')' : '') : (TOOL_NAMES[S.tool] || '');
  let hint = '';
  if (tg && tg.multi) hint = 'Ziehen verschiebt alle · Strg+C kopiert · Entf löscht · Umschalt+Klick ändert die Auswahl';
  else if (tg && tg.isAnnot && type === 'mark') hint = tg.obj.text ? `„${tg.obj.text.length > 80 ? tg.obj.text.slice(0, 79) + '…' : tg.obj.text}“` + (tg.obj.comment ? ' · ' + tg.obj.comment.slice(0, 60) : '') : '';
  else if (tg && tg.isAnnot && type === 'img') hint = HINTS.img;
  else if (S.tool === 'text' && !(tg && tg.editing)) hint = 'Auf die Seite klicken, um Text zu schreiben · Strg+Enter oder Esc zum Abschließen';
  else if (!tg || !(tg.isAnnot || tg.editing)) hint = HINTS[S.tool] || '';
  $('#pHint').textContent = hint;
  if (!tg) return;
  const o = tg.obj;
  if (type === 'pen') {
    const k = o.kind || 'ball';
    $$('#penKind button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === k)));
    $('#shapeChk').checked = !!TP.pen.shapes;
    $('#shapeChk').closest('label').hidden = !!tg.isAnnot;
  }
  if (type === 'eraser') { $('#eraseIn').value = o.size; $('#eraseOut').textContent = o.size + ' pt'; }
  if (type === 'measure') { $('#scaleSel').value = String(o.scale || 1); $('#unitSel').value = o.unit || S.prefs.unit; }
  if (o.color) {
    $$('.sw', $('#swatches')).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.c.toLowerCase() === o.color.toLowerCase())));
    $('#colorPick').value = o.color;
  }
  if ('sw' in o) { $('#strokeIn').value = o.sw; $('#strokeOut').textContent = o.sw + ' pt'; }
  if ('op' in o) { $('#opIn').value = o.op; $('#opOut').textContent = o.op + ' %'; }
  if (type === 'stamp') $('#stampSel').value = STAMPS.some(s => s[0] === o.text) ? o.text : (o.text === today() ? '{datum}' : '');
  if ('font' in o) $('#bgSel').value = o.bg || '';
  if ('font' in o) { $('#fontSel').value = FONTS[o.font] ? o.font : 'Helvetica'; if (document.activeElement !== $('#sizeIn')) $('#sizeIn').value = o.size; $('#boldBtn').setAttribute('aria-pressed', String(!!o.bold)); $('#boldBtn').disabled = !!FONT(o.font).noBold; }
  const seg = (sel, v) => $$(sel + ' button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === (v || ''))));
  if (show.has('align')) seg('#alignSeg', o.align || 'left');
  if (show.has('fill')) seg('#fillSeg', o.fill);
  if (show.has('dash')) seg('#dashSeg', o.dash);
  if (type === 'pen') renderPenFavs(o);
}
function setProp(k, v, continuous) {
  const tg = propTarget(); if (!tg) return;
  if (tg.editing) {
    tg.obj[k] = v; S.editing.styled = true; TP.text[k] = v; styleTA();
  } else if (tg.multi) {
    if (!(continuous && S.propEdit)) pushHist();
    S.propEdit = !!continuous;
    tg.objs.forEach(o => { if (k in o) o[k] = v; });
    drawAnnots(pageById(S.msel.pid)); markDirty();
  } else if (tg.isAnnot) {
    if (!(continuous && S.propEdit)) pushHist();
    S.propEdit = !!continuous;
    tg.obj[k] = v;
    if (TP[tg.type] && k in TP[tg.type]) TP[tg.type][k] = v;
    drawAnnots(pageById(S.sel.pid)); markDirty();
  } else tg.obj[k] = v;
  renderProps();
}
/* ---------- Auswahl mehrerer eigener Elemente ---------- */
function selectedAnnots() {
  if (S.msel) { const p = pageById(S.msel.pid); return p ? { p, list: p.annots.filter(a => S.msel.ids.includes(a.id)) } : null; }
  const a = selAnnot(); return a ? { p: pageById(S.sel.pid), list: [a] } : null;
}
function setMulti(pid, ids) {
  const prevP = (S.msel && pageById(S.msel.pid)) || (S.sel && pageById(S.sel.pid));
  S.sel = null; S.msel = null;
  if (ids.length === 1) S.sel = { pid, aid: ids[0] };
  else if (ids.length > 1) S.msel = { pid, ids };
  if (prevP) drawAnnots(prevP);
  if (pid && (!prevP || prevP.id !== pid)) drawAnnots(pageById(pid));
  renderProps();
}
const unionBox = list => { const bs = list.map(bbox), x = Math.min(...bs.map(b => b.x)), y = Math.min(...bs.map(b => b.y)); return { x, y, w: Math.max(...bs.map(b => b.x + b.w)) - x, h: Math.max(...bs.map(b => b.y + b.h)) - y }; };
function restoreMulti(d) { d.orig.forEach(o => { const a = d.p.annots.find(x => x.id === o.id); if (a) Object.assign(a, clone(o)); }); if (S.hist.length) S.hist.pop(); updateUndo(); drawAnnots(d.p); }
function deleteSel() {
  const s = selectedAnnots(); if (!s) return;
  const ids = new Set(s.list.map(a => a.id));
  pushHist(); s.p.annots = s.p.annots.filter(x => !ids.has(x.id)); S.sel = null; S.msel = null;
  drawAnnots(s.p); markDirty(); renderProps();
  if (ids.size > 1) toast(`${ids.size} Elemente gelöscht`);
}

/* ---------- Kopieren und Einfügen ---------- */
async function writeSysClip(text) {
  if (!text) return false;
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { return false; }
}
function copySelection(cut) {
  commitEdit();
  if (S.csel && S.tool === 'objects') { copyContent(); return true; }
  const s = selectedAnnots(); if (!s) return false;
  const text = s.list.map(a => (a.t === 'mark' ? a.text : a.text) || a.comment || '').filter(Boolean).join('\n');
  S.clip = { type: 'annots', pid: s.p.id, items: s.list.map(clone), n: 0, sysText: text, stale: false };
  writeSysClip(text);
  if (cut) deleteSel();
  const n = s.list.length;
  toast(cut ? (n === 1 ? 'Element ausgeschnitten' : `${n} Elemente ausgeschnitten`) : (n === 1 ? 'Element kopiert' : `${n} Elemente kopiert`) + (text ? ' (Text auch in der Zwischenablage)' : ''));
  renderProps();
  return true;
}
function pasteClip() {
  const c = S.clip, p = S.pages[S.cur]; if (!c || !p) return false;
  commitEdit();
  if (c.type === 'content') { pasteContent(c, p); return true; }
  c.n = (c.n || 0) + 1;
  const same = p.id === c.pid, off = same ? 12 * c.n : 0, [W, H] = dims(p);
  const items = c.items.map(o => { const a = translated(o, off, off); a.id = uid(); return a; });
  // auf kleineren Seiten in den sichtbaren Bereich schieben
  const u = unionBox(items), dx = Math.min(0, W - (u.x + u.w)) - Math.min(0, u.x), dy = Math.min(0, H - (u.y + u.h)) - Math.min(0, u.y);
  const placed = dx || dy ? items.map(a => ({ ...translated(a, dx, dy), id: a.id })) : items;
  pushHist(); p.annots.push(...placed); markDirty();
  if (S.tool !== 'select') setTool('select');
  setMulti(p.id, placed.map(a => a.id)); drawAnnots(p);
  toast(placed.length === 1 ? 'Eingefügt' : `${placed.length} Elemente eingefügt`);
  return true;
}
function duplicateSel() {
  const s = selectedAnnots(); if (!s) return;
  const items = s.list.map(o => { const a = translated(o, 12, 12); a.id = uid(); return a; });
  pushHist(); s.p.annots.push(...items); markDirty();
  setMulti(s.p.id, items.map(a => a.id));
}
/* PDF-Inhalte kopieren: auf derselben Seite als echte Vektor-Kopie, auf anderen Seiten als Bild */
async function copyContent() {
  const cs = S.csel; if (!cs) return;
  const p = pageById(cs.pid), u = cselBox(cs.items);
  const text = cs.items.filter(i => i.text).map(i => i.text).join('\n');
  const ids = cs.items.flatMap(i => i.ids);
  S.clip = { type: 'content', pid: p.id, ids, box: u, n: 0, sysText: text, stale: false, png: null };
  const clip = S.clip;
  writeSysClip(text);
  toast(`${cs.items.length === 1 ? 'Element' : cs.items.length + ' Elemente'} kopiert` + (text ? ' (Text auch in der Zwischenablage)' : ''));
  renderProps();
  try { clip.png = await renderObjects(p, ids, u, 3); } catch (e) { console.warn('Bild der Auswahl nicht erstellt', e); }
}
async function renderObjects(p, ids, box, scale) {
  const an = await analysisOf(p), keep = new Set(ids);
  const ce = newCE(p);
  ce.del = [...new Set([...ce.del, ...an.objects.filter(o => !keep.has(o.i)).map(o => o.i)])];
  ce.dup = ce.dup.filter(d => keep.has(d.id));
  const ld = await libDocOf(p.src), out = await PL.PDFDocument.create(), [pg] = await out.copyPages(ld, [p.idx]);
  out.addPage(pg); ENG.editPage(out, pg, an, ce); pg.node.delete(PL.PDFName.of('Annots'));
  const pdf = await PDFJS.getDocument({ data: await out.save(), isEvalSupported: false }).promise;
  try {
    const page = await pdf.getPage(1), vp = page.getViewport({ scale, rotation: rotOf(p), offsetX: -box.x * scale, offsetY: -box.y * scale });
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(box.w * scale)); c.height = Math.max(1, Math.ceil(box.h * scale));
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp, background: 'rgba(0,0,0,0)' }).promise;
    return { url: c.toDataURL('image/png'), w: c.width, h: c.height };
  } finally { pdf.destroy(); }
}
async function pasteContent(c, p) {
  c.n = (c.n || 0) + 1;
  if (p.id === c.pid) {
    const src = pageById(c.pid), T = moveMatrix(p, 12 * c.n, 12 * c.n, [c.box.x, c.box.y]);
    const ce = newCE(p), items = [];
    for (const i of c.ids) {
      const d = typeof i === 'string' && ce.dup.find(x => x.id === i);
      if (d) d.items.forEach(([j, A]) => items.push([j, ENG.mul(A, T)]));
      else if (typeof i === 'number') items.push([i, ENG.mul((src.ce && src.ce.tf && src.ce.tf[i]) || [1, 0, 0, 1, 0, 0], T)]);
    }
    if (!items.length) return;
    const id = uid('d');
    pushHist(); ce.dup.push({ id, items }); p.ce = ce;
    await applyCE(p);
    if (S.tool !== 'objects') setTool('objects');
    const fresh = cItems(p) || [];
    setCsel(p.id, fresh.filter(it => it.ids.includes(id)));
    toast('Kopie eingefügt · ziehen zum Verschieben');
    return;
  }
  if (!c.png) { toast('Die Kopie wird noch vorbereitet. Bitte gleich noch einmal einfügen.'); c.n--; return; }
  const id = registerImage(c.png.url, 'png', c.png.w, c.png.h), [W, H] = dims(p);
  const a = { id: uid(), t: 'img', img: id, x: clamp(c.box.x, 0, Math.max(0, W - c.box.w)), y: clamp(c.box.y, 0, Math.max(0, H - c.box.h)), w: c.box.w, h: c.box.h };
  pushHist(); p.annots.push(a); markDirty(); setTool('select'); setMulti(p.id, [a.id]);
  toast('Als Bild eingefügt (PDF-Inhalte lassen sich nur auf derselben Seite als Vektor kopieren)');
}
/* Zeichen, die die PDF-Standardschriften nicht kennen, lesbar ersetzen (für Rechenergebnisse) */
function winAnsiSafe(t) {
  const SUPD = '⁰¹²³⁴⁵⁶⁷⁸⁹', SUBD = '₀₁₂₃₄₅₆₇₈₉';
  return t.replace(/−/g, '-').replace(/√/g, 'sqrt').replace(/∛/g, 'cbrt').replace(/π/g, 'pi').replace(/≈/g, '~').replace(/≠/g, '!=').replace(/∞/g, 'unendlich')
    .replace(/[⁰⁴-⁹⁻]+/g, m => '^' + m.split('').map(c => (c === '⁻' ? '-' : SUPD.indexOf(c))).join(''))
    .replace(/[₀-₉]/g, c => SUBD.indexOf(c));
}
/* Text oder Bilder aus anderen Programmen einfügen */
function viewCenter(p) {
  const e = els.get(p.id), r = e.wrap.getBoundingClientRect(), v = viewer.getBoundingClientRect(), [W, H] = dims(p);
  const top = Math.max(r.top, v.top), bot = Math.min(r.bottom, v.bottom), left = Math.max(r.left, v.left), right = Math.min(r.right, v.right);
  return [bot > top && right > left ? ((left + right) / 2 - r.left) / S.zoom : W / 2, bot > top ? ((top + bot) / 2 - r.top) / S.zoom : H / 2];
}
function insertTextAnnot(text, p = S.pages[S.cur]) {
  if (!p || !text) return;
  const tp = TP.text, [cx, cy] = viewCenter(p), [W] = dims(p);
  const a = { id: uid(), t: 'text', x: 0, y: 0, text: text.replace(/\r/g, '').slice(0, 5000), color: tp.color, size: tp.size, font: tp.font, bold: tp.bold, bg: tp.bg || '' };
  const b = bbox(a); a.x = clamp(cx - b.w / 2, 4, Math.max(4, W - b.w - 4)); a.y = cy - b.h / 2;
  pushHist(); p.annots.push(a); markDirty(); setTool('select'); setMulti(p.id, [a.id]);
}

/* ---------- Zeiger ---------- */
function ptIn(e, el) { const r = el.svg.getBoundingClientRect(); return [(e.clientX - r.left) / S.zoom, (e.clientY - r.top) / S.zoom]; }
let drag = null;
/* Werkzeuge, die im Modus „Nur Pencil zeichnet“ nicht auf Finger reagieren */
const PENCIL_TOOLS = new Set(['laser', 'pen', 'eraser', 'hl', 'ul', 'so', 'rect', 'ellipse', 'line', 'arrow', 'measure', 'white', 'redact', 'check', 'cross', 'text', 'note', 'stamp']);
const pressureOf = e => (e.pointerType === 'pen' ? clamp(e.pressure || 0.5, 0.05, 1) : 0.5);
function notePencil() {
  if (S.pencil.seen) return;
  S.pencil.seen = true;
  const pref = lsGet('pdfwb.pencilOnly');
  setPencilOnly(pref == null ? true : pref === '1', true);
  $('#pencilChip').hidden = false;
  if (S.pencil.only) toast('Apple Pencil erkannt: Der Pencil zeichnet, Finger scrollen und zoomen');
}
function setPencilOnly(on, silent) {
  S.pencil.only = on;
  lsSet('pdfwb.pencilOnly', on ? '1' : '0');
  if (on) pagesEl.dataset.pencil = ''; else delete pagesEl.dataset.pencil;
  $('#mPencil').textContent = (on ? '✓ ' : '') + 'Nur Apple Pencil zeichnet';
  $('#pencilLbl').textContent = on ? 'Nur Pencil' : 'Pencil + Finger';
  $('#pencilChip').setAttribute('aria-pressed', String(on));
  if (!silent) toast(on ? 'Nur der Pencil zeichnet, Finger scrollen und zoomen' : 'Pencil und Finger zeichnen');
}
function hoverRing(p, pt, r) {
  for (const [id, e] of els) { const g = e.svg.querySelector('.draft'); if (g && (!p || id !== p.id) && g.firstChild && g.firstChild.classList && g.firstChild.classList.contains('hov')) g.innerHTML = ''; }
  if (!p) return;
  const e = els.get(p.id); if (!e) return;
  $('.draft', e.svg).innerHTML = `<circle class="hov" cx="${r2(pt[0])}" cy="${r2(pt[1])}" r="${r2(Math.max(r, 1.5))}"/>`;
}
/* ---------- Laserpointer: leuchtende Spur, die nach einer knappen Sekunde verblasst (nichts wird gespeichert) ---------- */
const laser = { cv: null, pts: [], dot: null, raf: 0, down: false };
function laserCanvas() {
  if (!laser.cv) {
    laser.cv = document.createElement('canvas');
    laser.cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:60';
    document.body.appendChild(laser.cv);
  }
  const dpr = Math.min(devicePixelRatio || 1, 2), w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  if (laser.cv.width !== w || laser.cv.height !== h) { laser.cv.width = w; laser.cv.height = h; }
  return laser.cv;
}
function laserAdd(e, pressed) {
  const now = performance.now();
  const evs = pressed && e.getCoalescedEvents ? e.getCoalescedEvents() : [];
  for (const ce of evs.length ? evs : [e]) { const q = [ce.clientX, ce.clientY, now]; if (pressed) laser.pts.push(q); laser.dot = q; }
  if (!laser.raf) laser.raf = requestAnimationFrame(laserDraw);
}
function laserDraw() {
  laser.raf = 0;
  const cv = laserCanvas(), ctx = cv.getContext('2d'), dpr = cv.width / innerWidth, now = performance.now(), LIFE = 850;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  laser.pts = laser.pts.filter(q => now - q[2] < LIFE);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (let i = 1; i < laser.pts.length; i++) {
    const a = laser.pts[i - 1], b = laser.pts[i];
    if (b[2] - a[2] > 120) continue; // neue Spur
    const k = 1 - (now - b[2]) / LIFE;
    ctx.strokeStyle = `rgba(255,40,60,${(k * 0.9).toFixed(3)})`; ctx.shadowColor = 'rgba(255,30,50,.9)'; ctx.shadowBlur = 14 * k;
    ctx.lineWidth = 2 + 4 * k;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  const d = laser.dot;
  if (d && (laser.down || now - d[2] < 1200)) {
    ctx.shadowColor = 'rgba(255,30,50,.95)'; ctx.shadowBlur = 18;
    ctx.fillStyle = '#ff2b44'; ctx.beginPath(); ctx.arc(d[0], d[1], laser.down ? 7 : 5.5, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.arc(d[0], d[1], 2.2, 0, Math.PI * 2); ctx.fill();
  }
  if (laser.pts.length || (d && now - d[2] < 1200) || laser.down) laser.raf = requestAnimationFrame(laserDraw);
  else ctx.clearRect(0, 0, innerWidth, innerHeight);
}
pagesEl.addEventListener('pointerdown', e => {
  if (S.tool === 'laser' && e.button === 0 && !S.pinch && !(e.pointerType === 'touch' && (!e.isPrimary || S.pencil.only))) {
    e.preventDefault(); if (drag) endDrag();
    drag = { mode: 'laser', pointerId: e.pointerId }; laser.down = true; laserAdd(e, true);
    return;
  }
  const stylusErase = e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32));
  if ((e.button !== 0 && !stylusErase) || e.target.closest('textarea') || e.target.closest('.forml .ff')) return;
  if (e.pointerType === 'pen') notePencil();
  if (drag && drag.pointerId !== e.pointerId) return;
  if (drag) endDrag();
  if ((e.pointerType === 'touch' && !e.isPrimary) || S.pinch) return;
  // Handballen-Erkennung: Finger zeichnen nicht, wenn nur der Pencil zeichnen soll
  if (S.pencil.only && e.pointerType === 'touch' && PENCIL_TOOLS.has(S.tool)) return;
  const wrap = e.target.closest('.page');
  if (!wrap) { if (S.editing) commitEdit(); else if (S.tool === 'select') select(null); return; }
  const p = pageById(wrap.dataset.id), el = els.get(p.id), pt = ptIn(e, el);
  hoverRing(null);
  setCurrent(S.pages.indexOf(p));
  if (S.cedit) { commitEdit(); return; }
  if (S.editing) { commitEdit(); if (S.tool === 'text') return; }
  const t = stylusErase ? 'eraser' : S.tool;
  if (t === 'eraser') {
    e.preventDefault();
    drag = { mode: 'erase', p, pointerId: e.pointerId, last: pt, removed: 0 };
    eraseAt(drag, pt);
    return;
  }
  if (t === 'objects') {
    e.preventDefault();
    if (S.csel && S.csel.pid === p.id && onCselHandle(pt)) {
      drag = { mode: 'cresize', p, pointerId: e.pointerId, start: pt, u: cselBox(), items: S.csel.items, k: 1 };
      S.touchDrag = e.pointerType === 'touch';
      return;
    }
    const startMove = items => {
      drag = { mode: 'cmove', p, pointerId: e.pointerId, start: pt, items, dx: 0, dy: 0, moved: false, lines: snapLines(p, new Set(items.flatMap(i => i.ids))) };
      S.touchDrag = e.pointerType === 'touch';
    };
    // Innerhalb der Auswahl ziehen verschiebt, sonst Rahmen aufziehen (Antippen wählt ein Element)
    if (S.csel && S.csel.pid === p.id && inCsel(pt) && !e.shiftKey) { startMove(S.csel.items); return; }
    drag = { mode: 'marquee', p, pointerId: e.pointerId, start: pt, shift: e.shiftKey, moved: false, r: null };
    return;
  }
  if (t === 'select') {
    const a = selAnnot();
    if (a && S.sel.pid === p.id) {
      const b = bbox(a), pad = 3 / S.zoom, hs = (COARSE ? 20 : 10) / S.zoom;
      if (a.t !== 'note' && Math.abs(pt[0] - (b.x + b.w + pad)) <= hs && Math.abs(pt[1] - (b.y + b.h + pad)) <= hs) {
        drag = { mode: 'resize', p, pointerId: e.pointerId, a, orig: clone(a), ob: b, start: pt, moved: false }; S.touchDrag = e.pointerType === 'touch'; e.preventDefault(); return;
      }
    }
    // Mehrfachauswahl: in die Auswahl tippen und ziehen verschiebt alle
    if (S.msel && S.msel.pid === p.id && !e.shiftKey) {
      const list = p.annots.filter(x => S.msel.ids.includes(x.id)), u = unionBox(list), tol = 4 / S.zoom;
      if (pt[0] >= u.x - tol && pt[0] <= u.x + u.w + tol && pt[1] >= u.y - tol && pt[1] <= u.y + u.h + tol) {
        drag = { mode: 'mmove', p, pointerId: e.pointerId, list, orig: list.map(clone), start: pt, moved: false, lines: snapLines(p, null, null, new Set(S.msel.ids)) };
        S.touchDrag = e.pointerType === 'touch'; e.preventDefault(); return;
      }
    }
    const hit = hitTest(p, pt);
    if (hit && (e.shiftKey || e.metaKey || e.ctrlKey)) {
      const cur = S.msel && S.msel.pid === p.id ? S.msel.ids.slice() : S.sel && S.sel.pid === p.id ? [S.sel.aid] : [];
      const k = cur.indexOf(hit.id); if (k >= 0) cur.splice(k, 1); else cur.push(hit.id);
      setMulti(p.id, cur); e.preventDefault(); return;
    }
    if (hit) {
      const was = S.sel && S.sel.aid === hit.id;
      if (S.msel) S.msel = null;
      select(p.id, hit.id); drag = { mode: 'move', p, pointerId: e.pointerId, a: hit, orig: clone(hit), start: pt, moved: false, tapNote: hit.t === 'note' && was, lines: snapLines(p, null, hit) };
      S.touchDrag = e.pointerType === 'touch'; e.preventDefault();
    } else if (e.pointerType !== 'touch') {
      // Rahmen aufziehen wählt mehrere Elemente
      e.preventDefault();
      drag = { mode: 'amarq', p, pointerId: e.pointerId, start: pt, moved: false, r: null, add: e.shiftKey };
    } else setMulti(null, []);
    return;
  }
  if (t === 'note') {
    e.preventDefault();
    const hit = hitTest(p, pt, 'note');
    if (hit) { editNote(p, hit); return; }
    const a = { id: uid(), t: 'note', x: pt[0] - NOTE / 2, y: pt[1] - NOTE / 2, text: '', color: TP.note.color };
    editNote(p, a, true);
    return;
  }
  if (t === 'stamp') {
    e.preventDefault();
    const tp = TP.stamp, a = { id: uid(), t: 'stamp', x: 0, y: 0, text: tp.text === '{datum}' ? today() : tp.text, color: tp.color, size: 14 };
    const g = stampGeom(a); a.x = pt[0] - g.w / 2; a.y = pt[1] - g.h / 2;
    pushHist(); p.annots.push(a); markDirty(); setTool('select'); select(p.id, a.id); drawAnnots(p);
    return;
  }
  e.preventDefault();
  if (t === 'text') {
    const hit = hitTest(p, pt, 'text');
    if (hit) editText(p, hit, false);
    else { const tp = TP.text; editText(p, { id: uid(), t: 'text', x: pt[0], y: pt[1] - tp.size * 0.65, text: '', color: tp.color, size: tp.size, font: tp.font, bold: tp.bold, bg: tp.bg || '' }, true); }
    return;
  }
  if (t === 'edittext') {
    analysisOf(p).then(() => {
      const it = itemAt(p, pt, 'text');
      if (it) editContentText(p, it); else toast('An dieser Stelle wurde kein Text gefunden.');
    }, () => replaceTextAt(p, pt));
    return;
  }
  if (t === 'check' || t === 'cross') {
    const tp = TP[t], s = 14;
    pushHist(); p.annots.push({ id: uid(), t, x: pt[0] - s / 2, y: pt[1] - s / 2, s, color: tp.color, sw: tp.sw });
    drawAnnots(p); markDirty(); return;
  }
  // Markieren, Unterstreichen, Durchstreichen: auf Text beginnen = Text auswählen wie in Acrobat
  if (SNAP_TOOLS.has(t)) {
    // Finger und Pencil treffen nicht so genau wie die Maus: größere Toleranz
    const ch = charsOf(p), i = ch ? charAt(ch, pt, (e.pointerType === 'mouse' ? 3 : 9) / S.zoom) : -1;
    if (i >= 0) { drag = { mode: 'tsel', p, pointerId: e.pointerId, tool: t, ch, i0: i, i1: i, start: pt, moved: false, ptype: e.pointerType }; return; }
  }
  const tp = TP[t] || {};
  let a;
  if (t === 'pen') a = { id: uid(), t, kind: tp.kind, pts: [[r2(pt[0]), r2(pt[1]), r2(pressureOf(e))]], color: tp.color, sw: tp.sw, op: tp.op };
  else if (t === 'line' || t === 'arrow') a = { id: uid(), t, x1: pt[0], y1: pt[1], x2: pt[0], y2: pt[1], color: tp.color, sw: tp.sw, ...(tp.dash ? { dash: tp.dash } : {}) };
  else if (t === 'measure') a = { id: uid(), t, x1: pt[0], y1: pt[1], x2: pt[0], y2: pt[1], color: tp.color, sw: tp.sw, scale: tp.scale, unit: tp.unit };
  else if (t === 'ul' || t === 'so') a = { id: uid(), t: 'line', x1: pt[0], y1: pt[1], x2: pt[0], y2: pt[1], color: tp.color, sw: 1.5 };
  else if (t === 'hl') a = { id: uid(), t, x: pt[0], y: pt[1], w: 0, h: 0, color: tp.color, op: tp.op };
  else if (t === 'white' || t === 'redact') a = { id: uid(), t, x: pt[0], y: pt[1], w: 0, h: 0 };
  else a = { id: uid(), t, x: pt[0], y: pt[1], w: 0, h: 0, color: tp.color, sw: tp.sw, ...(tp.fill ? { fill: tp.fill } : {}), ...(tp.dash ? { dash: tp.dash } : {}) };
  drag = { mode: 'draw', p, pointerId: e.pointerId, a, start: pt, tool: t, horiz: t === 'ul' || t === 'so', ptype: e.pointerType };
  if (SNAP_TOOLS.has(t)) analysisOf(p).catch(() => {});
  if (t === 'redact') analysisOf(p).catch(() => {});
});

/* Radierer: entfernt eigene Elemente, die er berührt (auch zwischen zwei Bewegungspunkten) */
function eraseAt(d, pt) {
  const p = d.p, r = TP.eraser.size / 2;
  const steps = Math.max(1, Math.ceil(Math.hypot(pt[0] - d.last[0], pt[1] - d.last[1]) / Math.max(r / 2, 1)));
  const hitIds = new Set();
  for (let s = 1; s <= steps; s++) {
    const q = [d.last[0] + (pt[0] - d.last[0]) * s / steps, d.last[1] + (pt[1] - d.last[1]) * s / steps];
    for (const a of p.annots) if (!hitIds.has(a.id) && hitsAnnot(a, q, r)) hitIds.add(a.id);
  }
  d.last = pt;
  if (hitIds.size) {
    if (!d.removed) pushHist();
    d.removed += hitIds.size;
    p.annots = p.annots.filter(a => !hitIds.has(a.id));
    if (S.sel && hitIds.has(S.sel.aid)) S.sel = null;
    drawAnnots(p); markDirty();
  }
  const e = els.get(p.id);
  if (e) $('.draft', e.svg).innerHTML = `<circle class="hov" cx="${r2(pt[0])}" cy="${r2(pt[1])}" r="${r2(r)}"/>`;
}

/* Formerkennung: Strich kurz halten → gerade Linie, Rechteck oder Ellipse */
function recognizeShape(a) {
  // Punkte ausdünnen und das Zittern am Ende (beim Halten) abschneiden, sonst wirkt der Strich krumm und zu lang
  const step = 3 / Math.max(S.zoom, 0.5), P = [];
  for (const q of a.pts) { const l = P[P.length - 1]; if (!l || Math.hypot(q[0] - l[0], q[1] - l[1]) >= step) P.push(q); }
  const last = a.pts[a.pts.length - 1], tail = 7 / Math.max(S.zoom, 0.5);
  while (P.length > 2 && Math.hypot(P[P.length - 1][0] - last[0], P[P.length - 1][1] - last[1]) < tail) P.pop();
  P.push(last);
  if (P.length < 3) return null;
  let len = 0;
  for (let i = 1; i < P.length; i++) len += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
  const b = bbox(a), size = Math.max(b.w, b.h);
  if (size < 12 / Math.max(S.zoom, 0.5)) return null;
  const f = P[0], l = P[P.length - 1], chord = Math.hypot(l[0] - f[0], l[1] - f[1]);
  const avgP = P.reduce((s, q) => s + (q[2] == null ? 0.5 : q[2]), 0) / P.length;
  if (chord / len > 0.88) {
    const dev = Math.max(...P.map(q => distSeg(q, f, l)));
    if (dev < Math.max(3, chord * 0.09)) return { ...a, pts: [[f[0], f[1], r2(avgP)], [l[0], l[1], r2(avgP)]] };
  }
  if (penKind(a) === 'marker' || chord > 0.25 * size || b.w < 10 || b.h < 10) return null;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, rx = b.w / 2, ry = b.h / 2;
  let ee = 0, re = 0;
  for (const [x, y] of P) {
    ee += Math.abs(Math.hypot((x - cx) / rx, (y - cy) / ry) - 1);
    re += Math.min(Math.abs(x - b.x), Math.abs(x - b.x - b.w), Math.abs(y - b.y), Math.abs(y - b.y - b.h)) / Math.min(b.w, b.h);
  }
  ee /= P.length; re /= P.length;
  const se = ee / 0.11, sr = re / 0.055;
  if (Math.min(se, sr) > 1) return null;
  const sw = penKind(a) === 'fount' ? Math.max(0.5, r2(a.sw * 0.8)) : a.sw;
  return { id: a.id, t: sr < se ? 'rect' : 'ellipse', x: b.x, y: b.y, w: b.w, h: b.h, color: a.color, sw };
}
function tryShape(d) {
  if (drag !== d || d.shaped || !TP.pen.shapes) return;
  const s = recognizeShape(d.a);
  if (!s) return;
  d.a = s; d.shaped = true;
  drawDraft(d.p, s);
  if (navigator.vibrate) try { navigator.vibrate(8); } catch (e) { /* egal */ }
  setMsg(s.t === 'pen' ? 'Gerade Linie erkannt' : s.t === 'rect' ? 'Rechteck erkannt' : 'Ellipse erkannt');
}
window.addEventListener('pointermove', e => {
  if (drag && drag.pointerId != null && e.pointerId !== drag.pointerId) return;
  // verlorenes pointerup (Stift oder Maus schon abgehoben): Ziehen sauber beenden
  if (drag && e.buttons === 0 && (e.pointerType === 'mouse' || (e.pointerType === 'pen' && !e.pressure))) { S.touchDrag = false; endDrag(); return; }
  if (!drag) {
    if (S.tool === 'laser' && (e.pointerType === 'mouse' || (e.pointerType === 'pen' && !e.buttons)) && e.target.closest && e.target.closest('#pages')) laserAdd(e, false);
    const w = e.target && e.target.closest ? e.target.closest('.page') : null;
    let hov = null;
    if (w) {
      const p = pageById(w.dataset.id), pt = ptIn(e, els.get(w.dataset.id));
      $('#stCursor').textContent = `x ${fmtLen(pt[0], S.prefs.unit, 1, 0)} · y ${fmtLen(pt[1], S.prefs.unit, 1, 0)}`;
      if (p && !S.cedit && (S.tool === 'objects' || S.tool === 'edittext')) { const it = itemAt(p, pt, S.tool === 'edittext' ? 'text' : null); if (it) hov = { pid: p.id, it }; }
      // Pencil-Hover (iPad mit Hover-Unterstützung): Vorschau der Spitze
      if (e.pointerType === 'pen' && !e.buttons && p) {
        const r = S.tool === 'eraser' ? TP.eraser.size / 2 : S.tool === 'pen' ? TP.pen.sw / 2 : S.tool === 'hl' ? 4 : 0;
        if (r) hoverRing(p, pt, r); else hoverRing(null);
      }
    } else { $('#stCursor').textContent = ''; if (e.pointerType === 'pen') hoverRing(null); }
    const prevHov = S.hover;
    if ((prevHov && prevHov.it) !== (hov && hov.it)) {
      S.hover = hov;
      if (prevHov) drawCUI(pageById(prevHov.pid));
      if (hov && (!prevHov || prevHov.pid !== hov.pid)) drawCUI(pageById(hov.pid));
    }
    return;
  }
  if (drag.mode === 'laser') { laserAdd(e, true); return; }
  const el = els.get(drag.p.id); if (!el) return;
  const pt = ptIn(e, el), a = drag.a;
  if (drag.mode === 'erase') {
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ce of evs.length ? evs : [e]) eraseAt(drag, ptIn(ce, el));
    return;
  }
  if (drag.mode === 'amarq') {
    const x = Math.min(pt[0], drag.start[0]), y = Math.min(pt[1], drag.start[1]), w = Math.abs(pt[0] - drag.start[0]), h = Math.abs(pt[1] - drag.start[1]);
    if (!drag.moved && Math.hypot(w, h) * S.zoom < 4) return;
    drag.moved = true; drag.r = { x, y, w, h };
    $('.draft', el.svg).innerHTML = `<rect class="marq" x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}"/>`;
    return;
  }
  if (drag.mode === 'mmove') {
    let dx = pt[0] - drag.start[0], dy = pt[1] - drag.start[1];
    if (!drag.moved) { if (Math.hypot(dx, dy) * S.zoom < 2) return; pushHist(); drag.moved = true; }
    const u = unionBox(drag.orig), sn = snapBox(drag.lines, { x: u.x + dx, y: u.y + dy, w: u.w, h: u.h }, e.altKey);
    dx += sn.dx; dy += sn.dy;
    drag.orig.forEach((o, k) => Object.assign(drag.list[k], translated(o, dx, dy)));
    drawAnnots(drag.p);
    if (sn.svg) $('.draft', el.svg).innerHTML = sn.svg;
    return;
  }
  if (drag.mode === 'tsel') {
    if (!drag.moved && Math.hypot(pt[0] - drag.start[0], pt[1] - drag.start[1]) * S.zoom < 4) return;
    drag.moved = true;
    const j = nearestChar(drag.ch, pt); if (j >= 0) drag.i1 = j;
    const m = markFromChars(drag.ch, drag.i0, drag.i1), tp = TP[drag.tool];
    $('.draft', el.svg).innerHTML = m ? annotSVG({ t: 'mark', kind: drag.tool, rects: m.rects, color: tp.color, op: tp.op || 40, vert: rotOf(drag.p) % 180 !== 0 }) : '';
    if (m) $('#stMsg').textContent = `„${m.text.length > 70 ? m.text.slice(0, 69) + '…' : m.text}“`;
    return;
  }
  if (drag.mode === 'cmove') {
    let dx = pt[0] - drag.start[0], dy = pt[1] - drag.start[1];
    if (!drag.moved && Math.hypot(dx, dy) * S.zoom < 4) return;
    drag.moved = true;
    const u = cselBox(drag.items), sn = snapBox(drag.lines, { x: u.x + dx, y: u.y + dy, w: u.w, h: u.h }, e.altKey);
    dx += sn.dx; dy += sn.dy; drag.dx = dx; drag.dy = dy;
    showGhost(drag.p, drag.items, dx, dy, 1);
    $('.draft', el.svg).innerHTML = sn.svg;
    $('#stCursor').textContent = `Δ ${Math.round(dx * 25.4 / 72)} · ${Math.round(dy * 25.4 / 72)} mm`;
    return;
  }
  if (drag.mode === 'cresize') {
    const u = drag.u;
    drag.k = clamp(Math.max((pt[0] - u.x) / Math.max(u.w, 1), (pt[1] - u.y) / Math.max(u.h, 1)), 0.1, 10);
    showGhost(drag.p, drag.items, 0, 0, drag.k);
    $('#stCursor').textContent = `${Math.round(drag.k * 100)} %`;
    return;
  }
  if (drag.mode === 'marquee') {
    const x = Math.min(pt[0], drag.start[0]), y = Math.min(pt[1], drag.start[1]), w = Math.abs(pt[0] - drag.start[0]), h = Math.abs(pt[1] - drag.start[1]);
    if (!drag.moved && Math.hypot(w, h) * S.zoom < 4) return;
    drag.moved = true; drag.r = { x, y, w, h };
    $('.draft', el.svg).innerHTML = `<rect class="marq" x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}"/>`;
    return;
  }
  if (drag.mode === 'draw') {
    if (drag.shaped) {
      // nach der Formerkennung: gerade Linie folgt noch dem Stift, Rechteck und Ellipse bleiben
      if (a.t === 'pen' && a.pts.length === 2) { a.pts[1] = [r2(pt[0]), r2(pt[1]), a.pts[1][2]]; drawDraft(drag.p, a); }
      return;
    }
    if (a.t === 'pen') {
      // alle Zwischenpunkte des Pencil (bis 240 Hz) für glatte Linien
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      let movedFar = false;
      for (const ce of evs.length ? evs : [e]) {
        const q = ptIn(ce, el), l = a.pts[a.pts.length - 1], dist = Math.hypot(q[0] - l[0], q[1] - l[1]);
        if (dist > 0.5 / S.zoom) a.pts.push([r2(q[0]), r2(q[1]), r2(pressureOf(ce))]);
        // Halten erkennen: der Pencil zittert beim Stillhalten um 1–3 px, erst echte Bewegung startet die Zeit neu
        if (!drag.anchor || Math.hypot(q[0] - drag.anchor[0], q[1] - drag.anchor[1]) * S.zoom > 6) { drag.anchor = q; movedFar = true; }
      }
      if (movedFar || !drag.hold) {
        clearTimeout(drag.hold);
        const d = drag;
        if (TP.pen.shapes) d.hold = setTimeout(() => tryShape(d), 500);
      }
      drawDraft(drag.p, a);
      return;
    } else if (a.t === 'line' || a.t === 'arrow' || a.t === 'measure') {
      let [x, y] = pt;
      if (drag.horiz) y = a.y1;
      else if (e.shiftKey) {
        const dx = x - a.x1, dy = y - a.y1, ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx, dy);
        x = a.x1 + len * Math.cos(ang); y = a.y1 + len * Math.sin(ang);
      }
      a.x2 = x; a.y2 = y;
    } else {
      let w = pt[0] - drag.start[0], h = pt[1] - drag.start[1];
      if (e.shiftKey && a.t !== 'hl') { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
      a.x = Math.min(drag.start[0], drag.start[0] + w); a.y = Math.min(drag.start[1], drag.start[1] + h);
      a.w = Math.abs(w); a.h = Math.abs(h);
    }
    drawDraft(drag.p, a);
    return;
  }
  const dx = pt[0] - drag.start[0], dy = pt[1] - drag.start[1];
  if (!drag.moved) { if (Math.hypot(dx, dy) * S.zoom < 2) return; pushHist(); drag.moved = true; }
  let next, guides = '';
  if (drag.mode === 'move') {
    next = translated(drag.orig, dx, dy);
    if (drag.lines) {
      const sn = snapBox(drag.lines, bbox(next), e.altKey);
      if (sn.dx || sn.dy) next = translated(drag.orig, dx + sn.dx, dy + sn.dy);
      guides = sn.svg;
    }
  } else {
    const ob = drag.ob;
    let nw = Math.max(4, ob.w + dx), nh = Math.max(4, ob.h + dy);
    if (['text', 'img', 'check', 'cross', 'stamp', 'wm', 'note'].includes(a.t) || e.shiftKey) { const f = Math.max(nw / ob.w, nh / ob.h); nw = ob.w * f; nh = ob.h * f; }
    next = scaled(drag.orig, ob, nw / ob.w, nh / ob.h);
  }
  Object.assign(a, next);
  drawAnnots(drag.p);
  if (guides) $('.draft', el.svg).innerHTML = guides;
});
function endDrag() {
  if (!drag) return;
  const d = drag; drag = null;
  clearTimeout(d.hold);
  if (d.mode === 'laser') { laser.down = false; if (!laser.raf) laser.raf = requestAnimationFrame(laserDraw); return; }
  if (d.mode === 'amarq') {
    drawDraft(d.p, null);
    if (!d.moved) { setMulti(null, []); return; }
    const r = d.r, cur = d.add && S.msel && S.msel.pid === d.p.id ? S.msel.ids.slice() : d.add && S.sel && S.sel.pid === d.p.id ? [S.sel.aid] : [];
    for (const a of d.p.annots) {
      const b = bbox(a), ix = Math.max(0, Math.min(b.x + b.w, r.x + r.w) - Math.max(b.x, r.x)), iy = Math.max(0, Math.min(b.y + b.h, r.y + r.h) - Math.max(b.y, r.y));
      if (ix * iy >= 0.5 * Math.max(b.w, 1) * Math.max(b.h, 1) && !cur.includes(a.id)) cur.push(a.id);
    }
    setMulti(d.p.id, cur);
    if (!cur.length) toast('Im Rahmen liegt kein eigenes Element.');
    return;
  }
  if (d.mode === 'mmove') { drawDraft(d.p, null); if (d.moved) markDirty(); return; }
  if (d.mode === 'tsel') {
    drawDraft(d.p, null);
    if (d.moved) createMark(d.p, d.ch, d.i0, d.i1, d.tool); else snapToText(d.p, d.start, d.tool);
    return;
  }
  if (d.mode === 'erase') {
    drawDraft(d.p, null);
    if (d.removed) setMsg(d.removed === 1 ? '1 Element gelöscht' : `${d.removed} Elemente gelöscht`);
    return;
  }
  if (d.mode === 'draw' && d.a.t === 'redact') {
    drawDraft(d.p, null);
    if (d.a.w > 2 && d.a.h > 2) applyRedaction(d.p, d.a);
    return;
  }
  if (d.mode === 'cmove') {
    drawDraft(d.p, null);
    if (!d.moved) { const it = itemAt(d.p, d.start); if (it && d.items.length > 1) setCsel(d.p.id, [it]); return; }
    transformContent(d.p, d.items, moveMatrix(d.p, d.dx, d.dy, d.start)).finally(hideGhost);
    return;
  }
  if (d.mode === 'cresize') {
    if (Math.abs(d.k - 1) < 0.01) { hideGhost(); return; }
    transformContent(d.p, d.items, scaleMatrix(d.p, d.k, [d.u.x, d.u.y])).finally(hideGhost);
    return;
  }
  if (d.mode === 'marquee') {
    drawDraft(d.p, null);
    const items = cItems(d.p);
    if (!items) { toast('Die Seite wird noch analysiert. Bitte gleich noch einmal klicken.'); return; }
    const cur = S.csel && S.csel.pid === d.p.id && d.shift ? S.csel.items.slice() : [];
    if (!d.moved) {
      const it = itemAt(d.p, d.start);
      if (!it) { if (!d.shift) setCsel(null, []); return; }
      const k = cur.indexOf(it);
      if (d.shift) { if (k >= 0) cur.splice(k, 1); else cur.push(it); setCsel(d.p.id, cur); }
      else setCsel(d.p.id, [it]);
      return;
    }
    const r = d.r;
    const picked = items.filter(it => {
      const b = it.box, ix = Math.max(0, Math.min(b.x + b.w, r.x + r.w) - Math.max(b.x, r.x)), iy = Math.max(0, Math.min(b.y + b.h, r.y + r.h) - Math.max(b.y, r.y));
      const area = Math.max(b.w, 0.5) * Math.max(b.h, 0.5);
      return (Math.max(ix, 0.5) * Math.max(iy, 0.5)) / area >= 0.7 && ix > 0 && iy > 0;
    });
    for (const it of picked) if (!cur.includes(it)) cur.push(it);
    setCsel(d.p.id, cur);
    if (!picked.length) toast('Im Rahmen liegt kein Element vollständig.');
    return;
  }
  if (d.mode === 'draw') {
    drawDraft(d.p, null);
    const a = d.a;
    // mit dem Markier-Werkzeug über Text gezogen: Markierung rastet auf die Zeichen ein
    if (SNAP_TOOLS.has(d.tool) && markRegion(d.p, a, d.tool)) return;
    const ok = a.t === 'pen' ? a.pts.length >= 1 : (a.t === 'line' || a.t === 'arrow' || a.t === 'measure') ? Math.hypot(a.x2 - a.x1, a.y2 - a.y1) > 2 : a.w > 2 && a.h > 2;
    if (ok) { pushHist(); d.p.annots.push(a); markDirty(); drawAnnots(d.p); }
    else if (SNAP_TOOLS.has(d.tool)) snapToText(d.p, d.start, d.tool);
  } else if (d.moved) { drawDraft(d.p, null); markDirty(); renderProps(); }
  else if (d.tapNote) editNote(d.p, d.a);
}
function cancelDrag(e) {
  if (e && e.pointerId != null && drag && drag.pointerId != null && e.pointerId !== drag.pointerId) return;
  S.touchDrag = false;
  if (!drag) return;
  const d = drag; drag = null;
  clearTimeout(d.hold);
  if (d.mode === 'laser') { laser.down = false; return; }
  if (d.mode === 'erase') { drawDraft(d.p, null); return; }
  // ein Pencil-Strich, den Safari abbricht, bleibt erhalten
  if (d.mode === 'draw' && d.ptype === 'pen' && d.a.t === 'pen' && d.a.pts.length > 2) { drag = d; endDrag(); return; }
  // eine begonnene Textauswahl wird trotzdem markiert
  if (d.mode === 'tsel' && d.moved) { drag = d; endDrag(); return; }
  if (['draw', 'marquee', 'cmove', 'cresize', 'tsel', 'amarq', 'mmove'].includes(d.mode)) { drawDraft(d.p, null); hideGhost(); if (d.mode === 'mmove' && d.moved) restoreMulti(d); }
  else if (d.moved) { Object.assign(d.a, d.orig); if (S.hist.length) S.hist.pop(); updateUndo(); drawAnnots(d.p); }
}
window.addEventListener('pointerup', e => {
  if (drag && drag.pointerId != null && e.pointerId !== drag.pointerId) return;
  S.touchDrag = false; endDrag();
});
window.addEventListener('pointercancel', cancelDrag);
pagesEl.addEventListener('pointerleave', e => { if (e.pointerType === 'pen' && !drag) hoverRing(null); });

/* Schwärzen: schwarzer Balken plus dauerhaftes Entfernen der Inhalte darunter */
async function applyRedaction(p, a) {
  const f = d2u(p), c1 = f(a.x, a.y), c2 = f(a.x + a.w, a.y + a.h);
  const rect = [Math.min(c1[0], c2[0]), Math.min(c1[1], c2[1]), Math.max(c1[0], c2[0]), Math.max(c1[1], c2[1])].map(r2);
  pushHist();
  p.annots.push(a);
  const ce = newCE(p); ce.red.push(rect); p.ce = ce;
  drawAnnots(p);
  await applyCE(p);
  toast('Geschwärzt: Der Inhalt darunter ist aus der PDF entfernt');
}

/* Rahmen oder Strich über Text → Textmarkierung der getroffenen Zeichen */
function markRegion(p, a, tool) {
  const ch = charsOf(p); if (!ch || !ch.flat.length) return false;
  const r = a.t === 'line' ? { x: Math.min(a.x1, a.x2), y: Math.min(a.y1, a.y2), w: Math.abs(a.x2 - a.x1), h: Math.abs(a.y2 - a.y1) } : { x: a.x, y: a.y, w: a.w, h: a.h };
  if (r.w < 3 && r.h < 3) return false;
  let hit = [];
  ch.flat.forEach((c, k) => {
    if (!c.ch.trim()) return;
    const cx = c.x + c.w / 2, cy = c.y + c.h / 2, pad = Math.max(2, c.h * 0.45);
    if (cx >= r.x && cx <= r.x + r.w && cy >= r.y - pad && cy <= r.y + r.h + pad) hit.push(k);
  });
  if (!hit.length) return false;
  const hs = hit.map(k => ch.flat[k].h).sort((x, y) => x - y), med = hs[hs.length >> 1];
  if (a.t === 'hl' && r.h > med * 3.2) return false; // großer Rahmen bleibt Flächenmarkierung
  if (r.h < med * 1.6) {
    // dünner Strich: nur die Zeile, durch die er am ehesten geht
    const my = r.y + r.h / 2, byLine = new Map();
    for (const k of hit) { const c = ch.flat[k], d = Math.abs(c.y + c.h / 2 - my); if (!byLine.has(c.line) || d < byLine.get(c.line)) byLine.set(c.line, d); }
    const best = [...byLine].sort((x, y) => x[1] - y[1])[0][0];
    hit = hit.filter(k => ch.flat[k].line === best);
  }
  return !!createMark(p, ch, Math.min(...hit), Math.max(...hit), tool);
}
/* Markieren, Unterstreichen und Durchstreichen rasten auf Textzeilen ein */
function snapToText(p, pt, tool) {
  const ch = charsOf(p), i = ch ? charAt(ch, pt, 8 / S.zoom) : -1;
  if (i < 0) { toast(tool === 'hl' ? 'Auf Text tippen und ziehen oder einen Bereich aufziehen.' : 'Auf Text tippen und ziehen oder eine Linie ziehen.'); return; }
  const line = ch.flat[i].line, idx = ch.flat.map((c, k) => (c.line === line ? k : -1)).filter(k => k >= 0);
  createMark(p, ch, idx[0], idx[idx.length - 1], tool);
}

/* ---------- Zeichenindex für Textmarkierungen ----------
   Jedes Zeichen der Seite mit Box (Ansichtskoordinaten) in Reihenfolge des Inhaltsstroms,
   berücksichtigt verschobene, gelöschte und geschwärzte Inhalte. */
const charCache = new Map();
function charsOf(p) {
  const an = S.analysis.get(p.src + ':' + p.idx);
  if (!an) { analysisOf(p).catch(() => {}); return null; }
  if (an === 'error') return null;
  const key = p.id + '|' + ceKey(p) + '|' + rotOf(p);
  if (charCache.has(key)) return charCache.get(key);
  const proxy = proxyOf(p); if (!proxy) return null;
  const vp = proxy.getViewport({ scale: 1, rotation: rotOf(p) });
  const ce = p.ce || {}, del = new Set(ce.del || []), tf = ce.tf || {}, red = ce.red || [], rep = ce.rep || {};
  const box = (M, x0, x1, y0, y1) => {
    const q = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => vp.convertToViewportPoint(M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]));
    const xs = q.map(v => v[0]), ys = q.map(v => v[1]), x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  };
  const flat = [];
  let line = 0;
  for (const g of an.groups) {
    const start = flat.length;
    for (const o of g.objs) {
      if (del.has(o.i) || rep[o.i] !== undefined || !o.M) continue;
      const A = tf[o.i], M = A ? ENG.mul(o.M, A) : o.M;
      const info = red.length ? ENG.redactInfo(o, A, red) : null;
      if (info === 'all') continue;
      const txt = Array.from(o.text), [y0, y1] = o.gy;
      if (txt.length === o.glyphs.length) o.glyphs.forEach(([gx, adv], k) => { if (!(info && info[k])) flat.push({ ch: txt[k], line, ...box(M, gx, gx + adv, y0, y1) }); });
      else if (txt.length && !info) flat.push({ ch: o.text, line, ...box(M, 0, o.adv, y0, y1) });
    }
    if (flat.slice(start).some(c => c.ch.trim())) line++;
    else flat.length = start;
  }
  const res = { flat };
  charCache.set(key, res);
  if (charCache.size > 80) charCache.delete(charCache.keys().next().value);
  return res;
}
function charAt(ch, pt, tol) {
  let best = -1, bd = Infinity;
  ch.flat.forEach((c, k) => {
    const dx = Math.max(c.x - pt[0], 0, pt[0] - c.x - c.w), dy = Math.max(c.y - pt[1], 0, pt[1] - c.y - c.h), d = Math.hypot(dx, dy);
    if (d <= tol && d < bd) { bd = d; best = k; }
  });
  return best;
}
function nearestChar(ch, pt) {
  let best = -1, bd = Infinity;
  ch.flat.forEach((c, k) => {
    const dx = Math.max(c.x - pt[0], 0, pt[0] - c.x - c.w), dy = Math.max(c.y - pt[1], 0, pt[1] - c.y - c.h), d = dx + dy * 3;
    if (d < bd) { bd = d; best = k; }
  });
  return best;
}
/* Zeichen i0..i1 → je Zeile ein Rechteck plus der markierte Text */
function markFromChars(ch, i0, i1) {
  const [a, b] = i0 <= i1 ? [i0, i1] : [i1, i0];
  const sel = ch.flat.slice(a, b + 1);
  while (sel.length && !sel[0].ch.trim()) sel.shift();
  while (sel.length && !sel[sel.length - 1].ch.trim()) sel.pop();
  if (!sel.length) return null;
  const rects = [], parts = [];
  let cur = null, txt = '', prev = null;
  for (const c of sel) {
    if (!cur || c.line !== cur.line) {
      if (cur) { rects.push(cur.r); parts.push(txt.trim()); }
      cur = { line: c.line, r: { x: c.x, y: c.y, w: c.w, h: c.h } }; txt = ''; prev = null;
    } else {
      const r = cur.r, x1 = Math.max(r.x + r.w, c.x + c.w), y1 = Math.max(r.y + r.h, c.y + c.h);
      r.x = Math.min(r.x, c.x); r.y = Math.min(r.y, c.y); r.w = x1 - r.x; r.h = y1 - r.y;
    }
    if (prev && !/\s$/.test(txt) && c.ch.trim() && c.x - (prev.x + prev.w) > Math.min(c.h, prev.h) * 0.22) txt += ' ';
    txt += c.ch; prev = c;
  }
  rects.push(cur.r); parts.push(txt.trim());
  return { rects: rects.map(r => ({ x: r2(r.x), y: r2(r.y), w: r2(r.w), h: r2(r.h) })), text: parts.join(' ').replace(/-\s(?=[a-zäöüß])/g, '').replace(/\s+/g, ' ').trim() };
}
function createMark(p, ch, i0, i1, tool) {
  const m = markFromChars(ch, i0, i1); if (!m) return null;
  const tp = TP[tool], a = { id: uid(), t: 'mark', kind: tool, rects: m.rects, text: m.text, color: tp.color };
  if (tool === 'hl') a.op = tp.op;
  if (rotOf(p) % 180) a.vert = true;
  pushHist(); p.annots.push(a); markDirty(); S.qbar = { pid: p.id, aid: a.id }; drawAnnots(p); setTimeout(() => { if (S.qbar && S.qbar.aid === a.id) drawAnnots(p); }, 0);
  setMsg(`Markiert: „${m.text.length > 60 ? m.text.slice(0, 59) + '…' : m.text}“`);
  if (S.prefs.askComment) editComment(p, a);
  return a;
}

/* Kommentar zu einem beliebigen Element */
function editComment(p, a) {
  commitEdit();
  const m = $('#noteModal'), ta = $('#noteText');
  $('#noteTitle').textContent = 'Kommentar';
  $('#noteInfo').textContent = a.t === 'mark' && a.text ? `Zu „${a.text.length > 90 ? a.text.slice(0, 89) + '…' : a.text}“` : `Zu: ${TOOL_NAMES[a.t] || 'Element'}`;
  ta.value = a.comment || '';
  $('#noteDelete').hidden = !a.comment;
  m.hidden = false;
  setTimeout(() => ta.focus(), 30);
  const close = () => { m.hidden = true; $('#noteTitle').textContent = 'Notiz'; $('#noteInfo').textContent = NOTE_INFO; $('#noteOk').onclick = $('#noteCancel').onclick = $('#noteDelete').onclick = null; };
  $('#noteCancel').onclick = close;
  $('#noteDelete').onclick = () => { close(); pushHist(); delete a.comment; drawAnnots(p); markDirty(); renderProps(); };
  $('#noteOk').onclick = () => {
    const txt = ta.value.trim(); close();
    if (txt === (a.comment || '')) return;
    pushHist(); if (txt) a.comment = txt; else delete a.comment;
    drawAnnots(p); markDirty(); renderProps();
  };
}
const NOTE_INFO = 'Wird als Kommentar in der PDF gespeichert und in Acrobat, Vorschau und Browsern angezeigt.';

/* Notizen */
function editNote(p, a, isNew) {
  commitEdit();
  const m = $('#noteModal'), ta = $('#noteText');
  ta.value = a.text || '';
  $('#noteDelete').hidden = !!isNew;
  m.hidden = false;
  setTimeout(() => ta.focus(), 30);
  const close = () => { m.hidden = true; $('#noteOk').onclick = $('#noteCancel').onclick = $('#noteDelete').onclick = null; };
  $('#noteCancel').onclick = close;
  $('#noteDelete').onclick = () => { close(); pushHist(); p.annots = p.annots.filter(x => x.id !== a.id); S.sel = null; drawAnnots(p); markDirty(); renderProps(); };
  $('#noteOk').onclick = () => {
    const txt = ta.value.trim(); close();
    if (isNew) { if (!txt) return; pushHist(); a.text = txt; p.annots.push(a); setTool('select'); select(p.id, a.id); }
    else if (txt !== a.text) { pushHist(); a.text = txt; }
    drawAnnots(p); markDirty();
  };
}
pagesEl.addEventListener('dblclick', e => {
  const wrap = e.target.closest('.page'); if (!wrap) return;
  if (S.tool === 'select') {
    const p = pageById(wrap.dataset.id), n = hitTest(p, ptIn(e, els.get(p.id)), 'note');
    if (n) { editNote(p, n); return; }
  }
  if (S.tool === 'objects') {
    const p = pageById(wrap.dataset.id), it = itemAt(p, ptIn(e, els.get(p.id)), 'text');
    if (it) editContentText(p, it);
    return;
  }
  if (S.tool !== 'select') return;
  const p = pageById(wrap.dataset.id), hit = hitTest(p, ptIn(e, els.get(p.id)), 'text');
  if (hit) { select(null); editText(p, hit, false); }
});

/* ---------- Textbearbeitung ---------- */
function editText(p, a, isNew, before, extra) {
  if (S.editing) commitEdit();
  const el = els.get(p.id); if (!el) return;
  const ta = document.createElement('textarea');
  ta.className = 'ted'; ta.value = a.text; ta.spellcheck = false; ta.setAttribute('aria-label', 'Text bearbeiten');
  S.editing = { p, a, ta, isNew, before: before || snap(), orig: a.text, extra: !!extra, styled: false };
  styleTA();
  el.wrap.append(ta);
  drawAnnots(p); renderProps();
  requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); });
  ta.addEventListener('input', () => { a.text = ta.value; styleTA(); });
  ta.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey))) { ev.preventDefault(); commitEdit(); }
    ev.stopPropagation();
  });
  ta.addEventListener('blur', ev => {
    if (ev.relatedTarget && propbar.contains(ev.relatedTarget)) return;
    setTimeout(() => { if (S.editing && S.editing.ta === ta && document.activeElement !== ta && !propbar.contains(document.activeElement)) commitEdit(); }, 0);
  });
}
function styleTA() {
  const ed = S.editing; if (!ed) return;
  const { a, ta } = ed, z = S.zoom, f = FONT(a.font);
  const lines = (ta.value || ' ').split('\n');
  ta.style.left = a.x * z + 'px'; ta.style.top = a.y * z + 'px';
  ta.style.font = `${fw(a)} ${a.size * z}px/${LH} ${f.css}`;
  ta.style.color = a.color; ta.style.textAlign = a.align || 'left';
  ta.style.width = (Math.max(...lines.map(l => measure(l || ' ', a))) + a.size) * z + 'px';
  ta.style.height = lines.length * LH * a.size * z + 'px';
}
function commitEdit() {
  commitCEdit();
  const ed = S.editing; if (!ed) return;
  S.editing = null;
  const { p, a, ta, isNew, before } = ed;
  const txt = ta.value.replace(/\s+$/, '');
  ta.remove();
  a.text = txt;
  const has = !!txt.trim();
  let changed = false;
  if (isNew) {
    if (has) { p.annots.push(a); changed = true; }
    else if (ed.extra) changed = true;
  } else if (!has) { p.annots = p.annots.filter(x => x !== a); changed = true; }
  else if (txt !== ed.orig || ed.styled) changed = true;
  if (changed) { S.hist.push(before); S.fut.length = 0; markDirty(); }
  else if (ed.extra) { /* nichts */ }
  drawAnnots(p); updateUndo(); renderProps();
}

/* ---------- Text in der PDF finden ---------- */
async function textContent(p) {
  const key = pkey(p);
  let tc = S.textCache.get(key);
  if (!tc) { tc = await proxyOf(p).getTextContent(); S.textCache.set(key, tc); }
  return tc;
}
function itemGeom(vp, it, s0 = 0, s1 = 1) {
  const tx = PDFJS.Util.transform(vp.transform, it.transform);
  const fh = Math.hypot(tx[2], tx[3]) || 1, ux = tx[2] / fh, uy = tx[3] / fh;
  const dl = Math.hypot(tx[0], tx[1]) || 1, dx = tx[0] / dl, dy = tx[1] / dl;
  const w = it.width || 0;
  const bx = tx[4] + dx * w * s0, by = tx[5] + dy * w * s0, L = w * (s1 - s0);
  const pts = [];
  for (const k of [-0.24, 0.92]) for (const m of [0, L]) pts.push([bx + dx * m + ux * k * fh, by + dy * m + uy * k * fh]);
  const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y, fh };
}
async function replaceTextAt(p, pt) {
  let tc;
  try { tc = await textContent(p); } catch (e) { toast('Der Text dieser Seite konnte nicht gelesen werden.'); return; }
  const vp = proxyOf(p).getViewport({ scale: 1, rotation: rotOf(p) });
  let best = null;
  for (const it of tc.items) {
    if (!it.str || !it.str.trim() || !it.width) continue;
    const g = itemGeom(vp, it), pad = 1.5;
    if (pt[0] >= g.x - pad && pt[0] <= g.x + g.w + pad && pt[1] >= g.y - pad && pt[1] <= g.y + g.h + pad) {
      if (!best || g.w * g.h < best.g.w * best.g.h) best = { it, g };
    }
  }
  if (!best) { toast('An dieser Stelle wurde kein Text gefunden.'); return; }
  const before = snap(), g = best.g;
  const famRaw = ((tc.styles[best.it.fontName] || {}).fontFamily || '').toLowerCase();
  const font = famRaw.includes('mono') ? 'Courier' : famRaw.includes('serif') && !famRaw.includes('sans') ? 'Times' : 'Helvetica';
  const size = Math.max(4, Math.round(g.fh * 2) / 2);
  p.annots.push({ id: uid(), t: 'white', x: g.x - 1, y: g.y - 1, w: g.w + 2, h: g.h + 2 });
  const a = { id: uid(), t: 'text', x: g.x, y: g.y + 0.92 * g.fh - FONT(font).bl * size, text: best.it.str, color: '#000000', size, font, bold: /bold|black|heavy/i.test(best.it.fontName + famRaw) };
  editText(p, a, true, before, true);
  if (S.editing) S.editing.ta.select();
}

/* ---------- Suche ---------- */
let findTok = 0, findT;
async function runFind(q) {
  const tok = ++findTok;
  q = q.trim().toLowerCase();
  if (q.length < 2) { S.find = null; S.pages.forEach(drawHits); $('#findCount').textContent = ''; return; }
  $('#findCount').textContent = '…';
  const hits = [];
  for (const p of S.pages) {
    let tc; try { tc = await textContent(p); } catch (e) { continue; }
    if (tok !== findTok) return;
    for (const it of tc.items) {
      const s = (it.str || '').toLowerCase(); let k = s.indexOf(q);
      while (k >= 0) { hits.push({ pid: p.id, it, s0: k / s.length, s1: (k + q.length) / s.length }); k = s.indexOf(q, k + q.length); }
    }
  }
  S.find = { q, hits, i: hits.length ? 0 : -1 };
  S.pages.forEach(drawHits);
  if (hits.length) goHit(0); else $('#findCount').textContent = 'Keine';
}
function hitsSVG(p) {
  if (!S.find || !S.find.hits.length) return '';
  const vp = proxyOf(p) ? proxyOf(p).getViewport({ scale: 1, rotation: rotOf(p) }) : null;
  if (!vp) return '';
  return S.find.hits.map((h, i) => {
    if (h.pid !== p.id) return '';
    const g = itemGeom(vp, h.it, h.s0, h.s1);
    return `<rect class="hit${i === S.find.i ? ' on' : ''}" x="${r2(g.x)}" y="${r2(g.y)}" width="${r2(g.w)}" height="${r2(g.h)}" rx="1.5"/>`;
  }).join('');
}
function drawHits(p) { const e = els.get(p.id); if (e) { const g = $('.hits', e.svg); if (g) g.innerHTML = hitsSVG(p); } }
function goHit(i) {
  const f = S.find; if (!f || !f.hits.length) return;
  const prev = f.hits[f.i];
  f.i = (i + f.hits.length) % f.hits.length;
  const h = f.hits[f.i], p = pageById(h.pid);
  if (prev && prev.pid !== h.pid) drawHits(pageById(prev.pid));
  drawHits(p);
  $('#findCount').textContent = `${f.i + 1}/${f.hits.length}`;
  const e = els.get(p.id), g = itemGeom(proxyOf(p).getViewport({ scale: 1, rotation: rotOf(p) }), h.it, h.s0, h.s1);
  viewer.scrollTo({ top: e.wrap.offsetTop + g.y * S.zoom - viewer.clientHeight * 0.35, left: Math.max(0, e.wrap.offsetLeft + g.x * S.zoom - viewer.clientWidth / 2), behavior: reduceMotion ? 'auto' : 'smooth' });
  setCurrent(S.pages.indexOf(p));
}

/* ---------- Seiten verwalten ---------- */
function targetPages() {
  if (S.selPages.size > 1) return S.pages.filter(p => S.selPages.has(p.id));
  return S.pages[S.cur] ? [S.pages[S.cur]] : [];
}
function rotatePages(d) {
  commitEdit();
  const ps = targetPages(); if (!ps.length) return;
  pushHist();
  for (const p of ps) { const [W, H] = dims(p); p.annots = p.annots.map(a => rotAnnot(a, W, H, d)); p.rot = (p.rot + d + 360) % 360; }
  if (S.sel) S.sel = null;
  ps.forEach(refreshPage); markDirty(); updateStatus(); renderProps();
}
function deletePages() {
  commitEdit();
  const ps = targetPages(); if (!ps.length) return;
  if (ps.length >= S.pages.length) { toast('Mindestens eine Seite muss im Dokument bleiben.'); return; }
  pushHist();
  const ids = new Set(ps.map(p => p.id));
  const first = S.pages.findIndex(p => ids.has(p.id));
  S.pages = S.pages.filter(p => !ids.has(p.id));
  S.selPages.clear(); S.sel = null; S.cur = clamp(first, 0, S.pages.length - 1);
  markDirty(); buildViewer(); scrollToPage(S.cur);
  toast(ps.length === 1 ? 'Seite gelöscht' : `${ps.length} Seiten gelöscht`);
}
/* ---------- Notizpapier ---------- */
const PAPERS = { blank: 'Leer', lined: 'Liniert', grid: 'Kariert', dots: 'Punktiert' };
const FORMATS = { a4p: ['A4 hoch', [595.28, 841.89]], a4l: ['A4 quer', [841.89, 595.28]], a5p: ['A5 hoch', [419.53, 595.28]], letter: ['US Letter', [612, 792]] };
async function makePaper(kind, size, count = 1) {
  const d = await PL.PDFDocument.create(), [W, H] = size, mm = 72 / 25.4, c = PL.rgb(0.68, 0.76, 0.89);
  for (let n = 0; n < count; n++) {
    const pg = d.addPage(size);
    if (kind === 'lined') {
      for (let y = H - 28 * mm; y > 14 * mm; y -= 8 * mm) pg.drawLine({ start: { x: 12 * mm, y }, end: { x: W - 12 * mm, y }, thickness: 0.5, color: c });
      pg.drawLine({ start: { x: 25 * mm, y: H - 10 * mm }, end: { x: 25 * mm, y: 10 * mm }, thickness: 0.6, color: PL.rgb(0.92, 0.6, 0.6) });
    } else if (kind === 'grid' || kind === 'dots') {
      const st = 5 * mm, nx = Math.floor((W - 20 * mm) / st), ny = Math.floor((H - 20 * mm) / st);
      const x0 = (W - nx * st) / 2, y0 = (H - ny * st) / 2;
      if (kind === 'grid') {
        for (let i = 0; i <= nx; i++) pg.drawLine({ start: { x: x0 + i * st, y: y0 }, end: { x: x0 + i * st, y: y0 + ny * st }, thickness: 0.35, color: c });
        for (let j = 0; j <= ny; j++) pg.drawLine({ start: { x: x0, y: y0 + j * st }, end: { x: x0 + nx * st, y: y0 + j * st }, thickness: 0.35, color: c });
      } else {
        for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) pg.drawCircle({ x: x0 + i * st, y: y0 + j * st, size: 0.55, color: c });
      }
    }
  }
  return new Uint8Array(await d.save());
}
function paperDialog(mode) {
  const cur = S.pages[S.cur], curDims = cur ? dims(cur) : A4;
  const fmtOpts = (mode === 'insert' && cur ? `<option value="cur">Wie aktuelle Seite</option>` : '') + Object.entries(FORMATS).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('');
  dialog(mode === 'new' ? 'Neues Dokument' : 'Neue Seite einfügen', `
    <div class="frow">
      <label class="fld"><span>Papier</span><select class="field" id="ppKind">${Object.entries(PAPERS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
      <label class="fld"><span>Format</span><select class="field" id="ppFmt">${fmtOpts}</select></label>
      <label class="fld"><span>Anzahl</span><input class="field num" type="number" id="ppCount" value="1" min="1" max="50"></label>
    </div>
    <p class="note">Liniert 8 mm, kariert und punktiert 5 mm. Ideal für Notizen mit dem Pencil.</p>`, mode === 'new' ? 'Erstellen' : 'Einfügen', b => {
    const kind = $('#ppKind', b).value, f = $('#ppFmt', b).value, count = clamp(Math.round(+$('#ppCount', b).value || 1), 1, 50);
    const size = f === 'cur' ? curDims : FORMATS[f][1];
    (mode === 'new' ? newDocument(kind, size, count) : insertPaper(kind, size, count)).catch(e => { console.error(e); toast('Die Seite konnte nicht erstellt werden.'); });
  });
}
async function insertPaper(kind, size, count) {
  commitEdit();
  const key = kind + ':' + size.map(Math.round).join('x');
  let src = S.paperSrc.get(key);
  if (!src || !S.sources.has(src)) {
    const before = new Set(S.sources.keys());
    await addSource(await makePaper(kind, size), PAPERS[kind] + ' ' + key);
    src = [...S.sources.keys()].find(k => !before.has(k));
    S.paperSrc.set(key, src);
  }
  const vp = S.proxies.get(src + ':0').getViewport({ scale: 1 });
  pushHist();
  const at = Math.min(S.cur + 1, S.pages.length);
  for (let n = 0; n < count; n++) S.pages.splice(at + n, 0, { id: uid('p'), src, idx: 0, baseRot: 0, rot: 0, w0: vp.width, h0: vp.height, annots: [] });
  S.selPages.clear(); markDirty(); buildViewer(); scrollToPage(at);
  toast(count === 1 ? `${PAPERS[kind]}e Seite eingefügt` : `${count} Seiten eingefügt`);
}
const insertBlank = () => paperDialog('insert');
function movePage(id, toIdx) {
  const from = S.pages.findIndex(p => p.id === id);
  if (from < 0 || toIdx === from || toIdx === from + 1) return;
  pushHist();
  const [p] = S.pages.splice(from, 1);
  S.pages.splice(toIdx > from ? toIdx - 1 : toIdx, 0, p);
  S.cur = S.pages.indexOf(p); S.selPages.clear();
  markDirty(); buildViewer(); scrollToPage(S.cur);
}

/* ---------- Bilder und Unterschrift ---------- */
function registerImage(url, fmt, w, h) { const id = uid('i'); S.images.set(id, { url, fmt, w, h }); return id; }
function placeImage(imgId, targetW, p, at) {
  p = p || S.pages[S.cur]; if (!p) return;
  const im = S.images.get(imgId), [W, H] = dims(p);
  let w = Math.min(targetW, W * 0.6), h = w * im.h / im.w;
  if (h > H * 0.6) { h = H * 0.6; w = h * im.w / im.h; }
  let cx = W / 2, cy = H / 2;
  if (at) { cx = at[0]; cy = at[1]; }
  else {
    const e = els.get(p.id), r = e.wrap.getBoundingClientRect(), v = viewer.getBoundingClientRect();
    const top = Math.max(r.top, v.top), bot = Math.min(r.bottom, v.bottom);
    if (bot > top) cy = ((top + bot) / 2 - r.top) / S.zoom;
  }
  const a = { id: uid(), t: 'img', img: imgId, x: clamp(cx - w / 2, 0, Math.max(0, W - w)), y: clamp(cy - h / 2, 0, Math.max(0, H - h)), w, h };
  pushHist(); p.annots.push(a); markDirty();
  setTool('select'); select(p.id, a.id); drawAnnots(p);
}
function loadImageFile(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = () => rej(new Error('lesen'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => rej(new Error('bild'));
      img.onload = () => {
        const jpg = /jpe?g/i.test(file.type);
        let w = img.naturalWidth, h = img.naturalHeight;
        if (jpg) { res(registerImage(fr.result, 'jpg', w, h)); return; }
        const s = Math.min(1, 2400 / Math.max(w, h));
        const c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        res(registerImage(c.toDataURL('image/png'), 'png', c.width, c.height));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
async function insertImages(files, p, at) {
  for (const f of files) {
    try { const id = await loadImageFile(f); placeImage(id, 220, p, at); } catch (e) { toast(`„${f.name}“ konnte nicht als Bild gelesen werden.`); }
  }
}

const sig = { mode: 'draw', ctx: null, down: false, last: null, w: 2.6, color: '#1b2a6b', has: false };
const sigCanvas = $('#sigCanvas');
function openSig() {
  commitEdit();
  $('#sigModal').hidden = false;
  $('#sigSaved').hidden = !lsGet('pdfwb.signature');
  requestAnimationFrame(() => { sizeSig(); setSigMode('draw'); });
}
function closeSig() { $('#sigModal').hidden = true; }
function sizeSig() {
  const r = sigCanvas.getBoundingClientRect();
  sigCanvas.width = Math.max(300, Math.round(r.width * 2)); sigCanvas.height = Math.max(100, Math.round(r.height * 2));
  sig.ctx = sigCanvas.getContext('2d'); sig.ctx.setTransform(2, 0, 0, 2, 0, 0);
  sig.ctx.lineCap = 'round'; sig.ctx.lineJoin = 'round'; sig.has = false;
}
function clearSig() { sig.ctx.save(); sig.ctx.setTransform(1, 0, 0, 1, 0, 0); sig.ctx.clearRect(0, 0, sigCanvas.width, sigCanvas.height); sig.ctx.restore(); sig.has = false; }
function setSigMode(m) {
  sig.mode = m;
  $('#sigTabDraw').setAttribute('aria-pressed', String(m === 'draw'));
  $('#sigTabType').setAttribute('aria-pressed', String(m === 'type'));
  $('#sigText').hidden = m !== 'type';
  sigCanvas.style.pointerEvents = m === 'draw' ? '' : 'none';
  clearSig();
  if (m === 'type') { $('#sigText').focus(); drawTypedSig(); }
}
async function drawTypedSig() {
  clearSig();
  const txt = $('#sigText').value.trim(); if (!txt) return;
  try { await document.fonts.load('64px Caveat'); } catch (e) { /* Fallback */ }
  if (sig.mode !== 'type') return;
  clearSig();
  const W = sigCanvas.width / 2, H = sigCanvas.height / 2, ctx = sig.ctx;
  let size = H * 0.55;
  ctx.font = `500 ${size}px Caveat, "Segoe Script", cursive`;
  const mw = ctx.measureText(txt).width;
  if (mw > W * 0.86) size *= (W * 0.86) / mw;
  ctx.font = `500 ${size}px Caveat, "Segoe Script", cursive`;
  ctx.fillStyle = sig.color; ctx.textBaseline = 'alphabetic';
  ctx.fillText(txt, W * 0.09, H * 0.7);
  sig.has = true;
}
sigCanvas.addEventListener('pointerdown', e => {
  if (sig.mode !== 'draw') return;
  sigCanvas.setPointerCapture(e.pointerId);
  const r = sigCanvas.getBoundingClientRect();
  sig.down = true; sig.last = [e.clientX - r.left, e.clientY - r.top, performance.now()]; sig.w = 2.6;
  sig.ctx.fillStyle = sig.color; sig.ctx.beginPath(); sig.ctx.arc(sig.last[0], sig.last[1], 1.2, 0, Math.PI * 2); sig.ctx.fill();
  sig.has = true;
});
sigCanvas.addEventListener('pointermove', e => {
  if (!sig.down) return;
  const r = sigCanvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, t = performance.now();
  const [lx, ly, lt] = sig.last, v = Math.hypot(x - lx, y - ly) / Math.max(1, t - lt);
  sig.w = sig.w * 0.7 + clamp(3.4 - v * 1.4, 1.2, 3.4) * 0.3;
  const ctx = sig.ctx; ctx.strokeStyle = sig.color; ctx.lineWidth = sig.w;
  ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(x, y); ctx.stroke();
  sig.last = [x, y, t];
});
const sigUp = () => { sig.down = false; };
sigCanvas.addEventListener('pointerup', sigUp); sigCanvas.addEventListener('pointercancel', sigUp);
function trimSig() {
  const c = sigCanvas, d = sig.ctx.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    if (d[(y * c.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  const pad = 6; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(c.width - 1, x1 + pad); y1 = Math.min(c.height - 1, y1 + pad);
  const o = document.createElement('canvas'); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
  o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return { url: o.toDataURL('image/png'), w: o.width, h: o.height };
}
function useSignature(t) {
  const id = registerImage(t.url, 'png', t.w, t.h);
  closeSig(); placeImage(id, 150);
}
function sigOk() {
  const t = sig.has ? trimSig() : null;
  if (!t) { toast(sig.mode === 'type' ? 'Bitte zuerst deinen Namen eingeben.' : 'Bitte zuerst im Feld unterschreiben.'); return; }
  if ($('#sigRemember').checked) lsSet('pdfwb.signature', JSON.stringify(t));
  useSignature(t);
}

/* ---------- Bestätigungsdialog ---------- */
function ask(title, text, yes = 'Verwerfen', no = 'Abbrechen', danger = true) {
  return new Promise(res => {
    $('#askTitle').textContent = title; $('#askText').textContent = text;
    $('#askYes').textContent = yes; $('#askNo').textContent = no; $('#askYes').className = 'btn ' + (danger ? 'danger' : 'primary');
    const m = $('#askModal'); m.hidden = false; $('#askNo').focus();
    const done = v => { m.hidden = true; $('#askYes').onclick = $('#askNo').onclick = null; res(v); };
    $('#askYes').onclick = () => done(true); $('#askNo').onclick = () => done(false);
  });
}

/* ---------- Dialoge und Menü ---------- */
function dialog(title, html, okLabel, onOk) {
  commitEdit(); closeMenu();
  $('#dlgTitle').textContent = title; $('#dlgBody').innerHTML = html; $('#dlgOk').textContent = okLabel; $('#dlgCancel').hidden = false;
  $('#dlgBody').onclick = $('#dlgBody').onchange = null;
  const m = $('#dlg'); m.hidden = false;
  const first = $('input:not([type=checkbox]):not([type=color]),select', $('#dlgBody'));
  if (first && !COARSE) setTimeout(() => first.focus(), 30);
  const close = () => { m.hidden = true; $('#dlgOk').onclick = $('#dlgCancel').onclick = null; };
  $('#dlgCancel').onclick = close;
  $('#dlgOk').onclick = () => { if (onOk($('#dlgBody')) !== false) close(); };
}
function openMenu() { const m = $('#menu'); m.hidden = false; $('#btnMore').setAttribute('aria-expanded', 'true'); const f = $('button', m); if (f && !COARSE) f.focus(); }
function closeMenu() { const m = $('#menu'); if (m.hidden) return; m.hidden = true; $('#btnMore').setAttribute('aria-expanded', 'false'); }

function watermarkDialog() {
  dialog('Wasserzeichen', `
    <label class="fld"><span>Text</span><input class="field" id="wmText" value="ENTWURF" maxlength="60"></label>
    <div class="frow">
      <label class="fld"><span>Farbe</span><input type="color" id="wmColor" value="#d0342c"></label>
      <label class="fld"><span>Deckkraft</span><input type="range" id="wmOp" min="5" max="60" value="18"></label>
      <label class="fld"><span>Ausrichtung</span><select class="field" id="wmAng"><option value="45">Diagonal</option><option value="0">Waagerecht</option><option value="90">Senkrecht</option></select></label>
    </div>
    <label class="fld"><span>Seiten</span><select class="field" id="wmPages"><option value="all">Alle Seiten</option><option value="cur">Nur aktuelle Seite</option></select></label>`, 'Einfügen', b => {
    const text = $('#wmText', b).value.trim();
    if (!text) { toast('Bitte einen Text eingeben.'); return false; }
    const ang = +$('#wmAng', b).value, ps = $('#wmPages', b).value === 'all' ? S.pages : [S.pages[S.cur]];
    pushHist();
    for (const p of ps) {
      const [W, H] = dims(p), w72 = measure(text, { bold: true, size: 72, font: 'Helvetica' });
      const span = ang === 45 ? Math.hypot(W, H) * 0.62 : (ang === 0 ? W : H) * 0.78;
      const size = Math.round(clamp(72 * span / w72, 16, 160));
      p.annots.push({ id: uid(), t: 'wm', x: W / 2, y: H / 2, text, size, color: $('#wmColor', b).value, op: +$('#wmOp', b).value, ang });
      drawAnnots(p);
    }
    markDirty(); toast(ps.length === 1 ? 'Wasserzeichen eingefügt' : `Wasserzeichen auf ${ps.length} Seiten eingefügt`);
  });
}
function pageNumberDialog() {
  dialog('Seitenzahlen', `
    <label class="fld"><span>Format</span><select class="field" id="pnFmt"><option value="Seite {n} von {N}">Seite 1 von 5</option><option value="{n} / {N}">1 / 5</option><option value="{n}">1</option><option value="– {n} –">– 1 –</option></select></label>
    <div class="frow">
      <label class="fld"><span>Position</span><select class="field" id="pnPos"><option value="bc">Unten mittig</option><option value="br">Unten rechts</option><option value="bl">Unten links</option><option value="tc">Oben mittig</option><option value="tr">Oben rechts</option></select></label>
      <label class="fld"><span>Größe (pt)</span><input class="field num" type="number" id="pnSize" value="9" min="6" max="24"></label>
      <label class="fld"><span>Beginnt bei</span><input class="field num" type="number" id="pnStart" value="1" min="0" max="9999"></label>
    </div>
    <label class="chk"><input type="checkbox" id="pnSkip"> Erste Seite ohne Nummer (Deckblatt)</label>
    <p class="note">Bereits eingefügte Seitenzahlen werden ersetzt.</p>`, 'Einfügen', b => {
    const fmt = $('#pnFmt', b).value, pos = $('#pnPos', b).value, size = clamp(+$('#pnSize', b).value || 9, 6, 24);
    const start = Math.max(0, Math.round(+$('#pnStart', b).value || 1)), skip = $('#pnSkip', b).checked;
    const last = S.pages.length - (skip ? 1 : 0) + start - 1;
    pushHist();
    S.pages.forEach((p, i) => {
      p.annots = p.annots.filter(a => !a.pn);
      if (!(skip && i === 0)) {
        const n = i + start - (skip ? 1 : 0), text = fmt.replace('{n}', n).replace('{N}', last);
        const a = { id: uid(), t: 'text', text, size, font: 'Helvetica', bold: false, color: '#1b2130', pn: true };
        const w = measure(text, a), [W, H] = dims(p), m = 30;
        a.x = pos[1] === 'c' ? (W - w) / 2 : pos[1] === 'r' ? W - m - w : m;
        a.y = pos[0] === 'b' ? H - m * 0.75 - LH * size : m * 0.75;
        p.annots.push(a);
      }
      drawAnnots(p);
    });
    markDirty(); toast('Seitenzahlen eingefügt');
  });
}
/* ---------- Dokumenteinstellungen (Reiter: Dokument, Kommentare, Messen, Ansicht) ---------- */
function settingsDialog(tab = 'doc') {
  const m = S.meta, P = S.prefs;
  const f = (id, label, v, ph = '') => `<label class="fld"><span>${label}</span><input class="field" id="${id}" value="${esc(v || '')}" placeholder="${esc(ph)}"></label>`;
  const chk = (id, label, on, note = '') => `<label class="chk big"><input type="checkbox" id="${id}"${on ? ' checked' : ''}><span>${label}${note ? `<small>${note}</small>` : ''}</span></label>`;
  const opt = (v, l, cur) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${l}</option>`;
  const tabs = [['doc', 'Dokument'], ['cmt', 'Kommentare'], ['meas', 'Messen'], ['view', 'Ansicht'], ...(AIX ? [['ai', 'KI']] : [])];
  const nMarks = S.pages.reduce((s, p) => s + p.annots.filter(a => !a.pn).length, 0);
  dialog('Einstellungen', `
    <div class="seg stab" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" data-st="${k}" aria-pressed="${k === tab}">${l}</button>`).join('')}</div>
    <div class="spage" data-sp="doc">
      ${f('mTitle', 'Titel', m.title)}${f('mAuthor', 'Autor des Dokuments', m.author)}
      <div class="frow">${f('mSubject', 'Betreff', m.subject)}${f('mKeys', 'Stichwörter (mit Komma getrennt)', m.keywords)}</div>
      <label class="fld"><span>Beim Öffnen in anderen Programmen anzeigen</span><select class="field" id="mMode">${opt('', 'Nur die Seiten', m.pageMode || '')}${opt('UseOutlines', 'Seiten und Lesezeichen', m.pageMode || '')}${opt('UseThumbs', 'Seiten und Miniaturen', m.pageMode || '')}</select></label>
      <p class="note">${S.pages.length} Seiten · ${nMarks} Kommentare und Markierungen · ${S.bookmarks.length} Lesezeichen</p>
    </div>
    <div class="spage" data-sp="cmt" hidden>
      ${f('pAuthor', 'Dein Name für Kommentare', P.author, 'z. B. ' + (m.author || 'Max Mustermann'))}
      <div class="fld"><span>Markierungen und Kommentare beim Speichern</span>
        <label class="chk big"><input type="radio" name="pExp" value="annots"${P.exportMarks === 'annots' ? ' checked' : ''}><span>Als bearbeitbare PDF-Kommentare<small>Markieren, Unterstreichen, Durchstreichen, Stift, Formen, Textfelder und Stempel bleiben in Acrobat, Vorschau und im Browser als Kommentare mit Autor und Text erhalten.</small></span></label>
        <label class="chk big"><input type="radio" name="pExp" value="flatten"${P.exportMarks === 'flatten' ? ' checked' : ''}><span>Fest in die Seite einbetten<small>Sieht überall gleich aus, lässt sich aber nicht mehr als Kommentar bearbeiten.</small></span></label>
      </div>
      ${chk('pAsk', 'Nach dem Markieren nach einem Kommentar fragen', P.askComment)}
      ${chk('pShow', 'Markierungen und Kommentare anzeigen', P.showMarks, 'Ausschalten zeigt die Seiten ohne eigene Elemente. Gespeichert wird trotzdem alles.')}
      <div class="frow">
        <label class="fld"><span>Farbe Markieren</span><input type="color" id="pHl" value="${P.hlColor}"></label>
        <label class="fld"><span>Farbe Unterstreichen</span><input type="color" id="pUl" value="${P.ulColor}"></label>
        <label class="fld"><span>Farbe Durchstreichen</span><input type="color" id="pSo" value="${P.soColor}"></label>
      </div>
    </div>
    <div class="spage" data-sp="meas" hidden>
      <div class="frow">
        <label class="fld"><span>Einheit</span><select class="field" id="pUnit">${Object.entries(UNITS).map(([k, u]) => opt(k, `${u[2]} (${u[1]})`, P.unit)).join('')}</select></label>
        <label class="fld"><span>Nachkommastellen</span><select class="field" id="pDec">${[0, 1, 2, 3, 4].map(d => opt(d, d, P.decimals)).join('')}</select></label>
        <label class="fld"><span>Maßstab</span><select class="field" id="pScale">${SCALES.map(s => opt(s, '1 : ' + s, P.scale)).join('')}</select></label>
      </div>
      ${chk('pAll', 'Vorhandene Messungen ebenfalls umstellen', true)}
      <p class="note">Beispiel: 100 pt entsprechen <b id="pEx">${fmtLen(100, P.unit, P.scale, P.decimals)}</b>.</p>
    </div>
    <div class="spage" data-sp="view" hidden>
      <label class="fld"><span>Darstellung</span><select class="field" id="pTheme">${opt('', 'Wie das System', lsGet('pdfwb.theme') || '')}${opt('light', 'Hell', lsGet('pdfwb.theme') || '')}${opt('dark', 'Dunkel', lsGet('pdfwb.theme') || '')}</select></label>
      ${chk('pGroup', 'Werkzeuge gruppieren', tbCompact, 'Ähnliche Werkzeuge (Formen, Markieren, Stempel …) teilen sich einen Knopf mit Ausklapp-Menü.')}
      <p class="note" style="margin:-4px 0 10px"><button type="button" class="btn" id="pTb">${icon('sliders')}Werkzeugleiste anpassen …</button></p>
      ${chk('pSnap', 'Hilfslinien beim Verschieben', P.snap, 'Elemente rasten an Seitenrand, Mitte und anderen Elementen ein.')}
      ${chk('pShape', 'Formen beim Zeichnen erkennen', TP.pen.shapes, 'Strich am Ende kurz halten: Linie, Rechteck oder Ellipse.')}
      ${chk('pNight', 'Nachtmodus für Seiten', S.night)}
      ${COARSE ? chk('pPencil', 'Nur Apple Pencil zeichnet', S.pencil.only, 'Finger scrollen und zoomen, der Handballen malt nicht mit.') : ''}
    </div>
    ${AIX ? '<div class="spage" data-sp="ai" hidden><div id="stAI"></div></div>' : ''}`, 'Übernehmen', b => {
    S.meta = { title: $('#mTitle', b).value.trim(), author: $('#mAuthor', b).value.trim(), subject: $('#mSubject', b).value.trim(), keywords: $('#mKeys', b).value.trim(), pageMode: $('#mMode', b).value };
    const unit = $('#pUnit', b).value, dec = +$('#pDec', b).value, scale = +$('#pScale', b).value;
    Object.assign(S.prefs, {
      author: $('#pAuthor', b).value.trim(), exportMarks: $('input[name=pExp]:checked', b).value, askComment: $('#pAsk', b).checked,
      showMarks: $('#pShow', b).checked, hlColor: $('#pHl', b).value, ulColor: $('#pUl', b).value, soColor: $('#pSo', b).value,
      unit, decimals: dec, scale, snap: $('#pSnap', b).checked,
    });
    savePrefs();
    TP.hl.color = S.prefs.hlColor; TP.ul.color = S.prefs.ulColor; TP.so.color = S.prefs.soColor;
    TP.measure.unit = unit; TP.measure.scale = scale; TP.pen.shapes = $('#pShape', b).checked;
    if ($('#pAll', b).checked) for (const p of S.pages) for (const a of p.annots) if (a.t === 'measure') { a.unit = unit; a.scale = scale; delete a.dec; }
    setNight($('#pNight', b).checked);
    setTheme($('#pTheme', b).value);
    if ($('#pGroup', b).checked !== tbCompact) { tbCompact = $('#pGroup', b).checked; lsSet('pdfwb.tbcompact', tbCompact ? '1' : '0'); applyToolbar(); }
    if ($('#pPencil', b)) setPencilOnly($('#pPencil', b).checked, true);
    pagesEl.classList.toggle('hidemarks', !S.prefs.showMarks); updateSideLater();
    S.pages.forEach(drawAnnots); markDirty(); renderProps();
    toast('Einstellungen übernommen');
  });
  const body = $('#dlgBody');
  body.querySelector('.stab').addEventListener('click', e => {
    const t = e.target.closest('[data-st]'); if (!t) return;
    $$('[data-st]', body).forEach(x => x.setAttribute('aria-pressed', String(x === t)));
    $$('[data-sp]', body).forEach(x => { x.hidden = x.dataset.sp !== t.dataset.st; });
  });
  $$('[data-sp]', body).forEach(x => { x.hidden = x.dataset.sp !== tab; });
  $('#pTb', body).onclick = () => { $('#dlgCancel').click(); setTimeout(toolbarDialog, 30); };
  $('#pTheme', body).onchange = e => setTheme(e.target.value);
  if (AIX) AIX.renderSetup($('#stAI', body), { onChange: () => aiUpdateHead() });
  const ex = () => { $('#pEx', body).textContent = fmtLen(100, $('#pUnit', body).value, +$('#pScale', body).value, +$('#pDec', body).value); };
  ['#pUnit', '#pDec', '#pScale'].forEach(s => $(s, body).addEventListener('change', ex));
}
const metaDialog = () => settingsDialog('doc');
const SCALES = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
function duplicatePage() {
  commitEdit();
  const p = S.pages[S.cur]; if (!p) return;
  pushHist();
  const c = clone(p); c.id = uid('p'); c.annots = c.annots.map(a => ({ ...a, id: uid() }));
  S.pages.splice(S.cur + 1, 0, c);
  S.selPages.clear(); markDirty(); buildViewer(); scrollToPage(S.cur + 1);
  toast('Seite dupliziert');
}
async function exportPagePng() {
  commitEdit();
  const p = S.pages[S.cur]; if (!p || S.busy) return;
  busy(true, 'Bild wird erstellt …');
  try {
    const proxy = proxyOf(p), vp = proxy.getViewport({ scale: 2.5, rotation: rotOf(p) });
    const c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
    await proxy.render({ canvasContext: ctx, viewport: vp }).promise;
    if (p.annots.length) {
      const [W, H] = dims(p);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${c.width}" height="${c.height}" viewBox="0 0 ${W} ${H}">${p.annots.map(annotSVG).join('')}</svg>`;
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
      ctx.drawImage(img, 0, 0, c.width, c.height);
    }
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    busy(false);
    await saveBytes(blob, `${baseName()}-Seite-${S.cur + 1}.png`);
  } catch (e) { console.error(e); busy(false); toast('Das Bild konnte nicht erstellt werden.'); }
}
async function exportText() {
  commitEdit(); if (S.busy) return;
  busy(true, 'Text wird gelesen …');
  try {
    const parts = [];
    for (const [i, p] of S.pages.entries()) {
      const tc = await textContent(p), lines = [];
      let line = '', lastY = null;
      for (const it of tc.items) {
        const y = it.transform[5];
        if (lastY !== null && Math.abs(y - lastY) > 2 && line) { lines.push(line); line = ''; }
        line += it.str; lastY = y;
        if (it.hasEOL) { lines.push(line); line = ''; }
      }
      if (line) lines.push(line);
      const own = p.annots.filter(a => (a.t === 'text' || a.t === 'note') && a.text).map(a => (a.t === 'note' ? 'Notiz: ' : '') + a.text);
      parts.push(`--- Seite ${i + 1} ---\n` + lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + (own.length ? '\n\n' + own.join('\n') : ''));
    }
    busy(false);
    await saveBytes(new Blob(['﻿' + parts.join('\n\n') + '\n'], { type: 'text/plain;charset=utf-8' }), baseName() + '.txt');
  } catch (e) { console.error(e); busy(false); toast('Der Text konnte nicht gelesen werden.'); }
}
async function newDocument(kind = 'blank', size = A4, count = 1) {
  const bytes = await makePaper(kind, size, count);
  await openFiles([new File([bytes], kind === 'blank' ? 'Neues Dokument.pdf' : `Notizen ${PAPERS[kind].toLowerCase()}.pdf`, { type: 'application/pdf' })], 'replace', true);
}

/* ---------- Seitenleiste: Lesezeichen und Kommentare ---------- */
function setSideTab(t) {
  S.sideTab = t;
  $$('.stabs [data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
  thumbsEl.hidden = t !== 'pages'; $('#marksPanel').hidden = t !== 'marks'; $('#notesPanel').hidden = t !== 'notes';
  if (t === 'marks') renderMarks();
  if (t === 'notes') renderNotes();
  if (t === 'pages') markThumbSel();
}
function openSide(t) {
  if (innerWidth <= 760) work.classList.add('thumbs-open'); else work.classList.remove('nothumbs');
  $('#btnThumbs').setAttribute('aria-pressed', 'true');
  setSideTab(t);
}
let sideT = 0;
function updateSideLater() { clearTimeout(sideT); sideT = setTimeout(() => { updateNoteBadge(); if (S.sideTab === 'notes') renderNotes(); if (S.sideTab === 'marks') renderMarks(); }, 220); }
const pageNo = pid => { const i = S.pages.findIndex(p => p.id === pid); return i < 0 ? null : i + 1; };

async function importOutline(srcId, pages) {
  const s = S.sources.get(srcId); if (!s) return [];
  let ol = null;
  try { ol = await s.pdf.getOutline(); } catch (e) { return []; }
  if (!ol || !ol.length) return [];
  const byIdx = new Map(pages.map(p => [p.idx, p.id]));
  let budget = 400;
  const conv = async (items, depth) => {
    const out = [];
    for (const it of items) {
      if (--budget < 0) break;
      let pid = null;
      try {
        let dest = it.dest;
        if (typeof dest === 'string') dest = await s.pdf.getDestination(dest);
        if (Array.isArray(dest) && dest[0] != null) {
          const ix = typeof dest[0] === 'object' ? await s.pdf.getPageIndex(dest[0]) : Number.isInteger(dest[0]) ? dest[0] : null;
          if (ix != null) pid = byIdx.get(ix) || null;
        }
      } catch (e) { pid = null; }
      const kids = depth < 6 && it.items && it.items.length ? await conv(it.items, depth + 1) : [];
      if (pid || kids.length) out.push({ id: uid('b'), title: (it.title || 'Ohne Titel').trim(), pid: pid || kids[0].pid, kids });
    }
    return out;
  };
  return conv(ol, 0);
}
function findMark(id, list = S.bookmarks, parent = null) {
  for (const b of list) { if (b.id === id) return { b, list, parent }; const r = findMark(id, b.kids, b); if (r) return r; }
  return null;
}
function addBookmark() {
  const p = S.pages[S.cur]; if (!p) return;
  const b = { id: uid('b'), title: `Seite ${S.cur + 1}`, pid: p.id, kids: [] };
  // nach Seitenreihenfolge einsortieren
  const i = S.bookmarks.findIndex(x => (pageNo(x.pid) || 1e9) > S.cur + 1);
  if (i < 0) S.bookmarks.push(b); else S.bookmarks.splice(i, 0, b);
  markDirty(); openSide('marks'); renameMark(b.id);
}
function renameMark(id) {
  const row = $(`#marksPanel [data-bid="${id}"]`); if (!row) return;
  const f = findMark(id); if (!f) return;
  const tx = $('.tx', row), inp = document.createElement('input');
  inp.value = f.b.title; inp.setAttribute('aria-label', 'Name des Lesezeichens');
  tx.replaceWith(inp); inp.focus(); inp.select();
  const done = save => { if (save && inp.value.trim()) { f.b.title = inp.value.trim(); markDirty(); } renderMarks(); };
  inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
  inp.addEventListener('blur', () => done(true));
  inp.addEventListener('click', e => e.stopPropagation());
}
function renderMarks() {
  const el = $('#marksPanel');
  const rows = [];
  const walk = (list, depth) => {
    for (const b of list) {
      const n = pageNo(b.pid);
      rows.push(`<div class="sitem" role="button" tabindex="0" data-bid="${b.id}" style="padding-left:${8 + depth * 14}px" title="Doppelklick zum Umbenennen">
        <i data-i="bookmark"></i><span class="tx">${esc(b.title)}</span><span class="pg">${n || '–'}</span><button class="x" data-del="${b.id}" aria-label="Lesezeichen löschen" title="Löschen">×</button></div>`);
      walk(b.kids, depth + 1);
    }
  };
  walk(S.bookmarks, 0);
  el.innerHTML = `<div class="sphead"><span>Lesezeichen</span><button class="btn" id="bmAdd" title="Lesezeichen für die aktuelle Seite">+ Seite ${S.cur + 1}</button></div>` +
    (rows.length ? rows.join('') : '<p class="sempty">Noch keine Lesezeichen. Sie werden beim Speichern als Inhaltsverzeichnis in die PDF geschrieben und in jedem PDF-Programm angezeigt.</p>');
  $$('[data-i]', el).forEach(i => { i.outerHTML = icon(i.dataset.i); });
}
/* Kommentarliste: Art, markierter Text, Kommentar, Seite; filterbar und exportierbar */
const NOTE_FILTERS = [['all', 'Alle'], ['cmt', 'Mit Kommentar'], ['mark', 'Textmarkierungen'], ['note', 'Notizen'], ['draw', 'Zeichnungen und Formen'], ['other', 'Sonstiges']];
const noteGroup = a => (a.t === 'note' ? 'note' : a.t === 'mark' || a.t === 'hl' ? 'mark' : ['pen', 'rect', 'ellipse', 'line', 'arrow', 'check', 'cross'].includes(a.t) ? 'draw' : 'other');
function noteEntry(a) {
  let title = TOOL_NAMES[a.t] || a.t, quote = '', body = '';
  if (a.t === 'note') { title = 'Notiz'; body = a.text || 'Leere Notiz'; }
  else if (a.t === 'mark') { title = { hl: 'Markierung', ul: 'Unterstreichung', so: 'Durchstreichung' }[a.kind]; quote = a.text || ''; }
  else if (a.t === 'text') { title = 'Text'; quote = a.text.split('\n')[0]; }
  else if (a.t === 'stamp' || a.t === 'wm') quote = a.text;
  else if (a.t === 'measure') body = measureLabel(a) + ((a.scale || 1) > 1 ? ` (1 : ${a.scale})` : '');
  else if (a.t === 'pen') title = { fount: 'Füller', ball: 'Kugelschreiber', marker: 'Textmarker' }[penKind(a)] || 'Stift';
  if (a.comment) body = a.comment;
  return { title, quote, body };
}
function renderNotes() {
  const el = $('#notesPanel'), rows = [], f = S.noteFilter || 'all';
  let total = 0;
  S.pages.forEach((p, i) => {
    for (const a of p.annots) {
      if (a.pn) continue;
      total++;
      if (f === 'cmt' ? !(a.comment || (a.t === 'note' && a.text)) : f !== 'all' && noteGroup(a) !== f) continue;
      const { title, quote, body } = noteEntry(a);
      const col = a.t === 'redact' ? '#000000' : a.t === 'white' ? '#ffffff' : a.t === 'img' ? '#9aa1ad' : a.color || '#1b2130';
      rows.push(`<button class="sitem" data-pid="${p.id}" data-aid="${a.id}"><span class="dot" style="background:${col}"></span><span class="tx"><small>${esc(title)}</small>${quote ? `<q>${esc(quote.length > 140 ? quote.slice(0, 139) + '…' : quote)}</q>` : ''}${body ? `<span class="cb">${esc(body)}</span>` : ''}</span><span class="pg">${i + 1}</span></button>`);
    }
  });
  el.innerHTML = `<div class="sphead"><span>Kommentare</span><span>${rows.length === total ? total : rows.length + ' / ' + total}</span></div>
    <div class="nfbar"><select class="field" id="noteFilter" aria-label="Kommentare filtern">${NOTE_FILTERS.map(([k, l]) => `<option value="${k}"${k === f ? ' selected' : ''}>${l}</option>`).join('')}</select>
    <button class="ibtn" id="noteExport" title="Kommentare als Textdatei speichern" aria-label="Kommentare exportieren"${total ? '' : ' disabled'}>${icon('save')}</button>
    <button class="ibtn" id="noteEye" title="${S.prefs.showMarks ? 'Markierungen auf den Seiten ausblenden' : 'Markierungen sind ausgeblendet – einblenden'}" aria-label="Markierungen ein- oder ausblenden" aria-pressed="${!S.prefs.showMarks}">${icon(S.prefs.showMarks ? 'eye' : 'eyeoff')}</button>
    <button class="ibtn" id="noteSettings" title="Einstellungen für Kommentare" aria-label="Einstellungen für Kommentare">${icon('gear')}</button></div>` +
    (rows.length ? rows.join('') : `<p class="sempty">${total ? 'Keine Einträge für diesen Filter.' : 'Noch keine Kommentare. Notizen, Markierungen, Stempel und Zeichnungen erscheinen hier, geordnet nach Seiten. Jedes Element kann über die Sprechblase einen eigenen Kommentar bekommen.'}</p>`);
}
async function exportNotes() {
  const lines = [`Kommentare zu ${S.docName}`, `Erstellt am ${new Date().toLocaleString('de-DE')} von ${commentAuthor()}`, ''];
  S.pages.forEach((p, i) => {
    const list = p.annots.filter(a => !a.pn);
    if (!list.length) return;
    lines.push(`--- Seite ${i + 1} ---`);
    for (const a of list) {
      const { title, quote, body } = noteEntry(a);
      lines.push(`• ${title}${quote ? `: „${quote}“` : ''}`);
      if (body) lines.push(`  ${body.replace(/\n/g, '\n  ')}`);
    }
    lines.push('');
  });
  await saveBytes(new Blob(['\ufeff' + lines.join('\n')], { type: 'text/plain;charset=utf-8' }), baseName() + '-Kommentare.txt');
}
function updateNoteBadge() {
  let n = 0;
  for (const p of S.pages) for (const a of p.annots) if (!a.pn) n++;
  const b = $('#noteBadge'); b.hidden = !n; b.textContent = n > 99 ? '99+' : n;
}
function gotoAnnot(pid, aid) {
  const p = pageById(pid); if (!p) return;
  const a = p.annots.find(x => x.id === aid); if (!a) return;
  setTool('select'); select(p.id, a.id);
  const e = els.get(p.id), b = bbox(a);
  viewer.scrollTo({ top: e.wrap.offsetTop + b.y * S.zoom - viewer.clientHeight * 0.3, left: Math.max(0, e.wrap.offsetLeft + b.x * S.zoom - viewer.clientWidth / 3), behavior: reduceMotion ? 'auto' : 'smooth' });
  setCurrent(S.pages.indexOf(p));
  if (innerWidth <= 760) { work.classList.remove('thumbs-open'); $('#btnThumbs').setAttribute('aria-pressed', 'false'); }
}
/* Lesezeichen als PDF-Gliederung schreiben */
function writeOutline(out, pageList) {
  if (!S.bookmarks.length) return;
  const idx = new Map(pageList.map((p, i) => [p.id, i])), pages = out.getPages(), ctx = out.context;
  const { PDFName, PDFHexString, PDFNumber } = PL;
  const valid = list => list.flatMap(b => {
    const kids = valid(b.kids);
    if (!idx.has(b.pid)) return kids;   // Seite gelöscht: Unterpunkte rücken auf
    return [{ title: b.title, page: pages[idx.get(b.pid)], kids }];
  });
  const items = valid(S.bookmarks);
  if (!items.length) return;
  const count = list => list.reduce((s, b) => s + 1 + count(b.kids), 0);
  const build = (list, parentRef) => {
    const refs = list.map(() => ctx.nextRef());
    list.forEach((b, i) => {
      const d = ctx.obj({ Title: PDFHexString.fromText(b.title), Parent: parentRef, Dest: [b.page.ref, PDFName.of('Fit')] });
      if (i > 0) d.set(PDFName.of('Prev'), refs[i - 1]);
      if (i < list.length - 1) d.set(PDFName.of('Next'), refs[i + 1]);
      if (b.kids.length) {
        const kr = build(b.kids, refs[i]);
        d.set(PDFName.of('First'), kr[0]); d.set(PDFName.of('Last'), kr[kr.length - 1]);
        d.set(PDFName.of('Count'), PDFNumber.of(-count(b.kids)));
      }
      ctx.assign(refs[i], d);
    });
    return refs;
  };
  const rootRef = ctx.nextRef(), top = build(items, rootRef);
  ctx.assign(rootRef, ctx.obj({ Type: 'Outlines', First: top[0], Last: top[top.length - 1], Count: PDFNumber.of(count(items)) }));
  out.catalog.set(PDFName.of('Outlines'), rootRef);
  if (!S.meta.pageMode) out.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
}

/* ---------- Formularfelder (AcroForm) ausfüllen ---------- */
const formKey = (src, name) => src + '|' + name;
const formPending = new Map();
function formsOf(p) {
  const k = p.src + ':' + p.idx;
  if (S.forms.has(k)) return Promise.resolve(S.forms.get(k));
  if (!formPending.has(k)) formPending.set(k, (async () => {
    let list = [];
    try {
      const anns = await S.proxies.get(k).getAnnotations({ intent: 'display' });
      list = anns.filter(a => a.subtype === 'Widget' && a.fieldName && ['Tx', 'Btn', 'Ch'].includes(a.fieldType) && !a.pushButton && !a.hidden).map(a => ({
        name: a.fieldName, type: a.fieldType === 'Tx' ? 'text' : a.fieldType === 'Ch' ? 'choice' : a.radioButton ? 'radio' : 'check',
        rect: a.rect, multi: !!a.multiLine, ro: !!a.readOnly, max: a.maxLen || 0,
        options: (a.options || []).map(o => [o.exportValue, o.displayValue]),
        on: a.radioButton ? a.buttonValue : a.exportValue || 'Yes',
        init: a.fieldValue, fs: (a.defaultAppearanceData && a.defaultAppearanceData.fontSize) || 0,
        bc: a.borderColor && a.borderColor.length === 3 ? Array.from(a.borderColor) : null,
        bw: a.borderStyle && a.borderStyle.width != null ? a.borderStyle.width : 1,
      }));
    } catch (e) { list = []; }
    S.forms.set(k, list); formPending.delete(k);
    return list;
  })());
  return formPending.get(k);
}
function formValue(p, f) {
  const k = formKey(p.src, f.name);
  if (k in S.formVals) return S.formVals[k];
  if (f.type === 'check') return f.init != null && f.init !== 'Off' && (f.init === f.on || f.init === true);
  if (f.type === 'radio') return f.init && f.init !== 'Off' ? String(f.init) : '';
  return Array.isArray(f.init) ? f.init.join(', ') : f.init == null ? '' : String(f.init);
}
function setFormValue(p, f, v) {
  S.formVals[formKey(p.src, f.name)] = v;
  S.formTouched.add(p.src);
  // gleiche Felder auf anderen Seiten mitziehen
  for (const q of S.pages) if (q.src === p.src) { const e = els.get(q.id); if (e && e.forml) syncFormLayer(q); }
  markDirty();
}
async function buildFormLayer(p) {
  const e = els.get(p.id); if (!e) return;
  const list = await formsOf(p);
  if (!list.length || els.get(p.id) !== e) return;
  const [W, H] = dims(p), vp = S.proxies.get(p.src + ':' + p.idx).getViewport({ scale: 1, rotation: rotOf(p) });
  e.forml.innerHTML = '';
  list.forEach((f, i) => {
    const r = vp.convertToViewportRectangle(f.rect), x = Math.min(r[0], r[2]), y = Math.min(r[1], r[3]), w = Math.abs(r[2] - r[0]), h = Math.abs(r[3] - r[1]);
    let el;
    if (f.type === 'text') { el = document.createElement(f.multi ? 'textarea' : 'input'); if (!f.multi) el.type = 'text'; if (f.max) el.maxLength = f.max; }
    else if (f.type === 'choice') { el = document.createElement('select'); el.innerHTML = '<option value=""></option>' + f.options.map(([v, d]) => `<option value="${esc(v)}">${esc(d)}</option>`).join(''); }
    else { el = document.createElement('button'); el.type = 'button'; el.setAttribute('role', f.type === 'radio' ? 'radio' : 'checkbox'); }
    el.className = 'ff'; el.dataset.fi = i; el.title = f.name; el.setAttribute('aria-label', f.name);
    if (f.ro) el.disabled = true;
    const fs = f.fs || clamp((f.multi ? 10 : h * 0.62), 6, 12);
    Object.assign(el.style, { left: x / W * 100 + '%', top: y / H * 100 + '%', width: w / W * 100 + '%', height: h / H * 100 + '%' });
    el.style.setProperty('--fs', fs + 'px');
    if (f.bc && f.bw > 0) el.style.setProperty('--fbc', `rgb(${f.bc.join(',')})`);
    if (f.type === 'radio') el.style.borderRadius = '50%';
    el.addEventListener('pointerdown', ev => ev.stopPropagation());
    if (f.type === 'text') el.addEventListener('input', () => setFormValue(p, f, el.value));
    else if (f.type === 'choice') el.addEventListener('change', () => setFormValue(p, f, el.value));
    else el.addEventListener('click', () => {
      if (f.type === 'check') setFormValue(p, f, !formValue(p, f));
      else setFormValue(p, f, formValue(p, f) === f.on ? '' : f.on);
    });
    el.addEventListener('keydown', ev => ev.stopPropagation());
    e.forml.append(el);
  });
  syncFormLayer(p);
}
function syncFormLayer(p) {
  const e = els.get(p.id), list = S.forms.get(p.src + ':' + p.idx);
  if (!e || !e.forml || !list) return;
  for (const el of e.forml.children) {
    const f = list[+el.dataset.fi], v = formValue(p, f);
    if (f.type === 'check' || f.type === 'radio') { const on = f.type === 'check' ? !!v : v === f.on; el.textContent = on ? (f.type === 'radio' ? '●' : '✓') : ''; el.setAttribute('aria-checked', String(on)); }
    else if (document.activeElement !== el) el.value = v;
  }
}
/* Beim Speichern: Werte als Seiteninhalt einzeichnen, die ausgefüllten Felder werden dabei eingebettet */
async function drawFormValues(pg, p, getFont, clean) {
  if (!S.formTouched.has(p.src)) return;
  const list = await formsOf(p); if (!list.length) return;
  const font = await getFont('Helvetica', false), black = PL.rgb(0.07, 0.07, 0.1);
  for (const f of list) {
    const v = formValue(p, f), [x0, y0, x1, y1] = [Math.min(f.rect[0], f.rect[2]), Math.min(f.rect[1], f.rect[3]), Math.max(f.rect[0], f.rect[2]), Math.max(f.rect[1], f.rect[3])];
    const w = x1 - x0, h = y1 - y0;
    // Rahmen des Feldes bleibt sichtbar, auch wenn das Feld selbst eingebettet wird
    if (f.bc && f.bw > 0) {
      const bc = PL.rgb(f.bc[0] / 255, f.bc[1] / 255, f.bc[2] / 255);
      if (f.type === 'radio') pg.drawCircle({ x: x0 + w / 2, y: y0 + h / 2, size: Math.min(w, h) / 2 - f.bw / 2, borderColor: bc, borderWidth: f.bw });
      else pg.drawRectangle({ x: x0 + f.bw / 2, y: y0 + f.bw / 2, width: w - f.bw, height: h - f.bw, borderColor: bc, borderWidth: f.bw });
    }
    if (f.type === 'check' && v) {
      const s = Math.min(w, h) * 0.8, cx = x0 + w / 2, cy = y0 + h / 2;
      pg.drawSvgPath(`M ${cx - s * 0.35} ${-(cy + 0.02 * s)} L ${cx - s * 0.08} ${-(cy - 0.28 * s)} L ${cx + s * 0.4} ${-(cy + 0.32 * s)}`, { x: 0, y: 0, borderColor: black, borderWidth: Math.max(0.8, s * 0.12), borderLineCap: PL.LineCapStyle.Round });
    } else if (f.type === 'radio' && v === f.on) {
      pg.drawCircle({ x: x0 + w / 2, y: y0 + h / 2, size: Math.min(w, h) * 0.25, color: black });
    } else if ((f.type === 'text' || f.type === 'choice') && v) {
      const label = f.type === 'choice' ? ((f.options.find(o => o[0] === v) || [v, v])[1]) : v;
      const size = f.fs || clamp(f.multi ? 10 : h * 0.62, 6, 12);
      const lines = f.multi ? String(label).split('\n') : [String(label).replace(/\n/g, ' ')];
      lines.forEach((ln, i) => {
        const y = f.multi ? y1 - 2 - size * 0.9 - i * size * 1.15 : y0 + (h - size * 0.7) / 2;
        if (y < y0 - 1) return;
        pg.drawText(clean(font, ln), { x: x0 + 2, y, size, font, color: black });
      });
    }
  }
  // Widgets der Felder entfernen, die Werte stehen jetzt fest im Seiteninhalt
  const annots = pg.node.Annots(); if (!annots) return;
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1);
  const keep = [];
  for (let i = 0; i < annots.size(); i++) {
    const ref = annots.get(i), d = annots.lookup(i);
    const st = d && d.lookup ? d.lookup(PL.PDFName.of('Subtype')) : null, rect = d && d.lookup ? d.lookup(PL.PDFName.of('Rect')) : null;
    const r = rect && rect.asArray ? rect.asArray().map(n => n.asNumber ? n.asNumber() : 0) : null;
    const isField = st && st.toString() === '/Widget' && r && list.some(f => near([Math.min(f.rect[0], f.rect[2]), Math.min(f.rect[1], f.rect[3]), Math.max(f.rect[0], f.rect[2]), Math.max(f.rect[1], f.rect[3])], [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])]));
    if (!isField) keep.push(ref);
  }
  pg.node.set(PL.PDFName.of('Annots'), pg.doc.context.obj(keep));
}

/* ---------- Lesemodus und Nachtmodus ---------- */
function setReading(on) {
  commitEdit();
  S.reading = on;
  document.body.classList.toggle('reading', on);
  $('#readbar').hidden = !on;
  if (on) {
    if (S.tool !== 'select') setTool('select');
    const el = document.documentElement, r = el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen ? el.webkitRequestFullscreen() : null;
    if (r && r.catch) r.catch(() => {});
  } else if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  setTimeout(fitWidth, 60);
  updateStatus();
}
function setNight(on) {
  S.night = on;
  pagesEl.classList.toggle('night', on);
  lsSet('pdfwb.night', on ? '1' : '0');
  $('#readNight').setAttribute('aria-pressed', String(on));
  $('#mNight').textContent = (on ? '✓ ' : '') + 'Nachtmodus für Seiten';
}

/* ---------- Teilen (iPad/iPhone: Teilen-Menü) ---------- */
function canShareFiles() {
  try { return !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.pdf', { type: 'application/pdf' })] })); } catch (e) { return false; }
}
async function sharePdf() {
  commitEdit(); if (S.busy) return;
  busy(true, 'PDF wird für das Teilen erstellt …');
  let file;
  try { file = new File([await buildPdf(S.pages)], baseName() + '-bearbeitet.pdf', { type: 'application/pdf' }); }
  catch (e) { console.error(e); busy(false); toast('Die PDF konnte nicht erstellt werden.'); return; }
  busy(false);
  // Teilen braucht eine frische Nutzeraktion, deshalb noch ein Tippen
  if (!await ask('PDF ist bereit', `„${file.name}“ über das Teilen-Menü senden, speichern oder in einer anderen App öffnen.`, 'Teilen', 'Abbrechen', false)) return;
  try { await navigator.share({ files: [file], title: file.name }); }
  catch (e) { if (!e || e.name !== 'AbortError') toast('Teilen ist hier nicht möglich. Bitte „Speichern“ verwenden.'); }
}

/* ---------- Automatisch zwischenspeichern (IndexedDB) ---------- */
let idbP = null;
function idb() {
  if (!idbP) idbP = new Promise((res, rej) => {
    try { const r = indexedDB.open('pdf-werkbank', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }
    catch (e) { rej(e); }
  });
  return idbP;
}
function idbReq(mode, fn) {
  return idb().then(db => new Promise((res, rej) => {
    const tx = db.transaction('kv', mode), r = fn(tx.objectStore('kv'));
    tx.oncomplete = () => res(r && r.result); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
  }));
}
const idbGet = k => idbReq('readonly', s => s.get(k));
const idbSet = (k, v) => idbReq('readwrite', s => s.put(v, k));
const idbDel = k => idbReq('readwrite', s => s.delete(k));
const idbKeys = () => idbReq('readonly', s => s.getAllKeys());
const savedSrc = new Set();
let autoT = 0;
function scheduleAutosave() {
  if (S.sample || !S.pages.length) return;
  clearTimeout(autoT);
  if (S.lib) { libState('pending'); autoT = setTimeout(libSave, 1200); return; }
  autoT = setTimeout(autosave, 1500);
}
/* kompletter Bearbeitungsstand (Seiten, Elemente, Lesezeichen, Formulare); Quellen-PDFs separat */
function docState(imgIds) {
  if (!imgIds) { imgIds = new Set(); for (const p of S.pages) for (const a of p.annots) if (a.img) imgIds.add(a.img); }
  return {
    v: 1, savedAt: Date.now(), docName: S.docName, meta: S.meta, pages: S.pages, srcIds: [...S.sources.keys()],
    images: [...S.images].filter(([id]) => imgIds.has(id)), uidN, blankSrc: S.blankSrc, dirty: S.dirty,
    bookmarks: S.bookmarks, formVals: S.formVals, formTouched: [...S.formTouched], paperSrc: [...S.paperSrc],
  };
}
/* gespeicherten Stand in den Editor laden (Sitzung oder Bibliothek) */
async function applyState(sess, sourceOf) {
  uidN = Math.max(uidN, sess.uidN || 0) + 1;
  for (const id of sess.srcIds) {
    const src = await sourceOf(id);
    if (!src) throw new Error('Quelle fehlt');
    await addSource(src.bytes, src.name, id);
  }
  S.images = new Map(sess.images || []);
  S.pages = sess.pages; S.docName = sess.docName; S.meta = sess.meta || S.meta; S.blankSrc = sess.blankSrc || null;
  S.bookmarks = sess.bookmarks || []; S.formVals = sess.formVals || {}; S.formTouched = new Set(sess.formTouched || []); S.paperSrc = new Map(sess.paperSrc || []);
  S.sample = false; S.dirty = !!sess.dirty; S.hist = []; S.fut = []; S.cur = 0;
  await Promise.all(S.pages.filter(hasCE).map(ensureDerived));
  S.zoom = initialZoom(); buildViewer(); updateTitle(); updateUndo();
}
async function autosave() {
  try {
    for (const s of S.sources.values()) if (!savedSrc.has(s.id)) { await idbSet('src:' + s.id, { name: s.name, bytes: s.bytes }); savedSrc.add(s.id); }
    const imgIds = new Set();
    for (const p of S.pages) for (const a of p.annots) if (a.img) imgIds.add(a.img);
    await idbSet('session', docState(imgIds));
    const keep = new Set([...S.sources.keys()].map(k => 'src:' + k));
    for (const k of await idbKeys()) if (String(k).startsWith('src:') && !keep.has(k)) { await idbDel(k); savedSrc.delete(String(k).slice(4)); }
  } catch (e) { /* Zwischenspeicher nicht verfügbar */ }
}
async function restoreSession() {
  let sess;
  try { sess = await idbGet('session'); } catch (e) { return false; }
  if (!sess || !sess.pages || !sess.pages.length) return false;
  const when = new Date(sess.savedAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
  if (!await ask('Letzte Sitzung fortsetzen?', `„${sess.docName}“ vom ${when}, mit allen Änderungen.`, 'Fortsetzen', 'Neu starten', false)) {
    try { await idbDel('session'); } catch (e) { /* egal */ }
    return false;
  }
  busy(true, 'Sitzung wird wiederhergestellt …');
  try {
    await applyState(sess, async id => { const s = await idbGet('src:' + id); if (s) savedSrc.add(id); return s; });
    busy(false); setMsg('Sitzung wiederhergestellt');
    return true;
  } catch (e) {
    console.error(e); busy(false);
    for (const id of [...S.sources.keys()]) dropSource(id);
    S.pages = [];
    toast('Die letzte Sitzung konnte nicht wiederhergestellt werden.');
    return false;
  }
}

/* ---------- Markierungen als echte PDF-Kommentare ---------- */
const EXPORTABLE = new Set(['mark', 'hl', 'pen', 'rect', 'ellipse', 'line', 'arrow', 'text', 'stamp']);
const PDF_MARK = { hl: 'Highlight', ul: 'Underline', so: 'StrikeOut' };
const commentAuthor = () => S.prefs.author || S.meta.author || 'PDF Werkbank';
function addTextNote(out, pg, [x, y], text, color) {
  const c = hex2rgb(color), ctx = out.context;
  const ann = ctx.obj({
    Type: 'Annot', Subtype: 'Text', F: 4, Name: 'Comment', Open: false, Rect: [x, y - 16, x + 16, y],
    Contents: PL.PDFHexString.fromText(text), T: PL.PDFHexString.fromText(commentAuthor()), M: PL.PDFString.fromDate(new Date()), C: [c.red, c.green, c.blue],
  });
  pg.node.addAnnot(ctx.register(ann));
}
async function exportAnnot(out, pg, a, T, R, getFont) {
  const { PDFName, PDFHexString, PDFString } = PL, ctx = out.context;
  const col = hex2rgb(a.color || '#000000'), C = [col.red, col.green, col.blue];
  const n = v => Math.round(v * 1000) / 1000;
  const rgbOp = op => `${n(C[0])} ${n(C[1])} ${n(C[2])} ${op}`;
  const pathOps = sg => sg.map(sx => {
    if (sx[0] === 'Z') return 'h';
    const pts = [];
    for (let i = 1; i < sx.length; i += 2) { const q = T(sx[i], sx[i + 1]); pts.push(n(q[0]), n(q[1])); }
    return pts.join(' ') + ' ' + { M: 'm', L: 'l', C: 'c' }[sx[0]];
  }).join(' ');
  const vb = bbox(a), pad = (a.sw || 1) + 2;
  const cs = [[vb.x - pad, vb.y - pad], [vb.x + vb.w + pad, vb.y - pad], [vb.x - pad, vb.y + vb.h + pad], [vb.x + vb.w + pad, vb.y + vb.h + pad]].map(([x, y]) => T(x, y));
  const rect = [Math.min(...cs.map(q => q[0])), Math.min(...cs.map(q => q[1])), Math.max(...cs.map(q => q[0])), Math.max(...cs.map(q => q[1]))].map(n);
  const extra = {}, res = {};
  let subtype, ops = '', contents = a.comment || '';
  const useGS = gs => { res.ExtGState = { G0: { Type: 'ExtGState', ...gs } }; ops = '/G0 gs ' + ops; };
  const textOps = async (font, fname, size, color, lines) => {
    const th = R * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
    res.Font = { ...(res.Font || {}), [fname]: font.ref };
    return lines.map(([str, x, y]) => {
      if (!str) return '';
      const [px, py] = T(x, y), enc = font.encodeText(Array.from(str).map(ch => { try { font.encodeText(ch); return ch; } catch (e) { return '?'; } }).join(''));
      return `BT /${fname} ${n(size)} Tf ${color} ${n(c)} ${n(s)} ${n(-s)} ${n(c)} ${n(px)} ${n(py)} Tm ${enc.toString()} Tj ET`;
    }).join(' ');
  };
  switch (a.t) {
    case 'mark': case 'hl': {
      const rects = a.t === 'mark' ? a.rects : [{ x: a.x, y: a.y, w: a.w, h: a.h }], kind = a.t === 'hl' ? 'hl' : a.kind;
      subtype = PDF_MARK[kind];
      extra.QuadPoints = rects.flatMap(r => [T(r.x, r.y), T(r.x + r.w, r.y), T(r.x, r.y + r.h), T(r.x + r.w, r.y + r.h)].flat()).map(n);
      if (kind === 'hl') {
        const op = (a.op || 40) / 100;
        ops = rgbOp('rg') + ' ' + rects.map(r => pathOps([['M', r.x, r.y], ['L', r.x + r.w, r.y], ['L', r.x + r.w, r.y + r.h], ['L', r.x, r.y + r.h], ['Z']]) + ' f').join(' ');
        useGS({ ca: op, CA: op, BM: 'Multiply' }); extra.CA = op;
      } else ops = rgbOp('RG') + ' ' + markSegs({ ...a, kind, rects }).map(([, q]) => `${n(q.w)} w ` + pathOps(q.d) + ' S').join(' ');
      // wie in Acrobat: markierter Text im Kommentar, eigener Kommentar hat Vorrang
      if (a.text) contents = a.comment ? `${a.comment}\n\n„${a.text}“` : a.text;
      break;
    }
    case 'pen': {
      subtype = 'Ink';
      extra.InkList = [a.pts.flatMap(q => T(q[0], q[1]).map(n))];
      extra.BS = { W: a.sw };
      ops = penKind(a) === 'fount' ? rgbOp('rg') + ' ' + pathOps(penOutline(a)) + ' f' : `${n(a.sw)} w 1 J 1 j ` + rgbOp('RG') + ' ' + pathOps(segs(a)) + ' S';
      const op = (a.op == null ? 100 : a.op) / 100;
      if (op < 1 || penKind(a) === 'marker') { useGS({ ca: op, CA: op, ...(penKind(a) === 'marker' ? { BM: 'Multiply' } : {}) }); extra.CA = op; }
      break;
    }
    case 'rect': case 'ellipse':
      subtype = a.t === 'rect' ? 'Square' : 'Circle'; extra.BS = { W: a.sw };
      {
        const da = dashOf(a), fo = FILL_OP[a.fill];
        if (da) { extra.BS = { W: a.sw, S: PDFName.of('D'), D: da.map(n) }; }
        const dop = da ? `[${da.map(n).join(' ')}] 0 d ${a.dash === 'dot' ? '1 J ' : ''}` : '';
        if (fo) {
          extra.IC = C;
          ops = rgbOp('rg') + ' ' + pathOps(segs(a)) + ' f ';
          if (fo < 1) { res.ExtGState = { G0: { Type: 'ExtGState', ca: fo }, G1: { Type: 'ExtGState', ca: 1 } }; ops = '/G0 gs ' + ops + '/G1 gs '; }
        }
        ops += `${n(a.sw)} w ${dop}` + rgbOp('RG') + ' ' + pathOps(segs(a)) + ' S';
      }
      break;
    case 'line': case 'arrow':
      subtype = 'Line'; extra.L = [...T(a.x1, a.y1), ...T(a.x2, a.y2)].map(n); extra.BS = { W: a.sw };
      if (a.t === 'arrow') extra.LE = [PDFName.of('None'), PDFName.of('OpenArrow')];
      {
        const da = dashOf(a), sg = segs(a);
        if (da) { extra.BS = { W: a.sw, S: PDFName.of('D'), D: da.map(n) }; ops = `${n(a.sw)} w 1 J 1 j [${da.map(n).join(' ')}] 0 d ` + rgbOp('RG') + ' ' + pathOps(sg.slice(0, 2)) + ' S' + (sg.length > 2 ? ' [] 0 d ' + pathOps(sg.slice(2)) + ' S' : ''); }
        else ops = `${n(a.sw)} w 1 J 1 j ` + rgbOp('RG') + ' ' + pathOps(sg) + ' S';
      }
      break;
    case 'text': {
      subtype = 'FreeText';
      const font = await getFont(a.font, a.bold), f = FONT(a.font);
      const W = textWidth(a), lines = a.text.split('\n').map((ln, i) => [ln, lineX(a, ln, W), a.y + f.bl * a.size + i * LH * a.size]);
      if (a.bg) { const bc = hex2rgb(a.bg), b = bbox(a), pd = a.size * 0.18; ops += `${n(bc.red)} ${n(bc.green)} ${n(bc.blue)} rg ` + pathOps([['M', b.x - pd, b.y - pd * 0.4], ['L', b.x + b.w + pd, b.y - pd * 0.4], ['L', b.x + b.w + pd, b.y + b.h + pd * 0.4], ['L', b.x - pd, b.y + b.h + pd * 0.4], ['Z']]) + ' f '; }
      ops += await textOps(font, 'F0', a.size, rgbOp('rg'), lines);
      extra.DA = PDFString.of(`/Helv ${n(a.size)} Tf ${rgbOp('rg')}`);
      contents = a.text + (a.comment ? '\n\n' + a.comment : '');
      break;
    }
    case 'stamp': {
      subtype = 'Stamp'; extra.Name = PDFName.of('Approved');
      const g = stampGeom(a), font = await getFont('Helvetica', true);
      const x = a.x + g.sw / 2, y = a.y + g.sw / 2, w = g.w - g.sw, h = g.h - g.sw;
      ops = `${n(g.sw)} w ` + rgbOp('RG') + ' ' + pathOps([['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']]) + ' S ';
      ops += await textOps(font, 'F0', a.size, rgbOp('rg'), [[a.text, a.x + g.pad, a.y + g.base]]);
      contents = a.comment || a.text;
      break;
    }
    default: return false;
  }
  const ap = ctx.register(ctx.flateStream(ops, { Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: rect, Resources: res }));
  const dict = ctx.obj({
    Type: 'Annot', Subtype: subtype, Rect: rect, F: 4, C, NM: PDFHexString.fromText(a.id),
    T: PDFHexString.fromText(commentAuthor()), M: PDFString.fromDate(new Date()), Contents: PDFHexString.fromText(contents), AP: { N: ap }, ...extra,
  });
  pg.node.addAnnot(ctx.register(dict));
  return true;
}

/* ---------- PDF erzeugen und speichern ---------- */
/* zuletzt gezeichneten Inhaltsstrom von pdf-lib an den Anfang der Seite stellen (= unter den Seiteninhalt) */
function sinkStream(pg) {
  const ref = pg.contentStreamRef; if (!ref) return;
  const arr = pg.node.Contents(), i = arr && typeof arr.indexOf === 'function' ? arr.indexOf(ref) : null;
  if (i == null) return;
  arr.remove(i); arr.insert(0, ref);
  pg.contentStream = undefined; pg.contentStreamRef = undefined;
}
async function buildPdf(pageList) {
  const { PDFDocument, StandardFonts, degrees, LineCapStyle, BlendMode, rgb } = PL;
  await ensureFontsOf(pageList); // Textbreiten (Ausrichtung, Hintergrund) mit der echten Schrift messen
  const out = await PDFDocument.create();
  const libDocs = new Map(), fontCache = new Map(), imgCache = new Map();
  let fkReady = false;
  const getFont = async (name, bold) => {
    const f = FONT(name);
    if (f.file) {
      const key = f.file + (bold && !f.noBold ? 'B' : '');
      if (!fontCache.has(key)) {
        try {
          if (!fkReady) { out.registerFontkit(await loadFontkit()); fkReady = true; }
          fontCache.set(key, await out.embedFont(await fontFile(name, bold), { subset: true }));
        } catch (e) { console.warn('Schrift', name, e); toast('Schrift „' + f.label + '“ nicht verfügbar, ersatzweise Helvetica'); fontCache.set(key, await getFont('Helvetica', bold)); }
      }
      return fontCache.get(key);
    }
    const key = f.std[bold ? 1 : 0];
    if (!fontCache.has(key)) fontCache.set(key, await out.embedFont(StandardFonts[key]));
    return fontCache.get(key);
  };
  const clean = (font, str) => Array.from(str.replace(/\t/g, '    ')).map(ch => { try { font.encodeText(ch); return ch; } catch (e) { return '?'; } }).join('');
  for (const p of pageList) {
    let ld = libDocs.get(p.src);
    if (!ld) {
      try { ld = await PDFDocument.load(S.sources.get(p.src).bytes, { updateMetadata: false }); }
      catch (e) {
        if (e && /encrypt/i.test(e.message || e.name)) throw new Error(`„${S.sources.get(p.src).name}“ ist verschlüsselt. Mit Änderungen speichern ist dafür hier nicht möglich.`);
        throw e;
      }
      libDocs.set(p.src, ld);
    }
    const [pg] = await out.copyPages(ld, [p.idx]);
    out.addPage(pg);
    if (hasCE(p)) ENG.editPage(out, pg, await analysisOf(p), p.ce);
    const R = rotOf(p);
    pg.setRotation(degrees(R));
    const vp = proxyOf(p).getViewport({ scale: 1, rotation: R });
    const T = (x, y) => vp.convertToPdfPoint(x, y);
    const svgMap = (x, y) => { const q = T(x, y); return [q[0], -q[1]]; };
    // Elemente „hinter dem PDF-Inhalt“ kommen zuerst in einen eigenen Inhaltsstrom, der vor den Seiteninhalt gestellt wird
    const unders = p.annots.filter(a => a.under && a.t !== 'note');
    let sunk = !unders.length;
    for (const a of unders.concat(p.annots.filter(a => !(a.under && a.t !== 'note')))) {
      if (!sunk && !a.under) { sinkStream(pg); sunk = true; }
      // als bearbeitbarer PDF-Kommentar speichern (mit eigener Darstellung)
      if (S.prefs.exportMarks === 'annots' && EXPORTABLE.has(a.t) && !a.under) {
        try { if (await exportAnnot(out, pg, a, T, R, getFont)) continue; } catch (e) { console.warn('Kommentar wird eingebettet', e); }
      }
      if (a.t === 'mark') {
        for (const [k, q] of markSegs(a)) {
          if (k === 'fill') pg.drawSvgPath(dOf(q, svgMap), { x: 0, y: 0, color: hex2rgb(a.color), opacity: (a.op || 40) / 100, blendMode: BlendMode.Multiply });
          else pg.drawSvgPath(dOf(q.d, svgMap), { x: 0, y: 0, borderColor: hex2rgb(a.color), borderWidth: q.w });
        }
      } else if (a.t === 'text') {
        const font = await getFont(a.font, a.bold), f = FONT(a.font);
        if (a.bg) {
          const b = bbox(a), pd = a.size * 0.18, x = b.x - pd, y = b.y - pd * 0.4, w = b.w + 2 * pd, h = b.h + pd * 0.8;
          pg.drawSvgPath(dOf([['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']], svgMap), { x: 0, y: 0, color: hex2rgb(a.bg) });
        }
        const W = textWidth(a);
        a.text.split('\n').forEach((ln, i) => {
          if (!ln) return;
          const [x, y] = T(lineX(a, ln, W), a.y + f.bl * a.size + i * LH * a.size);
          pg.drawText(clean(font, ln), { x, y, size: a.size, font, color: hex2rgb(a.color), rotate: degrees(R) });
        });
      } else if (a.t === 'img') {
        const im = S.images.get(a.img); if (!im) continue;
        let emb = imgCache.get(a.img);
        if (!emb) { emb = im.fmt === 'jpg' ? await out.embedJpg(im.url) : await out.embedPng(im.url); imgCache.set(a.img, emb); }
        const [x, y] = T(a.x, a.y + a.h);
        pg.drawImage(emb, { x, y, width: a.w, height: a.h, rotate: degrees(R) });
      } else if (a.t === 'stamp') {
        const g = stampGeom(a), font = await getFont('Helvetica', true), col = hex2rgb(a.color);
        const x = a.x + g.sw / 2, y = a.y + g.sw / 2, w = g.w - g.sw, h = g.h - g.sw, r = Math.min(a.size * 0.22, w / 2, h / 2), k = 0.5523 * r;
        const rr = [['M', x + r, y], ['L', x + w - r, y], ['C', x + w - r + k, y, x + w, y + r - k, x + w, y + r], ['L', x + w, y + h - r], ['C', x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h],
          ['L', x + r, y + h], ['C', x + r - k, y + h, x, y + h - r + k, x, y + h - r], ['L', x, y + r], ['C', x, y + r - k, x + r - k, y, x + r, y], ['Z']];
        pg.drawSvgPath(dOf(rr, svgMap), { x: 0, y: 0, color: col, opacity: 0.07, borderColor: col, borderWidth: g.sw, borderOpacity: 1 });
        const [tx, ty] = T(a.x + g.pad, a.y + g.base);
        pg.drawText(clean(font, a.text), { x: tx, y: ty, size: a.size, font, color: col, rotate: degrees(R) });
      } else if (a.t === 'wm') {
        const font = await getFont('Helvetica', true), txt = clean(font, a.text), w = font.widthOfTextAtSize(txt, a.size);
        const al = a.ang * Math.PI / 180, dx = -w / 2, dy = a.size * 0.35;
        const px = a.x + dx * Math.cos(al) + dy * Math.sin(al), py = a.y - dx * Math.sin(al) + dy * Math.cos(al);
        const [tx, ty] = T(px, py);
        pg.drawText(txt, { x: tx, y: ty, size: a.size, font, color: hex2rgb(a.color), opacity: a.op / 100, rotate: degrees(R + a.ang) });
      } else if (a.t === 'note') {
        const p1 = T(a.x, a.y + NOTE), p2 = T(a.x + NOTE, a.y), c = hex2rgb(a.color);
        const ann = out.context.obj({
          Type: 'Annot', Subtype: 'Text', F: 4, Name: 'Comment', Open: false,
          Rect: [Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1]), Math.max(p1[0], p2[0]), Math.max(p1[1], p2[1])],
          Contents: PL.PDFHexString.fromText(a.text || ''), T: PL.PDFHexString.fromText(S.meta.author || 'PDF Werkbank'),
          M: PL.PDFString.fromDate(new Date()), C: [c.red, c.green, c.blue],
        });
        pg.node.addAnnot(out.context.register(ann));
      } else if (a.t === 'pen' && penKind(a) === 'fount') {
        pg.drawSvgPath(dOf(penOutline(a), svgMap), { x: 0, y: 0, color: hex2rgb(a.color), opacity: a.op / 100 });
      } else if (a.t === 'measure') {
        const col = hex2rgb(a.color), g = measureGeom(a), font = await getFont('Helvetica', false);
        pg.drawSvgPath(dOf(segs(a), svgMap), { x: 0, y: 0, borderColor: col, borderWidth: a.sw, borderLineCap: LineCapStyle.Round });
        const th = g.ang * Math.PI / 180, loc = (u, v) => [g.mx + u * Math.cos(th) - v * Math.sin(th), g.my + u * Math.sin(th) + v * Math.cos(th)];
        const w = font.widthOfTextAtSize(g.label, g.size), x0 = -w / 2 - 2, y0 = -g.size - 4, x1 = w / 2 + 2, y1 = -1;
        const box = [loc(x0, y0), loc(x1, y0), loc(x1, y1), loc(x0, y1)];
        pg.drawSvgPath(dOf([['M', ...box[0]], ['L', ...box[1]], ['L', ...box[2]], ['L', ...box[3]], ['Z']], svgMap), { x: 0, y: 0, color: rgb(1, 1, 1), opacity: 0.85 });
        const [tx, ty] = T(...loc(-w / 2, -4));
        pg.drawText(g.label, { x: tx, y: ty, size: g.size, font, color: col, rotate: degrees(R - g.ang) });
      } else {
        const d = dOf(segs(a), svgMap), o = { x: 0, y: 0 };
        if (a.t === 'hl') Object.assign(o, { color: hex2rgb(a.color), opacity: a.op / 100, blendMode: BlendMode.Multiply });
        else if (a.t === 'white') Object.assign(o, { color: rgb(1, 1, 1) });
        else if (a.t === 'redact') Object.assign(o, { color: rgb(0, 0, 0) });
        else {
          Object.assign(o, { borderColor: hex2rgb(a.color), borderWidth: a.sw });
          if (a.t !== 'rect' && a.t !== 'ellipse') o.borderLineCap = LineCapStyle.Round;
          const da = (a.t === 'rect' || a.t === 'ellipse' || a.t === 'line') && dashOf(a);
          if (da) { o.borderDashArray = da; if (a.dash === 'dot') o.borderLineCap = LineCapStyle.Round; }
          if ((a.t === 'rect' || a.t === 'ellipse') && FILL_OP[a.fill]) Object.assign(o, { color: hex2rgb(a.color), opacity: FILL_OP[a.fill] });
          if (a.t === 'arrow' && dashOf(a)) {
            const sg = segs(a);
            pg.drawSvgPath(dOf(sg.slice(0, 2), svgMap), { ...o, borderDashArray: dashOf(a) });
            pg.drawSvgPath(dOf(sg.slice(2), svgMap), o);
            o.done = true;
          }
          if (a.t === 'pen' && a.op < 100) o.borderOpacity = a.op / 100;
          if (a.t === 'pen' && penKind(a) === 'marker') o.blendMode = BlendMode.Multiply;
        }
        if (!o.done) pg.drawSvgPath(d, o);
      }
      // Kommentar eines eingebetteten Elements bleibt als Notiz erhalten
      if (a.comment && a.t !== 'note') { const b = bbox(a); addTextNote(out, pg, T(b.x + b.w, b.y), a.comment, a.color || '#ffd400'); }
    }
    if (!sunk) sinkStream(pg);
    await drawFormValues(pg, p, getFont, clean);
  }
  writeOutline(out, pageList);
  out.setProducer('PDF Werkbank'); out.setCreator('PDF Werkbank'); out.setModificationDate(new Date());
  const m = S.meta;
  if (m.title) out.setTitle(m.title);
  if (m.author) out.setAuthor(m.author);
  if (m.subject) out.setSubject(m.subject);
  if (m.keywords) out.setKeywords(m.keywords.split(/[,;]\s*/).filter(Boolean));
  if (m.pageMode) out.catalog.set(PL.PDFName.of('PageMode'), PL.PDFName.of(m.pageMode));
  return out.save();
}
async function saveBytes(bytes, filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: { pdf: 'application/pdf', png: 'image/png', txt: 'text/plain;charset=utf-8' }[ext] || 'application/octet-stream' });
  let dl = null;
  if (window.claude && typeof window.claude.use === 'function') { try { dl = await window.claude.use('downloads'); } catch (e) { dl = null; } }
  if (dl) {
    try { await dl.save({ filename, data: blob }); toast(`Gespeichert: ${filename}`); return true; }
    catch (e) {
      if (e && e.code === 'declined') toast('Speichern abgebrochen');
      else if (e && e.code === 'rate_limited') toast('Ein Speichern-Dialog ist bereits offen.');
      else toast('Speichern ist in dieser Ansicht nicht möglich.');
      return false;
    }
  }
  // Desktop-App: echter Speichern-Dialog des Systems
  if (window.wbDesktop && window.wbDesktop.saveFile) {
    try {
      const r = await window.wbDesktop.saveFile(filename, new Uint8Array(await blob.arrayBuffer()));
      if (r && r.path) { toast(`Gespeichert: ${r.path}`); return true; }
      toast('Speichern abgebrochen'); return false;
    } catch (e) { toast('Speichern fehlgeschlagen: ' + (e.message || e)); return false; }
  }
  // als App auf dem Home-Bildschirm (iPad, iPhone, Android): über das Teilen-Menü in „Dateien“ sichern
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (standalone && navigator.canShare) {
    try {
      const file = new File([blob], filename, { type: blob.type });
      if (navigator.canShare({ files: [file] })) {
        // Teilen braucht eine frische Berührung; nach dem Erzeugen der PDF ist die oft abgelaufen
        if (navigator.userActivation && !navigator.userActivation.isActive && !await ask('Datei ist bereit', `„${filename}“ über das Teilen-Menü in „Dateien“ sichern oder an eine App senden.`, 'Teilen', 'Abbrechen', false)) return false;
        await navigator.share({ files: [file], title: filename }); return true;
      }
    } catch (e) { if (e && e.name === 'AbortError') { toast('Speichern abgebrochen'); return false; } }
  }
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast(`Gespeichert: ${filename}`);
  return true;
}
const baseName = () => S.docName.replace(/\.pdf$/i, '').replace(/-bearbeitet$/, '');
async function savePdf() {
  commitEdit(); if (S.busy || !S.pages.length) return;
  busy(true, 'PDF wird erstellt …');
  try {
    const bytes = await buildPdf(S.pages);
    busy(false);
    if (await saveBytes(bytes, baseName() + '-bearbeitet.pdf')) { S.dirty = false; updateTitle(); }
  } catch (e) { console.error(e); busy(false); toast(e && e.message && /„/.test(e.message) ? e.message : 'Die PDF konnte nicht erstellt werden.'); }
}
async function extractPages() {
  commitEdit(); if (S.busy) return;
  const ps = targetPages(); if (!ps.length) return;
  busy(true, 'Seiten werden extrahiert …');
  try {
    const bytes = await buildPdf(ps);
    busy(false);
    const nums = ps.map(p => S.pages.indexOf(p) + 1);
    await saveBytes(bytes, `${baseName()}-${nums.length === 1 ? 'Seite-' + nums[0] : 'Seiten-' + nums[0] + '-' + nums[nums.length - 1]}.pdf`);
  } catch (e) { console.error(e); busy(false); toast(e && e.message && /„/.test(e.message) ? e.message : 'Die Seiten konnten nicht extrahiert werden.'); }
}

/* ---------- Beispieldokument ---------- */
async function makeSample() {
  const { PDFDocument, StandardFonts, rgb } = PL;
  const d = await PDFDocument.create();
  d.setTitle('Beispiel-Dokument'); d.setProducer('PDF Werkbank');
  const f = await d.embedFont(StandardFonts.Helvetica), fb = await d.embedFont(StandardFonts.HelveticaBold), fm = await d.embedFont(StandardFonts.Courier);
  const ink = rgb(0.106, 0.129, 0.188), muted = rgb(0.38, 0.41, 0.48), blue = rgb(0.12, 0.31, 0.85), rule = rgb(0.82, 0.84, 0.87);
  const H = A4[1], M = 56, CW = A4[0] - 2 * M;
  const wrapT = (txt, font, size, maxW) => {
    const out = []; let ln = '';
    for (const w of txt.split(' ')) { const t = ln ? ln + ' ' + w : w; if (font.widthOfTextAtSize(t, size) > maxW && ln) { out.push(ln); ln = w; } else ln = t; }
    if (ln) out.push(ln); return out;
  };
  const p1 = d.addPage(A4);
  let y = H - 64;
  p1.drawText('BEISPIEL-DOKUMENT', { x: M, y, size: 8.5, font: fb, color: blue }); y -= 30;
  p1.drawText('Willkommen in der PDF Werkbank', { x: M, y, size: 24, font: fb, color: ink }); y -= 22;
  for (const l of wrapT('Dieses Dokument dient zum Ausprobieren. Öffne oben links dein eigenes PDF oder ziehe eine Datei einfach in das Fenster.', f, 11, CW)) { p1.drawText(l, { x: M, y, size: 11, font: f, color: muted }); y -= 15; }
  y -= 10; p1.drawLine({ start: { x: M, y }, end: { x: M + CW, y }, thickness: 0.8, color: rule }); y -= 30;
  p1.drawText('Was du hier tun kannst', { x: M, y, size: 14, font: fb, color: ink }); y -= 22;
  const bullets = [
    'Vorhandene Texte direkt in der PDF ändern, Inhalte verschieben, entfernen oder dauerhaft schwärzen.',
    'Mit Füller, Kugelschreiber oder Textmarker schreiben, auf dem iPad mit Apple Pencil und Druckstärke.',
    'Strich kurz halten: Linien, Rechtecke und Ellipsen werden automatisch begradigt.',
    'Formulare ausfüllen (Seite 2 hat echte Formularfelder), Bilder einfügen und unterschreiben.',
    'Strecken in mm messen, Stempel, Notizen, Lesezeichen und eine Kommentarliste nutzen.',
    'Seiten drehen, sortieren, Notizpapier einfügen, PDFs anhängen und alles als neue PDF speichern.',
  ];
  for (const b of bullets) {
    p1.drawText('•', { x: M + 2, y, size: 11, font: fb, color: blue });
    for (const l of wrapT(b, f, 11, CW - 18)) { p1.drawText(l, { x: M + 16, y, size: 11, font: f, color: ink }); y -= 16; }
    y -= 4;
  }
  y -= 18;
  const markY = y;
  p1.drawText('Tastenkürzel', { x: M, y, size: 14, font: fb, color: ink }); y -= 24;
  const keys = [['V', 'Auswählen'], ['M', 'PDF-Inhalte'], ['E', 'Text ändern'], ['T', 'Neuer Text'], ['B', 'Schwärzen'], ['P', 'Stift'], ['G', 'Radierer'], ['H', 'Markieren'], ['Q', 'Messen'],
    ['R', 'Rechteck'], ['A', 'Pfeil'], ['S', 'Stempel'], ['C', 'Notiz'], ['U', 'Unterschrift'], ['F', 'Lesemodus'], ['Entf', 'Löschen'], ['Strg+Z', 'Rückgängig'], ['Strg+S', 'Speichern']];
  const half = Math.ceil(keys.length / 2);
  keys.forEach(([k, v], i) => {
    const col = i < half ? 0 : 1, row = i % half, x = M + col * (CW / 2), yy = y - row * 17;
    p1.drawText(k, { x, y: yy, size: 10, font: fm, color: blue });
    p1.drawText(v, { x: x + 74, y: yy, size: 10.5, font: f, color: ink });
  });
  y -= half * 17 + 20;
  p1.drawText('Datenschutz', { x: M, y, size: 14, font: fb, color: ink }); y -= 20;
  for (const l of wrapT('Die Bearbeitung findet vollständig in deinem Browser statt. Deine Datei wird nicht hochgeladen, sondern nur beim Speichern als neue PDF erzeugt.', f, 11, CW)) { p1.drawText(l, { x: M, y, size: 11, font: f, color: ink }); y -= 16; }
  p1.drawText('PDF Werkbank · Beispielseite 1 von 2', { x: M, y: 36, size: 8, font: f, color: muted });

  const p2 = d.addPage(A4);
  y = H - 64;
  p2.drawText('FORMULAR', { x: M, y, size: 8.5, font: fb, color: blue }); y -= 30;
  p2.drawText('Teilnahmebestätigung', { x: M, y, size: 22, font: fb, color: ink }); y -= 20;
  p2.drawText('Beispielformular zum Ausfüllen und Unterschreiben.', { x: M, y, size: 11, font: f, color: muted }); y -= 46;
  // echte Formularfelder (AcroForm), damit das Ausfüllen direkt ausprobiert werden kann
  const form = d.getForm();
  const field = (label, x, yy, w, name) => {
    p2.drawText(label, { x, y: yy + 22, size: 8.5, font: fb, color: muted });
    p2.drawLine({ start: { x, y: yy }, end: { x: x + w, y: yy }, thickness: 0.8, color: rgb(0.55, 0.58, 0.64) });
    if (name) { const tf = form.createTextField(name); tf.addToPage(p2, { x, y: yy + 1, width: w, height: 17, borderWidth: 0 }); tf.setFontSize(11); }
  };
  const gap = 20, hw = (CW - gap) / 2;
  field('NAME', M, y, hw, 'Name'); field('VORNAME', M + hw + gap, y, hw, 'Vorname'); y -= 58;
  field('STRASSE UND HAUSNUMMER', M, y, CW, 'Strasse'); y -= 58;
  field('PLZ', M, y, 110, 'PLZ'); field('ORT', M + 130, y, CW - 130, 'Ort'); y -= 58;
  field('E-MAIL', M, y, CW, 'E-Mail'); y -= 52;
  [['Ich habe die Teilnahmebedingungen gelesen und akzeptiere sie.', 'Bedingungen'], ['Ich möchte über künftige Termine informiert werden.', 'Newsletter']].forEach(([t, name]) => {
    form.createCheckBox(name).addToPage(p2, { x: M, y: y - 2, width: 12, height: 12, borderWidth: 0.9, borderColor: rgb(0.45, 0.48, 0.54) });
    p2.drawText(t, { x: M + 22, y, size: 11, font: f, color: ink }); y -= 26;
  });
  y = 170;
  field('ORT, DATUM', M, y, hw, 'Ort_Datum'); field('UNTERSCHRIFT', M + hw + gap, y, hw);
  p2.drawText('PDF Werkbank · Beispielseite 2 von 2', { x: M, y: 36, size: 8, font: f, color: muted });

  const hw1 = fb.widthOfTextAtSize('Tastenkürzel', 14);
  return { bytes: await d.save(), mark: { x: M, y: H - markY, w: hw1 } };
}

/* ---------- Werkzeugleiste anpassen: Werkzeuge ein- und ausblenden, Reihenfolge ändern ---------- */
const TB_EXTRA = { btnImg: ['img', 'Bild einfügen', 'image'], btnSig: ['sig', 'Unterschreiben', 'sign'], btnCalc: ['calc', 'Rechner', 'calc'] };
const TB_PRESETS = {
  all: ['Alles anzeigen', []],
  write: ['Schreiben und Lernen', ['objects', 'edittext', 'white', 'redact', 'measure', 'check', 'cross', 'stamp', 'calc']],
  edit: ['PDF bearbeiten', ['laser', 'measure', 'calc', 'eraser']],
  forms: ['Formulare und Verträge', ['objects', 'edittext', 'eraser', 'hl', 'ul', 'so', 'rect', 'ellipse', 'line', 'arrow', 'measure', 'laser', 'calc', 'redact']],
};
let TB_DEFAULT = null;
/* Gruppen: ein Knopf je Gruppe, die übrigen Werkzeuge im Ausklapp-Menü */
const TB_GROUPS = { edit: ['objects', 'edittext', 'white', 'redact'], marks: ['hl', 'ul', 'so'], shapes: ['rect', 'ellipse', 'line', 'arrow', 'measure'], stamps: ['check', 'cross', 'stamp', 'note'], insert: ['img', 'sig'] };
const TB_GROUP_NAMES = { edit: 'PDF bearbeiten', marks: 'Markieren', shapes: 'Formen und Messen', stamps: 'Haken, Stempel, Notiz', insert: 'Bild und Unterschrift' };
const groupOf = k => Object.keys(TB_GROUPS).find(g => TB_GROUPS[g].includes(k));
let tbCompact = lsGet('pdfwb.tbcompact') !== '0';
const tbEl = k => (k === 'img' ? $('#btnImg') : k === 'sig' ? $('#btnSig') : $(`.toolbar [data-tool="${k}"]`));
const tbKey = el => el.dataset.tool || (TB_EXTRA[el.id] || [])[0] || (el.classList.contains('vsep') ? 'sep' : null);
function tbItems() {
  const out = [];
  for (const el of $('.toolbar').children) {
    if (el.id === 'btnThumbs' || el.id === 'btnTbCfg') continue;
    if (el.classList.contains('grow')) break;
    const k = tbKey(el); if (k === 'sep' && !out.length) continue; // Trennlinie hinter der Seitenleisten-Taste bleibt fest
    if (k) out.push({ key: k, el });
  }
  return out;
}
const tbLabel = k => (k === 'sep' ? 'Trennlinie' : TB_EXTRA['btn' + k[0].toUpperCase() + k.slice(1)] ? TB_EXTRA['btn' + k[0].toUpperCase() + k.slice(1)][1] : TOOL_NAMES[k] || k);
const tbIcon = k => (k === 'sep' ? '' : icon(k === 'img' ? 'image' : k === 'sig' ? 'sign' : k));
function tbLoad() { try { const c = JSON.parse(lsGet('pdfwb.toolbar') || 'null'); return c && Array.isArray(c.order) ? c : null; } catch (e) { return null; } }
/* gespeicherte Reihenfolge plus Werkzeuge, die in einer neueren Version dazugekommen sind */
function tbOrder(cfg) {
  if (!cfg) return TB_DEFAULT.slice();
  const order = cfg.order.filter(k => k === 'sep' || TB_DEFAULT.includes(k));
  TB_DEFAULT.forEach((k, i) => {
    if (k === 'sep' || order.includes(k)) return;
    const prev = TB_DEFAULT.slice(0, i).reverse().find(x => x !== 'sep' && order.includes(x));
    order.splice(prev ? order.indexOf(prev) + 1 : 0, 0, k);
  });
  return order;
}
function applyToolbar(cfg = tbLoad()) {
  const nav = $('.toolbar'), items = tbItems();
  if (!TB_DEFAULT) TB_DEFAULT = items.map(i => i.key);
  const byKey = new Map(items.filter(i => i.key !== 'sep').map(i => [i.key, i.el]));
  const seps = items.filter(i => i.key === 'sep').map(i => i.el);
  const hidden = new Set((cfg && cfg.hidden) || []), anchor = $('#btnTbCfg');
  let si = 0;
  const placed = [];
  for (const k of tbOrder(cfg)) {
    let el;
    if (k === 'sep') { el = seps[si++]; if (!el) { el = document.createElement('span'); el.className = 'vsep'; } }
    else el = byKey.get(k);
    if (!el) continue;
    nav.insertBefore(el, anchor);
    el.hidden = k !== 'sep' && hidden.has(k);
    placed.push({ k, el });
  }
  seps.slice(si).forEach(el => el.remove());
  // Gruppen bilden: nur ein Vertreter je Gruppe bleibt sichtbar
  for (const [g, list] of Object.entries(TB_GROUPS)) {
    const vis = list.filter(k => byKey.get(k) && !byKey.get(k).hidden);
    let rep = vis.includes(S.tool) ? S.tool : vis.includes(lsGet('pdfwb.tbrep.' + g)) ? lsGet('pdfwb.tbrep.' + g) : vis[0];
    for (const k of list) {
      const el = byKey.get(k); if (!el) continue;
      const grouped = tbCompact && vis.length > 1;
      el.classList.toggle('gh', grouped && k !== rep);
      el.classList.toggle('grep', grouped && k === rep);
      if (grouped && k === rep) { el.dataset.group = g; if (!$('.gchev', el)) el.insertAdjacentHTML('beforeend', '<span class="gchev" aria-hidden="true"></span>'); }
      else { delete el.dataset.group; const c = $('.gchev', el); if (c) c.remove(); }
    }
  }
  const off = el => el.hidden || el.classList.contains('gh');
  // doppelte und überzählige Trennlinien ausblenden
  let lastVis = 'sep';
  placed.forEach(({ k, el }) => { if (k === 'sep') { el.hidden = lastVis === 'sep'; if (!el.hidden) lastVis = 'sep'; } else if (!off(el)) lastVis = k; });
  for (let i = placed.length - 1; i >= 0; i--) { const { k, el } = placed[i]; if (off(el)) continue; if (k === 'sep') el.hidden = true; break; }
}
/* Ausklapp-Menü einer Werkzeuggruppe */
function openGroupMenu(btn) {
  closeGroupMenu();
  const g = btn.dataset.group; if (!g) return;
  const hidden = new Set((tbLoad() || {}).hidden || []);
  const items = TB_GROUPS[g].filter(k => tbEl(k) && !hidden.has(k));
  const keyOf = t => Object.keys(KEYS).find(k => KEYS[k] === t) || (t === 'img' ? 'i' : t === 'sig' ? 'u' : '');
  const m = document.createElement('div'); m.className = 'tbfly'; m.setAttribute('role', 'menu');
  m.innerHTML = `<div class="mh">${esc(TB_GROUP_NAMES[g])}</div>` + items.map(k => `<button role="menuitem" data-k="${k}" aria-pressed="${S.tool === k}">${tbIcon(k)}<span>${esc(tbLabel(k))}</span>${keyOf(k) ? `<kbd>${keyOf(k).toUpperCase()}</kbd>` : ''}</button>`).join('');
  document.body.appendChild(m);
  const r = btn.getBoundingClientRect(), mh = m.offsetHeight, below = innerHeight - r.bottom > mh + 12;
  m.style.left = clamp(r.left, 8, innerWidth - m.offsetWidth - 8) + 'px';
  m.style.top = (below ? r.bottom + 6 : r.top - mh - 6) + 'px';
  m.onclick = e => {
    const b = e.target.closest('[data-k]'); if (!b) return;
    const k = b.dataset.k; closeGroupMenu();
    lsSet('pdfwb.tbrep.' + g, k);
    if (k === 'img' || k === 'sig') { applyToolbar(); tbEl(k).click(); } else setTool(k);
  };
  setTimeout(() => document.addEventListener('pointerdown', groupMenuAway, true), 0);
}
function groupMenuAway(e) { if (!e.target.closest('.tbfly')) closeGroupMenu(); }
function closeGroupMenu() { const m = $('.tbfly'); if (m) m.remove(); document.removeEventListener('pointerdown', groupMenuAway, true); }
function bindGroups() {
  const nav = $('.toolbar');
  let lp = 0, lpFired = false;
  nav.addEventListener('pointerdown', e => {
    const b = e.target.closest('.grep'); lpFired = false; if (!b) return;
    clearTimeout(lp); lp = setTimeout(() => { lpFired = true; openGroupMenu(b); }, 450);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) nav.addEventListener(ev, () => clearTimeout(lp));
  // Ecke antippen, langes Drücken oder erneutes Tippen auf das aktive Werkzeug öffnet die Gruppe
  nav.addEventListener('click', e => {
    const b = e.target.closest('.grep'); if (!b) return;
    if (lpFired || e.target.closest('.gchev') || (b.dataset.tool && b.dataset.tool === S.tool)) { e.preventDefault(); e.stopImmediatePropagation(); if (!lpFired) openGroupMenu(b); lpFired = false; }
  }, true);
  nav.addEventListener('contextmenu', e => { const b = e.target.closest('.grep'); if (b) { e.preventDefault(); openGroupMenu(b); } });
}
function toolbarDialog() {
  let order = tbOrder(tbLoad()), hidden = new Set((tbLoad() || {}).hidden || []);
  const rows = () => order.map((k, i) => `<div class="tbrow${k === 'sep' ? ' sep' : ''}" data-i="${i}">
      ${k === 'sep' ? '<span style="width:18px"></span>' : `<input type="checkbox" data-vis ${hidden.has(k) ? '' : 'checked'} aria-label="${esc(tbLabel(k))} anzeigen">`}
      ${tbIcon(k)}<span class="nm">${esc(tbLabel(k))}${k !== 'sep' && Object.entries(KEYS).find(([, t]) => t === k) ? ` <small style="color:var(--muted)">(${Object.entries(KEYS).find(([, t]) => t === k)[0].toUpperCase()})</small>` : ''}</span>
      ${k === 'sep' ? '<button class="mv" data-del title="Trennlinie entfernen" aria-label="Trennlinie entfernen">✕</button>' : ''}
      <button class="mv" data-up title="Nach vorne" aria-label="Nach vorne">▲</button><button class="mv" data-down title="Nach hinten" aria-label="Nach hinten">▼</button></div>`).join('');
  dialog('Werkzeugleiste anpassen', `<p class="note" style="margin:0">Häkchen blendet ein oder aus, Pfeile ändern die Reihenfolge. Ausgeblendete Werkzeuge bleiben über Tastenkürzel und die Befehlssuche (Strg/⌘ K) erreichbar.</p>
    <div class="row" style="flex-wrap:wrap;gap:6px;margin-top:10px">${Object.entries(TB_PRESETS).map(([k, [l]]) => `<button class="btn" data-preset="${k}" type="button">${esc(l)}</button>`).join('')}<button class="btn" data-addsep type="button">+ Trennlinie</button></div>
    <label class="chk" style="margin-top:10px"><input type="checkbox" id="tbGroup" ${tbCompact ? 'checked' : ''}> Ähnliche Werkzeuge gruppieren (kompakt)</label>
    <div class="tblist" id="tbList">${rows()}</div>`, 'Übernehmen', () => {
    lsSet('pdfwb.toolbar', JSON.stringify({ order, hidden: [...hidden] }));
    lsSet('pdfwb.tbcompact', tbCompact ? '1' : '0');
    applyToolbar(); toast('Werkzeugleiste angepasst');
  });
  const b = $('#dlgBody'), list = $('#tbList', b);
  const redraw = () => { list.innerHTML = rows(); applyToolbar({ order, hidden: [...hidden] }); };
  b.onclick = e => {
    const pr = e.target.closest('[data-preset]');
    if (pr) { order = TB_DEFAULT.slice(); hidden = new Set(TB_PRESETS[pr.dataset.preset][1]); redraw(); return; }
    if (e.target.closest('[data-addsep]')) { order.push('sep'); redraw(); list.scrollTop = list.scrollHeight; return; }
    const row = e.target.closest('.tbrow'); if (!row) return;
    const i = +row.dataset.i;
    if (e.target.closest('[data-up]') && i > 0) { [order[i - 1], order[i]] = [order[i], order[i - 1]]; redraw(); }
    else if (e.target.closest('[data-down]') && i < order.length - 1) { [order[i + 1], order[i]] = [order[i], order[i + 1]]; redraw(); }
    else if (e.target.closest('[data-del]')) { order.splice(i, 1); redraw(); }
  };
  const g0 = tbCompact;
  $('#tbGroup', b).onchange = e => { tbCompact = e.target.checked; applyToolbar({ order, hidden: [...hidden] }); };
  $('#dlgCancel').addEventListener('click', () => { tbCompact = g0; }, { once: true });
  b.onchange = e => { if (e.target.id === 'tbGroup') return; const row = e.target.closest('.tbrow'); if (!row || !e.target.matches('[data-vis]')) return; const k = order[+row.dataset.i]; if (e.target.checked) hidden.delete(k); else hidden.add(k); applyToolbar({ order, hidden: [...hidden] }); };
  $('#dlgCancel').addEventListener('click', () => applyToolbar(), { once: true });
}

/* ---------- Stift-Favoriten: Stiftart, Farbe, Stärke und Deckkraft mit einem Tipp ---------- */
const PEN_FAV_DEFAULT = [{ kind: 'fount', color: '#1b2a6b', sw: 2, op: 100 }, { kind: 'ball', color: '#d0342c', sw: 1.25, op: 100 }, { kind: 'ball', color: '#1e8a4c', sw: 1.25, op: 100 }, { kind: 'marker', color: '#ffd400', sw: 12, op: 40 }];
let penFavs = (() => { try { const v = JSON.parse(lsGet('pdfwb.penfavs') || 'null'); return Array.isArray(v) ? v : PEN_FAV_DEFAULT.slice(); } catch (e) { return PEN_FAV_DEFAULT.slice(); } })();
const savePenFavs = () => lsSet('pdfwb.penfavs', JSON.stringify(penFavs));
const sameFav = (f, o) => f.kind === (o.kind || 'ball') && f.color.toLowerCase() === (o.color || '').toLowerCase() && Math.abs(f.sw - o.sw) < 0.01 && f.op === o.op;
const KIND_LABEL = { fount: 'Füller', ball: 'Kuli', marker: 'Marker' };
function renderPenFavs(o) {
  const el = $('#penFavs'); if (!el) return;
  el.innerHTML = penFavs.map((f, i) => {
    const d = clamp(f.sw * (f.kind === 'marker' ? 1 : 2.2), 4, 16);
    return `<button class="fav" data-fav="${i}" style="--c:${f.color}" aria-pressed="${!!o && sameFav(f, o)}" title="${KIND_LABEL[f.kind]} · ${f.sw} pt${f.op < 100 ? ' · ' + f.op + ' %' : ''} (gedrückt halten oder Rechtsklick: entfernen)"><i style="width:${d}px;height:${d}px;opacity:${Math.max(0.35, f.op / 100)}${f.kind === 'marker' ? ';border-radius:2px' : ''}"></i></button>`;
  }).join('') + (penFavs.length < 10 ? '<button class="fav add" data-favadd title="Aktuellen Stift als Favorit merken" aria-label="Favorit hinzufügen">+</button>' : '') + '<span class="vsep"></span>';
}
function applyPenFav(f) {
  const tg = propTarget();
  if (tg && tg.isAnnot && tg.type === 'pen') {
    pushHist(); Object.assign(tg.obj, { kind: f.kind, color: f.color, sw: f.sw, op: f.op });
    drawAnnots(pageById(S.sel.pid)); markDirty();
  }
  PEN_KINDS[TP.pen.kind] = { sw: TP.pen.sw, op: TP.pen.op, color: TP.pen.color };
  Object.assign(TP.pen, { kind: f.kind, color: f.color, sw: f.sw, op: f.op });
  PEN_KINDS[f.kind] = { sw: f.sw, op: f.op, color: f.color };
  if (S.tool !== 'pen' && !(tg && tg.isAnnot)) setTool('pen'); else renderProps();
}
function bindPenFavs() {
  const el = $('#penFavs'); if (!el) return;
  let lp = 0, lpDone = false;
  const remove = i => { const f = penFavs[i]; if (!f) return; penFavs.splice(i, 1); savePenFavs(); renderProps(); toast(`Favorit entfernt (${KIND_LABEL[f.kind]})`); };
  el.addEventListener('pointerdown', e => { const b = e.target.closest('[data-fav]'); lpDone = false; if (!b) return; clearTimeout(lp); lp = setTimeout(() => { lpDone = true; remove(+b.dataset.fav); }, 650); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, () => clearTimeout(lp));
  el.addEventListener('contextmenu', e => { const b = e.target.closest('[data-fav]'); if (!b) return; e.preventDefault(); clearTimeout(lp); if (!lpDone) remove(+b.dataset.fav); lpDone = true; });
  el.addEventListener('click', e => {
    if (lpDone) { lpDone = false; return; }
    if (e.target.closest('[data-favadd]')) {
      const tg = propTarget(), o = tg && tg.type === 'pen' ? tg.obj : TP.pen;
      const f = { kind: o.kind || 'ball', color: o.color, sw: o.sw, op: o.op };
      if (penFavs.some(x => sameFav(x, f))) { toast('Diesen Stift gibt es schon als Favorit'); return; }
      penFavs.push(f); savePenFavs(); renderProps(); toast('Stift als Favorit gemerkt');
      return;
    }
    const b = e.target.closest('[data-fav]'); if (b) applyPenFav(penFavs[+b.dataset.fav]);
  });
}

/* ---------- Tastenkürzel und Gesten ---------- */
function shortcutsDialog() {
  const mac = /Mac|iPad|iPhone/.test(navigator.platform), M = mac ? '⌘' : 'Strg', kb = s => s.split(' ').map(x => `<kbd>${esc(x)}</kbd>`).join(' ');
  const tools = Object.entries(KEYS).map(([k, t]) => [TOOL_NAMES[t] || t, k.toUpperCase()]);
  const groups = [
    ['Werkzeuge', tools.concat([['Bild einfügen', 'I'], ['Unterschreiben', 'U'], ['Rechner', 'Z']])],
    ['Dokument', [['Befehle und Suche', M + ' K'], ['In Bibliothek sichern / Speichern', M + ' S'], ['Als PDF exportieren', M + ' ⇧ S'], ['Öffnen', M + ' O'], ['Im Dokument suchen', M + ' F'], ['Rückgängig', M + ' Z'], ['Wiederholen', M + ' ⇧ Z']]],
    ['Bearbeiten', [['Kopieren / Ausschneiden', M + ' C'], ['Einfügen', M + ' V'], ['Duplizieren', M + ' D'], ['Alles auf der Seite auswählen', M + ' A'], ['Löschen', 'Entf'], ['Verschieben (1 pt / 10 pt)', '← → ↑ ↓'], ['Auswahl aufheben', 'Esc']]],
    ['Ansicht', [['Vergrößern / Verkleinern', M + ' + −'], ['Seitenbreite', M + ' 0'], ['Lesemodus', 'F'], ['Blättern im Lesemodus', '← →'], ['Diese Übersicht', '?']]],
    ['Tablet und Touch', [['Zoomen', 'zwei Finger spreizen'], ['Seitenbreite / Vergrößern', 'Doppeltipp'], ['Rückgängig', 'zwei Finger tippen'], ['Wiederholen', 'drei Finger tippen'], ['Radieren', 'Pencil-Taste'], ['Form gerade ziehen', 'Strich halten']]],
  ];
  dialog('Tastenkürzel und Gesten', `<div class="keys">${groups.map(([h, rows]) => `<h3>${esc(h)}</h3>` + rows.map(([l, k]) => `<div><span>${esc(l)}</span><span>${h === 'Tablet und Touch' ? `<span style="color:var(--muted)">${esc(k)}</span>` : kb(k)}</span></div>`).join('')).join('')}</div>`, 'Schließen', () => true);
  $('#dlgCancel').hidden = true;
}

/* ---------- Seiten einfügen: aus PDF-Bytes nach der aktuellen Seite ---------- */
async function insertPdfBytes(bytes, name, pick) {
  commitEdit();
  const pages = await addSource(bytes, name);
  const list = pick ? pages.filter((p, i) => pick.includes(i)) : pages;
  if (!list.length) return 0;
  pushHist();
  const at = Math.min(S.cur + 1, S.pages.length);
  S.pages.splice(at, 0, ...list);
  S.selPages.clear(); markDirty(); buildViewer(); scrollToPage(at);
  return list.length;
}
/* Fotos und Scans: Kamera oder Fotomediathek, je Bild eine Seite */
let photoMode = lsGet('pdfwb.photomode') || 'scan';
function photosDialog() {
  dialog('Fotos oder Scans einfügen', `<p class="note" style="margin:0 0 10px">Jedes Bild wird eine eigene Seite hinter der aktuellen. Auf Tablet und Handy kannst du direkt die Kamera nehmen.</p>
    <div class="seg" id="phMode" role="group">${[['scan', 'Scan (S/W)'], ['scancolor', 'Scan farbig'], ['photo', 'Foto']].map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${k === photoMode}">${l}</button>`).join('')}</div>
    <p class="note">Scan hellt das Papier auf und verstärkt die Schrift, ideal für Arbeitsblätter und Notizen.</p>`, 'Bilder wählen …', () => { $('#filePhotos').click(); });
  $('#phMode').onclick = e => { const b = e.target.closest('[data-k]'); if (!b) return; photoMode = b.dataset.k; lsSet('pdfwb.photomode', photoMode); $$('#phMode button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); };
}
async function insertPhotos(files) {
  if (!files.length || !window.WBPhotos) return;
  busy(true, 'Bilder werden aufbereitet …');
  try {
    const bytes = await window.WBPhotos.toPdf(files, { mode: photoMode, onProgress: (n, t) => setMsg(`Bild ${n} von ${t} …`, true) });
    busy(false);
    const n = await insertPdfBytes(bytes, files.length === 1 ? files[0].name.replace(/\.\w+$/, '') + '.pdf' : 'Fotos.pdf');
    toast(n === 1 ? 'Foto als Seite eingefügt' : `${n} Fotos als Seiten eingefügt`);
  } catch (e) { busy(false); console.error(e); toast(e.message || 'Die Bilder konnten nicht eingefügt werden.'); }
}
/* Seitenangabe wie „1-3, 5“ → Indizes (0-basiert) */
function parseRange(str, n) {
  const out = new Set();
  for (const part of String(str || '').split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d+)(?:\s*[-–]\s*(\d+)?)?$/.exec(part); if (!m) continue;
    const a = +m[1], b = m[2] ? +m[2] : (/[-–]$/.test(part) ? n : a);
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 1 && i <= n) out.add(i - 1);
  }
  return [...out].sort((x, y) => x - y);
}
/* Seiten aus einem anderen Dokument der Bibliothek einfügen */
async function libPagesDialog() {
  if (!S.lib || !LIB) return;
  const docs = (await LIB.all()).filter(i => i.kind === 'doc' && !i.trashed && !i.deleted && !i.missing && i.id !== S.lib.id).sort((a, b) => (b.openedAt || b.updatedAt || 0) - (a.openedAt || a.updatedAt || 0));
  if (!docs.length) { toast('In der Bibliothek gibt es noch kein anderes Dokument.'); return; }
  let pick = docs[0].id;
  dialog('Seiten aus der Bibliothek einfügen', `<input class="field" id="lpQ" placeholder="Dokument suchen …" style="width:100%">
    <div class="libpick" id="lpList">${docs.slice(0, 120).map((d, i) => `<button type="button" data-id="${d.id}" aria-pressed="${i === 0}" title="${esc(d.name)}"><div class="ph" data-th="${d.id}"></div><span class="nm">${esc(d.name)}</span><small style="color:var(--muted)">${d.pages || '?'} S.</small></button>`).join('')}</div>
    <label class="fld"><span>Seiten</span><input class="field" id="lpRange" placeholder="alle, oder z. B. 1-3, 5"></label>`, 'Einfügen', b => {
    const it = docs.find(d => d.id === pick); if (!it) return false;
    const range = $('#lpRange', b).value.trim();
    (async () => {
      busy(true, `„${it.name}“ wird vorbereitet …`);
      try {
        const bytes = window.WBDrive && window.WBDrive.pdfOf ? await window.WBDrive.pdfOf(it) : (await LIB.loadDoc(it.id)).sources[0].bytes;
        let src = bytes;
        if (window.WBDecrypt && window.WBDecrypt.isEncrypted(src)) src = (await window.WBDecrypt.plain(src)).bytes;
        const n0 = (await PDFJS.getDocument({ data: src.slice(), isEvalSupported: false }).promise).numPages;
        let sel = range && !/^alle$/i.test(range) ? parseRange(range, n0) : null;
        if (sel && !sel.length) { busy(false); toast('Keine gültigen Seiten angegeben.'); return; }
        // nur die gewählten Seiten übernehmen, damit das Dokument klein bleibt
        if (sel && sel.length < n0) {
          try {
            const from = await PL.PDFDocument.load(src, { updateMetadata: false }), to = await PL.PDFDocument.create();
            (await to.copyPages(from, sel)).forEach(pg => to.addPage(pg));
            src = new Uint8Array(await to.save()); sel = null;
          } catch (e) { console.warn('Seiten kopieren', e); }
        }
        busy(false);
        const n = await insertPdfBytes(src, it.name + '.pdf', sel);
        toast(`${n} ${n === 1 ? 'Seite' : 'Seiten'} aus „${it.name}“ eingefügt`);
      } catch (e) { busy(false); console.error(e); toast('Einfügen fehlgeschlagen: ' + (e.message || e)); }
    })();
  });
  const b = $('#dlgBody');
  $('#lpList', b).onclick = e => { const x = e.target.closest('[data-id]'); if (!x) return; pick = x.dataset.id; $$('#lpList [data-id]', b).forEach(y => y.setAttribute('aria-pressed', String(y === x))); };
  $('#lpList', b).ondblclick = e => { if (e.target.closest('[data-id]')) $('#dlgOk').click(); };
  $('#lpQ', b).oninput = e => { const q = e.target.value.toLowerCase(); $$('#lpList [data-id]', b).forEach(x => { x.hidden = q && !x.title.toLowerCase().includes(q); }); };
  for (const d of docs.slice(0, 120)) LIB.getBlob('thumb:' + d.id).then(t => { const ph = $(`[data-th="${d.id}"]`, b); if (t && ph) { const im = document.createElement('img'); im.className = 'ph'; im.src = URL.createObjectURL(t); ph.replaceWith(im); } }).catch(() => {});
}

/* ---------- Mit Passwort speichern ---------- */
function secureDialog() {
  if (!window.WBDecrypt || !window.WBDecrypt.encrypt) { toast('Verschlüsseln ist hier nicht verfügbar.'); return; }
  dialog('Mit Passwort speichern', `<p class="note" style="margin:0 0 10px">Die PDF lässt sich danach nur mit diesem Passwort öffnen (AES-256, in Acrobat, Vorschau und Browsern).</p>
    <label class="fld"><span>Passwort</span><input class="field" id="sPw" type="password" autocomplete="new-password" minlength="4"></label>
    <label class="fld"><span>Wiederholen</span><input class="field" id="sPw2" type="password" autocomplete="new-password"></label>
    <label class="chk"><input type="checkbox" id="sPrint" checked> Drucken erlauben</label>
    <label class="chk"><input type="checkbox" id="sCopy" checked> Text kopieren erlauben</label>
    <label class="chk"><input type="checkbox" id="sEdit"> Bearbeiten und Kommentieren erlauben</label>
    <p class="err" id="sErr" style="color:var(--danger)"></p>`, 'Speichern', b => {
    const pw = $('#sPw', b).value, err = $('#sErr', b);
    if (pw.length < 4) { err.textContent = 'Bitte mindestens 4 Zeichen.'; return false; }
    if (pw !== $('#sPw2', b).value) { err.textContent = 'Die Passwörter stimmen nicht überein.'; return false; }
    const perms = { print: $('#sPrint', b).checked, copy: $('#sCopy', b).checked, edit: $('#sEdit', b).checked };
    (async () => {
      busy(true, 'PDF wird verschlüsselt …');
      try {
        const enc = await window.WBDecrypt.encrypt(await buildPdf(S.pages), pw, perms);
        busy(false);
        await saveBytes(enc, baseName() + '-geschützt.pdf');
      } catch (e) { busy(false); console.error(e); toast('Verschlüsseln fehlgeschlagen: ' + (e.message || e)); }
    })();
  });
}

/* ---------- Weiterlesen: letzte Seite je Dokument merken ---------- */
let posT = 0;
function rememberPos() {
  if (!S.lib || S.renderMode) return;
  clearTimeout(posT);
  posT = setTimeout(() => lsSet('pdfwb.pos.' + S.lib.id, JSON.stringify({ p: S.cur, n: S.pages.length, t: Date.now() })), 400);
}
function resumePos() {
  try {
    const v = JSON.parse(lsGet('pdfwb.pos.' + S.lib.id) || 'null');
    if (v && v.p > 0 && v.p < S.pages.length) { setTimeout(() => { viewer.scrollTop = els.get(S.pages[v.p].id).wrap.offsetTop - 16; setCurrent(v.p); toast(`Weiter auf Seite ${v.p + 1} von ${S.pages.length}`); }, 120); }
  } catch (e) { /* egal */ }
}

/* ---------- Schriftauswahl ---------- */
function fontUI() {
  if (!$('#wbFontCss')) {
    const st = document.createElement('style'); st.id = 'wbFontCss';
    st.textContent = Object.values(FONTS).filter(f => f.file).map(f => `@font-face{font-family:"${f.family}";src:url("fonts/${f.file}-Regular.ttf") format("truetype");font-weight:400;font-display:swap}` +
      (f.noBold ? '' : `@font-face{font-family:"${f.family}";src:url("fonts/${f.file}-Bold.ttf") format("truetype");font-weight:700;font-display:swap}`)).join('\n');
    document.head.appendChild(st);
  }
  const groups = {};
  for (const [k, f] of Object.entries(FONTS)) (groups[f.g] = groups[f.g] || []).push([k, f]);
  $('#fontSel').innerHTML = Object.entries(groups).map(([g, list]) => `<optgroup label="${g}">${list.map(([k, f]) => `<option value="${k}" style="font-family:${esc(f.css)}">${esc(f.label || k)}</option>`).join('')}</optgroup>`).join('');
}

/* ---------- KI-Assistent: Fragen zum Dokument, Zusammenfassen, Lernkarten, Handschrift erkennen ---------- */
const AIX = window.WBAI || null;
const ai = { scope: 'doc', msgs: [], ctxKey: '', busy: null, sel: null, setup: false };
const AI_INSTR = 'Du bist der KI-Assistent in der PDF Werkbank, einem PDF-Editor. Antworte auf Deutsch (außer wenn ausdrücklich übersetzt werden soll), klar, freundlich und knapp. Nutze einfaches Markdown: #### für Zwischenüberschriften, „- “ für Stichpunkte, **fett** für Schlüsselbegriffe. Stütze dich auf den mitgelieferten Inhalt; steht etwas nicht darin, sag das offen. Verweise auf Seiten im Format [S. 3].';
const scopeName = s => (s === 'sel' ? 'die markierte Stelle' : s === 'page' ? 'diese Seite' : 'das Dokument');
const AI_ACTIONS = [
  { k: 'sum', l: 'Zusammenfassen', i: 'list', p: s => `Fasse ${scopeName(s)} zusammen: ein Satz zum Thema, danach die wichtigsten Punkte als Stichpunkte mit Seitenangabe.` },
  { k: 'explain', l: 'Einfach erklären', i: 'bulb', p: s => `Erkläre ${scopeName(s)} so, dass man es ohne Vorwissen versteht, mit einem kurzen Beispiel.` },
  { k: 'cards', l: 'Lernkarten', i: 'cards', p: s => `Erstelle 8 bis 12 Lernkarten zu ${scopeName(s)}. Je Karte: eine Zeile „**F:** Frage“ und darunter „**A:** knappe Antwort [S. n]“.` },
  { k: 'quiz', l: 'Quiz', i: 'quiz', p: s => `Stelle mir 5 Multiple-Choice-Fragen zu ${scopeName(s)} mit je vier Antworten a) bis d). Die Lösungen mit kurzer Begründung erst ganz am Ende unter „#### Lösungen“.` },
  { k: 'todo', l: 'Aufgaben & Termine', i: 'checks', p: s => `Liste alle Aufgaben, To-dos, Termine und Fristen aus ${scopeName(s)} auf, mit Datum falls vorhanden und Seitenangabe. Gibt es keine, sag das in einem Satz.` },
  { k: 'translate', l: 'Übersetzen', i: 'translate', p: s => `Übersetze ${scopeName(s)} ins Deutsche; ist der Text schon Deutsch, dann ins Englische. Gib nur die Übersetzung aus und behalte die Gliederung bei.` },
  { k: 'ocr', l: 'Handschrift → Text', i: 'hand', img: true, p: s => `Schreibe den gesamten Inhalt ${s === 'doc' ? 'dieser Seiten' : 'dieser Seite'} als sauberen, gegliederten Text ab, auch Handschrift. Formeln in einfacher Schreibweise (z. B. x^2). Nichts hinzuerfinden; Unleserliches als [?].` },
];
/* Text einer Seite in Lesereihenfolge, plus eigene Texte und Notizen */
async function pageText(p) {
  const tc = await textContent(p), lines = [];
  let line = '', lastY = null;
  for (const it of tc.items) {
    const y = it.transform[5];
    if (lastY !== null && Math.abs(y - lastY) > 2 && line) { lines.push(line); line = ''; }
    line += it.str; lastY = y;
    if (it.hasEOL) { lines.push(line); line = ''; }
  }
  if (line) lines.push(line);
  const own = p.annots.filter(a => (a.t === 'text' || a.t === 'note') && a.text).map(a => (a.t === 'note' ? 'Notiz: ' : '') + a.text)
    .concat(p.annots.filter(a => a.comment).map(a => 'Kommentar: ' + a.comment));
  return { text: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), own };
}
/* Seite mit allen eigenen Elementen als JPEG (für Handschrift und Bilder) */
async function pageImage(p, maxSide = 1600) {
  const proxy = proxyOf(p), v1 = proxy.getViewport({ scale: 1, rotation: rotOf(p) });
  const k = Math.min(2.5, maxSide / Math.max(v1.width, v1.height)), vp = proxy.getViewport({ scale: k, rotation: rotOf(p) });
  const c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
  await proxy.render({ canvasContext: ctx, viewport: vp }).promise;
  if (p.annots.length) {
    const [W, H] = dims(p), img = new Image();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${c.width}" height="${c.height}" viewBox="0 0 ${W} ${H}">${p.annots.map(annotSVG).join('')}</svg>`;
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
    ctx.drawImage(img, 0, 0, c.width, c.height);
  }
  return c.toDataURL('image/jpeg', 0.82);
}
const MAX_CTX = 90000, MAX_IMGS = 6;
async function aiContext(scope, wantImg) {
  const head = `Dokument: „${S.docName.replace(/\.pdf$/i, '')}“, ${S.pages.length} ${S.pages.length === 1 ? 'Seite' : 'Seiten'}.`;
  if (scope === 'sel' && ai.sel) return { head: head + ` Markierte Stelle auf Seite ${ai.sel.page}:`, text: ai.sel.text, images: [] };
  const list = scope === 'page' ? [S.cur] : S.pages.map((p, i) => i);
  const parts = [], images = [];
  let total = 0, cut = false, thin = 0;
  for (const i of list) {
    const p = S.pages[i], t = await pageText(p);
    const block = `[Seite ${i + 1}]\n${t.text}${t.own.length ? '\n' + t.own.join('\n') : ''}`;
    if (t.text.length < 120) thin++;
    if (total + block.length > MAX_CTX) { cut = true; break; }
    parts.push(block); total += block.length;
  }
  // Seiten ohne Text (Handschrift, Scans): Bilder mitschicken
  const needImg = wantImg || thin > list.length / 2 || (scope === 'page' && S.pages[S.cur].annots.some(a => a.t === 'pen'));
  if (needImg) {
    const order = scope === 'page' ? [S.cur] : [S.cur, ...list.filter(i => i !== S.cur)];
    for (const i of order.slice(0, MAX_IMGS)) images.push(await pageImage(S.pages[i]));
  }
  return { head: head + (cut ? ` (Text nach ${parts.length} Seiten gekürzt)` : '') + (images.length ? ` Dazu ${images.length === 1 ? 'ein Bild der Seite' : images.length + ' Seitenbilder'} (S. ${(scope === 'page' ? [S.cur] : [S.cur, ...list.filter(i => i !== S.cur)]).slice(0, MAX_IMGS).map(i => i + 1).join(', ')}).` : ''), text: parts.join('\n\n'), images };
}
/* Markdown light → HTML, Seitenverweise als Knöpfe */
function aiMd(t) {
  const inline = s => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[(?:S\.|Seite)\s*(\d+)(?:\s*[–-]\s*\d+)?\]/g, (m, n) => `<button class="pg" data-pg="${n}" title="Zu Seite ${n}">S. ${n}</button>`);
  const out = []; let list = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of esc(t).split('\n')) {
    const line = raw.trimEnd(), m = /^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/.exec(line), h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) { close(); out.push(`<h4>${inline(h[1])}</h4>`); }
    else if (m) { const tag = m[1] ? 'ol' : 'ul'; if (list !== tag) { close(); out.push(`<${tag}>`); list = tag; } out.push(`<li>${inline(m[2])}</li>`); }
    else if (!line.trim()) close();
    else { close(); out.push(`<p>${inline(line)}</p>`); }
  }
  close();
  return out.join('');
}
const aiPlain = t => t.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/^#{1,6}\s+/gm, '').replace(/^\s*[-*]\s+/gm, '• ').replace(/\[(?:S\.|Seite)\s*(\d+)\]/g, '(S. $1)').trim();
/* lange Zeilen für Textfelder umbrechen */
function wrapFor(text, a, maxW) {
  const out = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const w of para.split(/\s+/)) {
      const t = line ? line + ' ' + w : w;
      if (line && measure(t, a) > maxW) { out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  return out.join('\n');
}
function aiAddMsg(kind, html) {
  const log = $('#aiLog'), em = $('.empty', log); if (em) em.remove();
  const d = document.createElement('div'); d.className = 'am ' + kind; d.innerHTML = html;
  log.appendChild(d); log.scrollTop = log.scrollHeight;
  return d;
}
function aiRender(el, text, streaming) {
  el.innerHTML = `<div class="tx">${aiMd(text)}${streaming ? '<span class="cursor"></span>' : ''}</div>` + (streaming ? '' : `<div class="acts">
    <button data-aa="copy">${icon('copy')}Kopieren</button><button data-aa="note">${icon('note')}Als Notiz</button><button data-aa="text">${icon('text')}Als Text</button><button data-aa="page">${icon('blank')}Als Seite</button></div>`);
  el.dataset.raw = text;
  const log = $('#aiLog'); if (log.scrollHeight - log.scrollTop - log.clientHeight < 140) log.scrollTop = log.scrollHeight;
}
function aiEmpty() {
  const I = AIX ? AIX.info() : null;
  $('#aiLog').innerHTML = `<div class="empty">${I && I.ready ? 'Wähle oben eine Aktion oder stell eine Frage zum Dokument, zum Beispiel „Worum geht es auf Seite 3?“' : 'Richte zuerst einen KI-Dienst ein (Zahnrad oben).'}</div>`;
}
function aiUpdateHead() {
  const I = AIX && AIX.info();
  $('#aiWho').textContent = I && I.ready ? `${I.name}${I.model ? ' · ' + I.model : ''}` : 'nicht eingerichtet';
  $('#aiSend').disabled = false;
  $('#aiSend').innerHTML = ai.busy ? icon('close') : icon('send');
  $('#aiSend').title = ai.busy ? 'Stopp' : 'Senden (Enter)';
}
async function aiShowSetup(on) {
  ai.setup = on;
  $('#aiSetup').hidden = !on; $('#aiMain').hidden = on;
  $('#aiCfg').setAttribute('aria-pressed', String(on));
  if (on) await AIX.renderSetup($('#aiSetup'), { onChange: I => { aiUpdateHead(); if (I.ready && ai.setup && !ai.keepSetup) aiShowSetup(false); aiEmpty(); } });
}
function aiSetScope(s) {
  ai.scope = s;
  $$('#aiScope button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === s)));
}
function toggleAI(on = $('#aiPanel').hidden, opts = {}) {
  if (!AIX) { toast('Die KI ist in dieser Fassung nicht verfügbar.'); return; }
  $('#aiPanel').hidden = !on; $('#btnAI').setAttribute('aria-pressed', String(on));
  $('#app').classList.toggle('aiopen', on && innerWidth > 1100);
  if (!on) { if (ai.busy) ai.busy.abort(); return; }
  if (!$('#calc').hidden && window.toggleCalc) window.toggleCalc(false);
  if (innerWidth > 760) $('#aiPanel').style.top = (propbar.getBoundingClientRect().bottom + 8) + 'px';
  aiUpdateHead();
  if (!AIX.info().ready) aiShowSetup(true); else if (ai.setup) aiShowSetup(false);
  if (!$('#aiLog').children.length) aiEmpty();
  if (!COARSE && !ai.setup) setTimeout(() => $('#aiInput').focus(), 30);
}
async function aiRun(question, opts = {}) {
  if (!AIX) return;
  if (!AIX.info().ready) { toggleAI(true); aiShowSetup(true); return; }
  if (ai.busy) return;
  if ($('#aiPanel').hidden) toggleAI(true);
  if (opts.scope) aiSetScope(opts.scope);
  const scope = ai.scope;
  if (scope === 'sel' && !ai.sel) aiSetScope('page');
  const key = scope + ':' + (scope === 'page' ? S.pages[S.cur].id : scope === 'sel' ? ai.sel.id : S.pages.length) + (opts.img ? ':img' : '');
  const first = ai.ctxKey !== key || !ai.msgs.length;
  if (first && ai.msgs.length) aiAddMsg('u', `<small>Neuer Bezug: ${esc(scope === 'sel' ? 'Auswahl' : scope === 'page' ? 'Seite ' + (S.cur + 1) : 'ganzes Dokument')}</small>`);
  if (first) { ai.msgs = []; ai.ctxKey = key; }
  aiAddMsg('u', esc(opts.label || question));
  const el = aiAddMsg('a', '<div class="tx"><span class="cursor"></span></div>');
  const ctrl = new AbortController(); ai.busy = ctrl; aiUpdateHead();
  const m = { role: 'user', text: question };
  try {
    if (first) {
      const c = await aiContext(scope, opts.img);
      if (!c.text.trim() && !c.images.length) throw new Error('Auf ' + (scope === 'page' ? 'dieser Seite' : 'den Seiten') + ' ist kein Text zu finden. Versuch „Handschrift → Text“.');
      m.text = `${c.head}\n\n<inhalt>\n${c.text}\n</inhalt>\n\n${question}`; m.images = c.images;
    }
    ai.msgs.push(m);
    const out = await AIX.ask({ instructions: AI_INSTR, messages: ai.msgs, signal: ctrl.signal, onDelta: (d, all) => aiRender(el, all, true) });
    ai.msgs.push({ role: 'assistant', text: out });
    aiRender(el, out || '(keine Antwort)', false);
  } catch (e) {
    if (ai.msgs[ai.msgs.length - 1] === m) ai.msgs.pop();
    if (ctrl.signal.aborted || (e && e.name === 'AbortError')) { const raw = el.querySelector('.tx') ? el.dataset.raw || '' : ''; if (raw) aiRender(el, raw + '\n\n_(abgebrochen)_', false); else el.remove(); }
    else { el.classList.add('err'); el.innerHTML = `<div class="tx">${esc(e.message || String(e))}</div>${e.auth || e.setup ? '<div class="acts"><button data-aa="setup">' + icon('gear') + 'KI einrichten</button></div>' : ''}`; }
  } finally { ai.busy = null; aiUpdateHead(); }
}
/* Antwort weiterverwenden */
async function aiAnswerAction(k, raw) {
  const p = S.pages[S.cur]; if (!p) return;
  const txt = aiPlain(raw);
  if (k === 'copy') { toast(await writeSysClip(txt) ? 'Antwort kopiert' : 'Kopieren nicht möglich'); return; }
  if (k === 'note') {
    const [W] = dims(p), [, cy] = viewCenter(p);
    pushHist(); const a = { id: uid(), t: 'note', x: W - NOTE - 18, y: Math.max(18, cy - 40), color: '#ffd400', text: txt.slice(0, 20000) };
    p.annots.push(a); drawAnnots(p); markDirty(); toast('Als Notiz auf Seite ' + (S.cur + 1) + ' angeheftet'); return;
  }
  if (k === 'text') {
    const [W] = dims(p), tp = TP.text;
    insertTextAnnot(wrapFor(txt, { size: tp.size, font: tp.font, bold: tp.bold }, W * 0.8), p); toast('Als Text eingefügt'); return;
  }
  if (k === 'page') {
    busy(true, 'Seite wird erstellt …');
    try { await insertPdfBytes(await aiPagePdf(raw), 'KI-Notiz.pdf'); busy(false); toast('Als neue Seite eingefügt'); }
    catch (e) { busy(false); console.error(e); toast('Seite konnte nicht erstellt werden.'); }
  }
}
/* Antwort als eigene A4-Seite (Inter, mit Überschriften und Stichpunkten) */
async function aiPagePdf(raw) {
  const out = await PL.PDFDocument.create();
  out.registerFontkit(await loadFontkit());
  const reg = await out.embedFont(await fontFile('Inter', false), { subset: true }), bold = await out.embedFont(await fontFile('Inter', true), { subset: true });
  const [W, H] = A4, M = 56, ink = PL.rgb(0.106, 0.129, 0.188), mut = PL.rgb(0.35, 0.39, 0.45);
  let pg = out.addPage([W, H]), y = H - M;
  const newPage = () => { pg = out.addPage([W, H]); y = H - M; };
  const draw = (text, font, size, x, color = ink) => {
    const words = text.split(/\s+/); let line = '';
    const flush = () => { if (y < M + size) newPage(); pg.drawText(line, { x, y: y - size, size, font, color }); y -= size * 1.45; line = ''; };
    for (const w of words) { const t = line ? line + ' ' + w : w; if (line && font.widthOfTextAtSize(t, size) > W - M - x) flush(); line = line ? line + ' ' + w : w; }
    if (line) flush();
  };
  draw('KI-Notiz · ' + S.docName.replace(/\.pdf$/i, ''), reg, 9, M, mut); y -= 6;
  for (const rawLine of raw.split('\n')) {
    const l = rawLine.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\[(?:S\.|Seite)\s*(\d+)\]/g, '(S. $1)');
    if (!l.trim()) { y -= 6; continue; }
    const h = /^#{1,6}\s+(.*)$/.exec(l), li = /^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/.exec(l);
    if (h) { y -= 6; draw(h[1], bold, 14, M); }
    else if (li) { if (y < M + 12) newPage(); pg.drawText(li[1] ? li[1] + '.' : '•', { x: M + 4, y: y - 11, size: 11, font: reg, color: ink }); draw(li[2], reg, 11, M + 20); }
    else draw(l, reg, 11, M);
  }
  return new Uint8Array(await out.save());
}
function bindAI() {
  if (!AIX) { $('#btnAI').hidden = true; return; }
  $('#aiQuick').innerHTML = AI_ACTIONS.map(a => `<button type="button" data-q="${a.k}">${icon(a.i)}${esc(a.l)}</button>`).join('');
  $('#btnAI').onclick = () => toggleAI();
  $('#aiClose').onclick = () => toggleAI(false);
  $('#aiCfg').onclick = () => { ai.keepSetup = !ai.setup; aiShowSetup(!ai.setup); };
  $('#aiNew').onclick = () => { if (ai.busy) ai.busy.abort(); ai.msgs = []; ai.ctxKey = ''; $('#aiLog').innerHTML = ''; aiEmpty(); };
  $('#aiScope').onclick = e => { const b = e.target.closest('[data-v]'); if (b) aiSetScope(b.dataset.v); };
  $('#aiQuick').onclick = e => { const b = e.target.closest('[data-q]'); if (!b) return; const a = AI_ACTIONS.find(x => x.k === b.dataset.q); aiRun(a.p(ai.scope), { label: a.l + ' · ' + (ai.scope === 'sel' ? 'Auswahl' : ai.scope === 'page' ? 'Seite ' + (S.cur + 1) : 'Dokument'), img: a.img }); };
  $('#aiForm').onsubmit = e => { e.preventDefault(); if (ai.busy) { ai.busy.abort(); return; } const q = $('#aiInput').value.trim(); if (!q) return; $('#aiInput').value = ''; aiRun(q); };
  $('#aiInput').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#aiForm').requestSubmit(); } if (e.key === 'Escape') toggleAI(false); });
  $('#aiLog').onclick = e => {
    const pgb = e.target.closest('[data-pg]'); if (pgb) { const n = +pgb.dataset.pg; if (n >= 1 && n <= S.pages.length) scrollToPage(n - 1); return; }
    const b = e.target.closest('[data-aa]'); if (!b) return;
    if (b.dataset.aa === 'setup') { aiShowSetup(true); return; }
    aiAnswerAction(b.dataset.aa, b.closest('.am').dataset.raw || '');
  };
  AIX.onChange(() => aiUpdateHead());
}
/* aus der Schnellleiste: KI zu einer Markierung oder einem eigenen Text */
function aiForAnnot(p, a, kind) {
  const text = a.t === 'mark' ? a.text : a.text;
  if (!text) { toast('Hier ist kein Text zum Auswerten.'); return; }
  ai.sel = { id: a.id, text, page: S.pages.indexOf(p) + 1 };
  $('#aiScope [data-v=sel]').hidden = false;
  const act = AI_ACTIONS.find(x => x.k === kind);
  aiRun(act.p('sel'), { scope: 'sel', label: act.l + ' · „' + (text.length > 40 ? text.slice(0, 39) + '…' : text) + '“' });
}
/* Rechtschreibung eines eigenen Textfelds direkt verbessern */
async function aiFixText(p, a) {
  if (!AIX || !AIX.info().ready) { toggleAI(true); return; }
  setMsg('KI korrigiert den Text …', true);
  try {
    const out = (await AIX.ask({ instructions: 'Korrigiere Rechtschreibung, Grammatik und Zeichensetzung des Textes. Behalte Sprache, Inhalt, Zeilenumbrüche und Ton bei. Antworte ausschließlich mit dem korrigierten Text.', messages: [{ role: 'user', text: a.text }], maxTokens: 2000 })).trim();
    setMsg('');
    if (!out || out === a.text) { toast('Keine Fehler gefunden'); return; }
    pushHist(); a.text = out; drawAnnots(p); markDirty(); toast('Text korrigiert · Strg+Z macht es rückgängig');
  } catch (e) { setMsg(''); toast(e.message || String(e)); }
}

/* ---------- Schnellleiste an markiertem Text und eigenen Textfeldern ---------- */
const QCOLORS = ['#ffd400', '#7ee081', '#ff8fb1', '#8ecbff'];
function qbarFor(p) {
  if (S.tool !== 'select' && !(S.qbar && S.qbar.pid === p.id)) return null;
  const a = S.qbar && S.qbar.pid === p.id ? p.annots.find(x => x.id === S.qbar.aid) : (S.sel && S.sel.pid === p.id && !S.editing ? selAnnot() : null);
  if (!a || !(a.t === 'mark' || (a.t === 'text' && a.text))) return null;
  return a;
}
function drawQbar(p, e) {
  const old = $('.qbar', e.wrap); if (old) old.remove();
  const a = qbarFor(p); if (!a || drag) return;
  const b = bbox(a), z = S.zoom, q = document.createElement('div'); q.className = 'qbar'; q.dataset.aid = a.id;
  q.style.left = clamp((b.x + b.w / 2) * z, 120, e.wrap.clientWidth - 120) + 'px';
  q.style.top = Math.max(44, b.y * z) + 'px';
  const kiBtns = AIX ? `<span class="qs"></span><button data-qa="explain" title="Mit KI erklären">${icon('spark')}Erklären</button><button data-qa="translate" title="Mit KI übersetzen">${icon('translate')}</button>` : '';
  q.innerHTML = a.t === 'mark'
    ? QCOLORS.map(c => `<button class="qc" data-qc="${c}" style="background:${c}" title="Farbe" aria-label="Farbe ${c}"></button>`).join('') + `<span class="qs"></span><button data-qa="comment" title="Kommentar">${icon('comment')}</button><button data-qa="copy" title="Text kopieren">${icon('copy')}</button>${kiBtns}<span class="qs"></span><button data-qa="del" title="Entfernen">${icon('trash')}</button>`
    : `<button data-qa="copy" title="Text kopieren">${icon('copy')}</button>${AIX ? `<button data-qa="fix" title="Rechtschreibung mit KI korrigieren">${icon('spark')}Korrigieren</button><button data-qa="translate" title="Mit KI übersetzen">${icon('translate')}</button>` : ''}<span class="qs"></span><button data-qa="del" title="Löschen">${icon('trash')}</button>`;
  e.wrap.appendChild(q);
}
function bindQbar() {
  pagesEl.addEventListener('pointerdown', e => {
    if (e.target.closest('.qbar')) { e.stopPropagation(); return; }
    if (S.qbar) { const p = pageById(S.qbar.pid); S.qbar = null; if (p) setTimeout(() => drawAnnots(p), 0); }
  }, true);
  pagesEl.addEventListener('click', e => {
    const q = e.target.closest('.qbar'); if (!q) return;
    const wrap = q.closest('.page'), p = pageById(wrap.dataset.id), a = p && p.annots.find(x => x.id === q.dataset.aid); if (!a) return;
    const c = e.target.closest('[data-qc]');
    if (c) { pushHist(); a.color = c.dataset.qc; if (a.kind === 'hl' && !a.op) a.op = 40; drawAnnots(p); markDirty(); return; }
    const b = e.target.closest('[data-qa]'); if (!b) return;
    const k = b.dataset.qa;
    if (k === 'copy') writeSysClip(a.text).then(ok => toast(ok ? 'Text kopiert' : 'Kopieren nicht möglich'));
    else if (k === 'comment') editComment(p, a);
    else if (k === 'del') { pushHist(); p.annots = p.annots.filter(x => x.id !== a.id); if (S.sel && S.sel.aid === a.id) S.sel = null; S.qbar = null; drawAnnots(p); markDirty(); renderProps(); }
    else if (k === 'fix') aiFixText(p, a);
    else aiForAnnot(p, a, k);
  });
}

/* ---------- Bedienelemente verbinden ---------- */
function bindUI() {
  $$('[data-i]').forEach(el => { el.outerHTML = icon(el.dataset.i); });
  $('#swatches').innerHTML = SWATCHES.map(c => `<button class="sw" data-c="${c}" style="background:${c}" title="${c}" aria-label="Farbe ${c}"></button>`).join('');
  $('#sigColors').innerHTML = ['#1b2a6b', '#111318', '#1f4fd8'].map((c, i) => `<button class="sw" data-c="${c}" style="background:${c}" aria-label="Stiftfarbe" aria-pressed="${i === 0}"></button>`).join('');
  fontUI(); applyToolbar(); bindGroups(); bindPenFavs(); bindAI(); bindQbar();
  $('#btnTbCfg').onclick = toolbarDialog;
  $('#filePhotos').onchange = e => { insertPhotos([...e.target.files]); e.target.value = ''; };
  const segProp = (sel, k) => $(sel).addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; setProp(k, b.dataset.v); if (S.editing) S.editing.ta.focus(); });
  segProp('#alignSeg', 'align'); segProp('#fillSeg', 'fill'); segProp('#dashSeg', 'dash');

  $('#btnOpen').onclick = () => $('#fileOpen').click();
  $('#btnMerge').onclick = () => $('#fileMerge').click();
  $('#btnSave').onclick = savePdf;
  if ($('#btnLib')) $('#btnLib').onclick = () => goLibrary();
  // beim Verlassen schnell noch sichern (Tab schließen, App wechseln)
  document.addEventListener('visibilitychange', () => { if (document.hidden && S.lib && S.dirty && !S.renderMode) libSave(); });
  window.addEventListener('pagehide', () => { if (S.lib && S.dirty && !S.renderMode) libSave(); });
  $('#fileOpen').onchange = e => { openFiles(e.target.files, 'replace'); e.target.value = ''; };
  $('#fileMerge').onchange = e => { openFiles(e.target.files, 'append'); e.target.value = ''; };
  $('#fileImg').onchange = e => { insertImages([...e.target.files]); e.target.value = ''; };
  $('#btnUndo').onclick = undo; $('#btnRedo').onclick = redo;
  $('#btnZoomIn').onclick = () => zoomStep(1); $('#btnZoomOut').onclick = () => zoomStep(-1);
  $('#zoomLbl').onclick = () => setZoom(1); $('#btnFit').onclick = fitWidth;
  $$('[data-tool]').forEach(b => { b.onclick = () => setTool(b.dataset.tool); b.setAttribute('aria-label', b.title); });
  $('#btnImg').onclick = () => { commitEdit(); $('#fileImg').click(); };
  $('#btnSig').onclick = openSig;
  $('#pgRotL').onclick = () => rotatePages(-90); $('#pgRotR').onclick = () => rotatePages(90);
  $('#pgBlank').onclick = insertBlank; $('#pgExtract').onclick = extractPages; $('#pgDelete').onclick = deletePages;
  $('#delBtn').onclick = () => { if (S.csel) deleteContent(); else deleteSel(); };
  $('#cEditBtn').onclick = () => { if (S.csel && S.csel.items.length === 1) editContentText(pageById(S.csel.pid), S.csel.items[0]); };
  $('#cRotL').onclick = () => rotateContent(-1);
  $('#cRotR').onclick = () => rotateContent(1);
  const zorder = front => {
    if (S.csel && S.tool === 'objects') { zContent(front); return; }
    const a = selAnnot(); if (!a) return;
    const p = pageById(S.sel.pid), i = p.annots.indexOf(a);
    if ((front && i === p.annots.length - 1) || (!front && i === 0)) return;
    pushHist(); p.annots.splice(i, 1); if (front) p.annots.push(a); else p.annots.unshift(a);
    drawAnnots(p); markDirty(); toast(front ? 'In den Vordergrund gebracht' : 'In den Hintergrund gelegt');
  };
  $('#zFront').onclick = () => zorder(true);
  $('#zBack').onclick = () => zorder(false);
  $('#zUnder').onclick = () => {
    const a = selAnnot(); if (!a || a.t === 'note') return;
    const p = pageById(S.sel.pid);
    pushHist(); if (a.under) delete a.under; else a.under = true;
    drawAnnots(p); markDirty(); renderProps();
    toast(a.under ? 'Liegt jetzt hinter dem PDF-Inhalt (verdeckte Stellen sind nicht sichtbar)' : 'Liegt wieder über dem PDF-Inhalt');
  };
  $('#cMark').onclick = markContent;
  $('#bgSel').addEventListener('change', e => { setProp('bg', e.target.value); if (S.editing) S.editing.ta.focus(); });
  $('#dupBtn').onclick = duplicateSel;
  $('#copyBtn').onclick = () => copySelection(false);
  $('#pasteBtn').onclick = () => pasteClip();
  $('#cmtBtn').onclick = () => { const a = selAnnot(); if (!a) return; const p = pageById(S.sel.pid); if (a.t === 'note') editNote(p, a); else editComment(p, a); };
  // Einfügen aus der System-Zwischenablage: Bilder, Text oder die eigene Kopie
  window.addEventListener('blur', () => { if (S.clip) S.clip.stale = true; });
  document.addEventListener('paste', e => {
    const t = e.target, typing = t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
    if (typing || !$('#calc').hidden && $('#calc').contains(t)) return;
    const dt = e.clipboardData, files = dt ? [...dt.files].filter(f => /^image\//.test(f.type)) : [];
    const text = dt ? dt.getData('text/plain') : '';
    e.preventDefault();
    if (files.length) { insertImages(files); return; }
    if (S.clip && (!S.clip.stale || !text || text === S.clip.sysText)) { pasteClip(); return; }
    if (text) { insertTextAnnot(text); toast('Text eingefügt'); return; }
    toast('Die Zwischenablage ist leer.');
  });

  $('#btnMore').onclick = e => { e.stopPropagation(); if ($('#menu').hidden) openMenu(); else closeMenu(); };
  document.addEventListener('pointerdown', e => { if (!e.target.closest('#menu, #btnMore')) closeMenu(); });
  const ACTS = { new: async () => { if (S.lib) { goLibrary('?new=notebook'); return; } if (S.dirty && !S.sample && !await ask('Ungespeicherte Änderungen verwerfen?', `Die Änderungen an „${S.docName}“ gehen verloren.`)) return; paperDialog('new'); },
    wm: watermarkDialog, pn: pageNumberDialog, dup: duplicatePage, png: exportPagePng, txt: exportText, meta: metaDialog,
    open: () => $('#fileOpen').click(), fit: fitWidth, merge: () => $('#fileMerge').click(), rotl: () => rotatePages(-90), rotr: () => rotatePages(90), blank: insertBlank, extract: extractPages, del: deletePages,
    tolib: toLibrary, lib: () => goLibrary(),
    read: () => setReading(true), night: () => setNight(!S.night), pencil: () => setPencilOnly(!S.pencil.only), bm: addBookmark, share: sharePdf, calc: () => window.toggleCalc(),
    toolbar: toolbarDialog, keys: shortcutsDialog, secure: secureDialog, photos: photosDialog, libpages: libPagesDialog };
  $('[data-act="share"]').hidden = !canShareFiles();
  $('#mPencil').hidden = !COARSE;
  setNight(lsGet('pdfwb.night') === '1');
  $('#btnRead').onclick = () => setReading(true);
  $('#readExit').onclick = () => setReading(false);
  $('#readNight').onclick = () => setNight(!S.night);
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && S.reading && !COARSE) setReading(false); });

  // Seitenleiste: Reiter, Lesezeichen und Kommentarliste
  $('.stabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) setSideTab(b.dataset.tab); });
  $('#marksPanel').addEventListener('click', e => {
    if (e.target.closest('#bmAdd')) { addBookmark(); return; }
    const del = e.target.closest('[data-del]');
    if (del) { const f = findMark(del.dataset.del); if (f) { f.list.splice(f.list.indexOf(f.b), 1, ...f.b.kids); markDirty(); renderMarks(); } return; }
    const row = e.target.closest('[data-bid]'); if (!row || e.target.closest('input')) return;
    const f = findMark(row.dataset.bid), n = f && pageNo(f.b.pid);
    if (n) { scrollToPage(n - 1); if (innerWidth <= 760) { work.classList.remove('thumbs-open'); $('#btnThumbs').setAttribute('aria-pressed', 'false'); } }
  });
  $('#marksPanel').addEventListener('dblclick', e => { const row = e.target.closest('[data-bid]'); if (row && !e.target.closest('.x')) renameMark(row.dataset.bid); });
  $('#marksPanel').addEventListener('keydown', e => {
    const row = e.target.closest('[data-bid]'); if (!row || e.target.tagName === 'INPUT') return;
    if (e.key === 'Enter') { e.stopPropagation(); row.click(); }
    if (e.key === 'F2') { e.preventDefault(); e.stopPropagation(); renameMark(row.dataset.bid); }
  });
  $('#notesPanel').addEventListener('click', e => {
    if (e.target.closest('#noteExport')) { exportNotes(); return; }
    if (e.target.closest('#noteSettings')) { settingsDialog('cmt'); return; }
    if (e.target.closest('#noteEye')) {
      S.prefs.showMarks = !S.prefs.showMarks; savePrefs(); pagesEl.classList.toggle('hidemarks', !S.prefs.showMarks);
      setMsg(S.prefs.showMarks ? 'Markierungen werden angezeigt' : 'Markierungen ausgeblendet'); renderNotes(); return;
    }
    const b = e.target.closest('[data-aid]'); if (b) gotoAnnot(b.dataset.pid, b.dataset.aid);
  });
  $('#notesPanel').addEventListener('change', e => { if (e.target.id === 'noteFilter') { S.noteFilter = e.target.value; renderNotes(); } });
  pagesEl.classList.toggle('hidemarks', !S.prefs.showMarks);

  // Rechner
  const calcEl = $('#calc');
  const calc = window.WBCalc ? window.WBCalc.createCalculator(calcEl, {
    insertText: t => { insertTextAnnot(winAnsiSafe(t)); toast('Ergebnis auf der Seite eingefügt'); },
    insertImage: (url, w, h) => { const id = registerImage(url, 'png', w, h); placeImage(id, 300); toast('Graph auf der Seite eingefügt'); },
    close: () => toggleCalc(false), toast,
  }) : null;
  window.toggleCalc = toggleCalc;
  function toggleCalc(on = calcEl.hidden) {
    if (!calc) { toast('Der Rechner konnte nicht geladen werden.'); return; }
    commitEdit();
    calcEl.hidden = !on;
    $('#btnCalc').setAttribute('aria-pressed', String(on));
    if (on) calc.open();
  }
  $('#btnCalc').onclick = () => toggleCalc();
  $('#calcClose').onclick = () => toggleCalc(false);
  // Rechner auf dem Desktop am Kopf verschieben
  (() => {
    const head = $('.calc-h', calcEl); let st = null;
    head.addEventListener('pointerdown', e => {
      if (e.target.closest('button') || innerWidth <= 760) return;
      const r = calcEl.getBoundingClientRect(); st = { x: e.clientX, y: e.clientY, l: r.left, t: r.top }; head.setPointerCapture(e.pointerId);
    });
    head.addEventListener('pointermove', e => {
      if (!st) return;
      const l = clamp(st.l + e.clientX - st.x, 8, innerWidth - calcEl.offsetWidth - 8), t = clamp(st.t + e.clientY - st.y, 8, innerHeight - 60);
      Object.assign(calcEl.style, { left: l + 'px', top: t + 'px', right: 'auto', bottom: 'auto' });
    });
    const end = () => { if (st) { st = null; calc && calc.redraw(); } };
    head.addEventListener('pointerup', end); head.addEventListener('pointercancel', end);
  })();
  $('#menu').addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (!b) return; closeMenu(); const f = ACTS[b.dataset.act]; if (f) f(); });
  $('#menu').addEventListener('keydown', e => {
    const items = $$('[data-act]', $('#menu')).filter(x => x.offsetParent), i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    if (e.key === 'Escape') { closeMenu(); $('#btnMore').focus(); }
  });

  const narrow = () => innerWidth <= 760;
  $('#btnThumbs').onclick = () => {
    if (narrow()) work.classList.toggle('thumbs-open'); else work.classList.toggle('nothumbs');
    const open = narrow() ? work.classList.contains('thumbs-open') : !work.classList.contains('nothumbs');
    $('#btnThumbs').setAttribute('aria-pressed', String(open));
  };
  if (narrow()) $('#btnThumbs').setAttribute('aria-pressed', 'false');

  $('#swatches').addEventListener('click', e => { const b = e.target.closest('.sw'); if (!b) return; setProp('color', b.dataset.c); if (S.editing) S.editing.ta.focus(); });
  $('#penKind').addEventListener('click', e => {
    const b = e.target.closest('button[data-k]'); if (!b) return;
    const k = b.dataset.k, tg = propTarget();
    if (tg && tg.isAnnot && tg.type === 'pen') { setProp('kind', k); return; }
    PEN_KINDS[TP.pen.kind] = { sw: TP.pen.sw, op: TP.pen.op, color: TP.pen.color };
    Object.assign(TP.pen, PEN_KINDS[k], { kind: k });
    renderProps();
  });
  $('#shapeChk').addEventListener('change', e => { TP.pen.shapes = e.target.checked; });
  $('#eraseIn').addEventListener('input', e => { TP.eraser.size = +e.target.value; $('#eraseOut').textContent = TP.eraser.size + ' pt'; });
  $('#scaleSel').addEventListener('change', e => setProp('scale', +e.target.value));
  $('#unitSel').addEventListener('change', e => setProp('unit', e.target.value));
  $('#pencilChip').addEventListener('click', () => setPencilOnly(!S.pencil.only));
  $('#colorPick').addEventListener('input', e => setProp('color', e.target.value, true));
  $('#colorPick').addEventListener('change', () => { S.propEdit = false; });
  $('#strokeIn').addEventListener('input', e => setProp('sw', +e.target.value, true));
  $('#strokeIn').addEventListener('change', () => { S.propEdit = false; });
  $('#opIn').addEventListener('input', e => setProp('op', +e.target.value, true));
  $('#opIn').addEventListener('change', () => { S.propEdit = false; });
  $('#fontSel').addEventListener('change', e => {
    const v = e.target.value, tg = propTarget();
    setProp('font', v); if (S.editing) S.editing.ta.focus();
    ensureFont(v, tg && tg.obj.bold).then(() => { if (S.editing) styleTA(); const p = S.sel ? pageById(S.sel.pid) : S.msel ? pageById(S.msel.pid) : null; if (p) drawAnnots(p); });
  });
  $('#sizeIn').addEventListener('change', e => { const v = clamp(+e.target.value || 12, 4, 144); setProp('size', v); S.propEdit = false; if (S.editing) S.editing.ta.focus(); });
  $('#boldBtn').onclick = () => { const tg = propTarget(); if (tg) setProp('bold', !tg.obj.bold); if (S.editing) S.editing.ta.focus(); };
  $('#stampSel').innerHTML = STAMPS.map(([t]) => `<option value="${t}">${t === '{datum}' ? 'Datum (' + today() + ')' : t}</option>`).join('') + '<option value="" hidden>Eigener Text</option>';
  $('#stampSel').addEventListener('change', e => {
    const v = e.target.value, st = STAMPS.find(s => s[0] === v); if (!st) return;
    const tg = propTarget(); if (!tg) return;
    TP.stamp.text = v; TP.stamp.color = st[1];
    if (tg.isAnnot) { pushHist(); tg.obj.text = v === '{datum}' ? today() : v; tg.obj.color = st[1]; drawAnnots(pageById(S.sel.pid)); markDirty(); }
    renderProps();
  });

  const fi = $('#findInput');
  fi.addEventListener('input', () => { clearTimeout(findT); findT = setTimeout(() => runFind(fi.value), 260); });
  fi.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); if (!S.find || S.find.q !== fi.value.trim().toLowerCase()) runFind(fi.value); else goHit(S.find.i + (e.shiftKey ? -1 : 1)); }
    if (e.key === 'Escape') { fi.value = ''; runFind(''); fi.blur(); }
  });
  $('#findNext').onclick = () => S.find && goHit(S.find.i + 1);
  $('#findPrev').onclick = () => S.find && goHit(S.find.i - 1);

  thumbsEl.addEventListener('click', e => {
    const t = e.target.closest('.thumb'); if (!t) return;
    const i = S.pages.findIndex(p => p.id === t.dataset.id);
    if (e.shiftKey) { const a = Math.min(S.cur, i), b = Math.max(S.cur, i); S.selPages = new Set(S.pages.slice(a, b + 1).map(p => p.id)); }
    else if (e.ctrlKey || e.metaKey) {
      if (S.selPages.size === 0 && S.pages[S.cur]) S.selPages.add(S.pages[S.cur].id);
      if (S.selPages.has(t.dataset.id)) S.selPages.delete(t.dataset.id); else S.selPages.add(t.dataset.id);
    } else S.selPages = new Set([t.dataset.id]);
    scrollToPage(i); markThumbSel();
    if (S.selPages.size > 1) setMsg(`${S.selPages.size} Seiten ausgewählt · Drehen, Löschen und Extrahieren gelten für alle`);
    else setMsg('');
    if (innerWidth <= 760) { work.classList.remove('thumbs-open'); $('#btnThumbs').setAttribute('aria-pressed', 'false'); }
  });
  let dragPid = null;
  const clearDrop = () => $$('.thumb.db,.thumb.da', thumbsEl).forEach(x => x.classList.remove('db', 'da'));
  thumbsEl.addEventListener('dragstart', e => { const t = e.target.closest('.thumb'); if (!t) return; dragPid = t.dataset.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'seite'); });
  thumbsEl.addEventListener('dragover', e => {
    if (!dragPid) return;
    const t = e.target.closest('.thumb'); if (!t) return;
    e.preventDefault(); clearDrop();
    const r = t.getBoundingClientRect(); t.classList.add(e.clientY < r.top + r.height / 2 ? 'db' : 'da');
  });
  thumbsEl.addEventListener('drop', e => {
    if (!dragPid) return;
    e.preventDefault();
    const t = e.target.closest('.thumb'); clearDrop();
    if (t) { const i = S.pages.findIndex(p => p.id === t.dataset.id), r = t.getBoundingClientRect(); movePage(dragPid, e.clientY < r.top + r.height / 2 ? i : i + 1); }
    dragPid = null;
  });
  thumbsEl.addEventListener('dragend', () => { dragPid = null; clearDrop(); });

  // Dateien ins Fenster ziehen
  let dragDepth = 0;
  const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; dragDepth++; $('#drop').hidden = false; });
  window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#drop').hidden = true; });
  window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; $('#drop').hidden = true;
    const files = [...e.dataTransfer.files];
    const pdfs = files.filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    const imgs = files.filter(f => /^image\//.test(f.type));
    if (pdfs.length) openFiles(pdfs, S.sample ? 'replace' : (e.shiftKey ? 'append' : 'replace'));
    else if (imgs.length) {
      const w = e.target.closest && e.target.closest('.page');
      const p = w ? pageById(w.dataset.id) : null;
      insertImages(imgs, p, p ? ptIn(e, els.get(p.id)) : null);
    } else toast('Nur PDFs und Bilder können hier abgelegt werden.');
  });

  // Unterschrift
  $('#sigTabDraw').onclick = () => setSigMode('draw');
  $('#sigTabType').onclick = () => setSigMode('type');
  $('#sigText').addEventListener('input', drawTypedSig);
  $('#sigClear').onclick = () => { clearSig(); if (sig.mode === 'type') { $('#sigText').value = ''; $('#sigText').focus(); } };
  $('#sigCancel').onclick = closeSig;
  $('#sigOk').onclick = sigOk;
  $('#sigSaved').onclick = () => { try { useSignature(JSON.parse(lsGet('pdfwb.signature'))); } catch (e) { toast('Die gespeicherte Unterschrift ist nicht mehr verfügbar.'); } };
  $('#sigColors').addEventListener('click', e => {
    const b = e.target.closest('.sw'); if (!b) return;
    sig.color = b.dataset.c;
    $$('.sw', $('#sigColors')).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    if (sig.mode === 'type') drawTypedSig();
  });
  $('#sigModal').addEventListener('pointerdown', e => { if (e.target.id === 'sigModal') closeSig(); });

  // Tastatur
  let lastNudge = 0;
  window.addEventListener('keydown', e => {
    const tgt = e.target, typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tgt.tagName) || tgt.isContentEditable;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (!$('#sigModal').hidden || !$('#askModal').hidden || !$('#dlg').hidden || !$('#noteModal').hidden) {
      if (e.key === 'Escape') {
        if (!$('#sigModal').hidden) closeSig();
        else if (!$('#askModal').hidden) $('#askNo').click();
        else if (!$('#dlg').hidden) $('#dlgCancel').click();
        else $('#noteCancel').click();
      }
      if (e.key === 'Enter' && !$('#dlg').hidden && tgt.tagName !== 'BUTTON') { e.preventDefault(); $('#dlgOk').click(); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !$('#noteModal').hidden) { e.preventDefault(); $('#noteOk').click(); }
      return;
    }
    if (!$('#menu').hidden && e.key === 'Escape') { closeMenu(); return; }
    if (mod && k === 's') { e.preventDefault(); if (S.lib && !e.shiftKey) { libSave().then(() => { setMsg('In der Bibliothek gesichert'); toast('In der Bibliothek gesichert · Als PDF-Datei: „Exportieren“ oder Strg+Umschalt+S'); }); } else savePdf(); return; }
    if (mod && k === 'o') { e.preventDefault(); $('#fileOpen').click(); return; }
    if (mod && k === 'f') { e.preventDefault(); fi.focus(); fi.select(); return; }
    if (typing) return;
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (mod && k === 'c') { if (copySelection(false)) e.preventDefault(); return; }
    if (mod && k === 'x') { if (S.tool !== 'objects' && copySelection(true)) e.preventDefault(); return; }
    if (mod && k === 'v') return; // übernimmt das paste-Ereignis
    if (mod && k === 'd') { e.preventDefault(); duplicateSel(); return; }
    if (mod && k === 'a' && S.tool === 'select') { e.preventDefault(); const p = S.pages[S.cur]; if (p) setMulti(p.id, p.annots.map(a => a.id)); return; }
    if (mod && (k === '+' || k === '=')) { e.preventDefault(); zoomStep(1); return; }
    if (mod && k === '-') { e.preventDefault(); zoomStep(-1); return; }
    if (mod && k === '0') { e.preventDefault(); fitWidth(); return; }
    if (mod || e.altKey) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (S.csel) { e.preventDefault(); deleteContent(); }
      else if (selAnnot() || S.msel) { e.preventDefault(); deleteSel(); }
      return;
    }
    if (e.key === 'Escape' && !$('#aiPanel').hidden) { toggleAI(false); return; }
    if (e.key === 'Escape') { if (S.reading) setReading(false); else if (S.csel) setCsel(null, []); else if (S.sel || S.msel) setMulti(null, []); else setTool('select'); return; }
    if (k === 'f') { setReading(!S.reading); return; }
    if (e.key === '?') { e.preventDefault(); shortcutsDialog(); return; }
    if (k === 'y' && AIX) { e.preventDefault(); toggleAI(); return; }
    if (S.reading && (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ')) { e.preventDefault(); scrollToPage(Math.min(S.pages.length - 1, S.cur + 1)); return; }
    if (S.reading && (e.key === 'ArrowLeft' || e.key === 'ArrowUp')) { e.preventDefault(); scrollToPage(Math.max(0, S.cur - 1)); return; }
    if (e.key === 'Enter' && S.csel && S.csel.items.length === 1 && S.csel.items[0].kind === 'text') { e.preventDefault(); editContentText(pageById(S.csel.pid), S.csel.items[0]); return; }
    if (e.key.startsWith('Arrow') && S.csel && S.tool === 'objects') {
      e.preventDefault();
      const st = e.shiftKey ? 10 : 1;
      nudgeContent(e.key === 'ArrowLeft' ? -st : e.key === 'ArrowRight' ? st : 0, e.key === 'ArrowUp' ? -st : e.key === 'ArrowDown' ? st : 0);
      return;
    }
    if (e.key.startsWith('Arrow') && S.msel) {
      e.preventDefault();
      const st = e.shiftKey ? 10 : 1, dx = e.key === 'ArrowLeft' ? -st : e.key === 'ArrowRight' ? st : 0, dy = e.key === 'ArrowUp' ? -st : e.key === 'ArrowDown' ? st : 0;
      const now = Date.now(); if (now - lastNudge > 700) pushHist(); lastNudge = now;
      const s = selectedAnnots(); s.list.forEach(a => Object.assign(a, translated(a, dx, dy))); drawAnnots(s.p); markDirty();
      return;
    }
    if (e.key.startsWith('Arrow') && selAnnot()) {
      e.preventDefault();
      const st = e.shiftKey ? 10 : 1, dx = e.key === 'ArrowLeft' ? -st : e.key === 'ArrowRight' ? st : 0, dy = e.key === 'ArrowUp' ? -st : e.key === 'ArrowDown' ? st : 0;
      const now = Date.now(); if (now - lastNudge > 700) pushHist(); lastNudge = now;
      const a = selAnnot(); Object.assign(a, translated(a, dx, dy)); drawAnnots(pageById(S.sel.pid)); markDirty();
      return;
    }
    if (e.key === 'PageDown') { e.preventDefault(); scrollToPage(Math.min(S.pages.length - 1, S.cur + 1)); return; }
    if (e.key === 'PageUp') { e.preventDefault(); scrollToPage(Math.max(0, S.cur - 1)); return; }
    if (k === 'i') { $('#fileImg').click(); return; }
    if (k === 'u') { openSig(); return; }
    if (k === 'z') { window.toggleCalc(); return; }
    if (KEYS[k]) setTool(KEYS[k]);
  });
  window.addEventListener('beforeunload', e => { if (S.dirty && !S.sample) { e.preventDefault(); e.returnValue = ''; } });
}

/* ---------- Bibliothek (Webseite und Desktop-App) ----------
   ?doc=<id> öffnet ein Dokument aus der Bibliothek; jede Änderung wird dort automatisch gesichert. */
const LIB = window.WBStore || null;
function libState(s) {
  const el = $('#libState'); if (!el || !S.lib) return;
  el.hidden = false; el.dataset.s = s;
  el.textContent = { pending: 'Änderungen …', saving: 'Sichert …', saved: 'Gesichert', error: 'Nicht gesichert' }[s] || '';
  el.title = s === 'saved' ? 'Automatisch in der Bibliothek gesichert' : s === 'error' ? 'Konnte nicht in der Bibliothek sichern' : '';
}
async function pageThumb() {
  const p = S.pages[0]; if (!p) return null;
  try {
    const proxy = proxyOf(p), base = proxy.getViewport({ scale: 1, rotation: rotOf(p) }), vp = proxy.getViewport({ scale: 360 / base.width, rotation: rotOf(p) });
    const c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
    await proxy.render({ canvasContext: ctx, viewport: vp }).promise;
    if (p.annots.length) {
      const [W, H] = dims(p);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${c.width}" height="${c.height}" viewBox="0 0 ${W} ${H}">${p.annots.map(annotSVG).join('')}</svg>`;
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
      ctx.drawImage(img, 0, 0, c.width, c.height);
    }
    return await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
  } catch (e) { return null; }
}
let libSaving = null;
async function libSave() {
  clearTimeout(autoT);
  if (!S.lib || !LIB || !S.pages.length) return;
  if (libSaving) { await libSaving; if (!S.dirty) return; }
  libSaving = (async () => {
    libState('saving');
    try {
      commitEdit();
      const state = docState();
      state.dirty = false;
      const sources = [...S.sources.values()].map(x => ({ id: x.id, name: x.name, bytes: x.bytes }));
      await LIB.saveDoc(S.lib.id, { state, sources, thumb: await pageThumb(), pages: S.pages.length });
      S.dirty = false; updateTitle(); libState('saved');
      scheduleDrive();
    } catch (e) { console.error(e); libState('error'); toast('In der Bibliothek sichern fehlgeschlagen: ' + (e.message || e)); }
  })();
  try { await libSaving; } finally { libSaving = null; }
}
/* Google-Drive-Backup des offenen Dokuments: kurz nach dem Sichern die PDF erzeugen und hochladen */
let driveT = 0, driveBusy = false;
function scheduleDrive(ms = 10000) {
  if (!S.lib || S.renderMode || !window.WBDrive || !window.WBDrive.enabled()) return;
  // im Modus „beim Schließen“, „täglich“ oder „manuell“ sichert die Bibliothek, nicht jede Speicherung hier
  if (window.WBDrive.wants && !window.WBDrive.wants('change')) return;
  clearTimeout(driveT); driveT = setTimeout(driveBackup, ms);
}
async function driveBackup() {
  if (driveBusy) { scheduleDrive(3000); return; }
  if (!S.lib || S.dirty) { scheduleDrive(4000); return; }
  driveBusy = true;
  try {
    const id = S.lib.id, bytes = await buildPdf(S.pages);
    if (await window.WBDrive.backupNow(id, bytes)) { const el = $('#libState'); if (el && el.dataset.s === 'saved') { el.textContent = 'Gesichert · Drive'; el.title = 'In der Bibliothek und in Google Drive gesichert'; } }
    else if (window.WBDrive.info().status === 'auth') { const el = $('#libState'); if (el) el.title = 'Google Drive: Anmeldung abgelaufen, in der Bibliothek auf „Fortsetzen“ tippen'; }
  } catch (e) { console.warn('Drive', e); }
  driveBusy = false;
}
async function openLibDoc(id) {
  busy(true, 'Dokument wird geöffnet …');
  try {
    const rec = await LIB.loadDoc(id);
    S.lib = { id, name: rec.item.name };
    if (rec.state) {
      await applyState(rec.state, async sid => rec.sources.find(x => x.id === sid));
      S.docName = rec.item.name + '.pdf';
    } else {
      // frisch importiert: erste Quelle öffnen, Quell-ID bleibt die der Bibliothek
      const src = rec.sources[0];
      const pages = await addSource(src.bytes, rec.item.name + '.pdf', src.id);
      S.bookmarks = await importOutline(src.id, pages);
      S.pages = pages; S.docName = rec.item.name + '.pdf'; S.sample = false; S.dirty = false; S.hist = []; S.fut = []; S.cur = 0;
      try {
        const info = (await S.sources.get(src.id).pdf.getMetadata()).info || {};
        S.meta = { title: info.Title || '', author: info.Author || '', subject: info.Subject || '', keywords: info.Keywords || '' };
      } catch (e) { /* keine Metadaten */ }
      S.zoom = initialZoom(); buildViewer(); updateTitle(); updateUndo();
    }
    S.dirty = false; updateTitle();
    document.title = rec.item.name + ' · PDF Werkbank';
    const dec = rec.sources.filter(x => S.decrypted.has(x.id) && S.sources.get(x.id));
    if (dec.length && !S.renderMode) {
      for (const x of dec) await LIB.putBlob(`src:${id}:${x.id}`, { name: x.name, bytes: S.sources.get(x.id).bytes });
      await LIB.update(id, { contentDirty: true, upSrc: [] });
    }
    libState('saved'); libUI();
    busy(false); setMsg('Aus der Bibliothek geöffnet · Änderungen werden automatisch gesichert');
    ensureFontsOf(S.pages);
    if (!S.renderMode && !/[?&](page|q)=/.test(location.search)) resumePos();
    // Vorschau nachziehen, falls noch keine da ist
    if (!(await LIB.getBlob('thumb:' + id))) { const t = await pageThumb(); if (t) await LIB.putBlob('thumb:' + id, t); }
    return true;
  } catch (e) {
    console.error(e); busy(false);
    S.lib = null;
    if (S.renderMode) { parent.postMessage({ wbRender: id, error: e.message || String(e) }, location.origin === 'null' ? '*' : location.origin); return false; }
    await ask('Dokument nicht verfügbar', e.message || String(e), 'Zur Bibliothek', 'Hier bleiben', false).then(y => { if (y) location.href = 'library.html'; });
    return false;
  }
}
async function goLibrary(extra = '') {
  if (S.lib && S.dirty) await libSave();
  else if (S.lib && libSaving) await libSaving;
  location.href = 'library.html' + extra;
}
/* aktuelles (nicht gespeichertes) Dokument in die Bibliothek übernehmen */
async function toLibrary() {
  if (!LIB || S.lib || !S.pages.length) return;
  busy(true, 'Wird in die Bibliothek übernommen …');
  try {
    const first = [...S.sources.values()][0];
    const it = await LIB.importPdf(first.bytes, S.docName.replace(/\.pdf$/i, ''), null, { pages: S.pages.length });
    S.lib = { id: it.id, name: it.name };
    S.sample = false;
    history.replaceState(null, '', 'index.html?doc=' + encodeURIComponent(it.id));
    busy(false);
    await libSave();
    libUI();
    try { await idbDel('session'); } catch (e) { /* egal */ }
    toast(`„${it.name}“ ist jetzt in der Bibliothek`);
  } catch (e) { console.error(e); busy(false); toast('Übernehmen fehlgeschlagen: ' + (e.message || e)); }
}
/* Öffnen im Bibliotheksmodus: neue PDFs in die Bibliothek legen und das erste öffnen */
async function openIntoLibrary(pdfs) {
  busy(true, 'PDF wird in die Bibliothek gelegt …');
  try {
    let first = null;
    for (const f of pdfs) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const it = await LIB.importPdf(bytes, f.name, null, {});
      first = first || it;
    }
    if (S.dirty) await libSave();
    location.href = 'index.html?doc=' + encodeURIComponent(first.id);
  } catch (e) { busy(false); toast('Öffnen fehlgeschlagen: ' + (e.message || e)); }
}
function libUI() {
  const b = $('#btnLib'); if (!b) return;
  b.hidden = !LIB;
  const m = $('#mToLib'); if (m) m.hidden = !LIB || !!S.lib;
  const lp = $('#mLibPages'); if (lp) lp.hidden = !S.lib;
  document.body.classList.toggle('libmode', !!S.lib);
  const sv = $('#btnSave');
  if (S.lib) { sv.title = 'Als PDF-Datei exportieren'; const l = sv.querySelector('.lbl'); if (l) l.textContent = 'Exportieren'; }
}
if (window.wbDesktop) document.documentElement.classList.add('desktop', window.wbDesktop.platform === 'darwin' ? 'mac' : 'win');
// vor einem Update offene Änderungen sichern
window.wbFlush = async () => { if (S.lib && S.dirty) await libSave(); };

/* Befehlspalette (Strg/⌘+K): Werkzeuge, Menüpunkte, Seiten */
function paletteProvider(q) {
  const out = [];
  const keyOf = t => Object.keys(KEYS).find(k => KEYS[k] === t);
  for (const [t, label] of Object.entries(TOOL_NAMES)) {
    if (!$(`[data-tool="${t}"]`)) continue;
    const k = keyOf(t);
    out.push({ group: 'Werkzeug', label, hint: k ? k.toUpperCase() : '', run: () => setTool(t) });
  }
  for (const b of $$('#menu [data-act]')) {
    if (b.hidden || b.closest('[hidden]')) continue;
    out.push({ group: 'Aktion', label: b.textContent.replace(/…/g, '').trim(), run: () => b.click() });
  }
  const A = (label, run, hint, keys) => out.push({ group: 'Aktion', label, run, hint, keys });
  A(S.lib ? 'Als PDF-Datei exportieren' : 'PDF speichern', savePdf, S.lib ? 'Strg+Umschalt+S' : 'Strg+S', 'download speichern export');
  if (S.lib) A('In der Bibliothek sichern', () => libSave(), 'Strg+S');
  if (LIB) A('Zur Bibliothek', () => goLibrary(), '', 'start ordner home');
  A('PDF öffnen', () => $('#fileOpen').click(), 'Strg+O');
  A('Im Dokument suchen', () => { const fi = $('#findInput'); fi.focus(); fi.select(); }, 'Strg+F', 'finden');
  A('Präsentieren mit Laserpointer', () => { setReading(true); setTool('laser'); }, 'F, J', 'vollbild präsentation laser');
  A('Rückgängig', undo, 'Strg+Z'); A('Wiederholen', redo, 'Strg+Y');
  A('Vergrößern', () => $('#btnZoomIn').click(), 'Strg +'); A('Verkleinern', () => $('#btnZoomOut').click(), 'Strg −');
  A('Seitenbreite', fitWidth, 'Strg+0', 'zoom anpassen');
  A('Nach Updates suchen', () => { if (window.WBUpdate) window.WBUpdate.check(true); }, '', 'update version aktualisieren');
  if (AIX) {
    out.push({ group: 'KI', label: 'KI-Assistent öffnen', hint: 'Y', keys: 'chatgpt claude ai frage', run: () => toggleAI(true) });
    for (const a of AI_ACTIONS) out.push({ group: 'KI', label: 'KI: ' + a.l, keys: 'chatgpt claude ai', run: () => { toggleAI(true); $(`#aiQuick [data-q="${a.k}"]`).click(); } });
  }
  const n = parseInt(String(q || '').replace(/\D/g, ''), 10);
  if (n >= 1 && n <= S.pages.length) out.push({ group: 'Seite', label: 'Gehe zu Seite ' + n, hint: 'von ' + S.pages.length, run: () => scrollToPage(n - 1), keys: String(n) });
  for (const b of S.bookmarks || []) { const i = S.pages.findIndex(p => p.id === b.pid); if (i >= 0) out.push({ group: 'Lesezeichen', label: b.title || b.name || 'Lesezeichen', hint: 'S. ' + (i + 1), run: () => scrollToPage(i) }); }
  return out;
}
if (window.WBPalette) window.WBPalette.add(paletteProvider);

/* ---------- Start ---------- */
async function boot() {
  bindUI();
  setTool('select'); updateUndo(); updateTitle();
  if (innerWidth <= 760) work.classList.remove('thumbs-open');
  if (!PDFJS || !PL) { setMsg('Die PDF-Bibliotheken konnten nicht geladen werden. Bitte Seite neu laden.'); return; }
  PDFJS.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
  if (ENG) {
    try {
      const d = await PL.PDFDocument.create(), fonts = new Map();
      for (const n of ENG.STD_FONTS) fonts.set(n, await d.embedFont(PL.StandardFonts[n.replace('Times-Roman', 'TimesRoman').replace(/^Times-/, 'TimesRoman').replace(/-/g, '')]));
      ENG.setStdWidths((name, ch) => { const f = fonts.get(name); if (!f) return null; try { return f.widthOfTextAtSize(ch, 1000); } catch (e) { return null; } });
    } catch (e) { console.warn('Standardschriften nicht geladen', e); }
  }
  libUI();
  const qp = new URLSearchParams(location.search);
  // unsichtbar in der Bibliothek: nur die PDF für das Drive-Backup erzeugen
  if (LIB && qp.get('render') === '1' && qp.get('doc') && parent !== window) {
    S.renderMode = true;
    const id = qp.get('doc');
    if (await openLibDoc(id)) {
      try { const buf = (await buildPdf(S.pages)).slice().buffer; parent.postMessage({ wbRender: id, bytes: buf }, location.origin === 'null' ? '*' : location.origin, [buf]); }
      catch (e) { parent.postMessage({ wbRender: id, error: e.message || String(e) }, location.origin === 'null' ? '*' : location.origin); }
    }
    return;
  }
  if (LIB && window.WBSync) window.WBSync.init();
  if (LIB && qp.get('doc')) {
    if (await openLibDoc(qp.get('doc'))) {
      const pg = +qp.get('page') || 0, fq = qp.get('q');
      if (pg || fq) setTimeout(async () => {
        if (pg) scrollToPage(pg - 1);
        if (fq) {
          $('#findInput').value = fq; await runFind(fq);
          const pid = pg && S.pages[pg - 1] && S.pages[pg - 1].id, k = S.find && pid ? S.find.hits.findIndex(h => h.pid === pid) : -1;
          if (k >= 0) goHit(k);
        }
        history.replaceState(null, '', 'index.html?doc=' + encodeURIComponent(qp.get('doc')));
      }, 350);
      if (qp.get('export') === '1') { history.replaceState(null, '', 'index.html?doc=' + encodeURIComponent(qp.get('doc'))); savePdf(); } return; }
  }
  if (await restoreSession()) return;
  busy(true, 'Beispiel wird geladen …');
  try {
    const { bytes, mark } = await makeSample();
    const pages = await addSource(bytes, 'Beispiel-Dokument.pdf');
    const m = mark;
    pages[0].annots.push(
      { id: uid(), t: 'hl', x: m.x - 4, y: m.y - 14, w: m.w + 8, h: 19, color: '#ffd400', op: 45 },
      { id: uid(), t: 'arrow', x1: m.x + m.w + 70, y1: m.y - 5, x2: m.x + m.w + 14, y2: m.y - 5, color: '#d0342c', sw: 1.5 },
      { id: uid(), t: 'text', x: m.x + m.w + 76, y: m.y - 11.5, text: 'Beispiel: anklicken, ziehen, mit Entf löschen', color: '#d0342c', size: 10, font: 'Helvetica', bold: false },
    );
    S.pages = pages;
    S.zoom = initialZoom();
    buildViewer();
    busy(false);
    setMsg('Beispiel geladen · Öffne dein eigenes PDF oder ziehe es ins Fenster');
  } catch (e) {
    console.error(e); busy(false);
    setMsg('Das Beispiel konnte nicht geladen werden. Öffne direkt ein eigenes PDF.');
  }
}
boot();
})();
