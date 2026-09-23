// config.js
// Zentrale Konfiguration - eine einzelne Datei, kein Ordner.

const dotenv = require('dotenv');
dotenv.config();

// ---------------------------------------------------------------------------
// Feste Bot-Konstanten
// ---------------------------------------------------------------------------

// Superuser des Bots (bewusst im Code hinterlegt, nicht in der .env). Wird
// vom zentralen Berechtigungssystem (permissions.js) als "superuser"
// ausgewertet und zusätzlich als Bot-Owner akzeptiert.
const SUPERUSER_ID = '1324102364608598118';

// Zeitpunkt des PROZESS-Starts. process.uptime() beginnt bei jedem neuen
// Node-Prozess bei 0 - also nach einem Neustart des Bots UND nach einem
// Neustart/Wiedereinschalten des Hosts. (Bewusst NICHT client.readyTimestamp:
// der bezieht sich auf die Discord-Verbindung, nicht auf den Prozess.)
const PROCESS_STARTED_AT = Date.now() - Math.round(process.uptime() * 1000);

function getUptimeMs() {
  return Date.now() - PROCESS_STARTED_AT;
}

// Bot-Owner: OWNER_ID aus der .env (optional) plus der Superuser.
function getBotOwnerIds() {
  const ids = new Set([SUPERUSER_ID]);
  const fromEnv = (process.env.OWNER_ID || '').trim();
  if (fromEnv) ids.add(fromEnv);
  return ids;
}

// Twitch-Name für den Streaming-Status - EINMAL hier konfiguriert (per .env
// überschreibbar), damit er nicht mehrfach im Code steht.
const TWITCH_DEFAULT_NAME = process.env.TWITCH_NAME || '0tylxrrrr';

const links = {
  website: process.env.WEBSITE_URL || 'https://tylxrrrr.is-great.net',
  antimdm: process.env.ANTIMDM_LINK || 'https://tinyurl.com/vr27mahv',
  discordInvite: process.env.DISCORD_INVITE || '',
  github: process.env.GITHUB_URL || '',
};

const changelog = [
  {
    date: '2026-09-09',
    text: 'Bot erstellt: Status-Anzeige, /antimdm, /web und /uptime hinzugefügt.',
  },
  {
    date: '2026-09-09',
    text: 'Neue Befehle: /status, /changelog, /links, /reload, /botinfo und /automod-setup hinzugefügt.',
  },
  {
    date: '2026-09-10',
    text: 'Struktur vereinfacht: keine Unterordner mehr.',
  },
  {
    date: '2026-09-10',
    text: 'Mega-Update: Mod-Befehle, /help, Ticket-System, /settings, AutoMod-Fix, lilaner Status.',
  },
  {
    date: '2026-09-10',
    text:
      '/automod-setup komplett entfernt (funktionierte nicht zuverlässig). Neue Befehle: /ping, /remindme, ' +
      '/suggest, /role, /purge-user, /userinfo, /serverinfo, /avatar, /poll, /slowmode, /lock, /unlock, /nickname. ' +
      'Neu: Text-Befehl !support (+ !support config) und DM-Benachrichtigungen bei Warn/Kick/Ban/Timeout.',
  },
  {
    date: '2026-09-20',
    text:
      'v7.1 (Teil 1): /appearence, Welcome-System (/welcome-setup), zentrale Berechtigungen (Owner/Admin-/Mod-Rolle), ' +
      'Command-Registrierung repariert (Auto-Sync, kein "Unknown Command" mehr), AutoMod läuft jetzt über die ' +
      'Discord-AutoMod-API (/automod, /automod-words), Spotify- und Developer-Befehle entfernt, ' +
      'Bot ist per User-Install ohne Server-Einladung nutzbar, /uptime setzt sich beim Prozessstart zurück.',
  },
];

function reloadEnv() {
  return dotenv.config({ override: true });
}

function reloadLinks() {
  links.website = process.env.WEBSITE_URL || links.website;
  links.antimdm = process.env.ANTIMDM_LINK || links.antimdm;
  links.discordInvite = process.env.DISCORD_INVITE || links.discordInvite;
  links.github = process.env.GITHUB_URL || links.github;
}

function reloadAll() {
  reloadEnv();
  reloadLinks();
}

module.exports = {
  SUPERUSER_ID,
  TWITCH_DEFAULT_NAME,
  PROCESS_STARTED_AT,
  getUptimeMs,
  getBotOwnerIds,
  links,
  changelog,
  reloadEnv,
  reloadLinks,
  reloadAll,
};
