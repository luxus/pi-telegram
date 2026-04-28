/**
 * Telegram voice runtime wiring helpers
 * Owns voice-specific config, transcription, synthesis, and prompt-turn preparation ports used by the extension composition root
 */

import { rm } from "node:fs/promises";

import type { TelegramConfig } from "./config.ts";
import * as Media from "./media.ts";
import type { ExtensionCommandContext } from "./pi.ts";
import type { PendingTelegramTurn } from "./queue.ts";
import * as Turns from "./turns.ts";
import * as Voice from "./voice.ts";

export type TelegramVoicePromptChatAction = "typing" | "record_voice";

export function getTelegramVoicePromptChatAction(
  turn: Pick<PendingTelegramTurn, "replyModality"> | undefined,
): TelegramVoicePromptChatAction {
  return turn?.replyModality === "voice-required" ? "record_voice" : "typing";
}

export interface TelegramVoiceRuntimeDeps<TMessage extends Media.TelegramMediaMessage & Turns.TelegramTurnMessage, TContext extends ExtensionCommandContext> {
  getConfig: () => TelegramConfig;
  setConfig: (config: TelegramConfig) => void;
  updateConfig: (mutate: (config: TelegramConfig) => void) => void;
  persistConfig: () => Promise<void>;
  updateStatus: (ctx: TContext) => void;
  call: <TResponse>(method: string, body: Record<string, unknown>) => Promise<TResponse>;
  callMultipart: <TResponse>(
    method: string,
    fields: Record<string, string>,
    fileField: string,
    filePath: string,
    fileName: string,
  ) => Promise<TResponse>;
  getActiveTurn: () => PendingTelegramTurn | undefined;
  getProactiveChatId: () => number | undefined;
  clearPreview: (chatId: number) => Promise<void>;
  downloadFile: (fileId: string, fileName: string) => Promise<string>;
  allocateQueueOrder: () => number;
  cwd: () => string;
}

export interface TelegramVoiceRuntime<TMessage extends Media.TelegramMediaMessage & Turns.TelegramTurnMessage> {
  getVoiceSettings: (cwd: string) => Voice.ResolvedTelegramVoiceSettings;
  getDefaultVoiceSettings: () => Voice.ResolvedTelegramVoiceSettings;
  shouldKeepTextReply: (
    turn: Pick<PendingTelegramTurn, "explicitTextCopyRequested">,
    alsoSendText?: boolean,
  ) => boolean;
  sendVoiceReply: (options: {
    text: string;
    voiceId?: string;
    language?: string;
    alsoSendText?: boolean;
    proactiveChatId?: number;
  }) => Promise<void>;
  handleVoiceCommand: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
  createTurn: (
    messages: TMessage[],
    historyTurns?: PendingTelegramTurn[],
  ) => Promise<PendingTelegramTurn>;
  beforeFinalTextReply: (turn: PendingTelegramTurn, finalText: string) => Promise<void>;
}

export function createTelegramVoiceRuntime<
  TMessage extends Media.TelegramMediaMessage & Turns.TelegramTurnMessage,
  TContext extends ExtensionCommandContext = ExtensionCommandContext,
>(deps: TelegramVoiceRuntimeDeps<TMessage, TContext>): TelegramVoiceRuntime<TMessage> {
  function getVoiceSettings(cwd: string): Voice.ResolvedTelegramVoiceSettings {
    return Voice.resolveTelegramVoiceSettings(deps.getConfig(), cwd);
  }

  function shouldKeepTextReply(
    turn: Pick<PendingTelegramTurn, "explicitTextCopyRequested">,
    alsoSendText?: boolean,
  ): boolean {
    return alsoSendText === true && turn.explicitTextCopyRequested === true;
  }

  async function sendTelegramVoiceReply(options: {
    chatId: number;
    replyToMessageId?: number;
    text: string;
    cwd: string;
    voiceId?: string;
    language?: string;
    inputModality?: PendingTelegramTurn["inputModality"];
    transcriptLanguage?: PendingTelegramTurn["voiceTranscriptLanguage"];
  }): Promise<void> {
    const settings = getVoiceSettings(options.cwd);
    const language = Voice.resolveTelegramVoiceLanguage({
      text: options.text,
      requestedLanguage: options.language || settings.defaultLanguage,
      transcriptLanguage: options.transcriptLanguage,
    });
    await deps.call("sendChatAction", {
      chat_id: options.chatId,
      action: "record_voice",
    }).catch(() => undefined);
    const delivery = await Voice.synthesizeTelegramVoiceReply({
      cwd: options.cwd,
      text: options.text,
      voiceId: options.voiceId || settings.defaultVoiceId,
      language,
      settings,
      inputModality: options.inputModality,
    });
    try {
      await deps.callMultipart(
        delivery.method,
        {
          chat_id: String(options.chatId),
          ...(options.replyToMessageId
            ? { reply_to_message_id: String(options.replyToMessageId) }
            : {}),
        },
        delivery.fieldName,
        delivery.filePath,
        delivery.fileName,
      );
    } finally {
      for (const path of delivery.cleanupPaths) {
        await rm(path, { force: true }).catch(() => undefined);
      }
    }
  }

  async function sendVoiceReply(options: {
    text: string;
    voiceId?: string;
    language?: string;
    alsoSendText?: boolean;
    proactiveChatId?: number;
  }): Promise<void> {
    const turn = deps.getActiveTurn();
    const proactiveChatId = options.proactiveChatId ?? deps.getProactiveChatId();
    if (!turn && !proactiveChatId) {
      throw new Error(
        "telegram_send_voice requires an active Telegram turn or a paired Telegram user for proactive delivery",
      );
    }
    const keepText = turn ? shouldKeepTextReply(turn, options.alsoSendText) : false;
    if (turn) await deps.clearPreview(turn.chatId);
    await sendTelegramVoiceReply({
      chatId: turn?.chatId ?? proactiveChatId!,
      replyToMessageId: turn?.replyToMessageId,
      text: options.text,
      cwd: deps.cwd(),
      voiceId: options.voiceId,
      language: options.language,
      inputModality: turn?.inputModality,
      transcriptLanguage: turn?.voiceTranscriptLanguage,
    });
    if (turn) {
      turn.skipFinalTextReply = !keepText;
      turn.voiceReplyDelivered = true;
    }
  }

  async function handleVoiceCommand(
    args: string,
    ctx: ExtensionCommandContext,
  ): Promise<void> {
    const command = Voice.parseTelegramVoiceCommand(args);
    if (!command) {
      ctx.ui.notify("Unknown telegram voice command.", "error");
      return;
    }
    if (command.action === "prompt") {
      const current = deps.getConfig().voice?.speechPreparationPrompt || "";
      const edited = await ctx.ui.editor("Telegram voice speech prompt", current);
      deps.updateConfig((config) => {
        config.voice = {
          ...(config.voice || {}),
          speechPreparationPrompt: (edited ?? "").trim() || undefined,
        };
      });
      await deps.persistConfig();
    } else if (command.action === "prompt-reset") {
      deps.updateConfig((config) => {
        config.voice = {
          ...(config.voice || {}),
          speechPreparationPrompt: undefined,
        };
      });
      await deps.persistConfig();
    } else if (command.action !== "status") {
      deps.setConfig(Voice.updateTelegramVoiceConfig(deps.getConfig(), command));
      await deps.persistConfig();
    }
    ctx.ui.notify(Voice.formatTelegramVoiceStatus(getVoiceSettings(ctx.cwd)), "info");
    deps.updateStatus(ctx as TContext);
  }

  async function createTurn(
    messages: TMessage[],
    historyTurns: PendingTelegramTurn[] = [],
  ): Promise<PendingTelegramTurn> {
    const files = await Media.downloadTelegramMessageFiles(messages, {
      downloadFile: deps.downloadFile,
    });
    const rawText = Media.extractTelegramMessagesText(messages);
    const inputModality = Media.detectTelegramInputModality(messages);
    const settings = getVoiceSettings(deps.cwd());
    const voiceFile = files.find(
      (file) => file.kind === "voice" || file.kind === "audio",
    );
    let voiceTranscript: string | undefined;
    let voiceTranscriptLanguage: string | undefined;
    let voiceTranscriptionError: string | undefined;
    if (settings.enabled && settings.autoTranscribeIncoming && voiceFile) {
      try {
        const transcript = await Voice.transcribeTelegramAudio({
          cwd: deps.cwd(),
          filePath: voiceFile.path,
          settings,
          language: settings.sttLanguage || settings.defaultLanguage,
        });
        voiceTranscript = transcript.text || undefined;
        voiceTranscriptLanguage = transcript.language || undefined;
      } catch (error) {
        voiceTranscriptionError =
          error instanceof Error ? error.message : String(error);
      }
    }
    const replyModality =
      inputModality === "voice" &&
      settings.enabled &&
      settings.replyWithVoiceOnIncomingVoice
        ? "voice-required"
        : "text";
    const turn = await Turns.buildTelegramPromptTurnRuntime({
      telegramPrefix: Turns.TELEGRAM_PREFIX,
      messages,
      historyTurns,
      queueOrder: deps.allocateQueueOrder(),
      rawText,
      files,
      inferImageMimeType: Media.guessMediaType,
      inputModality,
      replyModality,
      voiceFilePath: voiceFile?.path,
      voiceTranscript,
      voiceTranscriptLanguage,
      voiceTranscriptionError,
      explicitTextCopyRequested: rawText.trim().length > 0,
    });
    turn.skipFinalTextReply =
      replyModality === "voice-required" && settings.alsoSendTextReply !== true;
    return turn;
  }

  async function beforeFinalTextReply(
    turn: PendingTelegramTurn,
    finalText: string,
  ): Promise<void> {
    if (
      turn.voiceReplyDelivered ||
      turn.replyModality !== "voice-required" ||
      !finalText
    ) {
      return;
    }
    const settings = getVoiceSettings(deps.cwd());
    if (!settings.enabled || !settings.replyWithVoiceOnIncomingVoice) return;
    try {
      await sendTelegramVoiceReply({
        chatId: turn.chatId,
        replyToMessageId: turn.replyToMessageId,
        text: finalText,
        cwd: deps.cwd(),
        voiceId: settings.defaultVoiceId,
        language: settings.defaultLanguage,
        inputModality: turn.inputModality,
        transcriptLanguage: turn.voiceTranscriptLanguage,
      });
      turn.voiceReplyDelivered = true;
      turn.skipFinalTextReply = settings.alsoSendTextReply !== true;
    } catch {
      turn.voiceReplyDelivered = false;
      turn.skipFinalTextReply = false;
    }
  }

  return {
    getVoiceSettings,
    getDefaultVoiceSettings: () => getVoiceSettings(deps.cwd()),
    shouldKeepTextReply,
    sendVoiceReply,
    handleVoiceCommand,
    createTurn,
    beforeFinalTextReply,
  };
}
