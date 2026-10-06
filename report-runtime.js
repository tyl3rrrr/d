// report-runtime.js
// Report system: members send a report with /report (commands-report.js); it appears as a
// moderator panel in the report channel (set in /settings -> "Report channel") with a
// status and the moderator who handles it:
//
//   🟡 Open  ->  [Take]  -> 🔵 In progress by @mod  ->  [Resolve] 🟢  /  [Dismiss] ⚪  ->  [Reopen]
//
// Panel buttons use custom IDs "rp:<action>:<reportId>". Only moderators (and above) may
// click them - checked with permissions.hasAccess(). The reporter gets a DM when the
// report is closed (best effort: closed DMs are simply skipped).

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const storage = require('./storage');
const permissions = require('./permissions');
const logging = require('./logging');
const { EPHEMERAL, truncate } = require('./util');

const PREFIX = 'rp:';
const COLLECTION = 'reports';

const STATUS = {
  open: { label: '🟡 Open', color: 0xfee75c },
  in_progress: { label: '🔵 In progress', color: 0x5865f2 },
  resolved: { label: '🟢 Resolved', color: 0x57f287 },
  dismissed: { label: '⚪ Dismissed', color: 0x99aab5 },
};

function statusLine(r) {
  const base = STATUS[r.status].label;
  if (r.status === 'in_progress') return `${base} by <@${r.handlerId}>`;
  if (r.status === 'resolved' || r.status === 'dismissed') return `${base} by <@${r.closedById}> <t:${Math.floor(r.closedAt / 1000)}:R>`;
  return `${base} - waiting for a moderator`;
}

function buildPanel(r) {
  const embed = new EmbedBuilder()
    .setTitle(`🚨 Report #${r.id}`)
    .setColor(STATUS[r.status].color)
    .addFields(
      { name: 'Reported user', value: `<@${r.targetId}> (\`${r.targetId}\`)`, inline: true },
      { name: 'Reported by', value: `<@${r.reporterId}>`, inline: true },
      { name: 'Status', value: statusLine(r) },
      { name: 'Reason', value: truncate(r.reason, 1000) }
    )
    .setTimestamp(r.createdAt);
  if (r.evidenceUrl) embed.addFields({ name: 'Evidence', value: truncate(r.evidenceUrl, 1000) });
  if (r.evidenceIsImage) embed.setImage(r.evidenceUrl);
  if (r.channelId) embed.setFooter({ text: `Sent from #${r.channelName || 'unknown'}` });

  const btn = (action, label, style) => new ButtonBuilder().setCustomId(`${PREFIX}${action}:${r.id}`).setLabel(label).setStyle(style);
  let buttons;
  if (r.status === 'open') buttons = [btn('take', 'Take', ButtonStyle.Primary), btn('resolve', 'Resolve', ButtonStyle.Success), btn('dismiss', 'Dismiss', ButtonStyle.Secondary)];
  else if (r.status === 'in_progress') buttons = [btn('resolve', 'Resolve', ButtonStyle.Success), btn('dismiss', 'Dismiss', ButtonStyle.Secondary), btn('release', 'Release', ButtonStyle.Secondary)];
  else buttons = [btn('reopen', 'Reopen', ButtonStyle.Secondary)];
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(...buttons)] };
}

async function getReportChannel(client, guildId) {
  const channelId = storage.getGuildSettings(guildId).reportChannelId;
  if (!channelId) return null;
  const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
  const channel = guild && (guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null)));
  return channel && channel.isTextBased() ? channel : null;
}

// Creates the record and posts the moderator panel. Returns { ok, report } or { ok: false, reason }.
async function submit(client, guild, { reporter, target, reason, attachment, channel }) {
  const panelChannel = await getReportChannel(client, guild.id);
  if (!panelChannel) return { ok: false, reason: 'Reports are not set up on this server yet. Ask an admin to choose a report channel in `/settings`.' };

  const settings = storage.getGuildSettings(guild.id);
  const report = {
    id: storage.nextCounter(guild.id, 'reportCounter'),
    status: 'open',
    reporterId: reporter.id,
    targetId: target.id,
    reason,
    evidenceUrl: attachment ? attachment.url : null,
    evidenceIsImage: !!(attachment && attachment.contentType && attachment.contentType.startsWith('image/')),
    channelId: channel ? channel.id : null,
    channelName: channel && channel.name ? channel.name : null,
    handlerId: null,
    closedById: null,
    closedAt: null,
    messageId: null,
    createdAt: Date.now(),
  };

  const payload = buildPanel(report);
  if (settings.modRoleId) {
    payload.content = `<@&${settings.modRoleId}> new report`;
    payload.allowedMentions = { roles: [settings.modRoleId], users: [] };
  } else {
    payload.allowedMentions = { parse: [] };
  }
  let message;
  try {
    message = await panelChannel.send(payload);
  } catch (err) {
    return { ok: false, reason: "I can't post in the report channel - an admin needs to give me View Channel, Send Messages and Embed Links there." };
  }
  report.messageId = message.id;
  storage.saveRecord(COLLECTION, guild.id, report);
  logging.logToGuild(client, guild.id, { title: '🚨 Report created', description: `Report #${report.id} against <@${target.id}> by <@${reporter.id}>.`, level: 'warn' });
  return { ok: true, report };
}

async function dmReporter(client, report, text) {
  try {
    const user = await client.users.fetch(report.reporterId);
    await user.send(text);
  } catch (err) {
    // DMs closed - nothing to do
  }
}

// Panel buttons.
async function handleButton(interaction) {
  const [, action, idText] = interaction.customId.split(':');
  if (!interaction.inGuild()) {
    await interaction.reply({ content: '❌ Reports only exist on servers.', flags: EPHEMERAL });
    return;
  }
  if (!permissions.hasAccess(interaction, 'mod')) {
    await interaction.reply({ content: '❌ Only moderators can handle reports.', flags: EPHEMERAL });
    return;
  }
  const guildId = interaction.guildId;
  const report = storage.getRecord(COLLECTION, guildId, idText);
  if (!report) {
    await interaction.reply({ content: '❌ This report no longer exists.', flags: EPHEMERAL });
    return;
  }

  const me = interaction.user.id;
  let patch = null;
  if (action === 'take' && report.status === 'open') patch = { status: 'in_progress', handlerId: me };
  else if (action === 'release' && report.status === 'in_progress') patch = { status: 'open', handlerId: null };
  else if ((action === 'resolve' || action === 'dismiss') && (report.status === 'open' || report.status === 'in_progress')) {
    patch = { status: action === 'resolve' ? 'resolved' : 'dismissed', handlerId: report.handlerId || me, closedById: me, closedAt: Date.now() };
  } else if (action === 'reopen' && (report.status === 'resolved' || report.status === 'dismissed')) {
    patch = { status: 'open', handlerId: null, closedById: null, closedAt: null };
  }

  if (!patch) {
    // Stale panel (somebody else already changed the status): just show the current state.
    await interaction.update(buildPanel(report));
    return;
  }

  const updated = storage.updateRecord(COLLECTION, guildId, report.id, patch);
  await interaction.update(buildPanel(updated));

  if (updated.status === 'resolved' || updated.status === 'dismissed') {
    const outcome = updated.status === 'resolved' ? 'was reviewed and **resolved**' : 'was reviewed and closed without action';
    dmReporter(interaction.client, updated, `📬 Your report #${updated.id} on **${truncate(interaction.guild.name, 100)}** ${outcome}. Thank you for helping keep the server safe!`);
  }
  logging.logToGuild(interaction.client, guildId, { title: `🚨 Report #${updated.id}: ${STATUS[updated.status].label.slice(3)}`, description: `By ${interaction.user.tag}.` });
}

module.exports = { PREFIX, submit, handleButton, buildPanel };
