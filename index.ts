/**
 * Telegram bridge extension entrypoint and orchestration layer
 * Keeps the runtime wiring in one place while delegating reusable domain logic to /lib modules
 */

import { mkdir, readFile, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { Context, Model } from "@mariozechner/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { SettingsManager } from "@mariozechner/pi-coding-agent";

import {
  createTelegramApiClient,
  readTelegramConfig,
  writeTelegramConfig,
  type TelegramConfig,
} from "./lib/api.ts";
import { sendQueuedTelegramAttachments } from "./lib/attachments.ts";
import {
  collectTelegramFileInfos,
  detectTelegramInputModality,
  extractFirstTelegramMessageText,
  extractTelegramMessagesText,
  guessMediaType,
  type TelegramFileKind,
} from "./lib/media.ts";
import {
  buildTelegramModelMenuState,
  getCanonicalModelId,
  handleTelegramVoiceMenuCallbackAction,
  handleTelegramMenuCallbackEntry,
  handleTelegramModelMenuCallbackAction,
  handleTelegramStatusMenuCallbackAction,
  handleTelegramThinkingMenuCallbackAction,
  sendTelegramModelMenuMessage,
  sendTelegramStatusMessage,
  updateTelegramModelMenuMessage,
  updateTelegramStatusMessage,
  updateTelegramThinkingMenuMessage,
  updateTelegramVoiceAnswerMenuMessage,
  updateTelegramVoiceLanguageMenuMessage,
  updateTelegramVoiceStyleMenuMessage,
  updateTelegramVoiceMenuMessage,
  updateTelegramVoiceVoiceMenuMessage,
  type ScopedTelegramModel,
  type TelegramModelMenuState,
  type TelegramVoiceMenuSettings,
  type TelegramReplyMarkup,
  type ThinkingLevel,
} from "./lib/menu.ts";
import {
  buildTelegramModelSwitchContinuationText,
  canRestartTelegramTurnForModelSwitch,
  restartTelegramModelSwitchContinuation,
  shouldTriggerPendingTelegramModelSwitchAbort,
} from "./lib/model-switch.ts";
import { runTelegramPollLoop } from "./lib/polling.ts";
import {
  buildTelegramAgentEndPlan,
  buildTelegramAgentStartPlan,
  buildTelegramSessionShutdownState,
  buildTelegramSessionStartState,
  canDispatchTelegramTurnState,
  clearTelegramQueuePromptPriority,
  compareTelegramQueueItems,
  consumeDispatchedTelegramPrompt,
  executeTelegramControlItemRuntime,
  executeTelegramQueueDispatchPlan,
  formatQueuedTelegramItemsStatus,
  getNextTelegramToolExecutionCount,
  partitionTelegramQueueItemsForHistory,
  planNextTelegramQueueAction,
  prioritizeTelegramQueuePrompt,
  removeTelegramQueueItemsByMessageIds,
  shouldDispatchAfterTelegramAgentEnd,
  shouldStartTelegramPolling,
  type PendingTelegramControlItem,
  type PendingTelegramTurn,
  type TelegramQueueItem,
} from "./lib/queue.ts";
import {
  registerTelegramAttachmentTool,
  registerTelegramCommands,
  registerTelegramLifecycleHooks,
  registerTelegramVoiceTool,
} from "./lib/registration.ts";
import {
  MAX_MESSAGE_LENGTH,
  renderMarkdownPreviewText,
  renderTelegramMessage,
  type TelegramRenderMode,
} from "./lib/rendering.ts";
import {
  clearTelegramPreview,
  finalizeTelegramMarkdownPreview,
  finalizeTelegramPreview,
  flushTelegramPreview,
  type TelegramPreviewRuntimeState,
} from "./lib/preview.ts";
import {
  buildTelegramReplyTransport,
  sendTelegramMarkdownReply,
  sendTelegramPlainReply,
} from "./lib/replies.ts";
import {
  getTelegramBotTokenInputDefault,
  getTelegramBotTokenPromptSpec,
} from "./lib/setup.ts";
import { buildStatusHtml } from "./lib/status.ts";
import {
  buildTelegramPromptTurn,
  truncateTelegramQueueSummary,
} from "./lib/turns.ts";
import {
  collectTelegramReactionEmojis,
  executeTelegramUpdate,
  getTelegramAuthorizationState,
} from "./lib/updates.ts";
import {
  buildSpeechPreparationPrompt,
  DEFAULT_TELEGRAM_SPEECH_PREPARATION_PROMPT,
  formatTelegramVoiceStatus,
  getTelegramVoiceProvider,
  resolveTelegramVoiceLanguage,
  parseTelegramVoiceCommand,
  resolveTelegramVoiceSettings,
  synthesizeTelegramVoiceReply,
  transcribeTelegramAudio,
  updateTelegramVoiceConfig,
} from "./lib/voice.ts";

// --- Telegram API Types ---

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

interface TelegramChat {
  id: number;
  type: string;
}

interface TelegramPhotoSize {
  file_id: string;
  file_size?: number;
}

interface TelegramDocument {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramVideo {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramAudio {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramVoice {
  file_id: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramAnimation {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramSticker {
  file_id: string;
  emoji?: string;
}

interface TelegramFileInfo {
  file_id: string;
  fileName: string;
  mimeType?: string;
  isImage: boolean;
  kind: TelegramFileKind;
}

interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  caption?: string;
  media_group_id?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  video?: TelegramVideo;
  audio?: TelegramAudio;
  voice?: TelegramVoice;
  animation?: TelegramAnimation;
  sticker?: TelegramSticker;
}

interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

interface TelegramReactionTypeEmoji {
  type: "emoji";
  emoji: string;
}

interface TelegramReactionTypeCustomEmoji {
  type: "custom_emoji";
  custom_emoji_id: string;
}

interface TelegramReactionTypePaid {
  type: "paid";
}

type TelegramReactionType =
  | TelegramReactionTypeEmoji
  | TelegramReactionTypeCustomEmoji
  | TelegramReactionTypePaid;

interface TelegramMessageReactionUpdated {
  chat: TelegramChat;
  message_id: number;
  user?: TelegramUser;
  actor_chat?: TelegramChat;
  old_reaction: TelegramReactionType[];
  new_reaction: TelegramReactionType[];
  date: number;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
  message_reaction?: TelegramMessageReactionUpdated;
  deleted_business_messages?: { message_ids?: unknown };
}

interface TelegramGetFileResult {
  file_path: string;
}

interface TelegramSentMessage {
  message_id: number;
}

interface TelegramBotCommand {
  command: string;
  description: string;
}

// --- Extension State Types ---

interface DownloadedTelegramFile {
  path: string;
  fileName: string;
  isImage: boolean;
  mimeType?: string;
  kind: TelegramFileKind;
}

type ActiveTelegramTurn = PendingTelegramTurn;

type TelegramPreviewState = TelegramPreviewRuntimeState;

interface TelegramMediaGroupState {
  messages: TelegramMessage[];
  flushTimer?: ReturnType<typeof setTimeout>;
}

const AGENT_DIR = join(homedir(), ".pi", "agent");
const CONFIG_PATH = join(AGENT_DIR, "telegram.json");
const TEMP_DIR = join(AGENT_DIR, "tmp", "telegram");
const TELEGRAM_PREFIX = "[telegram]";
const MAX_ATTACHMENTS_PER_TURN = 10;
const PREVIEW_THROTTLE_MS = 750;
const TELEGRAM_DRAFT_ID_MAX = 2_147_483_647;
const TELEGRAM_MEDIA_GROUP_DEBOUNCE_MS = 1200;
const SYSTEM_PROMPT_SUFFIX = `

Telegram bridge extension is active.
- Messages forwarded from Telegram are prefixed with "[telegram]".
- [telegram] messages may include local temp file paths for Telegram attachments. Read those files as needed.
- If a [telegram] user asked for a file or generated artifact, use the telegram_attach tool with the local file path so the extension can send it with your next final reply.
- Do not assume mentioning a local file path in plain text will send it to Telegram. Use telegram_attach.
- If a Telegram user explicitly asks for a spoken reply, voice note, or audio story, call telegram_send_voice with text to speak.
- Do not request \`alsoSendText=true\` on telegram_send_voice unless the user explicitly asked for both a voice note and a text copy/transcript.
- If the Telegram prompt says Reply modality: voice-required, write response text naturally for speech. Bridge may deliver it as Telegram voice note automatically unless telegram_send_voice already handled it.`;

// --- Generic Utilities ---

function isTelegramPrompt(prompt: string): boolean {
  return prompt.trimStart().startsWith(TELEGRAM_PREFIX);
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function parseTelegramCommand(
  text: string,
): { name: string; args: string } | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return undefined;
  const [head, ...tail] = trimmed.split(/\s+/);
  const name = head.slice(1).split("@")[0]?.toLowerCase();
  if (!name) return undefined;
  return { name, args: tail.join(" ").trim() };
}

function detectExplicitTelegramTextCopyRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  return [
    /\b(text (copy|too|also)|also send text|send text too|voice and text|text and voice|both text and voice)\b/i,
    /\b(transcript|caption|subtitles?)\b/i,
    /\b(auch als text|auch text|zusätzlich als text|zusätzlich text|und schreib(?: es)? mir(?: das)? auch|bitte auch schreiben)\b/i,
  ].some((pattern) => pattern.test(normalized));
}

function getCliScopedModelPatterns(): string[] | undefined {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--models") {
      const value = args[i + 1] ?? "";
      const patterns = value
        .split(",")
        .map((pattern) => pattern.trim())
        .filter(Boolean);
      return patterns.length > 0 ? patterns : undefined;
    }
    if (arg.startsWith("--models=")) {
      const patterns = arg
        .slice("--models=".length)
        .split(",")
        .map((pattern) => pattern.trim())
        .filter(Boolean);
      return patterns.length > 0 ? patterns : undefined;
    }
  }
  return undefined;
}

function truncateTelegramButtonLabel(label: string, maxLength = 56): string {
  return label.length <= maxLength
    ? label
    : `${label.slice(0, maxLength - 1)}…`;
}

// --- Extension Runtime ---

export const __telegramTestUtils = {
  MAX_MESSAGE_LENGTH,
  renderTelegramMessage,
  compareTelegramQueueItems,
  removeTelegramQueueItemsByMessageIds,
  clearTelegramQueuePromptPriority,
  prioritizeTelegramQueuePrompt,
  partitionTelegramQueueItemsForHistory,
  consumeDispatchedTelegramPrompt,
  planNextTelegramQueueAction,
  shouldDispatchAfterTelegramAgentEnd,
  buildTelegramAgentEndPlan,
  canDispatchTelegramTurnState,
  getTelegramBotTokenInputDefault,
  getTelegramBotTokenPromptSpec,
  canRestartTelegramTurnForModelSwitch,
  restartTelegramModelSwitchContinuation,
  shouldTriggerPendingTelegramModelSwitchAbort,
  buildTelegramModelSwitchContinuationText: (
    model: Pick<Model<any>, "provider" | "id">,
    thinkingLevel?: ThinkingLevel,
  ) =>
    buildTelegramModelSwitchContinuationText(
      TELEGRAM_PREFIX,
      model,
      thinkingLevel,
    ),
};

export default function (pi: ExtensionAPI) {
  let config: TelegramConfig = {};
  let pollingController: AbortController | undefined;
  let pollingPromise: Promise<void> | undefined;
  let queuedTelegramItems: TelegramQueueItem[] = [];
  let nextQueuedTelegramItemOrder = 0;
  let nextQueuedTelegramControlOrder = 0;
  let nextPriorityReactionOrder = 0;
  let activeTelegramTurn: ActiveTelegramTurn | undefined;
  let activeTelegramToolExecutions = 0;
  let pendingTelegramModelSwitch: ScopedTelegramModel | undefined;
  let telegramTurnDispatchPending = false;
  let typingInterval: ReturnType<typeof setInterval> | undefined;
  let activeTelegramChatAction: "typing" | "record_voice" | undefined;
  let activeTelegramChatActionChatId: number | undefined;
  let currentAbort: (() => void) | undefined;
  let preserveQueuedTurnsAsHistory = false;
  let compactionInProgress = false;
  let setupInProgress = false;
  let previewState: TelegramPreviewState | undefined;
  let draftSupport: "unknown" | "supported" | "unsupported" = "unknown";
  let nextDraftId = 0;
  let currentTelegramModel: Model<any> | undefined;
  const mediaGroups = new Map<string, TelegramMediaGroupState>();
  const modelMenus = new Map<number, TelegramModelMenuState>();

  // --- Runtime State ---

  function allocateDraftId(): number {
    nextDraftId = nextDraftId >= TELEGRAM_DRAFT_ID_MAX ? 1 : nextDraftId + 1;
    return nextDraftId;
  }

  function canDispatchQueuedTelegramTurn(ctx: ExtensionContext): boolean {
    return canDispatchTelegramTurnState({
      compactionInProgress,
      hasActiveTelegramTurn: !!activeTelegramTurn,
      hasPendingTelegramDispatch: telegramTurnDispatchPending,
      isIdle: ctx.isIdle(),
      hasPendingMessages: ctx.hasPendingMessages(),
    });
  }

  function executeQueuedTelegramControlItem(
    item: PendingTelegramControlItem,
    ctx: ExtensionContext,
  ): void {
    void executeTelegramControlItemRuntime(item, {
      ctx,
      sendTextReply,
      onSettled: () => {
        updateStatus(ctx);
        dispatchNextQueuedTelegramTurn(ctx);
      },
    });
  }

  function dispatchNextQueuedTelegramTurn(ctx: ExtensionContext): void {
    const dispatchPlan = planNextTelegramQueueAction(
      queuedTelegramItems,
      canDispatchQueuedTelegramTurn(ctx),
    );
    if (dispatchPlan.kind !== "none") {
      queuedTelegramItems = dispatchPlan.remainingItems;
    }
    executeTelegramQueueDispatchPlan(dispatchPlan, {
      executeControlItem: (item) => {
        updateStatus(ctx);
        executeQueuedTelegramControlItem(item, ctx);
      },
      onPromptDispatchStart: (item) => {
        telegramTurnDispatchPending = true;
        startTelegramTurnChatActionLoop(ctx, item);
        updateStatus(ctx);
      },
      sendUserMessage: (content) => {
        pi.sendUserMessage(content);
      },
      onPromptDispatchFailure: (message) => {
        telegramTurnDispatchPending = false;
        stopTypingLoop();
        updateStatus(ctx, `dispatch failed: ${message}`);
      },
      onIdle: () => {
        updateStatus(ctx);
      },
    });
  }

  // --- Status ---

  function updateStatus(ctx: ExtensionContext, error?: string): void {
    const theme = ctx.ui.theme;
    const label = theme.fg("accent", "telegram");
    if (error) {
      ctx.ui.setStatus(
        "telegram",
        `${label} ${theme.fg("error", "error")} ${theme.fg("muted", error)}`,
      );
      return;
    }
    if (!config.botToken) {
      ctx.ui.setStatus(
        "telegram",
        `${label} ${theme.fg("muted", "not configured")}`,
      );
      return;
    }
    if (!pollingPromise) {
      ctx.ui.setStatus(
        "telegram",
        `${label} ${theme.fg("muted", "disconnected")}`,
      );
      return;
    }
    if (!config.allowedUserId) {
      ctx.ui.setStatus(
        "telegram",
        `${label} ${theme.fg("warning", "awaiting pairing")}`,
      );
      return;
    }
    if (compactionInProgress) {
      const queued = theme.fg(
        "muted",
        formatQueuedTelegramItemsStatus(queuedTelegramItems),
      );
      ctx.ui.setStatus(
        "telegram",
        `${label} ${theme.fg("accent", "compacting")}${queued}`,
      );
      return;
    }
    if (
      activeTelegramTurn ||
      telegramTurnDispatchPending ||
      queuedTelegramItems.length > 0
    ) {
      const queued = theme.fg(
        "muted",
        formatQueuedTelegramItemsStatus(queuedTelegramItems),
      );
      ctx.ui.setStatus(
        "telegram",
        `${label} ${theme.fg("accent", "processing")}${queued}`,
      );
      return;
    }
    ctx.ui.setStatus(
      "telegram",
      `${label} ${theme.fg("success", "connected")}`,
    );
  }

  // --- Telegram API ---

  const telegramApi = createTelegramApiClient(() => config.botToken);
  const callTelegramApi = telegramApi.call;
  const callTelegramMultipartApi = telegramApi.callMultipart;
  const answerCallbackQuery = telegramApi.answerCallbackQuery;
  const downloadTelegramBridgeFile = (
    fileId: string,
    suggestedName: string,
  ): Promise<string> => telegramApi.downloadFile(fileId, suggestedName, TEMP_DIR);

  // --- Message Delivery & Preview ---

  function startTelegramChatActionLoop(
    ctx: ExtensionContext,
    action: "typing" | "record_voice",
    chatId?: number,
  ): void {
    const targetChatId = chatId ?? activeTelegramTurn?.chatId;
    if (typingInterval || targetChatId === undefined) return;

    const sendAction = async (): Promise<void> => {
      try {
        await callTelegramApi("sendChatAction", {
          chat_id: targetChatId,
          action,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateStatus(ctx, `${action} failed: ${message}`);
      }
    };

    void sendAction();
    typingInterval = setInterval(() => {
      void sendAction();
    }, 4000);
  }

  function startTypingLoop(ctx: ExtensionContext, chatId?: number): void {
    startTelegramChatActionLoop(ctx, "typing", chatId);
  }

  function startVoiceRecordingLoop(
    ctx: ExtensionContext,
    chatId?: number,
  ): void {
    startTelegramChatActionLoop(ctx, "record_voice", chatId);
  }

  function startTelegramTurnChatActionLoop(
    ctx: ExtensionContext,
    turn: Pick<PendingTelegramTurn, "replyModality" | "chatId">,
  ): void {
    if (turn.replyModality === "voice-required") {
      startVoiceRecordingLoop(ctx, turn.chatId);
      return;
    }
    startTypingLoop(ctx, turn.chatId);
  }

  function shouldSuppressTelegramTextPreview(
    turn: Pick<
      PendingTelegramTurn,
      | "replyModality"
      | "skipFinalTextReply"
      | "voiceReplyDelivered"
      | "explicitTextCopyRequested"
    >,
  ): boolean {
    if (turn.explicitTextCopyRequested === true) {
      return false;
    }
    return (
      turn.replyModality === "voice-required" ||
      turn.skipFinalTextReply === true ||
      turn.voiceReplyDelivered === true
    );
  }

  function shouldKeepTelegramTextReply(
    turn: Pick<PendingTelegramTurn, "explicitTextCopyRequested">,
    alsoSendText?: boolean,
  ): boolean {
    return alsoSendText === true && turn.explicitTextCopyRequested === true;
  }

  function stopTypingLoop(): void {
    if (!typingInterval) return;
    clearInterval(typingInterval);
    typingInterval = undefined;
  }

  function isAssistantMessage(message: AgentMessage): boolean {
    return (message as unknown as { role?: string }).role === "assistant";
  }

  function extractTextContent(content: unknown): string {
    const blocks = Array.isArray(content) ? content : [];
    return blocks
      .filter(
        (block): block is { type: string; text?: string } =>
          typeof block === "object" && block !== null && "type" in block,
      )
      .filter(
        (block) => block.type === "text" && typeof block.text === "string",
      )
      .map((block) => block.text as string)
      .join("")
      .trim();
  }

  function getMessageText(message: AgentMessage): string {
    return extractTextContent(
      (message as unknown as Record<string, unknown>).content,
    );
  }

  function createPreviewState(): TelegramPreviewState {
    return {
      mode: draftSupport === "unsupported" ? "message" : "draft",
      pendingText: "",
      lastSentText: "",
    };
  }

  function isTelegramMessageNotModifiedError(error: unknown): boolean {
    return (
      error instanceof Error &&
      error.message.includes("message is not modified")
    );
  }

  async function editTelegramMessageText(
    body: Record<string, unknown>,
  ): Promise<"edited" | "unchanged"> {
    try {
      await callTelegramApi("editMessageText", body);
      return "edited";
    } catch (error) {
      if (isTelegramMessageNotModifiedError(error)) return "unchanged";
      throw error;
    }
  }

  async function deleteTelegramMessage(
    chatId: number,
    messageId: number,
  ): Promise<void> {
    await callTelegramApi("deleteMessage", {
      chat_id: chatId,
      message_id: messageId,
    });
  }

  const replyTransport = buildTelegramReplyTransport<TelegramReplyMarkup>({
    sendMessage: async (body) => {
      return callTelegramApi<TelegramSentMessage>("sendMessage", body);
    },
    editMessage: async (body) => {
      await editTelegramMessageText(body);
    },
  });

  function getPreviewRuntimeDeps() {
    return {
      getState: () => previewState,
      setState: (state: TelegramPreviewState | undefined) => {
        previewState = state;
      },
      clearScheduledFlush: (state: TelegramPreviewState) => {
        if (!state.flushTimer) return;
        clearTimeout(state.flushTimer);
        state.flushTimer = undefined;
      },
      getReplyToMessageId: () => activeTelegramTurn?.replyToMessageId,
      maxMessageLength: MAX_MESSAGE_LENGTH,
      renderPreviewText: renderMarkdownPreviewText,
      getDraftSupport: () => draftSupport,
      setDraftSupport: (support: "unknown" | "supported" | "unsupported") => {
        draftSupport = support;
      },
      allocateDraftId,
      sendDraft: async (chatId: number, draftId: number, text: string) => {
        await callTelegramApi("sendMessageDraft", {
          chat_id: chatId,
          draft_id: draftId,
          text,
        });
      },
      sendMessage: async (
        chatId: number,
        text: string,
        options?: { parseMode?: "HTML"; replyToMessageId?: number },
      ) => {
        return callTelegramApi<TelegramSentMessage>("sendMessage", {
          chat_id: chatId,
          text,
          parse_mode: options?.parseMode,
          ...(options?.replyToMessageId
            ? { reply_to_message_id: options.replyToMessageId }
            : {}),
        });
      },
      editMessageText: async (
        chatId: number,
        messageId: number,
        text: string,
        options?: { parseMode?: "HTML" },
      ) => {
        await editTelegramMessageText({
          chat_id: chatId,
          message_id: messageId,
          text,
          parse_mode: options?.parseMode,
        });
      },
      deleteMessage: async (chatId: number, messageId: number) => {
        await deleteTelegramMessage(chatId, messageId);
      },
      renderTelegramMessage,
      sendRenderedChunks: (chatId, chunks, options) => {
        return replyTransport.sendRenderedChunks(chatId, chunks, options);
      },
      editRenderedMessage: replyTransport.editRenderedMessage,
    };
  }

  async function clearPreview(chatId: number): Promise<void> {
    await clearTelegramPreview(chatId, getPreviewRuntimeDeps());
  }

  async function flushPreview(chatId: number): Promise<void> {
    await flushTelegramPreview(chatId, getPreviewRuntimeDeps());
  }

  function schedulePreviewFlush(chatId: number): void {
    if (!previewState || previewState.flushTimer) return;
    previewState.flushTimer = setTimeout(() => {
      void flushPreview(chatId);
    }, PREVIEW_THROTTLE_MS);
  }

  async function finalizePreview(chatId: number): Promise<boolean> {
    return finalizeTelegramPreview(chatId, getPreviewRuntimeDeps());
  }

  async function finalizeMarkdownPreview(
    chatId: number,
    markdown: string,
  ): Promise<boolean> {
    return finalizeTelegramMarkdownPreview(
      chatId,
      markdown,
      getPreviewRuntimeDeps(),
    );
  }

  async function sendTextReply(
    chatId: number,
    replyToMessageId: number,
    text: string,
    options?: { parseMode?: "HTML" },
  ): Promise<number | undefined> {
    return sendTelegramPlainReply(
      text,
      {
        renderTelegramMessage,
        sendRenderedChunks: async (chunks, sendOptions) =>
          replyTransport.sendRenderedChunks(chatId, chunks, {
            replyToMessageId: sendOptions?.replyToMessageId,
          }),
      },
      { ...options, replyToMessageId },
    );
  }

  async function sendMarkdownReply(
    chatId: number,
    replyToMessageId: number,
    markdown: string,
  ): Promise<number | undefined> {
    return sendTelegramMarkdownReply(
      markdown,
      {
        renderTelegramMessage,
        sendRenderedChunks: async (chunks, sendOptions) => {
          if (chunks.length === 0) {
            return sendTextReply(chatId, replyToMessageId, markdown);
          }
          return replyTransport.sendRenderedChunks(chatId, chunks, {
            replyToMessageId: sendOptions?.replyToMessageId,
          });
        },
      },
      { replyToMessageId },
    );
  }

  async function sendQueuedAttachments(
    turn: ActiveTelegramTurn,
  ): Promise<void> {
    await sendQueuedTelegramAttachments(turn, {
      sendMultipart: async (method, fields, fileField, filePath, fileName) => {
        await callTelegramMultipartApi<TelegramSentMessage>(
          method,
          fields,
          fileField,
          filePath,
          fileName,
        );
      },
      sendTextReply,
    });
  }

  function getVoiceSettings(cwd: string): ReturnType<typeof resolveTelegramVoiceSettings> {
    return resolveTelegramVoiceSettings(config, cwd);
  }

  function getVoiceMenuSettings(cwd: string): TelegramVoiceMenuSettings {
    const settings = getVoiceSettings(cwd);
    return {
      enabled: settings.enabled,
      provider: settings.provider,
      replyWithVoiceOnIncomingVoice: settings.replyWithVoiceOnIncomingVoice,
      autoTranscribeIncoming: settings.autoTranscribeIncoming,
      alsoSendTextReply: settings.alsoSendTextReply,
      voiceId: settings.defaultVoiceId,
      language: settings.defaultLanguage ?? "auto",
      speechStyle: settings.speechStyle,
    };
  }

  function getVoiceStatusButtonSummary(cwd: string): string {
    const settings = getVoiceSettings(cwd);
    return settings.enabled ? "open" : "off";
  }

  function shouldRewriteSpeechText(
    settings: ReturnType<typeof resolveTelegramVoiceSettings>,
  ): boolean {
    return (
      settings.speechStyle !== "literal" ||
      settings.speechPreparationPrompt !==
        DEFAULT_TELEGRAM_SPEECH_PREPARATION_PROMPT
    );
  }

  async function rewriteTelegramSpeechText(options: {
    text: string;
    settings: ReturnType<typeof resolveTelegramVoiceSettings>;
    inputModality?: PendingTelegramTurn["inputModality"];
    language?: string;
  }): Promise<string> {
    if (!shouldRewriteSpeechText(options.settings) || !currentTelegramModel) {
      return options.text;
    }
    const provider = getTelegramVoiceProvider(options.settings.provider);
    const prompt = buildSpeechPreparationPrompt({
      settings: options.settings,
      inputModality: options.inputModality,
      language: options.language,
      tagStyle: provider?.tagStyle || "none",
      text: options.text,
    });
    const context: Context = {
      messages: [
        {
          role: "user",
          content: prompt,
          timestamp: Date.now(),
        },
      ],
    };
    const { completeSimple } = await import("@mariozechner/pi-ai");
    const response = await completeSimple(currentTelegramModel, context);
    if (response.stopReason === "error" || response.stopReason === "aborted") {
      return options.text;
    }
    const rewritten = response.content
      .filter((content): content is { type: "text"; text: string } => {
        return content.type === "text";
      })
      .map((content) => content.text)
      .join("")
      .trim();
    return rewritten || options.text;
  }

  async function sendTelegramVoiceReply(options: {
    chatId: number;
    replyToMessageId?: number;
    text: string;
    cwd: string;
    ctx?: ExtensionContext;
    voiceId?: string;
    language?: string;
    alsoSendText?: boolean;
    inputModality?: PendingTelegramTurn["inputModality"];
    transcriptLanguage?: PendingTelegramTurn["voiceTranscriptLanguage"];
  }): Promise<void> {
    const voiceSettings = getVoiceSettings(options.cwd);
    if (!getTelegramVoiceProvider(voiceSettings.provider)) {
      throw new Error(
        `Unsupported Telegram voice provider: ${voiceSettings.provider}`,
      );
    }
    if (options.ctx) {
      stopTypingLoop();
      startVoiceRecordingLoop(options.ctx, options.chatId);
    } else {
      await callTelegramApi("sendChatAction", {
        chat_id: options.chatId,
        action: "record_voice",
      }).catch(() => undefined);
    }
    const resolvedLanguage = resolveTelegramVoiceLanguage({
      text: options.text,
      requestedLanguage: options.language || voiceSettings.defaultLanguage,
      transcriptLanguage: options.transcriptLanguage,
    });
    const rewrittenText = await rewriteTelegramSpeechText({
      text: options.text,
      settings: voiceSettings,
      inputModality: options.inputModality,
      language: resolvedLanguage,
    });
    const delivery = await synthesizeTelegramVoiceReply({
      cwd: options.cwd,
      text: rewrittenText,
      voiceId: options.voiceId,
      language: resolvedLanguage,
      settings: voiceSettings,
      inputModality: options.inputModality,
    });
    let delivered = false;
    try {
      try {
        await callTelegramMultipartApi<TelegramSentMessage>(
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
        delivered = true;
      } catch (error) {
        throw error;
      }
    } finally {
      if (options.ctx) {
        stopTypingLoop();
      }
      for (const path of delivery.cleanupPaths) {
        await unlink(path).catch(() => undefined);
      }
    }
  }

  function extractAssistantText(messages: AgentMessage[]): {
    text?: string;
    stopReason?: string;
    errorMessage?: string;
  } {
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i] as unknown as Record<string, unknown>;
      if (message.role !== "assistant") continue;
      const stopReason =
        typeof message.stopReason === "string" ? message.stopReason : undefined;
      const errorMessage =
        typeof message.errorMessage === "string"
          ? message.errorMessage
          : undefined;
      const text = extractTextContent(message.content);
      return { text: text || undefined, stopReason, errorMessage };
    }
    return {};
  }

  // --- Bridge Setup ---

  async function promptForConfig(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI || setupInProgress) return;
    setupInProgress = true;
    try {
      const tokenPrompt = getTelegramBotTokenPromptSpec(
        process.env,
        config.botToken,
      );
      // Use the editor when a real default exists because ctx.ui.input only
      // exposes placeholder text, not an editable prefilled value.
      const token =
        tokenPrompt.method === "editor"
          ? await ctx.ui.editor("Telegram bot token", tokenPrompt.value)
          : await ctx.ui.input("Telegram bot token", tokenPrompt.value);
      if (!token) return;

      const nextConfig: TelegramConfig = { ...config, botToken: token.trim() };
      const response = await fetch(
        `https://api.telegram.org/bot${nextConfig.botToken}/getMe`,
      );
      const data = (await response.json()) as TelegramApiResponse<TelegramUser>;
      if (!data.ok || !data.result) {
        ctx.ui.notify(
          data.description || "Invalid Telegram bot token",
          "error",
        );
        return;
      }

      nextConfig.botId = data.result.id;
      nextConfig.botUsername = data.result.username;
      config = nextConfig;
      await writeTelegramConfig(AGENT_DIR, CONFIG_PATH, config);
      ctx.ui.notify(
        `Telegram bot connected: @${config.botUsername ?? "unknown"}`,
        "info",
      );
      ctx.ui.notify(
        "Send /start to your bot in Telegram to pair this extension with your account.",
        "info",
      );
      await startPolling(ctx);
      updateStatus(ctx);
    } finally {
      setupInProgress = false;
    }
  }

  async function registerTelegramBotCommands(): Promise<void> {
    const commands: TelegramBotCommand[] = [
      {
        command: "start",
        description: "Show help and pair the Telegram bridge",
      },
      {
        command: "status",
        description: "Show model, usage, cost, and context status",
      },
      { command: "model", description: "Open the interactive model selector" },
      { command: "compact", description: "Compact the current pi session" },
      { command: "stop", description: "Abort the current pi task" },
    ];
    await callTelegramApi<boolean>("setMyCommands", { commands });
  }

  function getCurrentTelegramModel(
    ctx: ExtensionContext,
  ): Model<any> | undefined {
    return currentTelegramModel ?? ctx.model;
  }

  // --- Interactive Menu State & Builders ---

  async function getModelMenuState(
    chatId: number,
    ctx: ExtensionContext,
  ): Promise<TelegramModelMenuState> {
    const settingsManager = SettingsManager.create(ctx.cwd);
    await settingsManager.reload();
    ctx.modelRegistry.refresh();
    const activeModel = getCurrentTelegramModel(ctx);
    const availableModels = ctx.modelRegistry.getAvailable();
    const cliScopedModels = getCliScopedModelPatterns();
    const configuredScopedModels =
      cliScopedModels ?? settingsManager.getEnabledModels() ?? [];
    return buildTelegramModelMenuState({
      chatId,
      activeModel,
      availableModels,
      configuredScopedModelPatterns: configuredScopedModels,
      cliScopedModelPatterns: cliScopedModels ?? undefined,
    });
  }

  // --- Interactive Menu Actions ---

  async function updateModelMenuMessage(
    state: TelegramModelMenuState,
    ctx: ExtensionContext,
  ): Promise<void> {
    await updateTelegramModelMenuMessage(state, getCurrentTelegramModel(ctx), {
      editInteractiveMessage,
      sendInteractiveMessage,
    });
  }

  async function updateThinkingMenuMessage(
    state: TelegramModelMenuState,
    ctx: ExtensionContext,
  ): Promise<void> {
    await updateTelegramThinkingMenuMessage(
      state,
      getCurrentTelegramModel(ctx),
      pi.getThinkingLevel(),
      { editInteractiveMessage, sendInteractiveMessage },
    );
  }

  async function updateVoiceMenuMessage(
    state: TelegramModelMenuState,
    ctx: ExtensionContext,
  ): Promise<void> {
    await updateTelegramVoiceMenuMessage(
      state,
      getVoiceMenuSettings(ctx.cwd),
      { editInteractiveMessage, sendInteractiveMessage },
    );
  }

  async function updateVoiceLanguageMenuMessage(
    state: TelegramModelMenuState,
    ctx: ExtensionContext,
  ): Promise<void> {
    await updateTelegramVoiceLanguageMenuMessage(
      state,
      getVoiceMenuSettings(ctx.cwd),
      { editInteractiveMessage, sendInteractiveMessage },
    );
  }

  async function updateVoiceAnswerMenuMessage(
    state: TelegramModelMenuState,
    ctx: ExtensionContext,
  ): Promise<void> {
    await updateTelegramVoiceAnswerMenuMessage(
      state,
      getVoiceMenuSettings(ctx.cwd),
      { editInteractiveMessage, sendInteractiveMessage },
    );
  }

  async function updateVoiceStyleMenuMessage(
    state: TelegramModelMenuState,
    ctx: ExtensionContext,
  ): Promise<void> {
    await updateTelegramVoiceStyleMenuMessage(
      state,
      getVoiceMenuSettings(ctx.cwd),
      { editInteractiveMessage, sendInteractiveMessage },
    );
  }

  async function updateVoiceVoiceMenuMessage(
    state: TelegramModelMenuState,
    ctx: ExtensionContext,
  ): Promise<void> {
    await updateTelegramVoiceVoiceMenuMessage(
      state,
      getVoiceMenuSettings(ctx.cwd),
      { editInteractiveMessage, sendInteractiveMessage },
    );
  }

  async function editInteractiveMessage(
    chatId: number,
    messageId: number,
    text: string,
    mode: TelegramRenderMode,
    replyMarkup: TelegramReplyMarkup,
  ): Promise<void> {
    await replyTransport.editRenderedMessage(
      chatId,
      messageId,
      renderTelegramMessage(text, { mode }),
      { replyMarkup },
    );
  }

  async function sendInteractiveMessage(
    chatId: number,
    text: string,
    mode: TelegramRenderMode,
    replyMarkup: TelegramReplyMarkup,
  ): Promise<number | undefined> {
    return replyTransport.sendRenderedChunks(
      chatId,
      renderTelegramMessage(text, { mode }),
      { replyMarkup },
    );
  }

  async function ensureIdleOrNotify(
    ctx: ExtensionContext,
    chatId: number,
    replyToMessageId: number,
    busyMessage: string,
  ): Promise<boolean> {
    if (ctx.isIdle()) return true;
    await sendTextReply(chatId, replyToMessageId, busyMessage);
    return false;
  }

  async function showStatusMessage(
    state: TelegramModelMenuState,
    ctx: ExtensionContext,
  ): Promise<void> {
    await updateTelegramStatusMessage(
      state,
      buildStatusHtml(ctx, getCurrentTelegramModel(ctx)),
      getCurrentTelegramModel(ctx),
      pi.getThinkingLevel(),
      getVoiceStatusButtonSummary(ctx.cwd),
      { editInteractiveMessage, sendInteractiveMessage },
    );
  }

  async function sendStatusMessage(
    chatId: number,
    replyToMessageId: number,
    ctx: ExtensionContext,
  ): Promise<void> {
    const isIdle = await ensureIdleOrNotify(
      ctx,
      chatId,
      replyToMessageId,
      "Cannot open status while pi is busy. Send /stop first.",
    );
    if (!isIdle) return;
    const state = await getModelMenuState(chatId, ctx);
    const messageId = await sendTelegramStatusMessage(
      state,
      buildStatusHtml(ctx, getCurrentTelegramModel(ctx)),
      getCurrentTelegramModel(ctx),
      pi.getThinkingLevel(),
      getVoiceStatusButtonSummary(ctx.cwd),
      { editInteractiveMessage, sendInteractiveMessage },
    );
    if (messageId === undefined) return;
    state.messageId = messageId;
    state.mode = "status";
    modelMenus.set(messageId, state);
  }

  function canOfferInFlightTelegramModelSwitch(ctx: ExtensionContext): boolean {
    return canRestartTelegramTurnForModelSwitch({
      isIdle: ctx.isIdle(),
      hasActiveTelegramTurn: !!activeTelegramTurn,
      hasAbortHandler: !!currentAbort,
    });
  }

  function createTelegramControlItem(
    chatId: number,
    replyToMessageId: number,
    controlType: PendingTelegramControlItem["controlType"],
    statusSummary: string,
    execute: PendingTelegramControlItem["execute"],
  ): PendingTelegramControlItem {
    const queueOrder = nextQueuedTelegramItemOrder++;
    return {
      kind: "control",
      controlType,
      chatId,
      replyToMessageId,
      queueOrder,
      queueLane: "control",
      laneOrder: nextQueuedTelegramControlOrder++,
      statusSummary,
      execute,
    };
  }

  function enqueueTelegramControlItem(
    item: PendingTelegramControlItem,
    ctx: ExtensionContext,
  ): void {
    queuedTelegramItems.push(item);
    reorderQueuedTelegramTurns(ctx);
    dispatchNextQueuedTelegramTurn(ctx);
  }

  function createTelegramModelSwitchContinuationTurn(
    turn: ActiveTelegramTurn,
    selection: ScopedTelegramModel,
  ): PendingTelegramTurn {
    const statusLabel = truncateTelegramQueueSummary(
      `continue on ${selection.model.id}`,
      4,
      32,
    );
    return {
      kind: "prompt",
      chatId: turn.chatId,
      replyToMessageId: turn.replyToMessageId,
      sourceMessageIds: [],
      queueOrder: nextQueuedTelegramItemOrder++,
      queueLane: "control",
      laneOrder: nextQueuedTelegramControlOrder++,
      queuedAttachments: [],
      content: [
        {
          type: "text",
          text: buildTelegramModelSwitchContinuationText(
            TELEGRAM_PREFIX,
            selection.model,
            selection.thinkingLevel,
          ),
        },
      ],
      historyText: `Continue interrupted Telegram request on ${getCanonicalModelId(selection.model)}`,
      statusSummary: `↻ ${statusLabel || "continue"}`,
    };
  }

  function queueTelegramModelSwitchContinuation(
    turn: ActiveTelegramTurn,
    selection: ScopedTelegramModel,
    ctx: ExtensionContext,
  ): void {
    queuedTelegramItems.push(
      createTelegramModelSwitchContinuationTurn(turn, selection),
    );
    reorderQueuedTelegramTurns(ctx);
  }

  function triggerPendingTelegramModelSwitchAbort(
    ctx: ExtensionContext,
  ): boolean {
    if (
      !shouldTriggerPendingTelegramModelSwitchAbort({
        hasPendingModelSwitch: !!pendingTelegramModelSwitch,
        hasActiveTelegramTurn: !!activeTelegramTurn,
        hasAbortHandler: !!currentAbort,
        activeToolExecutions: activeTelegramToolExecutions,
      })
    ) {
      return false;
    }
    const selection = pendingTelegramModelSwitch;
    const turn = activeTelegramTurn;
    const abort = currentAbort;
    if (!selection || !turn || !abort) return false;
    pendingTelegramModelSwitch = undefined;
    queueTelegramModelSwitchContinuation(turn, selection, ctx);
    abort();
    return true;
  }

  async function openModelMenu(
    chatId: number,
    replyToMessageId: number,
    ctx: ExtensionContext,
  ): Promise<void> {
    if (!ctx.isIdle() && !canOfferInFlightTelegramModelSwitch(ctx)) {
      await sendTextReply(
        chatId,
        replyToMessageId,
        "Cannot switch model while pi is busy. Send /stop first.",
      );
      return;
    }
    const state = await getModelMenuState(chatId, ctx);
    if (state.allModels.length === 0) {
      await sendTextReply(
        chatId,
        replyToMessageId,
        "No available models with configured auth.",
      );
      return;
    }
    const activeModel = getCurrentTelegramModel(ctx);
    const messageId = await sendTelegramModelMenuMessage(state, activeModel, {
      editInteractiveMessage,
      sendInteractiveMessage,
    });
    if (messageId === undefined) return;
    state.messageId = messageId;
    state.mode = "model";
    modelMenus.set(messageId, state);
  }

  async function handleStatusCallbackAction(
    query: TelegramCallbackQuery,
    state: TelegramModelMenuState,
    ctx: ExtensionContext,
  ): Promise<boolean> {
    return handleTelegramStatusMenuCallbackAction(
      query.id,
      query.data,
      getCurrentTelegramModel(ctx),
      {
        updateModelMenuMessage: async () => updateModelMenuMessage(state, ctx),
        updateThinkingMenuMessage: async () =>
          updateThinkingMenuMessage(state, ctx),
        updateVoiceMenuMessage: async () => updateVoiceMenuMessage(state, ctx),
        answerCallbackQuery,
      },
    );
  }

  async function handleThinkingCallbackAction(
    query: TelegramCallbackQuery,
    state: TelegramModelMenuState,
    ctx: ExtensionContext,
  ): Promise<boolean> {
    return handleTelegramThinkingMenuCallbackAction(
      query.id,
      query.data,
      getCurrentTelegramModel(ctx),
      {
        setThinkingLevel: (level) => {
          pi.setThinkingLevel(level);
          updateStatus(ctx);
        },
        getCurrentThinkingLevel: () => pi.getThinkingLevel(),
        updateStatusMessage: async () => showStatusMessage(state, ctx),
        answerCallbackQuery,
      },
    );
  }

  async function handleVoiceCallbackAction(
    query: TelegramCallbackQuery,
    state: TelegramModelMenuState,
    ctx: ExtensionContext,
  ): Promise<boolean> {
    return handleTelegramVoiceMenuCallbackAction(query.id, query.data, {
      getVoiceSettings: () => getVoiceMenuSettings(ctx.cwd),
      saveVoiceSetting: async (command) => {
        config = updateTelegramVoiceConfig(config, command);
        await writeTelegramConfig(AGENT_DIR, CONFIG_PATH, config);
        updateStatus(ctx);
      },
      updateVoiceMenuMessage: async () => updateVoiceMenuMessage(state, ctx),
      updateVoiceAnswerMenuMessage: async () =>
        updateVoiceAnswerMenuMessage(state, ctx),
      updateVoiceLanguageMenuMessage: async () =>
        updateVoiceLanguageMenuMessage(state, ctx),
      updateVoiceStyleMenuMessage: async () =>
        updateVoiceStyleMenuMessage(state, ctx),
      updateVoiceVoiceMenuMessage: async () =>
        updateVoiceVoiceMenuMessage(state, ctx),
      updateStatusMessage: async () => showStatusMessage(state, ctx),
      answerCallbackQuery,
    });
  }

  async function handleModelCallbackAction(
    query: TelegramCallbackQuery,
    state: TelegramModelMenuState,
    ctx: ExtensionContext,
  ): Promise<boolean> {
    try {
      return await handleTelegramModelMenuCallbackAction(
        query.id,
        {
          data: query.data,
          state,
          activeModel: getCurrentTelegramModel(ctx),
          currentThinkingLevel: pi.getThinkingLevel(),
          isIdle: ctx.isIdle(),
          canRestartBusyRun: !!activeTelegramTurn && !!currentAbort,
          hasActiveToolExecutions: activeTelegramToolExecutions > 0,
        },
        {
          updateModelMenuMessage: async () =>
            updateModelMenuMessage(state, ctx),
          updateStatusMessage: async () => showStatusMessage(state, ctx),
          answerCallbackQuery,
          setModel: (model) => pi.setModel(model),
          setCurrentModel: (model) => {
            currentTelegramModel = model;
            updateStatus(ctx);
          },
          setThinkingLevel: (level) => {
            pi.setThinkingLevel(level);
            updateStatus(ctx);
          },
          stagePendingModelSwitch: (selection) => {
            pendingTelegramModelSwitch = selection;
            updateStatus(ctx);
          },
          restartInterruptedTelegramTurn: (selection) => {
            return restartTelegramModelSwitchContinuation({
              activeTurn: activeTelegramTurn,
              abort: currentAbort,
              selection,
              queueContinuation: (turn, nextSelection) => {
                queueTelegramModelSwitchContinuation(turn, nextSelection, ctx);
              },
            });
          },
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await answerCallbackQuery(query.id, message);
      return true;
    }
  }

  async function handleAuthorizedTelegramCallbackQuery(
    query: TelegramCallbackQuery,
    ctx: ExtensionContext,
  ): Promise<void> {
    const messageId = query.message?.message_id;
    await handleTelegramMenuCallbackEntry(
      query.id,
      query.data,
      messageId ? modelMenus.get(messageId) : undefined,
      {
        handleStatusAction: async () => {
          const state = messageId ? modelMenus.get(messageId) : undefined;
          if (!state) return false;
          return handleStatusCallbackAction(query, state, ctx);
        },
        handleThinkingAction: async () => {
          const state = messageId ? modelMenus.get(messageId) : undefined;
          if (!state) return false;
          return handleThinkingCallbackAction(query, state, ctx);
        },
        handleVoiceAction: async () => {
          const state = messageId ? modelMenus.get(messageId) : undefined;
          if (!state) return false;
          return handleVoiceCallbackAction(query, state, ctx);
        },
        handleModelAction: async () => {
          const state = messageId ? modelMenus.get(messageId) : undefined;
          if (!state) return false;
          return handleModelCallbackAction(query, state, ctx);
        },
        answerCallbackQuery,
      },
    );
  }

  // --- Status Rendering ---

  // --- Turn Queue & Message Dispatch ---

  async function buildTelegramFiles(
    messages: TelegramMessage[],
  ): Promise<DownloadedTelegramFile[]> {
    const downloaded: DownloadedTelegramFile[] = [];
    for (const file of collectTelegramFileInfos(messages)) {
      const path = await downloadTelegramBridgeFile(
        file.file_id,
        file.fileName,
      );
      downloaded.push({
        path,
        fileName: file.fileName,
        isImage: file.isImage,
        mimeType: file.mimeType,
        kind: file.kind,
      });
    }
    return downloaded;
  }

  function reorderQueuedTelegramTurns(ctx: ExtensionContext): void {
    queuedTelegramItems.sort(compareTelegramQueueItems);
    updateStatus(ctx);
  }

  function removePendingMediaGroupMessages(messageIds: number[]): void {
    if (messageIds.length === 0 || mediaGroups.size === 0) return;
    const deletedMessageIds = new Set(messageIds);
    for (const [key, state] of mediaGroups.entries()) {
      if (
        !state.messages.some((message) =>
          deletedMessageIds.has(message.message_id),
        )
      ) {
        continue;
      }
      if (state.flushTimer) clearTimeout(state.flushTimer);
      mediaGroups.delete(key);
    }
  }

  function removeQueuedTelegramTurnsByMessageIds(
    messageIds: number[],
    ctx: ExtensionContext,
  ): number {
    const result = removeTelegramQueueItemsByMessageIds(
      queuedTelegramItems,
      messageIds,
    );
    if (result.removedCount === 0) return 0;
    queuedTelegramItems = result.items;
    updateStatus(ctx);
    return result.removedCount;
  }

  function clearQueuedTelegramTurnPriorityByMessageId(
    messageId: number,
    ctx: ExtensionContext,
  ): boolean {
    const result = clearTelegramQueuePromptPriority(
      queuedTelegramItems,
      messageId,
    );
    if (!result.changed) return false;
    queuedTelegramItems = result.items;
    reorderQueuedTelegramTurns(ctx);
    return true;
  }

  function prioritizeQueuedTelegramTurnByMessageId(
    messageId: number,
    ctx: ExtensionContext,
  ): boolean {
    const result = prioritizeTelegramQueuePrompt(
      queuedTelegramItems,
      messageId,
      nextPriorityReactionOrder,
    );
    if (!result.changed) return false;
    queuedTelegramItems = result.items;
    nextPriorityReactionOrder += 1;
    reorderQueuedTelegramTurns(ctx);
    return true;
  }

  async function handleAuthorizedTelegramReactionUpdate(
    reactionUpdate: TelegramMessageReactionUpdated,
    ctx: ExtensionContext,
  ): Promise<void> {
    const reactionUser = reactionUpdate.user;
    if (
      reactionUpdate.chat.type !== "private" ||
      !reactionUser ||
      reactionUser.is_bot ||
      reactionUser.id !== config.allowedUserId
    ) {
      return;
    }
    const oldEmojis = collectTelegramReactionEmojis(
      reactionUpdate.old_reaction,
    );
    const newEmojis = collectTelegramReactionEmojis(
      reactionUpdate.new_reaction,
    );
    const dislikeAdded = !oldEmojis.has("👎") && newEmojis.has("👎");
    if (dislikeAdded) {
      removePendingMediaGroupMessages([reactionUpdate.message_id]);
      removeQueuedTelegramTurnsByMessageIds([reactionUpdate.message_id], ctx);
      return;
    }
    const likeRemoved = oldEmojis.has("👍") && !newEmojis.has("👍");
    if (likeRemoved) {
      clearQueuedTelegramTurnPriorityByMessageId(
        reactionUpdate.message_id,
        ctx,
      );
    }
    const likeAdded = !oldEmojis.has("👍") && newEmojis.has("👍");
    if (!likeAdded) return;
    prioritizeQueuedTelegramTurnByMessageId(reactionUpdate.message_id, ctx);
  }

  async function createTelegramTurn(
    messages: TelegramMessage[],
    historyTurns: PendingTelegramTurn[] = [],
  ): Promise<PendingTelegramTurn> {
    const files = await buildTelegramFiles(messages);
    const rawText = extractTelegramMessagesText(messages);
    const inputModality = detectTelegramInputModality(messages);
    const voiceSettings = getVoiceSettings(process.cwd());
    const voiceFile = files.find(
      (file) => file.kind === "voice" || file.kind === "audio",
    );
    let voiceTranscript: string | undefined;
    let voiceTranscriptLanguage: string | undefined;
    let voiceTranscriptionError: string | undefined;
    if (
      voiceSettings.enabled &&
      voiceSettings.autoTranscribeIncoming &&
      voiceFile
    ) {
      try {
        const transcript = await transcribeTelegramAudio({
          cwd: process.cwd(),
          filePath: voiceFile.path,
          settings: voiceSettings,
          language: voiceSettings.sttLanguage || voiceSettings.defaultLanguage,
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
      voiceSettings.enabled &&
      voiceSettings.replyWithVoiceOnIncomingVoice
        ? "voice-required"
        : "text";
    return buildTelegramPromptTurn({
      telegramPrefix: TELEGRAM_PREFIX,
      messages,
      historyTurns,
      queueOrder: nextQueuedTelegramItemOrder++,
      rawText,
      files,
      readBinaryFile: async (path) => readFile(path),
      inferImageMimeType: guessMediaType,
      inputModality,
      replyModality,
      voiceFilePath: voiceFile?.kind === "voice" ? voiceFile.path : undefined,
      voiceTranscript,
      voiceTranscriptLanguage,
      voiceTranscriptionError,
      explicitTextCopyRequested: detectExplicitTelegramTextCopyRequest(
        [rawText, voiceTranscript].filter(Boolean).join("\n\n"),
      ),
    });
  }

  async function handleStopCommand(
    message: TelegramMessage,
    ctx: ExtensionContext,
  ): Promise<void> {
    if (currentAbort) {
      pendingTelegramModelSwitch = undefined;
      if (queuedTelegramItems.length > 0) {
        preserveQueuedTurnsAsHistory = true;
      }
      currentAbort();
      updateStatus(ctx);
      await sendTextReply(
        message.chat.id,
        message.message_id,
        "Aborted current turn.",
      );
      return;
    }
    await sendTextReply(message.chat.id, message.message_id, "No active turn.");
  }

  async function handleCompactCommand(
    message: TelegramMessage,
    ctx: ExtensionContext,
  ): Promise<void> {
    if (
      !ctx.isIdle() ||
      ctx.hasPendingMessages() ||
      activeTelegramTurn ||
      telegramTurnDispatchPending ||
      queuedTelegramItems.length > 0 ||
      compactionInProgress
    ) {
      await sendTextReply(
        message.chat.id,
        message.message_id,
        "Cannot compact while pi or the Telegram queue is busy. Wait for queued turns to finish or send /stop first.",
      );
      return;
    }
    compactionInProgress = true;
    updateStatus(ctx);
    try {
      ctx.compact({
        onComplete: () => {
          compactionInProgress = false;
          updateStatus(ctx);
          dispatchNextQueuedTelegramTurn(ctx);
          void sendTextReply(
            message.chat.id,
            message.message_id,
            "Compaction completed.",
          );
        },
        onError: (error) => {
          compactionInProgress = false;
          updateStatus(ctx);
          dispatchNextQueuedTelegramTurn(ctx);
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          void sendTextReply(
            message.chat.id,
            message.message_id,
            `Compaction failed: ${errorMessage}`,
          );
        },
      });
    } catch (error) {
      compactionInProgress = false;
      updateStatus(ctx);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await sendTextReply(
        message.chat.id,
        message.message_id,
        `Compaction failed: ${errorMessage}`,
      );
      return;
    }
    await sendTextReply(
      message.chat.id,
      message.message_id,
      "Compaction started.",
    );
  }

  async function handleStatusCommand(
    message: TelegramMessage,
    ctx: ExtensionContext,
  ): Promise<void> {
    enqueueTelegramControlItem(
      createTelegramControlItem(
        message.chat.id,
        message.message_id,
        "status",
        "⚡ status",
        async (controlCtx) => {
          await sendStatusMessage(
            message.chat.id,
            message.message_id,
            controlCtx,
          );
        },
      ),
      ctx,
    );
  }

  async function handleModelCommand(
    message: TelegramMessage,
    ctx: ExtensionContext,
  ): Promise<void> {
    enqueueTelegramControlItem(
      createTelegramControlItem(
        message.chat.id,
        message.message_id,
        "model",
        "⚡ model",
        async (controlCtx) => {
          await openModelMenu(message.chat.id, message.message_id, controlCtx);
        },
      ),
      ctx,
    );
  }

  async function handleHelpCommand(
    message: TelegramMessage,
    commandName: string,
    ctx: ExtensionContext,
  ): Promise<void> {
    let helpText =
      "Send me a message and I will forward it to pi. Commands: /status, /model, /compact, /stop.";
    if (commandName === "start") {
      try {
        await registerTelegramBotCommands();
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        helpText += `\n\nWarning: failed to register bot commands menu: ${errorMessage}`;
      }
    }
    await sendTextReply(message.chat.id, message.message_id, helpText);
    if (config.allowedUserId === undefined && message.from) {
      config.allowedUserId = message.from.id;
      await writeTelegramConfig(AGENT_DIR, CONFIG_PATH, config);
      updateStatus(ctx);
    }
  }

  async function handleTelegramCommand(
    commandName: string | undefined,
    message: TelegramMessage,
    ctx: ExtensionContext,
  ): Promise<boolean> {
    if (!commandName) return false;
    const handlers: Partial<Record<string, () => Promise<void>>> = {
      stop: () => handleStopCommand(message, ctx),
      compact: () => handleCompactCommand(message, ctx),
      status: () => handleStatusCommand(message, ctx),
      model: () => handleModelCommand(message, ctx),
      help: () => handleHelpCommand(message, commandName, ctx),
      start: () => handleHelpCommand(message, commandName, ctx),
    };
    const handler = handlers[commandName];
    if (!handler) return false;
    await handler();
    return true;
  }

  async function enqueueTelegramTurn(
    messages: TelegramMessage[],
    ctx: ExtensionContext,
  ): Promise<void> {
    const historyResult = preserveQueuedTurnsAsHistory
      ? partitionTelegramQueueItemsForHistory(queuedTelegramItems)
      : { historyTurns: [], remainingItems: queuedTelegramItems };
    queuedTelegramItems = historyResult.remainingItems;
    preserveQueuedTurnsAsHistory = false;
    const turn = await createTelegramTurn(messages, historyResult.historyTurns);
    queuedTelegramItems.push(turn);
    updateStatus(ctx);
    dispatchNextQueuedTelegramTurn(ctx);
  }

  async function dispatchAuthorizedTelegramMessages(
    messages: TelegramMessage[],
    ctx: ExtensionContext,
  ): Promise<void> {
    const firstMessage = messages[0];
    if (!firstMessage) return;
    const rawText = extractFirstTelegramMessageText(messages);
    const commandName = parseTelegramCommand(rawText)?.name;
    const handled = await handleTelegramCommand(commandName, firstMessage, ctx);
    if (handled) return;
    await enqueueTelegramTurn(messages, ctx);
  }

  async function handleAuthorizedTelegramMessage(
    message: TelegramMessage,
    ctx: ExtensionContext,
  ): Promise<void> {
    if (message.media_group_id) {
      const key = `${message.chat.id}:${message.media_group_id}`;
      const existing = mediaGroups.get(key) ?? { messages: [] };
      existing.messages.push(message);
      if (existing.flushTimer) clearTimeout(existing.flushTimer);
      existing.flushTimer = setTimeout(() => {
        const state = mediaGroups.get(key);
        mediaGroups.delete(key);
        if (!state) return;
        void dispatchAuthorizedTelegramMessages(state.messages, ctx);
      }, TELEGRAM_MEDIA_GROUP_DEBOUNCE_MS);
      mediaGroups.set(key, existing);
      return;
    }

    await dispatchAuthorizedTelegramMessages([message], ctx);
  }

  async function pairTelegramUserIfNeeded(
    userId: number,
    ctx: ExtensionContext,
  ): Promise<boolean> {
    const authorization = getTelegramAuthorizationState(
      userId,
      config.allowedUserId,
    );
    if (authorization.kind !== "pair") return false;
    config.allowedUserId = authorization.userId;
    await writeTelegramConfig(AGENT_DIR, CONFIG_PATH, config);
    updateStatus(ctx);
    return true;
  }

  async function handleUpdate(
    update: TelegramUpdate,
    ctx: ExtensionContext,
  ): Promise<void> {
    await executeTelegramUpdate(update, config.allowedUserId, {
      ctx,
      removePendingMediaGroupMessages,
      removeQueuedTelegramTurnsByMessageIds,
      handleAuthorizedTelegramReactionUpdate: async (
        reactionUpdate,
        nextCtx,
      ) => {
        await handleAuthorizedTelegramReactionUpdate(
          reactionUpdate as TelegramMessageReactionUpdated,
          nextCtx,
        );
      },
      pairTelegramUserIfNeeded,
      answerCallbackQuery,
      handleAuthorizedTelegramCallbackQuery: async (query, nextCtx) => {
        await handleAuthorizedTelegramCallbackQuery(
          query as TelegramCallbackQuery,
          nextCtx,
        );
      },
      sendTextReply,
      handleAuthorizedTelegramMessage: async (message, nextCtx) => {
        await handleAuthorizedTelegramMessage(
          message as TelegramMessage,
          nextCtx,
        );
      },
    });
  }

  // --- Polling ---

  async function stopPolling(): Promise<void> {
    stopTypingLoop();
    pollingController?.abort();
    pollingController = undefined;
    await pollingPromise?.catch(() => undefined);
    pollingPromise = undefined;
  }

  async function pollLoop(
    ctx: ExtensionContext,
    signal: AbortSignal,
  ): Promise<void> {
    await runTelegramPollLoop<TelegramUpdate>({
      ctx,
      signal,
      config,
      deleteWebhook: async (pollSignal) => {
        await callTelegramApi(
          "deleteWebhook",
          { drop_pending_updates: false },
          { signal: pollSignal },
        );
      },
      getUpdates: async (body, pollSignal) => {
        return callTelegramApi<TelegramUpdate[]>("getUpdates", body, {
          signal: pollSignal,
        });
      },
      persistConfig: async () => {
        await writeTelegramConfig(AGENT_DIR, CONFIG_PATH, config);
      },
      handleUpdate: async (update, loopCtx) => {
        await handleUpdate(update, loopCtx);
      },
      onErrorStatus: (message) => {
        updateStatus(ctx, message);
      },
      onStatusReset: () => {
        updateStatus(ctx);
      },
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });
  }

  async function startPolling(ctx: ExtensionContext): Promise<void> {
    if (
      !shouldStartTelegramPolling({
        hasBotToken: !!config.botToken,
        hasPollingPromise: !!pollingPromise,
      })
    ) {
      return;
    }
    pollingController = new AbortController();
    pollingPromise = pollLoop(ctx, pollingController.signal).finally(() => {
      pollingPromise = undefined;
      pollingController = undefined;
      updateStatus(ctx);
    });
    updateStatus(ctx);
  }

  async function handleVoiceSettingsCommand(
    args: string,
    ctx: ExtensionContext,
  ): Promise<void> {
    const command = parseTelegramVoiceCommand(args);
    if (!command) {
      ctx.ui.notify(
        "Usage: /telegram-voice [status|on|off|reply on|reply off|transcribe on|transcribe off|text on|text off|voice <id>|lang <code>|provider <id>|style literal|rewrite-light|rewrite-tags|rewrite-strong|prompt|prompt reset]",
        "error",
      );
      return;
    }
    if (command.action === "prompt") {
      const currentPrompt =
        config.voice?.speechPreparationPrompt ||
        DEFAULT_TELEGRAM_SPEECH_PREPARATION_PROMPT;
      const edited = await ctx.ui.editor(
        "Telegram voice speech-preparation prompt",
        currentPrompt,
      );
      if (edited === undefined) {
        return;
      }
      config = {
        ...config,
        voice: {
          ...(config.voice || {}),
          speechPreparationPrompt: edited.trim() || undefined,
        },
      };
      await writeTelegramConfig(AGENT_DIR, CONFIG_PATH, config);
    } else if (command.action === "prompt-reset") {
      config = {
        ...config,
        voice: {
          ...(config.voice || {}),
          speechPreparationPrompt: undefined,
        },
      };
      await writeTelegramConfig(AGENT_DIR, CONFIG_PATH, config);
    } else if (command.action !== "status") {
      config = updateTelegramVoiceConfig(config, command);
      await writeTelegramConfig(AGENT_DIR, CONFIG_PATH, config);
    }
    const status = formatTelegramVoiceStatus(getVoiceSettings(ctx.cwd));
    ctx.ui.notify(status, "info");
    updateStatus(ctx);
  }

  // --- Extension Registration ---

  registerTelegramAttachmentTool(pi, {
    maxAttachmentsPerTurn: MAX_ATTACHMENTS_PER_TURN,
    getActiveTurn: () => activeTelegramTurn,
    statPath: stat,
  });

  registerTelegramVoiceTool(pi, {
    getActiveTurn: () => activeTelegramTurn,
    getProactiveChatId: () => config.allowedUserId,
    shouldKeepTextReply: (activeTurn, alsoSendText) => {
      return shouldKeepTelegramTextReply(activeTurn, alsoSendText);
    },
    sendVoiceReply: async (options) => {
      const turn = activeTelegramTurn;
      const proactiveChatId = options.proactiveChatId ?? config.allowedUserId;
      if (!turn && !proactiveChatId) {
        throw new Error(
          "telegram_send_voice requires an active Telegram turn or a paired Telegram user for proactive delivery",
        );
      }
      const voiceSettings = getVoiceSettings(process.cwd());
      const shouldSkipFinalTextReply = options.alsoSendText !== true;
      if (turn) {
        await clearPreview(turn.chatId);
      }
      await sendTelegramVoiceReply({
        chatId: turn?.chatId ?? proactiveChatId!,
        replyToMessageId: turn?.replyToMessageId,
        text: options.text,
        cwd: process.cwd(),
        voiceId: options.voiceId || voiceSettings.defaultVoiceId,
        language: options.language || voiceSettings.defaultLanguage,
        alsoSendText: options.alsoSendText,
        inputModality: turn?.inputModality,
        transcriptLanguage: turn?.voiceTranscriptLanguage,
      });
      if (turn) {
        turn.skipFinalTextReply = shouldSkipFinalTextReply;
        turn.voiceReplyDelivered = true;
      }
    },
    getDefaultVoiceSettings: () => getVoiceSettings(process.cwd()),
  });

  registerTelegramCommands(pi, {
    promptForConfig,
    getStatusLines: () => {
      const voiceSettings = getVoiceSettings(process.cwd());
      return [
        `bot: ${config.botUsername ? `@${config.botUsername}` : "not configured"}`,
        `allowed user: ${config.allowedUserId ?? "not paired"}`,
        `polling: ${pollingPromise ? "running" : "stopped"}`,
        `active telegram turn: ${activeTelegramTurn ? "yes" : "no"}`,
        `queued telegram turns: ${queuedTelegramItems.length}`,
        `voice: ${voiceSettings.enabled ? "on" : "off"}/${voiceSettings.provider}/${voiceSettings.speechStyle}${voiceSettings.alsoSendTextReply ? " + text" : ""}`,
      ];
    },
    reloadConfig: async () => {
      config = await readTelegramConfig(CONFIG_PATH);
    },
    hasBotToken: () => !!config.botToken,
    handleVoiceCommand: handleVoiceSettingsCommand,
    startPolling,
    stopPolling,
    updateStatus,
  });

  // --- Lifecycle Hooks ---

  registerTelegramLifecycleHooks(pi, {
    onSessionStart: async (_event, ctx) => {
      config = await readTelegramConfig(CONFIG_PATH);
      const sessionStartState = buildTelegramSessionStartState(ctx.model);
      currentTelegramModel = sessionStartState.currentTelegramModel;
      activeTelegramToolExecutions =
        sessionStartState.activeTelegramToolExecutions;
      pendingTelegramModelSwitch = sessionStartState.pendingTelegramModelSwitch;
      nextQueuedTelegramItemOrder =
        sessionStartState.nextQueuedTelegramItemOrder;
      nextQueuedTelegramControlOrder =
        sessionStartState.nextQueuedTelegramControlOrder;
      telegramTurnDispatchPending =
        sessionStartState.telegramTurnDispatchPending;
      compactionInProgress = sessionStartState.compactionInProgress;
      await mkdir(TEMP_DIR, { recursive: true });
      updateStatus(ctx);
    },
    onSessionShutdown: async (_event, _ctx) => {
      const shutdownState =
        buildTelegramSessionShutdownState<TelegramQueueItem>();
      queuedTelegramItems = shutdownState.queuedTelegramItems;
      nextQueuedTelegramItemOrder = shutdownState.nextQueuedTelegramItemOrder;
      nextQueuedTelegramControlOrder =
        shutdownState.nextQueuedTelegramControlOrder;
      nextPriorityReactionOrder = shutdownState.nextPriorityReactionOrder;
      currentTelegramModel = shutdownState.currentTelegramModel;
      activeTelegramToolExecutions = shutdownState.activeTelegramToolExecutions;
      pendingTelegramModelSwitch = shutdownState.pendingTelegramModelSwitch;
      telegramTurnDispatchPending = shutdownState.telegramTurnDispatchPending;
      compactionInProgress = shutdownState.compactionInProgress;
      for (const state of mediaGroups.values()) {
        if (state.flushTimer) clearTimeout(state.flushTimer);
      }
      mediaGroups.clear();
      modelMenus.clear();
      if (activeTelegramTurn) {
        await clearPreview(activeTelegramTurn.chatId);
      }
      activeTelegramTurn = undefined;
      currentAbort = undefined;
      preserveQueuedTurnsAsHistory = false;
      await stopPolling();
    },
    onBeforeAgentStart: (event) => {
      const nextEvent = event as { prompt: string; systemPrompt: string };
      const suffix = isTelegramPrompt(nextEvent.prompt)
        ? `${SYSTEM_PROMPT_SUFFIX}\n- The current user message came from Telegram.`
        : SYSTEM_PROMPT_SUFFIX;
      return {
        systemPrompt: nextEvent.systemPrompt + suffix,
      };
    },
    onModelSelect: (event, ctx) => {
      currentTelegramModel = (event as { model: Model<any> }).model;
      updateStatus(ctx);
    },
    onAgentStart: async (_event, ctx) => {
      currentAbort = () => ctx.abort();
      const startPlan = buildTelegramAgentStartPlan({
        queuedItems: queuedTelegramItems,
        hasPendingDispatch: telegramTurnDispatchPending,
        hasActiveTurn: !!activeTelegramTurn,
      });
      if (startPlan.shouldResetToolExecutions) {
        activeTelegramToolExecutions = 0;
      }
      if (startPlan.shouldResetPendingModelSwitch) {
        pendingTelegramModelSwitch = undefined;
      }
      queuedTelegramItems = startPlan.remainingItems;
      if (startPlan.shouldClearDispatchPending) {
        telegramTurnDispatchPending = false;
      }
      if (startPlan.activeTurn) {
        activeTelegramTurn = { ...startPlan.activeTurn };
        previewState = createPreviewState();
        startTelegramTurnChatActionLoop(ctx, startPlan.activeTurn);
      }
      updateStatus(ctx);
    },
    onToolExecutionStart: () => {
      activeTelegramToolExecutions = getNextTelegramToolExecutionCount({
        hasActiveTurn: !!activeTelegramTurn,
        currentCount: activeTelegramToolExecutions,
        event: "start",
      });
    },
    onToolExecutionEnd: (_event, ctx) => {
      activeTelegramToolExecutions = getNextTelegramToolExecutionCount({
        hasActiveTurn: !!activeTelegramTurn,
        currentCount: activeTelegramToolExecutions,
        event: "end",
      });
      if (!activeTelegramTurn) return;
      triggerPendingTelegramModelSwitchAbort(ctx);
    },
    onMessageStart: async (event, _ctx) => {
      const nextEvent = event as { message: AgentMessage };
      if (!activeTelegramTurn || !isAssistantMessage(nextEvent.message)) return;
      if (
        previewState &&
        (previewState.pendingText.trim().length > 0 ||
          previewState.lastSentText.trim().length > 0)
      ) {
        if (shouldSuppressTelegramTextPreview(activeTelegramTurn)) {
          await clearPreview(activeTelegramTurn.chatId);
          previewState = createPreviewState();
          return;
        }
        const previousText = previewState.pendingText.trim();
        if (previousText.length > 0) {
          await finalizeMarkdownPreview(
            activeTelegramTurn.chatId,
            previousText,
          );
        } else {
          await finalizePreview(activeTelegramTurn.chatId);
        }
      }
      previewState = createPreviewState();
    },
    onMessageUpdate: async (event, _ctx) => {
      const nextEvent = event as { message: AgentMessage };
      if (!activeTelegramTurn || !isAssistantMessage(nextEvent.message)) return;
      if (shouldSuppressTelegramTextPreview(activeTelegramTurn)) {
        if (previewState) {
          await clearPreview(activeTelegramTurn.chatId);
        }
        previewState = createPreviewState();
        return;
      }
      if (!previewState) {
        previewState = createPreviewState();
      }
      previewState.pendingText = getMessageText(nextEvent.message);
      schedulePreviewFlush(activeTelegramTurn.chatId);
    },
    onAgentEnd: async (event, ctx) => {
      const turn = activeTelegramTurn;
      currentAbort = undefined;
      stopTypingLoop();
      activeTelegramTurn = undefined;
      activeTelegramToolExecutions = 0;
      pendingTelegramModelSwitch = undefined;
      telegramTurnDispatchPending = false;
      updateStatus(ctx);
      const assistant = turn
        ? extractAssistantText((event as { messages: AgentMessage[] }).messages)
        : {};
      const finalText = assistant.text;
      const endPlan = buildTelegramAgentEndPlan({
        hasTurn: !!turn,
        stopReason: assistant.stopReason,
        hasFinalText: !!finalText,
        hasQueuedAttachments: (turn?.queuedAttachments.length ?? 0) > 0,
        preserveQueuedTurnsAsHistory,
      });
      if (!turn) {
        if (endPlan.shouldDispatchNext) {
          dispatchNextQueuedTelegramTurn(ctx);
        }
        return;
      }
      if (endPlan.shouldClearPreview) {
        await clearPreview(turn.chatId);
      }
      if (endPlan.shouldSendErrorMessage) {
        await sendTextReply(
          turn.chatId,
          turn.replyToMessageId,
          assistant.errorMessage ||
            "Telegram bridge: pi failed while processing the request.",
        );
        if (endPlan.shouldDispatchNext) {
          dispatchNextQueuedTelegramTurn(ctx);
        }
        return;
      }
      if (previewState) {
        previewState.pendingText = finalText ?? previewState.pendingText;
      }
      if (
        endPlan.kind === "text" &&
        finalText &&
        turn.replyModality === "voice-required" &&
        !turn.voiceReplyDelivered
      ) {
        const voiceSettings = getVoiceSettings(ctx.cwd);
        try {
          const keepTextReply =
            turn.explicitTextCopyRequested === true ||
            voiceSettings.alsoSendTextReply === true;
          await sendTelegramVoiceReply({
            chatId: turn.chatId,
            replyToMessageId: turn.replyToMessageId,
            text: finalText,
            cwd: ctx.cwd,
            ctx,
            voiceId: voiceSettings.defaultVoiceId,
            language: voiceSettings.defaultLanguage,
            alsoSendText: keepTextReply,
            inputModality: turn.inputModality,
            transcriptLanguage: turn.voiceTranscriptLanguage,
          });
          turn.voiceReplyDelivered = true;
          turn.skipFinalTextReply = !keepTextReply;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await sendTextReply(
            turn.chatId,
            turn.replyToMessageId,
            `Voice reply failed. Falling back to text.\n${message}`,
          );
        }
      }
      if (endPlan.kind === "text" && finalText && !turn.skipFinalTextReply) {
        const finalized = await finalizeMarkdownPreview(turn.chatId, finalText);
        if (!finalized) {
          await clearPreview(turn.chatId);
          await sendMarkdownReply(
            turn.chatId,
            turn.replyToMessageId,
            finalText,
          );
        }
      } else if (turn.skipFinalTextReply) {
        await clearPreview(turn.chatId);
      }
      if (endPlan.shouldSendAttachmentNotice) {
        await sendTextReply(
          turn.chatId,
          turn.replyToMessageId,
          "Attached requested file(s).",
        );
      }
      await sendQueuedAttachments(turn);
      if (endPlan.shouldDispatchNext) {
        dispatchNextQueuedTelegramTurn(ctx);
      }
    },
  });
}
