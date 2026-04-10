# Changelog

## Current

- `[Controls]` Expanded Telegram session controls with a richer `/status` view, inline model selection, and thinking-level controls. Impact: more bridge configuration can be managed directly from Telegram.
- `[Queue]` Upgraded Telegram turn queueing with previews, reaction-driven prioritization/removal, media-group handling, aborted-turn history preservation, and safer dispatch gating. Impact: follow-up handling is more transparent and less prone to lifecycle races.
- `[Rendering]` Added Telegram-oriented Markdown rendering and hardened reply streaming/chunking behavior. Impact: formatted replies render more reliably while preserving literal code blocks.
- `[Runtime]` Hardened attachment delivery, polling/runtime behavior, and Telegram session integration. Impact: the bridge is more robust as a daily Telegram frontend for pi.
- `[Metadata]` Updated package repository metadata to point at the `llblab/pi-telegram` fork. Impact: published package links no longer send users to stale upstream coordinates.
- `[Validation]` Added lightweight regression tests for Telegram Markdown rendering and queue/compaction dispatch guards. Impact: key renderer and queue invariants now have repeatable automated coverage.
- `[Model Switching]` Enabled `/model` during an active Telegram-owned run by applying the new model and continuing on the new model automatically, delaying the abort until the current tool finishes when needed. Impact: Telegram can now approximate pi's manual stop-switch-continue workflow with fewer mid-tool aborts.
- `[Setup]` `/telegram-setup` now shows the stored bot token first, otherwise prefills from common Telegram bot environment variables before falling back to the placeholder, using an actual prefilled editor when a real default exists. Impact: repeat setup respects local saved state while first-run and secret-managed setup stay fast.
