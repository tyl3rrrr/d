// automod-filter.js
//
// LOKALER Wortfilter - läuft komplett im Bot selbst (prüft jede Nachricht
// direkt im Code gegen eine Wortliste), NICHT über Discords AutoMod-API.
// Das vermeidet die bekannten Zuverlässigkeitsprobleme der Discord-AutoMod-
// API vollständig, da wir gar keine Anfrage an sie stellen.
//
// Funktionsweise: Bei jeder Nachricht wird per Wortgrenzen-Regex (\b...\b,
// case-insensitive) geprüft, ob eines der blockierten Wörter als EIGENES
// Wort vorkommt (nicht als Teil eines anderen Wortes - "Fort" matcht also
// NICHT automatisch in "Fortnite"). Bei einem Treffer wird die Nachricht
// gelöscht und eine kurze, sich selbst löschende Hinweis-Nachricht gepostet.
//
// EINSCHRÄNKUNG (ehrlich benannt): Einfache Umschreibungen wie "N i g g a"
// (mit Leerzeichen), Sonderzeichen oder Leetspeak (z.B. "n1gga") werden von
// dieser einfachen Wortgrenzen-Prüfung NICHT erkannt. Für die meisten
// Communities reicht das aus; für einen robusteren Filter wäre eine
// Fuzzy-/Normalisierungs-Logik nötig (auf Anfrage nachrüstbar).

const storage = require('./storage');

const DEFAULT_BANNED_WORDS = [
  'Nigga',
  'Negger',
  'Asylant',
  'Bastard',
  'Nutte',
  'Hundesohn',
  'Hurensohn',
  'Fotze',
  'Slime',
  'Fort',
  'Disc',
  'LoL',
];

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Gibt die aktive Wortliste für einen Server zurück. Beim allerersten
// Aufruf für einen Server wird die Standardliste als Startpunkt gespeichert,
// damit /automod-words add/remove direkt darauf aufbauen kann.
function getBannedWords(guildId) {
  const settings = storage.getGuildSettings(guildId);
  if (Array.isArray(settings.bannedWords)) return settings.bannedWords;
  storage.setGuildSetting(guildId, 'bannedWords', [...DEFAULT_BANNED_WORDS]);
  return DEFAULT_BANNED_WORDS;
}

function setBannedWords(guildId, words) {
  storage.setGuildSetting(guildId, 'bannedWords', words);
}

function findBannedWord(content, guildId) {
  const words = getBannedWords(guildId);
  for (const word of words) {
    const pattern = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i');
    if (pattern.test(content)) return word;
  }
  return null;
}

// Wird von index.js für JEDE Server-Nachricht aufgerufen. Gibt true zurück,
// wenn die Nachricht wegen eines blockierten Wortes behandelt (gelöscht)
// wurde - der Aufrufer sollte die Nachricht dann NICHT weiter verarbeiten
// (z.B. nicht mehr an !support weitergeben).
async function handleAutoModCheck(message) {
  if (message.author.bot) return false;
  if (!message.guild) return false;

  const matchedWord = findBannedWord(message.content, message.guild.id);
  if (!matchedWord) return false;

  const settings = storage.getGuildSettings(message.guild.id);

  try {
    await message.delete();
  } catch (err) {
    console.warn('Automod: Konnte Nachricht nicht löschen (fehlende Berechtigung "Nachrichten verwalten"?):', err.message);
    return true;
  }

  const notice = await message.channel
    .send(`🚫 <@${message.author.id}>, deine Nachricht wurde entfernt (enthielt ein blockiertes Wort).`)
    .catch(() => null);

  if (notice) {
    setTimeout(() => notice.delete().catch(() => {}), 6000);
  }

  if (settings.logChannelId) {
    const logChannel = message.guild.channels.cache.get(settings.logChannelId);
    if (logChannel && logChannel.isTextBased()) {
      logChannel
        .send(
          `🚫 **Automod:** Nachricht von **${message.author.tag}** in ${message.channel.toString()} entfernt ` +
            `(blockiertes Wort erkannt).`
        )
        .catch(() => {});
    }
  }

  return true;
}

module.exports = { handleAutoModCheck, getBannedWords, setBannedWords, findBannedWord, DEFAULT_BANNED_WORDS };
