// dm-notify.js
//
// Sends affected users a DM when a mod action is taken against them (warn,
// kick, ban, timeout) - including the reason and who did it. The bot does NOT
// RECEIVE DMs (see index.js - there is deliberately no DM message handler),
// it only sends actively.
//
// If sending fails (e.g. because the user disabled DMs from server members or
// blocked the bot), that is only logged and the actual mod action proceeds
// normally.

const { EmbedBuilder } = require('discord.js');

const ACTION_LABELS = {
  warn: { title: '⚠️ You were warned', color: 0xfee75c },
  kick: { title: '👋 You were kicked', color: 0xed4245 },
  ban: { title: '🔨 You were banned', color: 0xed4245 },
  timeout: { title: '🔇 You were timed out', color: 0xed4245 },
};

async function sendModActionDM(user, { action, reason, moderatorTag, guildName, durationMinutes }) {
  const label = ACTION_LABELS[action] || { title: 'Mod action', color: 0x5865f2 };

  const embed = new EmbedBuilder()
    .setTitle(label.title)
    .setColor(label.color)
    .addFields(
      { name: 'Server', value: guildName },
      { name: 'Reason', value: reason || 'No reason given' },
      { name: 'By', value: moderatorTag }
    )
    .setTimestamp();

  if (action === 'timeout' && durationMinutes) {
    embed.addFields({ name: 'Duration', value: `${durationMinutes} minute(s)` });
  }

  try {
    await user.send({ embeds: [embed] });
    return true;
  } catch (err) {
    console.warn(`Could not send a DM to ${user.tag} (DMs may be disabled / bot blocked):`, err.message);
    return false;
  }
}

module.exports = { sendModActionDM };
