/**
 * Telegram preview streaming helpers
 * Zones: telegram outbound, native rich markdown drafts, fallback preview transport
 * Owns preview transport selection, runtime updates, and preview finalization
 */

import type {
  TelegramEditMessageTextBody,
  TelegramReplyParameters,
  TelegramSendMessageBody,
  TelegramSentMessage,
} from "./telegram-api.ts";
import {
  buildTelegramReplyParameters,
  normalizeTelegramNativeMarkdown,
} from "./replies.ts";
import { stripTelegramCommentMarkupForPreview } from "./outbound.ts";
import { shouldSuppressPreviewForVoice } from "./voice.ts";

const TELEGRAM_PREVIEW_THROTTLE_MS = 0;
const TELEGRAM_DRAFT_ID_MAX = 2_147_483_647;
const TELEGRAM_FALLBACK_PREVIEW_MESSAGE_MAX_CHARS = 4096;

export type TelegramDraftSupport = "unknown" | "supported" | "unsupported";

export interface TelegramPreviewState {
  mode: "draft" | "message";
  draftId?: number;
  messageId?: number;
  pendingText: string;
  lastSentText: string;
  lastSentParseMode?: "HTML";
}

export interface TelegramPreviewRuntimeState extends TelegramPreviewState {
  flushTimer?: ReturnType<typeof setTimeout>;
  flushPromise?: Promise<void>;
  flushRequested?: boolean;
}

export type TelegramSentPreviewMessage = TelegramSentMessage;
export type TelegramPreviewReplyMarkup = unknown;

export interface TelegramPreviewRuntimeDeps<
  TReplyMarkup = TelegramPreviewReplyMarkup,
> {
  getState: () => TelegramPreviewRuntimeState | undefined;
  setState: (state: TelegramPreviewRuntimeState | undefined) => void;
  clearScheduledFlush: (state: TelegramPreviewRuntimeState) => void;
  maxMessageLength: number;
  getDraftSupport: () => TelegramDraftSupport;
  setDraftSupport: (support: TelegramDraftSupport) => void;
  allocateDraftId: () => number;
  sendDraft: (
    chatId: number,
    draftId: number,
    text?: string,
    options?: {
      parse_mode?: string;
      entities?: unknown[];
      message_thread_id?: number;
    },
  ) => Promise<unknown>;
  sendMessage: (
    chatId: number,
    text: string,
    options?: { parseMode?: "HTML" },
  ) => Promise<TelegramSentPreviewMessage>;
  editMessageText: (
    chatId: number,
    messageId: number,
    text: string,
    options?: { parseMode?: "HTML" },
  ) => Promise<unknown>;
  canSend?: () => boolean;
  recordRuntimeEvent?: (
    category: string,
    error: unknown,
    details?: Record<string, unknown>,
  ) => void;
}

export interface TelegramPreviewActiveTurn {
  chatId: number;
  voiceReplyPreferred?: boolean;
  voiceReplyRequired?: boolean;
}

export interface TelegramAssistantMessagePreviewStartDeps<
  TMessage,
  TReplyMarkup = TelegramPreviewReplyMarkup,
> {
  getActiveTurn: () => TelegramPreviewActiveTurn | undefined;
  isAssistantMessage: (message: TMessage) => boolean;
  getState: () => TelegramPreviewRuntimeState | undefined;
  setState: (state: TelegramPreviewRuntimeState | undefined) => void;
  createPreviewState: () => TelegramPreviewRuntimeState;
  finalizePreview: (chatId: number) => Promise<boolean>;
  finalizeMarkdownPreview: (
    chatId: number,
    markdown: string,
    replyToMessageId?: number,
    options?: { replyMarkup?: TReplyMarkup },
  ) => Promise<boolean>;
}

export interface TelegramAssistantMessagePreviewUpdateDeps<TMessage> {
  getActiveTurn: () => TelegramPreviewActiveTurn | undefined;
  isAssistantMessage: (message: TMessage) => boolean;
  getState: () => TelegramPreviewRuntimeState | undefined;
  setState: (state: TelegramPreviewRuntimeState | undefined) => void;
  createPreviewState: () => TelegramPreviewRuntimeState;
  getMessageText: (message: TMessage) => string;
  schedulePreviewFlush: (chatId: number) => void;
}

export type TelegramAssistantMessagePreviewHookDeps<
  TMessage,
  TReplyMarkup = TelegramPreviewReplyMarkup,
> = TelegramAssistantMessagePreviewStartDeps<TMessage, TReplyMarkup> &
  TelegramAssistantMessagePreviewUpdateDeps<TMessage>;

export interface TelegramAssistantMessagePreviewHookEvent<TMessage> {
  message: TMessage;
}

export interface TelegramAssistantMessagePreviewHooks<TMessage> {
  onMessageStart: (
    event: TelegramAssistantMessagePreviewHookEvent<TMessage>,
  ) => Promise<void>;
  onMessageUpdate: (
    event: TelegramAssistantMessagePreviewHookEvent<TMessage>,
  ) => Promise<void>;
}

export interface TelegramPreviewControllerDeps<
  TReplyMarkup = TelegramPreviewReplyMarkup,
> {
  getDefaultReplyToMessageId?: () => number | undefined;
  maxMessageLength?: number;
  initialDraftSupport?: TelegramDraftSupport;
  sendDraft: (
    chatId: number,
    draftId: number,
    text?: string,
    options?: {
      parse_mode?: string;
      entities?: unknown[];
      message_thread_id?: number;
    },
  ) => Promise<unknown>;
  sendMessage: (
    chatId: number,
    text: string,
    options: { parseMode?: "HTML" } | undefined,
    replyToMessageId: number | undefined,
  ) => Promise<TelegramSentPreviewMessage>;
  editMessageText: (
    chatId: number,
    messageId: number,
    text: string,
    options?: { parseMode?: "HTML" },
  ) => Promise<unknown>;
  canSend?: () => boolean;
  throttleMs?: number;
  maxDraftId?: number;
  setTimer?: (
    callback: () => void,
    ms: number,
  ) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  recordRuntimeEvent?: (
    category: string,
    error: unknown,
    details?: Record<string, unknown>,
  ) => void;
}

export interface TelegramPreviewController<
  TReplyMarkup = TelegramPreviewReplyMarkup,
> {
  getState: () => TelegramPreviewRuntimeState | undefined;
  setState: (state: TelegramPreviewRuntimeState | undefined) => void;
  setPendingText: (text: string) => void;
  createState: () => TelegramPreviewRuntimeState;
  resetState: () => void;
  clear: (chatId: number) => Promise<void>;
  flush: (chatId: number) => Promise<void>;
  scheduleFlush: (chatId: number) => void;
  finalize: (chatId: number, replyToMessageId?: number) => Promise<boolean>;
}

export interface TelegramPreviewMessageTransportDeps {
  sendMessage: (body: TelegramSendMessageBody) => Promise<TelegramSentMessage>;
  editMessageText: (body: TelegramEditMessageTextBody) => Promise<unknown>;
  buildReplyParameters?: (
    chatId: number,
    replyToMessageId: number | undefined,
  ) => TelegramReplyParameters | undefined;
}

export function createTelegramPreviewMessageTransport(
  deps: TelegramPreviewMessageTransportDeps,
): Pick<TelegramPreviewControllerDeps, "sendMessage" | "editMessageText"> {
  const getReplyParameters =
    deps.buildReplyParameters ?? buildTelegramReplyParameters;
  return {
    sendMessage: (chatId, text, options, replyToMessageId) => {
      const replyParameters = getReplyParameters(chatId, replyToMessageId);
      return deps.sendMessage({
        chat_id: chatId,
        text,
        parse_mode: options?.parseMode,
        ...(replyParameters ? { reply_parameters: replyParameters } : {}),
      });
    },
    editMessageText: (chatId, messageId, text, options) =>
      deps.editMessageText({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: options?.parseMode,
      }),
  };
}

export type TelegramPreviewControllerRuntimeDeps<
  TReplyMarkup = TelegramPreviewReplyMarkup,
> = Omit<
  TelegramPreviewControllerDeps<TReplyMarkup>,
  "sendMessage" | "editMessageText"
> &
  TelegramPreviewMessageTransportDeps;

export function createTelegramPreviewControllerRuntime<
  TReplyMarkup = TelegramPreviewReplyMarkup,
>(
  deps: TelegramPreviewControllerRuntimeDeps<TReplyMarkup>,
): TelegramPreviewController<TReplyMarkup> {
  return createTelegramPreviewController({
    getDefaultReplyToMessageId: deps.getDefaultReplyToMessageId,
    maxMessageLength: deps.maxMessageLength,
    initialDraftSupport: deps.initialDraftSupport,
    sendDraft: deps.sendDraft,
    ...createTelegramPreviewMessageTransport({
      sendMessage: deps.sendMessage,
      editMessageText: deps.editMessageText,
      buildReplyParameters: deps.buildReplyParameters,
    }),
    throttleMs: deps.throttleMs,
    maxDraftId: deps.maxDraftId,
    setTimer: deps.setTimer,
    clearTimer: deps.clearTimer,
    recordRuntimeEvent: deps.recordRuntimeEvent,
  });
}

export interface TelegramAssistantPreviewRuntimeDeps<
  TMessage,
  TReplyMarkup = TelegramPreviewReplyMarkup,
> extends TelegramPreviewControllerRuntimeDeps<TReplyMarkup> {
  getActiveTurn: () => TelegramPreviewActiveTurn | undefined;
  isAssistantMessage: (message: TMessage) => boolean;
  getMessageText: (message: TMessage) => string;
  sendMarkdownReply: (
    chatId: number,
    replyToMessageId: number | undefined,
    markdown: string,
    options?: { replyMarkup?: TReplyMarkup },
  ) => Promise<number | undefined>;
  editMarkdownMessage?: (
    chatId: number,
    messageId: number,
    markdown: string,
    options?: { replyMarkup?: TReplyMarkup },
  ) => Promise<unknown>;
}

export type TelegramAssistantPreviewRuntime<
  TMessage,
  TReplyMarkup = TelegramPreviewReplyMarkup,
> = TelegramPreviewController<TReplyMarkup> &
  TelegramAssistantMessagePreviewHooks<TMessage> & {
    finalizeMarkdown: (
      chatId: number,
      markdown: string,
      replyToMessageId?: number,
      options?: { replyMarkup?: TReplyMarkup },
    ) => Promise<boolean>;
  };

export function createTelegramNativeMarkdownMessageEditor<TReplyMarkup>(deps: {
  editMessageText: (body: TelegramEditMessageTextBody) => Promise<unknown>;
}): (
  chatId: number,
  messageId: number,
  markdown: string,
  options?: { replyMarkup?: TReplyMarkup },
) => Promise<unknown> {
  return (chatId, messageId, markdown, options) =>
    deps.editMessageText({
      chat_id: chatId,
      message_id: messageId,
      rich_message: {
        markdown: normalizeTelegramNativeMarkdown(markdown),
        skip_entity_detection: true,
      },
      ...(options?.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
    });
}

export function createTelegramNativeMarkdownPreviewFinalizer<TReplyMarkup>(deps: {
  getState: () => TelegramPreviewRuntimeState | undefined;
  clear: (chatId: number) => Promise<void>;
  discard?: () => void;
  sendMarkdownReply: (
    chatId: number,
    replyToMessageId: number | undefined,
    markdown: string,
    options?: { replyMarkup?: TReplyMarkup },
  ) => Promise<number | undefined>;
  editMarkdownMessage?: (
    chatId: number,
    messageId: number,
    markdown: string,
    options?: { replyMarkup?: TReplyMarkup },
  ) => Promise<unknown>;
}): (
  chatId: number,
  markdown: string,
  replyToMessageId?: number,
  options?: { replyMarkup?: TReplyMarkup },
) => Promise<boolean> {
  return async (chatId, markdown, replyToMessageId, options) => {
    const state = deps.getState();
    if (state?.mode === "message" && state.messageId !== undefined) {
      try {
        await deps.editMarkdownMessage?.(chatId, state.messageId, markdown, options);
        await deps.clear(chatId);
        return true;
      } catch {
        // Fall through to a fresh native Rich Message so final text is not lost.
      }
    }
    if (state?.flushPromise) {
      await state.flushPromise.catch(() => {});
    }
    await deps.sendMarkdownReply(chatId, replyToMessageId, markdown, options);
    deps.discard?.();
    return true;
  };
}

export function createTelegramAssistantPreviewRuntime<
  TMessage,
  TReplyMarkup = TelegramPreviewReplyMarkup,
>(
  deps: TelegramAssistantPreviewRuntimeDeps<TMessage, TReplyMarkup>,
): TelegramAssistantPreviewRuntime<TMessage, TReplyMarkup> {
  const controller = createTelegramPreviewControllerRuntime(deps);
  const finalizeMarkdownPreview = createTelegramNativeMarkdownPreviewFinalizer({
    getState: controller.getState,
    clear: controller.clear,
    discard: () => controller.setState(undefined),
    sendMarkdownReply: deps.sendMarkdownReply,
    editMarkdownMessage: deps.editMarkdownMessage,
  });
  return {
    ...controller,
    finalizeMarkdown: finalizeMarkdownPreview,
    ...createTelegramAssistantMessagePreviewHooks({
      getActiveTurn: deps.getActiveTurn,
      isAssistantMessage: deps.isAssistantMessage,
      getState: controller.getState,
      setState: controller.setState,
      createPreviewState: controller.createState,
      finalizePreview: controller.finalize,
      finalizeMarkdownPreview,
      getMessageText: deps.getMessageText,
      schedulePreviewFlush: controller.scheduleFlush,
    }),
  };
}

export function createTelegramPreviewController<
  TReplyMarkup = TelegramPreviewReplyMarkup,
>(
  deps: TelegramPreviewControllerDeps<TReplyMarkup>,
): TelegramPreviewController<TReplyMarkup> {
  let state: TelegramPreviewRuntimeState | undefined;
  const clearTimer = deps.clearTimer ?? clearTimeout;
  const setTimer =
    deps.setTimer ??
    ((callback: () => void, ms: number): ReturnType<typeof setTimeout> =>
      setTimeout(callback, ms));
  const throttleMs = deps.throttleMs ?? TELEGRAM_PREVIEW_THROTTLE_MS;
  const maxDraftId = deps.maxDraftId ?? TELEGRAM_DRAFT_ID_MAX;
  const maxMessageLength =
    deps.maxMessageLength ?? TELEGRAM_FALLBACK_PREVIEW_MESSAGE_MAX_CHARS;
  let draftSupport = deps.initialDraftSupport ?? "unknown";
  let nextDraftId = 0;
  const getRuntimeDeps = (
    replyToMessageId?: number,
  ): TelegramPreviewRuntimeDeps<TReplyMarkup> => ({
    getState: () => state,
    setState: (nextState) => {
      state = nextState;
    },
    clearScheduledFlush: (nextState) => {
      if (!nextState.flushTimer) return;
      clearTimer(nextState.flushTimer);
      nextState.flushTimer = undefined;
    },
    maxMessageLength,
    getDraftSupport: () => draftSupport,
    setDraftSupport: (support) => {
      draftSupport = support;
    },
    allocateDraftId: () => {
      nextDraftId = allocateTelegramDraftId(nextDraftId, maxDraftId);
      return nextDraftId;
    },
    sendDraft: deps.sendDraft,
    sendMessage: (chatId, text, options) =>
      deps.sendMessage(
        chatId,
        text,
        options,
        replyToMessageId ?? deps.getDefaultReplyToMessageId?.(),
      ),
    editMessageText: deps.editMessageText,
    canSend: deps.canSend,
    recordRuntimeEvent: deps.recordRuntimeEvent,
  });
  return {
    getState: () => state,
    setState: (nextState) => {
      state = nextState;
    },
    setPendingText: (text) => {
      if (state) state.pendingText = text;
    },
    createState: () => createTelegramPreviewRuntimeState(draftSupport),
    resetState: () => {
      state = createTelegramPreviewRuntimeState(draftSupport);
    },
    clear: (chatId) => clearTelegramPreview(chatId, getRuntimeDeps()),
    flush: (chatId) => flushTelegramPreview(chatId, getRuntimeDeps()),
    scheduleFlush: (chatId) => {
      if (!state || state.flushTimer) return;
      if (throttleMs <= 0) {
        void flushTelegramPreview(chatId, getRuntimeDeps());
        return;
      }
      state.flushTimer = setTimer(() => {
        void flushTelegramPreview(chatId, getRuntimeDeps());
      }, throttleMs);
      state.flushTimer.unref?.();
    },
    finalize: (chatId, replyToMessageId) =>
      finalizeTelegramPreview(chatId, getRuntimeDeps(replyToMessageId)),
  };
}

export function createTelegramAssistantMessagePreviewHooks<
  TMessage,
  TReplyMarkup = TelegramPreviewReplyMarkup,
>(
  deps: TelegramAssistantMessagePreviewHookDeps<TMessage, TReplyMarkup>,
): TelegramAssistantMessagePreviewHooks<TMessage> {
  return {
    onMessageStart: async (
      event: TelegramAssistantMessagePreviewHookEvent<TMessage>,
    ): Promise<void> => {
      await handleTelegramAssistantMessagePreviewStart(event.message, deps);
    },
    onMessageUpdate: async (
      event: TelegramAssistantMessagePreviewHookEvent<TMessage>,
    ): Promise<void> => {
      await handleTelegramAssistantMessagePreviewUpdate(event.message, deps);
    },
  };
}

export async function handleTelegramAssistantMessagePreviewStart<
  TMessage,
  TReplyMarkup = TelegramPreviewReplyMarkup,
>(
  message: TMessage,
  deps: TelegramAssistantMessagePreviewStartDeps<TMessage, TReplyMarkup>,
): Promise<void> {
  const turn = deps.getActiveTurn();
  if (!turn || !deps.isAssistantMessage(message)) return;
  if (shouldSuppressPreviewForVoice(turn)) {
    deps.setState(undefined);
    return;
  }
  const state = deps.getState();
  if (
    state &&
    (state.pendingText.trim().length > 0 ||
      state.lastSentText.trim().length > 0)
  ) {
    const previousText = state.pendingText.trim();
    if (previousText.length > 0) {
      await deps.finalizeMarkdownPreview(turn.chatId, previousText);
    } else {
      await deps.finalizePreview(turn.chatId);
    }
  }
  deps.setState(deps.createPreviewState());
}

export async function handleTelegramAssistantMessagePreviewUpdate<TMessage>(
  message: TMessage,
  deps: TelegramAssistantMessagePreviewUpdateDeps<TMessage>,
): Promise<void> {
  const turn = deps.getActiveTurn();
  if (!turn || !deps.isAssistantMessage(message)) return;
  if (shouldSuppressPreviewForVoice(turn)) return;
  let state = deps.getState();
  if (!state) {
    state = deps.createPreviewState();
    deps.setState(state);
  }
  state.pendingText = stripTelegramCommentMarkupForPreview(
    deps.getMessageText(message),
  );
  deps.schedulePreviewFlush(turn.chatId);
}

export function buildTelegramPreviewFinalText(
  state: TelegramPreviewState,
): string | undefined {
  const finalText = state.pendingText.trim();
  if (finalText) return finalText;
  if (state.lastSentParseMode === "HTML") {
    return undefined;
  }
  return state.lastSentText.trim() || undefined;
}

export function createTelegramPreviewRuntimeState(
  draftSupport: TelegramDraftSupport,
): TelegramPreviewRuntimeState {
  return {
    mode: draftSupport === "unsupported" ? "message" : "draft",
    pendingText: "",
    lastSentText: "",
  };
}

export function allocateTelegramDraftId(
  currentDraftId: number,
  maxDraftId: number,
): number {
  return currentDraftId >= maxDraftId ? 1 : currentDraftId + 1;
}

interface TelegramNativeMarkdownPreviewSnapshot {
  text: string;
  sourceText: string;
}

export function shouldUseTelegramDraftPreview(options: {
  draftSupport: TelegramDraftSupport;
  snapshot?: TelegramNativeMarkdownPreviewSnapshot;
}): boolean {
  return options.draftSupport !== "unsupported";
}

export async function clearTelegramPreview<
  TReplyMarkup = TelegramPreviewReplyMarkup,
>(
  chatId: number,
  deps: TelegramPreviewRuntimeDeps<TReplyMarkup>,
  options: { awaitFlush?: boolean } = {},
): Promise<void> {
  const state = deps.getState();
  if (!state) return;
  deps.clearScheduledFlush(state);
  if (state.flushPromise && options.awaitFlush !== false) {
    state.flushRequested = false;
    await state.flushPromise.catch(() => {});
    if (deps.getState() !== state) return;
  }
  deps.setState(undefined);
  if (state.mode === "draft" && state.draftId !== undefined) {
    try {
      await deps.sendDraft(chatId, state.draftId, undefined);
    } catch (error) {
      deps.recordRuntimeEvent?.("preview", error, {
        phase: "clear-draft",
        chatId,
        draftId: state.draftId,
      });
    }
  }
}

function buildTelegramNativeMarkdownPreviewSnapshot(
  state: TelegramPreviewState,
  maxMessageLength: number,
): TelegramNativeMarkdownPreviewSnapshot | undefined {
  const sourceText = state.pendingText.trim();
  if (!sourceText || sourceText === state.lastSentText) return undefined;
  return {
    text:
      sourceText.length > maxMessageLength
        ? sourceText.slice(0, maxMessageLength)
        : sourceText,
    sourceText,
  };
}

async function performTelegramPreviewFlush<
  TReplyMarkup = TelegramPreviewReplyMarkup,
>(
  chatId: number,
  state: TelegramPreviewRuntimeState,
  deps: TelegramPreviewRuntimeDeps<TReplyMarkup>,
): Promise<void> {
  if (deps.canSend && !deps.canSend()) {
    await clearTelegramPreview(chatId, deps, { awaitFlush: false });
    return;
  }
  const snapshot = buildTelegramNativeMarkdownPreviewSnapshot(
    state,
    deps.maxMessageLength,
  );
  if (!snapshot) return;
  if (
    shouldUseTelegramDraftPreview({
      draftSupport: deps.getDraftSupport(),
      snapshot,
    })
  ) {
    const draftId = state.draftId ?? deps.allocateDraftId();
    state.draftId = draftId;
    try {
      await deps.sendDraft(
        chatId,
        draftId,
        normalizeTelegramNativeMarkdown(snapshot.sourceText),
      );
      deps.setDraftSupport("supported");
      state.mode = "draft";
      state.lastSentText = snapshot.text;
      state.lastSentParseMode = undefined;
      return;
    } catch {
      deps.setDraftSupport("unsupported");
    }
  }
  if (state.messageId === undefined) {
    const sent = await deps.sendMessage(chatId, snapshot.text, undefined);
    state.messageId = sent.message_id;
    state.mode = "message";
    state.lastSentText = snapshot.text;
    state.lastSentParseMode = undefined;
    return;
  }
  await deps.editMessageText(chatId, state.messageId, snapshot.text, undefined);
  state.mode = "message";
  state.lastSentText = snapshot.text;
  state.lastSentParseMode = undefined;
}

export async function flushTelegramPreview<
  TReplyMarkup = TelegramPreviewReplyMarkup,
>(
  chatId: number,
  deps: TelegramPreviewRuntimeDeps<TReplyMarkup>,
): Promise<void> {
  const state = deps.getState();
  if (!state) return;
  if (state.flushPromise) {
    state.flushRequested = true;
    await state.flushPromise;
    return;
  }
  state.flushTimer = undefined;
  state.flushPromise = (async () => {
    do {
      state.flushRequested = false;
      try {
        await performTelegramPreviewFlush(chatId, state, deps);
      } catch (error) {
        deps.recordRuntimeEvent?.("preview", error, {
          phase: "flush",
          chatId,
          messageId: state.messageId,
        });
        break;
      }
    } while (deps.getState() === state && state.flushRequested);
  })();
  try {
    await state.flushPromise;
  } finally {
    if (deps.getState() === state) {
      state.flushPromise = undefined;
    }
  }
}

export async function finalizeTelegramPreview<
  TReplyMarkup = TelegramPreviewReplyMarkup,
>(
  chatId: number,
  deps: TelegramPreviewRuntimeDeps<TReplyMarkup>,
): Promise<boolean> {
  const state = deps.getState();
  if (!state) return false;
  if (deps.canSend && !deps.canSend()) {
    await clearTelegramPreview(chatId, deps);
    return false;
  }
  await flushTelegramPreview(chatId, deps);
  const finalText = buildTelegramPreviewFinalText(state);
  if (!finalText) {
    await clearTelegramPreview(chatId, deps);
    return false;
  }
  if (state.mode === "draft") {
    await deps.sendMessage(chatId, finalText);
    deps.setState(undefined);
    return true;
  }
  deps.setState(undefined);
  return state.messageId !== undefined;
}
