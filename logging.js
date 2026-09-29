// logging.js
// Central bot logging into the per-server configured log channel (see
// /settings log-channel). Called by mod commands, tickets, the welcome
// system, setting changes, and errors.
//
// NEVER logs secrets/tokens/API keys - only the unrelated fields passed in
// here (title/description/fields) are ever sent.

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
    console.warn(`Logging: could not send message on ${guildId}:`, errText(err));
  }
}

// Short helper for moderation actions (kick/ban/timeout/warn/clear/lock/unlock/nickname).
function logModAction(client, guildId, { action, target, moderator, reason }) {
  return logToGuild(client, guildId, {
    title: `⚖️ ${action}`,
    fields: [
      { name: 'User', value: target ? `${target}` : 'Unknown', inline: true },
      { name: 'By', value: moderator ? `${moderator}` : 'Unknown', inline: true },
      { name: 'Reason', value: reason || 'No reason given' },
    ],
    level: 'warn',
  });
}

function logSettingChange(client, guildId, { setting, value, moderator }) {
  return logToGuild(client, guildId, {
    title: '⚙️ Setting changed',
    fields: [
      { name: 'Setting', value: setting, inline: true },
      { name: 'New value', value: value ?? 'removed', inline: true },
      { name: 'By', value: moderator ? `${moderator}` : 'Unknown', inline: true },
    ],
  });
}

function logError(client, guildId, err, context) {
  return logToGuild(client, guildId, {
    title: '❌ Error',
    description: context ? `Context: ${context}` : undefined,
    fields: [{ name: 'Message', value: errText(err) }],
    level: 'error',
  });
}

module.exports = { logToGuild, logModAction, logSettingChange, logError };
