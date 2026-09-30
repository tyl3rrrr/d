// commands-welcome.js
// Welcome system: /welcome-setup (per-server configuration) + handler for new
// members. Access to /welcome-setup (administrators) is checked centrally in
// permissions.js.
//
// Requires the privileged "Server Members Intent" (Developer Portal). Without
// it, the bot still starts (see index.js), but the welcome system stays inactive.

const { SlashCommandBuilder, EmbedBuilder, ChannelType, PermissionFlagsBits, GatewayIntentBits } = require('discord.js');
const storage = require('./storage');
const { EPHEMERAL, errText, truncate } = require('./util');
const logging = require('./logging');

// Checks whether the CURRENTLY RUNNING bot process actually has the
// privileged "Server Members Intent" active. If it isn't enabled in the
// Discord Developer Portal, the bot automatically starts WITHOUT it (see
// index.js, INTENT_PLANS) - then Discord never fires GuildMemberAdd, and the
// entire welcome system stays inert despite being configured correctly. This
// used to be visible only in the console - now it shows up as a clear
// warning directly in /welcome-setup.
function hasMembersIntent(client) {
  try {
    return client.options.intents.has(GatewayIntentBits.GuildMembers);
  } catch (err) {
    return true; // when in doubt, don't show a false warning
  }
}

const DEFAULT_PUBLIC = 'Welcome to the Server {user}! You are Member Number {number}';
const DEFAULT_DM = 'Hello {user}, enjoy your time on **{server}**! Be respectful and nice!';

function render(template, { member, number }) {
  return String(template)
    .replaceAll('{user}', `<@${member.id}>`)
    .replaceAll('{username}', member.user.username)
    .replaceAll('{server}', member.guild.name)
    .replaceAll('{number}', String(number));
}

function getWelcome(guildId) {
  return storage.getGuildSettings(guildId).welcome || {};
}

const welcomeSetup = {
  data: new SlashCommandBuilder()
    .setName('welcome-setup')
    .setDescription('Sets up the welcome system for this server (no options: shows current settings)')
    .addRoleOption((opt) => opt.setName('role').setDescription('Role automatically granted to new members').setRequired(false))
    .addChannelOption((opt) =>
      opt
        .setName('channel')
        .setDescription('Channel for the public welcome message')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false)
    )
    .addBooleanOption((opt) => opt.setName('dm').setDescription('Also send the welcome message via DM?').setRequired(false))
    .addStringOption((opt) =>
      opt
        .setName('message')
        .setDescription('Custom text for the channel. Placeholders: {user} {username} {server} {number}')
        .setMaxLength(500)
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('dm-message')
        .setDescription('Custom DM text. Placeholders: {user} {username} {server} {number}')
        .setMaxLength(500)
        .setRequired(false)
    )
    .addBooleanOption((opt) => opt.setName('reset').setDescription('Delete all welcome settings for this server').setRequired(false)),

  async execute(interaction) {
    const guildId = interaction.guildId;

    if (interaction.options.getBoolean('reset')) {
      storage.removeGuildSetting(guildId, 'welcome');
      await interaction.reply({ content: '✅ Welcome system reset and disabled.', flags: EPHEMERAL });
      return;
    }

    const role = interaction.options.getRole('role');
    const channel = interaction.options.getChannel('channel');
    const dm = interaction.options.getBoolean('dm');
    const message = interaction.options.getString('message');
    const dmMessage = interaction.options.getString('dm-message');

    const cfg = { ...getWelcome(guildId) };
    const notes = [];

    if (role) {
      if (role.id === guildId || role.managed) {
        await interaction.reply({ content: "❌ This role can't be auto-assigned (@everyone/integration role).", flags: EPHEMERAL });
        return;
      }
      const me = await interaction.guild.members.fetchMe().catch(() => null);
      if (me && role.position >= me.roles.highest.position) {
        notes.push("⚠️ That role is above/at my highest role — I can't assign it until you move my role above it.");
      }
      if (me && !me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        notes.push('⚠️ I\'m missing the "Manage Roles" permission.');
      }
      cfg.roleId = role.id;
    }
    if (channel) {
      const me = await interaction.guild.members.fetchMe().catch(() => null);
      if (me && !channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
        notes.push(`⚠️ I'm not allowed to post in ${channel.toString()}.`);
      }
      cfg.channelId = channel.id;
    }
    if (dm !== null) cfg.dmEnabled = dm;
    if (message) cfg.message = message;
    if (dmMessage) cfg.dmMessage = dmMessage;

    const changed = role || channel || dm !== null || message || dmMessage;
    if (changed) storage.setGuildSetting(guildId, 'welcome', cfg);

    const embed = new EmbedBuilder()
      .setTitle(changed ? '👋 Welcome system saved' : '👋 Welcome system')
      .setColor(0x5865f2)
      .addFields(
        { name: 'Role', value: cfg.roleId ? `<@&${cfg.roleId}>` : 'None', inline: true },
        { name: 'Channel', value: cfg.channelId ? `<#${cfg.channelId}>` : 'None', inline: true },
        { name: 'DM', value: cfg.dmEnabled ? 'On' : 'Off', inline: true },
        { name: 'Channel text', value: truncate(cfg.message || DEFAULT_PUBLIC, 500) },
        { name: 'DM text', value: truncate(cfg.dmMessage || DEFAULT_DM, 500) }
      )
      .setFooter({ text: 'Placeholders: {user} {username} {server} {number}' });
    if (notes.length) embed.addFields({ name: 'Notes', value: notes.join('\n') });

    if (!hasMembersIntent(interaction.client)) {
      embed.addFields({
        name: '🚨 The welcome system is currently INACTIVE',
        value:
          'The privileged **"SERVER MEMBERS INTENT"** is not enabled in the Discord Developer Portal - ' +
          'so right now NO message is sent and NO role is granted, no matter what these settings say. ' +
          'Fix it: https://discord.com/developers/applications -> your app -> **Bot** -> ' +
          '**Privileged Gateway Intents** -> enable **SERVER MEMBERS INTENT**, save, restart the bot.',
      });
    }

    await interaction.reply({ embeds: [embed], flags: EPHEMERAL });
  },
};

// Called by index.js on GuildMemberAdd. Never throws.
async function handleMemberAdd(member) {
  try {
    // Per an explicit request, bots are greeted too (no exclusion anymore).
    const cfg = getWelcome(member.guild.id);
    if (!cfg.roleId && !cfg.channelId && !cfg.dmEnabled) return;

    const number = member.guild.memberCount;
    const ctx = { member, number };

    if (cfg.roleId) {
      try {
        const role = member.guild.roles.cache.get(cfg.roleId);
        if (!role) {
          console.warn(`Welcome: role ${cfg.roleId} on ${member.guild.id} no longer exists.`);
        } else {
          await member.roles.add(role, 'Welcome system');
        }
      } catch (err) {
        console.warn(`Welcome: could not grant role on ${member.guild.id}:`, errText(err));
      }
    }

    if (cfg.channelId) {
      try {
        const ch = member.guild.channels.cache.get(cfg.channelId);
        if (ch && ch.isTextBased()) {
          await ch.send({
            content: render(cfg.message || DEFAULT_PUBLIC, ctx),
            allowedMentions: { users: [member.id] },
          });
        }
      } catch (err) {
        console.warn(`Welcome: could not send message on ${member.guild.id}:`, errText(err));
      }
    }

    if (cfg.dmEnabled) {
      try {
        await member.send(render(cfg.dmMessage || DEFAULT_DM, ctx));
      } catch (err) {
        // DMs disabled - not critical
      }
    }
  } catch (err) {
    console.error('Welcome: unexpected error:', err);
  }
  logging.logToGuild(member.client, member.guild.id, {
    title: '👋 Member joined',
    fields: [
      { name: 'User', value: `${member.user.tag} (${member.id})`, inline: true },
      { name: 'Member #', value: String(member.guild.memberCount), inline: true },
    ],
  });
}

module.exports = { welcomeSetup, handleMemberAdd, render, DEFAULT_PUBLIC };
