/**
 * Telegram turn-building helpers
 * Owns prompt-turn summary and content construction so queued Telegram turns are assembled consistently
 */

import { basename } from "node:path";

import type { ImageContent, TextContent } from "@mariozechner/pi-ai";

import {
  collectTelegramMessageIds,
  formatTelegramHistoryText,
} from "./media.ts";
import type { PendingTelegramTurn } from "./queue.ts";

export interface TelegramTurnMessageLike {
  message_id: number;
  chat: { id: number };
}

export interface DownloadedTelegramTurnFileLike {
  path: string;
  fileName: string;
  isImage: boolean;
  mimeType?: string;
  kind?: string;
}

export function truncateTelegramQueueSummary(
  text: string,
  maxWords = 5,
  maxLength = 40,
): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const words = normalized.split(" ");
  let summary = words.slice(0, maxWords).join(" ");
  if (summary.length === 0) summary = normalized;
  if (summary.length > maxLength) {
    summary = summary.slice(0, maxLength).trimEnd();
  }
  return summary.length < normalized.length || words.length > maxWords
    ? `${summary}…`
    : summary;
}

export function formatTelegramTurnStatusSummary(
  rawText: string,
  files: DownloadedTelegramTurnFileLike[],
): string {
  const textSummary = truncateTelegramQueueSummary(rawText);
  if (textSummary) return textSummary;
  if (files.length === 1) {
    const fileName = basename(
      files[0]?.fileName || files[0]?.path || "attachment",
    );
    return `📎 ${truncateTelegramQueueSummary(fileName, 4, 32) || "attachment"}`;
  }
  if (files.length > 1) return `📎 ${files.length} attachments`;
  return "(empty message)";
}

export function buildTelegramTurnPrompt(options: {
  telegramPrefix: string;
  rawText: string;
  files: DownloadedTelegramTurnFileLike[];
  historyTurns?: Pick<PendingTelegramTurn, "historyText">[];
  inputModality?: PendingTelegramTurn["inputModality"];
  replyModality?: PendingTelegramTurn["replyModality"];
  voiceFilePath?: string;
  voiceTranscript?: string;
  voiceTranscriptLanguage?: PendingTelegramTurn["voiceTranscriptLanguage"];
  voiceTranscriptionError?: string;
}): string {
  let prompt = options.telegramPrefix;
  if (options.inputModality && options.inputModality !== "text") {
    prompt += `\n\nInput modality: ${options.inputModality}`;
  }
  if (options.replyModality && options.replyModality !== "text") {
    prompt += `\nReply modality: ${options.replyModality}`;
  }
  if (options.voiceFilePath) {
    prompt += `\nOriginal voice file: ${options.voiceFilePath}`;
  }
  if (options.voiceTranscript) {
    if (options.voiceTranscriptLanguage) {
      prompt += `\nDetected voice language: ${options.voiceTranscriptLanguage}`;
    }
    prompt += `\n\nVoice transcript:\n${options.voiceTranscript}`;
  }
  if (options.voiceTranscriptionError) {
    prompt += `\n\nVoice transcription failed: ${options.voiceTranscriptionError}`;
  }
  if ((options.historyTurns?.length ?? 0) > 0) {
    prompt +=
      "\n\nEarlier Telegram messages arrived after an aborted turn. Treat them as prior user messages, in order:";
    for (const [index, turn] of (options.historyTurns ?? []).entries()) {
      prompt += `\n\n${index + 1}. ${turn.historyText}`;
    }
    prompt += "\n\nCurrent Telegram message:";
  }
  if (options.rawText.length > 0) {
    prompt +=
      (options.historyTurns?.length ?? 0) > 0
        ? `\n${options.rawText}`
        : ` ${options.rawText}`;
  } else if (
    !options.voiceTranscript &&
    (options.historyTurns?.length ?? 0) > 0
  ) {
    prompt += "\n(no text)";
  }
  if (options.files.length > 0) {
    prompt += "\n\nTelegram attachments were saved locally:";
    for (const file of options.files) {
      prompt += `\n- ${file.path}`;
    }
  }
  return prompt;
}

export async function buildTelegramPromptTurn(options: {
  telegramPrefix: string;
  messages: TelegramTurnMessageLike[];
  historyTurns?: PendingTelegramTurn[];
  queueOrder: number;
  rawText: string;
  files: DownloadedTelegramTurnFileLike[];
  readBinaryFile: (path: string) => Promise<Uint8Array>;
  inferImageMimeType: (path: string) => string | undefined;
  inputModality?: PendingTelegramTurn["inputModality"];
  replyModality?: PendingTelegramTurn["replyModality"];
  voiceFilePath?: string;
  voiceTranscript?: string;
  voiceTranscriptLanguage?: string;
  voiceTranscriptionError?: string;
  explicitTextCopyRequested?: boolean;
}): Promise<PendingTelegramTurn> {
  const firstMessage = options.messages[0];
  if (!firstMessage) {
    throw new Error("Missing Telegram message for turn creation");
  }
  const content: Array<TextContent | ImageContent> = [
    {
      type: "text",
      text: buildTelegramTurnPrompt({
        telegramPrefix: options.telegramPrefix,
        rawText: options.rawText,
        files: options.files,
        historyTurns: options.historyTurns,
        inputModality: options.inputModality,
        replyModality: options.replyModality,
        voiceFilePath: options.voiceFilePath,
        voiceTranscript: options.voiceTranscript,
        voiceTranscriptLanguage: options.voiceTranscriptLanguage,
        voiceTranscriptionError: options.voiceTranscriptionError,
      }),
    },
  ];
  for (const file of options.files) {
    if (!file.isImage) continue;
    const mediaType = file.mimeType || options.inferImageMimeType(file.path);
    if (!mediaType) continue;
    const buffer = await options.readBinaryFile(file.path);
    content.push({
      type: "image",
      data: Buffer.from(buffer).toString("base64"),
      mimeType: mediaType,
    });
  }
  const historyBaseText = options.rawText || options.voiceTranscript || "";
  return {
    kind: "prompt",
    chatId: firstMessage.chat.id,
    replyToMessageId: firstMessage.message_id,
    sourceMessageIds: collectTelegramMessageIds(options.messages),
    queueOrder: options.queueOrder,
    queueLane: "default",
    laneOrder: options.queueOrder,
    queuedAttachments: [],
    content,
    historyText: formatTelegramHistoryText(historyBaseText, options.files),
    statusSummary: formatTelegramTurnStatusSummary(
      historyBaseText,
      options.files,
    ),
    inputModality: options.inputModality,
    replyModality: options.replyModality,
    voiceFilePath: options.voiceFilePath,
    voiceTranscript: options.voiceTranscript,
    voiceTranscriptLanguage: options.voiceTranscriptLanguage,
    voiceTranscriptionError: options.voiceTranscriptionError,
    explicitTextCopyRequested: options.explicitTextCopyRequested,
    skipFinalTextReply: false,
    voiceReplyDelivered: false,
  };
}
