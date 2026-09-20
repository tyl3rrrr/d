// permissions.js
// Zentrales Permission-System für Admin/Mod-Checks

const storage = require('./storage');

/**
 * Überprüft, ob der User Admin-Berechtigung hat
 * @param {GuildMember} member - Der Member zu prüfen
 * @param {Guild} guild - Der Guild des Members
 * @returns {boolean} True wenn Admin
 */
async function isAdmin(member, guild) {
  if (!member) return false;
  if (guild.ownerId === member.id) return true;
  if (member.permissions.has('Administrator')) return true;

  const settings = storage.getGuildSettings(guild.id);
  const adminRoles = settings.adminRoles || [];
  
  for (const roleId of adminRoles) {
    if (member.roles.cache.has(roleId)) return true;
  }
  
  return false;
}

/**
 * Überprüft, ob der User Mod-Berechtigung hat
 * @param {GuildMember} member - Der Member zu prüfen
 * @param {Guild} guild - Der Guild des Members
 * @returns {boolean} True wenn Mod
 */
async function isMod(member, guild) {
  if (!member) return false;
  
  // Admins sind auch Mods
  if (await isAdmin(member, guild)) return true;
  
  const settings = storage.getGuildSettings(guild.id);
  const modRoles = settings.modRoles || [];
  
  for (const roleId of modRoles) {
    if (member.roles.cache.has(roleId)) return true;
  }
  
  return false;
}

/**
 * Überprüft, ob der User Admin/Owner/Mod ist - nur einer davon genügt
 * @param {GuildMember} member - Der Member zu prüfen
 * @param {Guild} guild - Der Guild des Members
 * @returns {boolean} True wenn berechtigt
 */
async function hasModPermission(member, guild) {
  return await isMod(member, guild);
}

/**
 * Überprüft, ob der User Admin/Owner ist
 * @param {GuildMember} member - Der Member zu prüfen
 * @param {Guild} guild - Der Guild des Members
 * @returns {boolean} True wenn berechtigt
 */
async function hasAdminPermission(member, guild) {
  return await isAdmin(member, guild);
}

module.exports = {
  isAdmin,
  isMod,
  hasModPermission,
  hasAdminPermission,
};
