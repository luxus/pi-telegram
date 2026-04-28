/**
 * Telegram voice menu helpers
 * Owns inline voice-settings menu rendering and callback action application over voice-domain commands
 */

import {
  planTelegramVoiceMenuAction,
  TELEGRAM_VOICE_MENU_LANGUAGES,
  TELEGRAM_VOICE_MENU_STYLES,
  TELEGRAM_VOICE_MENU_VOICE_IDS,
  type TelegramVoiceMenuCommand,
  type TelegramVoiceMenuSettings,
} from "./voice.ts";

const TELEGRAM_VOICE_MENU_TITLE = "<b>Voice settings</b>";

export type TelegramVoiceMenuReplyMarkup = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

export interface TelegramVoiceMenuRenderPayload {
  nextMode: "voice";
  text: string;
  mode: "html";
  replyMarkup: TelegramVoiceMenuReplyMarkup;
}

export interface TelegramVoiceMenuCallbackDeps {
  getVoiceSettings: () => TelegramVoiceMenuSettings;
  saveVoiceSetting: (command: TelegramVoiceMenuCommand) => Promise<void>;
  updateVoiceMenuMessage: () => Promise<void>;
  updateStatusMessage: () => Promise<void>;
  answerCallbackQuery: (callbackQueryId: string, text?: string) => Promise<void>;
}

export async function handleTelegramVoiceMenuCallbackAction(
  callbackQueryId: string,
  action: { kind: string; action?: string; value?: string },
  deps: TelegramVoiceMenuCallbackDeps,
): Promise<boolean> {
  if (action.kind !== "voice") return false;
  if (action.action === "back") {
    await deps.updateStatusMessage();
    await deps.answerCallbackQuery(callbackQueryId);
    return true;
  }
  const plan = planTelegramVoiceMenuAction(action.action ?? "", action.value);
  if (!plan.handled) return false;
  if (!plan.command) {
    await deps.answerCallbackQuery(callbackQueryId, plan.message);
    return true;
  }
  await deps.saveVoiceSetting(plan.command);
  await deps.updateVoiceMenuMessage();
  await deps.answerCallbackQuery(callbackQueryId, plan.message);
  return true;
}

export function buildTelegramVoiceMenuRenderPayload(
  settings: TelegramVoiceMenuSettings,
): TelegramVoiceMenuRenderPayload {
  return {
    nextMode: "voice",
    text: buildVoiceMenuText(settings),
    mode: "html",
    replyMarkup: buildVoiceMenuReplyMarkup(settings),
  };
}

export function buildVoiceMenuText(settings: TelegramVoiceMenuSettings): string {
  return [
    TELEGRAM_VOICE_MENU_TITLE,
    `Provider: ${settings.provider}`,
    `Voice: ${settings.voiceId ?? "unset"}`,
    `Language: ${settings.language ?? "unset"}`,
    `Reply with voice: ${settings.replyWithVoiceOnIncomingVoice ? "on" : "off"}`,
    `Transcribe incoming: ${settings.autoTranscribeIncoming ? "on" : "off"}`,
    `Text copy: ${settings.alsoSendTextReply ? "on" : "off"}`,
    `Style: ${settings.speechStyle}`,
  ].join("\n");
}

export function buildVoiceMenuReplyMarkup(
  settings: TelegramVoiceMenuSettings,
): TelegramVoiceMenuReplyMarkup {
  return {
    inline_keyboard: [
      [
        {
          text: settings.enabled ? "✅ Voice on" : "Voice on",
          callback_data: "voice:toggle:on",
        },
        {
          text: !settings.enabled ? "✅ Voice off" : "Voice off",
          callback_data: "voice:toggle:off",
        },
      ],
      [
        {
          text: settings.replyWithVoiceOnIncomingVoice
            ? "✅ Reply voice"
            : "Reply voice",
          callback_data: "voice:reply:on",
        },
        {
          text: !settings.replyWithVoiceOnIncomingVoice
            ? "✅ Reply text"
            : "Reply text",
          callback_data: "voice:reply:off",
        },
      ],
      [
        {
          text: settings.autoTranscribeIncoming
            ? "✅ Transcribe"
            : "Transcribe",
          callback_data: "voice:transcribe:on",
        },
        {
          text: !settings.autoTranscribeIncoming
            ? "✅ No transcript"
            : "No transcript",
          callback_data: "voice:transcribe:off",
        },
      ],
      [
        {
          text: settings.alsoSendTextReply ? "✅ Text copy" : "Text copy",
          callback_data: "voice:text:on",
        },
        {
          text: !settings.alsoSendTextReply ? "✅ Voice only" : "Voice only",
          callback_data: "voice:text:off",
        },
      ],
      TELEGRAM_VOICE_MENU_STYLES.map((style) => ({
        text: formatVoiceButtonText(settings.speechStyle, style),
        callback_data: `voice:style:${style}`,
      })),
      TELEGRAM_VOICE_MENU_VOICE_IDS.slice(0, 3).map((voiceId) => ({
        text: formatVoiceButtonText(settings.voiceId, voiceId),
        callback_data: `voice:voice:${voiceId}`,
      })),
      TELEGRAM_VOICE_MENU_VOICE_IDS.slice(3).map((voiceId) => ({
        text: formatVoiceButtonText(settings.voiceId, voiceId),
        callback_data: `voice:voice:${voiceId}`,
      })),
      TELEGRAM_VOICE_MENU_LANGUAGES.map((language) => ({
        text: formatVoiceButtonText(settings.language, language),
        callback_data: `voice:lang:${language}`,
      })),
      [{ text: "⬅️ Back", callback_data: "voice:back" }],
    ],
  };
}

function formatVoiceButtonText(
  current: string | undefined,
  value: string,
  label?: string,
): string {
  const resolvedLabel = label ?? value;
  return current === value ? `✅ ${resolvedLabel}` : resolvedLabel;
}
