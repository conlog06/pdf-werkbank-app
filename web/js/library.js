/* PDF Werkbank – Bibliothek: Ordner mit Farben und Symbolen, Dokumente als Cover, Abgleich zwischen Geräten */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ST = window.WBStore, SY = window.WBSync, PDFJS = window.pdfjsLib, PL = window.PDFLib;
  const DESK = window.wbDesktop || null;
  if (PDFJS) PDFJS.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
  if (DESK) document.documentElement.classList.add('desktop', DESK.platform === 'darwin' ? 'mac' : 'win');

  /* ---------- Symbole ---------- */
  const P = {
    folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    book: 'M4 5c3-1 6-1 8 1v14c-2-2-5-2-8-1zM20 5c-3-1-6-1-8 1v14c2-2 5-2 8-1z',
    school: 'M2 9l10-5 10 5-10 5zM6 11v5c3 2.5 9 2.5 12 0v-5M22 9v6',
    work: 'M4 8h16v11H4zM9 8V5h6v3M4 13h16',
    star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z',
    heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
    music: 'M9 18V6l11-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
    flask: 'M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3M7 15h10',
    calc: 'M6 3h12v18H6zM9 7h6M9 11h.01M12 11h.01M15 11h.01M9 14.5h.01M12 14.5h.01M15 14.5h.01M9 18h.01M12 18h.01M15 18h.01',
    code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
    globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z',
    home: 'M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6',
    camera: 'M4 7h3l2-2h6l2 2h3v12H4zM12 10a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
    palette: 'M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.3-1-1.6-1-2.8 0-1 .8-1.5 1.8-1.5H17a4 4 0 0 0 4-4C21 6.4 17 3 12 3zM7.5 11h.01M10 7.5h.01M14.5 7.5h.01',
    fitness: 'M6.5 6.5v11M17.5 6.5v11M3.5 9.5v5M20.5 9.5v5M6.5 12h11',
    receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3',
    file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
    pen: 'M4 20l4-1L19 8a2.1 2.1 0 0 0-3-3L5 16zM14 7l3 3',
    bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.8.6 1.5 1.6 1.5 2.6V17h4v-.5c0-1 .7-2 1.5-2.6A6 6 0 0 0 12 3z',
    flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
    calendar: 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5',
    chart: 'M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-8',
    leaf: 'M5 19C5 10 11 4 20 4c0 9-6 15-15 15zM5 19l8-8',
    plane: 'M2 13l20-8-6 16-4-7zM12 14l4-5',
    car: 'M5 16h14M3 16v-3l2-5h14l2 5v3h-2M7 16a2 2 0 1 0 4 0M13 16a2 2 0 1 0 4 0',
    cart: 'M3 4h2l2.5 11h11L21 7H6.5M9 20h.01M18 20h.01',
    gift: 'M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7C10 3 7 4 8 6s4 1 4 1 3 1 4-1-2-3-4 1z',
    lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
    user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
    chat: 'M4 5h16v11H9l-5 4z',
    tooth: 'M7 3c-2 0-3.5 1.5-3.5 4 0 3 1.5 4.5 2 7 .5 3 1 7 2.5 7s1.5-4 4-4 2.5 4 4 4 2-4 2.5-7c.5-2.5 2-4 2-7 0-2.5-1.5-4-3.5-4-2 0-3 1-5 1S9 3 7 3z',
    game: 'M6 9h12a4 4 0 0 1 0 8c-1.5 0-2.3-1-3-2H9c-.7 1-1.5 2-3 2a4 4 0 0 1 0-8zM8 11v4M6 13h4M16 12h.01M18 14h.01',
    // Oberfläche
    plus: 'M12 5v14M5 12h14', search: 'M11 5a6 6 0 1 1 0 12a6 6 0 0 1 0-12zM20 20l-4.5-4.5',
    grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
    more: 'M5 11a1 1 0 1 0 0 2a1 1 0 1 0 0-2zM12 11a1 1 0 1 0 0 2a1 1 0 1 0 0-2zM19 11a1 1 0 1 0 0 2a1 1 0 1 0 0-2z',
    chev: 'M9 6l6 6-6 6', check: 'M5 12.5l4.5 4.5L19 7', close: 'M6 6l12 12M18 6L6 18',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6', clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
    docs: 'M8 3h8l4 4v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM16 3v4h4M4 7v12a3 3 0 0 0 3 3h9',
    cloud: 'M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z', clouddown: 'M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9zM12 11v6M9.5 14.5L12 17l2.5-2.5',
    upload: 'M12 16V4M7 9l5-5 5 5M5 20h14', move: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM10 13h6M13 10l3 3-3 3',
    copy: 'M8 8h11v12H8zM5 16V4h11', edit: 'M4 20l4-1L19 8a2.1 2.1 0 0 0-3-3L5 16z', restore: 'M4 12a8 8 0 1 0 2.4-5.7L4 9M4 4v5h5',
    download: 'M12 4v11M7 10l5 5 5-5M5 20h14', open: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
    select: 'M5 12.5l4.5 4.5L19 7M3 3h18v18H3z', menu: 'M4 6h16M4 12h16M4 18h16', refresh: 'M20 12a8 8 0 1 1-2.4-5.7L20 9M20 4v5h-5',
    notebook: 'M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6zM9 3v18M12 8h4M12 12h4', starf: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z',
    gear: 'M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
  };
  const FOLDER_ICONS = ['folder', 'book', 'school', 'work', 'star', 'heart', 'music', 'flask', 'calc', 'code', 'globe', 'home', 'camera', 'palette', 'fitness', 'receipt', 'file', 'pen', 'bulb', 'flag', 'calendar', 'chart', 'leaf', 'plane', 'car', 'cart', 'gift', 'lock', 'user', 'chat', 'tooth', 'game'];
  const COLORS = ['#3b6cf6', '#5b5bd6', '#8e4ec6', '#e0368c', '#e5484d', '#f57c00', '#f5b301', '#8bc34a', '#22a06b', '#2bb3c0', '#6b7280', '#a0522d'];
  const ico = (n, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${P[n] || P.file}"/></svg>`;

  /* ---------- Zustand ---------- */
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* egal */ } };
  const V = {
    items: [], byId: new Map(), view: { kind: 'folder', id: null }, q: '',
    layout: lsGet('pdfwb.lib.layout') || 'grid', sort: lsGet('pdfwb.lib.sort') || 'updated',
    open: new Set(JSON.parse(lsGet('pdfwb.lib.open') || '[]')), selecting: false, sel: new Set(), thumbs: new Map(),
  };
  try { const v = JSON.parse(lsGet('pdfwb.lib.view') || 'null'); if (v && v.kind) V.view = v; } catch (e) { /* egal */ }

  async function load() {
    V.items = await ST.all();
    V.byId = new Map(V.items.map(i => [i.id, i]));
    if (V.view.kind === 'folder' && V.view.id && !alive(V.byId.get(V.view.id))) V.view = { kind: 'folder', id: null };
  }
  const parentOf = i => (i.kind === 'folder' ? i.parent : i.folder) || null;
  /* sichtbar = nicht im Papierkorb und kein Elternordner im Papierkorb */
  function alive(i) {
    let cur = i, n = 0;
    while (cur && n++ < 64) { if (cur.trashed || cur.deleted) return false; const p = parentOf(cur); cur = p ? V.byId.get(p) : null; if (p && !cur) return true; }
    return !!i;
  }
  const childrenOf = id => V.items.filter(i => parentOf(i) === id && alive(i));
  const folders = () => V.items.filter(i => i.kind === 'folder');
  function pathOf(id) { const out = []; let cur = id ? V.byId.get(id) : null, n = 0; while (cur && n++ < 64) { out.unshift(cur); cur = cur.parent ? V.byId.get(cur.parent) : null; } return out; }
  const fmtDate = t => {
    if (!t) return '';
    const d = new Date(t), now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Heute, ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Gestern';
    return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  };
  const fmtSize = b => (b > 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
  const sorter = () => ({
    name: (a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }),
    updated: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
    created: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
  }[V.sort] || ((a, b) => 0));

  /* ---------- Darstellung ---------- */
  function render() {
    renderNav(); renderTree(); renderCrumbs(); renderContent();
    lsSet('pdfwb.lib.view', JSON.stringify(V.view));
  }
  function renderNav() {
    const docs = V.items.filter(i => i.kind === 'doc' && alive(i));
    const nav = [
      ['folder', null, 'docs', 'Dokumente', docs.length],
      ['recent', null, 'clock', 'Zuletzt geöffnet', ''],
      ['fav', null, 'starf', 'Favoriten', docs.filter(d => d.fav).length || ''],
      ['trash', null, 'trash', 'Papierkorb', V.items.filter(i => i.trashed).length || ''],
    ];
    $('#nav').innerHTML = nav.map(([k, id, ic, label, n]) => `<button class="nitem" data-nav="${k}" ${k === 'folder' ? 'data-drop=""' : ''} aria-current="${V.view.kind === k && (k !== 'folder' || !V.view.id) && !V.q}">${ico(ic)}<span>${label}</span><span class="cnt">${n}</span></button>`).join('');
  }
  function renderTree() {
    const out = [];
    const walk = (pid, lvl) => {
      const list = folders().filter(f => (f.parent || null) === pid && alive(f)).sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
      for (const f of list) {
        const kids = folders().some(c => c.parent === f.id && alive(c)), open = V.open.has(f.id);
        out.push(`<div class="titem" role="treeitem" data-folder="${f.id}" data-drop="${f.id}" draggable="true" style="--lvl:${lvl}" aria-current="${V.view.kind === 'folder' && V.view.id === f.id && !V.q}" aria-expanded="${kids ? open : ''}">
          <button class="tw${kids ? '' : ' none'}" data-tw="${f.id}" aria-label="Aufklappen" aria-expanded="${open}" tabindex="-1">${ico('chev')}</button>
          <span class="ficon" style="--fc:${f.color}">${ico(f.icon || 'folder')}</span><span class="tn">${esc(f.name)}</span></div>`);
        if (kids && open) walk(f.id, lvl + 1);
      }
    };
    walk(null, 0);
    $('#tree').innerHTML = out.join('') || `<p class="note" style="padding:4px 10px;margin:0">Noch keine Ordner.</p>`;
  }
  function viewTitle() {
    if (V.q) return 'Suche';
    return { recent: 'Zuletzt geöffnet', fav: 'Favoriten', trash: 'Papierkorb' }[V.view.kind] || null;
  }
  function renderCrumbs() {
    const t = viewTitle();
    let html;
    if (t) html = `<button>${esc(t)}</button>`;
    else {
      const path = pathOf(V.view.id);
      html = `<button data-go="">Dokumente</button>` + path.map(f => `<span class="sep">${ico('chev')}</span><button data-go="${f.id}">${esc(f.name)}</button>`).join('');
    }
    $('#crumbs').innerHTML = html;
    document.title = (t || (pathOf(V.view.id).pop() || { name: 'Bibliothek' }).name) + ' · PDF Werkbank';
  }

  function currentItems() {
    const live = V.items.filter(alive);
    if (V.q) {
      const q = V.q.toLowerCase();
      return live.filter(i => i.name.toLowerCase().includes(q));
    }
    switch (V.view.kind) {
      case 'recent': return live.filter(i => i.kind === 'doc' && i.openedAt).sort((a, b) => b.openedAt - a.openedAt).slice(0, 40);
      case 'fav': return live.filter(i => i.fav);
      case 'trash': return V.items.filter(i => i.trashed && !(parentOf(i) && V.byId.get(parentOf(i)) && V.byId.get(parentOf(i)).trashed));
      default: return childrenOf(V.view.id);
    }
  }
  function renderContent() {
    const c = $('#content'), items = currentItems();
    const keepSort = V.view.kind !== 'recent';
    const fs = items.filter(i => i.kind === 'folder'), ds = items.filter(i => i.kind === 'doc');
    if (keepSort) { fs.sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true })); ds.sort(sorter()); }
    $('#lib').classList.toggle('selecting', V.selecting);
    c.classList.toggle('selecting', V.selecting);
    for (const id of [...V.sel]) if (!items.some(i => i.id === id)) V.sel.delete(id);
    if (!items.length) { c.innerHTML = emptyState(); bindEmpty(); renderSelbar(); return; }
    const sortSel = `<select id="sortSel" aria-label="Sortieren">${[['updated', 'Zuletzt geändert'], ['name', 'Name'], ['created', 'Erstellt']].map(([k, l]) => `<option value="${k}"${V.sort === k ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    let html = '';
    if (V.view.kind === 'trash') html += `<div class="sec-h"><span>Elemente im Papierkorb</span><span class="grow"></span><button class="btn ghost" id="emptyTrash" style="height:30px;text-transform:none;letter-spacing:0">${ico('trash')}Papierkorb leeren</button></div>`;
    if (V.layout === 'list') {
      html += `<div class="list"><div class="lhead"><span></span><span>Name</span><span>Geändert</span><span>Ort</span><span>Größe</span><span></span></div>${fs.concat(ds).map(rowHTML).join('')}</div>`;
    } else {
      if (fs.length) html += `<section class="sec"><div class="sec-h"><span>Ordner</span><span class="grow"></span></div><div class="grid">${fs.map(folderTile).join('')}</div></section>`;
      if (ds.length) html += `<section class="sec"><div class="sec-h"><span>${V.view.kind === 'recent' ? 'Zuletzt geöffnet' : 'Dokumente'}</span><span class="grow"></span>${keepSort ? sortSel : ''}</div><div class="grid">${ds.map(docTile).join('')}</div></section>`;
    }
    c.innerHTML = html;
    const ss = $('#sortSel'); if (ss) ss.onchange = () => { V.sort = ss.value; lsSet('pdfwb.lib.sort', V.sort); renderContent(); };
    const et = $('#emptyTrash'); if (et) et.onclick = emptyTrash;
    loadThumbs();
    renderSelbar();
  }
  const countIn = id => childrenOf(id).length;
  function folderTile(f) {
    const n = countIn(f.id);
    return `<div class="tile${V.sel.has(f.id) ? ' sel' : ''}" role="button" tabindex="0" data-id="${f.id}" data-drop="${f.id}" draggable="true" aria-label="Ordner ${esc(f.name)}">
      <div class="art folder-art" style="--fc:${f.color}"><div class="body">${ico(f.icon || 'folder')}</div></div>
      <span class="chk">${ico('check')}</span>
      <button class="more" data-more="${f.id}" aria-label="Optionen für ${esc(f.name)}">${ico('more')}</button>
      <div class="meta"><div class="nm">${esc(f.name)}</div><div class="sub">${n === 1 ? '1 Element' : n + ' Elemente'}</div></div></div>`;
  }
  function docTile(d) {
    const th = V.thumbs.get(d.id);
    const badges = [];
    if (d.missing) badges.push(`<span class="badge" title="Liegt in der Cloud, wird geladen">${ico('clouddown')}</span>`);
    else if (d.dirty && SY && SY.ready()) badges.push(`<span class="badge" title="Wird hochgeladen">${ico('upload')}</span>`);
    if (d.pages) badges.push(`<span class="badge">${d.pages} S.</span>`);
    const where = (V.q || V.view.kind !== 'folder') && d.folder && V.byId.get(d.folder) ? ' · ' + esc(V.byId.get(d.folder).name) : '';
    return `<div class="tile${V.sel.has(d.id) ? ' sel' : ''}" role="button" tabindex="0" data-id="${d.id}" draggable="true" aria-label="Dokument ${esc(d.name)}">
      <div class="art cover" data-cover="${d.id}">${th ? `<img src="${th}" alt="" onload="this.parentNode.classList.toggle('land',this.naturalWidth>this.naturalHeight)">` : `<span class="ph">${ico('file')}</span>`}<div class="badges">${badges.join('')}</div></div>
      <span class="chk">${ico('check')}</span>
      <button class="more" data-more="${d.id}" aria-label="Optionen für ${esc(d.name)}">${ico('more')}</button>
      <div class="meta"><div class="nm">${esc(d.name)}</div><div class="sub">${d.fav ? `<span class="star">${ico('starf')}</span>` : ''}<span>${fmtDate(V.view.kind === 'recent' ? d.openedAt : d.updatedAt)}${where}</span></div></div></div>`;
  }
  function rowHTML(i) {
    const isF = i.kind === 'folder', th = !isF && V.thumbs.get(i.id);
    const icon = isF ? `<span class="ri f" style="--fc:${i.color}">${ico(i.icon || 'folder')}</span>` : `<span class="ri" data-cover="${i.id}">${th ? `<img src="${th}" alt="">` : ico('file')}</span>`;
    const where = (parentOf(i) && V.byId.get(parentOf(i))) ? V.byId.get(parentOf(i)).name : 'Dokumente';
    return `<div class="row${V.sel.has(i.id) ? ' sel' : ''}" role="button" tabindex="0" data-id="${i.id}" ${isF ? `data-drop="${i.id}"` : ''} draggable="true">
      ${icon}<span><div class="rn">${i.fav ? `<span class="star">★</span> ` : ''}${esc(i.name)}${i.missing ? ' ☁' : ''}</div><div class="rs">${isF ? (countIn(i.id) + ' Elemente') : (i.pages ? i.pages + ' Seiten' : 'PDF')}</div></span>
      <span class="rs rc">${fmtDate(i.updatedAt)}</span><span class="rs rc">${esc(where)}</span><span class="rs rc">${isF ? '' : fmtSize(i.size || 0)}</span>
      <button class="ibtn more" data-more="${i.id}" aria-label="Optionen">${ico('more')}</button></div>`;
  }
  function emptyState() {
    const k = V.q ? 'search' : V.view.kind;
    const txt = {
      search: ['Nichts gefunden', `Kein Ordner und kein Dokument heißt „${esc(V.q)}“.`],
      recent: ['Noch nichts geöffnet', 'Geöffnete Dokumente erscheinen hier, auf allen deinen Geräten.'],
      fav: ['Keine Favoriten', 'Markiere Dokumente oder Ordner mit dem Stern, um sie hier schnell zu finden.'],
      trash: ['Papierkorb ist leer', 'Gelöschte Dokumente und Ordner landen erst hier und lassen sich wiederherstellen.'],
      folder: [V.view.id ? 'Dieser Ordner ist leer' : 'Willkommen in deiner Bibliothek', 'Importiere PDFs, lege ein Notizbuch an oder ordne alles in Ordnern mit Farben und Symbolen. PDFs kannst du auch einfach ins Fenster ziehen.'],
    }[k];
    const acts = k === 'folder' ? `<div class="acts"><button class="btn primary" data-act="import">${ico('upload')}PDF importieren</button><button class="btn" data-act="notebook">${ico('notebook')}Neues Notizbuch</button><button class="btn" data-act="folder">${ico('folder')}Neuer Ordner</button></div>` : '';
    return `<div class="empty"><svg class="illu" viewBox="0 0 120 96" aria-hidden="true"><rect x="10" y="14" width="56" height="70" rx="6" fill="var(--raise)" stroke="var(--line)" stroke-width="2"/><rect x="40" y="6" width="56" height="70" rx="6" fill="var(--raise)" stroke="var(--line)" stroke-width="2"/><path d="M50 22h36M50 32h36M50 42h24" stroke="var(--line)" stroke-width="3" stroke-linecap="round"/><circle cx="92" cy="72" r="16" fill="var(--accent)"/><path d="M92 64v16M84 72h16" stroke="var(--accent-ink)" stroke-width="3" stroke-linecap="round"/></svg><h2>${txt[0]}</h2><p>${txt[1]}</p>${acts}</div>`;
  }
  function bindEmpty() { $$('[data-act]', $('#content')).forEach(b => { b.onclick = () => newAction(b.dataset.act); }); }

  /* Vorschaubilder aus der Bibliothek (Blob → Objekt-URL, zwischengespeichert) */
  async function loadThumbs() {
    for (const el of $$('[data-cover]')) {
      const id = el.dataset.cover, it = V.byId.get(id);
      if (!it) continue;
      const key = id + '|' + it.rev;
      if (V.thumbs.has(id) && V.thumbs.get(id + '#') === key) continue;
      const b = await ST.getBlob('thumb:' + id);
      if (!b) continue;
      const old = V.thumbs.get(id); if (old) URL.revokeObjectURL(old);
      const url = URL.createObjectURL(b);
      V.thumbs.set(id, url); V.thumbs.set(id + '#', key);
      for (const e of $$(`[data-cover="${CSS.escape(id)}"]`)) {
        const img = e.querySelector('img');
        if (img) img.src = url; else { const ph = e.querySelector('.ph') || e.querySelector('svg'); const im = new Image(); im.alt = ''; im.onload = () => e.classList.toggle('land', im.naturalWidth > im.naturalHeight); im.src = url; if (ph) ph.replaceWith(im); else e.prepend(im); }
      }
    }
  }

  /* ---------- Auswahl ---------- */
  function renderSelbar() {
    let bar = $('#selbar');
    if (!V.selecting) { if (bar) bar.remove(); $('#selectBtn').querySelector('.lbl').textContent = 'Auswählen'; return; }
    $('#selectBtn').querySelector('.lbl').textContent = 'Fertig';
    if (!bar) { bar = document.createElement('div'); bar.className = 'selbar'; bar.id = 'selbar'; $('#content').parentElement.appendChild(bar); }
    const n = V.sel.size, trash = V.view.kind === 'trash';
    bar.innerHTML = `<b>${n ? n + ' ausgewählt' : 'Elemente antippen'}</b>` + (trash
      ? `<button class="btn" data-sa="restore"${n ? '' : ' disabled'}>${ico('restore')}Wiederherstellen</button><button class="btn" data-sa="destroy"${n ? '' : ' disabled'}>${ico('trash')}Endgültig löschen</button>`
      : `<button class="ibtn" data-sa="all" title="Alle auswählen">${ico('select')}</button><button class="ibtn" data-sa="move" title="Verschieben"${n ? '' : ' disabled'}>${ico('move')}</button><button class="ibtn" data-sa="dup" title="Duplizieren"${n ? '' : ' disabled'}>${ico('copy')}</button><button class="ibtn" data-sa="fav" title="Favorit"${n ? '' : ' disabled'}>${ico('star')}</button><button class="ibtn" data-sa="trash" title="Löschen"${n ? '' : ' disabled'}>${ico('trash')}</button>`)
      + `<button class="ibtn" data-sa="done" title="Fertig">${ico('close')}</button>`;
    bar.onclick = async e => {
      const b = e.target.closest('[data-sa]'); if (!b || b.disabled) return;
      const ids = [...V.sel];
      switch (b.dataset.sa) {
        case 'all': currentItems().forEach(i => V.sel.add(i.id)); renderContent(); return;
        case 'move': return moveDialog(ids);
        case 'dup': for (const id of ids) if (V.byId.get(id).kind === 'doc') await ST.duplicate(id); toast('Dupliziert'); break;
        case 'fav': { const on = !ids.every(id => V.byId.get(id).fav); for (const id of ids) await ST.update(id, { fav: on }); break; }
        case 'trash': await ST.trash(ids); toast(ids.length === 1 ? 'In den Papierkorb gelegt' : `${ids.length} Elemente in den Papierkorb gelegt`, ids); break;
        case 'restore': await ST.restore(ids); toast('Wiederhergestellt'); break;
        case 'destroy': if (!await confirmDlg('Endgültig löschen?', `${ids.length} Element(e) werden auf allen Geräten gelöscht. Das lässt sich nicht rückgängig machen.`, 'Löschen', true)) return; await ST.destroy(ids); break;
        case 'done': break;
      }
      V.selecting = false; V.sel.clear(); await refresh();
    };
  }
  function toggleSel(id) { if (V.sel.has(id)) V.sel.delete(id); else V.sel.add(id); renderContent(); }

  /* ---------- Navigation ---------- */
  function go(view) { V.view = view; V.q = ''; $('#search').value = ''; V.sel.clear(); closeDrawer(); render(); $('#content').scrollTop = 0; }
  function openItem(it) {
    if (!it) return;
    if (V.view.kind === 'trash') { itemMenu(it, null); return; }
    if (it.kind === 'folder') { go({ kind: 'folder', id: it.id }); V.open.add(it.id); pathOf(it.id).forEach(f => V.open.add(f.id)); saveOpen(); renderTree(); return; }
    openDoc(it.id);
  }
  async function openDoc(id) {
    const it = V.byId.get(id);
    if (it && it.missing) {
      if (!SY || !SY.ready()) { toast('Das Dokument liegt in der Cloud. Melde dich an, um es zu laden.'); return; }
      busy('Wird aus der Cloud geladen …');
      try { await SY.fetchDoc(id); } catch (e) { busy(false); toast('Laden fehlgeschlagen: ' + (e.message || e)); return; }
      busy(false);
    }
    await ST.markOpened(id);
    location.href = 'index.html?doc=' + encodeURIComponent(id);
  }
  const saveOpen = () => lsSet('pdfwb.lib.open', JSON.stringify([...V.open]));
  const closeDrawer = () => $('#lib').classList.remove('drawer');

  /* ---------- Neu: Import, Notizbuch, Ordner ---------- */
  const targetFolder = () => (V.view.kind === 'folder' && !V.q ? V.view.id : null);
  function newAction(k) {
    if (k === 'import') $('#fileIn').click();
    else if (k === 'notebook') notebookDialog();
    else if (k === 'folder') folderDialog(null, targetFolder());
  }
  async function makeThumb(bytes) {
    if (!PDFJS) return {};
    try {
      const pdf = await PDFJS.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
      const pg = await pdf.getPage(1), vp0 = pg.getViewport({ scale: 1 }), s = 360 / vp0.width, vp = pg.getViewport({ scale: s });
      const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      const thumb = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
      const pages = pdf.numPages; pdf.destroy();
      return { thumb, pages };
    } catch (e) { console.warn('Vorschau', e); return {}; }
  }
  async function importFiles(files, folder = targetFolder()) {
    const pdfs = [...files].filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (!pdfs.length) { toast('Bitte PDF-Dateien wählen.'); return []; }
    busy(pdfs.length === 1 ? 'PDF wird importiert …' : `${pdfs.length} PDFs werden importiert …`);
    const out = [];
    try {
      for (const f of pdfs) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        out.push(await importBytes(bytes, f.name, folder));
      }
    } catch (e) { console.error(e); toast('Import fehlgeschlagen: ' + (e.message || e)); }
    busy(false);
    await refresh();
    if (out.length) toast(out.length === 1 ? `„${out[0].name}“ importiert` : `${out.length} PDFs importiert`);
    return out;
  }
  async function importBytes(bytes, name, folder) {
    const { thumb, pages } = await makeThumb(bytes);
    return ST.importPdf(bytes, name, folder, { thumb, pages });
  }

  /* Notizbuch: Deckblatt + Papier, als echte PDF erzeugt */
  const PAPERS = [['blank', 'Blanko'], ['lined', 'Liniert'], ['grid', 'Kariert'], ['dots', 'Punktiert']];
  const FORMATS = { A4: [595.28, 841.89], A5: [419.53, 595.28], Letter: [612, 792] };
  function paperPreview(k) {
    let d = '';
    if (k === 'lined') for (let y = 14; y < 76; y += 6) d += `M8 ${y}h44`;
    if (k === 'grid') { for (let y = 8; y < 80; y += 5) d += `M4 ${y}h52`; for (let x = 6; x < 58; x += 5) d += `M${x} 4v72`; }
    const dots = k === 'dots' ? Array.from({ length: 13 * 9 }, (_, i) => `<circle cx="${8 + (i % 9) * 5.5}" cy="${8 + Math.floor(i / 9) * 5.5}" r=".7" fill="#9aa4b5"/>`).join('') : '';
    return `<svg viewBox="0 0 60 80"><path d="${d}" stroke="${k === 'grid' ? '#cdd7e6' : '#b9c6dc'}" stroke-width=".6" fill="none"/>${dots}</svg>`;
  }
  async function makeNotebook({ name, paper, format, land, pages, cover, color }) {
    const { PDFDocument, rgb, StandardFonts } = PL;
    const d = await PDFDocument.create();
    d.setTitle(name); d.setProducer('PDF Werkbank');
    let [W, H] = FORMATS[format] || FORMATS.A4; if (land) [W, H] = [H, W];
    const hex = h => { const n = parseInt(h.slice(1), 16); return rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); };
    if (cover) {
      const p = d.addPage([W, H]), f = await d.embedFont(StandardFonts.HelveticaBold), c = hex(color);
      p.drawRectangle({ x: 0, y: 0, width: W, height: H, color: c });
      p.drawRectangle({ x: 0, y: 0, width: 18, height: H, color: rgb(0, 0, 0), opacity: 0.12 });
      const bw = W * 0.62, bh = 86, bx = (W - bw) / 2, by = H * 0.62;
      p.drawRectangle({ x: bx, y: by, width: bw, height: bh, color: rgb(1, 1, 1), opacity: 0.95 });
      let size = 22; const txt = name.replace(/[^\x20-\x7e\xa0-\xff€]/g, '?');
      while (size > 10 && f.widthOfTextAtSize(txt, size) > bw - 30) size -= 1;
      p.drawText(txt, { x: bx + (bw - f.widthOfTextAtSize(txt, size)) / 2, y: by + bh / 2 - size * 0.35, size, font: f, color: rgb(0.12, 0.14, 0.2) });
    }
    const line = rgb(0.72, 0.78, 0.87), grid = rgb(0.82, 0.86, 0.92), dot = rgb(0.6, 0.65, 0.73), m = 36;
    for (let i = 0; i < pages; i++) {
      const p = d.addPage([W, H]);
      if (paper === 'lined') { for (let y = H - 72; y > m; y -= 22.7) p.drawLine({ start: { x: m, y }, end: { x: W - m, y }, thickness: 0.5, color: line }); p.drawLine({ start: { x: m + 50, y: H - 30 }, end: { x: m + 50, y: m }, thickness: 0.6, color: rgb(0.93, 0.55, 0.55) }); }
      if (paper === 'grid') { const s = 14.17; for (let y = H - m; y >= m - 0.1; y -= s) p.drawLine({ start: { x: m, y }, end: { x: W - m, y }, thickness: 0.4, color: grid }); for (let x = m; x <= W - m + 0.1; x += s) p.drawLine({ start: { x, y: m }, end: { x, y: H - m }, thickness: 0.4, color: grid }); }
      if (paper === 'dots') { const s = 14.17; for (let y = H - m; y >= m; y -= s) for (let x = m; x <= W - m; x += s) p.drawCircle({ x, y, size: 0.7, color: dot }); }
    }
    return new Uint8Array(await d.save());
  }

  /* ---------- Dialoge ---------- */
  function dialog(html, { wide, onOpen } = {}) {
    return new Promise(res => {
      const s = document.createElement('div'); s.className = 'scrim';
      s.innerHTML = `<div class="dlg${wide ? ' wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
      document.body.appendChild(s);
      const close = v => { s.remove(); document.removeEventListener('keydown', key, true); res(v); };
      const key = e => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
      document.addEventListener('keydown', key, true);
      s.addEventListener('pointerdown', e => { if (e.target === s) close(null); });
      onOpen && onOpen(s.firstElementChild, close);
      const f = s.querySelector('[autofocus]') || s.querySelector('input,button'); if (f) setTimeout(() => { f.focus(); if (f.select) f.select(); }, 30);
    });
  }
  function confirmDlg(title, text, ok = 'OK', danger = false) {
    return dialog(`<h2>${esc(title)}</h2><p class="lead">${esc(text)}</p><div class="acts"><button class="btn" data-x="0">Abbrechen</button><button class="btn ${danger ? 'danger' : 'primary'}" data-x="1" autofocus>${esc(ok)}</button></div>`,
      { onOpen: (d, close) => d.addEventListener('click', e => { const b = e.target.closest('[data-x]'); if (b) close(b.dataset.x === '1'); }) });
  }
  function promptDlg(title, label, value, ok = 'Speichern') {
    return dialog(`<h2>${esc(title)}</h2><form><label class="fld" style="margin-top:14px"><span>${esc(label)}</span><input class="field" name="v" value="${esc(value)}" autofocus maxlength="160"></label><div class="acts"><button type="button" class="btn" data-x="0">Abbrechen</button><button class="btn primary">${esc(ok)}</button></div></form>`,
      { onOpen: (d, close) => { d.querySelector('[data-x]').onclick = () => close(null); d.querySelector('form').onsubmit = e => { e.preventDefault(); const v = d.querySelector('input').value.trim(); if (v) close(v); }; } });
  }

  /* Ordner anlegen oder bearbeiten: Name, Farbe, Symbol */
  async function folderDialog(folder, parent) {
    const f = folder ? { ...folder } : { name: '', color: COLORS[Math.floor(Math.random() * 6)], icon: 'folder', parent };
    const res = await dialog(`<h2>${folder ? 'Ordner bearbeiten' : 'Neuer Ordner'}</h2>
      <p class="lead">${parent && !folder ? `In „${esc((V.byId.get(parent) || {}).name)}“` : folder ? '' : 'In „Dokumente“'}</p>
      <form>
        <div class="preview"><div class="folder-art" id="fPrev" style="--fc:${f.color}"><div class="body">${ico(f.icon)}</div></div>
          <label class="fld" style="flex:1;margin:0"><span>Name</span><input class="field" name="name" value="${esc(f.name)}" placeholder="z. B. Uni, Rechnungen, Fitness" autofocus maxlength="80"></label></div>
        <div class="fld"><span>Farbe</span><div class="swatches" id="fCol">${COLORS.map(c => `<button type="button" style="--c:${c}" data-c="${c}" aria-label="Farbe ${c}" aria-pressed="${c === f.color}"></button>`).join('')}</div></div>
        <div class="fld"><span>Symbol</span><div class="icons" id="fIco" style="--fc:${f.color}">${FOLDER_ICONS.map(n => `<button type="button" data-i="${n}" aria-label="${n}" aria-pressed="${n === f.icon}">${ico(n)}</button>`).join('')}</div></div>
        <div class="acts"><button type="button" class="btn" data-x="0">Abbrechen</button><button class="btn primary">${folder ? 'Speichern' : 'Erstellen'}</button></div>
      </form>`, {
      onOpen: (d, close) => {
        const upd = () => { d.querySelector('#fPrev').style.setProperty('--fc', f.color); d.querySelector('#fPrev .body').innerHTML = ico(f.icon); d.querySelector('#fIco').style.setProperty('--fc', f.color); };
        d.querySelector('#fCol').onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; f.color = b.dataset.c; $$('#fCol button', d).forEach(x => x.setAttribute('aria-pressed', String(x === b))); upd(); };
        d.querySelector('#fIco').onclick = e => { const b = e.target.closest('[data-i]'); if (!b) return; f.icon = b.dataset.i; $$('#fIco button', d).forEach(x => x.setAttribute('aria-pressed', String(x === b))); upd(); };
        d.querySelector('[data-x]').onclick = () => close(null);
        d.querySelector('form').onsubmit = e => { e.preventDefault(); f.name = d.querySelector('input[name=name]').value.trim() || 'Neuer Ordner'; close(f); };
      },
    });
    if (!res) return;
    if (folder) await ST.update(folder.id, { name: res.name, color: res.color, icon: res.icon });
    else { const nf = await ST.createFolder(res); if (parent) { V.open.add(parent); saveOpen(); } toast(`Ordner „${nf.name}“ erstellt`); }
    await refresh();
  }

  async function notebookDialog() {
    const o = { name: 'Notizbuch ' + new Date().toLocaleDateString('de-DE'), paper: 'lined', format: 'A4', land: false, pages: 10, cover: true, color: '#3b6cf6' };
    const res = await dialog(`<h2>Neues Notizbuch</h2><p class="lead">Leere Seiten zum Schreiben mit Stift, Pencil oder Tastatur.</p>
      <form>
        <label class="fld"><span>Name</span><input class="field" name="name" value="${esc(o.name)}" autofocus maxlength="80"></label>
        <div class="fld"><span>Papier</span><div class="papers" id="nbPaper">${PAPERS.map(([k, l]) => `<button type="button" data-p="${k}" aria-pressed="${k === o.paper}">${paperPreview(k)}${l}</button>`).join('')}</div></div>
        <div class="frow"><label class="fld"><span>Format</span><select class="field" name="format">${Object.keys(FORMATS).map(k => `<option>${k}</option>`).join('')}</select></label>
          <label class="fld"><span>Ausrichtung</span><select class="field" name="land"><option value="0">Hochformat</option><option value="1">Querformat</option></select></label></div>
        <div class="frow"><label class="fld"><span>Seiten</span><input class="field" type="number" name="pages" min="1" max="200" value="${o.pages}"></label>
          <label class="fld"><span>Deckblatt</span><select class="field" name="cover"><option value="1">Mit Deckblatt</option><option value="0">Ohne</option></select></label></div>
        <div class="fld" id="nbColF"><span>Farbe des Deckblatts</span><div class="swatches" id="nbCol">${COLORS.map(c => `<button type="button" style="--c:${c}" data-c="${c}" aria-pressed="${c === o.color}" aria-label="Farbe ${c}"></button>`).join('')}</div></div>
        <div class="acts"><button type="button" class="btn" data-x="0">Abbrechen</button><button class="btn primary">Erstellen</button></div>
      </form>`, {
      wide: true,
      onOpen: (d, close) => {
        d.querySelector('#nbPaper').onclick = e => { const b = e.target.closest('[data-p]'); if (!b) return; o.paper = b.dataset.p; $$('#nbPaper button', d).forEach(x => x.setAttribute('aria-pressed', String(x === b))); };
        d.querySelector('#nbCol').onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; o.color = b.dataset.c; $$('#nbCol button', d).forEach(x => x.setAttribute('aria-pressed', String(x === b))); };
        d.querySelector('[name=cover]').onchange = e => { d.querySelector('#nbColF').hidden = e.target.value === '0'; };
        d.querySelector('[data-x]').onclick = () => close(null);
        d.querySelector('form').onsubmit = e => {
          e.preventDefault(); const fd = new FormData(e.target);
          close({ ...o, name: String(fd.get('name')).trim() || 'Notizbuch', format: fd.get('format'), land: fd.get('land') === '1', pages: Math.max(1, Math.min(200, +fd.get('pages') || 1)), cover: fd.get('cover') === '1' });
        };
      },
    });
    if (!res) return;
    busy('Notizbuch wird angelegt …');
    try {
      const bytes = await makeNotebook(res);
      const doc = await importBytes(bytes, res.name, targetFolder());
      if (res.cover) await ST.update(doc.id, { color: res.color }, { local: false });
      busy(false);
      await openDoc(doc.id);
    } catch (e) { busy(false); console.error(e); toast('Das Notizbuch konnte nicht erstellt werden.'); }
  }

  /* Ziel-Ordner wählen */
  async function moveDialog(ids) {
    const banned = new Set(ids);
    for (const id of ids) if ((V.byId.get(id) || {}).kind === 'folder') (await ST.descendants(id, V.items)).forEach(d => banned.add(d.id));
    let target = null;
    const rows = [`<div class="titem" data-pick="" aria-current="true" style="--lvl:0"><span class="tw none"></span><span class="ficon" style="--fc:#6b7280">${ico('docs')}</span><span class="tn">Dokumente (oberste Ebene)</span></div>`];
    const walk = (pid, lvl) => folders().filter(f => (f.parent || null) === pid && alive(f) && !banned.has(f.id)).sort((a, b) => a.name.localeCompare(b.name, 'de')).forEach(f => {
      rows.push(`<div class="titem" data-pick="${f.id}" style="--lvl:${lvl}"><span class="tw none"></span><span class="ficon" style="--fc:${f.color}">${ico(f.icon)}</span><span class="tn">${esc(f.name)}</span></div>`); walk(f.id, lvl + 1);
    });
    walk(null, 1);
    const res = await dialog(`<h2>Verschieben</h2><p class="lead">${ids.length === 1 ? esc(V.byId.get(ids[0]).name) : ids.length + ' Elemente'} nach …</p>
      <div class="pick" id="pick">${rows.join('')}</div>
      <div class="acts"><button class="btn" id="mvNew">${ico('plus')}Neuer Ordner</button><span style="flex:1"></span><button class="btn" data-x="0">Abbrechen</button><button class="btn primary" data-x="1">Hierhin verschieben</button></div>`, {
      onOpen: (d, close) => {
        d.querySelector('#pick').onclick = e => { const r = e.target.closest('[data-pick]'); if (!r) return; target = r.dataset.pick || null; $$('[data-pick]', d).forEach(x => x.setAttribute('aria-current', String(x === r))); };
        d.querySelector('#pick').ondblclick = e => { const r = e.target.closest('[data-pick]'); if (r) close({ go: true }); };
        d.querySelector('#mvNew').onclick = () => close({ newFolder: true });
        d.addEventListener('click', e => { const b = e.target.closest('[data-x]'); if (b) close(b.dataset.x === '1' ? { go: true } : null); });
      },
    });
    if (!res) return;
    if (res.newFolder) {
      const name = await promptDlg('Neuer Ordner', 'Name', 'Neuer Ordner', 'Erstellen und verschieben'); if (!name) return;
      const nf = await ST.createFolder({ name, parent: target, color: COLORS[0], icon: 'folder' }); target = nf.id;
    }
    try { await ST.move(ids, target); } catch (e) { toast(e.message); return; }
    V.selecting = false; V.sel.clear();
    toast(`Verschoben nach „${target ? V.byId.get(target) ? V.byId.get(target).name : 'Ordner' : 'Dokumente'}“`);
    await refresh();
  }

  /* Sync: Konto, Status, Einrichtung */
  async function syncDialog() {
    if (!SY) return;
    await SY.init();
    const I = SY.info(), cfg = SY.config();
    const statusText = { ok: 'Alles synchronisiert', syncing: 'Synchronisiert gerade …', error: 'Fehler: ' + I.error, offline: 'Offline, wird später abgeglichen', idle: 'Bereit' }[I.status] || '';
    let html = `<h2>Geräte synchronisieren</h2><p class="lead">Webseite und Desktop-App teilen dieselbe Bibliothek: Ordner, Dokumente und alle Markierungen.</p>`;
    if (I.user) {
      html += `<div class="account"><span class="avatar">${esc((I.user.email || '?')[0].toUpperCase())}</span><div style="flex:1;min-width:0"><b>${esc(I.user.email)}</b><div class="note">${esc(statusText)}${I.lastSync ? ' · zuletzt ' + new Date(I.lastSync).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : ''}</div></div></div>
        <div class="acts" style="justify-content:space-between"><button class="btn" data-x="out">Abmelden</button><span><button class="btn" data-x="0">Schließen</button> <button class="btn primary" data-x="now">${ico('refresh')}Jetzt synchronisieren</button></span></div>`;
    } else if (!cfg) {
      html += `<p class="note">Für den Abgleich braucht die Werkbank ein kostenloses <b>Supabase</b>-Projekt. Einmal anlegen, <code>supabase/schema.sql</code> im SQL-Editor ausführen und hier die Werte aus <i>Project Settings → API</i> eintragen (oder fest in <code>js/config.js</code>).</p>
        <form id="cfgF"><label class="fld"><span>Project URL</span><input class="field" name="url" placeholder="https://xxxx.supabase.co" autofocus></label>
        <label class="fld"><span>anon public key</span><input class="field" name="key" placeholder="eyJhbGciOi…"></label><p class="err" id="cfgErr"></p>
        <div class="acts"><button type="button" class="btn" data-x="0">Abbrechen</button><button class="btn primary">Verbinden</button></div></form>`;
    } else {
      html += `<div class="tabs" role="tablist"><button type="button" role="tab" data-tab="in" aria-selected="true">Anmelden</button><button type="button" role="tab" data-tab="up" aria-selected="false">Konto erstellen</button></div>
        <form id="authF"><label class="fld"><span>E-Mail</span><input class="field" name="email" type="email" autocomplete="email" required autofocus></label>
        <label class="fld"><span>Passwort</span><input class="field" name="pw" type="password" autocomplete="current-password" minlength="6" required></label>
        <p class="err" id="authErr"></p>
        <div class="acts" style="justify-content:space-between">${cfg.fixed ? '<span></span>' : '<button type="button" class="btn ghost" data-x="reset">Server ändern</button>'}<span><button type="button" class="btn" data-x="0">Abbrechen</button> <button class="btn primary" id="authGo">Anmelden</button></span></div></form>
        <p class="note">Deine lokale Bibliothek wird beim ersten Anmelden in dein Konto übernommen.</p>`;
    }
    await dialog(html, {
      onOpen: (d, close) => {
        d.addEventListener('click', async e => {
          const b = e.target.closest('[data-x]'); if (!b) return;
          if (b.dataset.x === 'now') { SY.syncNow(); close(); toast('Synchronisiere …'); }
          else if (b.dataset.x === 'out') { await SY.signOut(); close(); toast('Abgemeldet. Die Bibliothek bleibt auf diesem Gerät.'); }
          else if (b.dataset.x === 'reset') { try { localStorage.removeItem('pdfwb.sync'); } catch (x) { /* egal */ } close(); location.reload(); }
          else close();
        });
        let mode = 'in';
        $$('[data-tab]', d).forEach(t => { t.onclick = () => { mode = t.dataset.tab; $$('[data-tab]', d).forEach(x => x.setAttribute('aria-selected', String(x === t))); d.querySelector('#authGo').textContent = mode === 'in' ? 'Anmelden' : 'Konto erstellen'; d.querySelector('[name=pw]').autocomplete = mode === 'in' ? 'current-password' : 'new-password'; }; });
        const af = d.querySelector('#authF');
        if (af) af.onsubmit = async e => {
          e.preventDefault(); const fd = new FormData(af), err = d.querySelector('#authErr'), go = d.querySelector('#authGo');
          err.textContent = ''; go.disabled = true;
          try {
            if (mode === 'in') { await SY.signIn(fd.get('email'), fd.get('pw')); close(); toast('Angemeldet · Bibliothek wird abgeglichen'); }
            else { const r = await SY.signUp(fd.get('email'), fd.get('pw')); if (r.confirm) { err.style.color = 'var(--ok)'; err.textContent = 'Fast geschafft: Bitte den Link in der E-Mail bestätigen und dann hier anmelden.'; } else { close(); toast('Konto erstellt · Bibliothek wird abgeglichen'); } }
          } catch (x) { err.style.color = ''; err.textContent = x.message || String(x); }
          go.disabled = false;
        };
        const cf = d.querySelector('#cfgF');
        if (cf) cf.onsubmit = async e => {
          e.preventDefault(); const fd = new FormData(cf), url = String(fd.get('url')).trim(), key = String(fd.get('key')).trim();
          if (!/^https:\/\/.+/.test(url) || key.length < 20) { d.querySelector('#cfgErr').textContent = 'Bitte Project URL (https://…) und anon key eintragen.'; return; }
          await SY.setConfig(url, key); close(); syncDialog();
        };
      },
    });
  }
  function renderSync(I) {
    const b = $('#syncBtn'); if (!b) return;
    const s = I.user ? I.status : (I.configured ? 'signedout' : 'off');
    b.dataset.s = s;
    $('#syncTitle').textContent = I.user ? ({ ok: 'Synchronisiert', syncing: 'Synchronisiere …', error: 'Sync-Fehler', offline: 'Offline', idle: 'Verbunden' }[I.status] || 'Verbunden') : 'Sync aus';
    $('#syncSub').textContent = I.user ? (I.status === 'error' ? I.error : I.user.email) : (I.configured ? 'Anmelden, um Geräte zu verbinden' : 'Webseite und App verbinden');
    $('#syncIco').innerHTML = ico(I.user ? 'cloud' : 'gear');
  }

  /* ---------- Kontextmenü ---------- */
  let menuEl = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  function showMenu(entries, x, y) {
    closeMenu();
    const m = document.createElement('div'); m.className = 'menu'; m.setAttribute('role', 'menu');
    m.innerHTML = entries.map(e => e === '-' ? '<hr>' : e.head ? `<div class="mh">${esc(e.head)}</div>` : `<button role="menuitem" data-k="${e.k}" class="${e.danger ? 'danger' : ''}">${ico(e.i)}${esc(e.l)}</button>`).join('');
    document.body.appendChild(m); menuEl = m;
    const r = m.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
    m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
    const first = m.querySelector('button'); if (first) first.focus();
    return new Promise(res => {
      m.onclick = e => { const b = e.target.closest('[data-k]'); if (!b) return; closeMenu(); res(b.dataset.k); };
      setTimeout(() => document.addEventListener('pointerdown', function h(e) { if (!m.contains(e.target)) { document.removeEventListener('pointerdown', h, true); closeMenu(); res(null); } }, true));
    });
  }
  async function itemMenu(it, ev, anchor) {
    let x = 0, y = 0;
    if (ev && ev.clientX) { x = ev.clientX; y = ev.clientY; } else if (anchor) { const r = anchor.getBoundingClientRect(); x = r.left; y = r.bottom + 4; }
    else { const el = document.querySelector(`[data-id="${CSS.escape(it.id)}"]`); const r = el ? el.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2 }; x = r.left + 20; y = r.top + 20; }
    const isF = it.kind === 'folder', trash = it.trashed;
    const entries = trash
      ? [{ head: it.name }, { k: 'restore', i: 'restore', l: 'Wiederherstellen' }, { k: 'destroy', i: 'trash', l: 'Endgültig löschen', danger: true }]
      : [{ head: it.name },
        { k: 'open', i: 'open', l: 'Öffnen' },
        isF ? { k: 'edit', i: 'palette', l: 'Name, Farbe und Symbol' } : { k: 'rename', i: 'edit', l: 'Umbenennen' },
        { k: 'fav', i: 'star', l: it.fav ? 'Aus Favoriten entfernen' : 'Zu Favoriten' },
        { k: 'move', i: 'move', l: 'Verschieben …' },
        ...(isF ? [{ k: 'sub', i: 'plus', l: 'Unterordner erstellen' }] : [{ k: 'dup', i: 'copy', l: 'Duplizieren' }, { k: 'export', i: 'download', l: 'Als PDF exportieren' }]),
        '-', { k: 'trash', i: 'trash', l: 'Löschen', danger: true }];
    const k = await showMenu(entries, x, y);
    if (!k) return;
    switch (k) {
      case 'open': openItem(it); break;
      case 'edit': folderDialog(it); break;
      case 'rename': { const n = await promptDlg('Umbenennen', 'Name', it.name); if (n) { await ST.update(it.id, { name: n }); await refresh(); } break; }
      case 'fav': await ST.update(it.id, { fav: !it.fav }); await refresh(); break;
      case 'move': moveDialog([it.id]); break;
      case 'sub': folderDialog(null, it.id); break;
      case 'dup': await ST.duplicate(it.id); await refresh(); toast('Dupliziert'); break;
      case 'export': await ST.markOpened(it.id); location.href = 'index.html?doc=' + encodeURIComponent(it.id) + '&export=1'; break;
      case 'trash': await ST.trash([it.id]); await refresh(); toast(`„${it.name}“ in den Papierkorb gelegt`, [it.id]); break;
      case 'restore': await ST.restore([it.id]); await refresh(); toast('Wiederhergestellt'); break;
      case 'destroy': if (await confirmDlg('Endgültig löschen?', `„${it.name}“ wird auf allen Geräten gelöscht.`, 'Löschen', true)) { await ST.destroy([it.id]); await refresh(); } break;
    }
  }
  async function emptyTrash() {
    if (!await confirmDlg('Papierkorb leeren?', 'Alle Elemente im Papierkorb werden auf allen Geräten endgültig gelöscht.', 'Leeren', true)) return;
    const n = await ST.emptyTrash(); await refresh(); toast(n + ' Element(e) gelöscht');
  }

  /* ---------- Meldungen ---------- */
  function toast(msg, undoIds) {
    const t = document.createElement('div'); t.className = 'toast';
    t.innerHTML = esc(msg) + (undoIds ? ' <button class="btn ghost" style="height:26px;color:inherit;margin-left:8px;pointer-events:auto">Rückgängig</button>' : '');
    $('#toasts').appendChild(t);
    if (undoIds) t.querySelector('button').onclick = async () => { await ST.restore(undoIds); t.remove(); await refresh(); };
    setTimeout(() => t.remove(), undoIds ? 6000 : 3200);
  }
  function busy(msg) {
    let b = $('#busy');
    if (!msg) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('div'); b.className = 'busy'; b.id = 'busy'; document.body.appendChild(b); }
    b.innerHTML = `<div>${esc(msg)}</div>`;
  }

  /* ---------- Bedienung ---------- */
  let refreshT = 0;
  async function refresh() { await load(); render(); }
  const refreshSoon = () => { clearTimeout(refreshT); refreshT = setTimeout(refresh, 120); };

  function bind() {
    // Symbole in festen Knöpfen
    $('#addFolderSide').innerHTML = ico('plus'); $('#menuBtn').innerHTML = ico('menu'); $('#searchIco').innerHTML = ico('search');
    $('#vGrid').innerHTML = ico('grid'); $('#vList').innerHTML = ico('list'); $('#selIco').innerHTML = ico('select'); $('#newIco').innerHTML = ico('plus');
    const setLayout = l => { V.layout = l; lsSet('pdfwb.lib.layout', l); $('#vGrid').setAttribute('aria-pressed', String(l === 'grid')); $('#vList').setAttribute('aria-pressed', String(l === 'list')); renderContent(); };
    $('#vGrid').onclick = () => setLayout('grid'); $('#vList').onclick = () => setLayout('list');
    $('#vGrid').setAttribute('aria-pressed', String(V.layout === 'grid')); $('#vList').setAttribute('aria-pressed', String(V.layout === 'list'));
    $('#menuBtn').onclick = () => $('#lib').classList.toggle('drawer');
    $('#lib').addEventListener('click', e => { if (e.target === $('#lib') && $('#lib').classList.contains('drawer')) closeDrawer(); });
    document.addEventListener('pointerdown', e => { if ($('#lib').classList.contains('drawer') && !e.target.closest('.side') && !e.target.closest('#menuBtn')) closeDrawer(); });
    $('#addFolderSide').onclick = () => folderDialog(null, V.view.kind === 'folder' ? V.view.id : null);
    $('#selectBtn').onclick = () => { V.selecting = !V.selecting; V.sel.clear(); renderContent(); };
    $('#newBtn').onclick = async e => {
      const r = e.currentTarget.getBoundingClientRect();
      const k = await showMenu([{ k: 'notebook', i: 'notebook', l: 'Neues Notizbuch' }, { k: 'import', i: 'upload', l: 'PDF importieren …' }, { k: 'folder', i: 'folder', l: 'Neuer Ordner' }], r.right - 230, r.bottom + 6);
      if (k) newAction(k);
    };
    $('#fileIn').onchange = async e => { const f = [...e.target.files]; e.target.value = ''; if (f.length) await importFiles(f); };
    let qT = 0;
    $('#search').addEventListener('input', e => { clearTimeout(qT); qT = setTimeout(() => { V.q = e.target.value.trim(); render(); }, 120); });
    $('#syncBtn').onclick = syncDialog;

    $('#nav').onclick = e => { const b = e.target.closest('[data-nav]'); if (b) go({ kind: b.dataset.nav, id: null }); };
    $('#tree').onclick = e => {
      const tw = e.target.closest('[data-tw]');
      if (tw) { const id = tw.dataset.tw; if (V.open.has(id)) V.open.delete(id); else V.open.add(id); saveOpen(); renderTree(); return; }
      const t = e.target.closest('[data-folder]'); if (t) go({ kind: 'folder', id: t.dataset.folder });
    };
    $('#tree').oncontextmenu = e => { const t = e.target.closest('[data-folder]'); if (!t) return; e.preventDefault(); itemMenu(V.byId.get(t.dataset.folder), e); };
    $('#crumbs').onclick = e => { const b = e.target.closest('[data-go]'); if (b && b !== $('#crumbs').lastElementChild) go({ kind: 'folder', id: b.dataset.go || null }); };

    const content = $('#content');
    content.addEventListener('click', e => {
      const more = e.target.closest('[data-more]');
      if (more) { e.stopPropagation(); itemMenu(V.byId.get(more.dataset.more), null, more); return; }
      const t = e.target.closest('[data-id]'); if (!t) return;
      const it = V.byId.get(t.dataset.id);
      if (V.selecting || e.ctrlKey || e.metaKey || e.shiftKey) { if (!V.selecting) { V.selecting = true; } toggleSel(it.id); return; }
      openItem(it);
    });
    content.addEventListener('keydown', e => {
      const t = e.target.closest('[data-id]'); if (!t) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); t.click(); }
    });
    content.addEventListener('contextmenu', e => { const t = e.target.closest('[data-id]'); if (!t) return; e.preventDefault(); itemMenu(V.byId.get(t.dataset.id), e); });
    // langes Drücken auf Touch-Geräten = Menü
    let lp = null;
    content.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'touch') return;
      const t = e.target.closest('[data-id]'); if (!t || e.target.closest('[data-more]')) return;
      lp = { x: e.clientX, y: e.clientY, t: setTimeout(() => { lp = null; navigator.vibrate && navigator.vibrate(10); itemMenu(V.byId.get(t.dataset.id), { clientX: e.clientX, clientY: e.clientY }); t.addEventListener('click', ev => { ev.stopPropagation(); ev.preventDefault(); }, { capture: true, once: true }); }, 520) };
    });
    const cancelLp = e => { if (lp && (!e || e.type !== 'pointermove' || Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 10)) { clearTimeout(lp.t); lp = null; } };
    content.addEventListener('pointermove', cancelLp); content.addEventListener('pointerup', () => cancelLp()); content.addEventListener('pointercancel', () => cancelLp());

    // Ziehen und Ablegen: Elemente in Ordner, Dateien aus dem System importieren
    let dragIds = null;
    document.addEventListener('dragstart', e => {
      const t = e.target.closest && e.target.closest('[data-id],[data-folder]'); if (!t) return;
      const id = t.dataset.id || t.dataset.folder;
      dragIds = V.sel.has(id) ? [...V.sel] : [id];
      e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-werkbank', dragIds.join(','));
      t.classList.add('dragging');
    });
    document.addEventListener('dragend', () => { dragIds = null; $$('.dragging').forEach(x => x.classList.remove('dragging')); $$('.drop').forEach(x => x.classList.remove('drop')); });
    const isFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    let dzT = 0;
    document.addEventListener('dragover', e => {
      const tgt = e.target.closest && e.target.closest('[data-drop]');
      if (dragIds) {
        $$('.drop').forEach(x => { if (x !== tgt) x.classList.remove('drop'); });
        if (tgt && !dragIds.includes(tgt.dataset.drop)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; tgt.classList.add('drop'); }
        return;
      }
      if (isFiles(e)) { e.preventDefault(); $('#dropzone').hidden = false; clearTimeout(dzT); dzT = setTimeout(() => { $('#dropzone').hidden = true; }, 160); }
    });
    document.addEventListener('drop', async e => {
      const tgt = e.target.closest && e.target.closest('[data-drop]');
      if (dragIds) {
        e.preventDefault();
        if (tgt) { const to = tgt.dataset.drop || null; try { await ST.move(dragIds, to); toast(`Verschoben nach „${to ? V.byId.get(to).name : 'Dokumente'}“`); } catch (x) { toast(x.message); } V.sel.clear(); V.selecting = false; await refresh(); }
        dragIds = null; return;
      }
      if (isFiles(e)) { e.preventDefault(); $('#dropzone').hidden = true; await importFiles(e.dataTransfer.files, tgt ? (tgt.dataset.drop || null) : targetFolder()); }
    });

    // Tastatur
    document.addEventListener('keydown', e => {
      if (e.target.closest('input,textarea,select,.scrim')) { if (e.key === 'Escape' && e.target.id === 'search') { e.target.value = ''; V.q = ''; render(); } return; }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'n' && e.shiftKey) { e.preventDefault(); newAction('folder'); }
      else if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); newAction('notebook'); }
      else if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); newAction('import'); }
      else if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#search').focus(); }
      else if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); V.selecting = true; currentItems().forEach(i => V.sel.add(i.id)); renderContent(); }
      else if (e.key === 'Escape') { if (V.selecting) { V.selecting = false; V.sel.clear(); renderContent(); } closeMenu(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && (V.sel.size || document.activeElement.closest('[data-id]'))) {
        if (e.key === 'Backspace' && !V.sel.size && !e.metaKey) return;
        e.preventDefault();
        const ids = V.sel.size ? [...V.sel] : [document.activeElement.closest('[data-id]').dataset.id];
        if (V.view.kind === 'trash') return;
        ST.trash(ids).then(() => { V.sel.clear(); V.selecting = false; refresh(); toast(ids.length === 1 ? 'In den Papierkorb gelegt' : `${ids.length} Elemente in den Papierkorb gelegt`, ids); });
      } else if (e.key === 'F2') { const t = document.activeElement.closest('[data-id]'); if (t) itemMenu(V.byId.get(t.dataset.id)); }
      else if (e.key === 'Backspace' && V.view.kind === 'folder' && V.view.id) { e.preventDefault(); go({ kind: 'folder', id: (V.byId.get(V.view.id) || {}).parent || null }); }
    });

    // Änderungen aus Editor, anderen Tabs und vom Abgleich
    ST.onChange(refreshSoon);
    if (SY) SY.onStatus(I => { renderSync(I); });

    // Desktop-App: Dateien aus dem System (Doppelklick auf PDF, Menü)
    if (DESK) {
      setTimeout(() => DESK.ready && DESK.ready(), 0);
      DESK.onOpenFiles && DESK.onOpenFiles(async files => {
        const docs = [];
        for (const f of files) docs.push(await importBytes(new Uint8Array(f.bytes), f.name, targetFolder()));
        await refresh();
        if (docs.length === 1) openDoc(docs[0].id); else if (docs.length) toast(`${docs.length} PDFs importiert`);
      });
      DESK.onMenu && DESK.onMenu(k => { if (k === 'new-notebook') newAction('notebook'); else if (k === 'import') newAction('import'); else if (k === 'new-folder') newAction('folder'); else if (k === 'sync') syncDialog(); else if (k === 'find') $('#search').focus(); else if (k === 'library') go({ kind: 'folder', id: null }); });
    }
  }

  async function boot() {
    bind();
    await refresh();
    if (SY) SY.init();
    // erster Start: Willkommensordner nicht nötig, leerer Zustand erklärt alles
    const p = new URLSearchParams(location.search);
    if (p.get('import') === '1') newAction('import');
    if (p.get('new') === 'notebook') newAction('notebook');
    if (p.get('new') || p.get('import')) history.replaceState(null, '', 'library.html');
  }
  boot();
})();
