# Project Context

## 0. Meta-Protocol Principles

- `Constraint-Driven Evolution`: Add structure when the bridge gains real operator or runtime constraints
- `Single Source of Truth`: Keep durable rules in `AGENTS.md`, open work in `BACKLOG.md`, completed delivery in `CHANGELOG.md`, and deeper technical detail in `/docs`
- `Boundary Clarity`: Separate Telegram transport concerns, pi integration concerns, rendering behavior, and release/documentation state
- `Progressive Enhancement + Graceful Degradation`: Prefer behavior that upgrades automatically when richer runtime context exists, but always preserves a useful fallback path when it does not
- `Runtime Safety`: Prefer queue and rendering behavior that fails predictably over clever behavior that can desynchronize the Telegram bridge from pi session state

## 1. Concept

`pi-telegram` is a pi extension that turns a Telegram DM into a session-local frontend for pi, including text/file forwarding, streaming previews, queued follow-ups, model controls, and outbound attachment delivery.

## 2. Identity & Naming Contract

- `Telegram turn`: One unit of Telegram input processed by pi; this may represent one message or a coalesced media group
- `Queued Telegram turn`: A Telegram turn accepted by the bridge but not yet active in pi
- `Active Telegram turn`: The Telegram turn currently bound to the running pi agent loop
- `Preview`: The transient streamed response shown through Telegram drafts or editable messages before the final reply lands
- `Scoped models`: The subset of models exposed to Telegram model selection when pi settings or CLI flags limit the available list

## 3. Project Topology

- `/index.ts`: Main extension entrypoint and runtime composition layer for the bridge
- `/lib/*.ts`: Flat domain modules for reusable runtime logic. Favor domain files such as queueing/runtime, replies, polling, updates, attachments, registration/hooks, Telegram API/config, turns, media, setup, rendering, menu/status/model-resolution support, and other cohesive bridge subsystems; use `shared` only when a type or constant truly spans multiple domains
- `/tests/*.test.ts`: Domain-mirrored regression suites that follow the same flat naming as `/lib`
- `/docs/README.md`: Documentation index for technical project docs
- `/docs/architecture.md`: Runtime and subsystem overview for the bridge
- `/README.md`: User-facing project entry point, install guide, and fork summary
- `/AGENTS.md`: Durable engineering and runtime conventions
- `/BACKLOG.md`: Canonical open work
- `/CHANGELOG.md`: Completed delivery history

## 4. Core Entities

- `TelegramConfig`: Persisted bot/session pairing state
- `PendingTelegramTurn` / `ActiveTelegramTurn`: Queue and active-turn state for Telegram-originated work
- `TelegramPreviewState`: Streaming preview state for drafts or editable Telegram messages
- `TelegramModelMenuState`: Inline menu state for status/model/thinking controls
- `QueuedAttachment`: Outbound files staged for delivery through `telegram_attach`

## 5. Architectural Decisions

- `index.ts` stays the single extension entrypoint, while reusable runtime logic should be split into flat domain files under `/lib`; prefer domain-oriented grouping over atomizing every helper into its own file, and use `shared` sparingly for genuinely cross-domain types or constants
- The bridge is session-local and intentionally pairs with a single allowed Telegram user per config
- Telegram queue state is tracked locally and must stay aligned with pi agent lifecycle hooks; queued items now have explicit kinds and lanes so prompt turns and synthetic control actions can share one ordering model, while dispatch still respects active turns, pending dispatch, compaction, and pi pending-message state
- Prompt items should remain in the queue until `agent_start` consumes the dispatched turn; removing them earlier breaks active-turn binding, preview delivery, and end-of-turn follow-up behavior
- In-flight `/model` switching is supported only for Telegram-owned active turns and is implemented as set-model plus synthetic continuation turn plus abort; if a tool call is active, the abort is delayed until that tool finishes instead of interrupting the tool mid-flight
- Telegram replies render through Telegram HTML, not raw Markdown; real code blocks must stay literal and escaped
- `telegram_attach` is the canonical outbound file-delivery path for Telegram-originated requests

## 6. Engineering Conventions

- Treat queue handling, compaction interaction, and lifecycle-hook state transitions as regression-prone areas; validate them after changing dispatch logic
- Treat Markdown rendering as Telegram-specific output work, not generic Markdown rendering; preserve literal code content, avoid HTML chunk splits that break tags, prefer width-efficient monospace table and list formatting for narrow clients, and flatten nested Markdown quotes into indented single-blockquote output because Telegram does not render nested blockquotes reliably
- Keep comments and user-facing docs in English unless the surrounding file already follows another convention
- Each project `.ts` file should start with a short multi-line responsibility header comment that explains the file boundary to future maintainers
- Name extracted `/lib` modules and mirrored `/tests` suites by bare domain when the repository already supplies the Telegram scope; prefer `api.ts`, `queue.ts`, `updates.ts`, and `queue.test.ts` over redundant `telegram-*` filename prefixes
- Prefer targeted edits, keeping `index.ts` as the orchestration layer and moving reusable logic into flat `/lib` domain modules when a subsystem becomes large enough to earn extraction; current extracted domains include queueing/runtime decisions, preview streaming, replies, polling, updates, attachments, registration and lifecycle-hook binding, Telegram API/config support, turn-building, media extraction, setup, rendering, status rendering, menu/model-resolution/UI support, and model-switch support
- Keep preview appearance logic in the rendering domain and preview transport/lifecycle logic in the preview domain so richer streaming strategies can evolve without entangling Telegram delivery state with Markdown formatting rules

## 7. Operational Conventions

- When Telegram-visible behavior changes, sync `README.md` and the relevant `/docs` entry in the same pass
- When durable runtime constraints or repeat bug patterns emerge, record them here instead of burying them in changelog prose
- When fork identity changes, keep `README.md`, package metadata, and docs aligned so the published package does not point back at stale upstream coordinates
- Work only inside this repository during development tasks; updating the installed Pi extension checkout is a separate manual operator step, not part of normal in-repo implementation work

## 8. Integration Protocols

- Telegram API methods currently used include polling, message editing, draft streaming, callback queries, reactions, file download, and media upload endpoints
- pi integration depends on lifecycle hooks such as `before_agent_start`, `agent_start`, `message_start`, `message_update`, and `agent_end`
- `ctx.ui.input()` provides placeholder text rather than an editable prefilled value; when a real default must appear already filled in, prefer `ctx.ui.editor()`
- For `/telegram-setup`, prefer the locally saved bot token over environment variables on repeat setup runs; env vars are the bootstrap path when no local token exists
- Status/model/thinking controls are driven through Telegram inline keyboards and callback queries
- Inbound files may become pi image inputs; outbound files must flow through `telegram_attach`

## 9. Pre-Task Preparation Protocol

- Read `README.md` for current user-facing behavior and fork positioning
- Read `BACKLOG.md` before changing runtime behavior or documentation so open work stays truthful
- Read `/docs/architecture.md` before restructuring queue, preview, rendering, or command-handling logic
- Inspect the relevant `index.ts` section before editing because most bridge behavior is stateful and cross-linked

## 10. Task Completion Protocol

- Run the smallest meaningful validation for the touched area; `npm test` is the default regression suite once rendering or queue logic changes
- For rendering changes, ensure regressions still cover nested lists, code blocks, underscore-heavy text, and long-message chunking
- For queue/dispatch changes, validate abort, compaction, pending-dispatch, and pi pending-message guard behavior
- Sync `README.md`, `CHANGELOG.md`, `BACKLOG.md`, and `/docs` whenever user-visible behavior or real open-work state changes
