// commands-xp.js
// XP-System: /xp-stats, /xp-board, /xp-set

const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const storage = require('./storage');
const { hasAdminPermission, isSuperuser, replyNoPermission } = require('./permissions-manager');

// XP-Kurve: Berechnet benötigte XP für ein Level
function getXPForLevel(level) {
  return 15 * (level * level + level + 1);
}

// Berechnet das Level basierend auf gesammeltem XP
function getLevelFromXP(totalXP) {
  for (let level = 0; level <= 500; level++) {
    if (totalXP < getXPForLevel(level)) {
      return level - 1;
    }
  }
  return 500;
}

// Berechnet XP bis zum nächsten Level
function getXPToNextLevel(totalXP) {
  const currentLevel = getLevelFromXP(totalXP);
  const nextLevelXP = getXPForLevel(currentLevel + 1);
  return Math.max(0, nextLevelXP - totalXP);
}

const xpStats = {
  data: new SlashCommandBuilder()
    .setName('xp-stats')
    .setDescription('Zeigt deine oder eines anderen Users XP-Statistiken')
    .addUserOption(option =>
      option.setName('user').setDescription('Der User (Standard: du selbst)').setRequired(false)
    ),
  async execute(interaction) {
    await interaction.deferReply();
    
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const guildId = interaction.guildId;
    const userId = targetUser.id;
    
    const xpData = storage.getXP(guildId, userId);
    const globalBoard = storage.getGlobalXPBoard();
    
    let globalRank = 'N/A';
    for (let i = 0; i < globalBoard.length; i++) {
      if (globalBoard[i].userId === userId) {
        globalRank = `#${i + 1}`;
        break;
      }
    }
    
    const currentLevel = xpData.level || 0;
    const currentXP = xpData.xp || 0;
    const xpToNext = getXPToNextLevel(currentXP);
    const nextLevelTotal = getXPForLevel(currentLevel + 1);
    
    // Fortschritt zum nächsten Level in %
    const xpPreviousLevel = currentLevel === 0 ? 0 : getXPForLevel(currentLevel);
    const progressPercent = Math.round(((currentXP - xpPreviousLevel) / (nextLevelTotal - xpPreviousLevel)) * 100);
    
    const embed = new EmbedBuilder()
      .setTitle(`📊 XP-Statistiken: ${targetUser.username}`)
      .setColor(0x5865F2)
      .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
      .addFields(
        { name: 'User-ID', value: userId, inline: true },
        { name: 'Globale Rangliste', value: globalRank, inline: true },
        { name: 'Server', value: interaction.guild.name, inline: false },
        { name: 'Level', value: String(currentLevel), inline: true },
        { name: 'XP Gesamt', value: String(currentXP), inline: true },
        { name: 'XP zum nächsten Level', value: String(xpToNext), inline: true },
        { name: 'Fortschritt', value: `${progressPercent}% [${currentXP - xpPreviousLevel}/${nextLevelTotal - xpPreviousLevel}]`, inline: false }
      )
      .setTimestamp();
    
    await interaction.editReply({ embeds: [embed] });
  },
};

const xpBoard = {
  data: new SlashCommandBuilder()
    .setName('xp-board')
    .setDescription('Verwalte das XP-Leaderboard')
    .addSubcommand(subcommand =>
      subcommand
        .setName('set')
        .setDescription('Stelle den Channel für das Leaderboard ein')
        .addChannelOption(option =>
          option.setName('channel').setDescription('Der Channel für das Leaderboard').setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName('view').setDescription('Zeige das aktuelle Leaderboard an')
    ),
  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    
    if (subcommand === 'set') {
      // Berechtigungsprüfung
      if (!(await hasAdminPermission(interaction.member, interaction.guild))) {
        return replyNoPermission(interaction, 'Administrator');
      }
      
      const channel = interaction.options.getChannel('channel');
      
      storage.setGuildSetting(interaction.guildId, 'xpBoardChannel', channel.id);
      
      await interaction.reply({
        content: `✅ XP-Leaderboard wird jetzt in ${channel} angezeigt.`,
        ephemeral: true,
      });
    } else if (subcommand === 'view') {
      await interaction.deferReply();
      
      const board = storage.getGuildXPBoard(interaction.guildId);
      const topUsers = board.slice(0, 10);
      
      let description = '';
      for (let i = 0; i < topUsers.length; i++) {
        const entry = topUsers[i];
        try {
          const user = await interaction.client.users.fetch(entry.userId);
          description += `${i + 1}. **${user.username}** - Level ${entry.level} (${entry.xp} XP)\n`;
        } catch (e) {
          description += `${i + 1}. Unknown User (${entry.userId}) - Level ${entry.level} (${entry.xp} XP)\n`;
        }
      }
      
      const embed = new EmbedBuilder()
        .setTitle('🏆 XP-Leaderboard')
        .setDescription(description || 'Noch keine Einträge.')
        .setColor(0xFFD700)
        .setTimestamp();
      
      await interaction.editReply({ embeds: [embed] });
    }
  },
};

const xpSet = {
  data: new SlashCommandBuilder()
    .setName('xp-set')
    .setDescription('Ändere XP und Level eines Users (nur Superuser)')
    .addUserOption(option => option.setName('user').setDescription('Der User').setRequired(true))
    .addIntegerOption(option => option.setName('xp').setDescription('Neue XP').setRequired(true))
    .addIntegerOption(option => option.setName('level').setDescription('Neues Level').setRequired(true)),
  async execute(interaction) {
    // Nur Superuser
    if (!isSuperuser(interaction.user.id)) {
      return interaction.reply({
        content: '❌ Du darfst diesen Command nicht nutzen.',
        ephemeral: true,
      });
    }
    
    const targetUser = interaction.options.getUser('user');
    const newXP = interaction.options.getInteger('xp');
    const newLevel = interaction.options.getInteger('level');
    
    if (newXP < 0 || newLevel < 0) {
      return interaction.reply({
        content: '❌ XP und Level müssen ≥ 0 sein.',
        ephemeral: true,
      });
    }
    
    storage.setXP(interaction.guildId, targetUser.id, newXP, newLevel);
    
    await interaction.reply({
      content: `✅ **${targetUser.username}** hat jetzt Level ${newLevel} mit ${newXP} XP.`,
      ephemeral: false,
    });
  },
};

module.exports = {
  xpStats,
  xpBoard,
  xpSet,
};
