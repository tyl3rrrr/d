// dm-notify.js
//
// Sendet betroffenen Nutzern eine DM, wenn eine Mod-Aktion gegen sie
// durchgeführt wird (Warn, Kick, Ban, Timeout) - inkl. Grund und
// ausführender Person. Der Bot EMPFÄNGT dabei keine DMs (siehe index.js -
// es gibt bewusst keinen DM-Nachrichten-Handler), er sendet nur aktiv.
//
// Schlägt ein Versand fehl (z.B. weil der Nutzer DMs von Server-Mitgliedern
// deaktiviert hat oder den Bot blockiert hat), wird das nur geloggt und die
// eigentliche Mod-Aktion läuft trotzdem normal weiter.

const { EmbedBuilder } = require('discord.js');

const ACTION_LABELS = {
  warn: { title: '⚠️ Du wurdest verwarnt', color: 0xfee75c },
  kick: { title: '👋 Du wurdest gekickt', color: 0xed4245 },
  ban: { title: '🔨 Du wurdest gebannt', color: 0xed4245 },
  timeout: { title: '🔇 Du wurdest in Timeout versetzt', color: 0xed4245 },
};

async function sendModActionDM(user, { action, reason, moderatorTag, guildName, durationMinutes }) {
  const label = ACTION_LABELS[action] || { title: 'Mod-Aktion', color: 0x5865f2 };

  const embed = new EmbedBuilder()
    .setTitle(label.title)
    .setColor(label.color)
    .addFields(
      { name: 'Server', value: guildName },
      { name: 'Grund', value: reason || 'Kein Grund angegeben' },
      { name: 'Von', value: moderatorTag }
    )
    .setTimestamp();

  if (action === 'timeout' && durationMinutes) {
    embed.addFields({ name: 'Dauer', value: `${durationMinutes} Minute(n)` });
  }

  try {
    await user.send({ embeds: [embed] });
    return true;
  } catch (err) {
    console.warn(`Konnte DM an ${user.tag} nicht senden (evtl. DMs deaktiviert/Bot blockiert):`, err.message);
    return false;
  }
}

module.exports = { sendModActionDM };
