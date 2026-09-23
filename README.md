# tylxrrrr Discord Bot (v7.1)

Ein einzelner, flacher Node.js-Ordner (keine Unterordner) auf Basis von
discord.js v14. Diese README ist bewusst die **einzige** Markdown-Datei in
der Auslieferung.

---

## 1. Schnellstart

```bash
npm install
cp .env.template .env      # dann DISCORD_TOKEN (und ggf. mehr) eintragen
npm run deploy              # registriert alle Slash-Commands bei Discord
npm start                    # startet den Bot
```

`npm run deploy` prüft **vor** dem Senden jeden Command gegen Discords
Namens-/Längen-/Struktur-Regeln (siehe `command-tools.js`) und bricht mit
einer klaren Fehlermeldung ab, statt die Nachricht ungeprüft an die API zu
schicken. Damit sind Abstürze durch ungültige Commands (z. B. ein
Command-Name mit Großbuchstaben) ausgeschlossen - das war die Ursache des
Absturzes `ExpectedConstraintError ... given: 'bStatNow'` aus einer
früheren Version: Discord verlangt für Slash-Commands **ausschließlich
kleingeschriebene** Namen. Der Befehl heißt jetzt korrekt `/bstatnow`.

Der Bot registriert seine Commands außerdem **automatisch bei jedem Start**
neu, falls sich etwas geändert hat (`AUTO_DEPLOY=true`, Standard) - das war
die Hauptursache für "Unknown Command"-Fehler: Code und die bei Discord
registrierte Liste liefen auseinander. `npm run deploy` bleibt zusätzlich
für gezielte/manuelle Registrierung verfügbar und schlägt nie mit einem
unklaren API-Fehler fehl, weil vorher lokal validiert wird.

## 2. Discord Developer Portal - nötige Einstellungen

- **Bot -> Privileged Gateway Intents:**
  - `SERVER MEMBERS INTENT` - für das Welcome-System (neue Mitglieder).
  - `MESSAGE CONTENT INTENT` - für den Text-Befehl `!support`.
  - Fehlt einer davon, startet der Bot **trotzdem**: er erkennt das
    automatisch (`DisallowedIntents`) und startet ohne den fehlenden
    Intent neu, meldet aber laut in der Konsole, welche Funktion dadurch
    deaktiviert ist. Das XP-System braucht KEINEN der beiden Intents.
- **Installation -> Installation Contexts:** "User Install" zusätzlich zu
  "Guild Install" aktivieren, damit Nutzer den Bot ohne Server-Einladung
  in ihren eigenen Account installieren können (siehe Punkt 6/12 unten).
- **Bot-Berechtigungen** (bei der Server-Einladung mit anfragen):
  Administrator ist am einfachsten; minimal nötig sind: Kick/Ban Members,
  Moderate Members (Timeout), Manage Messages, Manage Channels, Manage
  Roles, Manage Guild (für AutoMod), Manage Nicknames, Send Messages,
  Create Instant Invite (für den globalen XP-Server-Link), View Channels.

## 3. Zentrale Architektur (wichtig für spätere Änderungen)

| Datei | Zweck |
|---|---|
| `commands.js` | **Die einzige Stelle**, an der alle Commands registriert werden - mit Kategorie (für `/help`) und Zugriffsstufe (für `permissions.js`). Neuer Command? Hier eine Zeile ergänzen. |
| `permissions.js` | Zentrale Rechteprüfung. Kein Command prüft mehr selbst - `index.js` ruft vor JEDER Ausführung `guardInteraction()` auf. Rangstufen: Moderator-Rolle < Administrator-Rolle/Discord-Administrator < Server-Owner. |
| `command-tools.js` | Baut & validiert die Discord-Payload, registriert global, räumt veraltete Server-Commands auf, synct automatisch bei Bot-Start. |
| `storage.js` | Einzige `data.json` im Ordner, pro Server getrennte Einstellungen (`guilds[guildId]`), pro Server getrennte XP-Daten (`xp[guildId][userId]`). Schreibt atomar (Temp-Datei + Rename), sichert eine kaputte `data.json` statt sie zu überschreiben. |
| `automod-api.js` | AutoMod **ausschließlich über die offizielle Discord-AutoMod-API** - kein lokaler Nachrichtenfilter mehr im Bot-Code. |
| `logging.js` | Zentrales Logging in den per `/settings log-channel` gesetzten Kanal. |
| `xp.js` / `xp-runtime.js` | XP-/Level-Kurve bzw. Laufzeit-Logik (Nachrichten-XP, Level-Rollen, Leaderboard-Update). |
| `presence.js` | Bot-Online-Status (Discord-weit, siehe Einschränkung unten). |

## 4. Umgesetzte Punkte (Auftrag 1-17)

### 1) `/appearence` - Erscheinungsbild
Referenzbild war **IMG_2347** (Bot-Profilkarte: Avatar, grüner Online-Punkt,
"APP"-Tag, Name in Farbverlauf). Umgesetzt über `/appearence overview|
nickname|profile|color`:
- `overview` (jeder): zeigt Name, Status, Namensfarbe, Badges (u. a. "Uses
  AutoMod"), verfügbare Funktionen, Bot-Berechtigungen auf diesem Server.
- `nickname`/`profile` (Admin): Server-Nickname, -Avatar, -Banner, -Bio des
  Bots (`PATCH /guilds/{id}/members/@me`).
- `color` (Admin): Namensfarbe/-verlauf/holografisch über eine eigene,
  rechtelose Kosmetik-Rolle, die der Bot sich selbst zuweist. Verlauf/
  holografisch braucht auf dem Server "Enhanced Role Styles" (3 Boosts) -
  ohne das fällt der Befehl automatisch auf eine einfarbige Rolle zurück
  und sagt das auch. Der "APP"-Tag wird von Discord selbst gesetzt, ist
  nicht beeinflussbar.

### 2) Welcome-System
`/welcome-setup` (Admin) mit `role`, `channel`, `dm`, eigenem `message`/
`dm-message`-Text (Platzhalter `{user} {username} {server} {number}`) und
`reset`. Speicherung strikt pro Server. Beispieltext ist als Standard
hinterlegt. Vergibt beim Beitritt automatisch die Rolle, postet die
Nachricht, sendet optional eine DM, protokolliert in den Log-Kanal - alles
fehlertolerant (fehlende Berechtigung/Rolle über Bot-Rolle o. ä. wird
abgefangen und in der Konsole/im Log-Kanal vermerkt, bricht den Bot nie ab).

### 3) Zentrale Berechtigungen
Siehe `permissions.js` oben. Jeder Mod-/Admin-Command deklariert nur noch
seine nötige Stufe in `commands.js`; die Prüfung (inkl. Rang-gegen-Rang bei
Moderationsaktionen, damit ein Moderator keinen Admin bannen kann) läuft
zentral. Fehlende Berechtigung -> ephemere Fehlermeldung.

### 4) Slash-Command-Registrierung / "Unknown Command"
Auto-Sync bei jedem Start + lokale Validierung vor jedem Senden (siehe
Abschnitt 1). `/help` liest die Liste automatisch aus `commands.js` aus -
kein Command kann mehr "vergessen" werden.

### 5) AutoMod-Badge
`/automod setup` legt die 5 möglichen Standardregeln über die
**Discord-AutoMod-API** an (Wortfilter, Spam, Mention-Spam, Standard-Filter,
Profil-Filter) - maximal 10 Regeln pro Server (Discord-Limit). `/automod
status` zeigt dem Bot-Betreiber zusätzlich den echten Fortschritt zum
"Uses AutoMod"-Badge: laut Discords Entwickler-Hilfeseite braucht es
**mindestens 100 selbst erstellte AutoMod-Regeln über alle Server
hinweg** - die Rechnung "100 / 12 Regeln" aus der Aufgabenstellung ist
NICHT die offizielle Grundlage und wurde bewusst nicht verwendet. Mit z. B.
9 Servern sind bei maximal 10 Regeln/Server höchstens 90 Regeln möglich -
das reicht rechnerisch nicht für 100, unabhängig vom Code. Der Bot zeigt
diese Rechnung live an (`/automod status`, nur für den Betreiber sichtbar)
und erklärt, wie viele Server mindestens nötig sind.

### 6) Entfernt: Spotify- & Entwickler-Befehle; `/uptime`-Reset; ohne Einladung nutzbar
- `commands-dev.js`, `commands-spotify.js`, `spotify.js` gelöscht,
  gespeicherte Spotify-Tokens werden beim ersten Speichern automatisch aus
  `data.json` entfernt (Migration, kein manueller Schritt nötig).
- `/uptime` misst jetzt die **Prozess**-Laufzeit (`config.js`,
  `PROCESS_STARTED_AT`) statt der Verbindungszeit - startet garantiert bei
  0, sobald der Bot-**Prozess** neu startet (Bot-Neustart oder
  Host-Aus-/Wiedereinschalten).
- User-Install aktiviert (siehe Abschnitt 2, "Installation Contexts") -
  jeder kann die meisten Befehle nutzen, ohne den Bot auf einen eigenen
  Server einzuladen (Ausnahme: alles, was zwangsläufig einen Server
  braucht, z. B. Moderation, Welcome, XP).

### 8) `/help`
Automatisch aus `commands.js` erzeugt, nach Kategorien sortiert
(Allgemein, Moderation, Administration, Welcome, Tickets, Nützliches,
XP, Bot). Zeigt zu jedem Command Subcommands und die nötige
Berechtigungsstufe.

### 9) `/adm-reload`
Führt einen **echten Prozess-Neustart** durch (`process.exit(0)`), kein
reines `.env`-Neuladen (das macht weiterhin `/reload`, nur für den
Bot-Betreiber). **Einschränkung:** Node.js kann sich nicht selbst
ersetzen - der Prozess muss sich beenden und von einem Prozess-Manager
(systemd mit `Restart=always`, PM2, Docker mit `--restart unless-stopped`,
Railway/Render o. ä.) automatisch neu gestartet werden. **Ohne** so einen
Auto-Restart bleibt der Bot nach `/adm-reload` offline, bis er manuell
gestartet wird - das lässt sich von Discord/Node.js aus nicht umgehen.

### 10) Bot-Status mit Serveranzahl
Läuft automatisch im Hintergrund (`presence.js`): zeigt standardmäßig
"👀 X Server" an, aktualisiert sich beim Start, bei jedem Server-Beitritt/
-Verlust sofort und sonst zurückhaltend alle 10 Minuten (keine unnötigen
API-Anfragen). `/bstatnow` (**ausschließlich** Superuser-ID
`1324102364608598118`) schaltet in den manuellen Modus und konfiguriert
Status/Aktivität/Streaming im Detail; `/bstatnow auto` schaltet zurück in
den automatischen Servercount-Modus.

**Namenskonflikt gelöst:** Der Bot hatte bereits einen bestehenden Befehl
`/status` ("Prüft, ob die Website erreichbar ist") - der wurde wie
verlangt NICHT ohne ausdrückliche Anweisung entfernt. Der neue,
auftragsgemäße Presence-Befehl heißt deshalb **`/bot-status`**.

### 11) `/bot-status`
Admin-Befehl mit den Optionen Online/Idle/DND/Invisible/Twitch/Automatisch.
Twitch nutzt immer den zentral konfigurierten Namen `0tylxrrrr`
(`config.js`, per `.env`/`TWITCH_NAME` überschreibbar, nicht mehrfach im
Code verstreut).

**Ehrliche technische Einschränkung:** Die Discord-Presence (Online-Punkt,
Aktivität) gehört zum **Bot-Account selbst** und ist damit für **alle**
Server gleichzeitig identisch - Discord bietet keine Möglichkeit, sie pro
Server unterschiedlich anzuzeigen. "Pro Server konfigurierbar" wurde
deshalb so umgesetzt, dass die zuletzt von irgendeinem berechtigten Nutzer
getroffene Einstellung bot-weit gilt (mit Vermerk, wer/wo sie gesetzt hat)
- eine echte Pro-Server-Trennung ist mit der Discord-API technisch nicht
möglich.

### 12) Bot-Logs
`/settings log-channel` (Admin, pro Server gespeichert). Geloggt werden:
Kick/Ban/Timeout/Warn/Clear/Nickname-Änderungen, Ticket erstellt/
geschlossen, Mitglied beigetreten, Einstellungsänderungen (Admin-/
Mod-Rolle, Log-Kanal), Bot-Neustart, XP-Level-Up und Interaktionsfehler.
Es werden **niemals** Tokens/API-Keys geloggt (`logging.js` sendet
ausschließlich die dafür übergebenen, unkritischen Felder).

### 13) Doppelte/alte Befehle entfernt
Alle Commands laufen jetzt über die eine Registry `commands.js` - ein
integrierter Check (`commands.js`, beim Laden) wirft einen klaren Fehler,
falls jemals wieder ein Name doppelt vorkommt, statt Discord stillschweigend
zwei widersprüchliche Definitionen registrieren zu lassen. Alte,
UUID-artige Test-Befehle aus früheren Versionen sind nicht mehr Teil der
Registry und werden beim ersten Auto-Sync automatisch bei Discord entfernt
(`clearStaleGuildCommands`/Diff gegen die globale Liste).

### 14) XP-/Level-System
- XP wird beim Schreiben vergeben (5-15 XP, 15 Sekunden Cooldown pro
  Nutzer/Server gegen Spam-Farming), **strikt pro Server** gespeichert
  (`storage.xp[guildId][userId]`).
- **Level-Kurve:** linear, Level 1 kostet wie gefordert genau 15 XP,
  jede weitere Stufe 15 XP mehr als die vorherige (`xp.js`) - dadurch gibt
  es zu jedem XP-Stand genau ein eindeutiges Level, keine widersprüchlichen
  Werte möglich.
- **Level-Rollen** `Level 1, 10, 20, ..., 100` und danach automatisch weiter
  in 10er-Schritten, pro Server einzeln angelegt (werden erst beim
  jeweiligen Levelaufstieg erzeugt, nicht vorab für alle möglichen Level).
  Bei fehlender Berechtigung/zu niedriger Bot-Rolle wird das abgefangen,
  geloggt, und der Bot bricht nicht ab.
- Bei Levelaufstieg: Rolle vergeben (falls Meilenstein), DM mit
  Level/XP/ggf. neuer Rolle, Log-Eintrag.
- `/xp-board` (Admin): legt den Leaderboard-Kanal fest; die Nachricht wird
  alle 24 Stunden **bearbeitet** statt neu gepostet.
- `/xp-set` (**ausschließlich** hartkodierte User-ID
  `1324102364608598118` - zusätzlich zur zentralen Rechteprüfung noch
  einmal direkt im Code verglichen): setzt XP/Level eines Nutzers, auch für
  einen anderen Server (`server`-Option mit Server-ID, sofern die
  Datenbankstruktur - pro Server getrennt - das zulässt).
- `/xp-stats` (jeder): eigene oder fremde Statistik inkl. globalem Rang,
  Fortschrittsbalken zum nächsten Level.
- `/xp-global` (jeder): globale Rangliste über alle Server
  ("User | Platz | Server"-Format), Server sind **anklickbar**, sofern der
  Bot in einem Textkanal die Berechtigung "Einladung erstellen" hat - dann
  wird einmalig eine Invite mit `max_age: 0` (von Discord als "läuft nicht
  ab" behandelt) erzeugt und wiederverwendet. Discord kann eine solche
  Einladung serverseitig trotzdem ungültig machen (z. B. wenn der Kanal
  gelöscht wird) - ein wirklich für immer garantierter Link lässt sich
  über die Discord-API nicht zusichern, nur der technisch bestmögliche.

### 15) Datenbank-/Server-Isolation
Alle Server-Einstellungen liegen unter `guilds[guildId]`, alle XP-Daten
unter `xp[guildId][userId]` - ein Server kann die Werte eines anderen
Servers strukturell nicht beeinflussen. Die globale Rangliste wird rein
lesend aus genau diesen getrennten Server-Daten zusammengesetzt
(`storage.getGlobalLeaderboard`), verändert dabei nie einen Server-Wert.

## 5. Befehlsübersicht

| Kategorie | Befehle |
|---|---|
| Allgemein | `/antimdm` `/web` `/uptime` `/status` `/changelog` `/links` `/botinfo` `/ping` `/help` |
| Moderation (Mod+) | `/kick` `/ban` `/timeout` `/warn` `/clear` `/slowmode` `/lock` `/unlock` `/nickname` `/role` `/purge-user` `/say` |
| Administration (Admin) | `/settings` `/automod-words` `/automod` `/appearence nickname\|profile\|color` `/adm-reload` `/bot-status` |
| Bot-Betreiber/Superuser | `/reload` (Betreiber) `/bstatnow` (nur Superuser-ID) |
| Welcome | `/welcome-setup` |
| Tickets | `/ticket-panel` (+ Buttons „Ticket öffnen“/„Schließen“) |
| XP | `/xp-board` (Admin) `/xp-set` (nur Superuser-ID) `/xp-stats` `/xp-global` |
| Nützliches/Spaß | `/userinfo` `/serverinfo` `/avatar` `/poll` `/remindme` `/suggest` `/coinflip` `/dice` `/8ball` `/membercount` `/roleinfo` |
| Text-Befehl | `!support <Anliegen>`, `!support config` |

## 6. Benötigte Dependencies

```json
"discord.js": "^14.16.3",
"dotenv": "^16.4.5"
```
Keine weiteren - keine Datenbank-Treiber, keine zusätzlichen Pakete.

## 7. Benötigte `.env`-Variablen

Siehe `.env.template` (Kopiervorlage). Pflicht ist nur `DISCORD_TOKEN`,
alles andere hat einen sinnvollen Standardwert oder ist optional.

## 8. Datenbank

Eine einzige `data.json` im Ordner (wird beim ersten Start automatisch
angelegt, liegt in `.gitignore`). Enthält: `guilds` (pro-Server-
Einstellungen), `warns`, `xp` (pro-Server-XP), `meta` (u. a.
Command-Hash für den Auto-Sync, Presence-Konfiguration). Schreibt atomar
und sichert die Datei bei Beschädigung automatisch (`data.json.corrupt-*`)
statt Daten zu verlieren.

## 9. Wie ich den Bot starte

```bash
npm install
npm start          # entspricht: node --max-old-space-size=1536 index.js
```

Für echten Auto-Restart nach `/adm-reload` einen Prozess-Manager nutzen,
z. B. mit PM2:

```bash
npm install -g pm2
pm2 start index.js --name tylxrrrr-bot --max-memory-restart 1536M
```

## 10. Bekannte Einschränkungen (technisch begründet, siehe Details oben)

- Bot-Presence ist Discord-weit identisch auf allen Servern (Punkt 10/11).
- Ein "für immer" gültiger Server-Invite lässt sich nicht zusichern, nur
  der technisch bestmögliche (`max_age: 0`) (Punkt 14).
- `/adm-reload` braucht einen Prozess-Manager mit Auto-Restart, sonst
  bleibt der Bot nach dem Neustart-Befehl offline (Punkt 9).
- Das "Uses AutoMod"-Badge hängt von Discord selbst ab (mindestens 100
  Regeln über alle Server) - der Bot kann die Voraussetzung schaffen
  (`/automod setup` auf jedem Server), die Vergabe selbst liegt aber
  ausschließlich bei Discord.
- Fehlen die privilegierten Intents (Developer Portal), starten Welcome-
  System bzw. `!support` automatisch deaktiviert, statt den Bot am Start zu
  hindern.

## 11. Durchgeführte Prüfungen

- Jede `.js`-Datei mit `node --check` auf Syntaxfehler geprüft.
- Die komplette Command-Registry (`commands.js`) offline gegen eine
  Discord-API-Simulation geladen: alle 46 Commands lassen sich fehlerfrei
  zu JSON serialisieren, keine doppelten Namen, keine ungültigen
  (Groß-/Kleinschreibungs-)Namen - genau die Fehlerklasse, die zuvor zum
  Absturz führte, ist damit ausgeschlossen.
- `command-tools.validatePayload` lief gegen die echte, vollständige
  Payload durch: 0 Fehler.
- Die XP-/Level-Kurve wurde mit simulierten Nachrichten durchgerechnet
  (Level 1 kostet exakt 15 XP, danach linear steigend, Level-Meilensteine
  korrekt erkannt).
- `storage.js`-Funktionen (Leaderboards, Server-Trennung) mit Testdaten
  über mehrere Server/Nutzer verifiziert.

**Nicht möglich in dieser Umgebung:** ein echter Login bei Discord (kein
Netzwerkzugriff hier) - `npm run deploy` und `npm start` bitte einmal bei
dir ausführen und melden, falls dabei doch noch etwas auffällt.
