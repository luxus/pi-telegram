/**
 * Telegram preview streaming helpers
 * Owns preview transport selection, runtime updates, and preview finalization
 */

import {
  buildTelegramPreviewSnapshot,
  type TelegramPreviewRenderStrategy,
  type TelegramPreviewSnapshot,
  type TelegramRenderedChunk,
  type TelegramRenderMode,
} from "./rendering.ts";

export interface TelegramPreviewStateLike {
  mode: "draft" | "message";
  draftId?: number;
  messageId?: number;
  pendingText: string;
  lastSentText: string;
  lastSentParseMode?: "HTML";
  lastSentStrategy?: TelegramPreviewRenderStrategy;
}

export interface TelegramPreviewRuntimeState extends TelegramPreviewStateLike {
  flushTimer?: ReturnType<typeof setTimeout>;
}

export interface TelegramSentPreviewMessageLike {
  message_id: number;
}

export interface TelegramPreviewRuntimeDeps {
  getState: () => TelegramPreviewRuntimeState | undefined;
  setState: (state: TelegramPreviewRuntimeState | undefined) => void;
  clearScheduledFlush: (state: TelegramPreviewRuntimeState) => void;
  maxMessageLength: number;
  renderPreviewText: (markdown: string) => string;
  getDraftSupport: () => "unknown" | "supported" | "unsupported";
  setDraftSupport: (support: "unknown" | "supported" | "unsupported") => void;
  allocateDraftId: () => number;
  sendDraft: (chatId: number, draftId: number, text: string) => Promise<void>;
  sendMessage: (
    chatId: number,
    text: string,
    options?: { parseMode?: "HTML" },
  ) => Promise<TelegramSentPreviewMessageLike>;
  editMessageText: (
    chatId: number,
    messageId: number,
    text: string,
    options?: { parseMode?: "HTML" },
  ) => Promise<void>;
  renderTelegramMessage: (
    text: string,
    options?: { mode?: TelegramRenderMode },
  ) => TelegramRenderedChunk[];
  sendRenderedChunks: (
    chatId: number,
    chunks: TelegramRenderedChunk[],
  ) => Promise<number | undefined>;
  editRenderedMessage: (
    chatId: number,
    messageId: number,
    chunks: TelegramRenderedChunk[],
  ) => Promise<number | undefined>;
}

export function buildTelegramPreviewFinalText(
  state: TelegramPreviewStateLike,
): string | undefined {
  const finalText = state.pendingText.trim();
  if (finalText) return finalText;
  if (
    state.lastSentStrategy === "rich-stable-blocks" ||
    state.lastSentParseMode === "HTML"
  ) {
    return undefined;
  }
  return state.lastSentText.trim() || undefined;
}

export function shouldUseTelegramDraftPreview(options: {
  draftSupport: "unknown" | "supported" | "unsupported";
  snapshot?: TelegramPreviewSnapshot;
}): boolean {
  return (
    options.draftSupport !== "unsupported" &&
    (options.snapshot === undefined || options.snapshot.strategy === "plain")
  );
}

export async function clearTelegramPreview(
  chatId: number,
  deps: TelegramPreviewRuntimeDeps,
): Promise<void> {
  const state = deps.getState();
  if (!state) return;
  deps.clearScheduledFlush(state);
  deps.setState(undefined);
  if (state.mode !== "draft" || state.draftId === undefined) return;
  try {
    await deps.sendDraft(chatId, state.draftId, "");
  } catch {
    // ignore
  }
}

export async function flushTelegramPreview(
  chatId: number,
  deps: TelegramPreviewRuntimeDeps,
): Promise<void> {
  const state = deps.getState();
  if (!state) return;
  state.flushTimer = undefined;
  const snapshot = buildTelegramPreviewSnapshot({
    state,
    maxMessageLength: deps.maxMessageLength,
    renderPreviewText: deps.renderPreviewText,
    renderTelegramMessage: deps.renderTelegramMessage,
  });
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
      await deps.sendDraft(chatId, draftId, snapshot.text);
      deps.setDraftSupport("supported");
      state.mode = "draft";
      state.lastSentText = snapshot.text;
      state.lastSentParseMode = snapshot.parseMode;
      state.lastSentStrategy = snapshot.strategy;
      return;
    } catch {
      deps.setDraftSupport("unsupported");
    }
  }
  if (state.mode === "draft" && state.draftId !== undefined) {
    try {
      await deps.sendDraft(chatId, state.draftId, "");
    } catch {
      // ignore
    }
  }
  if (state.messageId === undefined) {
    const sent = await deps.sendMessage(chatId, snapshot.text, {
      parseMode: snapshot.parseMode,
    });
    state.messageId = sent.message_id;
    state.mode = "message";
    state.lastSentText = snapshot.text;
    state.lastSentParseMode = snapshot.parseMode;
    state.lastSentStrategy = snapshot.strategy;
    return;
  }
  await deps.editMessageText(chatId, state.messageId, snapshot.text, {
    parseMode: snapshot.parseMode,
  });
  state.mode = "message";
  state.lastSentText = snapshot.text;
  state.lastSentParseMode = snapshot.parseMode;
  state.lastSentStrategy = snapshot.strategy;
}

export async function finalizeTelegramPreview(
  chatId: number,
  deps: TelegramPreviewRuntimeDeps,
): Promise<boolean> {
  const state = deps.getState();
  if (!state) return false;
  await flushTelegramPreview(chatId, deps);
  const finalText = buildTelegramPreviewFinalText(state);
  if (!finalText) {
    await clearTelegramPreview(chatId, deps);
    return false;
  }
  if (state.mode === "draft") {
    await deps.sendMessage(chatId, finalText);
    await clearTelegramPreview(chatId, deps);
    return true;
  }
  deps.setState(undefined);
  return state.messageId !== undefined;
}

export async function finalizeTelegramMarkdownPreview(
  chatId: number,
  markdown: string,
  deps: TelegramPreviewRuntimeDeps,
): Promise<boolean> {
  const state = deps.getState();
  if (!state) return false;
  await flushTelegramPreview(chatId, deps);
  const chunks = deps.renderTelegramMessage(markdown, { mode: "markdown" });
  if (chunks.length === 0) {
    await clearTelegramPreview(chatId, deps);
    return false;
  }
  if (state.mode === "draft") {
    await deps.sendRenderedChunks(chatId, chunks);
    await clearTelegramPreview(chatId, deps);
    return true;
  }
  if (state.messageId === undefined) return false;
  await deps.editRenderedMessage(chatId, state.messageId, chunks);
  deps.setState(undefined);
  return true;
}
