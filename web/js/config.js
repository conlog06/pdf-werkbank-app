/* Cloud-Abgleich (Supabase). Einmal eintragen, dann nutzen Webseite und Desktop-App dieselben Daten.
 * Werte stehen im Supabase-Dashboard unter Project Settings → API:
 *   supabaseUrl  = „Project URL“
 *   supabaseKey  = „anon public“ Schlüssel (darf öffentlich sein, die Daten schützt die Zeilen-Sicherheit)
 * Leer lassen: dann kann man die Werte in der App unter „Sync“ eintragen. */
/* Google Drive (automatisches Backup): Client-IDs aus der Google Cloud Console, siehe README „Google Drive“.
 *   googleClientId         = OAuth-Client vom Typ „Webanwendung“ (für die Webseite)
 *   googleDesktopClientId  = OAuth-Client vom Typ „Desktop-App“ (für die Desktop-App)
 * Den Clientschlüssel der Desktop-App nicht hier eintragen, sondern als GitHub-Secret GOOGLE_DESKTOP_SECRET
 * im Repo pdf-werkbank-app hinterlegen; er wird beim Bauen der App eingesetzt. */
window.WB_CONFIG = {
  supabaseUrl: 'https://yhvvoqqcelkadvfdkblx.supabase.co',
  supabaseKey: 'sb_publishable_rK6cdlgv40IMEr5CUf1HTQ_P0LzRQRX',
  googleClientId: '611827808910-o8l642cfn76ca8e3ft1te2jlrvs42c4a.apps.googleusercontent.com',
  googleDesktopClientId: '611827808910-9cd7cs9ikkf50kv6sil11aesdhath6lp.apps.googleusercontent.com',
};
