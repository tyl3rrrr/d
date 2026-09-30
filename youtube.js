// youtube.js
// Thin wrapper around the YouTube Data API v3 (search, resolve a channel's
// uploads playlist, and check that playlist for a new latest video) plus a
// background poller that notifies configured Discord channels about new
// uploads.
//
// Requires YOUTUBE_API_KEY in .env (a free Google Cloud API key with the
// "YouTube Data API v3" enabled). Without it, /ytnotify explains what's
// missing instead of the poller silently doing nothing.
//
// Quota note: search.list costs 100 units, channels.list and
// playlistItems.list cost 1 unit each (default daily quota is 10,000 units).
// Searching by name is therefore only done when an admin runs `/ytnotify
// add` - the recurring poller exclusively uses the cheap playlistItems.list
// call (one per tracked channel per cycle), never search.list.

const storage = require('./storage');
const { errText, sleep } = require('./util');

const API_BASE = 'https://www.googleapis.com/youtube/v3';
const POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes - gentle on quota and API rate limits

function apiKey() {
  return (process.env.YOUTUBE_API_KEY || '').trim();
}

function isConfigured() {
  return apiKey().length > 0;
}

async function apiGet(path, params) {
  const url = new URL(`${API_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('key', apiKey());

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`YouTube API ${path} failed: HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return res.json();
}

// Searches for channels by name. Returns up to `max` results with the info
// needed both to show a picker and to start tracking immediately.
async function searchChannels(query, max = 5) {
  const data = await apiGet('search', { part: 'snippet', type: 'channel', q: query, maxResults: String(max) });
  return (data.items || []).map((item) => ({
    channelId: item.id.channelId,
    title: item.snippet.title,
    description: item.snippet.description,
    thumbnail: item.snippet.thumbnails?.default?.url,
  }));
}

// Every channel has an "uploads" playlist (all of the channel's public
// videos, newest first) - fetching that once and polling it with
// playlistItems.list is far cheaper than repeatedly searching.
async function getUploadsPlaylistId(channelId) {
  const data = await apiGet('channels', { part: 'contentDetails', id: channelId });
  const item = data.items && data.items[0];
  if (!item) throw new Error(`Channel ${channelId} not found.`);
  return item.contentDetails.relatedPlaylists.uploads;
}

// Returns { videoId, title, url, thumbnail, publishedAt } for the newest
// video in a playlist, or null if the playlist is empty.
async function getLatestVideo(uploadsPlaylistId) {
  const data = await apiGet('playlistItems', { part: 'snippet', playlistId: uploadsPlaylistId, maxResults: '1' });
  const item = data.items && data.items[0];
  if (!item) return null;
  const videoId = item.snippet.resourceId.videoId;
  return {
    videoId,
    title: item.snippet.title,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    thumbnail: item.snippet.thumbnails?.default?.url,
    publishedAt: item.snippet.publishedAt,
  };
}

// ---------------------------------------------------------------------------
// Background poller
// ---------------------------------------------------------------------------
async function pollGuild(client, guildId) {
  const list = storage.getYtNotifyList(guildId);
  if (list.length === 0) return;

  let changed = false;
  for (const entry of list) {
    try {
      const latest = await getLatestVideo(entry.uploadsPlaylistId);
      if (!latest) continue;

      if (entry.lastVideoId && latest.videoId !== entry.lastVideoId) {
        const channel = client.guilds.cache.get(guildId)?.channels.cache.get(entry.notifyChannelId);
        if (channel && channel.isTextBased()) {
          await channel
            .send({ content: `🔴 **${entry.channelTitle}** just uploaded: **${latest.title}**\n${latest.url}` })
            .catch((err) => console.warn(`YouTube notify: could not post in ${entry.notifyChannelId}:`, errText(err)));
        }
      }
      if (latest.videoId !== entry.lastVideoId) {
        entry.lastVideoId = latest.videoId;
        changed = true;
      }
    } catch (err) {
      console.warn(`YouTube notify: could not check "${entry.channelTitle}" on ${guildId}:`, errText(err));
    }
    await sleep(300); // stay well under the API's per-second rate limit
  }

  if (changed) storage.setYtNotifyList(guildId, list);
}

async function pollAllGuilds(client) {
  if (!isConfigured()) return;
  for (const guildId of client.guilds.cache.keys()) {
    await pollGuild(client, guildId);
  }
}

function startPoller(client) {
  if (!isConfigured()) {
    console.warn('YouTube notify: YOUTUBE_API_KEY is not set - /ytnotify will not work until it is configured in .env.');
    return;
  }
  pollAllGuilds(client).catch((err) => console.warn('YouTube notify: initial poll failed:', errText(err)));
  setInterval(() => pollAllGuilds(client).catch((err) => console.warn('YouTube notify: poll failed:', errText(err))), POLL_INTERVAL_MS);
}

module.exports = { isConfigured, searchChannels, getUploadsPlaylistId, getLatestVideo, startPoller, pollGuild };
