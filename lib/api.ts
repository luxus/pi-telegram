/**
 * Telegram API and config persistence helpers
 * Wraps bot API calls, file downloads, and local config reads and writes for the bridge runtime
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface TelegramConfig {
  botToken?: string;
  botUsername?: string;
  botId?: number;
  allowedUserId?: number;
  lastUpdateId?: number;
  voice?: TelegramVoiceConfig;
}

export interface TelegramVoiceConfig {
  enabled?: boolean;
  provider?: string;
  providerOptions?: Record<string, unknown>;
  autoTranscribeIncoming?: boolean;
  replyWithVoiceOnIncomingVoice?: boolean;
  alsoSendTextReply?: boolean;
  defaultVoiceId?: string;
  defaultLanguage?: string;
  speechStyle?: "literal" | "rewrite-light" | "rewrite-tags" | "rewrite-strong";
  speechPreparationPrompt?: string;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

interface TelegramGetFileResult {
  file_path: string;
}

export interface TelegramApiClient {
  call: <TResponse>(
    method: string,
    body: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ) => Promise<TResponse>;
  callMultipart: <TResponse>(
    method: string,
    fields: Record<string, string>,
    fileField: string,
    filePath: string,
    fileName: string,
    options?: { signal?: AbortSignal },
  ) => Promise<TResponse>;
  downloadFile: (
    fileId: string,
    suggestedName: string,
    tempDir: string,
  ) => Promise<string>;
  answerCallbackQuery: (
    callbackQueryId: string,
    text?: string,
  ) => Promise<void>;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export async function readTelegramConfig(
  configPath: string,
): Promise<TelegramConfig> {
  try {
    const content = await readFile(configPath, "utf8");
    return JSON.parse(content) as TelegramConfig;
  } catch {
    return {};
  }
}

export async function writeTelegramConfig(
  agentDir: string,
  configPath: string,
  config: TelegramConfig,
): Promise<void> {
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    configPath,
    JSON.stringify(config, null, "\t") + "\n",
    "utf8",
  );
}

export async function callTelegram<TResponse>(
  botToken: string | undefined,
  method: string,
  body: Record<string, unknown>,
  options?: { signal?: AbortSignal },
): Promise<TResponse> {
  if (!botToken) {
    throw new Error("Telegram bot token is not configured");
  }
  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: options?.signal,
    },
  );
  const data = (await response.json()) as TelegramApiResponse<TResponse>;
  if (!data.ok || data.result === undefined) {
    throw new Error(data.description || `Telegram API ${method} failed`);
  }
  return data.result;
}

export async function callTelegramMultipart<TResponse>(
  botToken: string | undefined,
  method: string,
  fields: Record<string, string>,
  fileField: string,
  filePath: string,
  fileName: string,
  options?: { signal?: AbortSignal },
): Promise<TResponse> {
  if (!botToken) {
    throw new Error("Telegram bot token is not configured");
  }
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }
  const buffer = await readFile(filePath);
  form.set(fileField, new Blob([buffer]), fileName);
  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/${method}`,
    {
      method: "POST",
      body: form,
      signal: options?.signal,
    },
  );
  const data = (await response.json()) as TelegramApiResponse<TResponse>;
  if (!data.ok || data.result === undefined) {
    throw new Error(data.description || `Telegram API ${method} failed`);
  }
  return data.result;
}

export async function downloadTelegramFile(
  botToken: string | undefined,
  fileId: string,
  suggestedName: string,
  tempDir: string,
): Promise<string> {
  if (!botToken) {
    throw new Error("Telegram bot token is not configured");
  }
  const file = await callTelegram<TelegramGetFileResult>(botToken, "getFile", {
    file_id: fileId,
  });
  await mkdir(tempDir, { recursive: true });
  const targetPath = join(
    tempDir,
    `${Date.now()}-${sanitizeFileName(suggestedName)}`,
  );
  const response = await fetch(
    `https://api.telegram.org/file/bot${botToken}/${file.file_path}`,
  );
  if (!response.ok) {
    throw new Error(`Failed to download Telegram file: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  await writeFile(targetPath, Buffer.from(arrayBuffer));
  return targetPath;
}

export async function answerTelegramCallbackQuery(
  botToken: string | undefined,
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  try {
    await callTelegram<boolean>(
      botToken,
      "answerCallbackQuery",
      text
        ? { callback_query_id: callbackQueryId, text }
        : { callback_query_id: callbackQueryId },
    );
  } catch {
    // ignore
  }
}

export function createTelegramApiClient(
  getBotToken: () => string | undefined,
): TelegramApiClient {
  return {
    call: async (method, body, options) => {
      return callTelegram(getBotToken(), method, body, options);
    },
    callMultipart: async (
      method,
      fields,
      fileField,
      filePath,
      fileName,
      options,
    ) => {
      return callTelegramMultipart(
        getBotToken(),
        method,
        fields,
        fileField,
        filePath,
        fileName,
        options,
      );
    },
    downloadFile: async (fileId, suggestedName, tempDir) => {
      return downloadTelegramFile(
        getBotToken(),
        fileId,
        suggestedName,
        tempDir,
      );
    },
    answerCallbackQuery: async (callbackQueryId, text) => {
      await answerTelegramCallbackQuery(getBotToken(), callbackQueryId, text);
    },
  };
}
