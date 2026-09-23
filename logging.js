// logging.js
// Zentrales Bot-Logging in den per Server konfigurierten Log-Kanal
// (siehe /settings log-channel). Wird von Mod-Commands, Tickets, dem
// Welcome-System, Einstellungsänderungen und Fehlern aufgerufen.
//
// Loggt NIEMALS Secrets/Tokens/API-Keys - es werden ausschließlich die
// hier übergebenen, unkritischen Felder (Titel/Beschreibung/Felder) verschickt.

const { EmbedBuilder } = require('discord.js');
const storage = require('./storage');
const { errText } = require('./util');

const COLORS = { info: 0x5865f2, success: 0x57f287, warn: 0xfee75c, error: 0xed4245 };

async function logToGuild(client, guildId, { title, description, fields, level = 'info' }) {
  try {
    const settings = storage.getGuildSettings(guildId);
    if (!settings.logChannelId) return;
    const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
    if (!guild) return;
    const channel = guild.channels.cache.get(settings.logChannelId) || (await guild.channels.fetch(settings.logChannelId).catch(() => null));
    if (!channel || !channel.isTextBased()) return;

    const embed = new EmbedBuilder().setTitle(title).setColor(COLORS[level] || COLORS.info).setTimestamp();
    if (description) embed.setDescription(description);
    if (fields && fields.length) embed.addFields(fields);
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (err) {
    console.warn(`Logging: Nachricht auf ${guildId} konnte nicht gesendet werden:`, errText(err));
  }
}

// Kurzhelfer für Moderationsaktionen (kick/ban/timeout/warn/clear/lock/unlock/nickname).
function logModAction(client, guildId, { action, target, moderator, reason }) {
  return logToGuild(client, guildId, {
    title: `⚖️ ${action}`,
    fields: [
      { name: 'Nutzer', value: target ? `${target}` : 'Unbekannt', inline: true },
      { name: 'Von', value: moderator ? `${moderator}` : 'Unbekannt', inline: true },
      { name: 'Grund', value: reason || 'Kein Grund angegeben' },
    ],
    level: 'warn',
  });
}

function logSettingChange(client, guildId, { setting, value, moderator }) {
  return logToGuild(client, guildId, {
    title: '⚙️ Einstellung geändert',
    fields: [
      { name: 'Einstellung', value: setting, inline: true },
      { name: 'Neuer Wert', value: value ?? 'entfernt', inline: true },
      { name: 'Von', value: moderator ? `${moderator}` : 'Unbekannt', inline: true },
    ],
  });
}

function logError(client, guildId, err, context) {
  return logToGuild(client, guildId, {
    title: '❌ Fehler',
    description: context ? `Kontext: ${context}` : undefined,
    fields: [{ name: 'Meldung', value: errText(err) }],
    level: 'error',
  });
}

module.exports = { logToGuild, logModAction, logSettingChange, logError };
