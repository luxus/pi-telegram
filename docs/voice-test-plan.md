# Telegram Voice Test Plan

Manual validation plan for Telegram voice-message support.

## Preconditions

- Telegram bot already paired with current pi session
- Voice provider configured (`xai` for current implementation)
- API key available in `XAI_API_KEY`, `./.pi/settings.json`, or `~/.pi/agent/settings.json`
- Optional for Opus fallback: `ffmpeg` installed and available on `PATH`

## Recommended Baseline Setup

Voice support is enabled by default when the configured provider is locally available. For the built-in xAI provider, this means `XAI_API_KEY` or `xai.apiKey` is configured. Run in pi only to customize the baseline:

```text
/telegram-voice reply on
/telegram-voice transcribe on
/telegram-voice provider xai
# or, when pi-xai-voice is installed:
/telegram-voice provider pi-xai-voice
# or, when pi-elevenlabs is installed for TTS-only replies:
/telegram-voice provider pi-elevenlabs
/telegram-voice voice eve
/telegram-voice lang auto
/telegram-voice style rewrite-light
```

Confirm `/telegram-status` shows voice enabled. If provider credentials are missing, configure them first. If a previous config disabled voice, run `/telegram-voice on` once.

## Scenario 1 — Inbound Voice → Automatic Voice Reply

1. Send a short Telegram voice note such as: "Erzähl mir bitte eine kurze Geschichte."
2. Verify pi receives a Telegram prompt with voice modality and transcript context.
3. Wait for final reply.
4. Expected:
   - assistant replies as Telegram voice note
   - no duplicate plain-text reply unless `alsoSendTextReply` enabled
   - reply sounds natural and meaning matches request

## Scenario 2 — Explicit Agent-Requested Voice Reply

1. Send plain text in Telegram: "Schick mir bitte eine Sprachnachricht und erzähl mir einen Witz."
2. Expected:
   - agent may call `telegram_send_voice`
   - Telegram receives spoken reply as voice note
   - optional text copy only when enabled or explicitly requested

## Scenario 3 — MP3 Voice Delivery Path

1. Send a short voice note in Telegram.
2. Expected:
   - bridge sends MP3 voice note through `sendVoice`
   - spoken reply arrives successfully

## Scenario 4 — Text Copy Toggle

1. In pi run:

```text
/telegram-voice text on
```

2. Send Telegram voice note.
3. Expected:
   - Telegram receives voice note reply
   - Telegram also receives text reply copy
4. Reset with:

```text
/telegram-voice text off
```

## Scenario 5 — Transcription Toggle

1. In pi run:

```text
/telegram-voice transcribe off
```

2. Send Telegram voice note.
3. Expected:
   - no STT transcript attached to prompt
   - voice file still preserved as local attachment path
4. Reset with:

```text
/telegram-voice transcribe on
```

## Scenario 6 — Prompt Customization

1. In pi run:

```text
/telegram-voice prompt
```

2. Replace prompt with a custom spoken-style instruction.
3. Send Telegram voice note.
4. Expected:
   - spoken output follows custom rewrite style
   - factual meaning stays intact
5. Reset prompt with:

```text
/telegram-voice prompt reset
```

## Failure Checks

When validating failures, confirm bridge degrades safely:

- STT failure → prompt still proceeds, transcription error noted, text fallback remains possible
- TTS failure → user receives text fallback plus short failure notice
- direct MP3 send failure → user gets a visible error or normal text fallback instead of a silent broken reply
- unsupported provider id → clear error instead of silent failure

## Quick Smoke Checklist

- [ ] `/telegram-voice status` shows expected provider, voice, language, and style
- [ ] inbound voice note transcribes
- [ ] inbound voice note auto-replies with voice
- [ ] plain-text request can trigger `telegram_send_voice`
- [ ] MP3 voice delivery tested
- [ ] custom speech prompt tested
- [ ] text-copy toggle tested
