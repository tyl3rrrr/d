// github.js
// GitHub release bot: posts every NEW release of the watched repository into the
// channel each server picked with /config github (stored per server as
// guilds[guildId].githubChannelId).
//
// - Watched repository: GITHUB_REPO from .env, default "tyl3rrrr/d".
// - No extra packages: global fetch (Node 18+) against the public GitHub REST API.
// - New releases are detected by their release ID. The last ~50 seen IDs live in
//   data.json (meta.githubSeen), so a restart never re-posts old releases.
// - First run ever: the existing releases are only remembered, not posted.
// - Optional .env: GITHUB_REPO, GITHUB_TOKEN (raises the API limit and allows a
//   private repo), GITHUB_INTERVAL_MIN (default 10).

const { EmbedBuilder } = require('discord.js');
const storage = require('./storage');
const { truncate, errText, sleep } = require('./util');

const REPO = (process.env.GITHUB_REPO || 'tyl3rrrr/d').trim();
const INTERVAL_MS = Math.max(2, Number(process.env.GITHUB_INTERVAL_MIN) || 10) * 60 * 1000;
const SEEN_KEY = 'githubSeen';
const MAX_SEEN = 50;
const MAX_POSTS_PER_RUN = 5;

class GithubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function fetchReleases() {
  const headers = {
    'User-Agent': 'tylxrrrr-bot release watcher',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=10`, {
    headers,
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 404) throw new GithubError(`Repository ${REPO} was not found (or it is private).`, 404);
  if (res.status === 403 || res.status === 429) throw new GithubError('GitHub is rate-limiting me right now.', res.status);
  if (!res.ok) throw new GithubError(`GitHub answered HTTP ${res.status}.`, res.status);

  const list = await res.json();
  if (!Array.isArray(list)) return [];
  // Newest first, drafts never.
  return list
    .filter((r) => r && !r.draft && r.id && r.html_url)
    .sort((a, b) => new Date(b.published_at || b.created_at) - new Date(a.published_at || a.created_at));
}

function buildEmbed(release) {
  const name = release.name && release.name.trim() ? release.name.trim() : release.tag_name;
  const embed = new EmbedBuilder()
    .setColor(release.prerelease ? 0xfee75c : 0x57f287)
    .setTitle(truncate(`🚀 ${name}`, 256))
    .setURL(release.html_url)
    .setFooter({ text: `GitHub · ${REPO}` });

  const body = (release.body || '').trim();
  embed.setDescription(truncate(body || '_No release notes._', 1500));

  const fields = [{ name: 'Tag', value: `\`${truncate(release.tag_name, 100)}\``, inline: true }];
  if (release.prerelease) fields.push({ name: 'Type', value: 'Pre-release', inline: true });
  if (release.author && release.author.login) fields.push({ name: 'By', value: truncate(release.author.login, 100), inline: true });
  const assets = Array.isArray(release.assets) ? release.assets.length : 0;
  if (assets > 0) fields.push({ name: 'Downloads', value: `${assets} file${assets === 1 ? '' : 's'}`, inline: true });
  embed.addFields(fields);

  const date = new Date(release.published_at || release.created_at);
  if (!Number.isNaN(date.getTime())) embed.setTimestamp(date);
  return embed;
}

async function postTo(client, guildId, channelId, releases) {
  const guild = client.guilds.cache.get(guildId);
  const channel = guild && (guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null)));
  if (!channel || !channel.isTextBased()) return false;
  for (const release of releases) {
    try {
      await channel.send({ embeds: [buildEmbed(release)], allowedMentions: { parse: [] } });
    } catch (err) {
      console.warn(`GitHub: could not post on ${guildId}:`, errText(err));
      return false;
    }
    await sleep(600);
  }
  return true;
}

let running = false;

async function checkOnce(client) {
  if (running) return;
  running = true;
  try {
    const releases = await fetchReleases();
    const seen = storage.getMeta(SEEN_KEY);
    if (!Array.isArray(seen)) {
      storage.setMeta(SEEN_KEY, releases.map((r) => r.id).slice(0, MAX_SEEN)); // first run: remember only
      return;
    }
    if (releases.length === 0) return;

    const known = new Set(seen);
    const fresh = releases.filter((r) => !known.has(r.id)).reverse().slice(-MAX_POSTS_PER_RUN); // oldest first
    if (fresh.length === 0) return;

    for (const guildId of storage.listGuildIds()) {
      const channelId = storage.getGuildSettings(guildId).githubChannelId;
      if (channelId) await postTo(client, guildId, channelId, fresh);
    }
    storage.setMeta(SEEN_KEY, [...fresh.map((r) => r.id).reverse(), ...seen].slice(0, MAX_SEEN));
  } catch (err) {
    console.warn('GitHub: check failed:', errText(err));
  } finally {
    running = false;
  }
}

// Sends the newest release once - used by /config github as an "it works" proof.
// Returns { ok: true } or { ok: false, reason }.
async function postLatest(client, guildId, channelId) {
  let releases;
  try {
    releases = await fetchReleases();
  } catch (err) {
    return { ok: false, reason: errText(err) };
  }
  if (releases.length === 0) return { ok: false, reason: `${REPO} has no published releases yet - new ones will be posted automatically.`, empty: true };
  const posted = await postTo(client, guildId, channelId, [releases[0]]);
  return posted ? { ok: true } : { ok: false, reason: "I couldn't post there - check my View Channel, Send Messages and Embed Links permissions." };
}

function start(client) {
  checkOnce(client);
  setInterval(() => checkOnce(client), INTERVAL_MS);
}

module.exports = { start, checkOnce, postLatest, buildEmbed, fetchReleases, REPO };
