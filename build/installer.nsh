; PDF Werkbank als PDF-Programm bei Windows anmelden, damit es unter
; Einstellungen › Apps › Standard-Apps auftaucht und als Standard gewählt werden kann.
!macro customInstall
  WriteRegStr SHCTX "Software\PDF Werkbank\Capabilities" "ApplicationName" "PDF Werkbank"
  WriteRegStr SHCTX "Software\PDF Werkbank\Capabilities" "ApplicationDescription" "PDFs lesen, bearbeiten, unterschreiben und mit KI zusammenfassen"
  WriteRegStr SHCTX "Software\PDF Werkbank\Capabilities" "ApplicationIcon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\PDF Werkbank\Capabilities\FileAssociations" ".pdf" "PDFWerkbank.Document"
  WriteRegStr SHCTX "Software\RegisteredApplications" "PDF Werkbank" "Software\PDF Werkbank\Capabilities"
  WriteRegStr SHCTX "Software\Classes\.pdf\OpenWithProgids" "PDFWerkbank.Document" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".pdf" ""
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  DeleteRegValue SHCTX "Software\RegisteredApplications" "PDF Werkbank"
  DeleteRegKey SHCTX "Software\PDF Werkbank\Capabilities"
  DeleteRegValue SHCTX "Software\Classes\.pdf\OpenWithProgids" "PDFWerkbank.Document"
  DeleteRegKey SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
