# Project Backlog

## Open Work

- [ ] Explore always-available outbound Telegram tools for queued artifacts and controls.
  - Priority: Low.
  - Idea: Provide tools such as `telegram_attach_file` and `telegram_attach_button` that can be called outside an active Telegram turn, using the paired chat/session as the delivery target when safe.
  - Exit: Design note defines active-turn versus ambient delivery semantics, safety constraints, failure modes, and whether the current `telegram_attach` contract should stay turn-scoped or gain an ambient companion.
