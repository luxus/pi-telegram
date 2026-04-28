# pi-telegram

![pi-telegram screenshot](screenshot.png)

This repository is an actively maintained fork of [`badlogic/pi-telegram`](https://github.com/badlogic/pi-telegram). It started from upstream commit [`cb34008460b6c1ca036d92322f69d87f626be0fc`](https://github.com/badlogic/pi-telegram/commit/cb34008460b6c1ca036d92322f69d87f626be0fc) and has since diverged substantially.

## Start Here

- [Project Context](./AGENTS.md)
- [Open Backlog](./BACKLOG.md)
- [Changelog](./CHANGELOG.md)
- [Documentation](./docs/README.md)

## Key Features

- **Priority Command Queue**: Control commands such as `/status` and `/model` use a high-priority control queue, so they do not get stuck behind normal queued prompts when pi is busy.
- **Interactive UI**: Manage your session directly from Telegram. Inline buttons allow you to switch models and adjust reasoning (thinking) levels on the fly.
- **In-flight Model Switching**: Change the active model mid-generation. The agent gracefully pauses, applies the new model, and restarts its response without losing context.
- **Smart Message Queue**: Messages sent while the agent is busy are queued and previewed in the pi status bar, and queued turns can be reprioritized or removed with Telegram reactions.
- **Mobile-Optimized Rendering**: Tables and lists are formatted for narrow screens, table padding accounts for emoji grapheme and wide Unicode display width, and Telegram-originated runs prompt the assistant to prefer narrow table columns for phone readability. Markdown is correctly parsed and split to fit Telegram's limits without breaking HTML structures or code blocks, block spacing stays faithful to the original Markdown with readable heading separation, supported absolute links stay clickable, and unsupported link forms degrade safely.
- **File Handling & Attachments**: Send images and files to the agent, transcribe or transform inbound files with configured attachment handlers, or ask pi to generate and return artifacts. Inbound downloads and outbound attachments are size-limited by default, and outbound files are delivered automatically via the `telegram_attach` tool.
- **Streaming Responses**: Closed Markdown blocks stream back as rich Telegram HTML while pi is generating, and the still-growing tail stays readable until the final fully rendered reply lands.

## Install

From npm:

```bash
pi install npm:@llblab/pi-telegram
```

From git:

```bash
pi install git:github.com/llblab/pi-telegram
```

## Configure

### 1. Telegram Bot

1. Open [@BotFather](https://t.me/BotFather)
2. Run `/newbot`
3. Pick a name and username
4. Copy the bot token

### 2. Configure the extension in pi

Start pi, then run:

```bash
/telegram-setup
```

Paste your bot token when prompted. If a bot token is already saved in `~/.pi/agent/telegram.json`, the setup prompt shows that stored value by default. Otherwise it prefills from the first configured environment variable in `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_KEY`, `TELEGRAM_TOKEN`, or `TELEGRAM_KEY`. The saved config file is written with private `0600` permissions.

### 3. Connect this pi session

```bash
/telegram-connect
```

The bridge is session-local: only one pi instance polls Telegram at a time. `/telegram-connect` records polling ownership in `~/.pi/agent/locks.json`; live ownership moves require confirmation, while `/new` and same-`cwd` process restarts resume automatically.

### 4. Pair your account from Telegram

1. Open the DM with your bot in Telegram
2. Send `/start`

The first user to message the bot becomes the exclusive owner of the bridge. The extension will only accept messages from this user.

## Usage

Once paired, simply chat with your bot in Telegram. All text, images, and files are forwarded to pi.

### Telegram Commands & Controls

Use these inside the Telegram DM with your bot:

- **`/start`**: Pair the first Telegram user when needed, register the bot command menu, and show help.
- **`/help`**: Show the Telegram help text.
- **`/status`**: View session stats, cost, and use inline buttons to change models.
- **`/model`**: Open the interactive model selector.
- **`/compact`**: Start session compaction (only works when the session is idle).
- **`/stop`**: Abort the active run.

Telegram command admission is explicit: `/compact`, `/stop`, `/help`, and `/start` execute immediately; `/status` and `/model` enter the high-priority control lane so they can run before normal queued prompts when pi becomes safe to dispatch.

### Pi Commands

Run these inside pi, not Telegram:

- **`/telegram-setup`**: Configure or update the Telegram bot token.
- **`/telegram-status`**: Check bridge status, connection, polling, execution, queue, and recent redacted runtime/API failure events.
- **`/telegram-connect`**: Start polling Telegram updates in the current pi session, acquire the singleton lock, or interactively move ownership here from another live instance.
- **`/telegram-disconnect`**: Stop polling in the current pi session and release the singleton lock.

### Queue, Reactions, and Media

- If you send more Telegram messages while pi is busy, they enter the default prompt queue and are processed in order.
- `👍` moves a waiting prompt into the priority prompt queue, behind control actions but ahead of default prompts. Removing `👍` sends it back to its normal queue position, and adding `👍` again gives it a fresh priority position.
- `👎` removes a waiting turn from the queue. Telegram Bot API does not expose ordinary DM message-deletion events through the polling path used here, so queue removal is bound to the dislike reaction.
- For media groups, a reaction on any message in the group applies to the whole queued turn.
- If you edit a Telegram message while it is still waiting in the queue, the queued turn is updated instead of creating a duplicate prompt. Edits after a turn has already started may not affect the active run.
- Inbound images, albums, and files are saved to `~/.pi/agent/tmp/telegram`. Unhandled local file paths are included in the prompt, handled attachment output is injected into the prompt text, and inbound images are forwarded to pi as image inputs. Inbound downloads default to a 50 MiB limit and can be adjusted with `PI_TELEGRAM_INBOUND_FILE_MAX_BYTES` or `TELEGRAM_MAX_FILE_SIZE_BYTES`.
- Queue reactions depend on Telegram delivering `message_reaction` updates for your bot and chat type.

### Inbound Attachment Handlers

`telegram.json` can define `attachmentHandlers` for common preprocessing such as voice transcription. The first matching handler runs after download and before the Telegram turn enters the pi queue.

```json
{
  "attachmentHandlers": [
    {
      "mime": "audio/*",
      "command": "/home/me/bin/transcribe {filename} ru"
    },
    {
      "type": "voice",
      "tool": "transcribe_groq",
      "args": { "lang": "ru" }
    }
  ]
}
```

Matching supports `mime`, `type`, or `match`; wildcards like `audio/*` are accepted. Command placeholders are substituted as argv, not shell text: `{filename}` and `{path}` are the downloaded file path, `{basename}` is the display filename, `{mime}` is the MIME type, and `{type}` is the Telegram attachment type. Tool handlers invoke a locally available tool by name, for example `transcribe_groq`; how that tool is provided is outside pi-telegram. Local attachments stay in the prompt under `[attachments] <directory>` with relative file entries; successful handler stdout is added under `[outputs]`; failed or empty handlers simply produce no output block.

### Requesting Files

If you ask pi for a file or generated artifact (e.g., _"generate a shell script and attach it"_), pi will call the `telegram_attach` tool, and the extension will send the file alongside its next Telegram reply. Outbound attachments default to a 50 MiB limit and can be adjusted with `PI_TELEGRAM_OUTBOUND_ATTACHMENT_MAX_BYTES` or `TELEGRAM_MAX_ATTACHMENT_SIZE_BYTES`.

## Streaming

The extension streams assistant previews back to Telegram while pi is generating.

Rich previews are sent through editable messages because Telegram drafts are text-only. Closed top-level Markdown blocks can appear with formatting before the answer finishes, while the still-growing tail remains conservative and readable until the preview is replaced with the fully rendered Telegram HTML reply. Editable preview messages are also attached as replies to the source Telegram prompt when possible.

## Status bar

The pi status bar shows queued Telegram turns as compact previews, for example:

```text
+3: [⬆ write a shell script…, summarize this image…, 📎 2 attachments]
```

## Notes

- Replies to Telegram prompts are sent as Telegram replies to the source message when possible; if the source message is unavailable, delivery falls back to a normal message
- Long replies are split below Telegram's 4096 character limit without intentionally breaking Telegram HTML formatting; only the first split message is attached as a Telegram reply to the source prompt
- Temporary inbound Telegram files are cleaned up on later session starts

## License

MIT
