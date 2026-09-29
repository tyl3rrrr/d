// xp-runtime.js
// Runtime logic of the XP system: awards XP per message, manages level
// roles, and updates the XP board every 24 hours (editing the existing
// message instead of posting a new one every day).

const { EmbedBuilder } = require('discord.js');
const storage = require('./storage');
const xp = require('./xp');
const logging = require('./logging');
const { errText } = require('./util');

const COOLDOWN_MS = 15 * 1000; // once per 15s per user -> prevents spam-farming
const XP_MIN = 5;
const XP_MAX = 15;
const cooldowns = new Map(); // `${guildId}:${userId}` -> timestamp

function roleNameForLevel(level) {
  return `Level ${level}`;
}

// Creates the level role if it's missing, and returns it (or null on error).
async function ensureLevelRole(guild, level) {
  const name = roleNameForLevel(level);
  let role = guild.roles.cache.find((r) => r.name === name);
  if (role) return role;
  try {
    role = await guild.roles.create({ name, mentionable: false, reason: 'XP system: level role' });
    return role;
  } catch (err) {
    console.warn(`XP: could not create level role "${name}" on ${guild.id}:`, errText(err));
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
    if (cooldowns.size > 5000) cooldowns.delete(cooldowns.keys().next().value); // simple guard against unbounded growth

    const gain = XP_MIN + Math.floor(Math.random() * (XP_MAX - XP_MIN + 1));
    const before = storage.getUserXP(message.guildId, message.author.id);
    const newTotal = before.xp + gain;
    const newLevel = xp.levelFromTotalXp(newTotal);
    storage.setUserXP(message.guildId, message.author.id, newTotal, newLevel);

    if (newLevel > before.level) {
      await handleLevelUp(message, newLevel, newTotal);
    }
  } catch (err) {
    console.error('XP: error while processing a message:', errText(err));
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
          console.warn(`XP: role "${role.name}" is at/above my highest role on ${guild.id} - can't grant it.`);
        } else if (!me.permissions.has('ManageRoles')) {
          console.warn(`XP: missing "Manage Roles" permission on ${guild.id}.`);
        } else {
          await member.roles.add(role, 'XP system: level reached');
          newRole = role;
        }
      } catch (err) {
        console.warn(`XP: could not grant role on ${guild.id}:`, errText(err));
      }
    }
  }

  try {
    await message.author.send({
      embeds: [
        new EmbedBuilder()
          .setTitle('🎉 Level Up!')
          .setDescription(`You reached level **${newLevel}** on **${guild.name}**!`)
          .setColor(0x57f287)
          .addFields(
            { name: 'Level', value: String(newLevel), inline: true },
            { name: 'Total XP', value: String(totalXp), inline: true },
            ...(newRole ? [{ name: 'New role', value: newRole.toString(), inline: true }] : [])
          ),
      ],
    });
  } catch (err) {
    // DMs disabled - not critical
  }

  logging.logToGuild(message.client, guild.id, {
    title: '⭐ Level Up',
    fields: [
      { name: 'User', value: `${message.author.tag}`, inline: true },
      { name: 'New level', value: String(newLevel), inline: true },
    ],
  });
}

// Updates (or creates once) a server's leaderboard message.
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
    : ['No entries yet - send a message to start earning XP!'];

  const embed = new EmbedBuilder()
    .setTitle(`🏆 XP Leaderboard — ${guild.name}`)
    .setColor(0xffd700)
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'Updates automatically every 24 hours.' })
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
    console.warn(`XP: could not update leaderboard on ${guildId}:`, errText(err));
  }
}

async function updateAllBoards(client) {
  for (const guildId of client.guilds.cache.keys()) {
    await updateGuildBoard(client, guildId);
  }
}

// Starts the 24h update cycle (called once on bot startup).
function startBoardScheduler(client) {
  const DAY_MS = 24 * 60 * 60 * 1000;
  updateAllBoards(client).catch(() => {});
  setInterval(() => updateAllBoards(client).catch(() => {}), DAY_MS);
}

module.exports = { handleMessageXP, updateGuildBoard, updateAllBoards, startBoardScheduler };
