// Weboberfläche für die Android-App: web/ → mobile/www mit Capacitor-Brücke
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.join(ROOT, 'web'), OUT = path.join(ROOT, 'mobile/www');
if (!fs.existsSync(path.join(SRC, 'index.html'))) { console.error('web/ fehlt – zuerst npm run prepare-web'); process.exit(1); }
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(SRC, OUT, { recursive: true });
fs.copyFileSync(path.join(ROOT, 'mobile/cap-shim.js'), path.join(OUT, 'js/cap-shim.js'));
for (const f of ['index.html', 'library.html']) {
  const p = path.join(OUT, f);
  let s = fs.readFileSync(p, 'utf8');
  if (!s.includes('cap-shim.js')) s = s.replace(/<head>/i, '<head>\n<script src="js/cap-shim.js"></script>');
  fs.writeFileSync(p, s);
}
console.log('Android-Web vorbereitet →', OUT);
