// commands-info.js
// /tos, /privacy-policy and /stats - small info commands open to everyone.
// The links come from config.js (TOS_URL / PRIVACY_URL in .env can override them).

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('./config');
const stats = require('./stats');

function linkCommand({ name, description, title, emoji, getUrl, blurb }) {
  return {
    data: new SlashCommandBuilder().setName(name).setDescription(description),
    async execute(interaction) {
      const url = getUrl();
      const embed = new EmbedBuilder().setTitle(`${emoji} ${title}`).setColor(0x5865f2).setDescription(`${blurb}\n${url}`);
      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel(`Open ${title}`).setStyle(ButtonStyle.Link).setURL(url));
      await interaction.reply({ embeds: [embed], components: [row] });
    },
  };
}

const tos = linkCommand({
  name: 'tos',
  description: "Shows the bot's Terms of Service",
  title: 'Terms of Service',
  emoji: '📜',
  getUrl: () => config.links.tos,
  blurb: 'The rules for using this bot:',
});

const privacyPolicy = linkCommand({
  name: 'privacy-policy',
  description: "Shows the bot's Privacy Policy",
  title: 'Privacy Policy',
  emoji: '🔒',
  getUrl: () => config.links.privacy,
  blurb: 'How this bot handles your data:',
});

const statsCmd = {
  data: new SlashCommandBuilder().setName('stats').setDescription('Shows real usage statistics of the bot'),
  async execute(interaction) {
    const s = stats.summary();
    const fmt = (n) => Number(n).toLocaleString('en-US');

    if (s.total === 0) {
      await interaction.reply('📊 No commands have been counted yet - run a few commands and check again.');
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('📊 Bot Command Statistics')
      .setColor(0x5865f2)
      .addFields(
        { name: 'Commands used', value: fmt(s.total), inline: true },
        { name: 'Most used', value: s.mostUsed ? `/${s.mostUsed[0]} (${fmt(s.mostUsed[1])}×)` : '-', inline: true },
        { name: 'Most active hour', value: s.activeHour ? `${String(s.activeHour.hour).padStart(2, '0')}:00` : '-', inline: true },
        { name: 'Errors', value: fmt(s.errors), inline: true }
      )
      .setFooter({ text: `Counted since ${new Date(s.since).toISOString().slice(0, 10)} · hours in ${s.timeZone}` });

    if (s.top.length > 1) {
      embed.addFields({ name: 'Top commands', value: s.top.map(([name, count], i) => `${i + 1}. \`/${name}\` - ${fmt(count)}`).join('\n') });
    }
    await interaction.reply({ embeds: [embed] });
  },
};

module.exports = { tos, privacyPolicy, stats: statsCmd };
