# Attachment Handlers

`pi-telegram` can run ordered inbound attachment handlers after downloading files and before the Telegram turn enters the pi queue.

This document is the local adaptation of the portable [Command Template Standard](./command-templates.md).

## Config Shape

`telegram.json` may define `attachmentHandlers`:

```json
{
  "attachmentHandlers": [
    {
      "type": "voice",
      "template": "~/.pi/agent/skills/mistral-stt/scripts/transcribe.mjs {file} {lang} {model}",
      "args": ["file", "lang", "model"],
      "defaults": {
        "lang": "ru",
        "model": "voxtral-mini-latest"
      }
    },
    {
      "mime": "audio/*",
      "template": "~/.pi/agent/skills/groq-stt/scripts/transcribe.mjs {file} {lang} {model}",
      "args": ["file", "lang", "model"],
      "defaults": {
        "lang": "ru",
        "model": "whisper-large-v3-turbo"
      }
    }
  ]
}
```

Handlers match by `type`, `mime`, or `match`. Wildcards such as `audio/*` are accepted. Each matching handler must provide a `template`; optional `args` and `defaults` document or fill placeholder values.

## Template Placeholders

Attachment handlers support these built-in placeholders:

| Placeholder | Value                                                            |
| ----------- | ---------------------------------------------------------------- |
| `{file}`    | Full local path to the downloaded file                           |
| `{mime}`    | MIME type if known                                               |
| `{type}`    | Attachment kind such as `voice`, `audio`, `document`, or `photo` |

`defaults` may provide additional placeholder values such as `{lang}` or `{model}`. `args` documents supported placeholders and may also encode defaults in compact form, for example `"file,lang=ru,model=voxtral-mini-latest"`.

If a template has no `{file}` placeholder, the downloaded file path is appended as the last command arg.

## Ordered Fallbacks

A handler list is ordered. For each attachment, matching handlers run in list order and stop after the first successful handler.

If a matching handler fails with a non-zero exit code, the runtime records diagnostics and tries the next matching handler. If every matching handler fails, the attachment remains visible in the prompt as a normal local file reference.

## Prompt Output

Local attachments stay in the prompt under `[attachments] <directory>` with relative file entries. Successful handler stdout is added under `[outputs]`. Empty output and failed handler output are omitted from the prompt text.
