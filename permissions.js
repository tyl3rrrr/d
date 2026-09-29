// permissions.js
//
// CENTRAL permission system. No command checks permissions itself anymore -
// each command only declares WHO may use it (the `access` property, see
// commands.js), and index.js calls guardInteraction() before every execution.
//
// Rank levels on a server (ascending):
//   Mod role  <  Admin role / Discord Administrator  <  Server owner
//
// Who counts as what?
// - Server owner: guild.ownerId === user.id
// - Admin:        member with the role set via `/settings admin-role`
//                 OR with the Discord "Administrator" permission
//                 (otherwise a freshly invited bot could never be set up
//                 as long as no admin role has been configured yet)
// - Moderator:    member with the role set via `/settings mod-role`
//
// Possible `access` values for a command:
//   'everyone'  - anyone (including via user install / in DMs)
//   'mod'       - moderator, admin, or server owner (guild only)
//   'admin'     - admin or server owner (guild only)
//   'bot-owner' - the bot operator (OWNER_ID from .env, or superuser)
//   'superuser' - exclusively the superuser ID from config.js
// Or an object for per-subcommand access: { default: 'everyone', sub: { nickname: 'admin' } }

const { PermissionFlagsBits } = require('discord.js');
const storage = require('./storage');
const config = require('./config');
const { EPHEMERAL } = require('./util');

const LEVEL = { NONE: 0, MOD: 1, ADMIN: 2, OWNER: 3 };
const LEVEL_NAMES = { 0: 'Member', 1: 'Moderator', 2: 'Administrator', 3: 'Server Owner' };

function roleIdsOf(member) {
  if (!member || !member.roles) return [];
  if (Array.isArray(member.roles)) return member.roles; // raw API member object (guild not cached)
  if (member.roles.cache) return [...member.roles.cache.keys()];
  return [];
}

function computeLevel({ ownerId, guildId, userId, roleIds, hasAdminPermission }) {
  if (ownerId && ownerId === userId) return LEVEL.OWNER;
  const settings = storage.getGuildSettings(guildId);
  if (hasAdminPermission) return LEVEL.ADMIN;
  if (settings.adminRoleId && roleIds.includes(settings.adminRoleId)) return LEVEL.ADMIN;
  if (settings.modRoleId && roleIds.includes(settings.modRoleId)) return LEVEL.MOD;
  return LEVEL.NONE;
}

// Rank of a GuildMember (e.g. the target of a moderation action).
function getMemberLevel(guild, member) {
  if (!guild || !member) return LEVEL.NONE;
  return computeLevel({
    ownerId: guild.ownerId,
    guildId: guild.id,
    userId: member.id,
    roleIds: roleIdsOf(member),
    hasAdminPermission: Boolean(member.permissions && member.permissions.has(PermissionFlagsBits.Administrator)),
  });
}

// Rank of the user who triggered the interaction.
function getInteractionLevel(interaction) {
  if (!interaction.inGuild() || !interaction.guildId) return LEVEL.NONE;
  return computeLevel({
    ownerId: interaction.guild ? interaction.guild.ownerId : null,
    guildId: interaction.guildId,
    userId: interaction.user.id,
    roleIds: roleIdsOf(interaction.member),
    hasAdminPermission: Boolean(interaction.memberPermissions && interaction.memberPermissions.has(PermissionFlagsBits.Administrator)),
  });
}

function isBotOwner(userId) {
  return config.getBotOwnerIds().has(userId);
}

function isSuperuser(userId) {
  return userId === config.SUPERUSER_ID;
}

// Returns the access value that applies to THIS call (accounts for subcommands).
function resolveAccess(command, interaction) {
  const access = command.access || 'everyone';
  if (typeof access === 'string') return access;
  let sub = null;
  try {
    sub = interaction.options.getSubcommand(false);
  } catch (err) {
    sub = null;
  }
  return (sub && access.sub && access.sub[sub]) || access.default || 'everyone';
}

function denyText(access) {
  switch (access) {
    case 'mod':
      return (
        "❌ You don't have permission for that. Allowed: **Server Owner**, the **Administrator role**, or the " +
        '**Moderator role** of this server (set with `/settings admin-role` and `/settings mod-role`).'
      );
    case 'admin':
      return "❌ You don't have permission for that. Allowed: **Server Owner** or the **Administrator role** of this server (set with `/settings admin-role`).";
    case 'bot-owner':
    case 'superuser':
      return '❌ This command is only for the bot operator.';
    default:
      return "❌ You don't have permission for that.";
  }
}

// Checks whether the user has the required access level.
function hasAccess(interaction, access) {
  switch (access) {
    case 'everyone':
      return true;
    case 'superuser':
      return isSuperuser(interaction.user.id);
    case 'bot-owner':
      return isBotOwner(interaction.user.id);
    case 'mod':
      return getInteractionLevel(interaction) >= LEVEL.MOD;
    case 'admin':
      return getInteractionLevel(interaction) >= LEVEL.ADMIN;
    default:
      // Unknown value -> deny for safety.
      return false;
  }
}

// Called by index.js before EVERY command execution.
// Returns true if the command may run; otherwise an ephemeral error message
// has already been sent.
async function guardInteraction(interaction, command) {
  if (command.scope === 'guild' && (!interaction.inGuild() || !interaction.guild)) {
    await interaction.reply({
      content: '❌ This command only works on servers the bot is a member of.',
      flags: EPHEMERAL,
    });
    return false;
  }

  const access = resolveAccess(command, interaction);
  if (hasAccess(interaction, access)) return true;

  await interaction.reply({ content: denyText(access), flags: EPHEMERAL });
  return false;
}

// ---------------------------------------------------------------------------
// Escalation guard: a moderator may only moderate members ranked BELOW them -
// otherwise they could use the bot (which often has higher permissions) to
// kick/ban admins. The server owner is never a valid target.
// ---------------------------------------------------------------------------
function canModerate(interaction, targetMember) {
  if (!targetMember) return { ok: true }; // target no longer on the server - nothing to check
  const guild = interaction.guild;

  if (targetMember.id === interaction.client.user.id) {
    return { ok: false, reason: "❌ I can't moderate myself." };
  }
  if (targetMember.id === interaction.user.id) {
    return { ok: false, reason: "❌ You can't do that to yourself." };
  }
  if (guild && guild.ownerId === targetMember.id) {
    return { ok: false, reason: "❌ The server owner can't be moderated." };
  }

  const actorLevel = getInteractionLevel(interaction);
  if (actorLevel >= LEVEL.OWNER) return { ok: true };

  const targetLevel = getMemberLevel(guild, targetMember);
  if (targetLevel >= actorLevel) {
    return {
      ok: false,
      reason: `❌ You can't moderate a member ranked equal to or above you (${LEVEL_NAMES[targetLevel]}).`,
    };
  }
  return { ok: true };
}

// May the user grant/remove this role? (for /role)
function canManageRole(interaction, role) {
  const guild = interaction.guild;
  if (!role || !guild) return { ok: false, reason: '❌ Role not found.' };
  if (role.id === guild.id) return { ok: false, reason: "❌ @everyone can't be granted." };
  if (role.managed) return { ok: false, reason: "❌ This role is managed by an integration and can't be granted." };

  const actorLevel = getInteractionLevel(interaction);
  if (actorLevel >= LEVEL.OWNER) return { ok: true };

  const settings = storage.getGuildSettings(guild.id);
  if (role.permissions.has(PermissionFlagsBits.Administrator)) {
    return { ok: false, reason: '❌ Only the server owner can grant roles with Administrator permissions.' };
  }
  if ((role.id === settings.adminRoleId || role.id === settings.modRoleId) && actorLevel < LEVEL.ADMIN) {
    return { ok: false, reason: '❌ Only administrators can grant the admin/mod role.' };
  }

  const member = interaction.member;
  const highest = member && member.roles && member.roles.highest;
  if (highest && role.comparePositionTo(highest) >= 0) {
    return { ok: false, reason: '❌ You can only grant roles below your highest role.' };
  }
  return { ok: true };
}

module.exports = {
  LEVEL,
  LEVEL_NAMES,
  getMemberLevel,
  getInteractionLevel,
  isBotOwner,
  isSuperuser,
  resolveAccess,
  hasAccess,
  guardInteraction,
  canModerate,
  canManageRole,
  denyText,
};
