# Preference Bus

Extension preference and prompt guidance bus for `pi-telegram`.

## Purpose

Layered extensions inject boolean or select preferences into the Telegram `/settings` menu and conditional prompt guidance into the `before_agent_start` hook without modifying `pi-telegram`.

Uses the same `globalThis` registry pattern as `external-handlers.ts`.

## Toggle preference

```typescript
import { registerTelegramPreference } from "@llblab/pi-telegram/lib/preference-bus.ts";

const off = registerTelegramPreference("xai", "voicePreferred", {
  kind: "toggle",
  label: "Voice replies",
  get: () => config.xai.voice.replyMode === "voice",
  set: async (enabled) => {
    config.xai.voice.replyMode = enabled ? "voice" : "text";
    await saveConfig();
  },
});
```

## Select preference

```typescript
const off = registerTelegramPreference("xai", "ttsVoice", {
  kind: "select",
  label: "TTS Voice",
  options: ["eve", "alloy", "shimmer"],
  get: () => config.xai.voice.defaultVoice,
  set: async (voice) => {
    config.xai.voice.defaultVoice = voice;
    await saveConfig();
  },
});
```

Registered preferences appear in:
- Telegram `/settings` inline menu
- Pi-side `/telegram-settings` command

## Prompt guidance registry

```typescript
import { registerTelegramPromptGuidance } from "@llblab/pi-telegram/lib/preference-bus.ts";

const off = registerTelegramPromptGuidance("xai-voice", {
  condition: () => config.xai.voice.replyMode === "voice",
  text: "The user prefers spoken replies. Include telegram_voice markup when appropriate.",
});
```

Registered guidance is appended to the system prompt at `before_agent_start` when `condition()` returns true.

## Zero-coupling bootstrap

If `@llblab/pi-telegram` is not importable, reach the registry directly:

```typescript
const prefRegistry = (globalThis as any).__piTelegramPreferences__;
if (prefRegistry?.version === 1) {
  prefRegistry.add("xai", "voicePreferred", { kind: "toggle", label, get, set });
}
```

## Cleanup

Both `registerTelegramPreference` and `registerTelegramPromptGuidance` return disposer functions. Call them on shutdown or extension unload.
