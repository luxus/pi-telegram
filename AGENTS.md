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

- `/index.ts`: Main extension runtime, Telegram API integration, queueing, rendering, previews, menus, and tool wiring
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

- The extension ships as a single runtime file for simple pi packaging, so logical sections inside `index.ts` are the primary module boundaries
- The bridge is session-local and intentionally pairs with a single allowed Telegram user per config
- Telegram queue state is tracked locally and must stay aligned with pi agent lifecycle hooks; dispatch must respect active turns, pending dispatch, compaction, and pi pending-message state
- In-flight `/model` switching is supported only for Telegram-owned active turns and is implemented as set-model plus synthetic continuation turn plus abort; if a tool call is active, the abort is delayed until that tool finishes instead of interrupting the tool mid-flight
- Telegram replies render through Telegram HTML, not raw Markdown; real code blocks must stay literal and escaped
- `telegram_attach` is the canonical outbound file-delivery path for Telegram-originated requests

## 6. Engineering Conventions

- Treat queue handling, compaction interaction, and lifecycle-hook state transitions as regression-prone areas; validate them after changing dispatch logic
- Treat Markdown rendering as Telegram-specific output work, not generic Markdown rendering; preserve literal code content and avoid HTML chunk splits that break tags
- Keep comments and user-facing docs in English unless the surrounding file already follows another convention
- Prefer targeted edits inside `index.ts` over broad rewrites unless a section boundary is being intentionally restructured

## 7. Operational Conventions

- When Telegram-visible behavior changes, sync `README.md` and the relevant `/docs` entry in the same pass
- When durable runtime constraints or repeat bug patterns emerge, record them here instead of burying them in changelog prose
- When fork identity changes, keep `README.md`, package metadata, and docs aligned so the published package does not point back at stale upstream coordinates

## 8. Integration Protocols

- Telegram API methods currently used include polling, message editing, draft streaming, callback queries, reactions, file download, and media upload endpoints
- pi integration depends on lifecycle hooks such as `before_agent_start`, `agent_start`, `message_start`, `message_update`, and `agent_end`
- `ctx.ui.input()` provides placeholder text rather than an editable prefilled value; when a real default must appear already filled in, prefer `ctx.ui.editor()`
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
