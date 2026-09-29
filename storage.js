// storage.js
// Simple JSON-file persistence - ONE file (data.json) in the main folder, no
// subfolder, no database needed.
//
// data.json is created automatically on first start and is deliberately
// listed in .gitignore: it holds your server's runtime data (ticket
// counters, warnings, channel IDs) and shouldn't go into the git repo, so
// `git push` never has trouble because of this file.
//
// All per-server settings live separately under data.guilds[<guildId>] -
// server A can never affect server B.

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');

function defaultData() {
  return {
    // guildId -> { ticketCategoryId, ticketStaffRoleId, logChannelId, ticketCounter,
    //              adminRoleId, modRoleId, welcome: {...}, appearanceRoleId, ... }
    guilds: {},
    warns: {}, // guildId -> { userId -> [ { reason, date, moderatorId } ] }
    // XP system: STRICTLY separated per server (guildId -> userId -> { xp, level }).
    // XP on server A therefore has no technical access to or effect on server B.
    xp: {},
    meta: {}, // bot-wide metadata (e.g. commandHash for command auto-sync, bot presence)
  };
}

function loadData() {
  let raw;
  try {
    raw = fs.readFileSync(DATA_FILE, 'utf8');
  } catch (err) {
    // File doesn't exist yet -> create it fresh with defaults
    const fresh = defaultData();
    saveData(fresh);
    return fresh;
  }

  try {
    const parsed = JSON.parse(raw);
    const merged = { ...defaultData(), ...parsed };
    // Remove legacy leftovers: the Spotify integration was removed - any
    // stored Spotify tokens are dropped the next time this is saved.
    delete merged.spotify;
    return merged;
  } catch (err) {
    // File is corrupted: do NOT silently overwrite it (data loss!) - back it
    // up first instead.
    const backup = `${DATA_FILE}.corrupt-${Date.now()}`;
    try {
      fs.writeFileSync(backup, raw, 'utf8');
      console.error(`⚠️ data.json was corrupted (${err.message}). Backup: ${path.basename(backup)}. Continuing with empty data.`);
    } catch (backupErr) {
      console.error('⚠️ data.json was corrupted and could not be backed up:', backupErr.message);
    }
    const fresh = defaultData();
    saveData(fresh);
    return fresh;
  }
}

function saveData(data) {
  try {
    // Write to a temp file first, then rename atomically - this keeps
    // data.json intact even if the process crashes mid-write.
    const tmp = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, DATA_FILE);
  } catch (err) {
    console.error('Could not save data.json:', err.message);
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

const MAX_WARNS_PER_USER = 100; // prevents unbounded growth over years

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
// XP system - isolated per server.
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

// Leaderboard for a SINGLE server, descending by XP.
function getGuildLeaderboard(guildId) {
  const guild = data.xp[guildId] || {};
  return Object.entries(guild)
    .map(([userId, v]) => ({ userId, guildId, xp: v.xp, level: v.level }))
    .sort((a, b) => b.xp - a.xp);
}

// GLOBAL leaderboard: every (user, server) XP pair across all servers,
// sorted descending. A user can appear more than once (once per server they
// have XP on) - matching the requested "User | Rank | Server" format.
// Purely reads/aggregates - never changes any single server's XP.
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

// Position of a (user, server) entry in the global leaderboard (1-based), or null.
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
