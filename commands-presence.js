// commands-presence.js
// /bot-status - bot owner only (see reasoning below), several subcommands
// /bstatnow   - the hardcoded superuser ID only, detailed presence config
//
// Naming note: Discord requires slash command names to be ENTIRELY
// lowercase. "bStatNow" (with capitals) is rejected by discord.js at
// creation time (ExpectedConstraintError) and crashes the whole bot process
// - that's why this command is deliberately called "bstatnow".
//
// WHY /bot-status IS NOT delegated to regular server administrators:
// Discord presence (Online/Idle/DND/Streaming) belongs to the bot's ONE
// gateway connection and is therefore NECESSARILY identical across ALL
// servers at once - Discord provides no per-server separation for this.
// If this command were open to every server's administrator, an admin of
// ANY server the bot is in could change the status on EVERY OTHER server -
// which looks exactly like "other people can affect my server" and is not
// what anyone wants. So this command is restricted to the bot owner (see
// config.js, OWNER_ID/superuser) - the one person already responsible for
// the bot across every server it runs on.
// Access is checked centrally in permissions.js (access: 'bot-owner' / 'superuser').

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const presence = require('./presence');
const config = require('./config');
const { EPHEMERAL } = require('./util');

const STATUS_CHOICES = [
  { name: 'Online', value: 'online' },
  { name: 'Idle / AFK', value: 'idle' },
  { name: 'Do Not Disturb', value: 'dnd' },
  { name: 'Invisible / Offline', value: 'invisible' },
];
const ACTIVITY_CHOICES = [
  { name: 'Playing', value: 'playing' },
  { name: 'Watching', value: 'watching' },
  { name: 'Listening', value: 'listening' },
];

function describeConfig(cfg) {
  if (cfg.mode !== 'manual') return 'Automatic (shows the current server count)';
  if (cfg.streaming) return `Streaming - ${cfg.streaming.url}`;
  if (cfg.activity) return `${cfg.status || 'online'} - ${cfg.activity.type} ${cfg.activity.text}`;
  return cfg.status || 'online';
}

function historyLines(cfg) {
  const history = Array.isArray(cfg.history) ? cfg.history : [];
  if (history.length === 0) return 'No changes recorded yet.';
  return history
    .slice(0, 5)
    .map((h) => `<t:${Math.floor(h.at / 1000)}:R> — **${h.action}** by ${h.by || 'unknown'}`)
    .join('\n');
}

// Note: "/status" is already taken in this bot by the EXISTING command that
// checks whether the website is reachable (commands-core.js) - per the brief,
// existing functionality is not removed without an explicit request. That's
// why this command is called "/bot-status".
const botStatus = {
  data: new SlashCommandBuilder()
    .setName('bot-status')
    .setDescription('Bot owner only: manage the bot online status (technically bot-wide, not per server)')
    .addSubcommand((sub) => sub.setName('view').setDescription('Shows the current status and recent change history'))
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Sets the online status, and optionally a custom activity')
        .addStringOption((o) => o.setName('status').setDescription('Online status').setRequired(true).addChoices(...STATUS_CHOICES))
        .addStringOption((o) => o.setName('activity-type').setDescription('Type of activity (optional)').setRequired(false).addChoices(...ACTIVITY_CHOICES))
        .addStringOption((o) => o.setName('activity-text').setDescription('Activity text (optional, needs activity-type)').setRequired(false).setMaxLength(128))
    )
    .addSubcommand((sub) =>
      sub
        .setName('streaming')
        .setDescription(`Sets the status to Twitch streaming (default name: ${config.TWITCH_DEFAULT_NAME})`)
        .addStringOption((o) => o.setName('url').setDescription('Twitch URL (optional, overrides the default name)').setRequired(false))
    )
    .addSubcommand((sub) => sub.setName('clear-activity').setDescription('Keeps the current status but removes any custom activity/streaming'))
    .addSubcommand((sub) => sub.setName('auto').setDescription('Switches back to automatic mode (shows the current server count)')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const who = `${interaction.user.tag} (from: ${interaction.guild.name})`;

    if (sub === 'view') {
      const cfg = presence.getConfig();
      const embed = new EmbedBuilder()
        .setTitle('🤖 Bot Status')
        .setColor(0x5865f2)
        .addFields(
          { name: 'Current', value: describeConfig(cfg) },
          { name: 'Last changed by', value: cfg.setBy || 'unknown', inline: true },
          { name: 'Last changed at', value: cfg.setAt ? `<t:${Math.floor(cfg.setAt / 1000)}:R>` : 'never', inline: true },
          { name: 'Recent history', value: historyLines(cfg) }
        )
        .setFooter({ text: 'Presence is bot-wide, not per server - see the command description.' });
      await interaction.reply({ embeds: [embed], flags: EPHEMERAL });
      return;
    }

    if (sub === 'auto') {
      presence.setAuto(who);
      await presence.apply(interaction.client);
      await interaction.reply({ content: '✅ Switched back to automatic mode (shows the current server count).', flags: EPHEMERAL });
      return;
    }

    if (sub === 'clear-activity') {
      presence.clearActivity(who);
      await presence.apply(interaction.client);
      await interaction.reply({ content: '✅ Custom activity/streaming removed - status kept as-is.', flags: EPHEMERAL });
      return;
    }

    if (sub === 'streaming') {
      const url = interaction.options.getString('url') || `https://www.twitch.tv/${config.TWITCH_DEFAULT_NAME}`;
      presence.setManual({ streamingUrl: url, setBy: who });
      await presence.apply(interaction.client);
      await interaction.reply({ content: `✅ Status set to Twitch streaming (${url}).`, flags: EPHEMERAL });
      return;
    }

    if (sub === 'set') {
      const status = interaction.options.getString('status');
      const activityType = interaction.options.getString('activity-type');
      const activityText = interaction.options.getString('activity-text');
      if (activityType && !activityText) {
        await interaction.reply({ content: '❌ `activity-text` is required when `activity-type` is set.', flags: EPHEMERAL });
        return;
      }
      presence.setManual({ status, activityType, activityText, setBy: who });
      await presence.apply(interaction.client);
      await interaction.reply({
        content:
          `✅ Bot status set to **${status}**${activityText ? ` (${activityType}: ${activityText})` : ''}.\n` +
          'ℹ️ Note: Discord presence belongs to the bot account and therefore applies to **all** servers at once ' +
          '(Discord does not support a different presence per server) - the most recently chosen setting wins.',
        flags: EPHEMERAL,
      });
    }
  },
};

const bstatnow = {
  data: new SlashCommandBuilder()
    .setName('bstatnow')
    .setDescription('Superuser only: detailed bot presence configuration')
    .addSubcommand((s) => s.setName('config').setDescription('Shows the available options and the current state'))
    .addSubcommand((s) =>
      s
        .setName('set-status')
        .setDescription('Sets the online status')
        .addStringOption((o) => o.setName('status').setDescription('Status').setRequired(true).addChoices(...STATUS_CHOICES))
    )
    .addSubcommand((s) =>
      s
        .setName('streaming')
        .setDescription(`Enables Twitch streaming (default: ${config.TWITCH_DEFAULT_NAME})`)
        .addStringOption((o) => o.setName('url').setDescription('Alternate Twitch URL (optional)').setRequired(false))
    )
    .addSubcommand((s) =>
      s
        .setName('activity')
        .setDescription('Sets an activity (Playing/Watching/Listening)')
        .addStringOption((o) => o.setName('type').setDescription('Type').setRequired(true).addChoices(...ACTIVITY_CHOICES))
        .addStringOption((o) => o.setName('text').setDescription('Activity text').setRequired(true).setMaxLength(128))
    )
    .addSubcommand((s) => s.setName('auto').setDescription('Switches back to automatic mode (shows the current server count)')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const who = `${interaction.user.tag} (superuser)`;

    if (sub === 'config') {
      const cfg = presence.getConfig();
      const embed = new EmbedBuilder()
        .setTitle('⚙️ Bot Presence Configuration')
        .setColor(0x5865f2)
        .addFields(
          { name: 'Available subcommands', value: '`config` `set-status` `streaming` `activity` `auto`' },
          { name: 'Current mode', value: cfg.mode === 'auto' ? 'Automatic (server count)' : 'Manual', inline: true },
          { name: 'Last set by', value: cfg.setBy || 'unknown', inline: true },
          { name: 'Recent history', value: historyLines(cfg) }
        );
      await interaction.reply({ embeds: [embed], flags: EPHEMERAL });
      return;
    }

    if (sub === 'set-status') {
      presence.setManual({ status: interaction.options.getString('status'), setBy: who });
    } else if (sub === 'streaming') {
      const url = interaction.options.getString('url') || `https://www.twitch.tv/${config.TWITCH_DEFAULT_NAME}`;
      presence.setManual({ streamingUrl: url, setBy: who });
    } else if (sub === 'activity') {
      presence.setManual({ activityType: interaction.options.getString('type'), activityText: interaction.options.getString('text'), setBy: who });
    } else if (sub === 'auto') {
      presence.setAuto(who);
    }

    await presence.apply(interaction.client);
    await interaction.reply({ content: `✅ Presence updated (${sub}).`, flags: EPHEMERAL });
  },
};

module.exports = { botStatus, bstatnow };
