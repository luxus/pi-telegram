# Telegram Bridge Architecture

## Overview

`pi-telegram` is a session-local pi extension that binds one Telegram DM to one running pi session. The bridge owns four main responsibilities:

- Poll Telegram updates and enforce single-user pairing
- Translate Telegram messages and media into pi inputs
- Stream and deliver pi responses back to Telegram
- Manage Telegram-specific controls such as queue reactions, `/status`, `/model`, `/compact`, and `/stop`

## Runtime Structure

`index.ts` remains the extension entrypoint and composition root. Reusable runtime logic is split into flat domain files under `/lib` rather than into a deep local module tree.

Architecture shorthand: this repository uses a `Flat Domain DAG`: cohesive bridge domains live as flat `/lib/*.ts` modules, local imports must form a directed acyclic graph, shared buckets are avoided, and `index.ts` wires live pi/Telegram ports plus session state.

Domain grouping rule: prefer cohesive domain files over atomizing every helper into its own file. A `shared` domain is allowed only for types or constants that genuinely span multiple bridge domains.

Interface consistency rule: when two modules mean the same runtime entity, they should converge on the owning domain's exported contract. Local structural `*Like` or view contracts are appropriate only when a domain intentionally needs a narrow projection to avoid unnecessary coupling; they should not become duplicate source-of-truth shapes for the same entity.

Naming rule: because the repository already scopes this codebase to Telegram, extracted module and test filenames use bare domain names such as `api.ts`, `queue.ts`, `updates.ts`, and `queue.test.ts` rather than repeating `telegram-*` in every filename.

Current runtime areas include:

- Telegram Bot API concrete transport shapes live with Telegram API helpers in `/lib/api.ts`, while persisted bot/session pairing state lives in `/lib/config.ts`; domain-owned runtime state types stay with their owners, such as queued/active turn state in `/lib/queue.ts` and preview state in `/lib/preview.ts`, while domain helpers prefer local structural `*Like` contracts instead of importing concrete wire DTOs
- Direct pi SDK imports are centralized in `/lib/pi.ts`, which exposes concrete pi SDK type exports, bound extension API runtime ports, and narrow bridge-facing helpers such as settings-manager creation plus context model/idle/pending-message/compaction adapters; `index.ts` uses this adapter namespace instead of importing `@mariozechner/pi-coding-agent` directly
- Session-local runtime primitives such as queue/control/priority ordering counters, lifecycle/dispatch flags, setup guard state, abort-handler storage/binding, typing-loop timer lifecycle, typing-loop starter binding, prompt-dispatch lifecycle/runtime adapters, and agent-end reset sequencing in `/lib/runtime.ts`; the runtime domain's essence is mutable cross-domain session coordination rather than business behavior. It exposes a grouped bridge runtime facade with named queue/lifecycle/setup/abort/typing ports that bind those primitives to one session state while remaining a cohesive state/runtime boundary, and `index.ts` still wires live Telegram API calls and status updates into those helpers. Preview-specific state, draft-support detection, and draft-id allocation live in `/lib/preview.ts`.
- Constants live in their owning domains instead of a shared constants module: API paths/inbound limits and inbound file-size env parsing in `/lib/api.ts`, outbound attachment limits and outbound attachment-size env parsing in `/lib/attachments.ts`, media-group debounce in `/lib/media.ts`, attachment-handler timeout and local tool lookup defaults in `/lib/handlers.ts`, menu cache/state bounds in `/lib/menu.ts`, preview throttle/draft bounds in `/lib/preview.ts`, typing cadence in `/lib/runtime.ts`, diagnostic ring limits in `/lib/status.ts`, Telegram prompt prefix in `/lib/turns.ts`, and system-prompt guidance in `/lib/registration.ts`.
- Queueing, narrow Telegram prompt content contracts, queue-store contracts/state helpers, active-turn state helpers, dispatch-readiness adapters, queue append/mutation runtime/controller adapters, control enqueue controllers, queue dispatch readiness/controller/runtime adapters, prompt enqueue/history planning/runtime/controllers, queue-runtime, session state appliers plus lifecycle/runtime sequencing, session start/shutdown sequencing plus hook binding, agent-start/agent-end lifecycle handling plus hook/runtime binding, and tool lifecycle handling plus tool-execution hook/runtime binding in `/lib/queue.ts`
- Model identity/thinking-level contracts, scoped model-pattern parsing/resolution/sorting, current-model store/update/runtime helpers, in-flight model-switch state helpers, restart eligibility, delayed abort decisions, Telegram-prefix defaulted continuation prompt construction, continuation queue adapters, and model-switch controller/runtime binding over queue-owned turns in `/lib/model.ts`
- Preview transport-selection, assistant-message preview lifecycle hook binding/handling, preview-finalization, preview controller state/reset helpers, preview Bot API message/rendered-chunk transport adapters, preview-controller/assistant-preview runtime binding, reply-metadata defaulting through the replies-domain helper, and preview-runtime helpers in `/lib/preview.ts`
- Reply-transport, rendered-message delivery runtime/binding, structural assistant-message extraction, reply-parameter construction over API-owned transport shapes, and plain/Markdown final-reply helpers in `/lib/replies.ts`
- Preview appearance and snapshot derivation stay in `/lib/rendering.ts`, while `/lib/preview.ts` owns transport and lifecycle decisions, so richer preview strategies can evolve without entangling Markdown formatting with Telegram delivery state
- Polling request, start/stop controller state orchestration, polling activity readers, stop-condition, structural config contract, long-poll loop helpers, and poll-loop/controller runtime wiring over Telegram transport ports in `/lib/polling.ts`
- Telegram persisted config shape, config-path defaults, config file read/write helpers, mutable config-store accessors, single-user authorization, and first-user pairing side effects/runtime adapters in `/lib/config.ts`
- Telegram API helpers, concrete Bot API transport shapes including reply parameters and send/edit message bodies, typed/default Bot API runtime helpers, bot identity fetch transport, chat-action sender adapters/runtime-bound typing action, lazy bot-token client wrappers, API runtime error-recording wrappers, temp paths, inbound file-size limits, and runtime-bound temp-directory preparation/default cleanup in `/lib/api.ts`
- Telegram turn-building helpers, runtime turn-builder wiring over media download ports and media-owned downloaded-file metadata contracts, inbound attachment handler processing, queued-prompt edit runtime binding, and Node-backed image-file reads for pi image inputs in `/lib/turns.ts`
- Telegram media/text extraction, file-info normalization, downloaded-message-file metadata contracts, inbound file download assembly, media-group debounce helpers, media-group controller state, and media-group-aware authorized-message dispatch adapter wiring in `/lib/media.ts`
- Telegram inbound attachment handler matching, command placeholder substitution, local tool invocation, handler-output collection, and quiet failure handling in `/lib/handlers.ts`
- Telegram slash-command parsing, command-message target helpers/adapters, command control-enqueue adapters/runtime binding, command-action routing, command-handler/target-runtime and command-or-prompt dispatch binding, command runtime port orchestration, shared command-runtime reply/status/control adapter closures, stop/compact/status/model/help command side-effect branching, bound Bot API command registration, and Bot API command metadata helpers in `/lib/commands.ts`
- Telegram updates extraction, authorization classification, execution-planning, authorized reaction priority/removal handling, direct execute-from-update routing, and runtime helpers in `/lib/updates.ts`
- Inbound route composition across paired update execution, callback menus, command-or-prompt dispatch, media grouping, prompt enqueueing, queued edits, and attachment-handler turn building in `/lib/routing.ts`
- Telegram attachment queueing, narrow structural attachment turn targets, queued-attachment sender runtime binding, delivery helpers, Node-backed file stat checks, outbound photo-vs-document classification, and outbound attachment limits/env parsing in `/lib/attachments.ts`
- Telegram tool, command, before-agent prompt, and lifecycle-hook registration helpers in `/lib/registration.ts`
- Setup/token prompt, environment fallback, guarded setup runtime adapter wiring, structural setup config contract, token validation, config persistence orchestration, and setup notification helpers in `/lib/setup.ts`
- Markdown block scanning/rendering, inline-token/style rendering, text-piece rendering, stable-preview block scanning, final rendered-block chunk balancing, preview-snapshot derivation, HTML escaping, raw HTML tag-preserving chunking, and Telegram message rendering helpers in `/lib/rendering.ts`
- Status-bar rendering/runtime adapters, bridge status state adapters, status-message rendering and status-HTML binding, structural queue-lane status view contracts, structured redacted runtime-event recording, recent-event recorder state, recent-event line formatting, and grouped pi-side diagnostics helpers in `/lib/status.ts`
- Menu settings/model-registry access through structural ports, menu-state construction, menu runtime state/cache controller, menu-state storage pruning/refresh helpers, command open-flow branching, action runtime/state-builder adapters, menu callback handler adapters, stored callback entry/runtime routing, model-menu input-cache/state-building resolution, pure menu-page derivation, pure menu render-payload builders, menu-message runtime, callback parsing, callback mutation helpers, full model-callback planning and execution, interface-polished callback effect ports, status-thinking callback handling, and UI helpers in `/lib/menu.ts`
- Telegram API-bound transport adapters and top-level runtime registration stay in `index.ts`; broader inbound event-side orchestration lives in `/lib/routing.ts`; direct Node file-operation imports stay in the owning domains rather than the entrypoint
- Remaining `index.ts` wiring is intentionally cross-domain adapter code that closes over live extension state, pi callbacks, Telegram API ports, and status updates; keep repeated wiring DRY through small local adapter helpers or owning-domain contracts when that reduces duplication without obscuring live state, and extract more only when a boundary can move cohesive behavior into an owning domain instead of relocating one-off closures
- Additional domains can be extracted into `/lib/*.ts` as the bridge grows, while keeping `index.ts` as the single entrypoint
- `index.ts` uses namespace imports for local bridge domains so orchestration reads as domain-scoped calls such as `Queue.*`, `Turns.*`, and `Rendering.*` instead of long flat import lists
- Mirrored domain regression coverage lives in `/tests/*.test.ts` using the same bare domain naming scheme, and architecture-invariant coverage in `/tests/invariants.test.ts` checks that the local `index.ts` plus `/lib/*.ts` import graph stays acyclic, shared bucket domains such as `lib/constants.ts` or `lib/types.ts` are not reintroduced, empty interface-extension shells stay collapsed into clearer type aliases, direct pi SDK imports stay centralized, `index.ts` source code stays free of direct Node runtime imports, local helper declarations, local arrow adapters, direct `process.env`, and direct `pi.*` receiver access, `/lib/runtime.ts` stays free of local domain imports, structural leaf domains stay free of local nominal imports, the menu domain stays on structural ports without re-exporting model, API transport stays decoupled from persisted config defaults, structural update/media domains stay decoupled from concrete API transport shapes, and attachment delivery stays decoupled from queue/inbound media/API helpers

## Configuration UX

`/telegram-setup` uses a progressive-enhancement flow for the bot token prompt:

1. Show the locally saved token from `~/.pi/agent/telegram.json` when one already exists
2. Otherwise use the first configured environment variable from the supported Telegram token list
3. Fall back to the example placeholder when no real value exists

Because `ctx.ui.input()` only exposes placeholder text, the bridge uses `ctx.ui.editor()` whenever a real default value must appear already filled in. The persisted `telegram.json` config is written with private `0600` permissions because it contains the bot token.

## Runtime Ownership

Telegram bot configuration stays in `~/.pi/agent/telegram.json`; singleton runtime ownership lives separately in `~/.pi/agent/locks.json` under `@llblab/pi-telegram`. `/telegram-connect` acquires or moves that lock before polling starts, and `/telegram-disconnect` stops polling and releases it. Session start may read the existing lock and resume polling when the lock already points at the current `pid`/`cwd`; after a full pi process restart, it may also replace a stale lock from the same `cwd` and resume polling automatically. Session start does not create new ownership from an inactive lock, a live external lock, or a stale lock from another directory. Session replacement suspends polling and ownership watchers without releasing the lock, allowing the next session-start hook in the same `pid`/`cwd` to resume from the existing explicit ownership. When a live external owner exists, `/telegram-connect` asks whether to move singleton ownership to the current pi instance. Active owners poll the lock while running through a snapshotted ownership context, so long-lived timers do not touch stale pi contexts after `/new`; they stop local polling when `locks.json` no longer points at their own `pid`/`cwd`, without deleting the new owner lock. Deleting `locks.json` resets runtime ownership without deleting Telegram configuration.

## Message And Queue Flow

### Inbound Path

1. Telegram updates are polled through `getUpdates`
2. Each update offset is persisted only after the update handler succeeds; repeated handler failures are bounded so one poisoned update cannot stall polling forever
3. The bridge filters to the paired private user
4. Media groups are coalesced into a single Telegram turn when needed
5. Files are streamed into `~/.pi/agent/tmp/telegram` with a default 50 MiB size limit, partial-download cleanup on failures, and stale temp cleanup on session start; operators can tune the limit with `PI_TELEGRAM_INBOUND_FILE_MAX_BYTES` or `TELEGRAM_MAX_FILE_SIZE_BYTES`
6. Configured inbound attachment handlers may run on downloaded files by MIME wildcard, Telegram attachment type, or generic match selector; command handlers receive safe argv substitution for `{filename}`/`{path}`/`{basename}`/`{mime}`/`{type}`, and tool handlers invoke locally available tools by name
7. Local attachments stay visible under `[attachments] <directory>` with relative file entries, and handler stdout is appended under `[outputs]` before the agent sees the turn; failed or empty handlers simply omit handler output while keeping the attachment entry
8. A `PendingTelegramTurn` is created and queued locally
9. Telegram `edited_message` updates are routed separately and update a matching queued turn when the original message has not been dispatched yet
10. The queue dispatcher sends the turn into pi only when dispatch is safe

### Queue Safety Model

The bridge keeps its own Telegram queue and does not rely only on pi's internal pending-message state.

Queued items now use two explicit dimensions:

- `kind`: prompt vs control
- `queueLane`: control vs priority vs default

Admission contract:

| Admission             | Examples                                             | Queue shape                                                          | Dispatch rank |
| --------------------- | ---------------------------------------------------- | -------------------------------------------------------------------- | ------------- |
| Immediate execution   | `/compact`, `/stop`, `/help`, `/start`               | Does not enter the Telegram queue                                    | N/A           |
| Control queue         | `/status`, `/model`, model-switch continuation turns | `queueLane: control`; accepts control items and continuation prompts | 0             |
| Priority prompt queue | A waiting prompt promoted by `👍`                    | `kind: prompt`, `queueLane: priority`                                | 1             |
| Default prompt queue  | Normal Telegram text/media turns                     | `kind: prompt`, `queueLane: default`                                 | 2             |

The command action itself carries its execution mode, and the queue domain exposes lane contracts for admission mode, dispatch rank, and allowed item kinds. Queue append and planning paths validate lane admission so a malformed control/default or other invalid lane pairing fails predictably instead of silently changing priority. This lets synthetic control actions and Telegram prompts share one stable ordering model while still rendering distinctly in status output. In the pi status bar queue preview, priority prompts are marked with `⬆` while control items keep their own control-specific summary markers such as `⚡`.

A dispatched prompt remains in the queue until `agent_start` consumes it. That keeps the active Telegram turn bound correctly for previews, attachments, abort handling, and final reply delivery.

Dispatch is gated by:

- No active Telegram turn
- No pending Telegram dispatch already sent to pi
- No compaction in progress
- `ctx.isIdle()` being true
- `ctx.hasPendingMessages()` being false

This prevents queue races around rapid follow-ups, `/compact`, and mixed local plus Telegram activity. The dispatch controller also serializes asynchronous control items, so a queued `/status` or `/model` action must settle before the next queued action can dispatch.

### Abort Behavior

When `/stop` aborts an active Telegram turn, queued follow-up Telegram messages can be preserved as prior-user history for the next turn. This keeps later Telegram input from being silently dropped after an interrupted run.

## Rendering Model

Telegram replies are rendered as Telegram HTML rather than raw Markdown.

Key rules:

- Rich text should render cleanly in Telegram chats
- Real code blocks must remain literal and escaped
- Supported absolute HTTP(S) and mailto links should stay clickable, with generated HTML attributes escaped separately from text content, while unsupported link forms such as unresolved references, footnotes, or relative links without a known base should degrade safely instead of producing broken Telegram anchors
- Markdown tables should keep their internal separators but drop the outer left and right borders when rendered as monospace blocks so narrow Telegram clients keep more usable width; table padding should count grapheme/display width for multi-codepoint emoji, combining marks, and wide Unicode where possible, and the Telegram before-agent prompt suffix also asks the assistant to prefer narrow table columns because many chats are read on phone-width screens
- Unordered Markdown lists should render with a monospace `-` marker and ordered Markdown lists should render with monospace numeric markers so list indentation stays more predictable on narrow Telegram clients
- Real Markdown task-list items should render with checkbox markers, while standalone `[x]` and `[ ]` prose should stay literal instead of being reinterpreted as checklists
- Nested Markdown quotes should flatten into one Telegram blockquote with added non-breaking-space indentation because Telegram does not render nested blockquotes reliably
- Original blank-line spacing between Markdown blocks should stay intact in both preview and final rendering instead of being collapsed to one generic block separator, while headings should still keep readable separation from following blocks such as code fences even when source Markdown omits a blank line
- Long replies, including raw HTML-mode replies used by interactive/status flows, must be split below Telegram's 4096-character limit
- Raw HTML chunking lives with the rendering helpers in `/lib/rendering.ts` and should preserve/reopen active tags across chunk boundaries where possible
- Preview rendering uses stable top-level Markdown blocks for rich Telegram HTML and appends the still-growing tail conservatively as readable plain text so the preview stays valid even when the answer is incomplete

The renderer is a Telegram-specific formatter, not a general Markdown engine, so rendering changes should be treated as regression-prone.

## Streaming And Delivery

During generation, the bridge streams previews back to Telegram.

Preferred order:

1. Re-render the current Markdown buffer into a preview snapshot that renders closed top-level blocks as rich Telegram HTML and keeps the unstable tail conservative and readable
2. Send or update that preview through `sendMessage` plus `editMessageText`, because `sendMessageDraft` is text-only for rich previews
3. Serialize overlapping preview flushes so older Telegram edit calls cannot race newer streamed snapshots
4. Replace the preview with the final rendered reply when generation ends

Draft streaming can remain as a plain-text fallback path, but rich Telegram previews are driven through editable messages and stable-block snapshot selection.

Telegram prompt responses use explicit delivery context to attach outbound text, rich previews, errors, attachment notices, and uploads as Telegram replies to the source prompt when possible. Reply metadata is opt-in per delivery path, uses `reply_parameters` with `allow_sending_without_reply: true`, and is applied only to the first chunk of split long responses; continuation chunks are sent as normal adjacent messages. Media-group turns reply to the turn's representative `replyToMessageId`, not to every source message in the group.

Outbound files are sent only after the active Telegram turn completes, must be staged through the `telegram_attach` tool, are staged atomically per tool call, are checked against a default 50 MiB limit configurable through `PI_TELEGRAM_OUTBOUND_ATTACHMENT_MAX_BYTES` or `TELEGRAM_MAX_ATTACHMENT_SIZE_BYTES`, and use file-backed multipart blobs so large sends do not require preloading whole files into memory.

## Interactive Controls

The bridge exposes Telegram-side session controls in addition to regular chat forwarding.

Current operator controls include:

- `/status` for model, usage, cost, and context visibility, queued as a high-priority control item when needed
- Inline status buttons for model and thinking adjustments, applying idle selections immediately while still respecting busy-run restart rules; model-menu inputs are cached briefly and stored inline-menu states are pruned by TTL/LRU so old keyboards expire predictably
- `/model` for interactive model selection, queued as a high-priority control item when needed and supporting in-flight restart of the active Telegram-owned run on a newly selected model
- `/compact` for Telegram-triggered pi session compaction when the bridge is idle
- `/stop` for aborting the active Telegram-owned run
- `/telegram-status` for pi-side diagnostics as grouped line-by-line sections separated by blank lines: connection, polling, execution, queue, and the recent redacted runtime/API event ring. These sections include polling state, last update id, active turn source ids, pending dispatch, compaction state, active tool count, pending model-switch state, total queue depth, and queue-lane counts. The event ring records transport/API, polling/update, prompt-dispatch, control-action, typing, compaction, setup, session-lifecycle, and attachment queue/delivery failures; benign unchanged edit responses and unsupported empty draft-clear attempts are filtered out so expected preview transport noise does not obscure real failures
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
