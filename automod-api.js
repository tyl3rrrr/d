// automod-api.js
//
// AutoMod via the OFFICIAL Discord AutoMod API (Auto Moderation Rules).
// There is NO local message filter in the bot code anymore: Discord itself
// checks and blocks messages (faster, still active even if the bot is down,
// and the rules are visible under Server Settings -> AutoMod).
//
// We call the REST endpoints directly through client.rest (instead of the
// discord.js managers) - this keeps us independent of cache settings and of
// the specific discord.js minor version.
//
// Requirement: the bot needs the "Manage Server" (MANAGE_GUILD) permission
// on the guild.
//
// Numeric values per Discord's Auto Moderation docs:
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

// Per guild, Discord allows at most: 6 keyword + 1 spam + 1 preset + 1 mention-spam
// + 1 member-profile = 10 rules.
const MAX_RULES_PER_GUILD = 10;
// Per Discord's developer help center: "at least 100 AutoMod rules across all guilds".
const BADGE_RULE_TARGET = 100;

const RULE_NAMES = {
  words: 'tylxrrrr | Word Filter',
  spam: 'tylxrrrr | Spam Protection',
  mention: 'tylxrrrr | Mention Spam',
  preset: 'tylxrrrr | Standard Filter',
  profile: 'tylxrrrr | Profile Filter',
};
const RULE_ORDER = ['words', 'spam', 'mention', 'preset', 'profile'];
const RULE_LABELS = {
  words: 'Word filter (custom word list)',
  spam: 'Spam protection',
  mention: 'Mention-spam protection',
  preset: 'Standard filter (profanity, sexual content, slurs)',
  profile: 'Profile filter (new member name/bio)',
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

// The profile filter (name/bio) deliberately uses ONLY clearly offensive terms -
// not the full word list (otherwise harmless names like "Fort" would be blocked).
const PROFILE_WORDS = ['Nigga', 'Negger', 'Hurensohn', 'Hundesohn', 'Fotze', 'Nutte'];

const BLOCK_TEXT = '🚫 This message was blocked by the server AutoMod.';
const MAX_KEYWORD_LENGTH = 60; // Discord limit per keyword
const MAX_KEYWORDS = 1000; // Discord limit per rule

function normalizeWord(word) {
  const w = String(word || '').replace(/\s+/g, ' ').trim();
  if (!w) return { ok: false, error: 'The word cannot be empty.' };
  if (w.length > MAX_KEYWORD_LENGTH) return { ok: false, error: `A word can be at most ${MAX_KEYWORD_LENGTH} characters long.` };
  return { ok: true, word: w };
}

// Human-readable message for Discord API errors.
function explainError(err) {
  if (!err) return 'Unknown error.';
  if (err.status === 403 || err.code === 50013 || err.code === 50001) {
    return "I'm missing the **\"Manage Server\"** permission. Please grant the bot this permission so it can manage AutoMod rules.";
  }
  const discordCode = err.rawError && err.rawError.code;
  if (discordCode === 'AUTO_MODERATION_MAX_RULES_OF_TYPE_EXCEEDED' || /MAX_RULES_OF_TYPE_EXCEEDED/i.test(err.message || '')) {
    return 'This guild already has the maximum number of AutoMod rules of this type (Discord limit) - even from rules not created by this bot. Delete a spare rule of that type under Server Settings -> AutoMod, then run `/automod setup` again.';
  }
  const raw = err.rawError && err.rawError.message ? ` (${err.rawError.message})` : '';
  return `${errText(err)}${raw}`;
}

// ---------------------------------------------------------------------------
// Rule definitions (payloads for POST /guilds/{id}/auto-moderation/rules)
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
      throw new Error(`Unknown rule kind: ${kind}`);
  }
}

// ---------------------------------------------------------------------------
// Reading rules
// ---------------------------------------------------------------------------
async function listAllRules(client, guildId) {
  const rules = await client.rest.get(Routes.guildAutoModerationRules(guildId));
  return Array.isArray(rules) ? rules : [];
}

// Only the rules created by the bot itself (creator_id = bot ID) - needed for
// the badge count (Discord only counts self-created rules there).
async function listBotRules(client, guildId) {
  const rules = await listAllRules(client, guildId);
  return rules.filter((r) => r.creator_id === client.user.id);
}

// Discord only allows a limited number of rules PER TRIGGER TYPE per guild
// (e.g. at most 6 keyword rules, but only 1 spam rule, etc. - see the
// MAX_RULES_PER_GUILD comment above). If that limit for a type is already
// used up by ANY existing rule (no matter who created it), creating another
// one fails with "Invalid Form Body" - which is exactly the bug that was
// reported. `resetAndCreateRules` below avoids this entirely by deleting
// every existing rule first, then creating clean ones.
const KIND_TRIGGER = { words: TRIGGER.KEYWORD, spam: TRIGGER.SPAM, mention: TRIGGER.MENTION_SPAM, preset: TRIGGER.KEYWORD_PRESET, profile: TRIGGER.MEMBER_PROFILE };

function findRuleByKind(botRules, kind) {
  return botRules.find((r) => r.name === RULE_NAMES[kind]) || null;
}

// Looks through ALL of a guild's rules (any creator) for one matching a kind:
// prefers an exact match on our own name, otherwise any rule with the same
// trigger type (informational use only - status display, not setup).
function findAnyRuleForKind(allRules, kind) {
  const own = allRules.find((r) => r.name === RULE_NAMES[kind]);
  if (own) return { rule: own, isOwn: true };
  const sameType = allRules.find((r) => r.trigger_type === KIND_TRIGGER[kind]);
  return sameType ? { rule: sameType, isOwn: false } : null;
}

// Seed words for a guild: legacy local list (migration) or the default list.
function seedWords(guildId) {
  const legacy = storage.getGuildSettings(guildId).bannedWords;
  return Array.isArray(legacy) && legacy.length > 0 ? [...legacy] : [...DEFAULT_WORDS];
}

async function createRule(client, guildId, kind, words) {
  return client.rest.post(Routes.guildAutoModerationRules(guildId), {
    body: buildRuleBody(kind, words),
    reason: 'tylxrrrr Bot: AutoMod rule created',
  });
}

// Deletes EVERY AutoMod rule on a guild, regardless of who created it. Used
// as a clean-slate step before (re-)creating the bot's standard rules, so a
// full guild-wide per-type limit (from old/foreign rules) can never block
// creation again.
async function removeAllRules(client, guildId) {
  const rules = await listAllRules(client, guildId);
  let removed = 0;
  const errors = [];
  for (const rule of rules) {
    try {
      await client.rest.delete(Routes.guildAutoModerationRule(guildId, rule.id), { reason: 'tylxrrrr Bot: reset before setup' });
      removed++;
    } catch (err) {
      errors.push({ id: rule.id, name: rule.name, error: explainError(err) });
    }
  }
  return { removed, total: rules.length, errors };
}

// Only the bot's own rules (used by /automod remove, which is scoped to what
// this bot itself is responsible for rather than wiping out AutoMod entirely).
async function removeBotRules(client, guildId) {
  const botRules = await listBotRules(client, guildId);
  let removed = 0;
  for (const rule of botRules) {
    try {
      await client.rest.delete(Routes.guildAutoModerationRule(guildId, rule.id), { reason: 'tylxrrrr Bot: AutoMod rules removed' });
      removed++;
    } catch (err) {
      console.warn(`AutoMod: could not delete rule ${rule.id} on ${guildId}:`, errText(err));
    }
  }
  return removed;
}

// THE fix for "/automod setup still doesn't work": delete every existing
// rule on the guild first (any creator - a clean slate), then create all 5
// standard rules fresh. This can never hit "max rules of type exceeded" from
// leftover/foreign rules, because nothing is left over.
async function resetAndCreateRules(client, guildId) {
  let reset;
  try {
    reset = await removeAllRules(client, guildId);
  } catch (err) {
    return { reset: { removed: 0, total: 0, errors: [{ error: explainError(err) }] }, results: RULE_ORDER.map((kind) => ({ kind, status: 'error', error: explainError(err) })) };
  }

  const wordsSeed = seedWords(guildId);
  const results = [];
  for (const kind of RULE_ORDER) {
    try {
      await createRule(client, guildId, kind, kind === 'words' ? wordsSeed : undefined);
      if (kind === 'words') storage.removeGuildSetting(guildId, 'bannedWords');
      results.push({ kind, status: 'created' });
    } catch (err) {
      results.push({ kind, status: 'error', error: explainError(err) });
    }
  }
  return { reset, results };
}

// Rolls resetAndCreateRules out across EVERY guild the bot is currently in -
// used by /automod setup-all (bot owner only) to publish the standard rule
// set everywhere in one go, not just on the guild the command was run in.
async function resetAndCreateAllGuilds(client) {
  const perGuild = [];
  for (const guild of client.guilds.cache.values()) {
    try {
      const outcome = await resetAndCreateRules(client, guild.id);
      perGuild.push({ guildId: guild.id, name: guild.name, ...outcome });
    } catch (err) {
      perGuild.push({ guildId: guild.id, name: guild.name, error: explainError(err) });
    }
    await sleep(500); // gentle on the rate limit across many guilds
  }
  return perGuild;
}

function getWordsFromRule(rule) {
  return (rule.trigger_metadata && rule.trigger_metadata.keyword_filter) || [];
}

// Writes a new word list to the word-filter rule.
async function setWords(client, guildId, rule, words) {
  if (words.length > MAX_KEYWORDS) throw new Error(`At most ${MAX_KEYWORDS} words per rule are allowed.`);
  const meta = rule.trigger_metadata || {};
  return client.rest.patch(Routes.guildAutoModerationRule(guildId, rule.id), {
    body: {
      trigger_metadata: {
        keyword_filter: words,
        regex_patterns: meta.regex_patterns || [],
        allow_list: meta.allow_list || [],
      },
    },
    reason: 'tylxrrrr Bot: word list changed',
  });
}

// Returns the bot's word-filter rule, creating it if missing. Used by
// /automod-words to edit the list without needing a full /automod setup.
async function ensureWordRule(client, guildId) {
  const allRules = await listAllRules(client, guildId);
  const own = allRules.find((r) => r.name === RULE_NAMES.words);
  if (own) return own;

  const rule = await createRule(client, guildId, 'words', seedWords(guildId));
  storage.removeGuildSetting(guildId, 'bannedWords'); // migration done, legacy list no longer needed
  return rule;
}

// ---------------------------------------------------------------------------
// Auto-provisioning: runs when the bot joins a new guild. Only ensures the
// word-filter rule exists (the full reset+create flow is reserved for the
// explicit /automod setup command, since deleting rules on join without being
// asked would be too aggressive). Disable with AUTOMOD_AUTO_PROVISION=false.
// ---------------------------------------------------------------------------
async function provisionGuild(client, guild) {
  if (String(process.env.AUTOMOD_AUTO_PROVISION || 'true').toLowerCase() === 'false') return;
  try {
    await ensureWordRule(client, guild.id);
  } catch (err) {
    if (err.status === 403 || err.code === 50013) {
      console.warn(`AutoMod: missing "Manage Server" permission on "${guild.name}" - word-filter rule not created.`);
    } else {
      console.warn(`AutoMod: could not create rule on "${guild.name}":`, errText(err));
    }
  }
}

async function provisionAllGuilds(client) {
  for (const guild of client.guilds.cache.values()) {
    await provisionGuild(client, guild);
    await sleep(400); // gentle on the rate limit
  }
}

// ---------------------------------------------------------------------------
// Badge report ("Uses AutoMod"): counts the bot's own rules across all guilds.
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
    // Application flag "APPLICATION_AUTO_MODERATION_RULE_CREATE_BADGE" = 1 << 6
    hasBadgeFlag = (Number(app.flags && app.flags.bitfield) & (1 << 6)) !== 0;
  } catch (err) {
    hasBadgeFlag = null; // could not be determined
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
// Logs AutoMod actions to the configured log channel, if any.
// ---------------------------------------------------------------------------
async function logExecution(execution) {
  try {
    const guild = execution.guild;
    if (!guild) return;
    const settings = storage.getGuildSettings(guild.id);
    if (!settings.logChannelId) return;
    const channel = guild.channels.cache.get(settings.logChannelId);
    if (!channel || !channel.isTextBased()) return;

    const where = execution.channelId ? `<#${execution.channelId}>` : 'an unknown channel';
    const keyword = execution.matchedKeyword ? ` (match: \`${truncate(execution.matchedKeyword, 40)}\`)` : '';
    await channel.send({
      content: `🚫 **AutoMod:** action against <@${execution.userId}> in ${where}${keyword}.`,
      allowedMentions: { parse: [] },
    });
  } catch (err) {
    console.warn('AutoMod: could not send log message:', errText(err));
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
  listAllRules,
  listBotRules,
  findRuleByKind,
  findAnyRuleForKind,
  ensureWordRule,
  getWordsFromRule,
  setWords,
  removeAllRules,
  removeBotRules,
  resetAndCreateRules,
  resetAndCreateAllGuilds,
  provisionGuild,
  provisionAllGuilds,
  badgeReport,
  logExecution,
};
