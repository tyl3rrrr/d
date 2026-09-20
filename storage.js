// storage.js
// Einfache JSON-Datei-Persistenz - EINE Datei (data.json) im Hauptordner,
// kein Unterordner, keine Datenbank nötig.
//
// data.json wird beim ersten Start automatisch angelegt und ist bewusst
// in .gitignore aufgeführt: das sind Laufzeitdaten deines Servers
// (Ticket-Zähler, Warnungen, Kanal-IDs) und sollen nicht ins Git-Repo,
// damit `git push` nie wegen dieser Datei Probleme macht.

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');

function defaultData() {
  return {
    guilds: {}, // guildId -> { ticketCategoryId, ticketStaffRoleId, logChannelId, ticketCounter, bannedWords, welcomeConfig, adminRoles, modRoles, xpBoard, botStatusConfig }
    warns: {}, // guildId -> { userId -> [ { reason, date, moderatorId } ] }
    spotify: {}, // discordUserId -> { accessToken, refreshToken, expiresAt }
    xp: {}, // guildId -> { userId -> { xp, level } }
    globalXP: {}, // userId -> { totalXP, highestLevel } (für globale Rangliste)
  };
}

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    // Fehlende Top-Level-Keys ergänzen (z.B. nach einem Update)
    return { ...defaultData(), ...parsed };
  } catch (err) {
    // Datei existiert noch nicht oder ist kaputt -> mit Standardwerten neu anlegen
    const fresh = defaultData();
    saveData(fresh);
    return fresh;
  }
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
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

function getServerConfig(guildId) {
  return data.guilds[guildId] || {};
}

function setGuildSetting(guildId, key, value) {
  if (!data.guilds[guildId]) data.guilds[guildId] = {};
  data.guilds[guildId][key] = value;
  saveData(data);
  return data.guilds[guildId];
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

function getSpotifyTokens(discordUserId) {
  return (data.spotify && data.spotify[discordUserId]) || null;
}

function setSpotifyTokens(discordUserId, tokens) {
  if (!data.spotify) data.spotify = {};
  data.spotify[discordUserId] = tokens;
  saveData(data);
}

// XP-System
function getXP(guildId, userId) {
  const guild = data.xp[guildId] || {};
  return guild[userId] || { xp: 0, level: 0 };
}

function setXP(guildId, userId, xp, level) {
  if (!data.xp[guildId]) data.xp[guildId] = {};
  data.xp[guildId][userId] = { xp: Math.max(0, xp), level: Math.max(0, level) };
  saveData(data);
  
  // Globale XP aktualisieren
  if (!data.globalXP) data.globalXP = {};
  const globalEntry = data.globalXP[userId] || { totalXP: 0, highestLevel: 0 };
  globalEntry.totalXP = (globalEntry.totalXP || 0) + Math.max(0, xp);
  globalEntry.highestLevel = Math.max(globalEntry.highestLevel, level);
  data.globalXP[userId] = globalEntry;
  saveData(data);
}

function addXP(guildId, userId, amount) {
  const current = getXP(guildId, userId);
  const newXP = current.xp + amount;
  setXP(guildId, userId, newXP, current.level);
  return current.xp + amount;
}

function getGlobalXPBoard() {
  if (!data.globalXP) data.globalXP = {};
  return Object.entries(data.globalXP).map(([userId, data]) => ({
    userId,
    totalXP: data.totalXP,
    highestLevel: data.highestLevel,
  })).sort((a, b) => b.totalXP - a.totalXP);
}

function getGuildXPBoard(guildId) {
  const guild = data.xp[guildId] || {};
  return Object.entries(guild).map(([userId, userData]) => ({
    userId,
    xp: userData.xp,
    level: userData.level,
  })).sort((a, b) => b.xp - a.xp);
}

module.exports = {
  getGuildSettings,
  getServerConfig,
  setGuildSetting,
  nextTicketNumber,
  addWarn,
  getWarns,
  clearWarns,
  getSpotifyTokens,
  setSpotifyTokens,
  reload,
  getXP,
  setXP,
  addXP,
  getGlobalXPBoard,
  getGuildXPBoard,
};
