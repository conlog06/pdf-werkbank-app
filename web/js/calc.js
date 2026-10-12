/* PDF Werkbank – Rechner
 * Formeln mit Funktionen, Variablen und eigenen Funktionen, Gleichungen lösen,
 * Graphen mit Nullstellen und Extrempunkten, Handschrifterkennung für Ziffern
 * und Rechenzeichen ($P-Punktwolken-Erkenner). Deutsche Schreibweise mit Dezimalkomma.
 */
(function (global) {
'use strict';

/* ---------- Zahlen ---------- */
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const sup = n => String(n).split('').map(c => SUP[c] || c).join('');
function trimNum(s) { return s.includes('e') ? s : s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''); }
function fmt(v, digits = 12) {
  if (typeof v === 'boolean') return v ? 'wahr' : 'falsch';
  if (Number.isNaN(v)) return 'nicht definiert';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '−∞';
  if (Math.abs(v) < 1e-13) v = 0;
  const a = Math.abs(v);
  let s;
  if (a !== 0 && (a >= 1e12 || a < 1e-6)) {
    let e = Math.floor(Math.log10(a)), m = v / 10 ** e;
    if (Math.abs(m) >= 9.9999999999) { m /= 10; e += 1; }
    s = trimNum(m.toPrecision(Math.min(digits, 10))) + ' · 10' + sup(e);
  } else s = trimNum(String(+v.toPrecision(digits)));
  return s.replace('.', ',').replace(/^-/, '−');
}
/* Bruch erkennen (Kettenbruch), z. B. 0,3333… → 1/3 */
function asFraction(v) {
  if (!Number.isFinite(v) || Number.isInteger(v) || Math.abs(v) > 1e6) return null;
  let h1 = 1, h2 = 0, k1 = 0, k2 = 1, b = v;
  for (let i = 0; i < 25; i++) {
    const a = Math.floor(b), h = a * h1 + h2, k = a * k1 + k2;
    if (k > 1000) break;
    if (Math.abs(v - h / k) < 1e-10 * Math.max(1, Math.abs(v))) return k === 1 ? null : `${h}/${k}`.replace('-', '−');
    h2 = h1; h1 = h; k2 = k1; k1 = k;
    if (b - a < 1e-12) break;
    b = 1 / (b - a);
  }
  return null;
}

/* ---------- Zerlegen ---------- */
function normalize(src) {
  return src
    .replace(/[×·∙⋅]/g, '*').replace(/[÷:]/g, '/').replace(/[−–—]/g, '-')
    .replace(/√/g, 'sqrt').replace(/∛/g, 'cbrt').replace(/π/g, 'pi').replace(/∞/g, 'inf')
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, m => '^(' + m.split('').map(c => '0123456789-'['⁰¹²³⁴⁵⁶⁷⁸⁹⁻'.indexOf(c)]).join('') + ')')
    .replace(/\*\*/g, '^');
}
function tokenize(src) {
  const s = normalize(src), out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      const st = i;
      while (i < s.length && /[0-9.]/.test(s[i])) i++;
      if (/[eE]/.test(s[i]) && /[-+0-9]/.test(s[i + 1] || '') && (/[0-9]/.test(s[i + 1]) || /[0-9]/.test(s[i + 2] || ''))) { i += 2; while (i < s.length && /[0-9]/.test(s[i])) i++; }
      const raw = s.slice(st, i);
      if ((raw.match(/\./g) || []).length > 1 || raw === '.') throw new Error(`Zahl „${raw}“ ist ungültig`);
      out.push({ t: 'num', v: parseFloat(raw), raw, pos: st, end: i });
      continue;
    }
    if (/[A-Za-zÄÖÜäöüß_]/.test(c)) {
      const st = i;
      while (i < s.length && /[A-Za-zÄÖÜäöüß_0-9]/.test(s[i])) i++;
      out.push({ t: 'name', v: s.slice(st, i), pos: st, end: i });
      continue;
    }
    if ('+-*/^!%(),;=|'.includes(c)) { out.push({ t: c, pos: i, end: i + 1 }); i++; continue; }
    if ('[{'.includes(c)) { out.push({ t: '(', pos: i, end: i + 1 }); i++; continue; }
    if (']}'.includes(c)) { out.push({ t: ')', pos: i, end: i + 1 }); i++; continue; }
    throw new Error(`Zeichen „${c}“ wird nicht verstanden`);
  }
  // Dezimalkomma: „3,5“ ohne Leerzeichen und außerhalb von Funktionsargumenten
  const merged = [];
  let fnDepth = [];
  for (let k = 0; k < out.length; k++) {
    const tk = out[k], prev = merged[merged.length - 1];
    if (tk.t === '(') fnDepth.push(prev && prev.t === 'name' && FUNCS[prev.v.toLowerCase()] !== undefined || (prev && prev.t === 'name' && USERFN_HINT(prev.v)));
    if (tk.t === ')') fnDepth.pop();
    const inFn = fnDepth.length && fnDepth[fnDepth.length - 1];
    if (tk.t === ',' && prev && prev.t === 'num' && !prev.raw.includes('.') && prev.end === tk.pos && out[k + 1] && out[k + 1].t === 'num' && out[k + 1].pos === tk.end && !inFn) {
      const n = out[k + 1], raw = prev.raw + '.' + n.raw;
      merged[merged.length - 1] = { t: 'num', v: parseFloat(raw), raw, pos: prev.pos, end: n.end };
      k++;
      continue;
    }
    merged.push(tk);
  }
  return merged;
}
let USERFN_HINT = () => false;

/* ---------- Funktionen ---------- */
const fact = n => {
  if (n < 0 && Number.isInteger(n)) return NaN;
  if (Number.isInteger(n) && n <= 170) { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }
  return gamma(n + 1);
};
function gamma(z) {
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  z -= 1; let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return Math.sqrt(2 * Math.PI) * t ** (z + 0.5) * Math.exp(-t) * x;
}
const gcd = (a, b) => { a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b)); while (b) [a, b] = [b, a % b]; return a; };
const nCr = (n, k) => { if (k < 0 || k > n) return 0; k = Math.min(k, n - k); let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return Math.round(r); };
// Arität: Zahl = genau so viele, [min, max]
const FUNCS = {
  sin: [1, (x, E) => Math.sin(E.toRad(x))], cos: [1, (x, E) => Math.cos(E.toRad(x))], tan: [1, (x, E) => Math.tan(E.toRad(x))],
  cot: [1, (x, E) => 1 / Math.tan(E.toRad(x))], sec: [1, (x, E) => 1 / Math.cos(E.toRad(x))], csc: [1, (x, E) => 1 / Math.sin(E.toRad(x))],
  asin: [1, (x, E) => E.fromRad(Math.asin(x))], acos: [1, (x, E) => E.fromRad(Math.acos(x))], atan: [1, (x, E) => E.fromRad(Math.atan(x))],
  arcsin: [1, (x, E) => E.fromRad(Math.asin(x))], arccos: [1, (x, E) => E.fromRad(Math.acos(x))], arctan: [1, (x, E) => E.fromRad(Math.atan(x))],
  atan2: [2, (y, x, E) => E.fromRad(Math.atan2(y, x))],
  sinh: [1, Math.sinh], cosh: [1, Math.cosh], tanh: [1, Math.tanh], asinh: [1, Math.asinh], acosh: [1, Math.acosh], atanh: [1, Math.atanh],
  sqrt: [1, Math.sqrt], wurzel: [1, Math.sqrt], cbrt: [1, Math.cbrt],
  root: [2, (x, n) => (x < 0 && n % 2 === 1 ? -Math.pow(-x, 1 / n) : Math.pow(x, 1 / n))],
  exp: [1, Math.exp], ln: [1, Math.log], lg: [1, Math.log10], log10: [1, Math.log10], log2: [1, Math.log2],
  log: [[1, 2], (x, b) => (b === undefined ? Math.log10(x) : Math.log(x) / Math.log(b))],
  abs: [1, Math.abs], betrag: [1, Math.abs], sign: [1, Math.sign], sgn: [1, Math.sign],
  floor: [1, Math.floor], ceil: [1, Math.ceil], trunc: [1, Math.trunc],
  round: [[1, 2], (x, n = 0) => Math.round(x * 10 ** n) / 10 ** n],
  min: [[1, 99], Math.min], max: [[1, 99], Math.max],
  mean: [[1, 99], (...a) => a.reduce((s, v) => s + v, 0) / a.length], avg: [[1, 99], (...a) => a.reduce((s, v) => s + v, 0) / a.length],
  mod: [2, (a, b) => ((a % b) + b) % b], gcd: [[2, 99], (...a) => a.reduce(gcd)], ggt: [[2, 99], (...a) => a.reduce(gcd)],
  lcm: [[2, 99], (...a) => a.reduce((x, y) => Math.abs(x * y) / gcd(x, y))], kgv: [[2, 99], (...a) => a.reduce((x, y) => Math.abs(x * y) / gcd(x, y))],
  fact: [1, fact], gamma: [1, gamma], ncr: [2, nCr], npr: [2, (n, k) => nCr(n, k) * fact(k)], binom: [2, nCr],
  hypot: [[1, 99], Math.hypot], deg: [1, x => x * 180 / Math.PI], rad: [1, x => x * Math.PI / 180],
  // Sonderformen mit Ausdruck als erstem Argument
  int: [[3, 3], null], integral: [[3, 3], null], diff: [[2, 2], null], ableitung: [[2, 2], null], sum: [[3, 3], null], prod: [[3, 3], null],
};
const CONSTS = { pi: Math.PI, e: Math.E, phi: (1 + Math.sqrt(5)) / 2, tau: 2 * Math.PI, inf: Infinity };
const NEEDS_ANGLE = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'asin', 'acos', 'atan', 'arcsin', 'arccos', 'arctan', 'atan2']);
const BOUND = { int: ['x', 't', 'u'], integral: ['x', 't', 'u'], diff: ['x', 't', 'u'], ableitung: ['x', 't', 'u'], sum: ['n', 'k', 'i', 'x'], prod: ['n', 'k', 'i', 'x'] };

/* ---------- Parser ---------- */
function parse(src) {
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i], next = () => toks[i++];
  const expect = t => { const k = next(); if (!k || k.t !== t) throw new Error(t === ')' ? 'Klammer „)“ fehlt' : `„${t}“ erwartet`); return k; };
  const startsPrimary = k => k && (k.t === 'num' || k.t === 'name' || k.t === '(' || (k.t === '|' && !absOpen));
  let absOpen = 0;
  function expr() {
    let a = term();
    while (peek() && (peek().t === '+' || peek().t === '-')) { const op = next().t; a = { t: 'bin', op, a, b: term() }; }
    return a;
  }
  function term() {
    let a = unary();
    for (;;) {
      const k = peek();
      if (k && (k.t === '*' || k.t === '/')) { next(); a = { t: 'bin', op: k.t, a, b: unary() }; }
      else if (startsPrimary(k)) a = { t: 'bin', op: '*', a, b: power() }; // 2x, 2(3+1), 2pi
      else return a;
    }
  }
  function unary() {
    const k = peek();
    if (k && (k.t === '-' || k.t === '+')) { next(); const a = unary(); return k.t === '-' ? { t: 'neg', a } : a; }
    return power();
  }
  function power() {
    const base = postfix();
    if (peek() && peek().t === '^') { next(); return { t: 'bin', op: '^', a: base, b: unary() }; }
    return base;
  }
  function postfix() {
    let a = primary();
    for (;;) {
      const k = peek();
      if (k && k.t === '!') { next(); a = { t: 'call', n: 'fact', args: [a] }; }
      else if (k && k.t === '%' ) { next(); a = { t: 'bin', op: '/', a, b: { t: 'num', v: 100 } }; }
      else return a;
    }
  }
  function args() {
    const list = [];
    if (peek() && peek().t === ')') { next(); return list; }
    for (;;) {
      list.push(expr());
      const k = next();
      if (!k) throw new Error('Klammer „)“ fehlt');
      if (k.t === ')') return list;
      if (k.t !== ',' && k.t !== ';') throw new Error('„,“ oder „)“ erwartet');
    }
  }
  function primary() {
    const k = next();
    if (!k) throw new Error('Ausdruck ist unvollständig');
    if (k.t === 'num') return { t: 'num', v: k.v, raw: k.raw, pos: k.pos, end: k.end };
    if (k.t === '(') { const e = expr(); expect(')'); return e; }
    if (k.t === '|') { absOpen++; const e = expr(); absOpen--; expect('|'); return { t: 'call', n: 'abs', args: [e] }; }
    if (k.t === 'name') {
      const n = k.v;
      if (peek() && peek().t === '(') { next(); return fixDecimal({ t: 'call', n, args: args() }); }
      const fn = FUNCS[n.toLowerCase()];
      if (fn && fn[1] && fn[0] === 1 && startsPrimary(peek())) return { t: 'call', n, args: [power()] }; // sin x, sqrt 2
      // „sinx“, „sqrt2“ als Funktion plus Argument lesen
      const m = /^([a-z]+?)(\d+|x|pi)$/i.exec(n);
      if (m && FUNCS[m[1].toLowerCase()] && FUNCS[m[1].toLowerCase()][0] === 1) {
        const arg = /^\d+$/.test(m[2]) ? { t: 'num', v: +m[2] } : { t: 'var', n: m[2] };
        return { t: 'call', n: m[1], args: [arg] };
      }
      return { t: 'var', n };
    }
    throw new Error(k.t === ')' ? 'Klammer „(“ fehlt' : `„${k.t}“ an dieser Stelle nicht möglich`);
  }
  // sin(0,5) → sin(0.5): zwei direkt durch Komma verbundene Zahlen bei einstelligen Funktionen
  function fixDecimal(c) {
    const f = FUNCS[c.n.toLowerCase()];
    if (f && f[0] === 1 && c.args.length === 2 && c.args[0].t === 'num' && c.args[1].t === 'num' && c.args[0].raw && c.args[1].raw && c.args[0].end + 1 === c.args[1].pos) {
      return { t: 'call', n: c.n, args: [{ t: 'num', v: parseFloat(c.args[0].raw + '.' + c.args[1].raw) }] };
    }
    return c;
  }
  const lhs = expr();
  let node = lhs;
  if (peek() && peek().t === '=') { next(); node = { t: 'eq', l: lhs, r: expr() }; }
  if (peek()) throw new Error(`„${src.slice(peek().pos, peek().pos + 8)}“ wird nicht verstanden`);
  return node;
}
function freeVars(n, acc = new Set()) {
  if (!n) return acc;
  if (n.t === 'var') acc.add(n.n);
  if (n.a) freeVars(n.a, acc);
  if (n.b) freeVars(n.b, acc);
  if (n.l) freeVars(n.l, acc);
  if (n.r) freeVars(n.r, acc);
  if (n.args) {
    const bound = n.t === 'call' && BOUND[n.n.toLowerCase()];
    n.args.forEach((a, k) => {
      if (bound && k === 0) { const inner = freeVars(a), v = bound.find(b => inner.has(b)) || bound[0]; inner.delete(v); inner.forEach(x => acc.add(x)); }
      else freeVars(a, acc);
    });
  }
  return acc;
}

/* ---------- Auswerten ---------- */
function makeEnv(state) {
  return {
    deg: !!state.deg, vars: state.vars, funcs: state.funcs,
    toRad(x) { return this.deg ? x * Math.PI / 180 : x; }, fromRad(x) { return this.deg ? x * 180 / Math.PI : x; },
  };
}
function evaluate(n, E, scope) {
  switch (n.t) {
    case 'num': return n.v;
    case 'neg': return -evaluate(n.a, E, scope);
    case 'var': {
      if (scope && n.n in scope) return scope[n.n];
      if (E.vars.has(n.n)) return E.vars.get(n.n);
      const c = CONSTS[n.n.toLowerCase()];
      if (c !== undefined && !(n.n === 'e' && scope && 'e' in scope)) return c;
      throw new Error(`„${n.n}“ ist nicht festgelegt`);
    }
    case 'bin': {
      const a = evaluate(n.a, E, scope), b = evaluate(n.b, E, scope);
      switch (n.op) { case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return a / b; case '^': return powr(a, b); }
      break;
    }
    case 'call': {
      const name = n.n, lname = name.toLowerCase();
      if (E.funcs.has(name)) {
        const f = E.funcs.get(name);
        if (n.args.length !== f.params.length) throw new Error(`${name} erwartet ${f.params.length} Wert${f.params.length === 1 ? '' : 'e'}`);
        const sc = { ...(scope || {}) };
        f.params.forEach((p, k) => { sc[p] = evaluate(n.args[k], E, scope); });
        if ((E.depth = (E.depth || 0) + 1) > 200) { E.depth = 0; throw new Error('Funktion ruft sich endlos selbst auf'); }
        try { return evaluate(f.body, E, sc); } finally { E.depth--; }
      }
      const f = FUNCS[lname];
      // a(x+1) mit einer Variablen a ist eine Multiplikation
      if (!f && n.args.length === 1 && ((scope && name in scope) || E.vars.has(name) || CONSTS[lname] !== undefined)) {
        return evaluate({ t: 'var', n: name }, E, scope) * evaluate(n.args[0], E, scope);
      }
      if (!f) throw new Error(`Funktion „${name}“ ist unbekannt`);
      const [ar, fn] = f, [lo, hi] = Array.isArray(ar) ? ar : [ar, ar];
      if (n.args.length < lo || n.args.length > hi) throw new Error(`${name} erwartet ${lo === hi ? lo : lo + ' bis ' + hi} Wert${hi === 1 ? '' : 'e'}`);
      if (!fn) return special(lname, n.args, E, scope);
      const vals = n.args.map(a => evaluate(a, E, scope));
      return NEEDS_ANGLE.has(lname) ? fn(...vals, E) : fn(...vals);
    }
    case 'eq': throw new Error('Gleichung bitte allein in eine Zeile schreiben');
  }
  throw new Error('Ausdruck ist unvollständig');
}
function powr(a, b) {
  if (a < 0 && !Number.isInteger(b)) { // ungerade Wurzeln negativer Zahlen
    const inv = 1 / b, r = Math.round(inv);
    if (Math.abs(inv - r) < 1e-9 && r % 2 === 1) return -Math.pow(-a, b);
  }
  return Math.pow(a, b);
}
function pickVar(node, prefs) { const fv = freeVars(node); return prefs.find(v => fv.has(v)) || prefs[0]; }
function special(name, args, E, scope) {
  const body = args[0];
  if (name === 'int' || name === 'integral') {
    const v = pickVar(body, ['x', 't', 'u']), a = evaluate(args[1], E, scope), b = evaluate(args[2], E, scope);
    const f = x => evaluate(body, E, { ...(scope || {}), [v]: x });
    return simpson(f, a, b);
  }
  if (name === 'diff' || name === 'ableitung') {
    const v = pickVar(body, ['x', 't', 'u']), x0 = evaluate(args[1], E, scope), h = 1e-5 * Math.max(1, Math.abs(x0));
    const f = x => evaluate(body, E, { ...(scope || {}), [v]: x });
    return (f(x0 - 2 * h) - 8 * f(x0 - h) + 8 * f(x0 + h) - f(x0 + 2 * h)) / (12 * h);
  }
  if (name === 'sum' || name === 'prod') {
    const v = pickVar(body, ['n', 'k', 'i', 'x']), a = Math.round(evaluate(args[1], E, scope)), b = Math.round(evaluate(args[2], E, scope));
    if (b - a > 1e6) throw new Error('Zu viele Summanden');
    let r = name === 'sum' ? 0 : 1;
    for (let k = a; k <= b; k++) { const t = evaluate(body, E, { ...(scope || {}), [v]: k }); r = name === 'sum' ? r + t : r * t; }
    return r;
  }
  throw new Error('Unbekannte Sonderfunktion');
}
function simpson(f, a, b) {
  if (a === b) return 0;
  if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error('Grenzen müssen endlich sein');
  const rec = (a, b, fa, fm, fb, whole, eps, depth) => {
    const m = (a + b) / 2, lm = (a + m) / 2, rm = (m + b) / 2, flm = f(lm), frm = f(rm);
    const left = (m - a) / 6 * (fa + 4 * flm + fm), right = (b - m) / 6 * (fm + 4 * frm + fb);
    if (depth <= 0 || Math.abs(left + right - whole) <= 15 * eps) return left + right + (left + right - whole) / 15;
    return rec(a, m, fa, flm, fm, left, eps / 2, depth - 1) + rec(m, b, fm, frm, fb, right, eps / 2, depth - 1);
  };
  const fa = f(a), fb = f(b), fm = f((a + b) / 2);
  return rec(a, b, fa, fm, fb, (b - a) / 6 * (fa + 4 * fm + fb), 1e-10, 40);
}
/* Nullstellen von f in [a, b]: Vorzeichenwechsel plus Berührpunkte */
function roots(f, a, b, steps = 2000) {
  const out = [], h = (b - a) / steps;
  let x0 = a, y0 = safe(f, x0);
  for (let k = 1; k <= steps; k++) {
    const x1 = a + k * h, y1 = safe(f, x1);
    if (Number.isFinite(y0) && Number.isFinite(y1)) {
      if (y0 === 0) out.push(x0);
      else if (y0 * y1 < 0) {
        let lo = x0, hi = x1, flo = y0;
        for (let it = 0; it < 80; it++) { const m = (lo + hi) / 2, fm = safe(f, m); if (!Number.isFinite(fm)) break; if (flo * fm <= 0) hi = m; else { lo = m; flo = fm; } }
        const r = (lo + hi) / 2, fr = safe(f, r);
        if (Number.isFinite(fr) && Math.abs(fr) < 1e-6 * Math.max(1, Math.abs(y0), Math.abs(y1))) out.push(r); // keine Polstellen
      } else if (k > 1) {
        const ym = safe(f, x0 - h);
        if (Number.isFinite(ym) && Math.abs(y0) < Math.abs(ym) && Math.abs(y0) < Math.abs(y1) && Math.abs(y0) < 1e-3) {
          // Berührpunkt verfeinern (Minimum von |f|)
          let lo = x0 - h, hi = x1;
          for (let it = 0; it < 80; it++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (Math.abs(safe(f, m1)) < Math.abs(safe(f, m2))) hi = m2; else lo = m1; }
          const r = (lo + hi) / 2;
          if (Math.abs(safe(f, r)) < 1e-9) out.push(r);
        }
      }
    }
    x0 = x1; y0 = y1;
  }
  const uniq = [];
  for (const r of out.sort((p, q) => p - q)) if (!uniq.length || Math.abs(r - uniq[uniq.length - 1]) > 1e-6 * Math.max(1, Math.abs(r))) uniq.push(Math.abs(r) < 1e-12 ? 0 : r);
  return uniq;
}
function safe(f, x) { try { const y = f(x); return typeof y === 'number' ? y : NaN; } catch (e) { return NaN; } }
function extrema(f, a, b, steps = 800) {
  const h = (b - a) / steps, out = [];
  let x0 = a, y0 = safe(f, a), x1 = a + h, y1 = safe(f, x1);
  for (let k = 2; k <= steps; k++) {
    const x2 = a + k * h, y2 = safe(f, x2);
    if ([y0, y1, y2].every(Number.isFinite)) {
      const isMax = y1 > y0 && y1 >= y2, isMin = y1 < y0 && y1 <= y2;
      if (isMax || isMin) {
        let lo = x0, hi = x2;
        for (let it = 0; it < 60; it++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3, f1 = safe(f, m1), f2 = safe(f, m2); if (isMax ? f1 < f2 : f1 > f2) lo = m1; else hi = m2; }
        const x = (lo + hi) / 2, y = safe(f, x);
        if (Number.isFinite(y) && Math.abs(y - y1) < Math.abs(y1 - y0) + Math.abs(y2 - y1) + 1e-9) out.push({ x, y, max: isMax });
      }
    }
    x0 = x1; y0 = y1; x1 = x2; y1 = y2;
  }
  return out;
}

/* ---------- Anweisungen (eine Zeile) ---------- */
const PLOT_COLORS = ['#1f4fd8', '#d0342c', '#1e8a4c', '#e07b00', '#7a3fd0', '#0f8b8d'];
function runLine(line, state, commit) {
  const src = line.trim().replace(/=\s*\??$/, '').trim(); // „1+2=“ wie am Taschenrechner
  if (!src) return null;
  USERFN_HINT = n => state.funcs.has(n);
  const E = makeEnv(state);
  const node = parse(src);
  const fv = freeVars(node);
  const xFree = v => !state.vars.has(v) && !CONSTS[v.toLowerCase()];
  // Definitionen: a = 5 · f(x) = x^2 · y = 2x + 1
  if (node.t === 'eq') {
    const l = node.l;
    if (l.t === 'call' && l.args.length && l.args.every(a => a.t === 'var') && !FUNCS[l.n.toLowerCase()]) {
      const params = l.args.map(a => a.n), fn = { params, body: node.r, src };
      if (commit) state.funcs.set(l.n, fn);
      const plot = params.length === 1 ? makePlot(l.n, x => evaluate(node.r, E, { [params[0]]: x }), src) : null;
      return { kind: 'def', text: `${l.n}(${params.join('; ')}) festgelegt`, plot };
    }
    if (l.t === 'var' && (l.n === 'y' || l.n === 'f') && freeVars(node.r).has('x')) {
      return { kind: 'plot', text: 'Graph', plot: makePlot(l.n, x => evaluate(node.r, E, { x }), src) };
    }
    if (l.t === 'var' && !freeVars(node.r).has(l.n) && l.n !== 'x' && !(freeVars(node.r).has('x') && xFree('x'))) {
      const v = evaluate(node.r, E);
      if (commit) state.vars.set(l.n, v);
      return { kind: 'assign', value: v, text: `${l.n} = ${fmt(v)}` };
    }
    // Gleichung lösen: Variable ist die einzige freie Unbekannte
    const unknown = [...fv].filter(xFree).filter(v => !state.funcs.has(v));
    if (unknown.length === 0) {
      const a = evaluate(node.l, E), b = evaluate(node.r, E);
      return { kind: 'bool', value: Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)), text: Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)) ? 'wahr' : `falsch (${fmt(a)} ≠ ${fmt(b)})` };
    }
    if (unknown.length > 1) throw new Error(`Mehrere Unbekannte (${unknown.join(', ')}). Bitte Werte festlegen, z. B. ${unknown[1]} = 2`);
    const v = unknown[0], g = t => evaluate(node.l, E, { [v]: t }) - evaluate(node.r, E, { [v]: t });
    let rs = roots(g, -100, 100, 4000);
    if (!rs.length) rs = roots(g, -1e5, 1e5, 20000);
    if (!rs.length) return { kind: 'solve', text: 'keine reelle Lösung gefunden', sols: [] };
    rs = rs.slice(0, 8);
    const exact = r => Math.abs(r - Math.round(r)) < 1e-9 ? fmt(Math.round(r)) : fmt(r, 10);
    const sub = k => (rs.length > 1 ? String(k + 1).split('').map(d => '₀₁₂₃₄₅₆₇₈₉'[d]).join('') : '');
    return { kind: 'solve', sols: rs, var: v, text: rs.map((r, k) => `${v}${sub(k)} ${Math.abs(r - Math.round(r)) < 1e-9 ? '=' : '≈'} ${exact(r)}`).join(';  ') };
  }
  // Ausdruck mit freiem x → Funktion zeichnen
  if (fv.has('x') && xFree('x')) {
    return { kind: 'plot', text: 'Graph', plot: makePlot('', x => evaluate(node, E, { x }), src) };
  }
  const v = evaluate(node, E);
  if (commit) state.vars.set('ans', v);
  const fr = asFraction(v);
  return { kind: 'value', value: v, text: fmt(v) + (fr ? `  (${fr})` : '') };
}
function makePlot(name, f, src) { return { name, f, src }; }
function runAll(text, state, commit) {
  const lines = text.split(/\n|;(?![^(]*\))/).map(s => s.trim()).filter(Boolean);
  const res = [];
  for (const ln of lines) {
    try { res.push({ src: ln, ...runLine(ln, state, commit) }); }
    catch (e) { res.push({ src: ln, kind: 'error', text: e.message }); }
  }
  return res;
}

/* ---------- Graph ---------- */
function niceStep(range, target) {
  const raw = range / target, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
}
class Graph {
  constructor(canvas, info) {
    this.c = canvas; this.info = info; this.plots = []; this.view = { x0: -10, x1: 10, y0: -6, y1: 6 }; this.auto = true; this.trace = null;
    this.ptrs = new Map();
    canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); this.ptrs.set(e.pointerId, [e.offsetX, e.offsetY]); this.last = this.mid(); this.dist = this.spread(); });
    canvas.addEventListener('pointermove', e => {
      if (!this.ptrs.has(e.pointerId)) { this.trace = [e.offsetX, e.offsetY]; this.draw(); return; }
      this.ptrs.set(e.pointerId, [e.offsetX, e.offsetY]);
      const m = this.mid(), d = this.spread(), v = this.view, W = canvas.clientWidth, H = canvas.clientHeight;
      const dx = (m[0] - this.last[0]) / W * (v.x1 - v.x0), dy = (m[1] - this.last[1]) / H * (v.y1 - v.y0);
      v.x0 -= dx; v.x1 -= dx; v.y0 += dy; v.y1 += dy;
      if (this.ptrs.size === 2 && this.dist > 10 && d > 10) this.zoomAt(m, this.dist / d);
      this.last = m; this.dist = d; this.auto = false; this.trace = this.ptrs.size === 1 ? m : null;
      this.draw();
    });
    const up = e => { this.ptrs.delete(e.pointerId); this.last = this.mid(); this.dist = this.spread(); };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', () => { if (!this.ptrs.size) { this.trace = null; this.draw(); } });
    canvas.addEventListener('wheel', e => { e.preventDefault(); this.auto = false; this.zoomAt([e.offsetX, e.offsetY], Math.exp(e.deltaY * 0.0015)); this.draw(); }, { passive: false });
  }
  mid() { const p = [...this.ptrs.values()]; if (!p.length) return [0, 0]; return [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length]; }
  spread() { const p = [...this.ptrs.values()]; return p.length === 2 ? Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]) : 0; }
  zoomAt([px, py], k) {
    const v = this.view, W = this.c.clientWidth, H = this.c.clientHeight;
    const gx = v.x0 + px / W * (v.x1 - v.x0), gy = v.y1 - py / H * (v.y1 - v.y0);
    v.x0 = gx + (v.x0 - gx) * k; v.x1 = gx + (v.x1 - gx) * k; v.y0 = gy + (v.y0 - gy) * k; v.y1 = gy + (v.y1 - gy) * k;
  }
  setPlots(plots) {
    const sig = plots.map(p => p.src).join('|');
    this.plots = plots.map((p, k) => ({ ...p, color: PLOT_COLORS[k % PLOT_COLORS.length] }));
    if (this.auto || sig !== this.sig) { if (sig !== this.sig) this.auto = true; this.fit(); }
    this.sig = sig;
    this.draw();
  }
  reset() { this.view = { x0: -10, x1: 10, y0: -6, y1: 6 }; this.auto = true; this.fit(); this.draw(); }
  fit() {
    if (!this.auto || !this.plots.length) return;
    const v = this.view, ys = [];
    // Ausschnitt auf die interessanten Stellen legen (Nullstellen, Hoch-/Tiefpunkte)
    v.x0 = -10; v.x1 = 10;
    const xs = [];
    for (const p of this.plots) {
      for (const r of roots(p.f, -10, 10).slice(0, 20)) xs.push(r);
      for (const m of extrema(p.f, -10, 10).slice(0, 20)) xs.push(m.x);
    }
    if (xs.length && xs.length < 30) {
      const a = Math.min(...xs), b = Math.max(...xs), half = Math.max((b - a) * 0.8, 3);
      if (2 * half < 16) { const c = (a + b) / 2; v.x0 = c - half; v.x1 = c + half; }
    }
    for (const p of this.plots) for (let k = 0; k <= 400; k++) { const y = safe(p.f, v.x0 + (v.x1 - v.x0) * k / 400); if (Number.isFinite(y)) ys.push(y); }
    if (!ys.length) return;
    ys.sort((a, b) => a - b);
    let lo = ys[Math.floor(ys.length * 0.04)], hi = ys[Math.ceil(ys.length * 0.96) - 1];
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.15;
    v.y0 = Math.min(lo - pad, -0.5); v.y1 = Math.max(hi + pad, 0.5);
  }
  colors(light) {
    if (light) return { bg: '#ffffff', ink: '#1b2130', grid: '#e4e7ee', axis: '#5a6374' };
    const cs = getComputedStyle(this.c);
    return { bg: cs.getPropertyValue('--raise').trim() || '#fff', ink: cs.getPropertyValue('--ink').trim() || '#1b2130', grid: cs.getPropertyValue('--line').trim() || '#e4e7ee', axis: cs.getPropertyValue('--muted').trim() || '#5a6374' };
  }
  draw(target, light) {
    const c = target || this.c, W = target ? c.width / 3 : c.clientWidth, H = target ? c.height / 3 : c.clientHeight;
    if (!W || !H) return;
    const dpr = target ? 3 : Math.min(window.devicePixelRatio || 1, 2);
    if (!target) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const ctx = c.getContext('2d'), col = this.colors(light), v = this.view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = col.bg; ctx.fillRect(0, 0, W, H);
    const X = x => (x - v.x0) / (v.x1 - v.x0) * W, Y = y => H - (y - v.y0) / (v.y1 - v.y0) * H;
    // Raster und Achsen
    const sx = niceStep(v.x1 - v.x0, W / 70), sy = niceStep(v.y1 - v.y0, H / 45);
    ctx.lineWidth = 1; ctx.strokeStyle = col.grid; ctx.beginPath();
    for (let x = Math.ceil(v.x0 / sx) * sx; x <= v.x1; x += sx) { ctx.moveTo(Math.round(X(x)) + 0.5, 0); ctx.lineTo(Math.round(X(x)) + 0.5, H); }
    for (let y = Math.ceil(v.y0 / sy) * sy; y <= v.y1; y += sy) { ctx.moveTo(0, Math.round(Y(y)) + 0.5); ctx.lineTo(W, Math.round(Y(y)) + 0.5); }
    ctx.stroke();
    ctx.strokeStyle = col.axis; ctx.beginPath();
    const ax = clampN(X(0), 0, W), ay = clampN(Y(0), 0, H);
    ctx.moveTo(Math.round(ax) + 0.5, 0); ctx.lineTo(Math.round(ax) + 0.5, H); ctx.moveTo(0, Math.round(ay) + 0.5); ctx.lineTo(W, Math.round(ay) + 0.5); ctx.stroke();
    ctx.fillStyle = col.axis; ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let x = Math.ceil(v.x0 / sx) * sx; x <= v.x1; x += sx) if (Math.abs(x) > sx / 2) ctx.fillText(fmtTick(x, sx), X(x), clampN(ay + 3, 2, H - 13));
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let y = Math.ceil(v.y0 / sy) * sy; y <= v.y1; y += sy) if (Math.abs(y) > sy / 2) ctx.fillText(fmtTick(y, sy), clampN(ax - 4, 30, W - 3), Y(y));
    // Funktionen
    const info = [];
    for (const p of this.plots) {
      ctx.strokeStyle = p.color; ctx.lineWidth = 2; ctx.beginPath();
      let pen = false, prevY = null;
      const n = Math.ceil(W * 2);
      for (let k = 0; k <= n; k++) {
        const x = v.x0 + (v.x1 - v.x0) * k / n, y = safe(p.f, x);
        if (!Number.isFinite(y) || Math.abs(Y(y)) > H * 20) { pen = false; prevY = null; continue; }
        const py = Y(y);
        if (pen && prevY !== null && Math.abs(py - prevY) > H * 1.5) pen = false; // Polstelle
        if (pen) ctx.lineTo(X(x), py); else { ctx.moveTo(X(x), py); pen = true; }
        prevY = py;
      }
      ctx.stroke();
      // Nullstellen und Extrempunkte im sichtbaren Bereich
      // winzige Rundungsreste (z. B. 1e-8 statt 0) relativ zum Ausschnitt glätten
      const tidy = (q, span) => (Math.abs(q) < span * 1e-6 ? 0 : q);
      const zs = roots(p.f, v.x0, v.x1, 1200).slice(0, 12).map(z => tidy(z, v.x1 - v.x0));
      const ex = extrema(p.f, v.x0, v.x1).slice(0, 12).map(m => ({ ...m, x: tidy(m.x, v.x1 - v.x0), y: tidy(m.y, v.y1 - v.y0) }));
      ctx.fillStyle = p.color;
      for (const z of zs) { ctx.beginPath(); ctx.arc(X(z), Y(0), 3.5, 0, Math.PI * 2); ctx.fill(); }
      for (const m of ex) { ctx.beginPath(); ctx.arc(X(m.x), Y(m.y), 3, 0, Math.PI * 2); ctx.strokeStyle = p.color; ctx.lineWidth = 1.5; ctx.stroke(); }
      info.push({ p, zs, ex });
    }
    // Spur unter Zeiger oder Finger
    if (this.trace && !target && this.plots.length) {
      const x = v.x0 + this.trace[0] / W * (v.x1 - v.x0);
      ctx.strokeStyle = col.axis; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(this.trace[0], 0); ctx.lineTo(this.trace[0], H); ctx.stroke(); ctx.setLineDash([]);
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace';
      let ty = 16;
      for (const p of this.plots) {
        const y = safe(p.f, x); if (!Number.isFinite(y)) continue;
        ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(this.trace[0], Y(y), 4, 0, Math.PI * 2); ctx.fill();
        const label = `x = ${fmt(x, 4)}  y = ${fmt(y, 5)}`, tw = ctx.measureText(label).width, tx = clampN(this.trace[0] + 8, 4, W - tw - 8);
        ctx.fillStyle = col.bg; ctx.globalAlpha = 0.85; ctx.fillRect(tx - 3, ty - 13, tw + 6, 15); ctx.globalAlpha = 1;
        ctx.fillStyle = p.color; ctx.fillText(label, tx, ty); ty += 16;
      }
    }
    if (!target && this.info) {
      this.info.innerHTML = info.map(({ p, zs, ex }) => {
        const name = p.name ? `${p.name}(x)` : 'f(x)';
        const parts = [];
        if (zs.length) parts.push('Nullstellen ' + zs.map(z => fmt(z, 5)).join('; '));
        if (ex.length) parts.push(ex.map(m => `${m.max ? 'Hochpunkt' : 'Tiefpunkt'} (${fmt(m.x, 4)} | ${fmt(m.y, 4)})`).join(' · '));
        return `<div><span class="gdot" style="background:${p.color}"></span><b>${escHtml(name)}</b> ${parts.length ? escHtml(parts.join(' · ')) : '<span class="gmuted">keine Nullstellen im Ausschnitt</span>'}</div>`;
      }).join('');
    }
  }
  toPNG(w = 600, h = 400) {
    const c = document.createElement('canvas'); c.width = w * 3; c.height = h * 3;
    const save = this.trace; this.trace = null;
    this.draw(c, true);
    this.trace = save;
    // Legende
    const ctx = c.getContext('2d'); ctx.setTransform(3, 0, 0, 3, 0, 0);
    ctx.font = '12px Helvetica, Arial, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    this.plots.forEach((p, k) => {
      const t = p.src.length > 48 ? p.src.slice(0, 47) + '…' : p.src;
      ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(8, 8 + k * 18, ctx.measureText(t).width + 24, 16);
      ctx.fillStyle = p.color; ctx.fillRect(12, 13 + k * 18, 10, 3); ctx.fillText(t, 27, 9 + k * 18);
    });
    ctx.strokeStyle = '#c9ced8'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    return { url: c.toDataURL('image/png'), w: c.width, h: c.height };
  }
}
const clampN = (v, a, b) => Math.min(b, Math.max(a, v));
function fmtTick(v, step) { const d = Math.max(0, -Math.floor(Math.log10(step))); return (Math.abs(v) < step / 1e6 ? 0 : v).toFixed(Math.min(d, 6)).replace('.', ',').replace('-', '−'); }
const escHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- Handschrift: $P-Erkenner (Vatavu, Anthony, Wobbrock) ---------- */
const NPTS = 32;
function resample(strokes, n) {
  const pts = strokes.flatMap((s, id) => s.map(p => ({ x: p[0], y: p[1], id })));
  let len = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i].id === pts[i - 1].id) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  const I = len / (n - 1) || 1, out = [pts[0]];
  let D = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].id !== pts[i - 1].id) continue;
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (D + d >= I && d > 0) {
      const t = (I - D) / d, q = { x: pts[i - 1].x + t * (pts[i].x - pts[i - 1].x), y: pts[i - 1].y + t * (pts[i].y - pts[i - 1].y), id: pts[i].id };
      out.push(q); pts.splice(i, 0, q); D = 0;
    } else D += d;
  }
  while (out.length < n) out.push({ ...pts[pts.length - 1] });
  return out.slice(0, n);
}
function normalizeCloud(strokes) {
  let pts = resample(strokes.filter(s => s.length), NPTS);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const s = Math.max(x1 - x0, y1 - y0) || 1;
  pts = pts.map(p => ({ x: (p.x - x0) / s, y: (p.y - y0) / s, id: p.id }));
  const cx = pts.reduce((a, p) => a + p.x, 0) / NPTS, cy = pts.reduce((a, p) => a + p.y, 0) / NPTS;
  return pts.map(p => ({ x: p.x - cx, y: p.y - cy, id: p.id }));
}
function cloudDist(a, b, start) {
  const matched = new Array(NPTS).fill(false);
  let sum = 0, i = start;
  do {
    let idx = -1, min = Infinity;
    for (let j = 0; j < NPTS; j++) if (!matched[j]) { const d = (a[i].x - b[j].x) ** 2 + (a[i].y - b[j].y) ** 2; if (d < min) { min = d; idx = j; } }
    matched[idx] = true;
    const w = 1 - ((i - start + NPTS) % NPTS) / NPTS;
    sum += w * Math.sqrt(min);
    i = (i + 1) % NPTS;
  } while (i !== start);
  return sum;
}
function greedy(a, b) {
  const step = Math.floor(Math.pow(NPTS, 0.5));
  let min = Infinity;
  for (let i = 0; i < NPTS; i += step) min = Math.min(min, cloudDist(a, b, i), cloudDist(b, a, i));
  return min;
}
/* Vorlagen im Feld 0–100 (y nach unten), mehrere Schreibweisen je Zeichen */
const L = (...p) => { const o = []; for (let i = 0; i < p.length; i += 2) o.push([p[i], p[i + 1]]); return o; };
const arc = (cx, cy, rx, ry, a0, a1, n = 14) => { const o = []; for (let k = 0; k <= n; k++) { const a = (a0 + (a1 - a0) * k / n) * Math.PI / 180; o.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); } return o; };
const TEMPLATES = [
  ['0', [arc(50, 50, 30, 50, -90, 270, 24)]],
  ['0', [arc(50, 50, 38, 50, -90, 270, 24)]],
  ['1', [L(50, 0, 50, 100)]],
  ['1', [L(28, 22, 52, 0, 52, 100)]],
  ['1', [L(30, 20, 50, 0, 50, 100), L(30, 100, 70, 100)]],
  ['2', [[...arc(50, 28, 34, 28, 200, 360, 10), ...L(80, 40, 10, 100, 92, 100)]]],
  ['2', [L(12, 22, 30, 4, 58, 0, 80, 12, 82, 34, 62, 60, 12, 100, 90, 100)]],
  ['3', [[...arc(48, 25, 34, 25, 210, 450, 12), ...arc(48, 74, 38, 26, 270, 500, 12)]]],
  ['3', [L(12, 6, 82, 4, 42, 44, 70, 50, 86, 70, 76, 92, 48, 100, 12, 90)]],
  ['4', [L(62, 0, 6, 66, 92, 66), L(72, 30, 72, 100)]],
  ['4', [L(22, 0, 14, 58, 88, 58), L(70, 0, 70, 100)]],
  ['4', [L(70, 100, 70, 0, 8, 68, 92, 68)]],
  ['5', [[...L(84, 2, 22, 2, 18, 44), ...arc(48, 68, 38, 32, 250, 480, 12)]]],
  ['5', [[...L(22, 2, 18, 44), ...arc(48, 68, 38, 32, 250, 480, 12)], L(22, 2, 84, 2)]],
  ['6', [[...L(78, 4, 52, 0, 28, 14, 14, 44), ...arc(48, 70, 36, 30, 180, 540, 18)]]],
  ['6', [[...arc(80, 50, 66, 50, 270, 180, 10), ...arc(48, 72, 34, 28, 180, 520, 16)]]],
  ['7', [L(8, 2, 92, 2, 38, 100)]],
  ['7', [L(8, 2, 92, 2, 40, 100), L(30, 52, 76, 52)]],
  ['8', [[...arc(50, 25, 28, 25, 0, -360, 16).map(p => p), ...arc(50, 74, 34, 26, -90, 270, 16)]]],
  ['8', [L(78, 12, 50, 0, 22, 12, 24, 34, 76, 66, 80, 88, 50, 100, 20, 88, 24, 66, 76, 34, 78, 12)]],
  ['9', [[...arc(48, 30, 34, 30, 0, -360, 18), ...L(82, 30, 80, 64, 66, 100)]]],
  ['9', [[...arc(48, 30, 34, 30, 0, -360, 18), ...L(82, 30, 82, 100)]]],
  ['+', [L(50, 0, 50, 100), L(0, 50, 100, 50)]],
  ['+', [L(0, 50, 100, 50), L(50, 0, 50, 100)]],
  ['*', [L(0, 0, 100, 100), L(100, 0, 0, 100)]],
  ['/', [L(100, 0, 0, 100)]],
  ['(', [arc(100, 50, 70, 50, 240, 120, 12)]],
  ['(', [L(70, 0, 40, 30, 32, 50, 40, 70, 70, 100)]],
  [')', [arc(0, 50, 70, 50, -60, 60, 12)]],
  [')', [L(30, 0, 60, 30, 68, 50, 60, 70, 30, 100)]],
  ['pi', [L(0, 12, 100, 4), L(30, 8, 26, 100), L(70, 8, 74, 100)]],
  ['x', [arc(-10, 50, 50, 50, -60, 60, 10), arc(110, 50, 50, 50, 240, 120, 10)]],
].map(([sym, strokes]) => ({ sym, pts: normalizeCloud(strokes) }));

function bboxOf(strokes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) for (const [x, y] of s) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}
const straightness = s => { const b = bboxOf([s]); let len = 0; for (let i = 1; i < s.length; i++) len += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]); return Math.hypot(s[s.length - 1][0] - s[0][0], s[s.length - 1][1] - s[0][1]) / (len || 1) + 0 * b.w; };
function classifyGroup(g, ref) {
  const b = g.b, strokes = g.strokes, H = ref.h;
  const small = Math.max(b.w, b.h) < H * 0.22;
  if (small) return b.cy > ref.base - H * 0.35 ? (b.h > b.w * 2.2 && b.y1 > ref.base + H * 0.15 ? ',' : '.') : '*';
  const flat = b.h < Math.max(b.w * 0.35, H * 0.12);
  if (flat && strokes.length === 1 && straightness(strokes[0]) > 0.85) return '-';
  // ein gerader Strich: steil = 1, deutlich schräg nach links unten = Bruchstrich
  if (strokes.length === 1 && straightness(strokes[0]) > 0.94) {
    const s = strokes[0], top = s[0][1] < s[s.length - 1][1] ? s[0] : s[s.length - 1], bot = top === s[0] ? s[s.length - 1] : s[0];
    const ang = Math.atan2(Math.abs(bot[0] - top[0]), Math.abs(bot[1] - top[1])) * 180 / Math.PI;
    if (ang > 20 && bot[0] < top[0]) return '/';
    if (ang < 14) return '1';
  }
  if (strokes.length === 2 && strokes.every(s => { const sb = bboxOf([s]); return sb.h < Math.max(sb.w * 0.4, H * 0.12); })) {
    const [s1, s2] = strokes.map(s => bboxOf([s]));
    if (Math.abs(s1.cy - s2.cy) > H * 0.08) return '=';
  }
  if (strokes.length === 3) {
    const bs = strokes.map(s => bboxOf([s])).sort((p, q) => p.cy - q.cy);
    if (Math.max(bs[0].w, bs[0].h) < H * 0.25 && Math.max(bs[2].w, bs[2].h) < H * 0.25 && bs[1].h < bs[1].w * 0.4) return '/';
  }
  const cloud = normalizeCloud(strokes);
  let best = null, bd = Infinity;
  for (const t of TEMPLATES) { const d = greedy(cloud, t.pts); if (d < bd) { bd = d; best = t.sym; } }
  // schmale senkrechte Striche sind Einsen, sehr schmale Bögen Klammern
  if ((best === '(' || best === ')') && strokes.length === 1 && straightness(strokes[0]) > 0.97) return '1';
  return best;
}
/* Striche in Zeichen gruppieren und erkennen; Hochzahlen, Brüche und Wurzeln */
function recognize(strokes) {
  strokes = strokes.filter(s => s.length > 0);
  if (!strokes.length) return '';
  const sb = strokes.map(s => ({ s, b: bboxOf([s]) }));
  const hs = sb.map(o => o.b.h).filter(h => h > 2).sort((a, b) => a - b);
  const H = Math.max(hs[Math.floor(hs.length / 2)] || 20, 12);
  const widths = sb.map(o => o.b.w).sort((a, b) => a - b), medW = widths[Math.floor(widths.length / 2)] || H;
  // breite Striche (Bruchstriche, Wurzeln) getrennt behandeln
  const spanning = sb.filter(o => o.b.w > Math.max(2.4 * H, 3 * medW) && sb.length > 2);
  const rest = sb.filter(o => !spanning.includes(o));
  return recognizeLine(rest, spanning, H);
}
function groupStrokes(items, H) {
  // Punkte auf der Grundlinie (Dezimalpunkt) bleiben eigene Zeichen, auch wenn sie den Nachbarn berühren
  const bigs = items.filter(o => Math.max(o.b.w, o.b.h) >= H * 0.22).map(o => o.b.y1).sort((a, b) => a - b);
  const baseApprox = bigs.length ? bigs[Math.floor(bigs.length / 2)] : Infinity;
  const isDot = o => Math.max(o.b.w, o.b.h) < H * 0.22 && o.b.cy > baseApprox - H * 0.15;
  const sorted = items.slice().sort((a, b) => a.b.x0 - b.b.x0), groups = [];
  for (const o of sorted) {
    if (isDot(o)) { groups.push({ strokes: [o.s], b: o.b, dot: true }); continue; }
    const g = [...groups].reverse().find(x => !x.dot);
    if (g && g === groups[groups.length - 1] || (g && groups[groups.length - 1].dot && g.b.x1 > o.b.x0)) {
      const ov = Math.min(g.b.x1, o.b.x1) - Math.max(g.b.x0, o.b.x0), mw = Math.max(Math.min(g.b.w, o.b.w), 1);
      // Mitte des neuen Strichs liegt im inneren Bereich des Zeichens (z. B. senkrechter Strich im +)
      const inner = (a, b) => b.cx > a.x0 + a.w * 0.15 && b.cx < a.x1 - a.w * 0.15 && a.w > H * 0.2;
      if ((ov > -H * 0.04 && ov / mw > 0.3) || inner(g.b, o.b) || inner(o.b, g.b)) { g.strokes.push(o.s); g.b = bboxOf(g.strokes); continue; }
      // Punkt über/unter Strich (÷) oder i-Punkt
      if (Math.max(o.b.w, o.b.h) < H * 0.25 && o.b.cx > g.b.x0 && o.b.cx < g.b.x1) { g.strokes.push(o.s); g.b = bboxOf(g.strokes); continue; }
    }
    groups.push({ strokes: [o.s], b: o.b });
  }
  const key = g => (g.dot ? g.b.cx : g.b.x0 + g.b.w * 0.25);
  return groups.sort((a, b) => key(a) - key(b));
}
function recognizeLine(items, spanning, H) {
  if (!items.length && !spanning.length) return '';
  // Brüche: Gruppen über und unter einem waagerechten breiten Strich
  for (const sp of spanning) {
    const st = straightness(sp.s), flat = sp.b.h < sp.b.w * 0.25;
    if (st > 0.85 && flat) {
      const inX = o => o.b.cx > sp.b.x0 - H * 0.2 && o.b.cx < sp.b.x1 + H * 0.2;
      const above = items.filter(o => inX(o) && o.b.cy < sp.b.cy), below = items.filter(o => inX(o) && o.b.cy > sp.b.cy);
      if (above.length && below.length) {
        const others = items.filter(o => !above.includes(o) && !below.includes(o));
        const left = others.filter(o => o.b.cx < sp.b.x0), right = others.filter(o => o.b.cx > sp.b.x1);
        const rest = spanning.filter(s => s !== sp);
        const frac = `(${recognizeLine(above, [], H)})/(${recognizeLine(below, [], H)})`;
        return recognizeLine(left, rest.filter(s => s.b.cx < sp.b.x0), H) + frac + recognizeLine(right, rest.filter(s => s.b.cx > sp.b.x1), H);
      }
    }
    if (st <= 0.85) {
      // Wurzel: Haken links, Dach über den folgenden Zeichen
      const under = items.filter(o => o.b.cx > sp.b.x0 + H * 0.3 && o.b.cx < sp.b.x1 + H * 0.1 && o.b.cy > sp.b.y0);
      if (under.length) {
        const left = items.filter(o => o.b.cx <= sp.b.x0 + H * 0.3), right = items.filter(o => !under.includes(o) && !left.includes(o));
        const rest = spanning.filter(s => s !== sp);
        return recognizeLine(left, [], H) + `sqrt(${recognizeLine(under, [], H)})` + recognizeLine(right, rest, H);
      }
    }
  }
  if (spanning.length) items = items.concat(spanning); // nicht zuordenbar: wie normale Zeichen behandeln
  const groups = groupStrokes(items, H);
  if (!groups.length) return '';
  const base = Math.max(...groups.map(g => g.b.y1).sort((a, b) => a - b).slice(0, Math.ceil(groups.length / 2) + 1));
  const ref = { h: H, base };
  let out = '', supOpen = false, prev = null;
  for (const g of groups) {
    let sym = classifyGroup(g, ref);
    // Hochzahl: deutlich kleiner und angehoben gegenüber dem vorherigen Zeichen
    const raised = prev && !['.', ',', '-', '='].includes(sym) && g.b.y1 < prev.b.y0 + prev.b.h * 0.55 && g.b.h < prev.b.h * 0.8;
    if (raised && !supOpen) { out += '^('; supOpen = true; }
    else if (!raised && supOpen) { out += ')'; supOpen = false; }
    // x zwischen Zahlen ist ein Malzeichen
    if (sym === 'x' || sym === '*') sym = 'x';
    out += sym;
    if (!raised) prev = g;
  }
  if (supOpen) out += ')';
  return out.replace(/(\d|\))x(?=[\d(])/g, '$1*').replace(/pi/g, 'π').replace(/\^\((\d)\)/g, '^$1');
}

/* ---------- Oberfläche ---------- */
function createCalculator(root, hooks) {
  const $ = s => root.querySelector(s);
  const state = { deg: false, vars: new Map(), funcs: new Map() };
  let history = [];
  try {
    const saved = JSON.parse(localStorage.getItem('pdfwb.calc') || 'null');
    if (saved) {
      state.deg = !!saved.deg; history = saved.history || [];
      for (const [k, v] of saved.vars || []) state.vars.set(k, v);
      for (const src of saved.funcs || []) try { runLine(src, state, true); } catch (e) { /* alte Definition */ }
    }
  } catch (e) { /* kein Speicher */ }
  const save = () => { try { localStorage.setItem('pdfwb.calc', JSON.stringify({ deg: state.deg, history: history.slice(-60), vars: [...state.vars], funcs: [...state.funcs.values()].map(f => f.src) })); } catch (e) { /* egal */ } };
  const input = $('#calcIn'), out = $('#calcOut'), hist = $('#calcHist'), gwrap = $('#calcGraphWrap');
  const graph = new Graph($('#calcGraph'), $('#calcGInfo'));
  let pinned = []; // gespeicherte Graphen aus dem Verlauf
  const angBtns = root.querySelectorAll('[data-ang]');
  const syncAng = () => angBtns.forEach(b => b.setAttribute('aria-pressed', String((b.dataset.ang === 'deg') === state.deg)));
  syncAng();
  angBtns.forEach(b => b.addEventListener('click', () => { state.deg = b.dataset.ang === 'deg'; syncAng(); save(); preview(); }));

  function renderHist() {
    hist.innerHTML = history.length ? history.map((h, i) => `<button class="ch" data-h="${i}"><span class="cs">${escHtml(h.src)}</span><span class="cr${h.kind === 'error' ? ' err' : ''}">${h.kind === 'plot' || h.kind === 'def' ? '📈 ' : h.kind === 'error' ? '' : '= '}${escHtml(h.text)}</span></button>`).join('')
      : '<p class="chint">Beispiele: <code>2·sin(30)+√2</code> · <code>f(x)=x²−2</code> · <code>2x+3=7</code> · <code>int(x^2;0;3)</code></p>';
    hist.scrollTop = hist.scrollHeight;
  }
  function plotsNow(res) {
    const live = (res || []).filter(r => r.plot).map(r => r.plot);
    return pinned.concat(live.filter(l => !pinned.some(p => p.src === l.src)));
  }
  let lastRes = [];
  function preview() {
    const text = input.value;
    const tmp = { deg: state.deg, vars: new Map(state.vars), funcs: new Map(state.funcs) };
    lastRes = text.trim() ? runAll(text, tmp, true) : [];
    out.innerHTML = lastRes.map(r => `<div class="${r.kind === 'error' ? 'err' : ''}">${r.kind === 'value' || r.kind === 'assign' ? '= ' : ''}${escHtml(r.text || '')}</div>`).join('');
    const plots = plotsNow(lastRes);
    gwrap.hidden = !plots.length;
    if (plots.length) graph.setPlots(plots);
  }
  function commit() {
    const text = input.value.trim(); if (!text) return;
    const res = runAll(text, state, true);
    for (const r of res) {
      history.push({ src: r.src, text: r.text, kind: r.kind });
      if (r.plot && !pinned.some(p => p.src === r.plot.src)) pinned.push(r.plot);
    }
    renderHist(); save();
    input.value = ''; lastRes = res; out.innerHTML = '';
    const plots = plotsNow([]);
    gwrap.hidden = !plots.length;
    if (plots.length) graph.setPlots(plots);
  }
  input.addEventListener('input', preview);
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
    if (e.key === 'Escape') hooks.close();
  });
  hist.addEventListener('click', e => {
    const b = e.target.closest('[data-h]'); if (!b) return;
    input.value = history[+b.dataset.h].src; preview(); input.focus();
  });
  const insertAtCursor = s => {
    const a = input.selectionStart ?? input.value.length, b = input.selectionEnd ?? input.value.length;
    input.value = input.value.slice(0, a) + s + input.value.slice(b);
    const pos = a + s.length - (s.endsWith('()') ? 1 : 0);
    input.setSelectionRange(pos, pos);
    preview();
  };
  $('#calcKeys').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const k = b.dataset.k;
    if (k === 'ok') commit();
    else if (k === 'clr') { input.value = ''; preview(); }
    else if (k === 'bs') { const a = input.selectionStart, z = input.selectionEnd; if (a !== z) input.value = input.value.slice(0, a) + input.value.slice(z); else if (a > 0) { input.value = input.value.slice(0, a - 1) + input.value.slice(a); input.setSelectionRange(a - 1, a - 1); } preview(); }
    else insertAtCursor(k);
    if (!matchMedia('(any-pointer: coarse)').matches) input.focus();
  });
  $('#calcClearHist').addEventListener('click', () => { history = []; pinned = []; state.vars.clear(); state.funcs.clear(); renderHist(); save(); preview(); });
  $('#calcGReset').addEventListener('click', () => graph.reset());
  $('#calcGInsert').addEventListener('click', () => { const g = graph.toPNG(); hooks.insertImage(g.url, g.w, g.h); });
  $('#calcInsert').addEventListener('click', () => {
    const res = lastRes.length ? lastRes : [];
    let lines = res.filter(r => r.kind !== 'error' && !r.plot).map(r => `${r.src}${r.kind === 'solve' ? ':  ' : '  '}${r.kind === 'value' ? '= ' : r.kind === 'assign' ? '' : ''}${r.kind === 'assign' ? '' : r.text}`.trim());
    if (!lines.length) { const h = history.filter(x => x.kind !== 'error' && x.kind !== 'plot' && x.kind !== 'def').slice(-1)[0]; if (h) lines = [`${h.src}  ${h.kind === 'value' ? '= ' : ''}${h.kind === 'assign' ? '' : h.text}`]; }
    if (!lines.length) { hooks.toast('Erst eine Rechnung eingeben.'); return; }
    hooks.insertText(lines.join('\n'));
  });
  // Schreibfeld
  const pad = $('#calcPadCanvas'), padWrap = $('#calcPad');
  let strokes = [], cur = null, recT = 0;
  const padCtx = () => pad.getContext('2d');
  function padSize() { const r = pad.getBoundingClientRect(); pad.width = Math.round(r.width * 2); pad.height = Math.round(r.height * 2); redrawPad(); }
  function redrawPad() {
    const ctx = padCtx(), cs = getComputedStyle(pad);
    ctx.setTransform(2, 0, 0, 2, 0, 0); ctx.clearRect(0, 0, pad.width, pad.height);
    ctx.strokeStyle = cs.getPropertyValue('--ink').trim() || '#1b2130'; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const s of strokes.concat(cur ? [cur] : [])) { ctx.beginPath(); s.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); if (s.length === 1) ctx.lineTo(s[0][0] + 0.1, s[0][1]); ctx.stroke(); }
  }
  pad.addEventListener('pointerdown', e => { e.preventDefault(); pad.setPointerCapture(e.pointerId); clearTimeout(recT); cur = [[e.offsetX, e.offsetY]]; redrawPad(); });
  pad.addEventListener('pointermove', e => {
    if (!cur) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ce of evs.length ? evs : [e]) cur.push([ce.offsetX, ce.offsetY]);
    redrawPad();
  });
  const endStroke = () => {
    if (!cur) return;
    strokes.push(cur); cur = null; redrawPad();
    clearTimeout(recT);
    recT = setTimeout(() => {
      const txt = recognize(strokes);
      if (txt) { insertAtCursor(txt); $('#calcPadGuess').textContent = `Erkannt: ${txt}`; }
      strokes = []; redrawPad();
    }, 900);
  };
  pad.addEventListener('pointerup', endStroke); pad.addEventListener('pointercancel', endStroke);
  $('#calcPadClear').addEventListener('click', () => { strokes = []; cur = null; clearTimeout(recT); redrawPad(); });
  $('#calcWrite').addEventListener('click', () => {
    padWrap.hidden = !padWrap.hidden;
    $('#calcWrite').setAttribute('aria-pressed', String(!padWrap.hidden));
    if (!padWrap.hidden) requestAnimationFrame(padSize);
  });
  renderHist();
  return {
    open() { renderHist(); preview(); if (!matchMedia('(any-pointer: coarse)').matches) input.focus(); if (!padWrap.hidden) requestAnimationFrame(padSize); const plots = plotsNow(lastRes); gwrap.hidden = !plots.length; if (plots.length) requestAnimationFrame(() => graph.setPlots(plots)); },
    redraw() { if (!gwrap.hidden) graph.draw(); },
  };
}

global.WBCalc = { tokenize, parse, runLine, runAll, fmt, roots, recognize, createCalculator, _templates: TEMPLATES, _normalizeCloud: normalizeCloud };
})(typeof window !== 'undefined' ? window : globalThis);
