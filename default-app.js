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

/* JXA: aktuellen Standard lesen; setzen zuerst über NSWorkspace (macOS 12+), sonst über Launch Services */
const jxa = (bundleId, appPath, set) => `
ObjC.import('CoreServices'); ObjC.import('AppKit');
ObjC.bindFunction('LSCopyDefaultRoleHandlerForContentType', ['id', ['id', 'unsigned int']]);
ObjC.bindFunction('LSSetDefaultRoleHandlerForContentType', ['int', ['id', 'unsigned int', 'id']]);
var ALL = 0xFFFFFFFF, uti = $('${PDF_UTI}'), out = { ws: null, ls: null };
function cur() { var c = $.LSCopyDefaultRoleHandlerForContentType(uti, ALL); return c ? ObjC.unwrap(c) : ''; }
if (${set ? 'true' : 'false'}) {
  try {
    $.NSBundle.bundleWithPath($('/System/Library/Frameworks/UniformTypeIdentifiers.framework')).load;
    var UT = $.NSClassFromString($('UTType'));
    var ws = $.NSWorkspace.sharedWorkspace, t = UT && !UT.isNil() ? UT.typeWithIdentifier(uti) : null;
    var url = ${appPath ? `$.NSURL.fileURLWithPath($(${JSON.stringify(appPath)}))` : `ws.URLForApplicationWithBundleIdentifier($('${bundleId}'))`};
    if (url && t && ws.setDefaultApplicationAtURLToOpenContentTypeCompletionHandler) {
      var done = false;
      ws.setDefaultApplicationAtURLToOpenContentTypeCompletionHandler(url, t, function (err) { out.ws = err && !err.isNil() ? ObjC.unwrap(err.localizedDescription) : 'ok'; done = true; });
      for (var i = 0; i < 80 && !done; i++) $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.1));
      if (!done) out.ws = 'timeout';
    } else out.ws = 'unavailable';
  } catch (e) { out.ws = 'err: ' + e; }
  if (cur().toLowerCase() !== '${bundleId}'.toLowerCase()) out.ls = $.LSSetDefaultRoleHandlerForContentType(uti, ALL, $('${bundleId}'));
}
out.current = cur();
JSON.stringify(out);
`;
async function mac(bundleId, set, appPath) {
  const r = await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', jxa(bundleId, appPath, set)], { timeout: 20000 });
  if (r.err) throw new Error((r.errOut || r.err.message).trim());
  const j = JSON.parse(r.out.trim().split('\n').pop());
  const current = String(j.current || '');
  return { isDefault: current.toLowerCase() === bundleId.toLowerCase(), current, ws: j.ws, ls: j.ls };
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
async function makeDefault({ bundleId, appPath, openExternal }) {
  if (process.platform === 'darwin') {
    const r = await mac(bundleId, true, appPath);
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
