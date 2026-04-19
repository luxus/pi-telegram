# Telegram Bridge Architecture

## Overview

`pi-telegram` is a session-local pi extension that binds one Telegram DM to one running pi session. The bridge owns four main responsibilities:

- Poll Telegram updates and enforce single-user pairing
- Translate Telegram messages and media into pi inputs
- Stream and deliver pi responses back to Telegram
- Manage Telegram-specific controls such as queue reactions, `/status`, `/model`, and `/compact`

## Runtime Structure

`index.ts` remains the extension entrypoint and composition layer. Reusable runtime logic is split into flat domain files under `/lib` rather than into a deep local module tree.

Domain grouping rule: prefer cohesive domain files over atomizing every helper into its own file. A `shared` domain is allowed only for types or constants that genuinely span multiple bridge domains.

Naming rule: because the repository already scopes this codebase to Telegram, extracted module and test filenames use bare domain names such as `api.ts`, `queue.ts`, `updates.ts`, and `queue.test.ts` rather than repeating `telegram-*` in every filename.

Current runtime areas include:

- Telegram API types and local bridge state in `index.ts`
- Queueing and queue-runtime helpers in `/lib/queue.ts`
- Reply, preview, preview-finalization, reply-transport, and rendered-message delivery helpers in `/lib/replies.ts`
- Polling request, stop-condition, and long-poll loop helpers in `/lib/polling.ts`
- Telegram API/config helpers and lazy bot-token client wrappers in `/lib/api.ts`
- Telegram turn-building helpers in `/lib/turns.ts`
- Telegram media/text extraction helpers in `/lib/media.ts`
- Telegram updates extraction, authorization, flow, execution-planning, direct execute-from-update routing, and runtime helpers in `/lib/updates.ts`
- Telegram attachment queueing and delivery helpers in `/lib/attachments.ts`
- Telegram tool, command, and lifecycle-hook registration helpers in `/lib/registration.ts`
- Setup/token prompt helpers in `/lib/setup.ts`
- Markdown and Telegram message rendering helpers in `/lib/rendering.ts`
- Status rendering helpers in `/lib/status.ts`
- Menu/model-resolution, menu-state construction, pure menu-page derivation, pure menu render-payload builders, menu-message runtime, callback parsing, callback entry handling, callback mutation helpers, full model-callback planning and execution, interface-polished callback effect ports, status-thinking callback handling, and UI helpers in `/lib/menu.ts`
- Model-switch guard, continuation, and restart helpers in `/lib/model-switch.ts`
- Telegram API-bound reply transport wiring and broader event-side orchestration in `index.ts`
- Additional domains can be extracted into `/lib/*.ts` as the bridge grows, while keeping `index.ts` as the single entrypoint
- Mirrored domain regression coverage lives in `/tests/*.test.ts` using the same bare domain naming scheme

## Configuration UX

`/telegram-setup` uses a progressive-enhancement flow for the bot token prompt:

1. Show the locally saved token from `~/.pi/agent/telegram.json` when one already exists
2. Otherwise use the first configured environment variable from the supported Telegram token list
3. Fall back to the example placeholder when no real value exists

Because `ctx.ui.input()` only exposes placeholder text, the bridge uses `ctx.ui.editor()` whenever a real default value must appear already filled in.

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

Queued items now use two explicit dimensions:

- `kind`: prompt vs control
- `queueLane`: control vs priority vs default

This lets synthetic control actions and Telegram prompts share one stable ordering model while still rendering distinctly in status output. In the pi status bar queue preview, priority prompts are marked with `⬆` while control items keep their own control-specific summary markers such as `⚡`.

A dispatched prompt remains in the queue until `agent_start` consumes it. That keeps the active Telegram turn bound correctly for previews, attachments, abort handling, and final reply delivery.

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
- Markdown tables should keep their internal separators but drop the outer left and right borders when rendered as monospace blocks so narrow Telegram clients keep more usable width
- Unordered Markdown lists should render with a monospace `-` marker and ordered Markdown lists should render with monospace numeric markers so list indentation stays more predictable on narrow Telegram clients
- Real Markdown task-list items should render with checkbox markers, while standalone `[x]` and `[ ]` prose should stay literal instead of being reinterpreted as checklists
- Nested Markdown quotes should flatten into one Telegram blockquote with added non-breaking-space indentation because Telegram does not render nested blockquotes reliably
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

- `/status` for model, usage, cost, and context visibility, queued as a high-priority control item when needed
- Inline status buttons for model and thinking adjustments, applying idle selections immediately while still respecting busy-run restart rules
- `/model` for interactive model selection, queued as a high-priority control item when needed and supporting in-flight restart of the active Telegram-owned run on a newly selected model
- `/compact` for Telegram-triggered pi session compaction when the bridge is idle
- Queue reactions using `👍` and `👎`, with `👎` acting as the canonical queue-removal path because ordinary Telegram DM message deletions are not exposed through the Bot API polling path this bridge uses

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
