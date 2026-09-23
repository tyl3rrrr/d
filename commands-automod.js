// commands-automod.js
// /automod setup | status | remove  -  AutoMod-Regeln über die Discord-AutoMod-API
// verwalten. Zugriff (Administratoren) wird zentral in permissions.js geprüft.

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const automod = require('./automod-api');
const permissions = require('./permissions');
const { EPHEMERAL } = require('./util');

const STATUS_ICON = { created: '🆕', exists: '✅', error: '❌' };

const automodCmd = {
  data: new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Verwaltet die AutoMod-Regeln des Bots (Discord-AutoMod-API)')
    .addSubcommand((sub) =>
      sub.setName('setup').setDescription('Legt alle Standard-AutoMod-Regeln an (Wortfilter, Spam, Mentions, Standard-Filter, Profil)')
    )
    .addSubcommand((sub) => sub.setName('status').setDescription('Zeigt die AutoMod-Regeln des Bots auf diesem Server'))
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Entfernt ALLE vom Bot erstellten AutoMod-Regeln auf diesem Server')
        .addBooleanOption((opt) => opt.setName('bestaetigen').setDescription('Auf "True" setzen, um wirklich zu löschen').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const client = interaction.client;
    const guildId = interaction.guildId;

    await interaction.deferReply({ flags: EPHEMERAL });

    if (sub === 'setup') {
      const results = await automod.createStandardRules(client, guildId);
      const lines = results.map((r) => {
        const label = r.kind === 'all' ? 'AutoMod' : automod.RULE_LABELS[r.kind];
        const detail = r.status === 'error' ? ` — ${r.error}` : r.status === 'created' ? ' — neu angelegt' : ' — war schon vorhanden';
        return `${STATUS_ICON[r.status]} ${label}${detail}`;
      });
      const embed = new EmbedBuilder()
        .setTitle('🛡️ AutoMod-Einrichtung')
        .setColor(results.some((r) => r.status === 'error') ? 0xfee75c : 0x57f287)
        .setDescription(lines.join('\n'))
        .setFooter({ text: 'Die Regeln sind unter Servereinstellungen → AutoMod sichtbar und dort auch anpassbar.' });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (sub === 'status') {
      let rules;
      try {
        rules = await automod.listBotRules(client, guildId);
      } catch (err) {
        await interaction.editReply(`❌ AutoMod-Regeln konnten nicht geladen werden: ${automod.explainError(err)}`);
        return;
      }

      const lines = automod.RULE_ORDER.map((kind) => {
        const rule = automod.findRuleByKind(rules, kind);
        return `${rule ? (rule.enabled ? '✅' : '⏸️') : '❌'} ${automod.RULE_LABELS[kind]}${rule ? (rule.enabled ? '' : ' (deaktiviert)') : ' — nicht angelegt'}`;
      });

      const embed = new EmbedBuilder()
        .setTitle('🛡️ AutoMod-Status')
        .setColor(0x5865f2)
        .setDescription(lines.join('\n'))
        .addFields({
          name: 'Regeln des Bots auf diesem Server',
          value: `${rules.length} von maximal ${automod.MAX_RULES_PER_GUILD}`,
        });

      // Badge-Fortschritt: nur für den Bot-Betreiber (enthält Infos über alle Server).
      if (permissions.isBotOwner(interaction.user.id)) {
        const report = await automod.badgeReport(client);
        const flagText =
          report.hasBadgeFlag === null ? 'nicht ermittelbar' : report.hasBadgeFlag ? 'JA — Discord hat das Badge vergeben' : 'nein (noch nicht vergeben)';
        embed.addFields(
          {
            name: '🏅 „Uses AutoMod“-Badge (Betreiber-Info)',
            value:
              `Regeln des Bots über alle Server: **${report.total} / ${report.target}**\n` +
              `Server: **${report.guildCount}** → maximal möglich: **${report.maxPossible}** (${report.maxPerGuild} Regeln pro Server)\n` +
              `Badge-Flag laut Discord: **${flagText}**`,
          },
          {
            name: 'Einordnung',
            value:
              report.maxPossible < report.target
                ? `Mit ${report.guildCount} Servern sind höchstens ${report.maxPossible} Regeln möglich — für ${report.target} braucht der Bot mindestens **${report.minGuildsNeeded} Server** mit je ${report.maxPerGuild} Regeln.`
                : `Rechnerisch reicht die Serverzahl aus. Fehlend: **${Math.max(0, report.target - report.total)}** Regeln (Server ohne \`/automod setup\` nachholen).`,
          }
        );
      }
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (sub === 'remove') {
      if (!interaction.options.getBoolean('bestaetigen')) {
        await interaction.editReply('Abgebrochen — setze `bestaetigen` auf **True**, um die Regeln wirklich zu löschen.');
        return;
      }
      try {
        const removed = await automod.removeBotRules(client, guildId);
        await interaction.editReply(`🗑️ ${removed} AutoMod-Regel(n) des Bots wurden entfernt.`);
      } catch (err) {
        await interaction.editReply(`❌ Fehler beim Entfernen: ${automod.explainError(err)}`);
      }
    }
  },
};

module.exports = { automodCmd };
