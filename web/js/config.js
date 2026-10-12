/* Cloud-Abgleich (Supabase). Einmal eintragen, dann nutzen Webseite und Desktop-App dieselben Daten.
 * Werte stehen im Supabase-Dashboard unter Project Settings → API:
 *   supabaseUrl  = „Project URL“
 *   supabaseKey  = „anon public“ Schlüssel (darf öffentlich sein, die Daten schützt die Zeilen-Sicherheit)
 * Leer lassen: dann kann man die Werte in der App unter „Sync“ eintragen. */
window.WB_CONFIG = {
  supabaseUrl: '',
  supabaseKey: '',
};
