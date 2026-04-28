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
- `/lib/*.ts`: Flat domain modules for reusable runtime logic. Favor domain files such as queueing/runtime, replies, polling, updates, attachments, registration/hooks, pi SDK adapter, Telegram API, config, turns, media, setup, rendering, menu/status/model-resolution support, and other cohesive bridge subsystems; use `shared` only when a type or constant truly spans multiple domains
- `/tests/*.test.ts`: Domain-mirrored regression suites that follow the same flat naming as `/lib`
- `/docs/README.md`: Documentation index for technical project docs
- `/docs/architecture.md`: Runtime and subsystem overview for the bridge
- `/README.md`: User-facing project entry point, install guide, and fork summary
- `/AGENTS.md`: Durable engineering and runtime conventions
- `/BACKLOG.md`: Canonical open work
- `/CHANGELOG.md`: Completed delivery history
- [Repository-local context-evolution skill](./.agents/skills/evolve-context/README.md): Skill reference used by validation tooling

## 4. Core Entities

- `TelegramConfig`: Persisted bot/session pairing state
- `PendingTelegramTurn`: Queue-domain prompt turn state for queued and active Telegram-originated work
- `TelegramPreviewRuntimeState`: Preview-domain streaming state for drafts or editable Telegram messages
- `TelegramModelMenuState`: Inline menu state for status/model/thinking controls
- `QueuedAttachment`: Outbound files staged for delivery through `telegram_attach`

## 5. Architectural Decisions

## 5.1 Flat Domain DAG Shape

- The project follows a `Flat Domain DAG`: cohesive bridge domains live as flat `/lib/*.ts` modules, and local imports must form a directed acyclic graph
- `index.ts` stays the single extension entrypoint and composition root for live pi/Telegram ports, SDK adapters, and session state
- Reusable runtime logic should be split into flat domain files under `/lib`
- Prefer domain-oriented grouping over atomizing every helper into its own file
- Use `shared` sparingly and only for types or constants that genuinely span multiple bridge domains

## 5.2 Session And Queue Semantics

- The bridge is session-local and intentionally pairs with a single allowed Telegram user per config
- Telegram queue state is tracked locally and must stay aligned with pi agent lifecycle hooks
- Queued items have explicit kinds and lanes so prompt turns and synthetic control actions can share one ordering model
- Keep queue admission contract explicit and validated: immediate commands execute without entering the queue, control commands enter the `control` lane, normal prompts enter the `default` lane, reaction-promoted prompts enter the `priority` lane, and queue append/planning paths should reject invalid kind/lane pairings predictably
- Dispatch must still respect active turns, pending prompt dispatch, unsettled control-item execution, compaction, and pi pending-message state
- Long-lived timers, pollers, and ownership watchers must not depend on live pi context objects after session replacement. Snapshot primitive identity such as `cwd` when installing a watcher, stop local timers during session shutdown, and catch stale-context status updates during async cleanup.
- Prompt items should remain in the queue until `agent_start` consumes the dispatched turn; removing them earlier breaks active-turn binding, preview delivery, and end-of-turn follow-up behavior
- In-flight `/model` switching is supported only for Telegram-owned active turns and is implemented as set-model plus synthetic continuation turn plus abort
- If a tool call is active during in-flight `/model` switching, the abort is delayed until that tool finishes instead of interrupting the tool mid-flight

## 5.3 Telegram Delivery Semantics

- Telegram replies render through Telegram HTML, not raw Markdown
- Real code blocks must stay literal and escaped
- `telegram_attach` is the canonical outbound file-delivery path for Telegram-originated requests

## 6. Engineering Conventions

## 6.1 Validation Hotspots

- Treat queue handling, compaction interaction, and lifecycle-hook state transitions as regression-prone areas; validate them after changing dispatch logic
- Route important runtime failures through the recent runtime event recorder so `/telegram-status` remains useful for post-mortem debugging, not just transient status-bar errors
- Treat Markdown rendering as Telegram-specific output work, not generic Markdown rendering
- Preserve literal code content in Telegram rendering
- Avoid HTML chunk splits that break tags
- Prefer width-efficient monospace table and list formatting for narrow clients, with table padding based on grapheme/display width rather than raw UTF-16 length where possible
- Flatten nested Markdown quotes into indented single-blockquote output because Telegram does not render nested blockquotes reliably

## 6.2 File And Naming Style

- Keep comments and user-facing docs in English unless the surrounding file already follows another convention
- Each project `.ts` file should start with a short multi-line responsibility header comment that explains the file boundary to future maintainers
- Name extracted `/lib` modules and mirrored `/tests` suites by bare domain when the repository already supplies the Telegram scope; prefer `api.ts`, `queue.ts`, `updates.ts`, and `queue.test.ts` over redundant `telegram-*` filename prefixes
- Prefer targeted edits, keeping `index.ts` as the orchestration layer and moving reusable logic into flat `/lib` domain modules when a subsystem becomes large enough to earn extraction
- Keep composition wiring DRY with small local adapters or owning-domain contracts when repetition appears, but do not hide live mutable session state behind broad facades just to reduce repeated closures
- Keep interface contracts consistent for the same runtime entity: prefer the owning domain's exported contract when multiple modules mean the same entity, and use local structural `*Like`/view contracts only for deliberate narrow projections that avoid real coupling without duplicating source-of-truth shapes

## 6.3 Current Domain Ownership Snapshot

- Queue owns scheduling/lifecycle semantics: lane contracts, queue and active-turn stores, mutations, dispatch readiness/runtime, control/prompt enqueueing, session state appliers, and agent/tool lifecycle hooks; model owns model identity/thinking-level contracts, scoped resolution and CLI pattern parsing, current-model state/runtime helpers, in-flight switch state, restart eligibility, delayed abort decisions, Telegram-prefix-defaulted continuation prompt construction/queueing, and controller runtime binding over queue turns
- Runtime owns session-local primitives and timers; locks owns shared `locks.json` singleton ownership, interactive takeover, stale same-`cwd` restart resume, session-replacement suspension, and ownership-drift shutdown; pi owns direct SDK imports and bound extension API ports; config owns persisted bot/session pairing state, single-user authorization, first-user pairing side effects, and inbound attachment handler config; API owns Bot API transport shapes/helpers, temp-dir/inbound-limit/runtime-error helpers, and runtime-bound chat actions
- Preview owns streaming preview lifecycle and transports, defaulting reply metadata through the replies-domain helper when callers do not override it; replies owns final rendered-message delivery and reply parameters; rendering owns Telegram HTML Markdown/block/chunk/preview-snapshot formatting
- Polling owns long-poll controller state/activity/loop wiring; updates owns callback/message/edit/reaction classification/execution; routing owns inbound update composition across menus, commands, media grouping, prompt queueing, edits, and paired authorization; handlers owns inbound attachment handler matching, command/tool invocation, prompt-text injection, and fallback behavior; registration owns pi tool/command/lifecycle-hook binding
- Commands own slash-command parsing, execution-mode contracts, command target/control queue adapters, bot-command metadata/registration, and stop/compact/status/model/help side effects
- Menu owns inline menu state/cache/building, callback/action runtimes, status/thinking/model UI support, and selection planning; status owns bridge status rendering, grouped pi-side diagnostic lines, and recent-event state
- Turns own Telegram prompt turn-building/editing, prompt-prefix identity, and attachment-handler output handoff into prompt content; media owns inbound text/file/media-group extraction and download assembly; attachments own outbound file queueing, narrow structural attachment turn targets, stat checks, limits, and delivery classification; setup owns token prompt, env fallback, and validation flow

## 6.4 Entrypoint And Import Boundaries

- Keep preview appearance logic in the rendering domain and preview transport/lifecycle logic in the preview domain so richer streaming strategies can evolve without entangling Telegram delivery state with Markdown formatting rules
- Keep direct `node:*` file-operation dependencies out of `index.ts` when an owning domain exists; the entrypoint should compose ports while domains own local filesystem details such as temp-dir preparation, attachment stats, and turn image reads
- In `index.ts`, prefer namespace imports for local bridge domains so orchestration reads as domain-scoped calls such as `Queue.*`, `Turns.*`, and `Rendering.*` instead of long flat import lists
- Keep the local `index.ts` plus `/lib/*.ts` import graph acyclic; `tests/invariants.test.ts` guards this boundary plus shared-bucket bans, empty interface-extension shell regressions, pi SDK centralization, source-only entrypoint Node-runtime/local-adapter/process/direct-pi access avoidance, runtime-domain isolation, structural leaf-domain import isolation, menu/model boundary drift, API/config default coupling, structural update/media coupling to API transport shapes, and attachment coupling to queue/inbound media/API helpers as domains keep evolving
- Do not reintroduce shared bucket domains such as `lib/constants.ts` or `lib/types.ts`; constants, state interfaces, and concrete transport shapes should stay in their owning domains, and `index.ts` should not grow new shared magic constants
- Keep remaining `index.ts` code focused on cross-domain adapter wiring that needs live extension state, pi callbacks, Telegram API ports, or status updates; do not extract one-off closures solely to reduce line count
- Domain-specific queue planning, preview transport/controller behavior, rendering, Telegram API transport, menu state, and command behavior should stay in their owning domains instead of moving to `/lib/runtime.ts` solely to shrink `index.ts`
- Prefer narrow structural runtime ports in domains that only store or route pi-compatible values; direct pi SDK/model imports should stay centralized in `/lib/pi.ts`, while domains that actively register pi hooks/tools/commands should consume those concrete contracts through the adapter

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
- Inbound files may become pi image inputs or configured attachment-handler text before queueing; outbound files must flow through `telegram_attach`

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
