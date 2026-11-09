/* Standard-PDF-Programm des Systems abfragen und setzen
 *   macOS:   Launch Services über JavaScript for Automation (osascript), ohne Zusatzprogramme
 *   Windows: Ab Windows 10 dürfen Apps sich nicht selbst als Standard setzen – wir öffnen die
 *            passende Seite der Einstellungen (Windows 11: direkt die Seite von PDF Werkbank).
 * Reines Node, damit es sich in der CI auf echten Macs und Windows-Rechnern testen lässt.
 */
'use strict';
const { execFile } = require('node:child_process');

const PDF_UTI = 'com.adobe.pdf';
const WIN_PROGIDS = ['PDFWerkbank.Document', 'PDF-Dokument'];
const run = (cmd, args, opts = {}) => new Promise(res => execFile(cmd, args, { timeout: 15000, windowsHide: true, ...opts }, (err, out, errOut) => res({ err, out: String(out || ''), errOut: String(errOut || '') })));

/* JXA: LSCopyDefaultRoleHandlerForContentType / LSSetDefaultRoleHandlerForContentType */
const jxa = (bundleId, set) => `
ObjC.import('CoreServices');
ObjC.bindFunction('LSCopyDefaultRoleHandlerForContentType', ['id', ['id', 'unsigned int']]);
ObjC.bindFunction('LSSetDefaultRoleHandlerForContentType', ['int', ['id', 'unsigned int', 'id']]);
var ALL = 0xFFFFFFFF, uti = $('${PDF_UTI}'), status = null;
${set ? `status = $.LSSetDefaultRoleHandlerForContentType(uti, ALL, $('${bundleId}'));` : ''}
var cur = $.LSCopyDefaultRoleHandlerForContentType(uti, ALL);
JSON.stringify({ status: status, current: cur ? ObjC.unwrap(cur) : '' });
`;
async function mac(bundleId, set) {
  const r = await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', jxa(bundleId, set)]);
  if (r.err) throw new Error((r.errOut || r.err.message).trim());
  const j = JSON.parse(r.out.trim().split('\n').pop());
  const current = String(j.current || '');
  return { isDefault: current.toLowerCase() === bundleId.toLowerCase(), current, status: j.status };
}

/* Windows: aktuelle Wahl des Nutzers für .pdf aus der Registry */
async function winCurrent() {
  for (const key of ['UserChoiceLatest', 'UserChoice']) {
    const r = await run('reg', ['query', `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.pdf\\${key}`, '/v', 'ProgId']);
    const m = /ProgId\s+REG_SZ\s+(.+)/i.exec(r.out);
    if (m) return m[1].trim();
  }
  return '';
}
async function status({ bundleId }) {
  if (process.platform === 'darwin') { try { return await mac(bundleId, false); } catch (e) { return { isDefault: false, current: '', error: e.message }; } }
  if (process.platform === 'win32') {
    const current = await winCurrent();
    return { isDefault: WIN_PROGIDS.some(p => p.toLowerCase() === current.toLowerCase()) || /werkbank/i.test(current), current };
  }
  return { isDefault: false, current: '', unsupported: true };
}
async function makeDefault({ bundleId, openExternal }) {
  if (process.platform === 'darwin') {
    const r = await mac(bundleId, true);
    return { ...r, done: r.isDefault, manual: !r.isDefault };
  }
  if (process.platform === 'win32') {
    // Windows 11 (22H2+): Einstellungsseite der App, sonst die allgemeine Standard-Apps-Seite
    try { await openExternal('ms-settings:defaultapps?registeredAppUser=' + encodeURIComponent('PDF Werkbank')); }
    catch (e) { await openExternal('ms-settings:defaultapps'); }
    return { done: false, manual: true, settingsOpened: true };
  }
  return { done: false, unsupported: true };
}
module.exports = { status, makeDefault, PDF_UTI, WIN_PROGIDS };
