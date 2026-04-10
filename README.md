# pi-telegram

![pi-telegram screenshot](screenshot.png)

> Full pi build session: [View the session transcript](https://pi.dev/session/#14acfe07b7844c8abec55ed9fbddc17f), which captures the full pi session in which `pi-telegram` was built.

Telegram DM bridge for pi.

This repository is a fork of the original [`badlogic/pi-telegram`](https://github.com/badlogic/pi-telegram).
It started from upstream commit [`cb34008460b6c1ca036d92322f69d87f626be0fc`](https://github.com/badlogic/pi-telegram/commit/cb34008460b6c1ca036d92322f69d87f626be0fc) and has since diverged substantially.

## Start Here

- [Project Context](./AGENTS.md)
- [Open Backlog](./BACKLOG.md)
- [Changelog](./CHANGELOG.md)
- [Documentation](./docs/README.md)

## What Changed In This Fork

Compared to upstream commit `cb34008`, this fork significantly extends and hardens the extension.

- Better Telegram control UI, including an improved `/status` view with inline buttons for model and thinking selection
- Interactive model selection improvements, including scoped model lists, thinking-level control for reasoning-capable models, and in-flight restart on a newly selected model for active Telegram-owned runs
- Queueing and interaction upgrades, including queue previews, reaction-based prioritization/removal, media-group handling, and safer dispatch behavior
- Markdown and reply rendering improvements, with richer formatting support and multiple fixes for incorrect Telegram rendering and chunking edge cases
- Streaming, attachment, and delivery workflow hardening, including more robust preview updates and file handling
- General runtime polish, bug fixes, and refactors across pairing, command handling, and Telegram session behavior

In short: this fork is no longer just a repackaged copy of upstream; it is a feature-expanded and bug-fixed Telegram frontend for pi.

## Install

From git:

```bash
pi install git:github.com/llblab/pi-telegram
```

Or for a single run:

```bash
pi -e git:github.com/llblab/pi-telegram
```

## Configure

### Telegram

1. Open [@BotFather](https://t.me/BotFather)
2. Run `/newbot`
3. Pick a name and username
4. Copy the bot token

### pi

Start pi, then run:

```bash
/telegram-setup
```

Paste the bot token when prompted.
If a bot token is already saved in `~/.pi/agent/telegram.json`, `/telegram-setup` shows that stored value by default. Otherwise it pre-fills from the first configured environment variable in `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_KEY`, `TELEGRAM_TOKEN`, or `TELEGRAM_KEY`.

The extension stores config in:

```text
~/.pi/agent/telegram.json
```

## Connect a pi session

The Telegram bridge is session-local. Connect it only in the pi session that should own the bot:

```bash
/telegram-connect
```

To stop polling in the current session:

```bash
/telegram-disconnect
```

Check status:

```bash
/telegram-status
```

## Pair your Telegram account

After token setup and `/telegram-connect`:

1. Open the DM with your bot in Telegram
2. Send `/start`

The first DM user becomes the allowed Telegram user for the bridge. The extension only accepts messages from that user.

## Usage

Chat with your bot in Telegram DMs.

Additional fork-specific controls:

- `/status` now has a richer view with inline buttons for model and thinking controls
- `/model` opens the interactive model selector and can restart the active Telegram-owned run on the newly selected model, waiting for the current tool call to finish when needed
- `/compact` starts session compaction when pi and the Telegram queue are idle
- Queue reactions: `👍` prioritizes a waiting turn, `👎` removes it

### Send text

Send any message in the bot DM. It is forwarded into pi with a `[telegram]` prefix.

### Send images and files

Send images, albums, or files in the DM.

The extension:

- downloads them to `~/.pi/agent/tmp/telegram`
- includes local file paths in the prompt
- forwards inbound images as image inputs to pi

### Ask for files back

If you ask pi for a file or generated artifact, pi should call the `telegram_attach` tool. The extension then sends those files with the next Telegram reply.

Examples:

- `summarize this image`
- `read this README and summarize it`
- `write me a markdown file with the plan and send it back`
- `generate a shell script and attach it`

### Stop a run

In Telegram, send:

```text
stop
```

or:

```text
/stop
```

That aborts the active pi turn.

### Queue follow-ups

If you send more Telegram messages while pi is busy, they are queued and processed in order.

The pi status bar shows queued Telegram turns as compact previews, for example:

```text
+3: [summarize this image…, write a shell script…, 📎 2 attachments]
```

Each preview is limited to at most 5 words or 40 characters.

### Reprioritize or discard queued messages

While a message is still waiting in the queue:

- React with 👍 to move it into the priority block
- React with 👎 to remove it from the queue

Priority is stable:

- The first liked queued message stays ahead of later liked messages
- Removing 👍 sends the message back to its normal queue position
- Adding 👍 again gives it a fresh priority position

For media groups, a reaction on any message in the group applies to the whole queued turn.

Message reactions depend on Telegram delivering `message_reaction` updates for your bot and chat type.

## Streaming

The extension streams assistant text previews back to Telegram while pi is generating.

It tries Telegram draft streaming first with `sendMessageDraft`. If that is not supported for your bot, it falls back to `sendMessage` plus `editMessageText`.

## Notes

- Only one pi session should be connected to the bot at a time
- Replies are sent as normal Telegram messages, not quote-replies
- Long replies are split below Telegram's 4096 character limit
- Outbound files are sent via `telegram_attach`

## License

MIT
