// automod-api.js
//
// AutoMod über die OFFIZIELLE Discord-AutoMod-API (Auto Moderation Rules).
// Es gibt KEINEN lokalen Nachrichtenfilter im Bot-Code mehr: Discord selbst
// prüft und blockiert die Nachrichten (schneller, auch bei Bot-Ausfall aktiv,
// und die Regeln sind in den Servereinstellungen unter "AutoMod" sichtbar).
//
// Wir sprechen die REST-Endpunkte direkt über client.rest an (statt über die
// discord.js-Manager) - so sind wir unabhängig von Cache-Einstellungen und
// von der jeweiligen discord.js-Unterversion.
//
// Voraussetzung: Der Bot braucht auf dem Server die Berechtigung
// "Server verwalten" (Manage Server / MANAGE_GUILD).
//
// Zahlenwerte laut Discord-Doku (Auto Moderation):
//   trigger_type: 1 KEYWORD, 3 SPAM, 4 KEYWORD_PRESET, 5 MENTION_SPAM, 6 MEMBER_PROFILE
//   event_type:   1 MESSAGE_SEND, 2 MEMBER_UPDATE
//   action type:  1 BLOCK_MESSAGE, 2 SEND_ALERT_MESSAGE, 3 TIMEOUT, 4 BLOCK_MEMBER_INTERACTION
//   presets:      1 PROFANITY, 2 SEXUAL_CONTENT, 3 SLURS

const { Routes } = require('discord.js');
const storage = require('./storage');
const { sleep, truncate, errText } = require('./util');

const TRIGGER = { KEYWORD: 1, SPAM: 3, KEYWORD_PRESET: 4, MENTION_SPAM: 5, MEMBER_PROFILE: 6 };
const EVENT = { MESSAGE_SEND: 1, MEMBER_UPDATE: 2 };
const ACTION = { BLOCK_MESSAGE: 1, SEND_ALERT_MESSAGE: 2, TIMEOUT: 3, BLOCK_MEMBER_INTERACTION: 4 };
const PRESET = { PROFANITY: 1, SEXUAL_CONTENT: 2, SLURS: 3 };

// Pro Server erlaubt Discord maximal: 6 Keyword + 1 Spam + 1 Preset + 1 Mention-Spam
// + 1 Member-Profile = 10 Regeln.
const MAX_RULES_PER_GUILD = 10;
// Laut Discord-Developer-Hilfe: "mindestens 100 AutoMod-Regeln über alle Server".
const BADGE_RULE_TARGET = 100;

const RULE_NAMES = {
  words: 'tylxrrrr | Wortfilter',
  spam: 'tylxrrrr | Spam-Schutz',
  mention: 'tylxrrrr | Mention-Spam',
  preset: 'tylxrrrr | Standard-Filter',
  profile: 'tylxrrrr | Profil-Filter',
};
const RULE_ORDER = ['words', 'spam', 'mention', 'preset', 'profile'];
const RULE_LABELS = {
  words: 'Wortfilter (eigene Wortliste)',
  spam: 'Spam-Schutz',
  mention: 'Mention-Spam-Schutz',
  preset: 'Standard-Filter (Beleidigungen, Sexuelles, Schimpfwörter)',
  profile: 'Profil-Filter (Name/Bio neuer Mitglieder)',
};

const DEFAULT_WORDS = [
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

// Der Profil-Filter (Name/Bio) nutzt bewusst NUR eindeutig beleidigende Begriffe -
// nicht die komplette Wortliste (sonst würden harmlose Namen wie "Fort" blockiert).
const PROFILE_WORDS = ['Nigga', 'Negger', 'Hurensohn', 'Hundesohn', 'Fotze', 'Nutte'];

const BLOCK_TEXT = '🚫 Diese Nachricht wurde vom AutoMod des Servers blockiert.';
const MAX_KEYWORD_LENGTH = 60; // Discord-Limit pro Stichwort
const MAX_KEYWORDS = 1000; // Discord-Limit pro Regel

function normalizeWord(word) {
  const w = String(word || '').replace(/\s+/g, ' ').trim();
  if (!w) return { ok: false, error: 'Das Wort darf nicht leer sein.' };
  if (w.length > MAX_KEYWORD_LENGTH) return { ok: false, error: `Ein Wort darf höchstens ${MAX_KEYWORD_LENGTH} Zeichen lang sein.` };
  return { ok: true, word: w };
}

// Verständliche Fehlermeldung für Discord-API-Fehler.
function explainError(err) {
  if (!err) return 'Unbekannter Fehler.';
  if (err.status === 403 || err.code === 50013 || err.code === 50001) {
    return 'Mir fehlt die Berechtigung **„Server verwalten“** (Manage Server). Bitte gib dem Bot diese Berechtigung, damit er AutoMod-Regeln verwalten kann.';
  }
  const raw = err.rawError && err.rawError.message ? ` (${err.rawError.message})` : '';
  return `${errText(err)}${raw}`;
}

// ---------------------------------------------------------------------------
// Regel-Definitionen (Payloads für POST /guilds/{id}/auto-moderation/rules)
// ---------------------------------------------------------------------------
function buildRuleBody(kind, words) {
  const block = [{ type: ACTION.BLOCK_MESSAGE, metadata: { custom_message: BLOCK_TEXT } }];
  const name = RULE_NAMES[kind];

  switch (kind) {
    case 'words':
      return {
        name,
        event_type: EVENT.MESSAGE_SEND,
        trigger_type: TRIGGER.KEYWORD,
        trigger_metadata: { keyword_filter: words, regex_patterns: [] },
        actions: block,
        enabled: true,
      };
    case 'spam':
      return { name, event_type: EVENT.MESSAGE_SEND, trigger_type: TRIGGER.SPAM, actions: block, enabled: true };
    case 'mention':
      return {
        name,
        event_type: EVENT.MESSAGE_SEND,
        trigger_type: TRIGGER.MENTION_SPAM,
        trigger_metadata: { mention_total_limit: 8, mention_raid_protection_enabled: true },
        actions: block,
        enabled: true,
      };
    case 'preset':
      return {
        name,
        event_type: EVENT.MESSAGE_SEND,
        trigger_type: TRIGGER.KEYWORD_PRESET,
        trigger_metadata: { presets: [PRESET.PROFANITY, PRESET.SEXUAL_CONTENT, PRESET.SLURS] },
        actions: block,
        enabled: true,
      };
    case 'profile':
      return {
        name,
        event_type: EVENT.MEMBER_UPDATE,
        trigger_type: TRIGGER.MEMBER_PROFILE,
        trigger_metadata: { keyword_filter: PROFILE_WORDS, regex_patterns: [] },
        actions: [{ type: ACTION.BLOCK_MEMBER_INTERACTION }],
        enabled: true,
      };
    default:
      throw new Error(`Unbekannter Regeltyp: ${kind}`);
  }
}

// ---------------------------------------------------------------------------
// Regeln lesen
// ---------------------------------------------------------------------------
async function listAllRules(client, guildId) {
  const rules = await client.rest.get(Routes.guildAutoModerationRules(guildId));
  return Array.isArray(rules) ? rules : [];
}

// Nur die vom Bot erstellten Regeln (creator_id = Bot-ID).
async function listBotRules(client, guildId) {
  const rules = await listAllRules(client, guildId);
  return rules.filter((r) => r.creator_id === client.user.id);
}

function findRuleByKind(botRules, kind) {
  return botRules.find((r) => r.name === RULE_NAMES[kind]) || null;
}

// Startwörter für einen Server: alte lokale Liste (Migration) oder Standardliste.
function seedWords(guildId) {
  const legacy = storage.getGuildSettings(guildId).bannedWords;
  return Array.isArray(legacy) && legacy.length > 0 ? [...legacy] : [...DEFAULT_WORDS];
}

async function createRule(client, guildId, kind, words) {
  return client.rest.post(Routes.guildAutoModerationRules(guildId), {
    body: buildRuleBody(kind, words),
    reason: 'tylxrrrr Bot: AutoMod-Regel erstellt',
  });
}

// Liefert die Wortfilter-Regel des Bots (legt sie an, falls sie fehlt).
async function ensureWordRule(client, guildId) {
  const botRules = await listBotRules(client, guildId);
  const existing = findRuleByKind(botRules, 'words');
  if (existing) return existing;

  const rule = await createRule(client, guildId, 'words', seedWords(guildId));
  // Migration abgeschlossen: die alte lokale Liste wird nicht mehr gebraucht.
  storage.removeGuildSetting(guildId, 'bannedWords');
  return rule;
}

function getWordsFromRule(rule) {
  return (rule.trigger_metadata && rule.trigger_metadata.keyword_filter) || [];
}

// Schreibt die neue Wortliste in die Wortfilter-Regel.
async function setWords(client, guildId, rule, words) {
  if (words.length > MAX_KEYWORDS) throw new Error(`Maximal ${MAX_KEYWORDS} Wörter pro Regel möglich.`);
  const meta = rule.trigger_metadata || {};
  return client.rest.patch(Routes.guildAutoModerationRule(guildId, rule.id), {
    body: {
      trigger_metadata: {
        keyword_filter: words,
        regex_patterns: meta.regex_patterns || [],
        allow_list: meta.allow_list || [],
      },
    },
    reason: 'tylxrrrr Bot: Wortliste geändert',
  });
}

// Legt alle Standardregeln an, die noch fehlen. Idempotent.
async function createStandardRules(client, guildId) {
  const results = [];
  let botRules;
  try {
    botRules = await listBotRules(client, guildId);
  } catch (err) {
    return [{ kind: 'all', status: 'error', error: explainError(err) }];
  }

  const words = (() => {
    const wordRule = findRuleByKind(botRules, 'words');
    return wordRule ? getWordsFromRule(wordRule) : seedWords(guildId);
  })();

  for (const kind of RULE_ORDER) {
    if (findRuleByKind(botRules, kind)) {
      results.push({ kind, status: 'exists' });
      continue;
    }
    try {
      await createRule(client, guildId, kind, words);
      if (kind === 'words') storage.removeGuildSetting(guildId, 'bannedWords');
      results.push({ kind, status: 'created' });
    } catch (err) {
      results.push({ kind, status: 'error', error: explainError(err) });
    }
  }
  return results;
}

async function removeBotRules(client, guildId) {
  const botRules = await listBotRules(client, guildId);
  let removed = 0;
  for (const rule of botRules) {
    try {
      await client.rest.delete(Routes.guildAutoModerationRule(guildId, rule.id), { reason: 'tylxrrrr Bot: AutoMod-Regeln entfernt' });
      removed++;
    } catch (err) {
      console.warn(`AutoMod: Regel ${rule.id} auf ${guildId} konnte nicht gelöscht werden:`, errText(err));
    }
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Auto-Provisionierung: Ersatz für den früheren lokalen Filter, der auf JEDEM
// Server automatisch aktiv war. Legt (nur) die Wortfilter-Regel an. Abschaltbar
// mit AUTOMOD_AUTO_PROVISION=false in der .env. Weitere Regeln: /automod setup.
// ---------------------------------------------------------------------------
async function provisionGuild(client, guild) {
  if (String(process.env.AUTOMOD_AUTO_PROVISION || 'true').toLowerCase() === 'false') return;
  try {
    await ensureWordRule(client, guild.id);
  } catch (err) {
    if (err.status === 403 || err.code === 50013) {
      console.warn(`AutoMod: Keine Berechtigung "Server verwalten" auf "${guild.name}" - Wortfilter-Regel nicht angelegt.`);
    } else {
      console.warn(`AutoMod: Regel auf "${guild.name}" konnte nicht angelegt werden:`, errText(err));
    }
  }
}

async function provisionAllGuilds(client) {
  for (const guild of client.guilds.cache.values()) {
    await provisionGuild(client, guild);
    await sleep(400); // schonend für das Rate-Limit
  }
}

// ---------------------------------------------------------------------------
// Badge-Report ("Uses AutoMod"): Zählt die vom Bot erstellten Regeln über alle Server.
// ---------------------------------------------------------------------------
async function badgeReport(client) {
  const perGuild = [];
  let total = 0;
  for (const guild of client.guilds.cache.values()) {
    let count = 0;
    let error = null;
    try {
      count = (await listBotRules(client, guild.id)).length;
    } catch (err) {
      error = explainError(err);
    }
    total += count;
    perGuild.push({ id: guild.id, name: guild.name, count, error });
    await sleep(200);
  }

  const guildCount = client.guilds.cache.size;
  let hasBadgeFlag = null;
  try {
    const app = await client.application.fetch();
    // Application-Flag "APPLICATION_AUTO_MODERATION_RULE_CREATE_BADGE" = 1 << 6
    hasBadgeFlag = (Number(app.flags && app.flags.bitfield) & (1 << 6)) !== 0;
  } catch (err) {
    hasBadgeFlag = null; // konnte nicht ermittelt werden
  }

  return {
    perGuild,
    guildCount,
    total,
    target: BADGE_RULE_TARGET,
    maxPerGuild: MAX_RULES_PER_GUILD,
    maxPossible: guildCount * MAX_RULES_PER_GUILD,
    minGuildsNeeded: Math.ceil(BADGE_RULE_TARGET / MAX_RULES_PER_GUILD),
    hasBadgeFlag,
  };
}

// ---------------------------------------------------------------------------
// Logging von AutoMod-Eingriffen in den Log-Kanal (falls gesetzt).
// Ersetzt die frühere Log-Meldung des lokalen Filters.
// ---------------------------------------------------------------------------
async function logExecution(execution) {
  try {
    const guild = execution.guild;
    if (!guild) return;
    const settings = storage.getGuildSettings(guild.id);
    if (!settings.logChannelId) return;
    const channel = guild.channels.cache.get(settings.logChannelId);
    if (!channel || !channel.isTextBased()) return;

    const where = execution.channelId ? `<#${execution.channelId}>` : 'unbekanntem Kanal';
    const keyword = execution.matchedKeyword ? ` (Treffer: \`${truncate(execution.matchedKeyword, 40)}\`)` : '';
    await channel.send({
      content: `🚫 **AutoMod:** Aktion gegen <@${execution.userId}> in ${where}${keyword}.`,
      allowedMentions: { parse: [] },
    });
  } catch (err) {
    console.warn('AutoMod: Log-Nachricht konnte nicht gesendet werden:', errText(err));
  }
}

module.exports = {
  TRIGGER,
  RULE_NAMES,
  RULE_ORDER,
  RULE_LABELS,
  DEFAULT_WORDS,
  MAX_RULES_PER_GUILD,
  BADGE_RULE_TARGET,
  normalizeWord,
  explainError,
  buildRuleBody,
  listBotRules,
  findRuleByKind,
  ensureWordRule,
  getWordsFromRule,
  setWords,
  createStandardRules,
  removeBotRules,
  provisionGuild,
  provisionAllGuilds,
  badgeReport,
  logExecution,
};
