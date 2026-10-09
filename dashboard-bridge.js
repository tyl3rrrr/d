// Supabase bridge: the bot makes outbound HTTPS requests only; no inbound port.
const storage = require('./storage');
const { ChannelType, PermissionFlagsBits } = require('discord.js');

const SETTINGS = {
  logChannelId: 'channel', suggestChannelId: 'channel', ticketChannelId: 'channel',
  githubChannelId: 'channel', macrumorsChannelId: 'channel', reportChannelId: 'channel',
  adminRoleId: 'role', modRoleId: 'role', ticketStaffRoleId: 'role',
};
const TEXT_CHANNEL_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
let started = false;
let busy = false;
let lastSyncAt = 0;

function getConfig() {
  const url = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return null;
  try { if (new URL(url).protocol !== 'https:') return null; } catch { return null; }
  return { url, key };
}
async function rest(path, options = {}) {
  const cfg = getConfig();
  if (!cfg) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fehlt oder ist ungültig.');
  const response = await fetch(`${cfg.url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      'Content-Type': 'application/json',
      Prefer: options.prefer || 'return=representation',
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(12000),
  });
  const raw = await response.text();
  let body = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
  if (!response.ok) throw new Error(`Supabase HTTP ${response.status}: ${typeof body === 'string' ? body : JSON.stringify(body).slice(0, 300)}`);
  return body;
}
function guildSnapshot(guild) {
  const channels = [...guild.channels.cache.values()]
    .filter(c => TEXT_CHANNEL_TYPES.has(c.type))
    .map(c => ({ id: c.id, name: c.name, type: c.type === ChannelType.GuildAnnouncement ? 'announcement' : 'text' }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const roles = [...guild.roles.cache.values()]
    .filter(r => r.id !== guild.id && !r.managed)
    .map(r => ({ id: r.id, name: r.name, position: r.position }))
    .sort((a, b) => b.position - a.position);
  const current = storage.getGuildSettings(guild.id);
  const settings = {};
  for (const key of Object.keys(SETTINGS)) settings[key] = current[key] || '';
  return { id: guild.id, name: guild.name, owner_id: guild.ownerId, member_count: guild.memberCount || 0,
    channels, roles, settings, updated_at: new Date().toISOString() };
}
async function verifyAdmin(guild, userId) {
  if (!guild || !userId) return false;
  if (guild.ownerId === userId) return true;
  const member = await guild.members.fetch(userId).catch(() => null);
  return Boolean(member && member.permissions.has(PermissionFlagsBits.Administrator));
}
async function applyJob(client, job) {
  if (!job || !/^[0-9]{15,22}$/.test(String(job.guild_id || '')) || !/^[0-9]{15,22}$/.test(String(job.user_id || ''))) {
    return { status: 'error', message: 'Ungültiger Dashboard-Auftrag.' };
  }
  const guild = client.guilds.cache.get(job.guild_id);
  if (!guild) return { status: 'error', message: 'Der Bot ist nicht mehr auf diesem Server.' };
  if (!(await verifyAdmin(guild, job.user_id))) return { status: 'error', message: 'Discord hat die Administratorberechtigung nicht bestätigt.' };
  const kind = SETTINGS[job.setting_key];
  if (!kind) return { status: 'error', message: 'Diese Einstellung ist nicht für das Dashboard freigegeben.' };
  const value = String(job.value || '').trim();
  if (value) {
    if (!/^[0-9]{15,22}$/.test(value)) return { status: 'error', message: 'Ungültige Discord-ID.' };
    if (kind === 'channel') {
      const channel = guild.channels.cache.get(value);
      if (!channel || !TEXT_CHANNEL_TYPES.has(channel.type)) return { status: 'error', message: 'Der ausgewählte Textkanal gehört nicht zu diesem Server oder ist nicht verfügbar.' };
    } else {
      const role = guild.roles.cache.get(value);
      if (!role || role.id === guild.id || role.managed) return { status: 'error', message: 'Die ausgewählte Rolle gehört nicht zu diesem Server oder ist nicht bearbeitbar.' };
    }
    storage.setGuildSetting(guild.id, job.setting_key, value);
  } else storage.removeGuildSetting(guild.id, job.setting_key);
  return { status: 'success', message: value ? 'Einstellung wurde gespeichert.' : 'Einstellung wurde zurückgesetzt.' };
}
async function tick(client) {
  if (busy || !getConfig()) return;
  busy = true;
  try {
    const now = Date.now();
    if (now - lastSyncAt >= 60000) {
      const snapshots = client.guilds.cache.map(guildSnapshot);
      if (snapshots.length) await rest('dashboard_guilds?on_conflict=id', { method: 'POST', body: JSON.stringify(snapshots), prefer: 'resolution=merge-duplicates,return=minimal' });
      lastSyncAt = now;
    }
    const jobs = await rest('dashboard_jobs?status=eq.pending&order=created_at.asc&limit=10&select=*', { method: 'GET' });
    for (const job of Array.isArray(jobs) ? jobs : []) {
      // Claim the job atomically so another bot process cannot apply it too.
      const claimed = await rest(`dashboard_jobs?id=eq.${encodeURIComponent(job.id)}&status=eq.pending`, {
        method: 'PATCH', body: JSON.stringify({ status: 'processing' }), prefer: 'return=representation'
      });
      if (!Array.isArray(claimed) || !claimed.length) continue;
      let result;
      try { result = await applyJob(client, job); }
      catch (err) { result = { status: 'error', message: `Änderung fehlgeschlagen: ${String(err.message || err).slice(0, 180)}` }; }
      await rest(`dashboard_jobs?id=eq.${encodeURIComponent(job.id)}`, {
        method: 'PATCH', body: JSON.stringify({ status: result.status, message: result.message, processed_at: new Date().toISOString() }), prefer: 'return=minimal'
      });
    }
  } catch (err) {
    console.warn('[Dashboard] Supabase-Verbindung fehlgeschlagen:', String(err.message || err).slice(0, 240));
  } finally { busy = false; }
}
function start(client) {
  if (started) return;
  started = true;
  if (!getConfig()) {
    console.log('[Dashboard] Deaktiviert. SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY in .env setzen.');
    return;
  }
  console.log('[Dashboard] Supabase-Bridge aktiviert (ausgehende HTTPS-Verbindung).');
  tick(client);
  setInterval(() => tick(client), 20000);
}
module.exports = { start };
