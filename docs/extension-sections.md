# Telegram Extension Sections Standard Draft

**Status:** Draft. This document is a design note for the upcoming Extension Sections platform and is not an implemented or stable public API yet. Treat all names, shapes, and examples as provisional until the implementation lands.

**Meta-contract:** transportable (bit-for-bit identical across projects), high-density (zero fluff), constant (evolve by crystallizing, not speculating), optimal minimum (add only when it hurts).

---

Telegram Extension Sections are a proposed registration contract that lets ordinary pi extensions add structured UI sections to the `pi-telegram` inline application menu.

The guiding philosophy is pi-native extensibility: `pi-telegram` should inherit π's own model of small composable extensions. The bridge should act as a shared Telegram shell for loaded π extensions, not as a closed one-off bot or a place where every feature must fork Telegram polling and transport.

They are not a new extension loader. pi still loads extensions through its normal TypeScript/package system. A loaded extension registers a Telegram section with `pi-telegram`; `pi-telegram` owns bot polling, menu rendering, callback routing, Telegram authorization, and message lifecycle.

## Purpose

Use sections when an extension needs a Telegram-native UI surface inside the existing bot shell:

- File or project explorers
- Prompt/session history viewers
- Tool approval dashboards
- Runtime status panels
- Extension settings or diagnostics
- Human-in-the-loop forms that should not become agent turns

Do not use sections for plain agent prompts, one-shot buttons authored by the assistant, or command-template pipelines. Those stay in the normal queue, outbound action comments, inbound/outbound handlers, or command-template domains.

## Identity key

Each section has one stable identity key.

Use the same identity rules as the Extension Locks Standard:

1. `package.json/name` for npm-style pi packages
2. Directory name when the extension entrypoint is `index.ts` but there is no package name
3. File basename when the extension is a single file

For npm-style package extensions, the canonical value is the `package.json` `name`.

Examples:

```text
extensions/pi-telegram-explorer/package.json name=@llblab/pi-telegram-explorer -> @llblab/pi-telegram-explorer
extensions/pi-telegram-explorer/index.ts without package.json              -> pi-telegram-explorer
extensions/pi-telegram-explorer.ts                                         -> pi-telegram-explorer
```

The section `id` is also the owner identity. Do not add a separate `owner` field unless a later concrete need appears.

The identity key is used for:

- Registry ownership
- Conflict detection
- Diagnostics
- Cleanup
- Callback routing lookup
- Future capability policy

## Registration shape

Minimum shape:

```ts
registerTelegramSection({
  id: "@llblab/pi-telegram-explorer",
  label: "🗂 Explorer",
  render(ctx) {
    return {
      text: "<b>Explorer</b>",
      parseMode: "html",
      replyMarkup,
    };
  },
  handleCallback(ctx) {
    return "handled";
  },
});
```

Recommended TypeScript shape:

```ts
type TelegramSectionId = string;
type TelegramSectionCallbackResult = "handled" | "pass";

interface TelegramSectionRegistration {
  id: TelegramSectionId;
  label: string;
  order?: number;
  render: (
    ctx: TelegramSectionRenderContext,
  ) => TelegramSectionView | Promise<TelegramSectionView>;
  handleCallback?: (
    ctx: TelegramSectionCallbackContext,
  ) => TelegramSectionCallbackResult | Promise<TelegramSectionCallbackResult>;
}

interface TelegramSectionView {
  text: string;
  parseMode?: "html" | "plain";
  replyMarkup?: TelegramInlineKeyboardMarkup;
}
```

Registration returns a disposer:

```ts
const unregister = registerTelegramSection(section);
unregister();
```

## Loading model

Sections are registered by normal pi extensions:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerTelegramSection } from "@llblab/pi-telegram/lib/extension-sections.ts";

export default function (pi: ExtensionAPI) {
  const unregister = registerTelegramSection({
    id: "@llblab/pi-telegram-explorer",
    label: "🗂 Explorer",
    render: async (ctx) => ctx.html("<b>Explorer</b>"),
  });
  pi.on("shutdown", () => unregister());
}
```

`pi-telegram` may expose a typed import and a zero-coupling `globalThis` registry. The typed import is the preferred authoring path. The global registry exists only to tolerate load order and package coupling constraints.

## Menu integration

`pi-telegram` owns the main Telegram application menu.

Registered sections appear as top-level menu rows after built-in core sections unless an `order` value says otherwise.

Rules:

- `label` must be compact enough for mobile Telegram
- Built-in sections keep priority over external sections
- Duplicate `id` registration is rejected or replaces only the same live owner through an explicit disposer path
- Section errors must not break the whole main menu
- If a section fails to render, `pi-telegram` should show a compact error row or omit the section and record diagnostics

## Callback routing

`pi-telegram` owns section callback transport.

A section callback must include a `pi-telegram` owned prefix plus a compact section token that maps back to the full identity key.

Conceptual form:

```text
section:<token>:<action>:<payload>
```

The token is an implementation detail. The registry maps it to the canonical section `id`. `section:` is reserved in the [Callback Namespace Standard](./callback-namespaces.md); section authors should build callbacks through section context helpers rather than hand-crafting `section:` payloads.

Routing order:

1. Telegram update arrives through the single `pi-telegram` poller
2. Existing low-level external handlers may observe or consume the update first
3. Built-in menu callbacks are handled by built-in domains
4. Section callbacks are resolved by token and sent to the registered section
5. Unknown callbacks fall back to the existing callback namespace behavior when appropriate

Section handlers return:

- `"handled"` — callback was handled, do not continue routing
- `"pass"` — section declines this callback, allow fallback routing

Stale callbacks:

- Missing section id or token should answer the callback with a short stale/expired notice
- Missing target state should re-render the section root when possible
- Section errors should be caught, surfaced as a short callback answer, and recorded in diagnostics

## Runtime ports

A section receives a narrow context, not raw `pi-telegram` internals.

Initial safe ports:

```ts
interface TelegramSectionContext {
  sectionId: string;
  chatId: number;
  messageId?: number;
  answerCallback(text?: string): Promise<void>;
  edit(view: TelegramSectionView): Promise<void>;
  open(view: TelegramSectionView): Promise<void>;
  enqueuePrompt(prompt: string): Promise<void>;
  getQueueSnapshot(): TelegramQueueSnapshot;
  getSessionSnapshot?(): TelegramSessionSnapshot;
}
```

Filesystem or prompt-history mutation is not part of the baseline. Add capability-specific ports only when the first real extension needs them.

## Security and authorization

`pi-telegram` keeps Telegram authorization ownership.

Baseline rules:

- Section callbacks are accepted only from the paired/authorized Telegram user
- Sections should not receive unauthorized updates
- Sections must not start their own Telegram poller
- Sections must not assume filesystem or session mutation rights
- Sensitive capabilities should be exposed as explicit typed ports, not by passing raw process or bot clients

For filesystem explorers, default to read-only browse and file-send behavior. Deleting, writing, shell execution, or rollback-like mutations require separate explicit capabilities and confirmation UI.

## Diagnostics

`pi-telegram` should be able to report registered sections.

Minimum diagnostic fields:

```text
id
label
status: active | stale | error
lastError
```

The identity key is sufficient as the owner label. Do not add a second owner field.

Useful future fields:

```text
registeredAt
lastRenderAt
lastCallbackAt
callbackCount
errorCount
capabilities
```

Diagnostics should be available through a status/debug surface without cluttering normal Telegram UI.

## Relationship to callback namespaces and external handlers

[Callback Namespaces](./callback-namespaces.md) define callback ownership names. [External Handlers](./external-handlers.md) define low-level raw update interception. Extension sections define the structured Telegram UI layer above both.

Sections still use namespaced callback data, but `pi-telegram` owns the `section:` prefix and maps compact tokens to canonical section identities. That keeps Telegram's 64-byte callback limit compatible with full npm package names such as `@llblab/pi-telegram-explorer`.

Use external handlers when an extension needs direct raw Telegram update access, a custom callback namespace, or out-of-band Promise resolution.

Use extension sections when an extension needs a durable menu surface, callback routing, and Telegram UI lifecycle managed by `pi-telegram`.

## Relationship to command templates

Command templates execute local commands and pipelines through stdin/stdout.

Extension sections do not execute command templates by default. A section may call an extension-owned command or tool internally, but the section standard is a UI registration and callback-routing contract, not a shell execution contract.

## Non-goals

- No second Telegram poller
- No new pi extension loader
- No generic webview system
- No default filesystem mutation API
- No prompt rollback semantics in the base standard
- No separate owner field while identity key is sufficient

## Evolution path

0.10.0 minimum:

- Section registry
- Main menu integration
- Section callback routing
- Narrow runtime ports
- Diagnostics for registered sections
- Documentation for extension authors

First demo extension candidate:

```text
@llblab/pi-telegram-explorer
```

Initial demo scope:

- Browse current project tree read-only
- View compact file previews
- Send selected files as Telegram documents
- Browse recent prompt/session snapshots read-only
- Enqueue a prompt derived from a selected item

Defer rollback, filesystem writes, deletes, and broad mutation until the read-only and enqueue-only model is proven.
