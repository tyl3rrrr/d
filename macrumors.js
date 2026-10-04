// macrumors.js
// Pulls the newest MacRumors articles from the official RSS feed and posts every
// NEW article into the channel each server configured with /config macrumors
// (stored per server as guilds[guildId].macrumorsChannelId).
//
// - No extra packages: global fetch (Node 18+) plus a small RSS parser below.
// - New articles are detected by their GUID/link, NOT by pubDate (MacRumors'
//   feed has had broken dates before). The last ~200 seen IDs live in
//   data.json (meta.macrumorsSeen), so a restart never re-posts old articles.
// - On the very first run the current feed is only remembered, not posted
//   (otherwise every server would get ~50 articles at once).
// - Each article is posted as an embed: title, link, short excerpt, image.
//
// Optional .env:  MACRUMORS_FEED_URL (default below), MACRUMORS_INTERVAL_MIN (default 10)

const { EmbedBuilder } = require('discord.js');
const storage = require('./storage');
const { truncate, errText, sleep } = require('./util');

const FEED_URL = process.env.MACRUMORS_FEED_URL || 'https://feeds.macrumors.com/MacRumors-All';
const INTERVAL_MS = Math.max(2, Number(process.env.MACRUMORS_INTERVAL_MIN) || 10) * 60 * 1000;
const SEEN_KEY = 'macrumorsSeen';
const MAX_SEEN = 200;
const MAX_POSTS_PER_RUN = 10; // safety net: never flood a channel, even after a long outage

// ---------------------------------------------------------------------------
// Tiny RSS parser
// ---------------------------------------------------------------------------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

// Text of the first <tag>…</tag> in a block ("" if missing). Handles CDATA.
function tagText(block, tag) {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
  if (!m) return '';
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(m[1]);
  return (cdata ? cdata[1] : decodeEntities(m[1])).trim();
}

function htmlToText(html) {
  return decodeEntities(
    String(html)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<\/(p|div|h\d|li|blockquote)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

function firstImage(block, html) {
  const media = /<(?:media:content|media:thumbnail|enclosure)\b[^>]*\burl="([^"]+)"/i.exec(block);
  if (media && /^https:\/\//i.test(media[1])) return decodeEntities(media[1]);
  const img = /<img\b[^>]*\bsrc="(https:\/\/[^"]+)"/i.exec(html);
  return img ? decodeEntities(img[1]) : null;
}

function parseFeed(xml) {
  const items = [];
  const re = /<item\b[\s\S]*?<\/item>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[0];
    const link = tagText(block, 'link');
    const guid = tagText(block, 'guid') || link;
    const title = htmlToText(tagText(block, 'title'));
    if (!guid || !title || !/^https?:\/\//i.test(link)) continue;
    const html = tagText(block, 'content:encoded') || tagText(block, 'description');
    items.push({
      id: guid,
      title,
      link,
      author: tagText(block, 'dc:creator'),
      date: new Date(tagText(block, 'pubDate')),
      text: htmlToText(html),
      image: firstImage(block, html),
    });
  }
  return items; // feed order: newest first
}

async function fetchFeed() {
  const res = await fetch(FEED_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; tylxrrrr-bot RSS reader)', Accept: 'application/rss+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`MacRumors feed answered HTTP ${res.status}`);
  return parseFeed(await res.text());
}

// ---------------------------------------------------------------------------
// Posting
// ---------------------------------------------------------------------------
function buildEmbed(item) {
  const embed = new EmbedBuilder()
    .setColor(0xd13b2e)
    .setTitle(truncate(item.title, 256))
    .setURL(item.link)
    .setFooter({ text: item.author ? `MacRumors · ${truncate(item.author, 80)}` : 'MacRumors' });
  if (item.text) embed.setDescription(truncate(item.text, 700));
  if (item.image) embed.setImage(item.image);
  if (!Number.isNaN(item.date.getTime())) embed.setTimestamp(item.date);
  return embed;
}

async function postTo(client, guildId, channelId, items) {
  const guild = client.guilds.cache.get(guildId);
  const channel = guild && (guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null)));
  if (!channel || !channel.isTextBased()) return false;
  for (const item of items) {
    try {
      await channel.send({ embeds: [buildEmbed(item)], allowedMentions: { parse: [] } });
    } catch (err) {
      console.warn(`MacRumors: could not post on ${guildId}:`, errText(err));
      return false; // e.g. missing permission - skip this server for this run
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
    const items = await fetchFeed();
    if (items.length === 0) return;

    const seen = storage.getMeta(SEEN_KEY);
    if (!Array.isArray(seen)) {
      // First run ever: remember what exists, post nothing.
      storage.setMeta(SEEN_KEY, items.map((i) => i.id).slice(0, MAX_SEEN));
      return;
    }

    const known = new Set(seen);
    const fresh = items.filter((i) => !known.has(i.id)).reverse().slice(-MAX_POSTS_PER_RUN); // oldest first
    if (fresh.length === 0) return;

    for (const [guildId, settings] of Object.entries(allGuilds())) {
      if (!settings.macrumorsChannelId) continue;
      await postTo(client, guildId, settings.macrumorsChannelId, fresh);
    }
    storage.setMeta(SEEN_KEY, [...fresh.map((i) => i.id).reverse(), ...seen].slice(0, MAX_SEEN));
  } catch (err) {
    console.warn('MacRumors: check failed:', errText(err));
  } finally {
    running = false;
  }
}

// All servers that have settings (storage.js exposes settings per guild only).
function allGuilds() {
  const out = {};
  for (const id of storage.listGuildIds()) out[id] = storage.getGuildSettings(id);
  return out;
}

// Sends the newest article once - used by /config macrumors as a "it works" proof.
async function postLatest(client, guildId, channelId) {
  const items = await fetchFeed();
  if (items.length === 0) return false;
  return postTo(client, guildId, channelId, [items[0]]);
}

function start(client) {
  checkOnce(client);
  setInterval(() => checkOnce(client), INTERVAL_MS);
}

module.exports = { start, checkOnce, postLatest, parseFeed, buildEmbed, FEED_URL };
