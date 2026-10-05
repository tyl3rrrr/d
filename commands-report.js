// commands-report.js
// /report - any member can report another member to the moderators.
// The report shows up as a panel with status and handler in the report channel
// (see report-runtime.js). Answers immediately (deferReply) like every other command.

const { SlashCommandBuilder } = require('discord.js');
const runtime = require('./report-runtime');
const { EPHEMERAL } = require('./util');

const COOLDOWN_MS = 60 * 1000; // one report per minute and person - stops spam
const lastReport = new Map();

const report = {
  data: new SlashCommandBuilder()
    .setName('report')
    .setDescription('Reports a member to the moderators')
    .addUserOption((o) => o.setName('user').setDescription('The member you want to report').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('What happened?').setMinLength(5).setMaxLength(800).setRequired(true))
    .addAttachmentOption((o) => o.setName('evidence').setDescription('A screenshot or file as evidence (optional)').setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply({ flags: EPHEMERAL });

    const target = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason').trim();
    const attachment = interaction.options.getAttachment('evidence');

    if (target.id === interaction.user.id) return void (await interaction.editReply("❌ You can't report yourself."));
    if (target.bot) return void (await interaction.editReply("❌ Bots can't be reported here - tell a moderator directly."));
    if (reason.length < 5) return void (await interaction.editReply('❌ Please describe what happened (at least a few words).'));

    const wait = (lastReport.get(interaction.user.id) || 0) + COOLDOWN_MS - Date.now();
    if (wait > 0) return void (await interaction.editReply(`⏳ Please wait ${Math.ceil(wait / 1000)} more seconds before sending another report.`));

    const res = await runtime.submit(interaction.client, interaction.guild, { reporter: interaction.user, target, reason, attachment, channel: interaction.channel });
    if (!res.ok) return void (await interaction.editReply(`❌ ${res.reason}`));

    lastReport.set(interaction.user.id, Date.now());
    await interaction.editReply(`✅ Report **#${res.report.id}** was sent to the moderators. You will get a DM when it has been handled.`);
  },
};

module.exports = { report };
