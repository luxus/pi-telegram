/**
 * Regression tests for Telegram voice menu helpers
 * Covers inline voice-settings rendering and callback action application over voice-domain commands
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTelegramVoiceMenuRenderPayload,
  handleTelegramVoiceMenuCallbackAction,
} from "../lib/voice-menu.ts";
import { getDefaultTelegramVoiceMenuSettings } from "../lib/voice.ts";

test("Voice menu renders settings into a Telegram inline menu payload", () => {
  const payload = buildTelegramVoiceMenuRenderPayload({
    ...getDefaultTelegramVoiceMenuSettings(),
    enabled: true,
    provider: "pi-xai-voice",
    replyWithVoiceOnIncomingVoice: true,
    autoTranscribeIncoming: true,
    voiceId: "ara",
    language: "de",
    speechStyle: "rewrite-tags",
  });

  assert.equal(payload.nextMode, "voice");
  assert.equal(payload.mode, "html");
  assert.match(payload.text, /Provider: pi-xai-voice/);
  assert.match(payload.text, /Voice: ara/);
  assert.equal(payload.replyMarkup.inline_keyboard[0]?.[0]?.text, "✅ Voice on");
  assert.equal(
    payload.replyMarkup.inline_keyboard.at(-1)?.[0]?.callback_data,
    "voice:back",
  );
});

test("Voice menu applies callback plans through voice setting ports", async () => {
  const saved: unknown[] = [];
  const answered: Array<string | undefined> = [];
  let updates = 0;
  const handled = await handleTelegramVoiceMenuCallbackAction(
    "cb-1",
    { kind: "voice", action: "text", value: "off" },
    {
      getVoiceSettings: getDefaultTelegramVoiceMenuSettings,
      saveVoiceSetting: async (command) => {
        saved.push(command);
      },
      updateVoiceMenuMessage: async () => {
        updates += 1;
      },
      updateStatusMessage: async () => {},
      answerCallbackQuery: async (_id, text) => {
        answered.push(text);
      },
    },
  );

  assert.equal(handled, true);
  assert.deepEqual(saved, [{ action: "text", enabled: false }]);
  assert.equal(updates, 1);
  assert.deepEqual(answered, ["Voice only"]);
});

test("Voice menu routes back to the status menu without saving", async () => {
  let statusUpdates = 0;
  let saves = 0;
  const handled = await handleTelegramVoiceMenuCallbackAction(
    "cb-1",
    { kind: "voice", action: "back" },
    {
      getVoiceSettings: getDefaultTelegramVoiceMenuSettings,
      saveVoiceSetting: async () => {
        saves += 1;
      },
      updateVoiceMenuMessage: async () => {},
      updateStatusMessage: async () => {
        statusUpdates += 1;
      },
      answerCallbackQuery: async () => {},
    },
  );

  assert.equal(handled, true);
  assert.equal(saves, 0);
  assert.equal(statusUpdates, 1);
});
