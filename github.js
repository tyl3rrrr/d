// GitHub release watcher.
// Keeps the legacy /config github feed and supports per-server /github-check watches.
// Uses only Node 18+ fetch and stores watch configuration in data.json.

const { EmbedBuilder } = require('discord.js');
const storage = require('./storage');
const { truncate, errText, sleep } = require('./util');

const REPO = (process.env.GITHUB_REPO || 'tyl3rrrr/d').trim();
const INTERVAL_MS = Math.max(2, Number(process.env.GITHUB_INTERVAL_MIN) || 10) * 60 * 1000;
const SEEN_KEY = 'githubSeen';
const WATCH_SEEN_KEY = 'githubWatchSeen';
const MAX_SEEN = 50;
const MAX_POSTS_PER_RUN = 5;

class GithubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function normalizeRepo(input) {
  if (typeof input !== 'string') return null;
  let value = input.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (url.hostname.toLowerCase() !== 'github.com' || url.username || url.password) return null;
      value = url.pathname.replace(/^\/+|\/+$/g, '');
    } catch (_) { return null; }
  }
  value = value.replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
  const parts = value.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(parts[0])) return null;
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(parts[1]) || parts[1] === '.' || parts[1] === '..') return null;
  return `${parts[0]}/${parts[1]}`;
}

async function fetchReleases(repo = REPO) {
  const normalized = normalizeRepo(repo);
  if (!normalized) throw new GithubError('Please provide a valid GitHub repository URL, such as https://github.com/owner/repository.', 400);
  const headers = {
    'User-Agent': 'tylxrrrr-bot release watcher',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const res = await fetch(`https://api.github.com/repos/${normalized}/releases?per_page=10`, {
    headers,
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 404) throw new GithubError(`Repository ${normalized} was not found, is private, or has no accessible releases endpoint.`, 404);
  if (res.status === 403 || res.status === 429) throw new GithubError('GitHub is rate-limiting me right now. Please try again later.', res.status);
  if (!res.ok) throw new GithubError(`GitHub answered HTTP ${res.status}.`, res.status);

  const list = await res.json();
  if (!Array.isArray(list)) return [];
  return list
    .filter((r) => r && !r.draft && r.id && r.html_url)
    .sort((a, b) => new Date(b.published_at || b.created_at) - new Date(a.published_at || a.created_at));
}

function buildEmbed(release, repo = REPO) {
  const name = release.name && release.name.trim() ? release.name.trim() : release.tag_name;
  const embed = new EmbedBuilder()
    .setColor(release.prerelease ? 0xfee75c : 0x57f287)
    .setTitle(truncate(`🚀 ${name}`, 256))
    .setURL(release.html_url)
    .setFooter({ text: `GitHub · ${repo}` });

  const body = (release.body || '').trim();
  embed.setDescription(truncate(body || '_No release notes._', 1500));
  const fields = [{ name: 'Tag', value: `\`${truncate(release.tag_name || 'unknown', 100)}\``, inline: true }];
  if (release.prerelease) fields.push({ name: 'Type', value: 'Pre-release', inline: true });
  if (release.author && release.author.login) fields.push({ name: 'By', value: truncate(release.author.login, 100), inline: true });
  const assets = Array.isArray(release.assets) ? release.assets.length : 0;
  if (assets > 0) fields.push({ name: 'Downloads', value: `${assets} file${assets === 1 ? '' : 's'}`, inline: true });
  embed.addFields(fields);
  const date = new Date(release.published_at || release.created_at);
  if (!Number.isNaN(date.getTime())) embed.setTimestamp(date);
  return embed;
}

async function getTextChannel(client, guildId, channelId) {
  const guild = client.guilds.cache.get(guildId);
  const channel = guild && (guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null)));
  return channel && channel.isTextBased() && typeof channel.send === 'function' ? channel : null;
}

async function postTo(client, guildId, channelId, releases, repo = REPO) {
  const channel = await getTextChannel(client, guildId, channelId);
  if (!channel) return false;
  for (const release of releases) {
    try {
      await channel.send({ embeds: [buildEmbed(release, repo)], allowedMentions: { parse: [] } });
    } catch (err) {
      console.warn(`GitHub: could not post on ${guildId} to ${channelId}:`, errText(err));
      return false;
    }
    await sleep(600);
  }
  return true;
}

function getWatches(guildId) {
  const value = storage.getGuildSettings(guildId).githubWatches;
  return Array.isArray(value) ? value.filter((w) => w && normalizeRepo(w.repo) && typeof w.channelId === 'string') : [];
}

function listAllWatches() {
  const all = [];
  for (const guildId of storage.listGuildIds()) {
    for (const watch of getWatches(guildId)) all.push({ guildId, ...watch, repo: normalizeRepo(watch.repo) });
  }
  return all;
}

function watchSeenMap() {
  const value = storage.getMeta(WATCH_SEEN_KEY);
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function watchStateKey(guildId, repo) {
  return `${guildId}:${repo.toLowerCase()}`;
}

function setWatchSeen(key, ids) {
  const map = watchSeenMap();
  map[key] = [...new Set(ids)].slice(0, MAX_SEEN);
  storage.setMeta(WATCH_SEEN_KEY, map);
}

// Validates the repo against GitHub and seeds the current release IDs, so adding a watch
// does not unexpectedly dump old releases into the selected channel.
async function addWatch(client, guildId, repoInput, channelId) {
  const repo = normalizeRepo(repoInput);
  if (!repo) return { ok: false, reason: 'Use a valid repository URL, for example `https://github.com/owner/repository`.' };
  const watches = getWatches(guildId);
  const existing = watches.find((w) => normalizeRepo(w.repo).toLowerCase() === repo.toLowerCase());
  if (existing) {
    if (existing.channelId === channelId) return { ok: false, reason: `**${repo}** is already being watched in <#${channelId}>.` };
    existing.channelId = channelId;
    storage.setGuildSetting(guildId, 'githubWatches', watches);
    const releases = await fetchReleases(repo).catch((err) => null);
    if (releases) setWatchSeen(watchStateKey(guildId, repo), releases.map((r) => r.id));
    return { ok: true, repo, channelId, updated: true };
  }

  let releases;
  try {
    releases = await fetchReleases(repo);
  } catch (err) {
    return { ok: false, reason: errText(err) };
  }
  const channel = await getTextChannel(client, guildId, channelId);
  if (!channel) return { ok: false, reason: 'I cannot access that channel. Make sure it is a text/announcement channel and I have View Channel and Send Messages permissions.' };

  watches.push({ repo, channelId, addedAt: Date.now() });
  storage.setGuildSetting(guildId, 'githubWatches', watches);
  setWatchSeen(watchStateKey(guildId, repo), releases.map((r) => r.id));
  return { ok: true, repo, channelId, initialReleaseCount: releases.length };
}

function removeWatch(guildId, repoInput) {
  const repo = normalizeRepo(repoInput);
  if (!repo) return { ok: false, reason: 'Use the repository URL that was registered, for example `https://github.com/owner/repository`.' };
  const watches = getWatches(guildId);
  const remaining = watches.filter((w) => normalizeRepo(w.repo).toLowerCase() !== repo.toLowerCase());
  if (remaining.length === watches.length) return { ok: false, reason: `**${repo}** is not in this server's watch list.` };
  storage.setGuildSetting(guildId, 'githubWatches', remaining);
  const map = watchSeenMap();
  delete map[watchStateKey(guildId, repo)];
  storage.setMeta(WATCH_SEEN_KEY, map);
  return { ok: true, repo };
}

let running = false;
async function checkOnce(client) {
  if (running) return;
  running = true;
  try {
    // Preserve the legacy global feed configured with /config github.
    const releases = await fetchReleases(REPO);
    const seen = storage.getMeta(SEEN_KEY);
    if (!Array.isArray(seen)) {
      storage.setMeta(SEEN_KEY, releases.map((r) => r.id).slice(0, MAX_SEEN));
    } else if (releases.length) {
      const known = new Set(seen);
      const fresh = releases.filter((r) => !known.has(r.id)).reverse().slice(-MAX_POSTS_PER_RUN);
      if (fresh.length) {
        for (const guildId of storage.listGuildIds()) {
          const channelId = storage.getGuildSettings(guildId).githubChannelId;
          if (channelId) await postTo(client, guildId, channelId, fresh, REPO);
        }
        storage.setMeta(SEEN_KEY, [...fresh.map((r) => r.id).reverse(), ...seen].slice(0, MAX_SEEN));
      }
    }
  } catch (err) {
    console.warn('GitHub: legacy release check failed:', errText(err));
  }

  try {
    // Fetch each distinct watched repo once per cycle, even if several servers watch it.
    const watches = listAllWatches();
    const repos = [...new Set(watches.map((w) => w.repo))];
    for (const repo of repos) {
      let releases;
      try { releases = await fetchReleases(repo); }
      catch (err) { console.warn(`GitHub: failed checking ${repo}:`, errText(err)); continue; }
      for (const watch of watches.filter((w) => w.repo === repo)) {
        const key = watchStateKey(watch.guildId, repo);
        const state = watchSeenMap();
        if (!Array.isArray(state[key])) {
          setWatchSeen(key, releases.map((r) => r.id)); // first check: remember current releases only
          continue;
        }
        const known = new Set(state[key]);
        const fresh = releases.filter((r) => !known.has(r.id)).reverse().slice(-MAX_POSTS_PER_RUN);
        if (!fresh.length) continue;
        const channel = await getTextChannel(client, watch.guildId, watch.channelId);
        if (!channel) {
          console.warn(`GitHub: watched channel ${watch.channelId} is unavailable in guild ${watch.guildId}; will retry.`);
          continue;
        }
        let seenIds = [...state[key]];
        for (const release of fresh) {
          try {
            await channel.send({ embeds: [buildEmbed(release, repo)], allowedMentions: { parse: [] } });
            seenIds = [release.id, ...seenIds.filter((id) => id !== release.id)].slice(0, MAX_SEEN);
            setWatchSeen(key, seenIds); // save each successful post; failed releases retry next cycle
          } catch (err) {
            console.warn(`GitHub: could not post ${repo} release to ${watch.guildId}:`, errText(err));
            break;
          }
          await sleep(600);
        }
      }
    }
  } catch (err) {
    console.warn('GitHub: custom watch check failed:', errText(err));
  } finally {
    running = false;
  }
}

// Sends the newest legacy repository release once - used by /config github as a test.
async function postLatest(client, guildId, channelId) {
  let releases;
  try { releases = await fetchReleases(REPO); }
  catch (err) { return { ok: false, reason: errText(err) }; }
  if (releases.length === 0) return { ok: false, reason: `${REPO} has no published releases yet - new ones will be posted automatically.`, empty: true };
  const posted = await postTo(client, guildId, channelId, [releases[0]], REPO);
  return posted ? { ok: true } : { ok: false, reason: "I couldn't post there - check my View Channel, Send Messages and Embed Links permissions." };
}

function start(client) {
  checkOnce(client);
  setInterval(() => checkOnce(client), INTERVAL_MS);
}

module.exports = { start, checkOnce, postLatest, buildEmbed, fetchReleases, normalizeRepo, getWatches, addWatch, removeWatch, REPO };
