// commands-partner.js
// /partner request | list | remove   (logic in partner-runtime.js)
// Access: request/list = everyone, remove = administrators (set in commands.js).

const { SlashCommandBuilder } = require('discord.js');
const runtime = require('./partner-runtime');
const storage = require('./storage');
const logging = require('./logging');
const permissions = require('./permissions');
const { EPHEMERAL, truncate } = require('./util');

const partner = {
  data: new SlashCommandBuilder()
    .setName('partner')
    .setDescription('Partner requests and the partner list')
    .addSubcommand((s) =>
      s
        .setName('request')
        .setDescription('Asks to become a partner of this server')
        .addStringOption((o) => o.setName('name').setDescription('Name of your server / project').setMinLength(2).setMaxLength(80).setRequired(true))
        .addStringOption((o) => o.setName('invite').setDescription('A permanent invite link to your server').setMaxLength(100).setRequired(true))
        .addStringOption((o) => o.setName('description').setDescription('A short description of your server').setMinLength(10).setMaxLength(500).setRequired(true))
    )
    .addSubcommand((s) => s.setName('list').setDescription('Shows our partners'))
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Removes a partner')
        .addStringOption((o) => o.setName('partner').setDescription('The partner to remove').setAutocomplete(true).setRequired(true))
    ),

  async autocomplete(interaction) {
    if (!interaction.inGuild() || !permissions.hasAccess(interaction, 'admin')) return void (await interaction.respond([]));
    const typed = String(interaction.options.getFocused() || '').toLowerCase();
    const choices = runtime
      .acceptedPartners(interaction.guildId)
      .filter((p) => !typed || p.name.toLowerCase().includes(typed))
      .slice(0, 25)
      .map((p) => ({ name: truncate(`${p.name} (#${p.id})`, 100), value: String(p.id) }));
    await interaction.respond(choices);
  },

  async execute(interaction) {
    await interaction.deferReply({ flags: EPHEMERAL });
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      await interaction.editReply({ embeds: [runtime.listEmbed(interaction.guildId)] });
      return;
    }

    if (sub === 'request') {
      const res = await runtime.request(interaction.client, interaction.guild, interaction.user, {
        name: interaction.options.getString('name').trim(),
        invite: interaction.options.getString('invite').trim(),
        description: interaction.options.getString('description').trim(),
      });
      await interaction.editReply(res.ok ? `✅ Your request **#${res.partner.id}** was sent to the team. You will get a DM with the decision.` : `❌ ${res.reason}`);
      return;
    }

    if (sub === 'remove') {
      const id = interaction.options.getString('partner').trim();
      const removed = await runtime.remove(interaction.client, interaction.guildId, id);
      if (!removed) return void (await interaction.editReply('❌ I could not find that partner. Pick one from the suggestions.'));
      logging.logToGuild(interaction.client, interaction.guildId, { title: '🤝 Partner removed', description: `**${truncate(removed.name, 100)}** was removed by ${interaction.user.tag}.`, level: 'warn' });
      await interaction.editReply(`✅ **${truncate(removed.name, 100)}** was removed from the partner list.`);
    }
  },
};

module.exports = { partner };
