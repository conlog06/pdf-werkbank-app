#!/bin/bash
# Testet in der CI, wie sich eine App unter macOS als Standard für PDFs setzen lässt (ohne Electron-Build).
set -x
APP=/tmp/WBTest.app
mkdir -p $APP/Contents/MacOS
cat > $APP/Contents/Info.plist <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>de.loggx.wbtest</string>
<key>CFBundleName</key><string>WBTest</string>
<key>CFBundleExecutable</key><string>wbtest</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleDocumentTypes</key><array><dict>
  <key>CFBundleTypeName</key><string>PDF-Dokument</string>
  <key>CFBundleTypeRole</key><string>Editor</string>
  <key>LSHandlerRank</key><string>Default</string>
  <key>LSItemContentTypes</key><array><string>com.adobe.pdf</string></array>
  <key>CFBundleTypeExtensions</key><array><string>pdf</string></array>
</dict></array>
</dict></plist>
PL
printf '#!/bin/sh\nsleep 1\n' > $APP/Contents/MacOS/wbtest; chmod +x $APP/Contents/MacOS/wbtest
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f $APP
sw_vers
node -e "const d=require('./default-app'),o={bundleId:'de.loggx.wbtest',appPath:'$APP',openExternal:async()=>{}};(async()=>{console.log('vorher',await d.status(o));console.log('setzen',JSON.stringify(await d.makeDefault(o)));console.log('nachher',await d.status(o))})()"
