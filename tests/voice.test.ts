/**
 * Regression tests for Telegram voice helpers
 * Covers config normalization, command parsing, speech cleanup, and voice status rendering
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionCommandContext } from "../lib/pi.ts";

import {
  createTelegramVoiceRuntime,
  getTelegramVoicePromptChatAction,
} from "../lib/voice-runtime.ts";
import {
  ELEVENLABS_SPEECH_TAGS,
  XAI_ALLOWED_SPEECH_TAGS,
  buildSpeechPreparationPrompt,
  formatTelegramVoiceStatus,
  inferTelegramVoiceLanguage,
  normalizeTelegramVoiceSettings,
  parseTelegramVoiceCommand,
  prepareTelegramSpeechText,
  resolveTelegramVoiceLanguage,
  stripMarkdownForSpeech,
  normalizeTelegramVoiceLanguage,
  planTelegramVoiceMenuAction,
  resolveTelegramVoiceMenuSettings,
  resolveTelegramVoiceSettings,
  updateTelegramVoiceConfig,
  registerTelegramVoiceTool,
} from "../lib/voice.ts";

test("Voice helpers normalize settings with defaults", () => {
  const settings = normalizeTelegramVoiceSettings(
    {
      enabled: true,
      alsoSendTextReply: true,
      provider: "xai",
    },
    {
      defaultVoiceId: "eve",
      defaultLanguage: "de",
      sttLanguage: "de",
    },
  );
  assert.deepEqual(settings, {
    enabled: true,
    provider: "xai",
    providerOptions: {},
    autoTranscribeIncoming: true,
    replyWithVoiceOnIncomingVoice: true,
    alsoSendTextReply: true,
    defaultVoiceId: "eve",
    defaultLanguage: "de",
    sttLanguage: "de",
    speechStyle: "literal",
    speechPreparationPrompt: settings.speechPreparationPrompt,
  });
});

test("Voice helpers enable voice by default when provider is available", () => {
  const settings = normalizeTelegramVoiceSettings(undefined, {
    enabled: true,
    defaultVoiceId: "eve",
    defaultLanguage: "de",
    sttLanguage: "de",
  });
  assert.equal(settings.enabled, true);
  assert.equal(settings.autoTranscribeIncoming, true);
  assert.equal(settings.replyWithVoiceOnIncomingVoice, true);
});

test("Voice helpers disable voice by default when provider is unavailable", () => {
  const settings = normalizeTelegramVoiceSettings(undefined, {
    enabled: false,
  });
  assert.equal(settings.enabled, false);
  assert.equal(settings.autoTranscribeIncoming, false);
  assert.equal(settings.replyWithVoiceOnIncomingVoice, false);
});

test("Voice helpers respect explicit disabled config", () => {
  const settings = normalizeTelegramVoiceSettings({ enabled: false }, { enabled: true });
  assert.equal(settings.enabled, false);
  assert.equal(settings.autoTranscribeIncoming, false);
  assert.equal(settings.replyWithVoiceOnIncomingVoice, false);
});

test("Voice helpers resolve provider availability from local xAI config", () => {
  const previous = process.env.XAI_API_KEY;
  process.env.XAI_API_KEY = "test-key";
  try {
    const settings = resolveTelegramVoiceSettings({}, process.cwd());
    assert.equal(settings.enabled, true);
  } finally {
    if (previous === undefined) {
      delete process.env.XAI_API_KEY;
    } else {
      process.env.XAI_API_KEY = previous;
    }
  }
});

test("Voice helpers parse commands", () => {
  assert.deepEqual(parseTelegramVoiceCommand(""), { action: "status" });
  assert.deepEqual(parseTelegramVoiceCommand("on"), {
    action: "toggle",
    enabled: true,
  });
  assert.deepEqual(parseTelegramVoiceCommand("text off"), {
    action: "text",
    enabled: false,
  });
  assert.deepEqual(parseTelegramVoiceCommand("reply on"), {
    action: "reply",
    enabled: true,
  });
  assert.deepEqual(parseTelegramVoiceCommand("transcribe off"), {
    action: "transcribe",
    enabled: false,
  });
  assert.deepEqual(parseTelegramVoiceCommand("voice ara"), {
    action: "voice",
    voiceId: "ara",
  });
  assert.deepEqual(parseTelegramVoiceCommand("lang de"), {
    action: "language",
    language: "de",
  });
  assert.deepEqual(parseTelegramVoiceCommand("provider xai"), {
    action: "provider",
    provider: "xai",
  });
  assert.deepEqual(parseTelegramVoiceCommand("provider pi-xai-voice"), {
    action: "provider",
    provider: "pi-xai-voice",
  });
  assert.deepEqual(parseTelegramVoiceCommand("provider pi-elevenlabs"), {
    action: "provider",
    provider: "pi-elevenlabs",
  });
  assert.deepEqual(parseTelegramVoiceCommand("style rewrite-tags"), {
    action: "style",
    style: "rewrite-tags",
  });
  assert.deepEqual(parseTelegramVoiceCommand("style rewrite-strong"), {
    action: "style",
    style: "rewrite-strong",
  });
  assert.deepEqual(parseTelegramVoiceCommand("prompt"), {
    action: "prompt",
  });
  assert.deepEqual(parseTelegramVoiceCommand("prompt reset"), {
    action: "prompt-reset",
  });
  assert.equal(parseTelegramVoiceCommand("delivery mp3"), undefined);
  assert.equal(parseTelegramVoiceCommand("delivery nope"), undefined);
});

test("Voice helpers clean markdown for spoken output", () => {
  const spoken = stripMarkdownForSpeech(
    "# Titel\n\n- Punkt\n- `code`\n\n[Link](https://example.com)",
  );
  assert.equal(spoken, "Titel\n\nPunkt\ncode\n\nLink");
});

test("Voice helpers strip emojis but keep speech tags", () => {
  const spoken = stripMarkdownForSpeech(
    "✅ Great job 😂 [pause] <whisper>secret</whisper> 🎙️",
  );
  assert.equal(spoken, "Great job [pause] <whisper>secret</whisper>");
});

test("Voice helpers normalize and infer spoken language", () => {
  assert.equal(normalizeTelegramVoiceLanguage("German"), "de");
  assert.equal(normalizeTelegramVoiceLanguage("ar-EG"), "ar-EG");
  assert.equal(normalizeTelegramVoiceLanguage("Spanish"), "es-ES");
  assert.equal(normalizeTelegramVoiceLanguage("pt-PT"), "pt-PT");
  assert.equal(normalizeTelegramVoiceLanguage("en"), "en");
  assert.equal(inferTelegramVoiceLanguage("Das ist eine kleine Geschichte und sie ist schön."), "de");
  assert.equal(inferTelegramVoiceLanguage("This is a little story and it is nice."), "en");
  assert.equal(
    resolveTelegramVoiceLanguage({
      text: "Das ist eine kleine Geschichte und sie ist schön.",
      requestedLanguage: "en",
    }),
    "de",
  );
  assert.equal(
    resolveTelegramVoiceLanguage({
      text: "???",
      requestedLanguage: "de",
      transcriptLanguage: "English",
    }),
    "en",
  );
});

test("Voice helpers project menu settings and plan inline menu actions", () => {
  const menuSettings = resolveTelegramVoiceMenuSettings(
    normalizeTelegramVoiceSettings({
      enabled: true,
      autoTranscribeIncoming: true,
      replyWithVoiceOnIncomingVoice: true,
      alsoSendTextReply: true,
      provider: "pi-xai-voice",
      defaultVoiceId: "ara",
      defaultLanguage: "de",
      speechStyle: "rewrite-light",
    }),
  );
  assert.deepEqual(menuSettings, {
    enabled: true,
    provider: "pi-xai-voice",
    replyWithVoiceOnIncomingVoice: true,
    autoTranscribeIncoming: true,
    alsoSendTextReply: true,
    voiceId: "ara",
    language: "de",
    speechStyle: "rewrite-light",
  });
  assert.deepEqual(planTelegramVoiceMenuAction("reply", "off"), {
    handled: true,
    command: { action: "reply", enabled: false },
    message: "Reply with text",
  });
  assert.deepEqual(planTelegramVoiceMenuAction("style", "rewrite-tags"), {
    handled: true,
    command: { action: "style", style: "rewrite-tags" },
    message: "Style: rewrite-tags",
  });
  assert.deepEqual(planTelegramVoiceMenuAction("toggle", "bad"), {
    handled: true,
    message: "Invalid voice mode.",
  });
});

test("Voice runtime marks voice-only turns to suppress text previews", async () => {
  const runtime = createTelegramVoiceRuntime<
    {
      message_id: number;
      chat: { id: number };
      voice?: { file_id: string; mime_type?: string };
    },
    ExtensionCommandContext
  >({
    getConfig: () => ({
      voice: {
        enabled: true,
        replyWithVoiceOnIncomingVoice: true,
        alsoSendTextReply: false,
      },
    }),
    setConfig: () => {},
    updateConfig: () => {},
    persistConfig: async () => {},
    updateStatus: () => {},
    call: async <TResponse>() => true as TResponse,
    callMultipart: async <TResponse>() => true as TResponse,
    getActiveTurn: () => undefined,
    getProactiveChatId: () => undefined,
    clearPreview: async () => {},
    downloadFile: async (_fileId, fileName) => `/tmp/${fileName}`,
    allocateQueueOrder: () => 1,
    cwd: () => "/work",
  });
  const turn = await runtime.createTurn([
    {
      message_id: 3,
      chat: { id: 7 },
      voice: { file_id: "voice-1", mime_type: "audio/ogg" },
    },
  ]);

  assert.equal(turn.replyModality, "voice-required");
  assert.equal(turn.skipFinalTextReply, true);
});

test("Voice runtime selects record_voice chat action for required voice replies", () => {
  assert.equal(getTelegramVoicePromptChatAction(undefined), "typing");
  assert.equal(getTelegramVoicePromptChatAction({ replyModality: "text" }), "typing");
  assert.equal(
    getTelegramVoicePromptChatAction({ replyModality: "voice-required" }),
    "record_voice",
  );
});

test("Voice helpers update config and format status", () => {
  const updated = updateTelegramVoiceConfig(
    { voice: { enabled: true } },
    { action: "voice", voiceId: "ara" },
  );
  assert.equal(updated.voice?.defaultVoiceId, "ara");
  const status = formatTelegramVoiceStatus(
    normalizeTelegramVoiceSettings(updated.voice, {
      defaultVoiceId: "eve",
      defaultLanguage: "de",
    }),
  );
  assert.match(status, /voice: on/);
  assert.match(status, /provider: xai/);
  assert.match(status, /voice: ara/);
  assert.match(status, /prompt: default/);
});

test("Voice helpers enable transcription and voice replies for STT plus TTS providers", () => {
  const settings = normalizeTelegramVoiceSettings(
    { provider: "pi-elevenlabs" },
    {
      enabled: true,
      canTranscribe: true,
      canSynthesize: true,
      defaultVoiceId: "JBFqnCBsd6RMkjVDRZzb",
      sttLanguage: "eng",
    },
  );
  assert.equal(settings.enabled, true);
  assert.equal(settings.autoTranscribeIncoming, true);
  assert.equal(settings.replyWithVoiceOnIncomingVoice, true);
  assert.equal(settings.sttLanguage, "eng");
});

test("Voice helpers preserve ElevenLabs audio tags through provider preparation", async () => {
  assert.equal(ELEVENLABS_SPEECH_TAGS.includes("[laughs]"), true);
  const settings = normalizeTelegramVoiceSettings({
    enabled: true,
    provider: "pi-elevenlabs",
    speechStyle: "rewrite-tags",
  });
  const prepared = await prepareTelegramSpeechText({
    text: "Hello [pause] <whisper>world</whisper> [laugh]",
    settings,
    language: "de",
  });
  assert.match(prepared.speechText, /\[pause\]/);
  assert.match(prepared.speechText, /\[whispers\] world/);
  assert.match(prepared.speechText, /\[laughs\]/);
  assert.doesNotMatch(prepared.speechText, /<whisper>/);
});

test("Voice helpers preserve xAI tags through pi-xai-voice provider preparation", async () => {
  const settings = normalizeTelegramVoiceSettings({
    enabled: true,
    provider: "pi-xai-voice",
    speechStyle: "rewrite-tags",
  });
  const prepared = await prepareTelegramSpeechText({
    text: "Hallo [pause] <soft>Welt</soft>",
    settings,
    language: "de",
  });
  assert.match(prepared.speechText, /\[pause\]/);
  assert.match(prepared.speechText, /<soft>Welt<\/soft>/);
});

test("Voice helpers build configurable preparation prompts and provider rewrite", async () => {
  const settings = normalizeTelegramVoiceSettings(
    {
      enabled: true,
      speechStyle: "rewrite-tags",
      speechPreparationPrompt:
        "Provider {provider} / {tagStyle} / {language} / {inputModality} / {speechStyle}: {text}",
    },
    {
      defaultVoiceId: "eve",
      defaultLanguage: "de",
    },
  );
  const prompt = buildSpeechPreparationPrompt({
    settings,
    inputModality: "voice",
    language: "de",
    tagStyle: "xai",
    text: "Hallo **Welt**",
  });
  assert.equal(
    prompt,
    "Provider xai / xai / de / voice / rewrite-tags: Hallo **Welt**",
  );
  const prepared = await prepareTelegramSpeechText({
    text: "## Hallo\n\nWelt",
    settings,
    inputModality: "voice",
    language: "de",
  });
  assert.match(prepared.speechText, /Hallo/);
  assert.match(prepared.speechText, /\[pause\]/);
});

test("Voice helpers default prompt lists allowed tags and forbids invented tags", () => {
  const settings = normalizeTelegramVoiceSettings(
    {
      enabled: true,
      provider: "xai",
      speechStyle: "rewrite-tags",
    },
    {
      defaultVoiceId: "eve",
      defaultLanguage: "en",
    },
  );
  const prompt = buildSpeechPreparationPrompt({
    settings,
    inputModality: "voice",
    language: "en",
    tagStyle: "xai",
    text: "Tell me a funny story.",
  });
  assert.match(prompt, /Allowed tags:/);
  assert.equal(settings.provider, "xai");
  for (const tag of XAI_ALLOWED_SPEECH_TAGS) {
    assert.match(prompt, new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(prompt, /\[giggle\]/);
  assert.match(prompt, /<laugh-speak>\.\.\.<\/laugh-speak>/);
  assert.match(prompt, /<emphasis>\.\.\.<\/emphasis>/);
  assert.match(prompt, /\[gasp\]/);
  assert.match(prompt, /<happy>\.\.\.<\/happy>/);
  assert.match(prompt, /Never invent new tags/);
  assert.match(prompt, /Do not use emojis/);
  assert.match(prompt, /2 to 5 natural tags/);
  assert.match(prompt, /3 to 8 natural tags/);
});

test("Voice helpers preserve existing xAI tags and add fallback tags when missing", async () => {
  const settings = normalizeTelegramVoiceSettings(
    {
      enabled: true,
      speechStyle: "rewrite-tags",
    },
    {
      defaultVoiceId: "eve",
      defaultLanguage: "de",
    },
  );
  const tagged = await prepareTelegramSpeechText({
    text: "Hallo [pause] Welt",
    settings,
    inputModality: "voice",
    language: "de",
  });
  assert.equal(tagged.speechText, "Hallo [pause] Welt");
  const fallback = await prepareTelegramSpeechText({
    text: "Hallo\n\nWelt",
    settings,
    inputModality: "voice",
    language: "de",
  });
  assert.match(fallback.speechText, /\[pause\]/);
});

test("Voice helpers strip unsupported invented speech tags but keep allowed ones", async () => {
  const settings = normalizeTelegramVoiceSettings(
    {
      enabled: true,
      speechStyle: "rewrite-tags",
    },
    {
      defaultVoiceId: "eve",
      defaultLanguage: "en",
    },
  );
  const prepared = await prepareTelegramSpeechText({
    text: "<whisper>secret</whisper> [pause] <made-up>tag</made-up> [custom-tag]",
    settings,
    inputModality: "voice",
    language: "en",
  });
  assert.equal(prepared.speechText, "<whisper>secret</whisper> [pause] tag");
});

test("Voice helpers support stronger expressive tag mode", async () => {
  const settings = normalizeTelegramVoiceSettings(
    {
      enabled: true,
      speechStyle: "rewrite-strong",
    },
    {
      defaultVoiceId: "eve",
      defaultLanguage: "en",
    },
  );
  const prepared = await prepareTelegramSpeechText({
    text: "Why did the ghost fail at lying? Because everyone could see right through it.",
    settings,
    inputModality: "voice",
    language: "en",
  });
  assert.match(prepared.speechText, /\[(laugh|giggle|pause|long-pause)\]|<(slow|soft|emphasis|laugh-speak)>/);
});

test("Voice tool registration sends Telegram voice replies", async () => {
  let registeredTool:
    | {
        name?: string;
        execute: (
          toolCallId: string,
          params: {
            text: string;
            voiceId?: string;
            language?: string;
            alsoSendText?: boolean;
          },
        ) => Promise<{ details: { voiceId?: string; language?: string; alsoSendText: boolean } }>;
      }
    | undefined;
  const api = {
    registerTool(definition: typeof registeredTool) {
      registeredTool = definition;
    },
  } as unknown as ExtensionAPI;
  const calls: Array<{
    text: string;
    voiceId?: string;
    language?: string;
    alsoSendText?: boolean;
    proactiveChatId?: number;
  }> = [];
  registerTelegramVoiceTool(api, {
    getActiveTurn: () =>
      ({
        explicitTextCopyRequested: true,
      }) as Parameters<Parameters<typeof registerTelegramVoiceTool>[1]["shouldKeepTextReply"]>[0],
    getProactiveChatId: () => 123,
    getDefaultVoiceSettings: () =>
      ({
        enabled: true,
        provider: "xai",
        providerOptions: {},
        autoTranscribeIncoming: true,
        replyWithVoiceOnIncomingVoice: true,
        alsoSendTextReply: false,
        defaultVoiceId: "eve",
        defaultLanguage: "de",
        speechStyle: "literal",
      }) satisfies ReturnType<Parameters<typeof registerTelegramVoiceTool>[1]["getDefaultVoiceSettings"]>,
    shouldKeepTextReply: (_turn, alsoSendText) => alsoSendText === true,
    sendVoiceReply: async (options) => {
      calls.push(options);
    },
  });
  assert.equal(registeredTool?.name, "telegram_send_voice");
  const result = await registeredTool!.execute("tool-call", {
    text: "Hallo",
    alsoSendText: true,
  });
  assert.deepEqual(calls, [
    {
      text: "Hallo",
      voiceId: "eve",
      language: "de",
      alsoSendText: true,
      proactiveChatId: 123,
    },
  ]);
  assert.deepEqual(result.details, {
    voiceId: "eve",
    language: "de",
    alsoSendText: true,
    error: undefined,
  });
});
