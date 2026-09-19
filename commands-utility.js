// commands-utility.js
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

const userinfo = {
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Zeigt Infos zu einem Server-Mitglied')
    .addUserOption((opt) => opt.setName('user').setDescription('Das Mitglied (Standard: du selbst)').setRequired(false)),

  async execute(interaction) {
    const member = interaction.options.getMember('user') || interaction.member;
    const user = member.user;

    const roles = member.roles.cache
      .filter((r) => r.id !== interaction.guild.id)
      .map((r) => `<@&${r.id}>`);

    const embed = new EmbedBuilder()
      .setTitle(`👤 ${user.tag}`)
      .setColor(0x5865f2)
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: 'ID', value: user.id, inline: true },
        { name: 'Bot?', value: user.bot ? 'Ja' : 'Nein', inline: true },
        { name: 'Account erstellt', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
        {
          name: 'Server beigetreten',
          value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Unbekannt',
          inline: true,
        },
        { name: `Rollen (${roles.length})`, value: roles.length > 0 ? roles.join(', ') : 'Keine' }
      );

    await interaction.reply({ embeds: [embed] });
  },
};

const serverinfo = {
  data: new SlashCommandBuilder().setName('serverinfo').setDescription('Zeigt Infos zu diesem Server'),

  async execute(interaction) {
    const guild = interaction.guild;
    await guild.fetch().catch(() => {});

    const embed = new EmbedBuilder()
      .setTitle(`🏠 ${guild.name}`)
      .setColor(0x5865f2)
      .setThumbnail(guild.iconURL({ size: 256 }) || null)
      .addFields(
        { name: 'ID', value: guild.id, inline: true },
        { name: 'Owner', value: `<@${guild.ownerId}>`, inline: true },
        { name: 'Mitglieder', value: String(guild.memberCount), inline: true },
        { name: 'Erstellt', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
        { name: 'Boost-Level', value: String(guild.premiumTier ?? 0), inline: true },
        { name: 'Boosts', value: String(guild.premiumSubscriptionCount ?? 0), inline: true }
      );

    await interaction.reply({ embeds: [embed] });
  },
};

const avatar = {
  data: new SlashCommandBuilder()
    .setName('avatar')
    .setDescription('Zeigt das Profilbild eines Nutzers in groß')
    .addUserOption((opt) => opt.setName('user').setDescription('Der Nutzer (Standard: du selbst)').setRequired(false)),

  async execute(interaction) {
    const user = interaction.options.getUser('user') || interaction.user;
    const embed = new EmbedBuilder()
      .setTitle(`🖼️ Avatar von ${user.tag}`)
      .setColor(0x5865f2)
      .setImage(user.displayAvatarURL({ size: 1024 }));
    await interaction.reply({ embeds: [embed] });
  },
};

const poll = {
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Erstellt eine einfache Abstimmung mit Reaktionen')
    .addStringOption((opt) => opt.setName('frage').setDescription('Die Abstimmungsfrage').setRequired(true))
    .addStringOption((opt) => opt.setName('option1').setDescription('Antwortoption 1').setRequired(true))
    .addStringOption((opt) => opt.setName('option2').setDescription('Antwortoption 2').setRequired(true))
    .addStringOption((opt) => opt.setName('option3').setDescription('Antwortoption 3').setRequired(false))
    .addStringOption((opt) => opt.setName('option4').setDescription('Antwortoption 4').setRequired(false))
    .addStringOption((opt) => opt.setName('option5').setDescription('Antwortoption 5').setRequired(false)),

  async execute(interaction) {
    const question = interaction.options.getString('frage');
    const options = [1, 2, 3, 4, 5]
      .map((i) => interaction.options.getString(`option${i}`))
      .filter(Boolean);

    const description = options.map((opt, i) => `${NUMBER_EMOJIS[i]} ${opt}`).join('\n');

    const embed = new EmbedBuilder()
      .setTitle(`📊 ${question}`)
      .setDescription(description)
      .setColor(0x5865f2)
      .setFooter({ text: `Erstellt von ${interaction.user.tag}` });

    await interaction.reply({ embeds: [embed] });
    const message = await interaction.fetchReply();

    for (let i = 0; i < options.length; i++) {
      await message.react(NUMBER_EMOJIS[i]).catch(() => {});
    }
  },
};

module.exports = { userinfo, serverinfo, avatar, poll };
