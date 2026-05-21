# UI Style Guide

Small standard for inline buttons, menu rows, state controls, cards, and confirmation dialogs.

## Principles

- Keep UI compact and phone-readable.
- Put emoji where they help scanning, not everywhere.
- Use one strong indicator for current selection; avoid emoji noise on every option.
- Match label casing to control role.
- Prefer minimal, clear configuration UI over exhaustive explanation.
- Preserve domain-owned callback prefixes and behavior in the owning module.

## Action Buttons

Action buttons perform an operation.

Rules:

- Use an emoji plus capitalized action text.
- Prefer direct verb or action noun.
- Keep labels short.

Examples:

- `🗜 Yes, compact`
- `❌ No`
- `🗑 Yes, delete`
- `☑️ Activate`

## State & Navigation Buttons

State buttons show the current state and navigate to a submenu or detail rather than performing an operation directly.

Rules:

- Use an emoji that reflects the current state.
- Use Capitalized, descriptive state text.
- Tapping opens a submenu or returns to the parent list.

Examples:

- `🟢 Active` — model detail, navigates back to model list
- `📌 Proactive push: On` — settings row, opens the toggle submenu
- `👄 Voice reply: Mirror` — settings row, opens the option list

## Boolean Toggles

Boolean settings use a horizontal `On` / `Off` pair, like a checkbox stretched across two buttons.

Rules:

- Keep the pair in one row: `On` left, `Off` right.
- Use Capitalized labels.
- Always show an indicator on both buttons to avoid horizontal label shift.
- Mark active `On` with `🟢`.
- Mark active `Off` with `🟡`.
- Mark the inactive value with `⚫️`.

Examples:

- `🟢 On` / `⚫️ Off`
- `⚫️ On` / `🟡 Off`

## Horizontal Tabs

Tabs or small mutually-exclusive scopes use a horizontal row.

Rules:

- Use Capitalized labels.
- Always show an indicator on every tab to avoid horizontal label shift.
- Use active tab color to convey semantics:
  - `🟣` for the default / normal state (All models, Normal priority).
  - `🟡` for an elevated or filtered state (Scoped models, Priority).
  - `🟣` for neutral navigation controls (page picker).
- Mark inactive tabs with `⚫️`.

Examples:

- `🟡 Scoped` / `⚫️ All`
- `⚫️ Priority` / `🟣 Normal`
- `1` / `🟣 2` / `3`

## Vertical Option Lists

Vertical option lists choose one value from a potentially longer list, for example model selection, thinking level, voice reply mode, or time injection mode.

Rules:

- Put each option on its own row.
- Mark only the current value with `🟢`.
- Leave non-current values without emoji.
- Use lowercase labels when the option is a value.

Examples:

- `🟢 mirror`
- `manual`
- `always`

## Navigation

Inline submenu navigation is hierarchical.

Rules:

- Put the navigation row first.
- First-level submenus opened from the main inline menu start with `⬆️ Main menu`.
- Deeper submenus start with `⬆️ Back`.
- `Main menu` returns to the root inline menu.
- `Back` returns one level up, never directly to the root unless the parent is the root.

Examples:

- Main menu → Settings: first row is `⬆️ Main menu`.
- Settings → Voice reply mode: first row is `⬆️ Back`.

## Message Cards

Message cards sent by the bot should start with a strong heading.

Rules:

- Start with a bold heading or, for dialogs, a bold question.
- Setting detail cards may include an emoji in the heading, then a colon and the current value in `<code>`.
- Explain what the setting does and what the options mean only as much as needed.
- Keep descriptions short and clear.

Examples:

```html
<b>👄 Voice reply mode:</b> <code>mirror</code>
```

```html
<b>Queue</b>
```

## Confirmation Dialogs

Confirmation dialogs protect risky or disruptive actions.

Rules:

- Body text is one bold text-only question.
- Do not put emoji in the dialog question.
- Do not add explanatory body copy unless the risk cannot be understood from the question and action labels.
- Put emoji on the buttons, not in the question.
- Preserve dialog-specific button order by intent.

Example:

```html
<b>Compact session?</b>
```

Buttons:

- `🗜 Yes, compact`
- `❌ No`

## Callback Ownership

UI style does not change callback ownership. Callback prefixes remain owned by their feature domain and must be listed in callback namespace documentation when they become public collision risks.
