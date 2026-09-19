# tylxrrrr Discord Bot (v7)

## 1. Duplikate bei !support / /warn - tieferer Fix

Der Code wurde erneut Zeile für Zeile geprüft: `/warn add` sendet
garantiert genau EINE DM und EINE Antwort, `!support` erstellt garantiert
genau EIN Ticket mit genau EINER Log-Nachricht (per Stub-Tests verifiziert).
Trotzdem zwei zusätzliche Härtungen eingebaut:

1. **Race Condition im Lock behoben:** Die Vorversion prüfte "existiert die
   Lock-Datei?" und "Datei schreiben" in zwei getrennten Schritten - bei
   exakt gleichzeitigem Start zweier Prozesse konnten theoretisch beide
   durchkommen. Jetzt wird die Datei mit dem atomaren `wx`-Flag erstellt
   (schlägt garantiert fehl, wenn sie schon existiert). Mit einem Test
   verifiziert: bei zwei exakt gleichzeitigen Starts gewinnt jetzt
   garantiert nur einer.
2. **Interaktions-ID-Dedupe:** Jede Slash-Command- und Button-Interaktion
   wird jetzt zusätzlich anhand ihrer eindeutigen ID nur einmal verarbeitet
   (unabhängig vom Nachrichten-Dedupe für `!support`).

⚠️ **Falls es TROTZDEM noch passiert:** Diese Sperre schützt nur vor
mehreren Prozessen auf **derselben Maschine**. Prüfe unbedingt, ob derselbe
Bot-Token zusätzlich auf einem **anderen Server/Hosting-Dienst** läuft
(Railway, Replit, ein VPS, ein zweiter Rechner, ein alter Cloud-Deploy, den
du vergessen hast) - das kann unsere lokale Sperrdatei technisch nicht
erkennen, da jede Maschine ihre eigene Festplatte hat. Zwei Prozesse mit
demselben Token an zwei verschiedenen Orten bekommen von Discord JEDES
Event doppelt zugestellt - das ist eine Discord-Systematik, keine Frage
des Codes.

## 2. Lokaler AutoMod-Wortfilter (KEINE Discord-API)

`automod-filter.js` prüft jede Nachricht direkt im Bot-Code gegen eine
Wortliste (Wortgrenzen-Regex, Groß-/Kleinschreibung egal) - es wird
KEINE Anfrage an Discords AutoMod-API gestellt, dadurch entfallen deren
bekannte Zuverlässigkeitsprobleme vollständig.

**Standard-Blockliste:** Nigga, Negger, Asylant, Bastard, Nutte, Hundesohn,
Hurensohn, Fotze, Slime, Fort, Disc, LoL

Bei einem Treffer wird die Nachricht sofort gelöscht, eine kurze Hinweis-
Nachricht (löscht sich nach 6 Sekunden selbst) gepostet, und - falls über
`/settings log-channel` bzw. `!support config` gesetzt - eine Meldung in den
Log-Kanal geschickt.

**Wortliste erweitern/verwalten:** `/automod-words add|remove|list`
(Berechtigung: Manage Guild).

**Getestet:** Treffer wird erkannt und gelöscht; "Fort" matcht NICHT
versehentlich in "Fortnite" (Wortgrenzen-Prüfung); add/remove/list
funktionieren korrekt.

**Ehrliche Einschränkung:** Einfache Umschreibungen wie "N i g g a" (mit
Leerzeichen) oder Leetspeak ("n1gga") werden von dieser einfachen
Wortgrenzen-Prüfung nicht erkannt. Auf Wunsch nachrüstbar (Normalisierung).

**Nötige Berechtigung:** Der Bot braucht "Nachrichten verwalten" (Manage
Messages) im jeweiligen Kanal, um Nachrichten löschen zu können.

## 3. RAM-Optimierung (aus dem letzten Update, weiterhin aktiv)
Cache-Limits, Sweepers, `--max-old-space-size=1536`, begrenzte Warn-Historie
- siehe Kommentare in `index.js`/`storage.js`.

## 4. Neue Befehle

### Developer-Werkzeuge (`commands-dev.js`)
`/base64 encode|decode`, `/hash md5|sha1|sha256`, `/json` (pretty-print),
`/timestamp` (Unix -> Discord-Zeitformat), `/uuid`, `/snowflake` (Discord-ID
zerlegen), `/regex-test`

### Spotify-Integration (`commands-spotify.js`, `spotify.js`)
`/spotify-login`, `/spotify-nowplaying`, `/spotify-play`, `/spotify-pause`,
`/spotify-skip`, `/spotify-search`

⚠️ **Wichtige, von Spotify selbst vorgegebene Einschränkung:** Spotifys
API erlaubt es NICHT, Audio-Streams in eine Drittanwendung wie einen
Discord-Sprachkanal einzuspeisen (Lizenzrecht) - das kann kein Bot, der
offiziell über die Spotify-API arbeitet, auch nicht mit noch mehr Code.
Was tatsächlich funktioniert und hier implementiert ist:
- Login/Verknüpfung des eigenen Spotify-Accounts (OAuth)
- Anzeigen, was aktuell läuft ("Now Playing")
- Steuern der Wiedergabe auf dem eigenen, BEREITS GEÖFFNETEN Spotify-Gerät
  (Play/Pause/Skip - offizielle "Spotify Connect"-Funktion)
- Songsuche im Spotify-Katalog

**Einrichtung (nur nötig, wenn du diese Befehle nutzen willst):**
1. App erstellen auf https://developer.spotify.com/dashboard
2. Als "Redirect URI" in der Spotify-App-Konfiguration exakt denselben Wert
   eintragen wie `SPOTIFY_REDIRECT_URI` in der `.env` (Standard:
   `http://localhost:8888/callback`)
3. `SPOTIFY_CLIENT_ID` und `SPOTIFY_CLIENT_SECRET` aus dem Dashboard in die
   `.env` eintragen
4. Der Bot startet dann automatisch einen kleinen lokalen HTTP-Server
   (Port über `SPOTIFY_CALLBACK_PORT`, Standard 8888) NUR für den
   OAuth-Redirect - läuft nur auf deinem eigenen Rechner/Server, nicht
   öffentlich erreichbar, außer du leitest den Port selbst weiter.

Ohne diese drei Variablen funktionieren nur die `/spotify-*`-Befehle nicht
(mit klarer Fehlermeldung) - alles andere läuft normal.

**Getestet:** kompletter OAuth-Flow (Auth-URL, State-Verifizierung,
Token-Austausch, Speichern, Now-Playing-Abruf, Fehlerfall "nicht verknüpft")
mit simuliertem Spotify-API-Antworten - alles korrekt.

## Projektstruktur (weiterhin flach, keine Unterordner)

```
index.js                    Login, Lock, RAM-Limits, Presence, Routing, Spotify-Callback-Server
deploy-commands.js            Registriert alle Slash-Commands
commands.js                    Fasst ALLE Slash-Commands zusammen
commands-core.js                /antimdm /web /uptime /status /changelog /links /reload /botinfo /help
commands-mod.js                  /kick /ban /timeout /warn /clear /slowmode /lock /unlock /nickname
commands-extra.js                /ping /remindme /suggest /role /purge-user /say /coinflip /dice /8ball /membercount /roleinfo
commands-utility.js              /userinfo /serverinfo /avatar /poll
commands-dev.js                   /base64 /hash /json /timestamp /uuid /snowflake /regex-test
commands-spotify.js               /spotify-login /spotify-nowplaying /spotify-play /spotify-pause /spotify-skip /spotify-search
commands-automod-words.js         /automod-words
commands-settings.js              /settings
commands-tickets.js                /ticket-panel + gemeinsame Ticket-Erstellung
legacy-support.js                   !support (Text-Befehl)
automod-filter.js                    Lokaler Wortfilter
dm-notify.js                         DMs bei Warn/Kick/Ban/Timeout
spotify.js                            Spotify-OAuth + API-Client
config.js                             Links, Changelog, .env-Reload
storage.js                            data.json (Settings, Warnungen, Tickets, Spotify-Tokens)
package.json / .env / .gitignore
```

Insgesamt jetzt **49 Slash-Commands** + der Text-Befehl `!support`.

## Einrichtung

```bash
npm install
npm run deploy
npm start
```

### Privileged Gateway Intents (Developer Portal)
- **MESSAGE CONTENT INTENT** - für `!support` und den Wortfilter

### Bot-Berechtigungen (zusätzlich zu den bisherigen)
- **Manage Messages** wird jetzt auch für den Wortfilter benötigt (Löschen
  blockierter Nachrichten)

### Git-Push-Sicherheit
`.gitignore` schließt `.env`, `data.json` (jetzt auch mit Spotify-Tokens!)
und `bot.lock` aus.
