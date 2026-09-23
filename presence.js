// presence.js
// Bot-Status/Presence.
//
// WICHTIG (Discord-Einschränkung): Die Presence (Online/Idle/DND/Streaming ...)
// gehört zum BOT-USER selbst und ist damit GLOBAL für alle Server gleichzeitig -
// Discord bietet keine Möglichkeit, sie pro Server unterschiedlich zu setzen.
// "/status ist pro Server konfigurierbar" wird deshalb so umgesetzt: die zuletzt
// von einem berechtigten Nutzer getroffene Einstellung gilt bot-weit, es wird aber
// gespeichert, WER sie WO gesetzt hat (siehe /status). Automatikmodus zeigt sonst
// die aktuelle Serveranzahl an (Punkt 10) und aktualisiert sich selbst zurückhaltend.

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

function getConfig() {
  return storage.getMeta('presence') || { mode: 'auto' };
}

function setConfig(cfg) {
  storage.setMeta('presence', cfg);
}

// Setzt den Modus zurück auf "automatisch zeigt die Serveranzahl".
function setAuto(setBy) {
  setConfig({ mode: 'auto', setBy, setAt: Date.now() });
}

function setManualStatus(status, setBy) {
  const cfg = { ...getConfig(), mode: 'manual', status, setBy, setAt: Date.now() };
  delete cfg.activity;
  delete cfg.streaming;
  setConfig(cfg);
}

function setManualActivity(type, text, setBy) {
  setConfig({ ...getConfig(), mode: 'manual', activity: { type, text }, setBy, setAt: Date.now() });
}

function setManualStreaming(url, setBy) {
  setConfig({ ...getConfig(), mode: 'manual', streaming: { url }, status: 'online', setBy, setAt: Date.now() });
}

// Wendet die aktuell gespeicherte Konfiguration auf den Discord-Client an.
// Wird beim Start, regelmäßig (Auto-Modus) und nach jeder Änderung aufgerufen.
async function apply(client) {
  try {
    const cfg = getConfig();
    const guildCount = client.guilds.cache.size;

    if (cfg.mode !== 'manual') {
      client.user.setPresence({
        status: PresenceUpdateStatus.Online,
        activities: [{ name: `${guildCount} Server`, type: ActivityType.Watching }],
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
    console.warn('Presence konnte nicht gesetzt werden:', errText(err));
  }
}

module.exports = { getConfig, setAuto, setManualStatus, setManualActivity, setManualStreaming, apply, STATUS_MAP, ACTIVITY_TYPE_MAP };
