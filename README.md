# PDF Werkbank – Desktop-App

Die [PDF Werkbank](https://github.com/conlog06/pdf-werkbank) als richtige App für **Windows** und **macOS**: Bibliothek mit Ordnern wie bei GoodNotes, kompletter PDF-Editor und Abgleich mit der Webseite.

## Herunterladen

Unter **[Releases](https://github.com/conlog06/pdf-werkbank-app/releases/latest)**:

| System | Datei |
|---|---|
| Windows 10/11 | `PDF-Werkbank-Setup-<version>.exe` |
| Mac mit Apple-Chip (M1–M4) | `PDF-Werkbank-<version>-mac-arm64.dmg` |
| Mac mit Intel | `PDF-Werkbank-<version>-mac-x64.dmg` |

**Erster Start:** Die App ist (noch) nicht von Microsoft bzw. Apple signiert.
- *Windows:* Bei „Der Computer wurde durch Windows geschützt“ auf **Weitere Informationen → Trotzdem ausführen**.
- *macOS:* App in den Programme-Ordner ziehen, dann **Rechtsklick → Öffnen → Öffnen**. Bei neueren macOS-Versionen: *Systemeinstellungen → Datenschutz & Sicherheit → Dennoch öffnen*.

Unter Windows kommen Updates automatisch, auf dem Mac weist die App auf neue Versionen hin.

## Was die App kann

- **Bibliothek:** Ordner und Unterordner mit Farben und Symbolen, Cover-Vorschauen, Kacheln oder Liste, Suche, Favoriten, Zuletzt geöffnet, Papierkorb, Mehrfachauswahl, Drag & Drop (auch PDFs aus Explorer/Finder ins Fenster)
- **Notizbücher:** blanko, liniert, kariert oder punktiert, mit farbigem Deckblatt
- **Editor:** alles aus der Webversion – Texte ändern, Inhalte verschieben und entfernen, Schwärzen, Stifte mit Druckstärke, Formen, Markieren mit Text, Kommentare, Messen, Formulare, Seiten verwalten, Rechner mit Graphen. Änderungen werden automatisch in der Bibliothek gesichert, „Exportieren“ erzeugt die PDF-Datei.
- **PDFs öffnen** per Doppelklick bzw. „Öffnen mit → PDF Werkbank“: landen in der Bibliothek und gehen direkt auf.
- **Sync:** Mit demselben Konto haben Webseite und App dieselben Ordner, Dokumente und Markierungen, live und auch offline (Abgleich beim nächsten Online-Sein).
- Läuft komplett offline, eigene Fensterleiste, heller und dunkler Modus.

## Sync einrichten

Der Abgleich nutzt ein kostenloses [Supabase](https://supabase.com)-Projekt. Die Schritte stehen im [README der Webversion](https://github.com/conlog06/pdf-werkbank#bibliothek-und-sync). Sind die Werte dort in `js/config.js` eingetragen, übernimmt die App sie beim nächsten Build automatisch. Sonst kann man sie in der App unten links unter **Sync** eintragen.

## Entwickeln

```bash
git clone https://github.com/conlog06/pdf-werkbank-app
git clone https://github.com/conlog06/pdf-werkbank     # Weboberfläche daneben
cd pdf-werkbank-app
npm install
npm run prepare-web   # holt die Weboberfläche nach web/ und macht sie offline-fähig
npm start
```

Installer lokal bauen: `npm run dist:win` (unter Windows) bzw. `npm run dist:mac` (auf einem Mac).

## Neue Version veröffentlichen

1. In `package.json` die `version` erhöhen.
2. Commit, dann Tag setzen und pushen: `git tag v1.0.1 && git push --tags`
3. GitHub Actions baut Windows- und Mac-Installer und legt sie als Release ab. Ohne Tag (Actions → *Desktop-Apps bauen* → *Run workflow*) landen die Installer nur als Artefakte am Lauf.

## Aufbau

| Datei | Inhalt |
|---|---|
| `main.js` | Fenster, eigenes Protokoll `app://werkbank`, Menü, PDF-Dateizuordnung, Updates |
| `preload.js` | Schmale Brücke zur Oberfläche (`window.wbDesktop`) |
| `scripts/prepare-web.mjs` | Kopiert die Weboberfläche nach `web/`, bindet pdf.js und pdf-lib lokal ein |
| `scripts/adhoc-sign.cjs` | Ad-hoc-Signatur für macOS ohne Apple-Entwicklerkonto |
| `web/` | Erzeugte Weboberfläche (nicht von Hand ändern) |
| `.github/workflows/build.yml` | Baut die Installer für Windows und macOS |
