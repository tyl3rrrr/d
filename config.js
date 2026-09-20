// config.js
// Zentrale Konfiguration - eine einzelne Datei, kein Ordner.

const dotenv = require('dotenv');
dotenv.config();

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
  links,
  changelog,
  reloadEnv,
  reloadLinks,
  reloadAll,
};
