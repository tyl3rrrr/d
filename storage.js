// storage.js
// Einfache JSON-Datei-Persistenz - EINE Datei (data.json) im Hauptordner,
// kein Unterordner, keine Datenbank nötig.
//
// data.json wird beim ersten Start automatisch angelegt und ist bewusst
// in .gitignore aufgeführt: das sind Laufzeitdaten deines Servers
// (Ticket-Zähler, Warnungen, Kanal-IDs) und sollen nicht ins Git-Repo,
// damit `git push` nie wegen dieser Datei Probleme macht.
//
// Alle serverspezifischen Einstellungen liegen getrennt unter
// data.guilds[<guildId>] - Server A kann Server B nie beeinflussen.

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');

function defaultData() {
  return {
    // guildId -> { ticketCategoryId, ticketStaffRoleId, logChannelId, ticketCounter,
    //              adminRoleId, modRoleId, welcome: {...}, appearanceRoleId, ... }
    guilds: {},
    warns: {}, // guildId -> { userId -> [ { reason, date, moderatorId } ] }
    // XP-System: STRIKT pro Server getrennt (guildId -> userId -> { xp, level }).
    // XP auf Server A hat dadurch technisch keinen Zugriff auf/Einfluss auf Server B.
    xp: {},
    meta: {}, // botweite Metadaten (z.B. commandHash für den Command-Auto-Sync, Bot-Presence)
  };
}

function loadData() {
  let raw;
  try {
    raw = fs.readFileSync(DATA_FILE, 'utf8');
  } catch (err) {
    // Datei existiert noch nicht -> mit Standardwerten neu anlegen
    const fresh = defaultData();
    saveData(fresh);
    return fresh;
  }

  try {
    const parsed = JSON.parse(raw);
    const merged = { ...defaultData(), ...parsed };
    // Altlast entfernen: Die Spotify-Integration wurde entfernt - gespeicherte
    // Spotify-Tokens werden beim nächsten Speichern nicht mehr mitgeschrieben.
    delete merged.spotify;
    return merged;
  } catch (err) {
    // Datei ist kaputt: NICHT stillschweigend überschreiben (Datenverlust!),
    // sondern zuerst eine Sicherungskopie anlegen.
    const backup = `${DATA_FILE}.corrupt-${Date.now()}`;
    try {
      fs.writeFileSync(backup, raw, 'utf8');
      console.error(`⚠️ data.json war beschädigt (${err.message}). Sicherung: ${path.basename(backup)}. Es wird mit leeren Daten weitergemacht.`);
    } catch (backupErr) {
      console.error('⚠️ data.json war beschädigt und konnte nicht gesichert werden:', backupErr.message);
    }
    const fresh = defaultData();
    saveData(fresh);
    return fresh;
  }
}

function saveData(data) {
  try {
    // Erst in eine Temp-Datei schreiben, dann atomar umbenennen - so bleibt
    // data.json auch bei einem Absturz mitten im Schreiben unversehrt.
    const tmp = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, DATA_FILE);
  } catch (err) {
    console.error('Konnte data.json nicht speichern:', err.message);
  }
}

let data = loadData();

function reload() {
  data = loadData();
}

function getGuildSettings(guildId) {
  return data.guilds[guildId] || {};
}

function setGuildSetting(guildId, key, value) {
  if (!data.guilds[guildId]) data.guilds[guildId] = {};
  data.guilds[guildId][key] = value;
  saveData(data);
  return data.guilds[guildId];
}

function removeGuildSetting(guildId, key) {
  if (data.guilds[guildId] && key in data.guilds[guildId]) {
    delete data.guilds[guildId][key];
    saveData(data);
  }
  return data.guilds[guildId] || {};
}

function nextTicketNumber(guildId) {
  if (!data.guilds[guildId]) data.guilds[guildId] = {};
  const current = data.guilds[guildId].ticketCounter || 0;
  const next = current + 1;
  data.guilds[guildId].ticketCounter = next;
  saveData(data);
  return next;
}

const MAX_WARNS_PER_USER = 100; // verhindert unbegrenztes Wachstum über Jahre hinweg

function addWarn(guildId, userId, warnEntry) {
  if (!data.warns[guildId]) data.warns[guildId] = {};
  if (!data.warns[guildId][userId]) data.warns[guildId][userId] = [];
  data.warns[guildId][userId].push(warnEntry);
  if (data.warns[guildId][userId].length > MAX_WARNS_PER_USER) {
    data.warns[guildId][userId] = data.warns[guildId][userId].slice(-MAX_WARNS_PER_USER);
  }
  saveData(data);
  return data.warns[guildId][userId];
}

function getWarns(guildId, userId) {
  return (data.warns[guildId] && data.warns[guildId][userId]) || [];
}

function clearWarns(guildId, userId) {
  if (data.warns[guildId]) {
    delete data.warns[guildId][userId];
    saveData(data);
  }
  return [];
}

// ---------------------------------------------------------------------------
// XP-System (siehe Punkt 14/15 im Auftrag) - pro Server isoliert.
// ---------------------------------------------------------------------------
function getUserXP(guildId, userId) {
  const guild = data.xp[guildId] || {};
  return guild[userId] || { xp: 0, level: 0 };
}

function setUserXP(guildId, userId, xp, level) {
  if (!data.xp[guildId]) data.xp[guildId] = {};
  data.xp[guildId][userId] = { xp: Math.max(0, Math.round(xp)), level: Math.max(0, Math.round(level)) };
  saveData(data);
  return data.xp[guildId][userId];
}

// Rangliste EINES Servers, absteigend nach XP.
function getGuildLeaderboard(guildId) {
  const guild = data.xp[guildId] || {};
  return Object.entries(guild)
    .map(([userId, v]) => ({ userId, guildId, xp: v.xp, level: v.level }))
    .sort((a, b) => b.xp - a.xp);
}

// GLOBALE Rangliste: alle (User, Server)-XP-Paare über alle Server hinweg,
// absteigend sortiert. Ein User kann mehrfach auftreten (einmal pro Server,
// auf dem er XP hat) - genau wie im gewünschten Format "User | Platz | Server".
// Rein lesend/aggregierend - verändert nie XP eines einzelnen Servers.
function getGlobalLeaderboard(limit = 100) {
  const all = [];
  for (const guildId of Object.keys(data.xp)) {
    for (const [userId, v] of Object.entries(data.xp[guildId])) {
      all.push({ userId, guildId, xp: v.xp, level: v.level });
    }
  }
  all.sort((a, b) => b.xp - a.xp);
  return typeof limit === 'number' ? all.slice(0, limit) : all;
}

// Position eines (User, Server)-Eintrags in der globalen Rangliste (1-basiert), oder null.
function getGlobalRank(guildId, userId) {
  const all = getGlobalLeaderboard(Infinity);
  const idx = all.findIndex((e) => e.guildId === guildId && e.userId === userId);
  return idx === -1 ? null : idx + 1;
}

function getMeta(key) {
  return data.meta ? data.meta[key] : undefined;
}

function setMeta(key, value) {
  if (!data.meta) data.meta = {};
  data.meta[key] = value;
  saveData(data);
}

module.exports = {
  getGuildSettings,
  setGuildSetting,
  removeGuildSetting,
  nextTicketNumber,
  addWarn,
  getWarns,
  clearWarns,
  getUserXP,
  setUserXP,
  getGuildLeaderboard,
  getGlobalLeaderboard,
  getGlobalRank,
  getMeta,
  setMeta,
  reload,
};
