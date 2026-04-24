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
}): string {
  let prompt = options.telegramPrefix;
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
  }
  if (options.files.length > 0) {
    prompt += "\n\nTelegram attachments were saved locally:";
    for (const file of options.files) {
      prompt += `\n- ${file.path}`;
    }
  }
  return prompt;
}

function splitTelegramPromptAttachmentSuffix(prompt: string): {
  promptWithoutAttachments: string;
  attachmentSuffix: string;
  attachmentFiles: DownloadedTelegramTurnFileLike[];
} {
  const marker = "\n\nTelegram attachments were saved locally:";
  const markerIndex = prompt.indexOf(marker);
  if (markerIndex === -1) {
    return {
      promptWithoutAttachments: prompt,
      attachmentSuffix: "",
      attachmentFiles: [],
    };
  }
  const promptWithoutAttachments = prompt.slice(0, markerIndex);
  const attachmentSuffix = prompt.slice(markerIndex);
  const attachmentFiles = attachmentSuffix
    .split("\n")
    .map((line) => line.match(/^- (.+)$/)?.[1]?.trim())
    .filter((path): path is string => !!path)
    .map((path) => ({ path, fileName: basename(path), isImage: false }));
  return { promptWithoutAttachments, attachmentSuffix, attachmentFiles };
}

function buildEditedTelegramPromptText(options: {
  existingPrompt: string;
  telegramPrefix: string;
  rawText: string;
}): { text: string; attachmentFiles: DownloadedTelegramTurnFileLike[] } {
  const { promptWithoutAttachments, attachmentSuffix, attachmentFiles } =
    splitTelegramPromptAttachmentSuffix(options.existingPrompt);
  const currentMessageMarker = "Current Telegram message:";
  const currentMessageIndex = promptWithoutAttachments.lastIndexOf(
    currentMessageMarker,
  );
  if (currentMessageIndex !== -1) {
    const prefix = promptWithoutAttachments.slice(
      0,
      currentMessageIndex + currentMessageMarker.length,
    );
    const separator = options.rawText.length > 0 ? "\n" : "";
    return {
      text: `${prefix}${separator}${options.rawText}${attachmentSuffix}`,
      attachmentFiles,
    };
  }
  const promptText =
    options.rawText.length > 0
      ? `${options.telegramPrefix} ${options.rawText}`
      : options.telegramPrefix;
  return {
    text: `${promptText}${attachmentSuffix}`,
    attachmentFiles,
  };
}

export function updateTelegramPromptTurnText(options: {
  turn: PendingTelegramTurn;
  telegramPrefix: string;
  rawText: string;
}): PendingTelegramTurn {
  let attachmentFiles: DownloadedTelegramTurnFileLike[] = [];
  const nextContent = options.turn.content.map((block, index) => {
    if (index !== 0 || block.type !== "text") return block;
    const updated = buildEditedTelegramPromptText({
      existingPrompt: block.text,
      telegramPrefix: options.telegramPrefix,
      rawText: options.rawText,
    });
    attachmentFiles = updated.attachmentFiles;
    return {
      ...block,
      text: updated.text,
    };
  });
  return {
    ...options.turn,
    content: nextContent,
    historyText: formatTelegramHistoryText(options.rawText, attachmentFiles),
    statusSummary: formatTelegramTurnStatusSummary(
      options.rawText,
      attachmentFiles,
    ),
  };
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
    historyText: formatTelegramHistoryText(options.rawText, options.files),
    statusSummary: formatTelegramTurnStatusSummary(
      options.rawText,
      options.files,
    ),
  };
}
