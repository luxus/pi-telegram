# Telegram Bridge Architecture

## Overview

`pi-telegram` is a session-local pi extension that binds one Telegram DM to one running pi session. The bridge owns four main responsibilities:

- Poll Telegram updates and enforce single-user pairing
- Translate Telegram messages and media into pi inputs
- Stream and deliver pi responses back to Telegram
- Manage Telegram-specific controls such as queue reactions, `/status`, `/model`, and `/compact`

## Runtime Structure

The implementation currently lives in `index.ts` and is organized by logical sections rather than physical modules.

Main runtime areas:

- Telegram API types and local bridge state
- Generic utilities and Markdown/rendering helpers
- Message delivery, previews, and attachment sending
- Interactive model/status menu state and callback handling
- Queue management for pending and active Telegram turns
- Polling loop and pi lifecycle-hook integration

## Message And Queue Flow

### Inbound Path

1. Telegram updates are polled through `getUpdates`
2. The bridge filters to the paired private user
3. Media groups are coalesced into a single Telegram turn when needed
4. Files are downloaded into `~/.pi/agent/tmp/telegram`
5. A `PendingTelegramTurn` is created and queued locally
6. The queue dispatcher sends the turn into pi only when dispatch is safe

### Queue Safety Model

The bridge keeps its own Telegram queue and does not rely only on pi's internal pending-message state.

Dispatch is gated by:

- No active Telegram turn
- No pending Telegram dispatch already sent to pi
- No compaction in progress
- `ctx.isIdle()` being true
- `ctx.hasPendingMessages()` being false

This prevents queue races around rapid follow-ups, `/compact`, and mixed local plus Telegram activity.

### Abort Behavior

When `/stop` aborts an active Telegram turn, queued follow-up Telegram messages can be preserved as prior-user history for the next turn. This keeps later Telegram input from being silently dropped after an interrupted run.

## Rendering Model

Telegram replies are rendered as Telegram HTML rather than raw Markdown.

Key rules:

- Rich text should render cleanly in Telegram chats
- Real code blocks must remain literal and escaped
- Long replies must be split below Telegram's 4096-character limit
- Chunking should avoid breaking HTML structure where possible
- Preview rendering is intentionally simpler than final rich rendering

The renderer is a Telegram-specific formatter, not a general Markdown engine, so rendering changes should be treated as regression-prone.

## Streaming And Delivery

During generation, the bridge streams previews back to Telegram.

Preferred order:

1. Try `sendMessageDraft`
2. Fall back to `sendMessage` plus `editMessageText`
3. Replace the preview with the final rendered reply when generation ends

Outbound files are sent only after the active Telegram turn completes and must be staged through the `telegram_attach` tool.

## Interactive Controls

The bridge exposes Telegram-side session controls in addition to regular chat forwarding.

Current operator controls include:

- `/status` for model, usage, cost, and context visibility
- Inline status buttons for model and thinking adjustments
- `/model` for interactive model selection, including in-flight restart of the active Telegram-owned run on a newly selected model
- `/compact` for Telegram-triggered pi session compaction when the bridge is idle
- Queue reactions using `👍` and `👎`

## In-Flight Model Switching

When `/model` is used during an active Telegram-owned run, the bridge can emulate the interactive pi workflow of stopping, switching model, and continuing.

The current implementation does this by:

1. Applying the newly selected model immediately
2. Queuing or staging a synthetic Telegram continuation turn
3. Aborting the active Telegram turn immediately, or delaying the abort until the current tool finishes when a tool call is in flight
4. Dispatching the continuation turn after the abort completes

This behavior is intentionally limited to runs currently owned by the Telegram bridge. If pi is busy with non-Telegram work, the bridge still refuses the switch instead of hijacking unrelated session activity.

## Related

- [README.md](../README.md)
- [Project Context](../AGENTS.md)
- [Project Backlog](../BACKLOG.md)
- [Changelog](../CHANGELOG.md)
