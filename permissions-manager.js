// permissions-manager.js
// Zentralisiertes Permissions-System für Admin/Mod-Checks
// Verhindert fehleranfällige Prüfung in jedem Command einzeln

const storage = require('./storage');

/**
 * Prüft, ob ein User Admin-Berechtigung hat
 * Berechtigungen:
 * - Server Owner
 * - Konfigurierte Admin-Rolle
 * - Konfigurierte Moderator-Rolle
 */
async function hasAdminPermission(member, guild) {
  if (!member || !guild) return false;

  // Server Owner hat immer alle Rechte
  if (member.id === guild.ownerId) return true;

  // Prüfe auf konfigurierte Admin/Mod-Rollen
  const serverConfig = storage.getServerConfig(guild.id);
  
  const adminRoleId = serverConfig?.adminRoleId;
  const modRoleId = serverConfig?.modRoleId;

  // Hat Admin-Rolle
  if (adminRoleId && member.roles.cache.has(adminRoleId)) return true;

  // Hat Moderator-Rolle (auch als Admin-Berechtigung)
  if (modRoleId && member.roles.cache.has(modRoleId)) return true;

  return false;
}

/**
 * Prüft, ob ein User Moderator-Berechtigung hat
 * Berechtigungen:
 * - Server Owner
 * - Konfigurierte Admin-Rolle
 * - Konfigurierte Moderator-Rolle
 */
async function hasModeratorPermission(member, guild) {
  if (!member || !guild) return false;

  // Server Owner hat immer alle Rechte
  if (member.id === guild.ownerId) return true;

  // Prüfe auf konfigurierte Rollen
  const serverConfig = storage.getServerConfig(guild.id);
  
  const adminRoleId = serverConfig?.adminRoleId;
  const modRoleId = serverConfig?.modRoleId;

  // Hat Admin-Rolle
  if (adminRoleId && member.roles.cache.has(adminRoleId)) return true;

  // Hat Moderator-Rolle
  if (modRoleId && member.roles.cache.has(modRoleId)) return true;

  return false;
}

/**
 * Prüft, ob ein User Superuser ist (per Hardcoded ID)
 */
function isSuperuser(userId) {
  const superuserId = process.env.SUPERUSER_ID || '1324102364608598118';
  return userId === superuserId;
}

/**
 * Hilfsfunktion: Fehlermedlung für fehlende Berechtigung
 */
async function replyNoPermission(interaction, requirementText = 'Admin') {
  await interaction.reply({
    content: `❌ Du brauchst ${requirementText}-Berechtigung, um diesen Befehl auszuführen.`,
    ephemeral: true,
  });
}

module.exports = {
  hasAdminPermission,
  hasModeratorPermission,
  isSuperuser,
  replyNoPermission,
};
