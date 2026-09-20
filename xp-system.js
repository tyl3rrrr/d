// xp-system.js
// Zentrale XP-Verwaltung: XP sammeln, Level-Up, Level-Rollen vergeben

const { EmbedBuilder, Events } = require('discord.js');
const storage = require('./storage');
const { logToChannel } = require('./commands-logs');

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

// Definierte Level-Rollen (auf jedem Server separat)
const LEVEL_ROLES = [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 150, 200, 250, 300, 500];

/**
 * Erstelle oder hole Level-Rollen für einen Server
 */
async function setupLevelRoles(guild) {
  try {
    for (const level of LEVEL_ROLES) {
      const roleName = `Level ${level}`;
      
      // Prüfe, ob Rolle bereits existiert
      let role = guild.roles.cache.find(r => r.name === roleName);
      
      if (!role) {
        // Erstelle neue Rolle
        try {
          role = await guild.roles.create({
            name: roleName,
            color: 0x5865F2,
            position: 5,
            mentionable: false,
          });
          console.log(`✅ Erstellt Rolle: ${roleName}`);
        } catch (e) {
          console.warn(`Konnte Rolle ${roleName} nicht erstellen: ${e.message}`);
        }
      }
    }
  } catch (error) {
    console.error('Fehler beim Setup der Level-Rollen:', error);
  }
}

/**
 * XP hinzufügen und Level-Checks durchführen
 */
async function addXPAndCheckLevelUp(message) {
  try {
    const guildId = message.guildId;
    const userId = message.author.id;
    
    // XP hinzufügen (zwischen 1-5 pro Nachricht)
    const xpGain = Math.floor(Math.random() * 5) + 1;
    const oldXP = storage.getXP(guildId, userId);
    const oldLevel = oldXP.level || 0;
    
    const newXP = oldXP.xp + xpGain;
    const newLevel = getLevelFromXP(newXP);
    
    storage.setXP(guildId, userId, newXP, newLevel);
    
    // Level-Up Check
    if (newLevel > oldLevel) {
      await handleLevelUp(message, userId, newLevel, newXP);
    }
  } catch (error) {
    console.error('Fehler beim XP-System:', error);
  }
}

/**
 * Behandle Level-Up Event
 */
async function handleLevelUp(message, userId, newLevel, newXP) {
  try {
    const guild = message.guild;
    const member = message.member;
    
    if (!member) return;
    
    // Prüfe ob Rolle-Zuweisung erforderlich ist
    if (LEVEL_ROLES.includes(newLevel)) {
      const roleName = `Level ${newLevel}`;
      let role = guild.roles.cache.find(r => r.name === roleName);
      
      if (!role) {
        // Versuche zu erstellen
        try {
          role = await guild.roles.create({
            name: roleName,
            color: 0x5865F2,
            position: 5,
          });
        } catch (e) {
          console.warn(`Konnte Rolle ${roleName} nicht erstellen: ${e.message}`);
          return;
        }
      }
      
      // Vergebe Rolle
      try {
        await member.roles.add(role).catch(() => {
          console.warn(`Konnte Rolle ${roleName} nicht an ${userId} vergeben.`);
        });
      } catch (e) {
        console.warn(`Fehler beim Rollen-Zuweisen: ${e.message}`);
      }
    }
    
    // Sende Level-Up Benachrichtigung im Channel
    try {
      const embed = new EmbedBuilder()
        .setTitle(`🎉 Level Up!`)
        .setDescription(`${message.author} hat Level **${newLevel}** erreicht!`)
        .setColor(0x57F287)
        .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: 'Neues Level', value: String(newLevel), inline: true },
          { name: 'XP', value: String(newXP), inline: true }
        )
        .setTimestamp();
      
      await message.reply({ embeds: [embed] }).catch(() => {});
    } catch (e) {
      console.warn(`Fehler bei Level-Up Nachricht: ${e.message}`);
    }
    
    // Sende DM an User
    try {
      const dmEmbed = new EmbedBuilder()
        .setTitle(`🎉 Gratulationen!`)
        .setDescription(`Du hast **Level ${newLevel}** auf **${guild.name}** erreicht!`)
        .setColor(0x57F287)
        .setThumbnail(guild.iconURL({ dynamic: true }))
        .addFields(
          { name: 'Level', value: String(newLevel), inline: true },
          { name: 'XP Gesamt', value: String(newXP), inline: true },
          { name: 'Server', value: guild.name, inline: false }
        )
        .setTimestamp();
      
      const levelRoleName = `Level ${newLevel}`;
      const levelRole = guild.roles.cache.find(r => r.name === levelRoleName);
      if (levelRole) {
        dmEmbed.addFields({ name: 'Neue Rolle', value: levelRole.toString(), inline: false });
      }
      
      await message.author.send({ embeds: [dmEmbed] }).catch(() => {
        console.warn(`Konnte DM an ${message.author.id} nicht senden.`);
      });
    } catch (e) {
      console.warn(`Fehler bei Level-Up DM: ${e.message}`);
    }
    
    // Log Event
    try {
      const logEmbed = new EmbedBuilder()
        .setTitle('📊 Level Up')
        .setDescription(`${message.author} hat Level **${newLevel}** erreicht!`)
        .setColor(0x57F287)
        .setTimestamp();
      
      await logToChannel(message.client, guild.id, logEmbed);
    } catch (e) {
      // Ignoriert wenn kein Log-Channel gesetzt
    }
  } catch (error) {
    console.error('Fehler bei Level-Up Behandlung:', error);
  }
}

/**
 * Update XP-Board Nachricht (alle 24 Stunden)
 */
async function updateXPBoard(client, guildId) {
  try {
    const settings = storage.getGuildSettings(guildId);
    if (!settings.xpBoardChannel || !settings.xpBoardMessageId) return;
    
    const guild = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(settings.xpBoardChannel);
    
    if (!channel || !channel.isTextBased()) return;
    
    const board = storage.getGuildXPBoard(guildId);
    const topUsers = board.slice(0, 10);
    
    let description = '';
    for (let i = 0; i < topUsers.length; i++) {
      const entry = topUsers[i];
      try {
        const user = await client.users.fetch(entry.userId);
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
    
    // Versuche bestehende Nachricht zu bearbeiten
    try {
      const message = await channel.messages.fetch(settings.xpBoardMessageId);
      await message.edit({ embeds: [embed] });
    } catch (e) {
      // Nachricht nicht gefunden - neue posten
      const msg = await channel.send({ embeds: [embed] });
      storage.setGuildSetting(guildId, 'xpBoardMessageId', msg.id);
    }
  } catch (e) {
    console.warn(`Fehler beim Update XP-Board für Server ${guildId}: ${e.message}`);
  }
}

/**
 * Setup XP-System Handler
 */
function setupXPSystem(client) {
  // Beim GuildCreate (Bot tritt Server bei): Setup Level-Rollen
  client.on(Events.GuildCreate, async (guild) => {
    console.log(`Bot beigetreten zu ${guild.name} - setup Level-Rollen...`);
    await setupLevelRoles(guild);
  });
  
  // XP beim Schreiben von Nachrichten
  client.on(Events.MessageCreate, async (message) => {
    // Bot-Nachrichten, DMs und Befehle ignorieren
    if (message.author.bot || !message.guild || message.content.startsWith('/')) return;
    
    // Nur gültige Nachrichten zählen (mindestens 5 Zeichen)
    if (message.content.length < 5) return;
    
    // Rate-Limit: Max 1x pro 10 Sekunden pro User
    if (!client.xpCooldowns) client.xpCooldowns = new Map();
    
    const key = `${message.guildId}-${message.author.id}`;
    const now = Date.now();
    const cooldownAmount = 10 * 1000; // 10 Sekunden
    
    if (client.xpCooldowns.has(key)) {
      const expirationTime = client.xpCooldowns.get(key) + cooldownAmount;
      if (now < expirationTime) return; // Noch in Cooldown
    }
    
    client.xpCooldowns.set(key, now);
    
    // XP hinzufügen
    await addXPAndCheckLevelUp(message);
  });
  
  // XP-Board alle 24 Stunden aktualisieren
  if (!client.xpBoardIntervals) client.xpBoardIntervals = new Map();
  
  client.on(Events.GuildCreate, async (guild) => {
    // Starte Board-Update für diesen Server (wenn konfiguriert)
    const updateInterval = setInterval(async () => {
      await updateXPBoard(client, guild.id);
    }, 24 * 60 * 60 * 1000); // 24 Stunden
    
    client.xpBoardIntervals.set(guild.id, updateInterval);
  });
}

module.exports = {
  setupXPSystem,
  addXPAndCheckLevelUp,
  getXPForLevel,
  getLevelFromXP,
  LEVEL_ROLES,
  updateXPBoard,
};
