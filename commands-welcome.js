// commands-welcome.js
// Welcome-System: /welcome-setup (Konfiguration pro Server) + Handler für neue Mitglieder.
// Zugriff auf /welcome-setup (Administratoren) wird zentral in permissions.js geprüft.
//
// Benötigt den privilegierten Intent "Server Members Intent" (Developer Portal).
// Ohne ihn startet der Bot trotzdem (siehe index.js), das Welcome-System ist dann inaktiv.

const { SlashCommandBuilder, EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const storage = require('./storage');
const { EPHEMERAL, errText, truncate } = require('./util');
const logging = require('./logging');

const DEFAULT_PUBLIC = 'Welcome to the Server {user}! You are Member Number {number}';
const DEFAULT_DM = 'Welcome to **{server}**, {username}! You are Member Number {number}';

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
    .setDescription('Richtet das Welcome-System für diesen Server ein (ohne Optionen: aktuelle Einstellungen)')
    .addRoleOption((opt) => opt.setName('role').setDescription('Rolle, die neue Mitglieder automatisch erhalten').setRequired(false))
    .addChannelOption((opt) =>
      opt
        .setName('channel')
        .setDescription('Kanal für die öffentliche Willkommensnachricht')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false)
    )
    .addBooleanOption((opt) => opt.setName('dm').setDescription('Willkommensnachricht zusätzlich per DM senden?').setRequired(false))
    .addStringOption((opt) =>
      opt
        .setName('message')
        .setDescription('Eigener Text für den Kanal. Platzhalter: {user} {username} {server} {number}')
        .setMaxLength(500)
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('dm-message')
        .setDescription('Eigener DM-Text. Platzhalter: {user} {username} {server} {number}')
        .setMaxLength(500)
        .setRequired(false)
    )
    .addBooleanOption((opt) => opt.setName('reset').setDescription('Alle Welcome-Einstellungen dieses Servers löschen').setRequired(false)),

  async execute(interaction) {
    const guildId = interaction.guildId;

    if (interaction.options.getBoolean('reset')) {
      storage.removeGuildSetting(guildId, 'welcome');
      await interaction.reply({ content: '✅ Welcome-System zurückgesetzt und deaktiviert.', flags: EPHEMERAL });
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
        await interaction.reply({ content: '❌ Diese Rolle kann nicht automatisch vergeben werden (@everyone/Integrationsrolle).', flags: EPHEMERAL });
        return;
      }
      const me = await interaction.guild.members.fetchMe().catch(() => null);
      if (me && role.position >= me.roles.highest.position) {
        notes.push('⚠️ Die Rolle liegt über/auf meiner höchsten Rolle — ich kann sie nicht vergeben, bis du meine Rolle darüber schiebst.');
      }
      if (me && !me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        notes.push('⚠️ Mir fehlt die Berechtigung „Rollen verwalten“.');
      }
      cfg.roleId = role.id;
    }
    if (channel) {
      const me = await interaction.guild.members.fetchMe().catch(() => null);
      if (me && !channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
        notes.push(`⚠️ Ich darf in ${channel.toString()} nicht schreiben.`);
      }
      cfg.channelId = channel.id;
    }
    if (dm !== null) cfg.dmEnabled = dm;
    if (message) cfg.message = message;
    if (dmMessage) cfg.dmMessage = dmMessage;

    const changed = role || channel || dm !== null || message || dmMessage;
    if (changed) storage.setGuildSetting(guildId, 'welcome', cfg);

    const embed = new EmbedBuilder()
      .setTitle(changed ? '👋 Welcome-System gespeichert' : '👋 Welcome-System')
      .setColor(0x5865f2)
      .addFields(
        { name: 'Rolle', value: cfg.roleId ? `<@&${cfg.roleId}>` : 'Keine', inline: true },
        { name: 'Kanal', value: cfg.channelId ? `<#${cfg.channelId}>` : 'Keiner', inline: true },
        { name: 'DM', value: cfg.dmEnabled ? 'An' : 'Aus', inline: true },
        { name: 'Kanal-Text', value: truncate(cfg.message || DEFAULT_PUBLIC, 500) },
        { name: 'DM-Text', value: truncate(cfg.dmMessage || DEFAULT_DM, 500) }
      )
      .setFooter({ text: 'Platzhalter: {user} {username} {server} {number}' });
    if (notes.length) embed.addFields({ name: 'Hinweise', value: notes.join('\n') });

    await interaction.reply({ embeds: [embed], flags: EPHEMERAL });
  },
};

// Wird von index.js bei GuildMemberAdd aufgerufen. Wirft nie.
async function handleMemberAdd(member) {
  try {
    if (member.user.bot) return;
    const cfg = getWelcome(member.guild.id);
    if (!cfg.roleId && !cfg.channelId && !cfg.dmEnabled) return;

    const number = member.guild.memberCount;
    const ctx = { member, number };

    if (cfg.roleId) {
      try {
        const role = member.guild.roles.cache.get(cfg.roleId);
        if (!role) {
          console.warn(`Welcome: Rolle ${cfg.roleId} auf ${member.guild.id} existiert nicht mehr.`);
        } else {
          await member.roles.add(role, 'Welcome-System');
        }
      } catch (err) {
        console.warn(`Welcome: Rolle konnte auf ${member.guild.id} nicht vergeben werden:`, errText(err));
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
        console.warn(`Welcome: Nachricht auf ${member.guild.id} nicht gesendet:`, errText(err));
      }
    }

    if (cfg.dmEnabled) {
      try {
        await member.send(render(cfg.dmMessage || DEFAULT_DM, ctx));
      } catch (err) {
        // DMs deaktiviert - unkritisch
      }
    }
  } catch (err) {
    console.error('Welcome: unerwarteter Fehler:', err);
  }
  logging.logToGuild(member.client, member.guild.id, {
    title: '👋 Mitglied beigetreten',
    fields: [
      { name: 'Nutzer', value: `${member.user.tag} (${member.id})`, inline: true },
      { name: 'Mitglied Nr.', value: String(member.guild.memberCount), inline: true },
    ],
  });
}

module.exports = { welcomeSetup, handleMemberAdd, render, DEFAULT_PUBLIC };
