/**
 * Telegram reply delivery helpers
 * Owns rendered-message delivery, reply transport wiring, and plain or markdown final replies
 */

import type { TelegramRenderedChunk, TelegramRenderMode } from "./rendering.ts";

export interface TelegramSentMessageLike {
  message_id: number;
}

export interface TelegramReplyDeliveryDeps<TReplyMarkup> {
  sendMessage: (body: {
    chat_id: number;
    text: string;
    parse_mode?: "HTML";
    reply_markup?: TReplyMarkup;
  }) => Promise<TelegramSentMessageLike>;
  editMessage: (body: {
    chat_id: number;
    message_id: number;
    text: string;
    parse_mode?: "HTML";
    reply_markup?: TReplyMarkup;
  }) => Promise<void>;
}

export interface TelegramReplyTransport<TReplyMarkup> {
  sendRenderedChunks: (
    chatId: number,
    chunks: TelegramRenderedChunk[],
    options?: { replyMarkup?: TReplyMarkup },
  ) => Promise<number | undefined>;
  editRenderedMessage: (
    chatId: number,
    messageId: number,
    chunks: TelegramRenderedChunk[],
    options?: { replyMarkup?: TReplyMarkup },
  ) => Promise<number | undefined>;
}

export function buildTelegramReplyTransport<TReplyMarkup>(
  deps: TelegramReplyDeliveryDeps<TReplyMarkup>,
): TelegramReplyTransport<TReplyMarkup> {
  return {
    sendRenderedChunks: async (chatId, chunks, options) => {
      return sendTelegramRenderedChunks(chatId, chunks, deps, options);
    },
    editRenderedMessage: async (chatId, messageId, chunks, options) => {
      return editTelegramRenderedMessage(
        chatId,
        messageId,
        chunks,
        deps,
        options,
      );
    },
  };
}

export async function sendTelegramRenderedChunks<TReplyMarkup>(
  chatId: number,
  chunks: TelegramRenderedChunk[],
  deps: TelegramReplyDeliveryDeps<TReplyMarkup>,
  options?: { replyMarkup?: TReplyMarkup },
): Promise<number | undefined> {
  let lastMessageId: number | undefined;
  for (const [index, chunk] of chunks.entries()) {
    const sent = await deps.sendMessage({
      chat_id: chatId,
      text: chunk.text,
      parse_mode: chunk.parseMode,
      reply_markup:
        index === chunks.length - 1 ? options?.replyMarkup : undefined,
    });
    lastMessageId = sent.message_id;
  }
  return lastMessageId;
}

export async function editTelegramRenderedMessage<TReplyMarkup>(
  chatId: number,
  messageId: number,
  chunks: TelegramRenderedChunk[],
  deps: TelegramReplyDeliveryDeps<TReplyMarkup>,
  options?: { replyMarkup?: TReplyMarkup },
): Promise<number | undefined> {
  if (chunks.length === 0) return messageId;
  const [firstChunk, ...remainingChunks] = chunks;
  await deps.editMessage({
    chat_id: chatId,
    message_id: messageId,
    text: firstChunk.text,
    parse_mode: firstChunk.parseMode,
    reply_markup:
      remainingChunks.length === 0 ? options?.replyMarkup : undefined,
  });
  if (remainingChunks.length > 0) {
    return sendTelegramRenderedChunks(chatId, remainingChunks, deps, options);
  }
  return messageId;
}

export interface TelegramReplyRuntimeDeps {
  renderTelegramMessage: (
    text: string,
    options?: { mode?: TelegramRenderMode },
  ) => TelegramRenderedChunk[];
  sendRenderedChunks: (
    chunks: TelegramRenderedChunk[],
  ) => Promise<number | undefined>;
}

export async function sendTelegramPlainReply(
  text: string,
  deps: TelegramReplyRuntimeDeps,
  options?: { parseMode?: "HTML" },
): Promise<number | undefined> {
  const chunks = deps.renderTelegramMessage(text, {
    mode: options?.parseMode === "HTML" ? "html" : "plain",
  });
  return deps.sendRenderedChunks(chunks);
}

export async function sendTelegramMarkdownReply(
  markdown: string,
  deps: TelegramReplyRuntimeDeps,
): Promise<number | undefined> {
  const chunks = deps.renderTelegramMessage(markdown, { mode: "markdown" });
  if (chunks.length === 0) {
    return sendTelegramPlainReply(markdown, deps);
  }
  return deps.sendRenderedChunks(chunks);
}
