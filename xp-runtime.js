// xp-runtime.js
// Laufzeit-Logik des XP-Systems: XP je Nachricht vergeben, Level-Rollen
// verwalten und das XP-Board alle 24 Stunden aktualisieren (bestehende
// Nachricht bearbeiten statt täglich neu zu posten).

const { EmbedBuilder } = require('discord.js');
const storage = require('./storage');
const xp = require('./xp');
const logging = require('./logging');
const { errText } = require('./util');

const COOLDOWN_MS = 15 * 1000; // 1x pro 15s pro User -> verhindert Spam-Farming
const XP_MIN = 5;
const XP_MAX = 15;
const cooldowns = new Map(); // `${guildId}:${userId}` -> Zeitstempel

function roleNameForLevel(level) {
  return `Level ${level}`;
}

// Legt die Level-Rolle an, falls sie fehlt, und gibt sie zurück (oder null bei Fehlern).
async function ensureLevelRole(guild, level) {
  const name = roleNameForLevel(level);
  let role = guild.roles.cache.find((r) => r.name === name);
  if (role) return role;
  try {
    role = await guild.roles.create({ name, mentionable: false, reason: 'XP-System: Level-Rolle' });
    return role;
  } catch (err) {
    console.warn(`XP: Level-Rolle "${name}" auf ${guild.id} konnte nicht erstellt werden:`, errText(err));
    return null;
  }
}

async function handleMessageXP(message) {
  try {
    if (message.author.bot || !message.guild || message.content.trim().length < 3) return;

    const key = `${message.guildId}:${message.author.id}`;
    const now = Date.now();
    const last = cooldowns.get(key) || 0;
    if (now - last < COOLDOWN_MS) return;
    cooldowns.set(key, now);
    if (cooldowns.size > 5000) cooldowns.delete(cooldowns.keys().next().value); // simpler Schutz gegen unbegrenztes Wachstum

    const gain = XP_MIN + Math.floor(Math.random() * (XP_MAX - XP_MIN + 1));
    const before = storage.getUserXP(message.guildId, message.author.id);
    const newTotal = before.xp + gain;
    const newLevel = xp.levelFromTotalXp(newTotal);
    storage.setUserXP(message.guildId, message.author.id, newTotal, newLevel);

    if (newLevel > before.level) {
      await handleLevelUp(message, newLevel, newTotal);
    }
  } catch (err) {
    console.error('XP: Fehler bei der Nachrichtenverarbeitung:', errText(err));
  }
}

async function handleLevelUp(message, newLevel, totalXp) {
  const guild = message.guild;
  const member = message.member;
  let newRole = null;

  if (xp.isMilestoneLevel(newLevel)) {
    const role = await ensureLevelRole(guild, newLevel);
    if (role) {
      try {
        const me = await guild.members.fetchMe();
        if (role.position >= me.roles.highest.position) {
          console.warn(`XP: Rolle "${role.name}" liegt auf/über meiner höchsten Rolle auf ${guild.id} - kann sie nicht vergeben.`);
        } else if (!me.permissions.has('ManageRoles')) {
          console.warn(`XP: Fehlende Berechtigung "Rollen verwalten" auf ${guild.id}.`);
        } else {
          await member.roles.add(role, 'XP-System: Level erreicht');
          newRole = role;
        }
      } catch (err) {
        console.warn(`XP: Rolle konnte nicht vergeben werden auf ${guild.id}:`, errText(err));
      }
    }
  }

  try {
    await message.author.send({
      embeds: [
        new EmbedBuilder()
          .setTitle('🎉 Level Up!')
          .setDescription(`Du hast auf **${guild.name}** Level **${newLevel}** erreicht!`)
          .setColor(0x57f287)
          .addFields(
            { name: 'Level', value: String(newLevel), inline: true },
            { name: 'XP gesamt', value: String(totalXp), inline: true },
            ...(newRole ? [{ name: 'Neue Rolle', value: newRole.toString(), inline: true }] : [])
          ),
      ],
    });
  } catch (err) {
    // DMs deaktiviert - unkritisch
  }

  logging.logToGuild(message.client, guild.id, {
    title: '⭐ Level-Up',
    fields: [
      { name: 'Nutzer', value: `${message.author.tag}`, inline: true },
      { name: 'Neues Level', value: String(newLevel), inline: true },
    ],
  });
}

// Aktualisiert (oder erstellt einmalig) die Leaderboard-Nachricht eines Servers.
async function updateGuildBoard(client, guildId) {
  const settings = storage.getGuildSettings(guildId);
  if (!settings.xpBoardChannelId) return;

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;
  const channel = guild.channels.cache.get(settings.xpBoardChannelId);
  if (!channel || !channel.isTextBased()) return;

  const top = storage.getGuildLeaderboard(guildId).slice(0, 10);
  const lines = top.length
    ? top.map((e, i) => `**${i + 1}.** <@${e.userId}> — Level ${e.level} (${e.xp} XP)`)
    : ['Noch keine Einträge - schreib eine Nachricht, um XP zu sammeln!'];

  const embed = new EmbedBuilder()
    .setTitle(`🏆 XP-Leaderboard — ${guild.name}`)
    .setColor(0xffd700)
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'Aktualisiert sich automatisch alle 24 Stunden.' })
    .setTimestamp();

  try {
    if (settings.xpBoardMessageId) {
      const msg = await channel.messages.fetch(settings.xpBoardMessageId).catch(() => null);
      if (msg) {
        await msg.edit({ embeds: [embed] });
        return;
      }
    }
    const sent = await channel.send({ embeds: [embed] });
    storage.setGuildSetting(guildId, 'xpBoardMessageId', sent.id);
  } catch (err) {
    console.warn(`XP: Leaderboard auf ${guildId} konnte nicht aktualisiert werden:`, errText(err));
  }
}

async function updateAllBoards(client) {
  for (const guildId of client.guilds.cache.keys()) {
    await updateGuildBoard(client, guildId);
  }
}

// Startet den 24h-Update-Zyklus (wird einmal beim Bot-Start aufgerufen).
function startBoardScheduler(client) {
  const DAY_MS = 24 * 60 * 60 * 1000;
  updateAllBoards(client).catch(() => {});
  setInterval(() => updateAllBoards(client).catch(() => {}), DAY_MS);
}

module.exports = { handleMessageXP, updateGuildBoard, updateAllBoards, startBoardScheduler };
