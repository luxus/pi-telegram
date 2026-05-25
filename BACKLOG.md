# Project Backlog

## Bound inbound handler output

`Task`: Bound inbound handler stdout, stderr, and recorded failure text before they enter prompts or runtime status.

`Why`: Large OCR, PDF, STT, or failing command output can inflate prompt context, memory use, and `/telegram-status`.

`Exit criteria`:

- Handler stdout added to `[outputs]` is truncated or externalized behind a bounded artifact reference.
- Handler stderr and stdout included in failure messages are bounded.
- Runtime event messages and details are bounded before storage and rendering.
- Regression tests cover large handler stdout and large failure output.

## Recover from invalid config JSON

`Task`: Make `telegram.json` load failures recoverable without bricking pi-telegram session startup.

`Why`: A hand-edited or partially written invalid config currently bubbles `JSON.parse` failure through session start, which can block the normal repair path.

`Exit criteria`:

- Invalid config JSON is reported through a runtime event or clear status diagnostic.
- Session startup continues with safe empty config defaults.
- The invalid file is preserved or renamed for operator recovery.
- `/telegram-setup` remains usable after an invalid config is detected.
- Regression tests cover invalid config startup behavior.
