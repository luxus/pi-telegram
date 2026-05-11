# Telegram Extension Sections Standard

**Status:** Implemented in 0.10.0. Stable public API.

**Meta-contract:** transportable (bit-for-bit identical across projects), high-density (zero fluff), constant (evolve by crystallizing, not speculating), optimal minimum (add only when it hurts).

---

## 1. Philosophy

Telegram Extension Sections let ordinary pi extensions add structured UI surfaces to the `pi-telegram` inline application menu. The platform mirrors π's own extensibility model: small, composable extensions that plug into a shared shell without owning transport, polling, authorization, or menu lifecycle.

`pi-telegram` stays the single bot operator. Extensions register typed sections; the bridge handles rendering, callback routing, token mapping, navigation hierarchy, and diagnostics. No second poller, no new loader — just one `registerTelegramSection()` call.

## 2. Contract Layers

The standard operates across three integration surfaces:

- **Extension API**: registration shape, context ports, `callbackData()`, `getLabel()`, navigation, disposer
- **Telegram Bot API**: 64-byte limit → token mapping, inline keyboard, `menu:back`/`settings:list` routing, stale-token answers
- **Pi Extension API**: typed import + `globalThis`, `pi.on("shutdown")` cleanup, load-order, identity

## 3. Identity Key

Each section has one stable identity key. Use the same rules as the Extension Locks Standard:

1. `package.json/name` for npm-style pi packages
2. Directory name when the entrypoint is `index.ts` without `package.json`
3. File basename for single-file extensions

```
extensions/pi-telegram-extension-demo/package.json name=@llblab/pi-telegram-extension-demo → @llblab/pi-telegram-extension-demo
extensions/pi-telegram-extension-demo/index.ts without package.json              → pi-telegram-extension-demo
extensions/pi-telegram-extension-demo.ts                                         → pi-telegram-extension-demo
```

The `id` is the owner identity. No separate `owner` field. Used for registry ownership, conflict detection, diagnostics, cleanup, and callback routing lookup.

## 4. Registration Shape

```ts
import { registerTelegramSection } from "@llblab/pi-telegram/lib/extension-sections.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const unregister = registerTelegramSection({
    id: "@llblab/pi-telegram-extension-demo",
    label: "🧪 Demo submenu",
    order: 10,
    render: async (ctx) => ({
      text: "<b>Demo</b>",
      parseMode: "html",
      replyMarkup: {
        inline_keyboard: [
          [{ text: "Click me", callback_data: ctx.callbackData("act", "x") }],
        ],
      },
    }),
    handleCallback: async (ctx) => {
      if (ctx.action === "act") {
        await ctx.answerCallback(`payload: ${ctx.payload}`);
        return "handled";
      }
      return "pass";
    },
    settings: {
      label: "🧪 Demo settings",
      order: 0,
      getLabel: () => `${flag ? "🟢" : "⚫️"} Demo settings`,
      open: async (ctx) => ({ text: "<b>Settings</b>", parseMode: "html" }),
      handleCallback: async (ctx) => {
        flag = ctx.payload === "on";
        return "handled";
      },
    },
  });
  pi.on("shutdown", () => unregister());
}
```

### Full TypeScript shape

```ts
type TelegramSectionId = string;
type TelegramSectionCallbackResult = "handled" | "pass";

interface TelegramSectionRegistration {
  id: TelegramSectionId;
  label: string;
  order?: number;
  render: (
    ctx: TelegramSectionContext,
  ) => TelegramSectionView | Promise<TelegramSectionView>;
  handleCallback?: (
    ctx: TelegramSectionCallbackContext,
  ) => TelegramSectionCallbackResult | Promise<TelegramSectionCallbackResult>;
  settings?: {
    label: string;
    order?: number;
    getLabel?: () => string;
    open: (
      ctx: TelegramSectionContext,
    ) => TelegramSectionView | Promise<TelegramSectionView>;
    handleCallback?: (
      ctx: TelegramSectionCallbackContext,
    ) => TelegramSectionCallbackResult | Promise<TelegramSectionCallbackResult>;
  };
}

interface TelegramSectionView {
  text: string;
  parseMode?: "html" | "plain";
  replyMarkup?: TelegramInlineKeyboardMarkup;
}
```

### Registration returns a disposer

```ts
const unregister = registerTelegramSection(section);
unregister(); // removes from main menu, settings, and callback routing
```

## 5. Loading Model

Two paths, same registry:

**Typed import (preferred):** Extension imports `registerTelegramSection` from `@llblab/pi-telegram/lib/extension-sections.ts`. The function reads from a `globalThis` registry set by `pi-telegram` at startup.

**Relative import (local):** When the extension cannot resolve `@llblab/pi-telegram` as an npm package, use a relative path:

```ts
import { registerTelegramSection } from "../pi-telegram/lib/extension-sections.ts";
```

**GlobalThis bridge (zero-coupling):** `pi-telegram` exposes `__piTelegramSectionRegistry__` on `globalThis`. The typed import is a thin wrapper. Extensions never touch the raw registry.

**Load order:** `pi-telegram` must load first (sets the global registry). Demo/consumer extensions load second (call `registerTelegramSection`). Pi's normal extension loader guarantees this when `pi-telegram` is listed first.

**Shutdown:** Call `pi.on("shutdown", () => unregister())` to clean up. The registry is cleared on `pi-telegram` unload.

## 6. Menu Integration

Sections appear in two locations:

### Main menu

Section rows are injected **before the ⚙️ Settings row**. Ordered by `order` (lower first), then `id` alphabetically.

```
🤖 Model: anthropic/claude-sonnet-4-5
🧠 Thinking: off
⌛ Queue: 0
🧪 Demo submenu          ← extension section
⚙️ Settings
```

Built-in core rows keep priority. Section errors do not break menu rendering — a failed section is omitted with a diagnostic entry.

### Settings submenu

Extensions with a `settings` block inject rows **before built-in Proactive push**. The `getLabel()` function (if present) is called on every render to produce a dynamic label — use it for status indicators:

```ts
getLabel: () => `${flag ? "🟢" : "⚫️"} Demo settings`;
```

```
⬆️ Main menu
🟢 Demo settings          ← extension settings (dynamic label)
🟢 Proactive push
```

Ordered by `settings.order` (lower first), then `id` alphabetically.

## 7. Callback Routing

### Token mapping

Telegram limits `callback_data` to 64 bytes. Full npm names like `@llblab/pi-telegram-explorer` often exceed this. `pi-telegram` maps each registered section to a compact numeric token:

```text
section:<token>:<action>:<payload>
```

Example: `section:0:counter:5`

The token is an implementation detail. Section authors **never** write `section:` strings manually. Use `ctx.callbackData(action, payload?)` which fills in the correct token.

### Routing order

1. Telegram update arrives through the single `pi-telegram` poller
2. External handlers observe/consume (raw update interception)
3. Button action store (`tgbtn:*`)
4. Queue menu callbacks (`queue:*`)
5. Settings menu callbacks (`settings:*`)
6. Built-in menu callbacks (`menu:*`, `model:*`, `thinking:*`, `status:*`)
7. Section callbacks (`section:*`) — dispatched before step 6's full handler
8. Unknown callbacks fall back to `[callback]` prompt text

### Handler return values

- `"handled"`: callback consumed, stop routing, `answerCallbackQuery` already called
- `"pass"`: section declines; fallback to settings handler (if exists), then to caller

### Fallback chain in `handleCallback`

```
section.handleCallback(ctx) → "handled" | "pass"
  └─ if "pass" and settings.handleCallback exists →
       settings.handleCallback(newCtx with backCallback="settings:list")
```

The fallback creates a **new context** with the correct `backCallback` for the navigation level.

### Stale tokens

If a section is unregistered or a token is unknown, the callback is answered with a short Telegram native popup:

> "This section is no longer available."

Section errors are caught and surfaced as popup text. No unhandled exceptions leak to the poller.

## 8. Navigation Hierarchy

`ctx.edit()` and `ctx.open()` automatically prepend a Back row. The Back target depends on the navigation level:

- Section root (from main menu): `⬆️ Main menu` → `menu:back`
- Section sub-view (`ctx.edit()` in handler): `⬆️ Back` → `section:<token>:open`
- Settings root (from Settings list): `⬆️ Back` → `settings:list`
- Settings sub-view (`ctx.edit()` in settings handler): `⬆️ Back` → `settings:list`

Section authors do not need to manage the Back button — it is added automatically and deduplicated when already present.

```
Main menu
  ├─ 🧪 Demo submenu ──── [⬆️ Main menu]
  │    └─ Counter ─────── [⬆️ Back → Demo submenu]
  └─ ⚙️ Settings ──────── [⬆️ Main menu]
       └─ Demo settings ─ [⬆️ Back → Settings list]
            └─ toggle ─── [⬆️ Back → Settings list] (via ctx.edit)
```

## 9. Context Ports

### `TelegramSectionContext` — for `render()` and `settings.open()`

```ts
interface TelegramSectionContext {
  sectionId: string;
  chatId: number;
  messageId?: number;
  /** Answer the callback query with an optional popup text */
  answerCallback(text?: string): Promise<void>;
  /** Edit the current message (auto-prepends Back row) */
  edit(view: TelegramSectionView): Promise<void>;
  /** Send a new message (auto-prepends Back row) */
  open(view: TelegramSectionView): Promise<void>;
  /** Enqueue a plain-text prompt turn */
  enqueuePrompt(prompt: string): Promise<void>;
  /** Build a section-namespaced callback_data string */
  callbackData(action: string, payload?: string): string;
}
```

### `TelegramSectionCallbackContext` — for `handleCallback()`

```ts
interface TelegramSectionCallbackContext {
  sectionId: string;
  chatId: number;
  messageId?: number;
  /** The action segment from callback_data */
  action: string;
  /** The payload segment from callback_data */
  payload: string;
  answerCallback(text?: string): Promise<void>;
  edit(view: TelegramSectionView): Promise<void>;
  open(view: TelegramSectionView): Promise<void>;
  enqueuePrompt(prompt: string): Promise<void>;
  callbackData(action: string, payload?: string): string;
}
```

### `enqueuePrompt` semantics

Queues a `[telegram] <prompt>` turn in the default lane with the paired user's `chatId`. Uses `queueMutationRuntime.append()` and triggers `dispatchNextQueuedTelegramTurn()`. The prompt arrives as a normal Telegram-owned turn — the agent sees it as if the user typed it.

### Capability scope

Context ports are intentionally narrow. Sections **cannot**:

- Read/write filesystem
- Access raw process or bot clients
- Start a second poller
- Mutate session state
- Send arbitrary Telegram API calls

Add capability-specific ports only when the first real extension proves the need.

## 10. Telegram Bot API Integration

### `callback_data` contract

Section callbacks use the `section:` prefix owned by `pi-telegram`:

```text
section:0:open                   → open section root
section:0:settings:open          → open settings root
section:0:<action>:<payload>     → forwarded to handleCallback
```

`section:` is listed in `TELEGRAM_OWNED_CALLBACK_PREFIXES` alongside `menu:`, `model:`, `settings:`, `status:`, `tgbtn:`, `thinking:`, `queue:`. Layered extensions must not use this prefix.

### Inline keyboard layout

Section views return `TelegramSectionView.replyMarkup` — a standard `TelegramInlineKeyboardMarkup`. The bridge prepends the Back row and sends the result through `editMessageText` / `sendMessage` with `parse_mode: "HTML"`.

Button labels are not truncated by the bridge. Section authors should keep labels compact for mobile Telegram (under ~30 display-width cells). Use `truncateTelegramButtonLabel` for long dynamic text.

### Stale message handling

If the interactive message has expired (no stored model menu state), the callback receives:

> "Interactive message expired."

This applies to section callbacks as well — the state check runs before dispatch.

## 11. Pi Extension API Inspiration

The platform inherits from π's own extension model:

- `export default function(pi)` → `registerTelegramSection(section)`
- `pi.on("shutdown", ...)` → disposer from `registerTelegramSection`
- Typed imports → typed import from `@llblab/pi-telegram/lib/extension-sections.ts`
- `globalThis` registry → `__piTelegramSectionRegistry__` on `globalThis`
- Identity from `package.json/name` → same identity rules as Locks Standard
- Narrow typed context ports → `TelegramSectionContext` / `TelegramSectionCallbackContext`
- Extension does not own transport → `pi-telegram` owns polling, message lifecycle

## 12. Diagnostics

`getTelegramSectionDiagnostics()` returns:

```ts
interface TelegramSectionDiagnostic {
  id: string;
  token: string;
  label: string;
  status: "active" | "stale" | "error";
  lastError?: string;
}
```

Available through `pi-telegram`'s `/telegram-status` or programmatically via `getTelegramSectionDiagnostics()`.

## 13. Purpose and Non-Goals

### Use sections for:

- File/project explorers
- Prompt/session history viewers
- Tool approval dashboards
- Runtime status panels
- Extension settings or diagnostics
- Human-in-the-loop forms that should not become agent turns

### Do not use sections for:

- Plain agent prompts (use normal queue)
- One-shot assistant-authored buttons (use `telegram_button` outbound comments)
- Command-template pipelines (use inbound/outbound handlers)

### Non-goals:

- No second Telegram poller
- No new pi extension loader
- No generic webview system
- No default filesystem mutation API
- No prompt rollback semantics
- No separate `owner` field while identity key is sufficient

## 14. Relationship to Other Standards

- [Callback Namespaces](./callback-namespaces.md): defines `section:` as pi-telegram-owned prefix. Sections use namespaced callbacks but authors never hand-roll them
- [External Handlers](./external-handlers.md): raw update interception for direct Telegram update access. Sections are the structured UI layer above
- [Extension Locks](../docs/locks.md) (external): same identity key rules (`package.json/name` → canonical id)
- [Command Templates](./command-templates.md): sections do not execute command templates by default. UI registration + callback routing, not shell execution

## 15. Demo Extension

`@llblab/pi-telegram-extension-demo` (`extensions/pi-telegram-extension-demo/`) is the reference implementation:

- Main menu: `🧪 Demo submenu` — enqueue prompt, answer callback, show info, interactive counter
- Settings: `🧪 Demo settings` — ON/OFF toggle with dynamic `getLabel()` status indicator, enqueue from settings
- Navigation: full Back/Main menu hierarchy across all three levels

Use it as a template for new section-based extensions.
