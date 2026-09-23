// commands-xp.js
// /xp-board  - Administratoren legen den Leaderboard-Kanal fest (Auto-Update alle 24h)
// /xp-set    - AUSSCHLIESSLICH die hartkodierte Superuser-ID darf XP/Level verändern
// /xp-stats  - jeder kann seine (oder einer anderen Person) XP-Statistik sehen
//
// Zugriff für /xp-board wird zentral in permissions.js geprüft (access: 'admin').
// /xp-set prüft die User-ID zusätzlich HART im Code (siehe unten) - das ist bewusst
// doppelt zur zentralen access:'superuser'-Prüfung, weil der Auftrag ausdrücklich
// verlangt, dass GENAU diese eine ID hartkodiert ist.

const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const storage = require('./storage');
const xp = require('./xp');
const config = require('./config');
const { EPHEMERAL, truncate } = require('./util');

// Bewusst hartkodiert (siehe Auftrag Punkt 14) - NICHT aus der .env lesen.
const XP_EDITOR_ID = '1324102364608598118';

async function tryGetInviteLink(client, guildId) {
  const cached = storage.getGuildSettings(guildId).permanentInviteUrl;
  if (cached) return cached;
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return null;
    const channel = guild.channels.cache.find((c) => c.isTextBased?.() && c.viewable && c.permissionsFor(client.user)?.has('CreateInstantInvite'));
    if (!channel) return null;
    // maxAge: 0 = technisch "niemals ablaufend" laut Discord-API. Discord kann einen
    // solchen Invite trotzdem serverseitig löschen (z.B. Kanal gelöscht) - ein WIRKLICH
    // für immer garantierter Link lässt sich daher nicht zusichern, nur der best-mögliche.
    const invite = await channel.createInvite({ maxAge: 0, maxUses: 0, unique: false, reason: 'XP-Leaderboard: Server-Link' });
    storage.setGuildSetting(guildId, 'permanentInviteUrl', invite.url);
    return invite.url;
  } catch (err) {
    return null; // keine Berechtigung/kein passender Kanal - Link wird einfach weggelassen
  }
}

const xpBoard = {
  data: new SlashCommandBuilder()
    .setName('xp-board')
    .setDescription('Legt fest, in welchem Kanal das XP-Leaderboard dieses Servers angezeigt wird')
    .addChannelOption((o) =>
      o.setName('channel').setDescription('Kanal für das Leaderboard (ohne Angabe: deaktivieren)').addChannelTypes(ChannelType.GuildText).setRequired(false)
    ),
  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');
    const guildId = interaction.guildId;

    if (!channel) {
      storage.removeGuildSetting(guildId, 'xpBoardChannelId');
      storage.removeGuildSetting(guildId, 'xpBoardMessageId');
      await interaction.reply({ content: '✅ XP-Leaderboard deaktiviert.', flags: EPHEMERAL });
      return;
    }

    storage.setGuildSetting(guildId, 'xpBoardChannelId', channel.id);
    storage.removeGuildSetting(guildId, 'xpBoardMessageId'); // neuer Kanal -> neue Nachricht erzeugen
    await interaction.reply({ content: `✅ XP-Leaderboard wird jetzt in ${channel.toString()} angezeigt (Update alle 24h).`, flags: EPHEMERAL });

    const { updateGuildBoard } = require('./xp-runtime');
    await updateGuildBoard(interaction.client, guildId).catch(() => {});
  },
};

const xpSet = {
  data: new SlashCommandBuilder()
    .setName('xp-set')
    .setDescription(`Setzt XP/Level eines Users (ausschließlich User-ID ${XP_EDITOR_ID})`)
    .addUserOption((o) => o.setName('user').setDescription('Der User').setRequired(true))
    .addIntegerOption((o) => o.setName('xp').setDescription('Neuer XP-Wert').setRequired(true).setMinValue(0))
    .addIntegerOption((o) => o.setName('level').setDescription('Neues Level (ohne Angabe: aus XP berechnet)').setRequired(false).setMinValue(0))
    .addStringOption((o) => o.setName('server').setDescription('Server-ID (ohne Angabe: dieser Server)').setRequired(false)),

  async execute(interaction) {
    // Harte Prüfung direkt im Command - unabhängig von permissions.js.
    if (interaction.user.id !== XP_EDITOR_ID) {
      await interaction.reply({ content: '❌ Nur eine einzige, festgelegte Person darf diesen Befehl verwenden.', flags: EPHEMERAL });
      return;
    }

    const targetUser = interaction.options.getUser('user');
    const newXp = interaction.options.getInteger('xp');
    const explicitLevel = interaction.options.getInteger('level');
    const guildId = interaction.options.getString('server') || interaction.guildId;

    if (!guildId) {
      await interaction.reply({ content: '❌ Bitte auf einem Server ausführen oder `server` (Server-ID) angeben.', flags: EPHEMERAL });
      return;
    }

    const level = explicitLevel !== null ? explicitLevel : xp.levelFromTotalXp(newXp);
    const saved = storage.setUserXP(guildId, targetUser.id, newXp, level);

    await interaction.reply({
      content: `✅ ${targetUser.tag} auf Server \`${guildId}\`: **${saved.xp} XP**, Level **${saved.level}** gesetzt.`,
      flags: EPHEMERAL,
    });
  },
};

const xpStats = {
  data: new SlashCommandBuilder()
    .setName('xp-stats')
    .setDescription('Zeigt XP-Statistiken (Standard: dich selbst)')
    .addUserOption((o) => o.setName('user').setDescription('Andere Person (optional)').setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply();
    const target = interaction.options.getUser('user') || interaction.user;
    const guildId = interaction.guildId;

    const record = storage.getUserXP(guildId, target.id);
    const p = xp.progress(record.xp);
    const rank = storage.getGlobalRank(guildId, target.id);

    const embed = new EmbedBuilder()
      .setTitle(`📊 XP-Statistik: ${target.username}`)
      .setColor(0x5865f2)
      .setThumbnail(target.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: 'User-ID', value: target.id, inline: true },
        { name: 'Server', value: interaction.guild.name, inline: true },
        { name: 'Globaler Rang', value: rank ? `#${rank}` : 'Noch kein Eintrag', inline: true },
        { name: 'Level', value: String(p.level), inline: true },
        { name: 'XP (gesamt)', value: String(record.xp), inline: true },
        { name: 'XP bis nächstes Level', value: String(p.xpToNext), inline: true },
        { name: 'Fortschritt zum nächsten Level', value: `${p.percent}% (${p.xpIntoLevel}/${p.xpNeededForNext} XP)` }
      );
    await interaction.editReply({ embeds: [embed] });
  },
};

const xpGlobal = {
  data: new SlashCommandBuilder().setName('xp-global').setDescription('Zeigt die globale XP-Rangliste über alle Server'),
  async execute(interaction) {
    await interaction.deferReply();
    const top = storage.getGlobalLeaderboard(10);
    if (top.length === 0) {
      await interaction.editReply('Die globale Rangliste ist noch leer.');
      return;
    }

    const lines = [];
    for (let i = 0; i < top.length; i++) {
      const entry = top[i];
      const guild = interaction.client.guilds.cache.get(entry.guildId);
      const guildName = guild ? guild.name : `Server ${entry.guildId}`;
      const invite = guild ? await tryGetInviteLink(interaction.client, entry.guildId) : null;
      const serverText = invite ? `[${truncate(guildName, 40)}](${invite})` : truncate(guildName, 40);
      lines.push(`**${i + 1}.** <@${entry.userId}> — Level ${entry.level} (${entry.xp} XP) — ${serverText}`);
    }

    const embed = new EmbedBuilder()
      .setTitle('🌍 Globale XP-Rangliste')
      .setColor(0xffd700)
      .setDescription(lines.join('\n'))
      .setFooter({ text: 'Server-Links sind nur so dauerhaft, wie Discord die jeweilige Einladung bestehen lässt.' });
    await interaction.editReply({ embeds: [embed] });
  },
};

module.exports = { xpBoard, xpSet, xpStats, xpGlobal, XP_EDITOR_ID, tryGetInviteLink };
