// commands-mod.js
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const storage = require('./storage');
const { sendModActionDM } = require('./dm-notify');

function isMissingPermError(err) {
  return err && (err.code === 50013 || err.code === '50013');
}

const kick = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kickt ein Mitglied vom Server')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .setDMPermission(false)
    .addUserOption((opt) => opt.setName('user').setDescription('Das zu kickende Mitglied').setRequired(true))
    .addStringOption((opt) => opt.setName('reason').setDescription('Grund für den Kick').setRequired(false)),

  async execute(interaction) {
    const member = interaction.options.getMember('user');
    const reason = interaction.options.getString('reason') || 'Kein Grund angegeben';

    if (!member) {
      await interaction.reply({ content: '❌ Dieses Mitglied konnte nicht gefunden werden.', ephemeral: true });
      return;
    }
    if (!member.kickable) {
      await interaction.reply({
        content: '❌ Ich kann dieses Mitglied nicht kicken (höhere Rolle oder fehlende Berechtigung).',
        ephemeral: true,
      });
      return;
    }

    try {
      await sendModActionDM(member.user, {
        action: 'kick',
        reason,
        moderatorTag: interaction.user.tag,
        guildName: interaction.guild.name,
      });
      await member.kick(reason);
      await interaction.reply(`👋 **${member.user.tag}** wurde gekickt. Grund: ${reason}`);
    } catch (err) {
      console.error('Fehler bei /kick:', err);
      await interaction.reply({
        content: isMissingPermError(err)
          ? '❌ Mir fehlt die Berechtigung, dieses Mitglied zu kicken.'
          : `❌ Fehler beim Kicken: ${err.message}`,
        ephemeral: true,
      });
    }
  },
};

const ban = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bannt ein Mitglied vom Server')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false)
    .addUserOption((opt) => opt.setName('user').setDescription('Das zu bannende Mitglied').setRequired(true))
    .addStringOption((opt) => opt.setName('reason').setDescription('Grund für den Bann').setRequired(false))
    .addIntegerOption((opt) =>
      opt
        .setName('delete_days')
        .setDescription('Nachrichten der letzten X Tage löschen (0-7)')
        .setMinValue(0)
        .setMaxValue(7)
        .setRequired(false)
    ),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'Kein Grund angegeben';
    const deleteDays = interaction.options.getInteger('delete_days') || 0;

    try {
      await sendModActionDM(targetUser, {
        action: 'ban',
        reason,
        moderatorTag: interaction.user.tag,
        guildName: interaction.guild.name,
      });
      await interaction.guild.members.ban(targetUser.id, {
        reason,
        deleteMessageSeconds: deleteDays * 86400,
      });
      await interaction.reply(`🔨 **${targetUser.tag}** wurde gebannt. Grund: ${reason}`);
    } catch (err) {
      console.error('Fehler bei /ban:', err);
      await interaction.reply({
        content: isMissingPermError(err)
          ? '❌ Mir fehlt die Berechtigung, dieses Mitglied zu bannen.'
          : `❌ Fehler beim Bannen: ${err.message}`,
        ephemeral: true,
      });
    }
  },
};

const timeout = {
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Versetzt ein Mitglied in Timeout (Auszeit)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addUserOption((opt) => opt.setName('user').setDescription('Das Mitglied').setRequired(true))
    .addIntegerOption((opt) =>
      opt.setName('minutes').setDescription('Dauer in Minuten (max. 40320 = 28 Tage)').setMinValue(1).setMaxValue(40320).setRequired(true)
    )
    .addStringOption((opt) => opt.setName('reason').setDescription('Grund für den Timeout').setRequired(false)),

  async execute(interaction) {
    const member = interaction.options.getMember('user');
    const minutes = interaction.options.getInteger('minutes');
    const reason = interaction.options.getString('reason') || 'Kein Grund angegeben';

    if (!member) {
      await interaction.reply({ content: '❌ Dieses Mitglied konnte nicht gefunden werden.', ephemeral: true });
      return;
    }

    try {
      await member.timeout(minutes * 60 * 1000, reason);
      await sendModActionDM(member.user, {
        action: 'timeout',
        reason,
        moderatorTag: interaction.user.tag,
        guildName: interaction.guild.name,
        durationMinutes: minutes,
      });
      await interaction.reply(`🔇 **${member.user.tag}** wurde für ${minutes} Minute(n) in Timeout versetzt. Grund: ${reason}`);
    } catch (err) {
      console.error('Fehler bei /timeout:', err);
      await interaction.reply({
        content: isMissingPermError(err)
          ? '❌ Mir fehlt die Berechtigung, dieses Mitglied in Timeout zu versetzen.'
          : `❌ Fehler beim Timeout: ${err.message}`,
        ephemeral: true,
      });
    }
  },
};

const warn = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Verwaltet Verwarnungen für Mitglieder')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Verwarnt ein Mitglied')
        .addUserOption((opt) => opt.setName('user').setDescription('Das Mitglied').setRequired(true))
        .addStringOption((opt) => opt.setName('reason').setDescription('Grund der Verwarnung').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('Zeigt alle Verwarnungen eines Mitglieds')
        .addUserOption((opt) => opt.setName('user').setDescription('Das Mitglied').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('clear')
        .setDescription('Löscht alle Verwarnungen eines Mitglieds')
        .addUserOption((opt) => opt.setName('user').setDescription('Das Mitglied').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const targetUser = interaction.options.getUser('user');
    const guildId = interaction.guild.id;

    if (sub === 'add') {
      const reason = interaction.options.getString('reason');
      const entry = {
        reason,
        date: new Date().toISOString(),
        moderatorId: interaction.user.id,
      };
      const all = storage.addWarn(guildId, targetUser.id, entry);
      const dmSent = await sendModActionDM(targetUser, {
        action: 'warn',
        reason,
        moderatorTag: interaction.user.tag,
        guildName: interaction.guild.name,
      });
      await interaction.reply(
        `⚠️ **${targetUser.tag}** wurde verwarnt. Grund: ${reason}\nAnzahl Verwarnungen: ${all.length}` +
          (dmSent ? '' : '\n_(Hinweis: DM konnte nicht zugestellt werden - Nutzer hat DMs evtl. deaktiviert.)_')
      );
      return;
    }

    if (sub === 'list') {
      const entries = storage.getWarns(guildId, targetUser.id);
      if (entries.length === 0) {
        await interaction.reply({ content: `${targetUser.tag} hat keine Verwarnungen.`, ephemeral: true });
        return;
      }
      const embed = new EmbedBuilder()
        .setTitle(`⚠️ Verwarnungen von ${targetUser.tag}`)
        .setColor(0xfee75c)
        .setDescription(
          entries
            .map((e, i) => `**#${i + 1}** — ${e.reason}\n<t:${Math.floor(new Date(e.date).getTime() / 1000)}:R> von <@${e.moderatorId}>`)
            .join('\n\n')
        );
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (sub === 'clear') {
      storage.clearWarns(guildId, targetUser.id);
      await interaction.reply(`🧹 Alle Verwarnungen von **${targetUser.tag}** wurden gelöscht.`);
      return;
    }
  },
};

const clear = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Löscht mehrere Nachrichten in diesem Kanal')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addIntegerOption((opt) =>
      opt.setName('anzahl').setDescription('Wie viele Nachrichten gelöscht werden sollen (1-100)').setMinValue(1).setMaxValue(100).setRequired(true)
    ),

  async execute(interaction) {
    const amount = interaction.options.getInteger('anzahl');

    await interaction.deferReply({ ephemeral: true });

    try {
      const deleted = await interaction.channel.bulkDelete(amount, true);
      await interaction.editReply(`🧹 ${deleted.size} Nachricht(en) gelöscht.`);
    } catch (err) {
      console.error('Fehler bei /clear:', err);
      await interaction.editReply(
        isMissingPermError(err)
          ? '❌ Mir fehlt die Berechtigung, Nachrichten in diesem Kanal zu löschen.'
          : `❌ Fehler beim Löschen: ${err.message} (Discord kann nur Nachrichten löschen, die jünger als 14 Tage sind.)`
      );
    }
  },
};

const slowmode = {
  data: new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Setzt den Slowmode (Verzögerung) für diesen Kanal')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false)
    .addIntegerOption((opt) =>
      opt
        .setName('sekunden')
        .setDescription('Verzögerung in Sekunden (0 = aus, max. 21600 = 6 Stunden)')
        .setMinValue(0)
        .setMaxValue(21600)
        .setRequired(true)
    ),

  async execute(interaction) {
    const seconds = interaction.options.getInteger('sekunden');
    try {
      await interaction.channel.setRateLimitPerUser(seconds, `Gesetzt von ${interaction.user.tag}`);
      await interaction.reply(
        seconds === 0 ? '✅ Slowmode wurde deaktiviert.' : `✅ Slowmode auf ${seconds} Sekunde(n) gesetzt.`
      );
    } catch (err) {
      console.error('Fehler bei /slowmode:', err);
      await interaction.reply({
        content: isMissingPermError(err)
          ? '❌ Mir fehlt die Berechtigung, den Slowmode zu ändern.'
          : `❌ Fehler: ${err.message}`,
        ephemeral: true,
      });
    }
  },
};

const lock = {
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Sperrt diesen Kanal für @everyone (keine Nachrichten mehr)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false),

  async execute(interaction) {
    try {
      await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
        SendMessages: false,
      });
      await interaction.reply('🔒 Kanal wurde gesperrt - @everyone kann keine Nachrichten mehr senden.');
    } catch (err) {
      console.error('Fehler bei /lock:', err);
      await interaction.reply({
        content: isMissingPermError(err)
          ? '❌ Mir fehlt die Berechtigung, diesen Kanal zu sperren.'
          : `❌ Fehler: ${err.message}`,
        ephemeral: true,
      });
    }
  },
};

const unlock = {
  data: new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Entsperrt diesen Kanal wieder für @everyone')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false),

  async execute(interaction) {
    try {
      await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
        SendMessages: null,
      });
      await interaction.reply('🔓 Kanal wurde entsperrt.');
    } catch (err) {
      console.error('Fehler bei /unlock:', err);
      await interaction.reply({
        content: isMissingPermError(err)
          ? '❌ Mir fehlt die Berechtigung, diesen Kanal zu entsperren.'
          : `❌ Fehler: ${err.message}`,
        ephemeral: true,
      });
    }
  },
};

const nickname = {
  data: new SlashCommandBuilder()
    .setName('nickname')
    .setDescription('Ändert den Servernamen (Nickname) eines Mitglieds')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .setDMPermission(false)
    .addUserOption((opt) => opt.setName('user').setDescription('Das Mitglied').setRequired(true))
    .addStringOption((opt) =>
      opt.setName('name').setDescription('Neuer Nickname (leer lassen zum Zurücksetzen)').setRequired(false)
    ),

  async execute(interaction) {
    const member = interaction.options.getMember('user');
    const name = interaction.options.getString('name') || null;

    if (!member) {
      await interaction.reply({ content: '❌ Dieses Mitglied konnte nicht gefunden werden.', ephemeral: true });
      return;
    }

    try {
      await member.setNickname(name);
      await interaction.reply(name ? `✅ Nickname von **${member.user.tag}** geändert zu **${name}**.` : `✅ Nickname von **${member.user.tag}** zurückgesetzt.`);
    } catch (err) {
      console.error('Fehler bei /nickname:', err);
      await interaction.reply({
        content: isMissingPermError(err)
          ? '❌ Mir fehlt die Berechtigung, den Nickname dieses Mitglieds zu ändern (evtl. höhere Rolle).'
          : `❌ Fehler: ${err.message}`,
        ephemeral: true,
      });
    }
  },
};

module.exports = { kick, ban, timeout, warn, clear, slowmode, lock, unlock, nickname };
