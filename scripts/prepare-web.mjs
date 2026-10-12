/* Holt die Weboberfläche (Repo conlog06/pdf-werkbank) nach web/ und macht sie offline-fähig:
 * pdf.js und pdf-lib kommen aus node_modules statt vom CDN.
 * Quelle: WEB_SRC, sonst ./web-src (GitHub Actions), sonst ../pdf-werkbank (lokal nebeneinander).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cands = [process.env.WEB_SRC, path.join(ROOT, 'web-src'), path.join(ROOT, '..', 'pdf-werkbank')].filter(Boolean);
const SRC = cands.find(p => fs.existsSync(path.join(p, 'library.html')));
if (!SRC) { console.error('Weboberfläche nicht gefunden. WEB_SRC setzen oder pdf-werkbank daneben klonen.'); process.exit(1); }
const OUT = path.join(ROOT, 'web');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'lib'), { recursive: true });
for (const f of ['index.html', 'library.html', 'manifest.webmanifest']) fs.copyFileSync(path.join(SRC, f), path.join(OUT, f));
for (const d of ['js', 'icons']) fs.cpSync(path.join(SRC, d), path.join(OUT, d), { recursive: true });

const nm = p => path.join(ROOT, 'node_modules', p);
fs.copyFileSync(nm('pdfjs-dist/build/pdf.min.js'), path.join(OUT, 'lib/pdf.min.js'));
fs.copyFileSync(nm('pdfjs-dist/build/pdf.worker.min.js'), path.join(OUT, 'lib/pdf.worker.min.js'));
fs.copyFileSync(nm('pdf-lib/dist/pdf-lib.min.js'), path.join(OUT, 'lib/pdf-lib.min.js'));

const rewrite = s => s
  .replaceAll('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/', 'lib/')
  .replaceAll('https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/', 'lib/');
const files = ['index.html', 'library.html', ...fs.readdirSync(path.join(OUT, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f)];
for (const f of files) {
  const p = path.join(OUT, f);
  fs.writeFileSync(p, rewrite(fs.readFileSync(p, 'utf8')));
}
// Service Worker braucht die App nicht
for (const f of ['index.html', 'library.html']) {
  const p = path.join(OUT, f);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/<script>\s*if \('serviceWorker'[\s\S]*?<\/script>\s*/, ''));
}
const left = files.filter(f => /cdnjs\.cloudflare\.com/.test(fs.readFileSync(path.join(OUT, f), 'utf8')));
if (left.length) { console.error('CDN-Verweise übrig in', left); process.exit(1); }
console.log('Weboberfläche aus', SRC, '→ web/');
