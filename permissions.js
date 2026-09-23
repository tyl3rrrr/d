// permissions.js
//
// ZENTRALES Berechtigungssystem. Kein Command prüft mehr selbst - jeder Command
// deklariert nur, WER ihn nutzen darf (Eigenschaft `access`, siehe commands.js),
// und index.js ruft VOR jeder Ausführung guardInteraction() auf.
//
// Rangstufen auf einem Server (aufsteigend):
//   Moderator-Rolle  <  Administrator-Rolle / Discord-Administrator  <  Server-Owner
//
// Wer zählt als was?
// - Server-Owner:    guild.ownerId === user.id
// - Admin:           Mitglied mit der per `/settings admin-role` gesetzten Rolle
//                    ODER mit der Discord-Berechtigung "Administrator"
//                    (sonst könnte ein frisch eingeladener Bot nie eingerichtet
//                    werden, solange noch keine Admin-Rolle festgelegt ist)
// - Moderator:       Mitglied mit der per `/settings mod-role` gesetzten Rolle
//
// Mögliche `access`-Werte eines Commands:
//   'everyone'  - jeder (auch per User-Install / in DMs)
//   'mod'       - Moderator, Admin oder Server-Owner (nur Server)
//   'admin'     - Admin oder Server-Owner (nur Server)
//   'bot-owner' - Bot-Betreiber (OWNER_ID aus .env oder Superuser)
//   'superuser' - ausschließlich die Superuser-ID aus config.js
// Alternativ ein Objekt für Subcommands: { default: 'everyone', sub: { nickname: 'admin' } }

const { PermissionFlagsBits } = require('discord.js');
const storage = require('./storage');
const config = require('./config');
const { EPHEMERAL } = require('./util');

const LEVEL = { NONE: 0, MOD: 1, ADMIN: 2, OWNER: 3 };
const LEVEL_NAMES = { 0: 'Mitglied', 1: 'Moderator', 2: 'Administrator', 3: 'Server-Owner' };

function roleIdsOf(member) {
  if (!member || !member.roles) return [];
  if (Array.isArray(member.roles)) return member.roles; // rohes API-Member-Objekt (Guild nicht im Cache)
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

// Rang eines GuildMember (z.B. das Ziel einer Moderationsaktion).
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

// Rang des Nutzers, der die Interaktion ausgelöst hat.
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

// Liefert den für DIESEN Aufruf gültigen access-Wert (berücksichtigt Subcommands).
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
        '❌ Dafür fehlt dir die Berechtigung. Erlaubt sind: **Server-Owner**, die **Administrator-Rolle** oder die ' +
        '**Moderator-Rolle** dieses Servers (festlegbar mit `/settings admin-role` und `/settings mod-role`).'
      );
    case 'admin':
      return (
        '❌ Dafür fehlt dir die Berechtigung. Erlaubt sind: **Server-Owner** oder die **Administrator-Rolle** ' +
        'dieses Servers (festlegbar mit `/settings admin-role`).'
      );
    case 'bot-owner':
    case 'superuser':
      return '❌ Dieser Befehl ist nur für den Bot-Betreiber.';
    default:
      return '❌ Dafür fehlt dir die Berechtigung.';
  }
}

// Prüft, ob der Nutzer die geforderte Zugriffsstufe hat.
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
      // Unbekannter Wert -> aus Sicherheitsgründen verweigern.
      return false;
  }
}

// Wird von index.js vor JEDER Command-Ausführung aufgerufen.
// Gibt true zurück, wenn der Command ausgeführt werden darf; sonst wurde bereits
// eine Ephemeral-Fehlermeldung gesendet.
async function guardInteraction(interaction, command) {
  if (command.scope === 'guild' && (!interaction.inGuild() || !interaction.guild)) {
    await interaction.reply({
      content: '❌ Dieser Befehl funktioniert nur auf Servern, auf denen der Bot als Mitglied eingeladen ist.',
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
// Schutz vor Rechte-Eskalation: Ein Moderator darf nur Mitglieder moderieren,
// die im Rang UNTER ihm stehen - sonst könnte er über den Bot (der oft höhere
// Rechte hat) Admins kicken/bannen. Der Server-Owner ist niemals ein Ziel.
// ---------------------------------------------------------------------------
function canModerate(interaction, targetMember) {
  if (!targetMember) return { ok: true }; // Ziel nicht (mehr) auf dem Server - nichts zu prüfen
  const guild = interaction.guild;

  if (targetMember.id === interaction.client.user.id) {
    return { ok: false, reason: '❌ Ich kann mich nicht selbst moderieren.' };
  }
  if (targetMember.id === interaction.user.id) {
    return { ok: false, reason: '❌ Du kannst diese Aktion nicht gegen dich selbst ausführen.' };
  }
  if (guild && guild.ownerId === targetMember.id) {
    return { ok: false, reason: '❌ Der Server-Owner kann nicht moderiert werden.' };
  }

  const actorLevel = getInteractionLevel(interaction);
  if (actorLevel >= LEVEL.OWNER) return { ok: true };

  const targetLevel = getMemberLevel(guild, targetMember);
  if (targetLevel >= actorLevel) {
    return {
      ok: false,
      reason: `❌ Du kannst kein Mitglied moderieren, das im Rang gleich oder über dir steht (${LEVEL_NAMES[targetLevel]}).`,
    };
  }
  return { ok: true };
}

// Darf der Nutzer diese Rolle vergeben/entfernen? (für /role)
function canManageRole(interaction, role) {
  const guild = interaction.guild;
  if (!role || !guild) return { ok: false, reason: '❌ Rolle nicht gefunden.' };
  if (role.id === guild.id) return { ok: false, reason: '❌ @everyone kann nicht vergeben werden.' };
  if (role.managed) return { ok: false, reason: '❌ Diese Rolle wird von einer Integration verwaltet und kann nicht vergeben werden.' };

  const actorLevel = getInteractionLevel(interaction);
  if (actorLevel >= LEVEL.OWNER) return { ok: true };

  const settings = storage.getGuildSettings(guild.id);
  if (role.permissions.has(PermissionFlagsBits.Administrator)) {
    return { ok: false, reason: '❌ Rollen mit Administrator-Rechten darf nur der Server-Owner vergeben.' };
  }
  if ((role.id === settings.adminRoleId || role.id === settings.modRoleId) && actorLevel < LEVEL.ADMIN) {
    return { ok: false, reason: '❌ Die Administrator-/Moderator-Rolle dürfen nur Administratoren vergeben.' };
  }

  const member = interaction.member;
  const highest = member && member.roles && member.roles.highest;
  if (highest && role.comparePositionTo(highest) >= 0) {
    return { ok: false, reason: '❌ Du kannst nur Rollen vergeben, die unter deiner höchsten Rolle stehen.' };
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
