# tylxrrrr Discord Bot (v7.9.1)

The bot source itself uses a flat Node.js structure built on discord.js v14. The optional `dashboard/` folder contains the static InfinityFree dashboard, Supabase Edge Function, SQL schema, and setup guide.

---

## v7.9.1 — Supabase dashboard bridge

Added a Supabase-backed dashboard for InfinityFree. Supabase handles Discord login and securely relays setting changes; the bot uses outbound HTTPS polling only. See `dashboard/README-DASHBOARD.md` for setup.

## v7.8.3 - custom GitHub release watches

**`/github-check add url channel`** (moderators, administrators and server owner) watches a public GitHub
repository and posts newly published releases in the selected text/announcement channel. Example URL:
`https://github.com/owner/repository`. When a watch is first added, existing releases are remembered and
are not spam-posted.

**`/github-check list`** shows this server's watched repositories and destinations. **`/github-check remove url`**
removes one watch. Watch lists are stored per server in `data.json`; servers do not affect each other's settings.
The existing `/config github` global feed remains available. Checks run at the interval set by
`GITHUB_INTERVAL_MIN` (default 10 minutes). `GITHUB_TOKEN` is optional and can raise the public API rate limit.

## v7.8.0 - /adm-reload is back, AI chat, bot-owner tooling

**`/adm-reload` is back** (**bot owner only** - before it was open to any server administrator, which
let an admin of ANY server switch the bot off for everybody): replies immediately, then exits the
process after 3 seconds (needs a process manager with auto-restart to actually come back online,
see section 12).

**`/help` now always matches reality.** It is generated automatically from the list of commands that
actually exist at startup, so a command that was removed can never still be listed, and a new one
never has to be added to the menu by hand.

**`/config bot-logs`** (**bot owner only**) - the bot keeps its own activity log (`botlog.js`): every
DM it receives (who, and the content), every slash command used anywhere, errors, server joins/leaves
and AI chats. This is so the bot operator can check the bot is not being used for anything illegal.
Browse it with `type`, `user` or `search`, or see totals with no options. Entries are kept for
`BOTLOG_RETENTION_DAYS` days (default 30) and secrets (tokens/keys) are stripped before anything is
written. **This must be mentioned in your Privacy Policy** (`/privacy-policy`) since it logs DM content.

**`/console`** (**bot owner only**) - the deepest level of the bot: `info` (live PID, memory, uptime,
AI usage, log size), `cache` (look up a cached guild/user/channel by ID), `eval` (run one line of code
against the live bot for debugging - 2s timeout, `process.env` is not reachable from it, and the
output is redacted before it's shown, so a secret can't leak through it), and `restart` (same as
`/adm-reload`). Every `/console eval` use is written to the bot log.

**AI chat** - the bot can:
- answer `/ask question` (everyone; `/ask reset` forgets your conversation with it),
- generate a single source file with `/code language info` and DM the attachment to the requester (supported types include HTML, CSS, JavaScript, TypeScript, Python, JSON, Markdown, SQL, XML, SVG, Java, C/C++, C#, PHP, Ruby, Go, Rust and shell scripts). Generated code is not executed by the bot,
- answer when **@mentioned** in a server channel (`/config ai enabled:false` turns this off per
  server; without the Message Content Intent it can tell it was mentioned but points to `/ask`
  instead of guessing what was asked),
- reply **individually to DMs** that aren't an open ticket or application interview - a normal chat,
  with a short privacy note on the first reply.

**Setup (v7.8.2: Google Gemini, free):** create a key at https://aistudio.google.com ("Get API key",
no credit card) and put `GEMINI_KEY="AIza..."` into `.env`, then `/reload` or restart. If the bot says the
key is not accepted, restrict the key to the "Generative Language API" in the Google Cloud Console
(APIs & Services -> Credentials). Alternative: `CHATGPT_KEY="sk-..."` (OpenAI). **That needs paid API
credit - a free ChatGPT account does not include it.** If both keys exist, Gemini is used. Default models:
`gemini-2.5-flash` (falls back to `gemini-3.5-flash` if Google retired it) / `gpt-5.4-mini`.

Protection against abuse and the free limits (the free Gemini tier only allows a few hundred requests
per day): a 5 second cooldown and one request at a time per person, a daily limit per person and for the
whole bot together (`AI_DAILY_LIMIT` default 40, `AI_GLOBAL_LIMIT` default 400), questions capped at 1500
characters, and a short per-person conversation memory (last 10 messages, forgotten after 30 minutes).
Optional `.env`: `GEMINI_MODEL`, `CHATGPT_MODEL`, `AI_MAX_TOKENS`, `AI_DAILY_LIMIT`, `AI_GLOBAL_LIMIT`,
`BOTLOG_RETENTION_DAYS`. Without a key these features simply stay silent - nothing breaks.

The per-server on/off switch for @mention replies is `/config ai` (administrators).

---

## v7.7.0 - reports, rules, partners, new menus, cleanup

**Removed commands:** `/ticket-panel`, `/adm-reload`, `/8ball`, `/dice`, `/antimdm`, `/coinflip`, `/links`,
`/remindme`, `/web` and `/bstatnow`. They are gone from the code, from `/help` and - after the next start -
from Discord's command list (the bot compares its list with Discord's on startup and deletes outdated commands).
Ticket panels posted by older versions keep working (their button is still handled).

**`/help`** is now a menu: an overview plus a drop-down to switch between categories. **`/changelog`** pages through
the updates (3 per page, Previous/Next). Both are private to the person who opened them.

**`/report user reason [evidence]`** (everyone; 1 report per minute) - creates a panel in the **Report channel**
(`/settings`) with the status and the moderator who handles it: 🟡 Open → [Take] → 🔵 In progress by @mod →
[Resolve] 🟢 / [Dismiss] ⚪ → [Reopen]. Only moderators can use the buttons. The reporter gets a DM when it is closed.

**`/rules`** (administrators; `view` is open to everyone) - `edit` opens a form, a changed text creates a new
**version** (the last 10 are kept), `post` publishes the rules with an **"I accept the rules"** button, `status`
shows how many members accepted the current version. The button contains the version, so an outdated message can
never accept rules the person has not seen. The optional **Rules role** (`/settings`) is granted on accept; roles are
not removed automatically when a new version appears.

**`/partner`** - `request name invite description` (everyone): the invite is checked against Discord (valid? which
server? how many members? temporary?) and the request lands in the **Partner review channel** with [Accept] / [Deny]
(moderators). Accepting saves the partner and **posts it automatically** in the **Partner channel** with a join
button; the requester gets a DM. `list` shows all partners, `remove` (admin, autocomplete) deletes a partner and its post.

New `/settings` entries: Report channel, Partner review channel, Partner channel, Rules role.

---

## v7.6.0 - GitHub releases, giveaways, statistics, legal links

**Removed:** the whole XP system (`/xp-board`, `/xp-set`, `/xp-stats`, `/xp-global`, message XP, level roles,
leaderboard, the XP setting in `/settings`). Old XP data is deleted from `data.json` automatically the next time it is saved.

**`/config github [channel]`** (admin; also in the `/settings` panel) - new releases of the repository
`tyl3rrrr/d` are posted into the chosen channel (`github.js`). Checked every 10 minutes through the public GitHub
API; the first check only remembers existing releases, so nothing old is re-posted. After choosing a channel the
newest release is posted once as a test. Omit the channel to turn it off. Optional `.env`: `GITHUB_REPO`
(default `tyl3rrrr/d`), `GITHUB_TOKEN` (higher API limit / private repo), `GITHUB_INTERVAL_MIN`.

**`/giveaway`** (moderators and above; `giveaway-runtime.js`, `commands-giveaway.js`)
- `create prize duration [winners] [channel] [role] [min-days] [conditions]` - several winners (1-25), entry
  requirements (required role, minimum days on the server, free-text conditions), duration like `30m`, `2h`, `1d12h`.
- Members join with a **Join** button (click again to leave). Requirements are checked on click and again at the draw.
- **Automatic draw** when the time is up (also for giveaways that ended while the bot was offline). Winners are drawn
  with a cryptographically secure shuffle; people who left, bots and people who no longer meet the requirements are skipped.
- `end` (draw now), `reroll [winners]` (new winners, never someone drawn before), `cancel`, `list`. The `id` option
  has autocomplete. Giveaways are stored in `data.json`, so they survive restarts.

**`/stats`** (everyone) - real usage numbers counted by the bot (`stats.js`): commands used, most used command,
most active hour, errors, plus the top 5 commands. Hours use `STATS_TIMEZONE` (default `Europe/Berlin`).

**`/tos`** and **`/privacy-policy`** - link to https://tylxrrrr.is-great.net/tos-bot.html and
https://tylxrrrr.is-great.net/privacy-bot.html (override with `TOS_URL` / `PRIVACY_URL` in `.env`).

**No more "Unknown command" / "application did not respond":** every new command acknowledges the interaction first
(`deferReply`) and runs inside `interaction-guard.js`; the giveaway button does as well. Commands are re-registered
automatically on startup (`AUTO_DEPLOY`), but **the bot process must be restarted after updating the files.**

---

## 1. Quick start

```bash
npm install
cp .env.template .env      # then fill in DISCORD_TOKEN (and anything else you need)
npm run deploy               # registers all slash commands with Discord
npm start                     # starts the bot
```

`npm run deploy` checks **every** command against Discord's name/length/
structure rules (see `command-tools.js`) **before** sending, and aborts with
a clear error message instead of firing an unvalidated request at the API.
This rules out crashes from invalid commands (e.g. a command name with
capital letters) - that was the cause of an earlier crash,
`ExpectedConstraintError ... given: 'bStatNow'`: Discord requires slash
command names to be **entirely lowercase**. The command is now correctly
named `/bstatnow`.

The bot also **automatically re-registers its commands on every startup** if
anything changed (`AUTO_DEPLOY=true`, the default) - that was the main cause
of "Unknown Command" errors: the running bot code and the list registered
with Discord had drifted apart. `npm run deploy` remains available for
manual/targeted registration and never fails with an unclear API error
because everything is validated locally first.

## 2. Discord Developer Portal - required settings

- **Bot -> Privileged Gateway Intents:**
  - `SERVER MEMBERS INTENT` - for the welcome system (new members).
  - `MESSAGE CONTENT INTENT` - for the `!support` text command.
  - If either is missing, the bot still starts **anyway**: it detects this
    automatically (`DisallowedIntents`) and restarts without the missing
    intent, but loudly reports in the console which feature that disables.
    `/welcome-setup` also shows a direct warning in Discord when the Server
    Members Intent is missing.
- **Installation -> Installation Contexts:** also enable "User Install" in
  addition to "Guild Install" so people can install the bot to their own
  account without inviting it to a server (see sections 6/12 below).
- **Bot permissions** (request these when inviting the bot): Administrator
  is simplest; the minimum needed is: Kick/Ban Members, Moderate Members
  (Timeout), Manage Messages, Manage Channels, Manage Roles, Manage Guild
  (for AutoMod), Manage Nicknames, Send Messages, Create Instant Invite
  (for the global XP server link), View Channels.

## 3. Central architecture (important for future changes)

| File | Purpose |
|---|---|
| `commands.js` | **The one place** where every command is registered - with category (for `/help`) and access level (for `permissions.js`). New command? Add one line here. |
| `permissions.js` | Central permission check. No command checks permissions itself anymore - `index.js` calls `guardInteraction()` before every execution. Rank levels: mod role < admin role/Discord Administrator < server owner. |
| `command-tools.js` | Builds & validates the Discord payload, registers globally, cleans up outdated server commands, auto-syncs on bot startup. |
| `storage.js` | One `data.json` file in the folder, settings separated per server (`guilds[guildId]`), giveaways separated per server (`giveaways[guildId][id]`). Writes atomically (temp file + rename), backs up a corrupted `data.json` instead of overwriting it. |
| `automod-api.js` | AutoMod **exclusively via the official Discord AutoMod API** - no local message filter in the bot code anymore. |
| `logging.js` | Central logging into the channel set via `/settings log-channel`. |
| `github.js` / `commands-github.js` | GitHub release feeds (`/config github`, `/github-check add\|list\|remove`). |
| `giveaway-runtime.js` / `commands-giveaway.js` | Giveaway logic (join button, automatic draw, reroll) and the `/giveaway` command. |
| `report-runtime.js` / `commands-report.js` | Report panel with status and handler; the `/report` command. |
| `rules-runtime.js` / `commands-rules.js` | Versioned server rules, Accept button, edit form; the `/rules` command. |
| `partner-runtime.js` / `commands-partner.js` | Partner requests (invite check), review buttons, automatic posts; the `/partner` command. |
| `menus.js` | The interactive `/help` and `/changelog` menus. |
| `ai.js` / `ai-runtime.js` | AI access (Google Gemini, optionally OpenAI) and the Discord side (@mentions, DMs). |
| `commands-ai.js` | The `/ask` and `/code` commands. |
| `botlog.js` | The bot's own activity log (bot-owner only, see `/config bot-logs`). |
| `stats.js` / `commands-info.js` | Usage counters for `/stats`; `/tos`, `/privacy-policy` and `/stats` commands. |
| `presence.js` | Bot online status (bot-wide, see the limitation below). |
| `apply-runtime.js` | DM-interview state machine and Accept/Deny button logic for the applications system (see `commands-apply.js`). |

## 4. Fixes made after your test feedback (this round)

- **`/automod setup` -> still failing with "Invalid Form Body" / "max rules
  of type exceeded":** Discord only allows a limited number of rules **per
  type per server**, regardless of who created them. The previous version
  only adopted existing rules it recognized by exact name, and still tried
  to create new ones when it didn't recognize a rule - which could still hit
  the per-type cap. **Fixed with a clean-slate approach, as requested:**
  `/automod setup` now **deletes every existing AutoMod rule on the server
  first** (any type, any creator), then creates the 5 standard rules fresh.
  This can never hit "max rules of type exceeded" again, because nothing is
  left over when it creates the new ones. Verified with a mock that
  reproduces the exact reported scenario (all 5 rule types already at their
  maximum from foreign rules) - now resolves cleanly with 0 errors.
- **New: `/automod setup-all` (bot owner only)** rolls the same clean-slate
  setup out to **every server the bot is in**, not just the one the command
  was run on - exactly as requested ("publish on all servers").
- **`/welcome-setup`: no message, no role:** the most likely cause is the
  privileged **"SERVER MEMBERS INTENT"** in the Discord Developer Portal -
  if it isn't enabled, the bot automatically starts WITHOUT it (see
  `index.js`, `INTENT_PLANS`), and Discord then never sends the join event,
  no matter the configuration. `/welcome-setup` now shows this as a clear
  warning directly in its reply, with a link to the Developer Portal and
  the exact click path. Also, **bots** are now greeted too (previously
  excluded on purpose - per your feedback, that's not wanted).
- **Bot status appeared "global" / changeable by "other people":** not a
  bug, but a real Discord limitation - presence (Online/DND/...) belongs to
  the bot's ONE gateway connection and is identical across ALL servers at
  once; Discord doesn't offer per-server separation for this. Since
  `/bot-status` used to be open to every server's administrator, that meant
  an administrator of ANY server the bot is in could change the status on
  EVERY OTHER server - exactly what looked like "other people can affect
  this". Fixed: `/bot-status` is now **exclusively** for the bot owner (like
  `/bstatnow`) - the one person already responsible for the bot everywhere
  it runs. A genuine per-server separation of presence isn't possible via
  the Discord API, no matter the code.
- **Full English translation:** every user-facing string (command/option
  descriptions, embeds, replies, error messages) and every code comment/log
  message across all 28 files is now in English.

## 5. `/bot-status` - expanded (new subcommands)

`/bot-status` (bot owner only) now has five subcommands instead of a single
choice list:
- `view` - shows the current status, who last changed it, and a short
  change history (up to 5 recent entries).
- `set` - sets the online status (online/idle/dnd/invisible) and, in the
  same call, an optional custom activity (Playing/Watching/Listening + text).
- `streaming` - switches to Twitch streaming (defaults to the configured
  name, `TWITCH_NAME` in `.env`, currently `0tylxrrrr`).
- `clear-activity` - keeps the current status but removes any custom
  activity/streaming link.
- `auto` - switches back to automatic mode (shows the current server count).

`/bstatnow` (superuser ID only) keeps its own, separate set of subcommands
(`config`, `set-status`, `streaming`, `activity`, `auto`) as before, per the
original brief that this one specific ID must be able to configure presence
directly.

## 6. New features (this round)

### `/ticket-panel` no longer shows "used /ticket-panel" publicly
Discord's ephemeral responses hide the entire interaction notice (not just
the reply content) from everyone except the person who ran the command.
`/ticket-panel` (and the new `/apply-panel`, see below) now reply
ephemerally with a short confirmation, then post the actual panel as a
plain channel message - so it looks exactly like a normal bot post, with no
visible "@user used /command" trace for anyone else.

### Applications ("apply") system
A full application/recruitment flow, entirely new:
- `/apply-config` (admin) configures up to 5 application types (e.g.
  Developer/Moderator/Administrator) - `add-type`, `remove-type`,
  `add-question`/`remove-question` (up to 15 questions per type, asked in
  order), `set-role` (an optional role granted automatically on acceptance),
  `set-review-channel` (where submissions are posted), and `list`. The
  `type` option has autocomplete, so you don't have to retype exact names.
- `/apply-panel` (admin) posts a panel with one button per configured type
  (ephemeral confirmation + plain channel message, see above).
- Clicking a button DMs the applicant the first question; each reply in
  that DM is recorded and the next question follows, until all are
  answered. The bot then DMs "Your application will be reviewed as soon as
  possible" and posts the full Q&A as an embed with **Accept**/**Deny**
  buttons in the review channel.
- Only moderators/admins can press Accept/Deny. Doing so edits the embed to
  show the decision and reviewer, DMs the applicant the result, and (on
  acceptance) grants the configured role if one was set. Everything is
  logged to the log channel.
- Submitted applications are saved to `data.json` and survive a restart;
  an **in-progress** interview (questions asked but not yet all answered)
  lives only in memory and is lost on restart, the same trade-off as
  `/remindme`. An abandoned interview also auto-cancels after 30 minutes of
  inactivity, with a DM saying so.
- Needs the (non-privileged) `DirectMessages` gateway intent to receive the
  applicant's DM replies - already added in `index.js`, no Developer Portal
  toggle required. DM content is available regardless of the privileged
  Message Content Intent (that one only restricts guild messages), so this
  works under every intent fallback plan.

### `/suggest` reworked into a prompt-and-collect flow
Running `/suggest` (no options anymore) replies ephemerally asking "What do
you want to suggest?" - your next message in that channel (within 5
minutes) is captured, forwarded as an embed to the channel configured via
`/config suggest`, and then deleted (keeping the channel clean, since it
was just a prompt/response exchange). You get a DM confirming "Your
suggestion has been sent!". A DM-based prompt/answer couldn't satisfy the
"delete the message afterward" part of the request - bots have no
permission to delete messages other users sent in a DM - so this uses an
in-channel exchange instead, where deleting is possible.

### `/config suggest`
A small, separate settings command (as requested, distinct from
`/settings`) that sets the channel `/suggest` posts to. Built as its own
command/file so more `/config <topic>` subcommands can be added later
without growing `/settings`.

### Welcome DM text updated
The default DM sent to new members is now: *"Hello {user}, enjoy your time
on **{server}**! Be respectful and nice!"* - matching the wording you asked
for. The public channel message's default was already exactly *"Welcome to
the Server {user}! You are Member Number {number}"* and is unchanged.
`{user}` renders as an `@mention`, which is what actually displays as
"@username" in Discord's client.

## v7.5.2 - which bot is actually answering?

The sentence "An error occurred while running this action." no longer exists anywhere in the code from v7.5.1 on.
If you still see it, the bot answering you is running OLD code (not updated/redeployed, or a second old copy using
the same token). Check: `/botinfo` -> "Bot version" must say 7.5.2 (the console banner says it too).
- **Hosted from GitHub/Railway/Replit/...?** Replacing files on your PC changes nothing there - commit/push the new
  files and redeploy/restart on the host.
- **Second copy?** Both copies receive every command. v7.5.2 detects it (its answer is rejected as "already
  acknowledged"), prints a loud console warning, follows up to the bot owner and DMs the owner once per hour.
  Sure way to kill every hidden copy: Developer Portal -> Bot -> Reset Token, then put the new token only into
  the one place where the bot should run.
- A leftover `bot.lock` naming the bot's own PID (common after a hard restart in containers) used to make the bot
  refuse to start - then EVERY command shows "The application did not respond". Fixed.

## v7.5.1 - no more "did not respond" / "An error occurred"

**Cause:** Discord requires a first answer within 3 seconds. `/kick`, `/ban`, `/timeout`, `/warn` (DM + API call),
`/clear`, `/lock`, `/unlock`, `/serverinfo`, `/say` and the application button (DM) did their slow work BEFORE
replying. Over 3 seconds the interaction expired, the later reply failed ("Unknown interaction") and the user saw
"The application did not respond" or the generic error text.

**Fix (`interaction-guard.js`, used for every slash command in `index.js`):**
- If a command has not answered after 1.5 s, the bot answers for it ("thinking..." state). The command keeps
  running; its reply then replaces that message. A *public* reply (e.g. the kick confirmation) is posted publicly
  below a short private "Done". Fast commands behave exactly as before.
- Expired or double-answered interactions are only logged in the console, never shown to users. If that console
  line appears for EVERY command, the same bot token is running twice (e.g. host + your PC) - stop the extra copy.
- Real errors now say what is wrong (missing permission, DMs closed, deleted channel/role, ...) instead of a
  generic text, and are still written to the console and the log channel.
- The application button now acknowledges first and sends the DM afterwards.

## v7.5 - MacRumors feed, DM tickets, /settings panel

### MacRumors news (`/config macrumors [channel]`)
Moderators and administrators pick a text channel; leave `channel` empty to turn it off. The bot reads the
official feed (`https://feeds.macrumors.com/MacRumors-All`) every 10 minutes and posts every NEW article as
an embed (title, link, ~700-character excerpt, image). New articles are recognised by their GUID, not by the
publication date (MacRumors' feed has had wrong dates before); the last 200 IDs are stored in `data.json`.
On the very first start the current feed is only remembered, so nothing floods your channels; setting a
channel posts the newest article once as a test. Optional `.env`: `MACRUMORS_FEED_URL`,
`MACRUMORS_INTERVAL_MIN` (minimum 2). Code: `macrumors.js`.

### Tickets without channels (`ticket-runtime.js`)
1. `/ticket` (or the panel button, or `!support`) - the answer is ephemeral, so nothing stays visible in the
   channel. (Discord does not let bots delete slash-command invocations; ephemeral replies are the equivalent.)
2. The bot DMs: "What do you need help with? Type /ticket-close to close this ticket".
3. The user's next DM is the whole ticket: text and files are forwarded as ONE message to the ticket channel,
   the ticket role is pinged, and the user gets "We informed our Staff! Help is in the Way!".
4. `/ticket-close` (slash command or plain text) in the DM answers "Cancelled Ticket".

Ticket or something else? A DM only counts as a ticket if that user has an open ticket session (stored in
`data.json`, valid for 30 minutes, survives restarts). Every other DM goes to the application interview
handler. A user cannot have both open at once (both start paths check each other). Files are re-uploaded
(Discord DM links expire); files over the server's upload limit are linked instead.
`!support <text>` sends a ticket directly (the message is deleted, needs Manage Messages).
Old ticket channels from earlier versions keep their working "Close Ticket" button.

### `/settings` is now one panel
`/settings` opens a private panel: pick a setting from the menu, then pick the role/channel from Discord's own
selector. Settings: administrator role, moderator role, ticket role, ticket channel, log channel, suggestions
channel, XP leaderboard channel, MacRumors channel, application review channel, welcome channel/role/DM.
The old subcommands (`/settings admin-role`, `/settings log-channel`, ...) are gone; the ticket category
setting is no longer used. Everything is logged to the log channel like before.

## 7. Implemented points (brief, items 1-17)

### 2) Welcome system
`/welcome-setup` (admin) with `role`, `channel`, `dm`, custom `message`/
`dm-message` text (placeholders `{user} {username} {server} {number}`), and
`reset`. Stored strictly per server. A default text is provided. On join it
automatically grants the role, posts the message, optionally sends a DM, and
logs to the log channel - all fault-tolerant (missing permissions/role
above the bot's own role, etc. are caught and noted in the console/log
channel, never crashing the bot). Greets bots too (see section 4).

### 3) Central permissions
See `permissions.js` above. Every mod/admin command now only declares its
required level in `commands.js`; the check (including rank-vs-rank for
moderation actions, so a moderator can't ban an admin) runs centrally.
Missing permission -> ephemeral error message.

### 4) Slash command registration / "Unknown Command"
Auto-sync on every startup + local validation before every send (see
section 1). `/help` reads the list automatically from `commands.js` - no
command can ever be "forgotten".

### 5) AutoMod badge
`/automod setup` creates the 5 possible standard rules via the **Discord
AutoMod API** - at most 10 rules per server (Discord's limit), now always
starting from a clean slate (see section 4). `/automod status` additionally
shows the bot owner the real progress toward the "Uses AutoMod" badge: per
Discord's developer help center, it needs **at least 100 self-created
AutoMod rules across all servers** - the "100 / 12 rules" math from the
original brief is NOT the official basis and was deliberately not used. With
e.g. 9 servers and a max of 10 rules/server, at most 90 rules are possible -
not enough for 100, regardless of the code. `/automod status` shows this
live (bot owner only) and explains the minimum number of servers needed.

### 6) Removed: Spotify & developer commands; `/uptime` reset; usable without an invite
- `commands-dev.js`, `commands-spotify.js`, `spotify.js` deleted; stored
  Spotify tokens are automatically dropped from `data.json` on first save
  (migration, no manual step needed).
- `/uptime` now measures **process** uptime (`config.js`,
  `PROCESS_STARTED_AT`) instead of connection time - guaranteed to start at 0
  whenever the bot **process** restarts (bot restart or host power cycle).
- User install enabled (see section 2, "Installation Contexts") - most
  commands work without inviting the bot to a server (exceptions:
  anything that inherently needs a server, e.g. moderation, welcome, XP).

### 8) `/help`
Generated automatically from the list of commands that actually exist at startup (`commands.js`),
grouped into categories (General, Moderation, Administration, Welcome, Applications, Tickets,
Reports, Rules, Partners, Giveaways, Utility, Bot, AI, Bot owner) with a drop-down to switch between
them (`menus.js`). A removed command disappears from here automatically; a new one just needs its
category set in `commands.js`.

### 9) Restarting the bot
`/adm-reload` and `/console restart` (both bot owner only) fully restart the process:
they reply immediately, then exit after 3 seconds. Node can't replace its own running code, so this
only comes back online automatically with a process manager that auto-restarts it (see section 12) -
without one, start it again yourself after the exit. `/reload` (bot owner) only reloads the `.env`,
without a restart.

### 10) Bot status with server count
Runs automatically in the background (`presence.js`): shows "👀 X servers"
by default, refreshes immediately on join/leave and otherwise sparingly
every 10 minutes (no unnecessary API calls). The bot owner can switch to
manual mode and set status/activity/streaming with `/bot-status`
(`/bot-status auto` switches back to the automatic server-count mode).

**Naming conflict resolved:** the bot already had an existing `/status`
command ("checks whether the website is reachable") - per the brief, that
was NOT removed without an explicit request. The new presence command is
therefore called **`/bot-status`** (see section 5 for its full feature set).

### 11) `/bot-status`
See section 5 above for its subcommands. Twitch mode always uses the
centrally configured name `0tylxrrrr` (`config.js`, overridable via
`.env`/`TWITCH_NAME`, not duplicated across the code).

**Honest technical limitation:** Discord presence (online dot, activity)
belongs to the **bot account itself** and is therefore identical across
**all** servers at once - Discord provides no way to show it differently
per server. "Configurable per server" is implemented so that the most
recently chosen setting by any authorized user applies bot-wide (with a
note of who/where it was set) - a true per-server separation isn't possible
via the Discord API. Access is restricted to the bot owner (see section 4)
so this power isn't spread across every server's administrators.

### 12) Bot logs
`/settings log-channel` (admin, stored per server). Logged events: kick/ban/
timeout/warn/clear/nickname changes, role add/remove, slowmode/lock/unlock,
`/say` usage, tickets created/closed, members joining, setting changes
(admin/mod role, log channel), bot restarts, XP level-ups, and interaction
errors. **Never** logs tokens/API keys (`logging.js` only ever sends the
harmless fields passed in to it).

### 13) Duplicate/old commands removed
Every command now runs through the one registry `commands.js` - a built-in
check (in `commands.js`, on load) throws a clear error if a name is ever
duplicated again, instead of letting Discord silently register two
conflicting definitions. Old, UUID-style test commands from earlier
versions are no longer part of the registry and get removed at Discord
automatically on the first auto-sync (`clearStaleGuildCommands`/diff
against the global list).

### 14) XP/level system - removed in v7.6.0

The XP system (`xp.js`, `xp-runtime.js`, `commands-xp.js`) no longer exists.

### 15) Database/server isolation
All server settings live under `guilds[guildId]`, all giveaways under
`giveaways[guildId][id]` - one server structurally cannot affect another
server's values. The global leaderboard is built purely by reading and
aggregating these separate per-server datasets (`storage.getGlobalLeaderboard`),
never changing a single server's values.

## 8. Command overview

| Category | Commands |
|---|---|
| General | `/uptime` `/status` `/changelog` (menu) `/botinfo` `/stats` `/tos` `/privacy-policy` `/ping` `/help` (menu) |
| AI | `/ask question\|reset`, `/code language info` (everyone; generated file is sent by DM) + @mentions + individual DM replies |
| Bot owner only | `/adm-reload` `/console info\|cache\|eval\|restart` `/config bot-logs` |
| Moderation (mod+) | `/kick` `/ban` `/timeout` `/warn` `/clear` `/slowmode` `/lock` `/unlock` `/nickname` `/role` `/purge-user` `/say` |
| Administration (admin) | `/settings` (panel) `/config suggest` `/config macrumors` (mod+) `/config github` `/github-check add\|list\|remove` (mod+) `/automod-words` `/automod setup\|status\|remove` |
| Bot owner/superuser | `/reload` (owner) `/bot-status` (owner) `/automod setup-all` (owner) |
| Welcome | `/welcome-setup` |
| Applications | `/apply-config` (admin) `/apply-panel` (admin) (+ apply/Accept/Deny buttons) |
| Tickets | `/ticket` (everyone) `/ticket-close` (everyone, works in DMs) |
| Giveaways (mod+) | `/giveaway create\|end\|reroll\|cancel\|list` |
| Reports | `/report` (everyone) + moderator panel buttons |
| Rules | `/rules view` (everyone) `/rules edit\|post\|status` (admin) + Accept button |
| Partners | `/partner request\|list` (everyone) `/partner remove` (admin) + Accept/Deny buttons |
| Utility/fun | `/userinfo` `/serverinfo` `/avatar` `/poll` `/suggest` `/membercount` `/roleinfo` |
| Text command | `!support [request]` (same system as `/ticket`) |

## 9. Required dependencies

```json
"discord.js": "^14.16.3",
"dotenv": "^16.4.5"
```
Nothing else - no database drivers, no extra packages.

## 10. Required `.env` variables

See `.env.template` (a copyable starting point). Only `DISCORD_TOKEN` is
required; everything else has a sensible default or is optional.
New optional variables: `GITHUB_REPO`, `GITHUB_TOKEN`, `GITHUB_INTERVAL_MIN`, `STATS_TIMEZONE`, `TOS_URL`, `PRIVACY_URL`.

## 11. Database

A single `data.json` file in the folder (created automatically on first
start, listed in `.gitignore`). Contains: `guilds` (per-server settings),
`warns`, `giveaways`, `reports`, `partners`, `rules`, `meta` (incl. usage statistics and the DM privacy-notice flag) (incl. the usage statistics) (incl. the command hash for auto-sync,
presence configuration). Writes atomically and automatically backs up the
file if it's ever corrupted (`data.json.corrupt-*`) instead of losing data.

## 12. How to start the bot

```bash
npm install
npm start          # equivalent to: node --max-old-space-size=1536 index.js
```

For an automatic restart (e.g. after a crash), use a process manager, e.g. PM2:

```bash
npm install -g pm2
pm2 start index.js --name tylxrrrr-bot --max-memory-restart 1536M
```

## 13. Known limitations (technically justified, see details above)

- Bot presence is identical across every server at once (sections 5/10/11).
- A server invite that's "permanent forever" can't be guaranteed, only the
  technically best available one (`max_age: 0`) (section 14).
- The "Uses AutoMod" badge depends on Discord itself (at least 100 rules
  across all servers) - the bot can create the prerequisite (`/automod
  setup` or `/automod setup-all` on every server), but granting the badge
  itself is entirely up to Discord.
- If the privileged intents (Developer Portal) are missing, the welcome
  system and `!support` start automatically disabled instead of blocking
  the bot from starting - and `/welcome-setup` warns about this directly.
- An in-progress application interview (some but not all questions
  answered) lives only in memory and is lost on a bot restart - a
  submitted/completed application is always saved and survives restarts.
- `/suggest`'s "reply within 5 minutes" step is a live Discord message
  collector - it does not survive a bot restart either, the same trade-off
  as `/remindme`.

## 14. Tests performed

- Every `.js` file checked with `node --check` for syntax errors.
- The complete command registry (`commands.js`) loaded offline against a
  Discord API simulation: every command (including `/apply-config`,
  `/apply-panel`, `/config`) serializes to JSON without errors, no duplicate
  names, no invalid (upper/lowercase) names, and autocomplete is correctly
  attached to `/apply-config`.
- `command-tools.validatePayload` ran against the real, complete payload:
  0 errors.
- The full `index.js` startup path (requires, client construction with the
  new `DirectMessages` intent, event wiring) was run end-to-end against a
  Discord API simulation up to the actual `login()` call (which can't be
  tested without real network access here).
- **The application system's DM interview was simulated end-to-end**:
  starting an application, answering both configured questions via
  simulated DM messages, and confirming the bot sends the next question
  each time and finally posts the completed application (as an embed with
  Accept/Deny buttons) to the review channel.
- `storage.js`'s new application functions (`addApplication`,
  `getApplication`, `updateApplication`, `getApplyTypes`/`setApplyTypes`)
  were verified with test data, including status updates.
- **`/automod setup`'s reset-then-create flow was tested against a mock
  that enforces Discord's real per-type rule limits**, reproducing the
  exact reported scenario (all 5 rule types already at their maximum, from
  rules with foreign names/creators): result is now 10/10 rules removed,
  all 5 standard rules created, 0 errors. `/automod setup-all` was verified
  across three simulated servers in different states (existing rules, no
  rules, different rule types) - all three processed correctly.
- The XP/level curve was worked out with simulated messages (level 1 costs
  exactly 15 XP, then increases linearly, milestone levels detected correctly).
- `storage.js` functions (leaderboards, server separation) verified with
  test data across multiple servers/users.

**Not possible in this environment:** an actual login to Discord (no
network access here) - please run `npm run deploy` and `npm start` once on
your end and let me know if anything still comes up.
