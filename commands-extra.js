// commands-extra.js
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

function isMissingPermError(err) {
  return err && (err.code === 50013 || err.code === '50013');
}

const ping = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Zeigt die aktuelle Verbindungs-Latenz'),
  async execute(interaction) {
    const sent = Date.now();
    await interaction.reply('🏓 Pinge...');
    const roundtrip = Date.now() - sent;
    const wsPing = Math.round(interaction.client.ws.ping);
    await interaction.editReply(`🏓 Pong! Bot-Antwortzeit: ${roundtrip} ms | WebSocket: ${wsPing} ms`);
  },
};

const remindme = {
  data: new SlashCommandBuilder()
    .setName('remindme')
    .setDescription('Erinnert dich per Nachricht nach einer bestimmten Zeit')
    .addIntegerOption((opt) =>
      opt.setName('minuten').setDescription('In wie vielen Minuten?').setMinValue(1).setMaxValue(1440).setRequired(true)
    )
    .addStringOption((opt) => opt.setName('text').setDescription('Woran soll erinnert werden?').setRequired(true)),

  async execute(interaction) {
    const minutes = interaction.options.getInteger('minuten');
    const text = interaction.options.getString('text');

    await interaction.reply({
      content: `⏰ Ok, ich erinnere dich in ${minutes} Minute(n) an: "${text}"`,
      ephemeral: true,
    });

    // Hinweis: Läuft nur im Arbeitsspeicher - geht bei einem Neustart des
    // Bots verloren. Für wichtige/lange Erinnerungen ggf. selbst notieren.
    setTimeout(() => {
      interaction.followUp({ content: `⏰ <@${interaction.user.id}> Erinnerung: ${text}` }).catch(() => {});
    }, minutes * 60 * 1000);
  },
};

const suggest = {
  data: new SlashCommandBuilder()
    .setName('suggest')
    .setDescription('Postet einen Vorschlag in diesem Kanal (mit Abstimmungs-Reaktionen)')
    .addStringOption((opt) => opt.setName('vorschlag').setDescription('Dein Vorschlag').setRequired(true)),

  async execute(interaction) {
    const text = interaction.options.getString('vorschlag');
    const embed = new EmbedBuilder()
      .setTitle('💡 Neuer Vorschlag')
      .setDescription(text)
      .setColor(0x5865f2)
      .setFooter({ text: `Vorgeschlagen von ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
    const message = await interaction.fetchReply();
    await message.react('👍').catch(() => {});
    await message.react('👎').catch(() => {});
  },
};

const role = {
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Gibt einem Mitglied eine Rolle oder entfernt sie')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Gibt einem Mitglied eine Rolle')
        .addUserOption((opt) => opt.setName('user').setDescription('Das Mitglied').setRequired(true))
        .addRoleOption((opt) => opt.setName('rolle').setDescription('Die Rolle').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Entfernt eine Rolle von einem Mitglied')
        .addUserOption((opt) => opt.setName('user').setDescription('Das Mitglied').setRequired(true))
        .addRoleOption((opt) => opt.setName('rolle').setDescription('Die Rolle').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const member = interaction.options.getMember('user');
    const targetRole = interaction.options.getRole('rolle');

    if (!member) {
      await interaction.reply({ content: '❌ Dieses Mitglied konnte nicht gefunden werden.', ephemeral: true });
      return;
    }

    try {
      if (sub === 'add') {
        await member.roles.add(targetRole);
        await interaction.reply(`✅ Rolle **${targetRole.name}** wurde **${member.user.tag}** gegeben.`);
      } else {
        await member.roles.remove(targetRole);
        await interaction.reply(`✅ Rolle **${targetRole.name}** wurde **${member.user.tag}** entfernt.`);
      }
    } catch (err) {
      console.error('Fehler bei /role:', err);
      await interaction.reply({
        content: isMissingPermError(err)
          ? '❌ Mir fehlt die Berechtigung, diese Rolle zu verwalten (evtl. höher als meine eigene Rolle).'
          : `❌ Fehler: ${err.message}`,
        ephemeral: true,
      });
    }
  },
};

const purgeUser = {
  data: new SlashCommandBuilder()
    .setName('purge-user')
    .setDescription('Löscht die letzten Nachrichten eines bestimmten Nutzers in diesem Kanal')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addUserOption((opt) => opt.setName('user').setDescription('Dessen Nachrichten gelöscht werden sollen').setRequired(true))
    .addIntegerOption((opt) =>
      opt.setName('durchsuchen').setDescription('Wie viele Nachrichten im Kanal durchsucht werden (max. 100)').setMinValue(1).setMaxValue(100).setRequired(false)
    ),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user');
    const scanAmount = interaction.options.getInteger('durchsuchen') || 100;

    await interaction.deferReply({ ephemeral: true });

    try {
      const messages = await interaction.channel.messages.fetch({ limit: scanAmount });
      const toDelete = messages.filter((m) => m.author.id === targetUser.id);
      const deleted = await interaction.channel.bulkDelete(toDelete, true);
      await interaction.editReply(`🧹 ${deleted.size} Nachricht(en) von **${targetUser.tag}** gelöscht.`);
    } catch (err) {
      console.error('Fehler bei /purge-user:', err);
      await interaction.editReply(
        isMissingPermError(err)
          ? '❌ Mir fehlt die Berechtigung, Nachrichten in diesem Kanal zu löschen.'
          : `❌ Fehler: ${err.message} (Discord kann nur Nachrichten löschen, die jünger als 14 Tage sind.)`
      );
    }
  },
};

const say = {
  data: new SlashCommandBuilder()
    .setName('say')
    .setDescription('Lässt den Bot eine Nachricht in einem Kanal senden')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addChannelOption((opt) =>
      opt.setName('channel').setDescription('Der Zielkanal').addChannelTypes(ChannelType.GuildText).setRequired(true)
    )
    .addStringOption((opt) => opt.setName('nachricht').setDescription('Der Nachrichtentext').setRequired(true)),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');
    const text = interaction.options.getString('nachricht');

    try {
      await channel.send(text);
      await interaction.reply({ content: `✅ Nachricht gesendet in ${channel.toString()}.`, ephemeral: true });
    } catch (err) {
      console.error('Fehler bei /say:', err);
      await interaction.reply({
        content: isMissingPermError(err)
          ? '❌ Mir fehlt die Berechtigung, in diesem Kanal zu schreiben.'
          : `❌ Fehler: ${err.message}`,
        ephemeral: true,
      });
    }
  },
};

const coinflip = {
  data: new SlashCommandBuilder().setName('coinflip').setDescription('Wirft eine Münze (Kopf oder Zahl)'),
  async execute(interaction) {
    const result = Math.random() < 0.5 ? 'Kopf 🪙' : 'Zahl 🪙';
    await interaction.reply(`🎲 Ergebnis: **${result}**`);
  },
};

const dice = {
  data: new SlashCommandBuilder()
    .setName('dice')
    .setDescription('Würfelt einen Würfel')
    .addIntegerOption((opt) => opt.setName('seiten').setDescription('Anzahl Seiten (Standard: 6)').setMinValue(2).setMaxValue(1000).setRequired(false)),
  async execute(interaction) {
    const sides = interaction.options.getInteger('seiten') || 6;
    const result = Math.floor(Math.random() * sides) + 1;
    await interaction.reply(`🎲 Du hast eine **${result}** gewürfelt (1-${sides}).`);
  },
};

const EIGHT_BALL_ANSWERS = [
  'Ja, definitiv.',
  'Es ist sicher.',
  'Ohne Zweifel.',
  'Ja.',
  'Wahrscheinlich.',
  'Meine Sicht ist unklar - versuch es später erneut.',
  'Kann ich jetzt nicht sagen.',
  'Konzentriere dich und frag erneut.',
  'Verlass dich nicht darauf.',
  'Meine Antwort ist nein.',
  'Meine Quellen sagen nein.',
  'Sieht nicht gut aus.',
  'Sehr zweifelhaft.',
];

const eightball = {
  data: new SlashCommandBuilder()
    .setName('8ball')
    .setDescription('Stell der magischen 8-Ball eine Frage')
    .addStringOption((opt) => opt.setName('frage').setDescription('Deine Frage').setRequired(true)),
  async execute(interaction) {
    const question = interaction.options.getString('frage');
    const answer = EIGHT_BALL_ANSWERS[Math.floor(Math.random() * EIGHT_BALL_ANSWERS.length)];
    const embed = new EmbedBuilder()
      .setTitle('🎱 Magische 8-Ball')
      .addFields({ name: 'Frage', value: question }, { name: 'Antwort', value: answer })
      .setColor(0x2f3136);
    await interaction.reply({ embeds: [embed] });
  },
};

const membercount = {
  data: new SlashCommandBuilder().setName('membercount').setDescription('Zeigt die Mitgliederzahl dieses Servers'),
  async execute(interaction) {
    await interaction.guild.fetch().catch(() => {});
    await interaction.reply(`👥 Dieser Server hat **${interaction.guild.memberCount}** Mitglieder.`);
  },
};

const roleinfo = {
  data: new SlashCommandBuilder()
    .setName('roleinfo')
    .setDescription('Zeigt Infos zu einer Rolle')
    .addRoleOption((opt) => opt.setName('rolle').setDescription('Die Rolle').setRequired(true)),
  async execute(interaction) {
    const role = interaction.options.getRole('rolle');
    const embed = new EmbedBuilder()
      .setTitle(`🎭 Rolle: ${role.name}`)
      .setColor(role.color || 0x5865f2)
      .addFields(
        { name: 'ID', value: role.id, inline: true },
        { name: 'Mitglieder', value: String(role.members?.size ?? 'unbekannt'), inline: true },
        { name: 'Erwähnbar', value: role.mentionable ? 'Ja' : 'Nein', inline: true },
        { name: 'Erstellt', value: `<t:${Math.floor(role.createdTimestamp / 1000)}:R>`, inline: true }
      );
    await interaction.reply({ embeds: [embed] });
  },
};

module.exports = { ping, remindme, suggest, role, purgeUser, say, coinflip, dice, eightball, membercount, roleinfo };
