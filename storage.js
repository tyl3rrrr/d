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
    // guildId -> { ticketChannelId, ticketStaffRoleId, logChannelId, macrumorsChannelId, githubChannelId, ticketCounter,
    //              adminRoleId, modRoleId, welcome: {...}, githubChannelId, ... }
    guilds: {},
    warns: {}, // guildId -> { userId -> [ { reason, date, moderatorId } ] }
    // guildId -> giveawayId -> { id, messageId, channelId, prize, winnersCount, endsAt, status, entries: [...], ... }
    giveaways: {},
    // guildId -> reportId -> { id, status, reporterId, targetId, reason, messageId, handlerId, ... }   (see report-runtime.js)
    reports: {},
    // guildId -> partnerId -> { id, status, name, invite, requesterId, ... }                          (see partner-runtime.js)
    partners: {},
    // guildId -> { text, version, history: [...], accepted: { userId: version }, channelId, messageId }  (see rules-runtime.js)
    rules: {},
    // guildId -> applicationId -> { id, typeId, typeLabel, userId, userTag, answers, status, reviewerId, createdAt }
    applications: {},
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
    // The XP system was removed entirely: drop its data and per-server leftovers.
    delete merged.xp;
    for (const g of Object.values(merged.guilds || {})) {
      delete g.xpBoardChannelId;
      delete g.xpBoardMessageId;
      delete g.appearanceRoleId; // leftover of a removed feature
    }
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

// IDs of all servers that have stored settings (used by the MacRumors poster).
function listGuildIds() {
  return Object.keys(data.guilds);
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

function getMeta(key) {
  return data.meta ? data.meta[key] : undefined;
}

function setMeta(key, value) {
  if (!data.meta) data.meta = {};
  data.meta[key] = value;
  saveData(data);
}

// ---------------------------------------------------------------------------
// Applications ("Bewerbungen") - stored per server, isolated the same way as
// everything else. `guilds[guildId].applyTypes` holds the configured roles you
// can apply for (label + ordered question list + an optional Discord role to
// grant on acceptance); `applications[guildId][applicationId]` holds every
// submitted application (so Accept/Deny buttons keep working across restarts).
// ---------------------------------------------------------------------------
function getApplyTypes(guildId) {
  return data.guilds[guildId]?.applyTypes || [];
}

function setApplyTypes(guildId, types) {
  return setGuildSetting(guildId, 'applyTypes', types);
}

function addApplication(guildId, record) {
  if (!data.applications) data.applications = {};
  if (!data.applications[guildId]) data.applications[guildId] = {};
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  data.applications[guildId][id] = { id, status: 'pending', ...record };
  saveData(data);
  return data.applications[guildId][id];
}

function getApplication(guildId, id) {
  return data.applications?.[guildId]?.[id] || null;
}

function updateApplication(guildId, id, patch) {
  if (!data.applications?.[guildId]?.[id]) return null;
  Object.assign(data.applications[guildId][id], patch);
  saveData(data);
  return data.applications[guildId][id];
}

// ---------------------------------------------------------------------------
// Giveaways - stored per server (giveaways[guildId][giveawayId]) so they survive
// restarts: the scheduler in giveaway-runtime.js simply picks them up again.
// ---------------------------------------------------------------------------
function getGiveaway(guildId, id) {
  return data.giveaways?.[guildId]?.[id] || null;
}

function listGiveaways(guildId) {
  return Object.values(data.giveaways?.[guildId] || {});
}

function saveGiveaway(guildId, record) {
  if (!data.giveaways) data.giveaways = {};
  if (!data.giveaways[guildId]) data.giveaways[guildId] = {};
  data.giveaways[guildId][record.id] = record;
  saveData(data);
  return record;
}

function updateGiveaway(guildId, id, patch) {
  const g = getGiveaway(guildId, id);
  if (!g) return null;
  Object.assign(g, patch);
  saveData(data);
  return g;
}

// Every ACTIVE giveaway of every server (for the auto-draw scheduler).
function listActiveGiveaways() {
  const out = [];
  for (const [guildId, byId] of Object.entries(data.giveaways || {})) {
    for (const g of Object.values(byId)) if (g.status === 'active') out.push({ guildId, giveaway: g });
  }
  return out;
}

// Adds/removes ONE entry and saves once. Returns true if the user is now entered.
function toggleGiveawayEntry(guildId, id, userId) {
  const g = getGiveaway(guildId, id);
  if (!g) return null;
  const idx = g.entries.indexOf(userId);
  if (idx === -1) g.entries.push(userId);
  else g.entries.splice(idx, 1);
  saveData(data);
  return idx === -1;
}

// Removes giveaways that ended/were cancelled more than `days` days ago.
function pruneGiveaways(days = 60) {
  const limit = Date.now() - days * 86400000;
  let removed = 0;
  for (const byId of Object.values(data.giveaways || {})) {
    for (const [id, g] of Object.entries(byId)) {
      if (g.status !== 'active' && (g.endedAt || g.endsAt || 0) < limit) {
        delete byId[id];
        removed++;
      }
    }
  }
  if (removed) saveData(data);
  return removed;
}

// ---------------------------------------------------------------------------
// Reports and partner requests - small per-server record collections.
// Records are numbered per server (#1, #2, ...) with a counter in the server's settings.
// ---------------------------------------------------------------------------
const COLLECTIONS = new Set(['reports', 'partners']);
const MAX_RECORDS_PER_GUILD = 500;

function nextCounter(guildId, key) {
  if (!data.guilds[guildId]) data.guilds[guildId] = {};
  const next = (data.guilds[guildId][key] || 0) + 1;
  data.guilds[guildId][key] = next;
  saveData(data);
  return next;
}

function assertCollection(name) {
  if (!COLLECTIONS.has(name)) throw new Error(`Unknown collection "${name}".`);
}

function getRecord(name, guildId, id) {
  assertCollection(name);
  return data[name]?.[guildId]?.[String(id)] || null;
}

function listRecords(name, guildId) {
  assertCollection(name);
  return Object.values(data[name]?.[guildId] || {});
}

function saveRecord(name, guildId, record) {
  assertCollection(name);
  if (!data[name]) data[name] = {};
  if (!data[name][guildId]) data[name][guildId] = {};
  data[name][guildId][String(record.id)] = record;

  // Keep the file small: when a server has too many records, drop the oldest FINISHED ones.
  const all = Object.values(data[name][guildId]);
  if (all.length > MAX_RECORDS_PER_GUILD) {
    const open = new Set(['open', 'in_progress', 'pending', 'accepted']);
    const finished = all.filter((r) => !open.has(r.status)).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    for (const r of finished.slice(0, all.length - MAX_RECORDS_PER_GUILD)) delete data[name][guildId][String(r.id)];
  }
  saveData(data);
  return record;
}

function updateRecord(name, guildId, id, patch) {
  const rec = getRecord(name, guildId, id);
  if (!rec) return null;
  Object.assign(rec, patch);
  saveData(data);
  return rec;
}

// ---------------------------------------------------------------------------
// Server rules (with versions) - one document per server.
// ---------------------------------------------------------------------------
function getRules(guildId) {
  return data.rules?.[guildId] || null;
}

function saveRules(guildId, rules) {
  if (!data.rules) data.rules = {};
  data.rules[guildId] = rules;
  saveData(data);
  return rules;
}

module.exports = {
  getGuildSettings,
  listGuildIds,
  setGuildSetting,
  removeGuildSetting,
  nextTicketNumber,
  addWarn,
  getWarns,
  clearWarns,
  nextCounter,
  getRecord,
  listRecords,
  saveRecord,
  updateRecord,
  getRules,
  saveRules,
  getGiveaway,
  listGiveaways,
  saveGiveaway,
  updateGiveaway,
  listActiveGiveaways,
  toggleGiveawayEntry,
  pruneGiveaways,
  getApplyTypes,
  setApplyTypes,
  addApplication,
  getApplication,
  updateApplication,
  getMeta,
  setMeta,
  reload,
};
