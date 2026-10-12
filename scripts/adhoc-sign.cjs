/* macOS: App ohne Apple-Entwicklerkonto ad-hoc signieren.
 * Sonst meldet macOS auf Apple-Silicon-Macs „beschädigt“; so reicht beim ersten Start „Trotzdem öffnen“. */
const { execFileSync } = require('node:child_process');
const path = require('node:path');
exports.default = async function (ctx) {
  if (ctx.electronPlatformName !== 'darwin') return;
  const app = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
};
