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

**Updates kommen automatisch:** Die App sucht beim Start und alle 4 Stunden nach neuen Versionen, lädt sie im Hintergrund und bietet dann „Jetzt neu starten“ an. Das gilt für Windows und macOS (auf dem Mac muss die App im Programme-Ordner liegen).

## Was die App kann

- **Bibliothek:** Ordner und Unterordner mit Farben und Symbolen, Cover-Vorschauen, Kacheln oder Liste, Suche, Favoriten, Zuletzt geöffnet, Papierkorb, Mehrfachauswahl, Drag & Drop (auch PDFs aus Explorer/Finder ins Fenster)
- **Notizbücher:** blanko, liniert, kariert oder punktiert, mit farbigem Deckblatt
- **Editor:** alles aus der Webversion – Texte ändern, Inhalte verschieben und entfernen, Schwärzen, Stifte mit Druckstärke, Formen, Markieren mit Text, Kommentare, Messen, Formulare, Seiten verwalten, Rechner mit Graphen. Änderungen werden automatisch in der Bibliothek gesichert, „Exportieren“ erzeugt die PDF-Datei.
- **PDFs öffnen** per Doppelklick bzw. „Öffnen mit → PDF Werkbank“: landen in der Bibliothek und gehen direkt auf.
- **Sync:** Mit demselben Konto haben Webseite und App dieselben Ordner, Dokumente und Markierungen, live und auch offline (Abgleich beim nächsten Online-Sein).
- **Google Drive:** automatisches Backup aller Dokumente als PDF in „Meine Ablage › PDF Werkbank“, mit derselben Ordnerstruktur. Einmal im Browser anmelden, danach läuft es im Hintergrund.
- **KI mit ChatGPT-Abo:** Im Editor ✦ → „Mit ChatGPT anmelden“. Die Anmeldung läuft im System-Browser (OpenAI „Sign in with ChatGPT“ für Open-Source- und lokale Apps), danach nutzt der KI-Assistent dein Plus- oder Pro-Abo. Alternativ ein OpenAI- oder Claude-API-Schlüssel; Zugänge liegen verschlüsselt im System-Schlüsselbund.
- Läuft komplett offline, eigene Fensterleiste, heller und dunkler Modus.

## Sync einrichten

Der Abgleich nutzt ein kostenloses [Supabase](https://supabase.com)-Projekt. Die Schritte stehen im [README der Webversion](https://github.com/conlog06/pdf-werkbank#bibliothek-und-sync). Sind die Werte dort in `js/config.js` eingetragen, übernimmt die App sie beim nächsten Build automatisch. Sonst kann man sie in der App unten links unter **Sync** eintragen.

## Google Drive einrichten

Schritte im [README der Webversion](https://github.com/conlog06/pdf-werkbank#google-drive-automatisches-backup). Für die App zusätzlich den Clientschlüssel des Desktop-Clients hier im Repo unter *Settings → Secrets and variables → Actions → New repository secret* als **`GOOGLE_DESKTOP_SECRET`** speichern. Der Build setzt ihn ein.

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

1. In `package.json` die `version` erhöhen (z. B. `1.0.1`).
2. Committen und auf `main` pushen.
3. GitHub Actions baut Windows- und Mac-Installer und legt sie als Release `v1.0.1` ab. Die installierte Windows-App holt sich das Update von selbst.

## Aufbau

| Datei | Inhalt |
|---|---|
| `main.js` | Fenster, eigenes Protokoll `app://werkbank`, Menü, PDF-Dateizuordnung, Updates |
| `preload.js` | Schmale Brücke zur Oberfläche (`window.wbDesktop`) |
| `chatgpt-auth.js` | „Mit ChatGPT anmelden“: Anmeldung im System-Browser (PKCE, Rücksprung auf 127.0.0.1), Token erneuern |
| `scripts/prepare-web.mjs` | Kopiert die Weboberfläche nach `web/`, bindet pdf.js und pdf-lib lokal ein |
| `scripts/adhoc-sign.cjs` | Ad-hoc-Signatur für macOS ohne Apple-Entwicklerkonto |
| `web/` | Erzeugte Weboberfläche (nicht von Hand ändern) |
| `.github/workflows/build.yml` | Baut die Installer für Windows und macOS |
