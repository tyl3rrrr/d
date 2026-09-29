// commands-automod.js
// /automod setup | setup-all | status | remove - manages the bot's AutoMod
// rules via the Discord AutoMod API. Access (setup/status/remove: admins,
// setup-all: bot owner only) is checked centrally in permissions.js.

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const automod = require('./automod-api');
const permissions = require('./permissions');
const { EPHEMERAL } = require('./util');

function setupLines(results) {
  return results.map((r) => {
    const label = automod.RULE_LABELS[r.kind];
    const detail = r.status === 'error' ? ` — ${r.error}` : ' — created';
    return `${r.status === 'error' ? '❌' : '🆕'} ${label}${detail}`;
  });
}

const automodCmd = {
  data: new SlashCommandBuilder()
    .setName('automod')
    .setDescription("Manages the bot's AutoMod rules (Discord AutoMod API)")
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Deletes ALL existing AutoMod rules on this server and creates the standard rules fresh')
    )
    .addSubcommand((sub) =>
      sub
        .setName('setup-all')
        .setDescription('Bot owner only: runs setup on EVERY server the bot is in (deletes + recreates everywhere)')
    )
    .addSubcommand((sub) => sub.setName('status').setDescription("Shows the bot's AutoMod rules on this server"))
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Removes ALL AutoMod rules created by the bot on this server')
        .addBooleanOption((opt) => opt.setName('confirm').setDescription('Set to "True" to actually delete').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const client = interaction.client;
    const guildId = interaction.guildId;

    await interaction.deferReply({ flags: EPHEMERAL });

    if (sub === 'setup') {
      const { reset, results } = await automod.resetAndCreateRules(client, guildId);
      const lines = setupLines(results);
      const resetLine =
        reset.total === 0
          ? 'No existing rules found - nothing to delete.'
          : `Deleted ${reset.removed}/${reset.total} existing rule(s)${reset.errors.length ? ` (${reset.errors.length} could not be deleted: ${reset.errors.map((e) => e.error).join('; ')})` : ''}.`;

      const embed = new EmbedBuilder()
        .setTitle('🛡️ AutoMod Setup')
        .setColor(results.some((r) => r.status === 'error') ? 0xfee75c : 0x57f287)
        .setDescription(`${resetLine}\n\n${lines.join('\n')}`)
        .setFooter({ text: 'The rules are visible (and editable) under Server Settings -> AutoMod.' });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (sub === 'setup-all') {
      await interaction.editReply('🔄 Running setup on every server the bot is in - this may take a moment...');
      const perGuild = await automod.resetAndCreateAllGuilds(client);

      const lines = perGuild.map((g) => {
        if (g.error) return `❌ **${g.name}** — ${g.error}`;
        const failed = g.results.filter((r) => r.status === 'error').length;
        return failed
          ? `⚠️ **${g.name}** — reset ${g.reset.removed}/${g.reset.total}, ${g.results.length - failed}/${g.results.length} rules created (${failed} failed)`
          : `✅ **${g.name}** — reset ${g.reset.removed}/${g.reset.total}, all ${g.results.length} rules created`;
      });

      const embed = new EmbedBuilder()
        .setTitle('🛡️ AutoMod Setup - All Servers')
        .setColor(0x5865f2)
        .setDescription(lines.join('\n') || 'The bot is not in any servers.')
        .setFooter({ text: `${perGuild.length} server(s) processed.` });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (sub === 'status') {
      let allRules;
      try {
        allRules = await automod.listAllRules(client, guildId);
      } catch (err) {
        await interaction.editReply(`❌ Could not load AutoMod rules: ${automod.explainError(err)}`);
        return;
      }

      const lines = automod.RULE_ORDER.map((kind) => {
        const found = automod.findAnyRuleForKind(allRules, kind);
        const rule = found ? found.rule : null;
        const foreignNote = rule && !found.isOwn ? ' (rule from another source, not managed by this bot)' : '';
        return `${rule ? (rule.enabled ? '✅' : '⏸️') : '❌'} ${automod.RULE_LABELS[kind]}${rule ? `${rule.enabled ? '' : ' (disabled)'}${foreignNote}` : ' — not set up'}`;
      });

      const rules = allRules.filter((r) => r.creator_id === client.user.id);
      const embed = new EmbedBuilder()
        .setTitle('🛡️ AutoMod Status')
        .setColor(0x5865f2)
        .setDescription(lines.join('\n'))
        .addFields({
          name: "This bot's rules on this server",
          value: `${rules.length} of ${automod.MAX_RULES_PER_GUILD} max`,
        });

      // Badge progress: bot owner only (contains info about every server).
      if (permissions.isBotOwner(interaction.user.id)) {
        const report = await automod.badgeReport(client);
        const flagText = report.hasBadgeFlag === null ? 'could not be determined' : report.hasBadgeFlag ? 'YES - Discord has granted the badge' : 'no (not granted yet)';
        embed.addFields(
          {
            name: '🏅 "Uses AutoMod" badge (owner info)',
            value:
              `Bot rules across all servers: **${report.total} / ${report.target}**\n` +
              `Servers: **${report.guildCount}** -> max possible: **${report.maxPossible}** (${report.maxPerGuild} rules/server)\n` +
              `Badge flag per Discord: **${flagText}**`,
          },
          {
            name: 'Assessment',
            value:
              report.maxPossible < report.target
                ? `With ${report.guildCount} servers, at most ${report.maxPossible} rules are possible - reaching ${report.target} needs at least **${report.minGuildsNeeded} servers** with ${report.maxPerGuild} rules each.`
                : `The server count is mathematically enough. Missing: **${Math.max(0, report.target - report.total)}** rules (run \`/automod setup-all\` or run setup on servers that still need it).`,
          }
        );
      }
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (sub === 'remove') {
      if (!interaction.options.getBoolean('confirm')) {
        await interaction.editReply('Cancelled — set `confirm` to **True** to actually delete the rules.');
        return;
      }
      try {
        const removed = await automod.removeBotRules(client, guildId);
        await interaction.editReply(`🗑️ Removed ${removed} AutoMod rule(s) created by the bot.`);
      } catch (err) {
        await interaction.editReply(`❌ Error while removing: ${automod.explainError(err)}`);
      }
    }
  },
};

module.exports = { automodCmd };
