// partner-runtime.js
// Partner manager:
//
//   /partner request  ->  the invite is CHECKED against Discord (valid? which server? how many members?)
//                         ->  request panel in the "Partner review channel" with [Accept] [Deny]
//   Accept (moderator) -> partner is saved, announced automatically in the "Partner channel"
//                         (with a join button) and the requester gets a DM
//   /partner list      -> everyone sees the accepted partners
//   /partner remove    -> admins remove a partner (the announcement is deleted)
//
// Both channels are chosen in /settings. Button custom IDs: "pt:accept:<id>" / "pt:deny:<id>".

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const storage = require('./storage');
const permissions = require('./permissions');
const logging = require('./logging');
const { EPHEMERAL, truncate } = require('./util');

const PREFIX = 'pt:';
const COLLECTION = 'partners';
const MAX_PENDING_PER_GUILD = 50;
const INVITE_RE = /(?:discord\.gg|discord(?:app)?\.com\/invite)\/([A-Za-z0-9-]{2,32})/i;

const STATUS = {
  pending: { label: '🟡 Pending review', color: 0xfee75c },
  accepted: { label: '🟢 Accepted', color: 0x57f287 },
  denied: { label: '🔴 Denied', color: 0xed4245 },
  removed: { label: '⚪ Removed', color: 0x99aab5 },
};

function parseInviteCode(text) {
  const m = INVITE_RE.exec(String(text || ''));
  return m ? m[1] : null;
}

// Asks Discord about the invite. { ok: true, guildName, memberCount, expiresAt } | { ok: false, invalid } | { ok: false, unreachable }
async function inspectInvite(client, code) {
  try {
    const inv = await client.fetchInvite(code, { withCounts: true, withExpiration: true });
    return {
      ok: true,
      guildName: inv.guild ? inv.guild.name : null,
      memberCount: inv.memberCount || inv.approximateMemberCount || null,
      expiresAt: inv.expiresTimestamp || null,
    };
  } catch (err) {
    if (err && (err.code === 10006 || err.status === 404)) return { ok: false, invalid: true };
    return { ok: false, unreachable: true };
  }
}

function reviewPanel(p) {
  const embed = new EmbedBuilder()
    .setTitle(`🤝 Partner request #${p.id}: ${truncate(p.name, 150)}`)
    .setColor(STATUS[p.status].color)
    .setDescription(truncate(p.description, 1500))
    .addFields(
      { name: 'Invite', value: p.invite, inline: false },
      { name: 'Requested by', value: `<@${p.requesterId}>`, inline: true },
      { name: 'Check', value: p.verified ? `✅ Valid invite${p.guildName ? ` to **${truncate(p.guildName, 80)}**` : ''}${p.memberCount ? ` · ~${p.memberCount.toLocaleString('en-US')} members` : ''}${p.expiresAt ? '\n⚠️ This invite **expires** - ask for a permanent one.' : ''}` : '⚠️ Could not be verified (Discord unreachable)', inline: true },
      { name: 'Status', value: p.status === 'pending' ? STATUS.pending.label : `${STATUS[p.status].label} by <@${p.reviewerId}>`, inline: false }
    )
    .setTimestamp(p.createdAt);
  const components = [];
  if (p.status === 'pending') {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}accept:${p.id}`).setLabel('Accept').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${PREFIX}deny:${p.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
      )
    );
  }
  return { embeds: [embed], components };
}

function announcement(p) {
  const embed = new EmbedBuilder()
    .setTitle(`🤝 ${truncate(p.name, 200)}`)
    .setColor(0x57f287)
    .setDescription(truncate(p.description, 1800))
    .setFooter({ text: 'Official partner' });
  if (p.memberCount) embed.addFields({ name: 'Members', value: `~${p.memberCount.toLocaleString('en-US')}`, inline: true });
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Join server').setStyle(ButtonStyle.Link).setURL(p.invite));
  return { embeds: [embed], components: [row] };
}

async function channelFor(client, guildId, key) {
  const channelId = storage.getGuildSettings(guildId)[key];
  if (!channelId) return null;
  const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
  const channel = guild && (guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null)));
  return channel && channel.isTextBased() ? channel : null;
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------
async function request(client, guild, user, { name, invite, description }) {
  const reviewChannel = await channelFor(client, guild.id, 'partnerReviewChannelId');
  if (!reviewChannel) return { ok: false, reason: 'Partner requests are not set up yet. Ask an admin to choose a review channel in `/settings`.' };

  const code = parseInviteCode(invite);
  if (!code) return { ok: false, reason: 'That is not a Discord invite link. Use something like `https://discord.gg/yourcode`.' };

  const all = storage.listRecords(COLLECTION, guild.id);
  const pending = all.filter((p) => p.status === 'pending');
  if (pending.length >= MAX_PENDING_PER_GUILD) return { ok: false, reason: 'There are too many open requests right now - please try again later.' };
  if (pending.some((p) => p.requesterId === user.id)) return { ok: false, reason: 'You already have a request waiting for review. Please wait for the decision.' };
  if (all.some((p) => (p.status === 'pending' || p.status === 'accepted') && p.inviteCode.toLowerCase() === code.toLowerCase())) {
    return { ok: false, reason: 'A request or partnership with this invite already exists.' };
  }

  const info = await inspectInvite(client, code);
  if (info.invalid) return { ok: false, reason: 'Discord says this invite is invalid or expired. Please send a working invite.' };

  const p = {
    id: storage.nextCounter(guild.id, 'partnerCounter'),
    status: 'pending',
    name,
    invite: `https://discord.gg/${code}`,
    inviteCode: code,
    description,
    requesterId: user.id,
    verified: !!info.ok,
    guildName: info.ok ? info.guildName : null,
    memberCount: info.ok ? info.memberCount : null,
    expiresAt: info.ok ? info.expiresAt : null,
    reviewerId: null,
    reviewMessageId: null,
    postMessageId: null,
    postChannelId: null,
    createdAt: Date.now(),
    decidedAt: null,
  };

  const payload = reviewPanel(p);
  const modRole = storage.getGuildSettings(guild.id).modRoleId;
  if (modRole) payload.content = `<@&${modRole}> new partner request`;
  payload.allowedMentions = modRole ? { roles: [modRole], users: [] } : { parse: [] };
  let message;
  try {
    message = await reviewChannel.send(payload);
  } catch (err) {
    return { ok: false, reason: "I can't post in the review channel - an admin needs to give me View Channel, Send Messages and Embed Links there." };
  }
  p.reviewMessageId = message.id;
  storage.saveRecord(COLLECTION, guild.id, p);
  return { ok: true, partner: p };
}

// ---------------------------------------------------------------------------
// Review buttons
// ---------------------------------------------------------------------------
async function dm(client, userId, text) {
  try {
    const user = await client.users.fetch(userId);
    await user.send(text);
  } catch (err) {
    // closed DMs - ignore
  }
}

async function handleButton(interaction) {
  const [, action, idText] = interaction.customId.split(':');
  if (!interaction.inGuild()) return void (await interaction.reply({ content: '❌ Partner requests only exist on servers.', flags: EPHEMERAL }));
  if (!permissions.hasAccess(interaction, 'mod')) return void (await interaction.reply({ content: '❌ Only moderators can review partner requests.', flags: EPHEMERAL }));

  const guildId = interaction.guildId;
  const p = storage.getRecord(COLLECTION, guildId, idText);
  if (!p) return void (await interaction.reply({ content: '❌ This request no longer exists.', flags: EPHEMERAL }));
  if (p.status !== 'pending') return void (await interaction.update(reviewPanel(p))); // somebody was faster

  await interaction.deferUpdate(); // posting + DMs may take a moment

  const patch = { status: action === 'accept' ? 'accepted' : 'denied', reviewerId: interaction.user.id, decidedAt: Date.now() };
  let note = '';

  if (action === 'accept') {
    const channel = await channelFor(interaction.client, guildId, 'partnerChannelId');
    if (channel) {
      try {
        const msg = await channel.send({ ...announcement({ ...p, ...patch }), allowedMentions: { parse: [] } });
        patch.postMessageId = msg.id;
        patch.postChannelId = channel.id;
      } catch (err) {
        note = "⚠️ Accepted, but I couldn't post the announcement - check my permissions in the partner channel.";
      }
    } else {
      note = 'ℹ️ Accepted. No partner channel is set, so nothing was announced (choose one in `/settings`).';
    }
  }

  const updated = storage.updateRecord(COLLECTION, guildId, p.id, patch);
  await interaction.editReply(reviewPanel(updated));
  if (note) await interaction.followUp({ content: note, flags: EPHEMERAL });

  dm(
    interaction.client,
    p.requesterId,
    action === 'accept'
      ? `🤝 Your partner request **${truncate(p.name, 100)}** on **${truncate(interaction.guild.name, 100)}** was **accepted**. Welcome aboard!`
      : `📬 Your partner request **${truncate(p.name, 100)}** on **${truncate(interaction.guild.name, 100)}** was not accepted this time.`
  );
  logging.logToGuild(interaction.client, guildId, { title: `🤝 Partner request #${p.id} ${updated.status}`, description: `**${truncate(p.name, 100)}** - by ${interaction.user.tag}.` });
}

// ---------------------------------------------------------------------------
// List / remove
// ---------------------------------------------------------------------------
function acceptedPartners(guildId) {
  return storage.listRecords(COLLECTION, guildId).filter((p) => p.status === 'accepted').sort((a, b) => a.name.localeCompare(b.name));
}

function listEmbed(guildId) {
  const partners = acceptedPartners(guildId);
  const embed = new EmbedBuilder().setTitle('🤝 Our partners').setColor(0x57f287);
  if (!partners.length) return embed.setDescription('We have no partners yet.');
  const lines = [];
  let used = 0;
  for (const p of partners) {
    const line = `**[${truncate(p.name, 60)}](${p.invite})**${p.memberCount ? ` · ~${p.memberCount.toLocaleString('en-US')} members` : ''}\n${truncate(p.description, 120)}`;
    if (used + line.length + 2 > 3800) {
      lines.push(`…and ${partners.length - lines.length} more`);
      break;
    }
    lines.push(line);
    used += line.length + 2;
  }
  return embed.setDescription(lines.join('\n\n')).setFooter({ text: `${partners.length} partner${partners.length === 1 ? '' : 's'}` });
}

async function remove(client, guildId, id) {
  const p = storage.getRecord(COLLECTION, guildId, id);
  if (!p || p.status !== 'accepted') return null;
  if (p.postChannelId && p.postMessageId) {
    const channel = await channelFor(client, guildId, 'partnerChannelId');
    const ch = channel && channel.id === p.postChannelId ? channel : null;
    const msg = ch ? await ch.messages.fetch(p.postMessageId).catch(() => null) : null;
    if (msg) await msg.delete().catch(() => {});
  }
  return storage.updateRecord(COLLECTION, guildId, p.id, { status: 'removed', decidedAt: Date.now() });
}

module.exports = { PREFIX, parseInviteCode, request, handleButton, listEmbed, acceptedPartners, remove, reviewPanel };
