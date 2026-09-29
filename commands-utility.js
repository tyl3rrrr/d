// commands-utility.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

const userinfo = {
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Shows info about a server member')
    .addUserOption((opt) => opt.setName('user').setDescription('The member (default: yourself)').setRequired(false)),

  async execute(interaction) {
    // Also works via user install (DMs / servers without the bot): then there is
    // no server member, and only the account info is shown.
    const member = interaction.options.getMember('user') || (interaction.options.getUser('user') ? null : interaction.member);
    const user = interaction.options.getUser('user') || interaction.user;
    const hasMember = Boolean(member && member.roles && member.roles.cache);

    const embed = new EmbedBuilder()
      .setTitle(`👤 ${user.tag}`)
      .setColor(0x5865f2)
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: 'ID', value: user.id, inline: true },
        { name: 'Bot?', value: user.bot ? 'Yes' : 'No', inline: true },
        { name: 'Account created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true }
      );

    if (hasMember && interaction.guild) {
      const roles = member.roles.cache.filter((r) => r.id !== interaction.guild.id).map((r) => `<@&${r.id}>`);
      embed.addFields(
        {
          name: 'Joined server',
          value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Unknown',
          inline: true,
        },
        { name: `Roles (${roles.length})`, value: roles.length > 0 ? roles.join(', ').slice(0, 1000) : 'None' }
      );
    }

    await interaction.reply({ embeds: [embed] });
  },
};

const serverinfo = {
  data: new SlashCommandBuilder().setName('serverinfo').setDescription('Shows info about this server'),

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
        { name: 'Members', value: String(guild.memberCount), inline: true },
        { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
        { name: 'Boost level', value: String(guild.premiumTier ?? 0), inline: true },
        { name: 'Boosts', value: String(guild.premiumSubscriptionCount ?? 0), inline: true }
      );

    await interaction.reply({ embeds: [embed] });
  },
};

const avatar = {
  data: new SlashCommandBuilder()
    .setName('avatar')
    .setDescription("Shows a user's profile picture in large size")
    .addUserOption((opt) => opt.setName('user').setDescription('The user (default: yourself)').setRequired(false)),

  async execute(interaction) {
    const user = interaction.options.getUser('user') || interaction.user;
    const embed = new EmbedBuilder()
      .setTitle(`🖼️ Avatar of ${user.tag}`)
      .setColor(0x5865f2)
      .setImage(user.displayAvatarURL({ size: 1024 }));
    await interaction.reply({ embeds: [embed] });
  },
};

const poll = {
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Creates a simple poll with reactions')
    .addStringOption((opt) => opt.setName('question').setDescription('The poll question').setRequired(true))
    .addStringOption((opt) => opt.setName('option1').setDescription('Answer option 1').setRequired(true))
    .addStringOption((opt) => opt.setName('option2').setDescription('Answer option 2').setRequired(true))
    .addStringOption((opt) => opt.setName('option3').setDescription('Answer option 3').setRequired(false))
    .addStringOption((opt) => opt.setName('option4').setDescription('Answer option 4').setRequired(false))
    .addStringOption((opt) => opt.setName('option5').setDescription('Answer option 5').setRequired(false)),

  async execute(interaction) {
    const question = interaction.options.getString('question');
    const options = [1, 2, 3, 4, 5]
      .map((i) => interaction.options.getString(`option${i}`))
      .filter(Boolean);

    const description = options.map((opt, i) => `${NUMBER_EMOJIS[i]} ${opt}`).join('\n');

    const embed = new EmbedBuilder()
      .setTitle(`📊 ${question}`)
      .setDescription(description)
      .setColor(0x5865f2)
      .setFooter({ text: `Created by ${interaction.user.tag}` });

    await interaction.reply({ embeds: [embed] });
    const message = await interaction.fetchReply();

    for (let i = 0; i < options.length; i++) {
      await message.react(NUMBER_EMOJIS[i]).catch(() => {});
    }
  },
};

module.exports = { userinfo, serverinfo, avatar, poll };
