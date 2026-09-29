// presence.js
// Bot online status/presence.
//
// IMPORTANT (Discord limitation): presence (Online/Idle/DND/Streaming ...)
// belongs to the BOT USER itself and is therefore GLOBAL across every server
// at once - Discord offers no way to set it differently per server. See
// commands-presence.js for the full reasoning on who is allowed to touch it.
// The "automatic" mode instead shows the current server count and refreshes
// itself sparingly.

const { ActivityType, PresenceUpdateStatus } = require('discord.js');
const storage = require('./storage');
const config = require('./config');
const { errText } = require('./util');

const STATUS_MAP = {
  online: PresenceUpdateStatus.Online,
  idle: PresenceUpdateStatus.Idle,
  dnd: PresenceUpdateStatus.DoNotDisturb,
  invisible: PresenceUpdateStatus.Invisible,
};
const ACTIVITY_TYPE_MAP = { playing: ActivityType.Playing, watching: ActivityType.Watching, listening: ActivityType.Listening };

const MAX_HISTORY = 10;

function getConfig() {
  return storage.getMeta('presence') || { mode: 'auto', history: [] };
}

function pushHistory(cfg, entry) {
  const history = Array.isArray(cfg.history) ? cfg.history : [];
  history.unshift({ ...entry, at: Date.now() });
  return history.slice(0, MAX_HISTORY);
}

function setConfig(cfg) {
  storage.setMeta('presence', cfg);
}

// Switches back to "automatic - shows the current server count".
function setAuto(setBy) {
  const cfg = getConfig();
  setConfig({ mode: 'auto', setBy, setAt: Date.now(), history: pushHistory(cfg, { action: 'auto', by: setBy }) });
}

// Sets status (online/idle/dnd/invisible) and, optionally, a custom activity
// or streaming link in one go. Passing null for a field clears it.
function setManual({ status, activityType, activityText, streamingUrl, setBy }) {
  const cfg = getConfig();
  const next = { ...cfg, mode: 'manual', setBy, setAt: Date.now() };
  if (status) next.status = status;
  if (streamingUrl) {
    next.streaming = { url: streamingUrl };
    delete next.activity;
  } else if (activityType && activityText) {
    next.activity = { type: activityType, text: activityText };
    delete next.streaming;
  }
  next.history = pushHistory(cfg, { action: 'set', by: setBy, status, activityType, activityText, streamingUrl });
  setConfig(next);
  return next;
}

// Keeps the current status but removes any custom activity/streaming link.
function clearActivity(setBy) {
  const cfg = getConfig();
  const next = { ...cfg, mode: 'manual', setBy, setAt: Date.now() };
  delete next.activity;
  delete next.streaming;
  next.history = pushHistory(cfg, { action: 'clear-activity', by: setBy });
  setConfig(next);
  return next;
}

// Applies the currently stored configuration to the Discord client. Called
// on startup, periodically (in automatic mode), and after every change.
async function apply(client) {
  try {
    const cfg = getConfig();
    const guildCount = client.guilds.cache.size;

    if (cfg.mode !== 'manual') {
      client.user.setPresence({
        status: PresenceUpdateStatus.Online,
        activities: [{ name: `${guildCount} servers`, type: ActivityType.Watching }],
      });
      return;
    }

    const status = STATUS_MAP[cfg.status] || PresenceUpdateStatus.Online;
    if (cfg.streaming) {
      client.user.setPresence({
        status: PresenceUpdateStatus.Online,
        activities: [{ name: `Twitch: ${config.TWITCH_DEFAULT_NAME}`, type: ActivityType.Streaming, url: cfg.streaming.url }],
      });
      return;
    }
    if (cfg.activity) {
      client.user.setPresence({
        status,
        activities: [{ name: cfg.activity.text, type: ACTIVITY_TYPE_MAP[cfg.activity.type] || ActivityType.Playing }],
      });
      return;
    }
    client.user.setPresence({ status, activities: [] });
  } catch (err) {
    console.warn('Could not set presence:', errText(err));
  }
}

module.exports = { getConfig, setAuto, setManual, clearActivity, apply, STATUS_MAP, ACTIVITY_TYPE_MAP, MAX_HISTORY };
