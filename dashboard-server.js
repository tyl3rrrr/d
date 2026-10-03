// dashboard-server.js
// Web dashboard backend - plain node:http, no extra packages.
// Login via Discord OAuth2 (only "identify"; the access token is discarded right away).
// Access per server = the bot's own admin rule (permissions.js): server owner,
// Discord Administrator, or the role set with /settings admin-role.
//
// .env:  DASHBOARD_CLIENT_SECRET  OAuth2 client secret (Developer Portal -> OAuth2)
//        DASHBOARD_SECRET         any long random string (signs the login cookie)
//        DASHBOARD_URL            public base URL, e.g. https://bot.example.com (no trailing slash)
//        DASHBOARD_PORT           optional, default 3000
// Developer Portal -> OAuth2 -> Redirects must contain: <DASHBOARD_URL>/callback

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Routes, ChannelType } = require('discord.js');
const storage = require('./storage');
const automod = require('./automod-api');
const permissions = require('./permissions');
const logging = require('./logging');
const { DEFAULT_PUBLIC } = require('./commands-welcome');

const DEFAULT_DM = 'Hello {user}, enjoy your time on **{server}**! Be respectful and nice!'; // same text as commands-welcome.js
const API = 'https://discord.com/api/v10';
const SESSION_MS = 7 * 24 * 3600 * 1000;
const HEX = /^#?([0-9a-f]{6})$/i;

// setting key -> what it must point to, and its log label
const FIELDS = {
  adminRoleId: ['team-role', 'Administrator role'],
  modRoleId: ['team-role', 'Moderator role'],
  ticketStaffRoleId: ['role', 'Support role'],
  logChannelId: ['text', 'Log channel'],
  suggestChannelId: ['text', 'Suggestions channel'],
  xpBoardChannelId: ['text', 'XP leaderboard channel'],
  ticketCategoryId: ['category', 'Ticket category'],
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let started = false;

function start(client) {
  const { DASHBOARD_CLIENT_SECRET: clientSecret, DASHBOARD_SECRET: secret, DASHBOARD_URL } = process.env;
  if (started) return;
  if (!clientSecret || !secret || !DASHBOARD_URL) {
    console.log('Dashboard: disabled (set DASHBOARD_CLIENT_SECRET, DASHBOARD_SECRET and DASHBOARD_URL in .env to enable it).');
    return;
  }
  started = true;
  const base = DASHBOARD_URL.replace(/\/+$/, '');
  const secure = base.startsWith('https://');
  const port = Number(process.env.DASHBOARD_PORT) || 3000;

  // ---------- sessions: HMAC-signed cookie, no server-side state ----------
  const mac = (b) => crypto.createHmac('sha256', secret).update(b).digest('base64url');
  const sign = (p) => {
    const b = Buffer.from(JSON.stringify(p)).toString('base64url');
    return `${b}.${mac(b)}`;
  };
  const verify = (tok) => {
    const [b, m] = String(tok || '').split('.');
    if (!b || !m || m.length !== mac(b).length || !crypto.timingSafeEqual(Buffer.from(m), Buffer.from(mac(b)))) return null;
    try {
      const p = JSON.parse(Buffer.from(b, 'base64url').toString());
      return p.exp > Date.now() ? p : null;
    } catch (err) {
      return null;
    }
  };
  const cookiesOf = (req) =>
    Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split(/=(.*)/s).slice(0, 2)).filter(([k]) => k));
  const setCookie = (res, name, value, maxAgeSec) =>
    res.setHeader('Set-Cookie', [].concat(res.getHeader('Set-Cookie') || [], `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`));

  const send = (res, status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };
  const redirect = (res, to) => {
    res.writeHead(302, { Location: to });
    res.end();
  };
  const readBody = (req) =>
    new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > 100000) {
          reject(new HttpError(413, 'Request too large.'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        try {
          resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
        } catch (err) {
          reject(new HttpError(400, 'Invalid JSON.'));
        }
      });
      req.on('error', reject);
    });

  // ---------- login ----------
  function login(res) {
    const state = crypto.randomBytes(16).toString('hex');
    setCookie(res, 'dstate', state, 600);
    const q = new URLSearchParams({ client_id: client.user.id, redirect_uri: `${base}/callback`, response_type: 'code', scope: 'identify', state, prompt: 'none' });
    redirect(res, `https://discord.com/oauth2/authorize?${q}`);
  }

  async function callback(req, res, url) {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state || cookiesOf(req).dstate !== state) throw new HttpError(400, 'Login failed - please try again.');
    const tokenRes = await fetch(`${API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: client.user.id, client_secret: clientSecret, grant_type: 'authorization_code', code, redirect_uri: `${base}/callback` }),
    });
    if (!tokenRes.ok) throw new HttpError(400, 'Discord rejected the login. Check DASHBOARD_URL and the redirect URI in the Developer Portal.');
    const { access_token } = await tokenRes.json();
    const meRes = await fetch(`${API}/users/@me`, { headers: { Authorization: `Bearer ${access_token}` } });
    if (!meRes.ok) throw new HttpError(400, 'Could not read your Discord profile.');
    const u = await meRes.json();
    setCookie(res, 'dsession', sign({ id: u.id, name: u.global_name || u.username, avatar: u.avatar, exp: Date.now() + SESSION_MS }), SESSION_MS / 1000);
    setCookie(res, 'dstate', '', 0);
    redirect(res, '/');
  }

  // ---------- access ----------
  const levelOk = async (guild, userId) => {
    const member = await guild.members.fetch(userId).catch(() => null);
    return Boolean(member) && permissions.getMemberLevel(guild, member) >= permissions.LEVEL.ADMIN;
  };

  async function requireAdmin(user, guildId) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw new HttpError(404, 'The bot is not on this server.');
    if (!(await levelOk(guild, user.id))) throw new HttpError(403, 'Administrators only.');
    return guild;
  }

  async function listGuilds(user) {
    const all = await Promise.all([...client.guilds.cache.values()].map(async (g) => ((await levelOk(g, user.id)) ? { id: g.id, name: g.name, icon: g.iconURL({ size: 64 }) } : null)));
    return all.filter(Boolean);
  }

  // ---------- reading ----------
  async function automodState(guild) {
    try {
      const rules = await automod.listAllRules(client, guild.id);
      const wordRule = rules.find((r) => r.name === automod.RULE_NAMES.words);
      return {
        rules: automod.RULE_ORDER.map((kind) => ({ label: automod.RULE_LABELS[kind], active: rules.some((r) => r.name === automod.RULE_NAMES[kind] && r.enabled) })),
        words: wordRule ? automod.getWordsFromRule(wordRule) : [],
        hasWordRule: Boolean(wordRule),
      };
    } catch (err) {
      return { error: automod.explainError(err) };
    }
  }

  async function snapshot(guild) {
    const s = storage.getGuildSettings(guild.id);
    const me = guild.members.me || (await guild.members.fetchMe().catch(() => null));
    const colorRole = s.appearanceRoleId && guild.roles.cache.get(s.appearanceRoleId);
    const types = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildCategory];
    return {
      name: guild.name,
      channels: [...guild.channels.cache.values()]
        .filter((c) => types.includes(c.type))
        .sort((a, b) => a.rawPosition - b.rawPosition)
        .map((c) => ({ id: c.id, name: c.name, kind: c.type === ChannelType.GuildCategory ? 'category' : 'text' })),
      roles: [...guild.roles.cache.values()]
        .filter((r) => r.id !== guild.id && !r.managed)
        .sort((a, b) => b.position - a.position)
        .map((r) => ({ id: r.id, name: r.name })),
      settings: Object.fromEntries(Object.keys(FIELDS).map((k) => [k, s[k] || null])),
      welcome: { ...(s.welcome || {}), defaults: { message: DEFAULT_PUBLIC, dmMessage: DEFAULT_DM } },
      appearance: {
        botName: client.user.username,
        nickname: (me && me.nickname) || '',
        color: colorRole && colorRole.color ? `#${colorRole.color.toString(16).padStart(6, '0')}` : null,
      },
      automod: await automodState(guild),
    };
  }

  // ---------- writing ----------
  const by = (user) => `${user.name} (dashboard)`;

  function checkTarget(guild, key, id) {
    const [kind] = FIELDS[key];
    if (typeof id !== 'string') throw new HttpError(400, 'Invalid value.');
    if (kind === 'role' || kind === 'team-role') {
      const r = guild.roles.cache.get(id);
      if (!r) throw new HttpError(400, 'That role does not exist.');
      if (kind === 'team-role' && (r.id === guild.id || r.managed)) throw new HttpError(400, "@everyone and integration roles can't be team roles.");
      return r.name;
    }
    const c = guild.channels.cache.get(id);
    const ok = kind === 'category' ? c?.type === ChannelType.GuildCategory : c && (c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement);
    if (!ok) throw new HttpError(400, 'That channel does not exist or has the wrong type.');
    return c.name;
  }

  function updateSettings(guild, body, user) {
    const current = storage.getGuildSettings(guild.id);
    let xpChanged = false;
    for (const [key, value] of Object.entries(body)) {
      if (!(key in FIELDS)) continue;
      const cleared = value === null || value === '';
      if (cleared && !current[key]) continue;
      if (!cleared && current[key] === value) continue;
      const label = FIELDS[key][1];
      const shown = cleared ? null : checkTarget(guild, key, value);
      if (cleared) storage.removeGuildSetting(guild.id, key);
      else storage.setGuildSetting(guild.id, key, value);
      if (key === 'xpBoardChannelId') {
        storage.removeGuildSetting(guild.id, 'xpBoardMessageId'); // new channel -> new leaderboard message
        xpChanged = !cleared;
      }
      logging.logSettingChange(client, guild.id, { setting: label, value: shown, moderator: by(user) });
    }
    if (xpChanged) require('./xp-runtime').updateGuildBoard(client, guild.id).catch(() => {});
  }

  const text = (v, max) => {
    if (v == null || v === '') return undefined;
    if (typeof v !== 'string' || v.length > max) throw new HttpError(400, `Text too long (max ${max} characters).`);
    return v.trim();
  };

  async function updateWelcome(guild, body, user) {
    if (body.reset) {
      storage.removeGuildSetting(guild.id, 'welcome');
      logging.logSettingChange(client, guild.id, { setting: 'Welcome system', value: null, moderator: by(user) });
      return { notes: [] };
    }
    const cfg = {};
    const notes = [];
    const me = guild.members.me;
    if (body.roleId) {
      const r = guild.roles.cache.get(body.roleId);
      if (!r || r.id === guild.id || r.managed) throw new HttpError(400, "This role can't be auto-assigned.");
      if (me && r.position >= me.roles.highest.position) notes.push("That role is above my highest role - I can't assign it until you move my role above it.");
      cfg.roleId = r.id;
    }
    if (body.channelId) {
      checkTarget(guild, 'logChannelId', body.channelId); // any text channel is fine here
      cfg.channelId = body.channelId;
    }
    if (body.dmEnabled) cfg.dmEnabled = true;
    const m = text(body.message, 500);
    const d = text(body.dmMessage, 500);
    if (m) cfg.message = m;
    if (d) cfg.dmMessage = d;
    if (Object.keys(cfg).length) storage.setGuildSetting(guild.id, 'welcome', cfg);
    else storage.removeGuildSetting(guild.id, 'welcome');
    logging.logSettingChange(client, guild.id, { setting: 'Welcome system', value: 'updated', moderator: by(user) });
    return { notes };
  }

  async function updateAppearance(guild, body, user) {
    const reason = `Changed in the dashboard by ${user.name}`;
    const patch = {};
    if (typeof body.nickname === 'string') {
      if (body.nickname.length > 32) throw new HttpError(400, 'Nickname: max 32 characters.');
      patch.nick = body.nickname.trim() || null;
    }
    if (typeof body.bio === 'string' && body.bio.trim()) {
      if (body.bio.length > 400) throw new HttpError(400, 'Bio: max 400 characters.');
      patch.bio = body.bio.trim();
    }
    if (Object.keys(patch).length) await client.rest.patch(Routes.guildMember(guild.id, '@me'), { body: patch, reason });

    const roleId = storage.getGuildSettings(guild.id).appearanceRoleId;
    if (body.color === null && roleId) {
      await client.rest.delete(Routes.guildRole(guild.id, roleId), { reason }).catch(() => {});
      storage.removeGuildSetting(guild.id, 'appearanceRoleId');
    } else if (typeof body.color === 'string') {
      const m = HEX.exec(body.color.trim());
      if (!m) throw new HttpError(400, 'Colors must be hex, e.g. #ff8a00.');
      const roleBody = { name: client.user.username, permissions: '0', hoist: false, mentionable: false, color: parseInt(m[1], 16) };
      let id = roleId && guild.roles.cache.has(roleId) ? roleId : null;
      if (id) await client.rest.patch(Routes.guildRole(guild.id, id), { body: roleBody, reason });
      else {
        id = (await client.rest.post(Routes.guildRoles(guild.id), { body: roleBody, reason })).id;
        storage.setGuildSetting(guild.id, 'appearanceRoleId', id);
      }
      await client.rest.put(Routes.guildMemberRole(guild.id, client.user.id, id), { reason });
    }
    logging.logSettingChange(client, guild.id, { setting: 'Bot appearance', value: 'updated', moderator: by(user) });
  }

  async function updateWords(guild, body, user) {
    if (!Array.isArray(body.words)) throw new HttpError(400, 'words must be a list.');
    const seen = new Set();
    const words = [];
    for (const raw of body.words) {
      const n = automod.normalizeWord(raw);
      if (!n.ok) throw new HttpError(400, n.error);
      if (!seen.has(n.word.toLowerCase())) {
        seen.add(n.word.toLowerCase());
        words.push(n.word);
      }
    }
    const rule = await automod.ensureWordRule(client, guild.id);
    await automod.setWords(client, guild.id, rule, words);
    logging.logSettingChange(client, guild.id, { setting: 'AutoMod word list', value: `${words.length} word(s)`, moderator: by(user) });
  }

  // ---------- routing ----------
  async function handleApi(req, res, url, user) {
    if (url.pathname === '/api/me') return send(res, 200, { user: { id: user.id, name: user.name, avatar: user.avatar }, guilds: await listGuilds(user) });

    const m = url.pathname.match(/^\/api\/g\/(\d{5,25})(?:\/(\w+)(?:\/(\w+))?)?$/);
    if (!m) throw new HttpError(404, 'Not found.');
    if (req.method !== 'GET' && (!(req.headers['content-type'] || '').startsWith('application/json') || req.headers['x-requested-with'] !== 'dashboard')) {
      throw new HttpError(403, 'Forbidden.'); // CSRF guard: custom header + JSON only
    }
    const guild = await requireAdmin(user, m[1]);
    const route = `${req.method} ${m[2] || ''}${m[3] ? `/${m[3]}` : ''}`;
    const body = req.method === 'GET' ? {} : await readBody(req);

    switch (route) {
      case 'GET ':
        return send(res, 200, await snapshot(guild));
      case 'PUT settings':
        updateSettings(guild, body, user);
        return send(res, 200, { ok: true });
      case 'PUT welcome':
        return send(res, 200, { ok: true, ...(await updateWelcome(guild, body, user)) });
      case 'POST appearance':
        await updateAppearance(guild, body, user);
        return send(res, 200, { ok: true });
      case 'PUT automod/words':
        await updateWords(guild, body, user);
        return send(res, 200, { ok: true });
      case 'POST automod/setup': {
        const out = await automod.resetAndCreateRules(client, guild.id);
        logging.logSettingChange(client, guild.id, { setting: 'AutoMod rules', value: 'recreated', moderator: by(user) });
        return send(res, 200, { ok: true, errors: out.results.filter((r) => r.status === 'error').map((r) => r.error) });
      }
      default:
        throw new HttpError(404, 'Not found.');
    }
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' https://cdn.discordapp.com data:; frame-ancestors 'none'"
    );
    const url = new URL(req.url, base);
    const isApi = url.pathname.startsWith('/api/');
    try {
      if (url.pathname === '/login') return login(res);
      if (url.pathname === '/callback') return await callback(req, res, url);
      if (url.pathname === '/logout') {
        setCookie(res, 'dsession', '', 0);
        return redirect(res, '/');
      }
      if (isApi) {
        const user = verify(cookiesOf(req).dsession);
        if (!user) throw new HttpError(401, 'Not logged in.');
        return await handleApi(req, res, url, user);
      }
      if (url.pathname === '/' || url.pathname === '/dashboard.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(fs.readFileSync(path.join(__dirname, 'dashboard.html')));
      }
      throw new HttpError(404, 'Not found.');
    } catch (err) {
      const known = err instanceof HttpError;
      if (!known) console.warn('Dashboard error:', err && err.message);
      const status = known ? err.status : 502;
      const message = known ? err.message : automod.explainError(err);
      if (isApi) return send(res, status, { error: message });
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(message);
    }
  });

  server.on('error', (err) => console.error('Dashboard: could not start:', err.message));
  server.listen(port, () => console.log(`Dashboard: listening on port ${port} (${base})`));
}

module.exports = { start };
