import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { homedir } from "node:os";

import type { ImageContent, Model, TextContent } from "@mariozechner/pi-ai";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { SettingsManager } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

interface TelegramConfig {
  botToken?: string;
  botUsername?: string;
  botId?: number;
  allowedUserId?: number;
  lastUpdateId?: number;
}

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

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

interface TelegramGetFileResult {
  file_path: string;
}

interface TelegramSentMessage {
  message_id: number;
}

interface DownloadedTelegramFile {
  path: string;
  fileName: string;
  isImage: boolean;
  mimeType?: string;
}

interface PendingTelegramTurn {
  chatId: number;
  replyToMessageId: number;
  queuedAttachments: QueuedAttachment[];
  content: Array<TextContent | ImageContent>;
  historyText: string;
}

type ActiveTelegramTurn = PendingTelegramTurn;

interface QueuedAttachment {
  path: string;
  fileName: string;
}

interface TelegramPreviewState {
  mode: "draft" | "message";
  draftId?: number;
  messageId?: number;
  pendingText: string;
  lastSentText: string;
  flushTimer?: ReturnType<typeof setTimeout>;
}

interface TelegramMediaGroupState {
  messages: TelegramMessage[];
  flushTimer?: ReturnType<typeof setTimeout>;
}

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
type TelegramModelScope = "all" | "scoped";

interface ScopedTelegramModel {
  model: Model<any>;
  thinkingLevel?: ThinkingLevel;
}

interface TelegramModelMenuState {
  chatId: number;
  messageId: number;
  page: number;
  scope: TelegramModelScope;
  scopedModels: ScopedTelegramModel[];
  allModels: ScopedTelegramModel[];
  note?: string;
  mode: "status" | "model" | "thinking";
}

const CONFIG_PATH = join(homedir(), ".pi", "agent", "telegram.json");
const TEMP_DIR = join(homedir(), ".pi", "agent", "tmp", "telegram");
const TELEGRAM_PREFIX = "[telegram]";
const MAX_MESSAGE_LENGTH = 4096;
const MAX_ATTACHMENTS_PER_TURN = 10;
const PREVIEW_THROTTLE_MS = 750;
const TELEGRAM_DRAFT_ID_MAX = 2_147_483_647;
const TELEGRAM_MEDIA_GROUP_DEBOUNCE_MS = 1200;
const TELEGRAM_MODEL_PAGE_SIZE = 6;
const THINKING_LEVELS: readonly ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

const SYSTEM_PROMPT_SUFFIX = `

Telegram bridge extension is active.
- Messages forwarded from Telegram are prefixed with "[telegram]".
- [telegram] messages may include local temp file paths for Telegram attachments. Read those files as needed.
- If a [telegram] user asked for a file or generated artifact, use the telegram_attach tool with the local file path so the extension can send it with your next final reply.
- Do not assume mentioning a local file path in plain text will send it to Telegram. Use telegram_attach.`;

function isTelegramPrompt(prompt: string): boolean {
  return prompt.trimStart().startsWith(TELEGRAM_PREFIX);
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function guessExtensionFromMime(
  mimeType: string | undefined,
  fallback: string,
): string {
  if (!mimeType) return fallback;
  const normalized = mimeType.toLowerCase();
  if (normalized === "image/jpeg") return ".jpg";
  if (normalized === "image/png") return ".png";
  if (normalized === "image/webp") return ".webp";
  if (normalized === "image/gif") return ".gif";
  if (normalized === "audio/ogg") return ".ogg";
  if (normalized === "audio/mpeg") return ".mp3";
  if (normalized === "audio/wav") return ".wav";
  if (normalized === "video/mp4") return ".mp4";
  if (normalized === "application/pdf") return ".pdf";
  return fallback;
}

function guessMediaType(path: string): string | undefined {
  const ext = extname(path).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return undefined;
}

function isImageMimeType(mimeType: string | undefined): boolean {
  return mimeType?.toLowerCase().startsWith("image/") ?? false;
}

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

function modelsMatch(
  a: Model<any> | undefined,
  b: Model<any> | undefined,
): boolean {
  return !!a && !!b && a.provider === b.provider && a.id === b.id;
}

function getCanonicalModelId(model: Model<any>): string {
  return `${model.provider}/${model.id}`;
}

function isThinkingLevel(value: string): value is ThinkingLevel {
  return THINKING_LEVELS.includes(value as ThinkingLevel);
}

function escapeRegex(text: string): string {
  return text.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function globMatches(text: string, pattern: string): boolean {
  let regex = "^";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "*") {
      regex += ".*";
      continue;
    }
    if (char === "?") {
      regex += ".";
      continue;
    }
    if (char === "[") {
      const end = pattern.indexOf("]", i + 1);
      if (end !== -1) {
        const content = pattern.slice(i + 1, end);
        if (content.startsWith("!")) {
          regex += `[^${content.slice(1)}]`;
        } else {
          regex += `[${content}]`;
        }
        i = end;
        continue;
      }
    }
    regex += escapeRegex(char);
  }
  regex += "$";
  return new RegExp(regex, "i").test(text);
}

function isAliasModelId(id: string): boolean {
  if (id.endsWith("-latest")) return true;
  return !/-\d{8}$/.test(id);
}

function findExactModelReferenceMatch(
  modelReference: string,
  availableModels: Model<any>[],
): Model<any> | undefined {
  const trimmedReference = modelReference.trim();
  if (!trimmedReference) return undefined;
  const normalizedReference = trimmedReference.toLowerCase();
  const canonicalMatches = availableModels.filter(
    (model) => getCanonicalModelId(model).toLowerCase() === normalizedReference,
  );
  if (canonicalMatches.length === 1) return canonicalMatches[0];
  if (canonicalMatches.length > 1) return undefined;
  const slashIndex = trimmedReference.indexOf("/");
  if (slashIndex !== -1) {
    const provider = trimmedReference.substring(0, slashIndex).trim();
    const modelId = trimmedReference.substring(slashIndex + 1).trim();
    if (provider && modelId) {
      const providerMatches = availableModels.filter(
        (model) =>
          model.provider.toLowerCase() === provider.toLowerCase() &&
          model.id.toLowerCase() === modelId.toLowerCase(),
      );
      if (providerMatches.length === 1) return providerMatches[0];
      if (providerMatches.length > 1) return undefined;
    }
  }
  const idMatches = availableModels.filter(
    (model) => model.id.toLowerCase() === normalizedReference,
  );
  return idMatches.length === 1 ? idMatches[0] : undefined;
}

function tryMatchScopedModel(
  modelPattern: string,
  availableModels: Model<any>[],
): Model<any> | undefined {
  const exactMatch = findExactModelReferenceMatch(
    modelPattern,
    availableModels,
  );
  if (exactMatch) return exactMatch;
  const matches = availableModels.filter(
    (model) =>
      model.id.toLowerCase().includes(modelPattern.toLowerCase()) ||
      model.name?.toLowerCase().includes(modelPattern.toLowerCase()),
  );
  if (matches.length === 0) return undefined;
  const aliases = matches.filter((model) => isAliasModelId(model.id));
  const datedVersions = matches.filter((model) => !isAliasModelId(model.id));
  if (aliases.length > 0) {
    aliases.sort((a, b) => b.id.localeCompare(a.id));
    return aliases[0];
  }
  datedVersions.sort((a, b) => b.id.localeCompare(a.id));
  return datedVersions[0];
}

function parseScopedModelPattern(
  pattern: string,
  availableModels: Model<any>[],
): { model: Model<any> | undefined; thinkingLevel?: ThinkingLevel } {
  const exactMatch = tryMatchScopedModel(pattern, availableModels);
  if (exactMatch) {
    return { model: exactMatch, thinkingLevel: undefined };
  }
  const lastColonIndex = pattern.lastIndexOf(":");
  if (lastColonIndex === -1) {
    return { model: undefined, thinkingLevel: undefined };
  }
  const prefix = pattern.substring(0, lastColonIndex);
  const suffix = pattern.substring(lastColonIndex + 1);
  if (isThinkingLevel(suffix)) {
    const result = parseScopedModelPattern(prefix, availableModels);
    if (result.model) {
      return { model: result.model, thinkingLevel: suffix };
    }
    return result;
  }
  return parseScopedModelPattern(prefix, availableModels);
}

function resolveScopedModelPatterns(
  patterns: string[],
  availableModels: Model<any>[],
): ScopedTelegramModel[] {
  const resolved: ScopedTelegramModel[] = [];
  const seen = new Set<string>();
  for (const pattern of patterns) {
    if (
      pattern.includes("*") ||
      pattern.includes("?") ||
      pattern.includes("[")
    ) {
      const colonIndex = pattern.lastIndexOf(":");
      let globPattern = pattern;
      let thinkingLevel: ThinkingLevel | undefined;
      if (colonIndex !== -1) {
        const suffix = pattern.substring(colonIndex + 1);
        if (isThinkingLevel(suffix)) {
          thinkingLevel = suffix;
          globPattern = pattern.substring(0, colonIndex);
        }
      }
      const matches = availableModels.filter(
        (model) =>
          globMatches(getCanonicalModelId(model), globPattern) ||
          globMatches(model.id, globPattern),
      );
      for (const model of matches) {
        const key = getCanonicalModelId(model);
        if (seen.has(key)) continue;
        seen.add(key);
        resolved.push({ model, thinkingLevel });
      }
      continue;
    }
    const matched = parseScopedModelPattern(pattern, availableModels);
    if (!matched.model) continue;
    const key = getCanonicalModelId(matched.model);
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push({
      model: matched.model,
      thinkingLevel: matched.thinkingLevel,
    });
  }
  return resolved;
}

function sortScopedModels(
  models: ScopedTelegramModel[],
  currentModel: Model<any> | undefined,
): ScopedTelegramModel[] {
  const sorted = [...models];
  sorted.sort((a, b) => {
    const aIsCurrent = modelsMatch(a.model, currentModel);
    const bIsCurrent = modelsMatch(b.model, currentModel);
    if (aIsCurrent && !bIsCurrent) return -1;
    if (!aIsCurrent && bIsCurrent) return 1;
    const providerCompare = a.model.provider.localeCompare(b.model.provider);
    if (providerCompare !== 0) return providerCompare;
    return a.model.id.localeCompare(b.model.id);
  });
  return sorted;
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

function formatScopedModelButtonText(
  entry: ScopedTelegramModel,
  currentModel: Model<any> | undefined,
): string {
  let label = `${modelsMatch(entry.model, currentModel) ? "✅ " : ""}${entry.model.id} [${entry.model.provider}]`;
  if (entry.thinkingLevel) {
    label += ` · ${entry.thinkingLevel}`;
  }
  return truncateTelegramButtonLabel(label);
}

function formatStatusButtonLabel(label: string, value: string): string {
  return truncateTelegramButtonLabel(`${label}: ${value}`, 64);
}

function getModelMenuItems(
  state: TelegramModelMenuState,
): ScopedTelegramModel[] {
  return state.scope === "scoped" && state.scopedModels.length > 0
    ? state.scopedModels
    : state.allModels;
}

function chunkParagraphs(text: string): string[] {
  if (text.length <= MAX_MESSAGE_LENGTH) return [text];

  const normalized = text.replace(/\r\n/g, "\n");
  const paragraphs = normalized.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";

  const flushCurrent = (): void => {
    if (current.trim().length > 0) chunks.push(current);
    current = "";
  };

  const splitLongBlock = (block: string): string[] => {
    if (block.length <= MAX_MESSAGE_LENGTH) return [block];
    const lines = block.split("\n");
    const lineChunks: string[] = [];
    let lineCurrent = "";
    for (const line of lines) {
      const candidate =
        lineCurrent.length === 0 ? line : `${lineCurrent}\n${line}`;
      if (candidate.length <= MAX_MESSAGE_LENGTH) {
        lineCurrent = candidate;
        continue;
      }
      if (lineCurrent.length > 0) {
        lineChunks.push(lineCurrent);
        lineCurrent = "";
      }
      if (line.length <= MAX_MESSAGE_LENGTH) {
        lineCurrent = line;
        continue;
      }
      for (let i = 0; i < line.length; i += MAX_MESSAGE_LENGTH) {
        lineChunks.push(line.slice(i, i + MAX_MESSAGE_LENGTH));
      }
    }
    if (lineCurrent.length > 0) lineChunks.push(lineCurrent);
    return lineChunks;
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length === 0) continue;
    const parts = splitLongBlock(paragraph);
    for (const part of parts) {
      const candidate = current.length === 0 ? part : `${current}\n\n${part}`;
      if (candidate.length <= MAX_MESSAGE_LENGTH) {
        current = candidate;
      } else {
        flushCurrent();
        current = part;
      }
    }
  }
  flushCurrent();
  return chunks;
}

async function readConfig(): Promise<TelegramConfig> {
  try {
    const content = await readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(content) as TelegramConfig;
    return parsed;
  } catch {
    return {};
  }
}

async function writeConfig(config: TelegramConfig): Promise<void> {
  await mkdir(join(homedir(), ".pi", "agent"), { recursive: true });
  await writeFile(
    CONFIG_PATH,
    JSON.stringify(config, null, "\t") + "\n",
    "utf8",
  );
}

export default function (pi: ExtensionAPI) {
  let config: TelegramConfig = {};
  let pollingController: AbortController | undefined;
  let pollingPromise: Promise<void> | undefined;
  let queuedTelegramTurns: PendingTelegramTurn[] = [];
  let activeTelegramTurn: ActiveTelegramTurn | undefined;
  let typingInterval: ReturnType<typeof setInterval> | undefined;
  let currentAbort: (() => void) | undefined;
  let preserveQueuedTurnsAsHistory = false;
  let setupInProgress = false;
  let previewState: TelegramPreviewState | undefined;
  let draftSupport: "unknown" | "supported" | "unsupported" = "unknown";
  let nextDraftId = 0;
  let currentTelegramModel: Model<any> | undefined;
  const mediaGroups = new Map<string, TelegramMediaGroupState>();
  const modelMenus = new Map<number, TelegramModelMenuState>();

  function allocateDraftId(): number {
    nextDraftId = nextDraftId >= TELEGRAM_DRAFT_ID_MAX ? 1 : nextDraftId + 1;
    return nextDraftId;
  }

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
    if (activeTelegramTurn || queuedTelegramTurns.length > 0) {
      const queued =
        queuedTelegramTurns.length > 0
          ? theme.fg("muted", ` +${queuedTelegramTurns.length} queued`)
          : "";
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

  async function callTelegram<TResponse>(
    method: string,
    body: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<TResponse> {
    if (!config.botToken)
      throw new Error("Telegram bot token is not configured");
    const response = await fetch(
      `https://api.telegram.org/bot${config.botToken}/${method}`,
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

  async function callTelegramMultipart<TResponse>(
    method: string,
    fields: Record<string, string>,
    fileField: string,
    filePath: string,
    fileName: string,
    options?: { signal?: AbortSignal },
  ): Promise<TResponse> {
    if (!config.botToken)
      throw new Error("Telegram bot token is not configured");
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      form.set(key, value);
    }
    const buffer = await readFile(filePath);
    form.set(fileField, new Blob([buffer]), fileName);
    const response = await fetch(
      `https://api.telegram.org/bot${config.botToken}/${method}`,
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

  async function downloadTelegramFile(
    fileId: string,
    suggestedName: string,
  ): Promise<string> {
    if (!config.botToken)
      throw new Error("Telegram bot token is not configured");
    const file = await callTelegram<TelegramGetFileResult>("getFile", {
      file_id: fileId,
    });
    await mkdir(TEMP_DIR, { recursive: true });
    const targetPath = join(
      TEMP_DIR,
      `${Date.now()}-${sanitizeFileName(suggestedName)}`,
    );
    const response = await fetch(
      `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`,
    );
    if (!response.ok)
      throw new Error(`Failed to download Telegram file: ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    await writeFile(targetPath, Buffer.from(arrayBuffer));
    return targetPath;
  }

  function startTypingLoop(ctx: ExtensionContext, chatId?: number): void {
    const targetChatId = chatId ?? activeTelegramTurn?.chatId;
    if (typingInterval || targetChatId === undefined) return;

    const sendTyping = async (): Promise<void> => {
      try {
        await callTelegram("sendChatAction", {
          chat_id: targetChatId,
          action: "typing",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateStatus(ctx, `typing failed: ${message}`);
      }
    };

    void sendTyping();
    typingInterval = setInterval(() => {
      void sendTyping();
    }, 4000);
  }

  function stopTypingLoop(): void {
    if (!typingInterval) return;
    clearInterval(typingInterval);
    typingInterval = undefined;
  }

  function isAssistantMessage(message: AgentMessage): boolean {
    return (message as unknown as { role?: string }).role === "assistant";
  }

  function getMessageText(message: AgentMessage): string {
    const value = message as unknown as Record<string, unknown>;
    const content = Array.isArray(value.content) ? value.content : [];
    return content
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

  async function clearPreview(chatId: number): Promise<void> {
    const state = previewState;
    if (!state) return;
    if (state.flushTimer) {
      clearTimeout(state.flushTimer);
      state.flushTimer = undefined;
    }
    previewState = undefined;
    if (state.mode === "draft" && state.draftId !== undefined) {
      try {
        await callTelegram("sendMessageDraft", {
          chat_id: chatId,
          draft_id: state.draftId,
          text: "",
        });
      } catch {
        // ignore
      }
    }
  }

  async function flushPreview(chatId: number): Promise<void> {
    const state = previewState;
    if (!state) return;
    state.flushTimer = undefined;
    const text = state.pendingText.trim();
    if (!text || text === state.lastSentText) return;
    const truncated =
      text.length > MAX_MESSAGE_LENGTH
        ? text.slice(0, MAX_MESSAGE_LENGTH)
        : text;

    if (draftSupport !== "unsupported") {
      const draftId = state.draftId ?? allocateDraftId();
      state.draftId = draftId;
      try {
        await callTelegram("sendMessageDraft", {
          chat_id: chatId,
          draft_id: draftId,
          text: truncated,
        });
        draftSupport = "supported";
        state.mode = "draft";
        state.lastSentText = truncated;
        return;
      } catch {
        draftSupport = "unsupported";
      }
    }

    if (state.messageId === undefined) {
      const sent = await callTelegram<TelegramSentMessage>("sendMessage", {
        chat_id: chatId,
        text: truncated,
      });
      state.messageId = sent.message_id;
      state.mode = "message";
      state.lastSentText = truncated;
      return;
    }
    await callTelegram("editMessageText", {
      chat_id: chatId,
      message_id: state.messageId,
      text: truncated,
    });
    state.mode = "message";
    state.lastSentText = truncated;
  }

  function schedulePreviewFlush(chatId: number): void {
    if (!previewState || previewState.flushTimer) return;
    previewState.flushTimer = setTimeout(() => {
      void flushPreview(chatId);
    }, PREVIEW_THROTTLE_MS);
  }

  async function finalizePreview(chatId: number): Promise<boolean> {
    const state = previewState;
    if (!state) return false;
    await flushPreview(chatId);
    const finalText = (state.pendingText.trim() || state.lastSentText).trim();
    if (!finalText) {
      await clearPreview(chatId);
      return false;
    }
    if (state.mode === "draft") {
      await callTelegram<TelegramSentMessage>("sendMessage", {
        chat_id: chatId,
        text: finalText,
      });
      await clearPreview(chatId);
      return true;
    }
    previewState = undefined;
    return state.messageId !== undefined;
  }

  async function sendTextReply(
    chatId: number,
    _replyToMessageId: number,
    text: string,
    options?: { parseMode?: "HTML" },
  ): Promise<number | undefined> {
    if (options?.parseMode) {
      const sent = await callTelegram<TelegramSentMessage>("sendMessage", {
        chat_id: chatId,
        text,
        parse_mode: options.parseMode,
      });
      return sent.message_id;
    }
    const chunks = chunkParagraphs(text);
    let lastMessageId: number | undefined;
    for (const chunk of chunks) {
      const sent = await callTelegram<TelegramSentMessage>("sendMessage", {
        chat_id: chatId,
        text: chunk,
      });
      lastMessageId = sent.message_id;
    }
    return lastMessageId;
  }

  async function sendQueuedAttachments(
    turn: ActiveTelegramTurn,
  ): Promise<void> {
    for (const attachment of turn.queuedAttachments) {
      try {
        const mediaType = guessMediaType(attachment.path);
        const method = mediaType ? "sendPhoto" : "sendDocument";
        const fieldName = mediaType ? "photo" : "document";
        await callTelegramMultipart<TelegramSentMessage>(
          method,
          {
            chat_id: String(turn.chatId),
          },
          fieldName,
          attachment.path,
          attachment.fileName,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await sendTextReply(
          turn.chatId,
          turn.replyToMessageId,
          `Failed to send attachment ${attachment.fileName}: ${message}`,
        );
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
      const content = Array.isArray(message.content) ? message.content : [];
      const text = content
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
      return { text: text || undefined, stopReason, errorMessage };
    }
    return {};
  }

  function collectTelegramFileInfos(
    messages: TelegramMessage[],
  ): TelegramFileInfo[] {
    const files: TelegramFileInfo[] = [];
    for (const message of messages) {
      if (Array.isArray(message.photo) && message.photo.length > 0) {
        const photo = [...message.photo]
          .sort((a, b) => (a.file_size ?? 0) - (b.file_size ?? 0))
          .pop();
        if (photo) {
          files.push({
            file_id: photo.file_id,
            fileName: `photo-${message.message_id}.jpg`,
            mimeType: "image/jpeg",
            isImage: true,
          });
        }
      }
      if (message.document) {
        const fileName =
          message.document.file_name ||
          `document-${message.message_id}${guessExtensionFromMime(message.document.mime_type, "")}`;
        files.push({
          file_id: message.document.file_id,
          fileName,
          mimeType: message.document.mime_type,
          isImage: isImageMimeType(message.document.mime_type),
        });
      }
      if (message.video) {
        const fileName =
          message.video.file_name ||
          `video-${message.message_id}${guessExtensionFromMime(message.video.mime_type, ".mp4")}`;
        files.push({
          file_id: message.video.file_id,
          fileName,
          mimeType: message.video.mime_type,
          isImage: false,
        });
      }
      if (message.audio) {
        const fileName =
          message.audio.file_name ||
          `audio-${message.message_id}${guessExtensionFromMime(message.audio.mime_type, ".mp3")}`;
        files.push({
          file_id: message.audio.file_id,
          fileName,
          mimeType: message.audio.mime_type,
          isImage: false,
        });
      }
      if (message.voice) {
        files.push({
          file_id: message.voice.file_id,
          fileName: `voice-${message.message_id}${guessExtensionFromMime(message.voice.mime_type, ".ogg")}`,
          mimeType: message.voice.mime_type,
          isImage: false,
        });
      }
      if (message.animation) {
        const fileName =
          message.animation.file_name ||
          `animation-${message.message_id}${guessExtensionFromMime(message.animation.mime_type, ".mp4")}`;
        files.push({
          file_id: message.animation.file_id,
          fileName,
          mimeType: message.animation.mime_type,
          isImage: false,
        });
      }
      if (message.sticker) {
        files.push({
          file_id: message.sticker.file_id,
          fileName: `sticker-${message.message_id}.webp`,
          mimeType: "image/webp",
          isImage: true,
        });
      }
    }
    return files;
  }

  async function buildTelegramFiles(
    messages: TelegramMessage[],
  ): Promise<DownloadedTelegramFile[]> {
    const downloaded: DownloadedTelegramFile[] = [];
    for (const file of collectTelegramFileInfos(messages)) {
      const path = await downloadTelegramFile(file.file_id, file.fileName);
      downloaded.push({
        path,
        fileName: file.fileName,
        isImage: file.isImage,
        mimeType: file.mimeType,
      });
    }
    return downloaded;
  }

  async function promptForConfig(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI || setupInProgress) return;
    setupInProgress = true;
    try {
      const token = await ctx.ui.input(
        "Telegram bot token",
        "123456:ABCDEF...",
      );
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
      await writeConfig(config);
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

  async function stopPolling(): Promise<void> {
    stopTypingLoop();
    pollingController?.abort();
    pollingController = undefined;
    await pollingPromise?.catch(() => undefined);
    pollingPromise = undefined;
  }

  async function answerCallbackQuery(
    callbackQueryId: string,
    text?: string,
  ): Promise<void> {
    try {
      await callTelegram<boolean>(
        "answerCallbackQuery",
        text
          ? { callback_query_id: callbackQueryId, text }
          : { callback_query_id: callbackQueryId },
      );
    } catch {
      // ignore
    }
  }

  function getCurrentTelegramModel(
    ctx: ExtensionContext,
  ): Model<any> | undefined {
    return currentTelegramModel ?? ctx.model;
  }

  async function getModelMenuState(
    chatId: number,
    ctx: ExtensionContext,
  ): Promise<TelegramModelMenuState> {
    const settingsManager = SettingsManager.create(ctx.cwd);
    await settingsManager.reload();
    ctx.modelRegistry.refresh();
    const activeModel = getCurrentTelegramModel(ctx);
    const availableModels = ctx.modelRegistry.getAvailable();
    const allModels = sortScopedModels(
      availableModels.map((model) => ({ model })),
      activeModel,
    );
    const cliScopedModels = getCliScopedModelPatterns();
    const configuredScopedModels =
      cliScopedModels ?? settingsManager.getEnabledModels() ?? [];
    const scopedModels =
      configuredScopedModels.length > 0
        ? sortScopedModels(
            resolveScopedModelPatterns(configuredScopedModels, availableModels),
            activeModel,
          )
        : [];
    let note: string | undefined;
    if (configuredScopedModels.length > 0 && scopedModels.length === 0) {
      note = cliScopedModels
        ? "No CLI scoped models matched the current auth configuration. Showing all available models."
        : "No scoped models matched the current auth configuration. Showing all available models.";
    }
    return {
      chatId,
      messageId: 0,
      page: 0,
      scope: scopedModels.length > 0 ? "scoped" : "all",
      scopedModels,
      allModels,
      note,
      mode: "status",
    };
  }

  function buildModelMenuText(
    state: TelegramModelMenuState,
    currentModel: Model<any> | undefined,
  ): string {
    const items = getModelMenuItems(state);
    const pageCount = Math.max(
      1,
      Math.ceil(items.length / TELEGRAM_MODEL_PAGE_SIZE),
    );
    const page = Math.min(state.page, pageCount - 1) + 1;
    const scopeLabel =
      state.scope === "scoped" && state.scopedModels.length > 0
        ? "scoped"
        : "all available";
    const lines = ["Choose a model"];
    if (currentModel) {
      lines.push(`Current: ${getCanonicalModelId(currentModel)}`);
    }
    lines.push(`Scope: ${scopeLabel}`);
    lines.push(`Page: ${page}/${pageCount}`);
    if (state.note) {
      lines.push("", state.note);
    }
    return lines.join("\n");
  }

  function buildThinkingMenuText(ctx: ExtensionContext): string {
    const activeModel = getCurrentTelegramModel(ctx);
    const lines = ["Choose a thinking level"];
    if (activeModel) {
      lines.push(`Model: ${getCanonicalModelId(activeModel)}`);
    }
    lines.push(`Current: ${pi.getThinkingLevel()}`);
    return lines.join("\n");
  }

  function buildModelMenuReplyMarkup(
    state: TelegramModelMenuState,
    currentModel: Model<any> | undefined,
  ): {
    inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
  } {
    const items = getModelMenuItems(state);
    const pageCount = Math.max(
      1,
      Math.ceil(items.length / TELEGRAM_MODEL_PAGE_SIZE),
    );
    state.page = Math.max(0, Math.min(state.page, pageCount - 1));
    const start = state.page * TELEGRAM_MODEL_PAGE_SIZE;
    const pageItems = items.slice(start, start + TELEGRAM_MODEL_PAGE_SIZE);
    const rows = pageItems.map((entry, index) => [
      {
        text: formatScopedModelButtonText(entry, currentModel),
        callback_data: `model:pick:${start + index}`,
      },
    ]);
    if (pageCount > 1) {
      const previousPage = state.page === 0 ? pageCount - 1 : state.page - 1;
      const nextPage = state.page === pageCount - 1 ? 0 : state.page + 1;
      rows.push([
        { text: "⬅️", callback_data: `model:page:${previousPage}` },
        { text: `${state.page + 1}/${pageCount}`, callback_data: "model:noop" },
        { text: "➡️", callback_data: `model:page:${nextPage}` },
      ]);
    }
    if (state.scopedModels.length > 0) {
      rows.push([
        {
          text: state.scope === "scoped" ? "✅ Scoped" : "Scoped",
          callback_data: "model:scope:scoped",
        },
        {
          text: state.scope === "all" ? "✅ All" : "All",
          callback_data: "model:scope:all",
        },
      ]);
    }
    return { inline_keyboard: rows };
  }

  function buildThinkingMenuReplyMarkup(ctx: ExtensionContext): {
    inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
  } {
    const currentThinkingLevel = pi.getThinkingLevel();
    return {
      inline_keyboard: THINKING_LEVELS.map((level) => [
        {
          text: level === currentThinkingLevel ? `✅ ${level}` : level,
          callback_data: `thinking:set:${level}`,
        },
      ]),
    };
  }

  function buildStatusReplyMarkup(ctx: ExtensionContext): {
    inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
  } {
    const activeModel = getCurrentTelegramModel(ctx);
    const rows: Array<Array<{ text: string; callback_data: string }>> = [];
    rows.push([
      {
        text: formatStatusButtonLabel(
          "Model",
          activeModel ? getCanonicalModelId(activeModel) : "unknown",
        ),
        callback_data: "status:model",
      },
    ]);
    if (activeModel?.reasoning) {
      rows.push([
        {
          text: formatStatusButtonLabel("Thinking", pi.getThinkingLevel()),
          callback_data: "status:thinking",
        },
      ]);
    }
    return { inline_keyboard: rows };
  }

  async function updateModelMenuMessage(
    state: TelegramModelMenuState,
    ctx: ExtensionContext,
  ): Promise<void> {
    state.mode = "model";
    const activeModel = getCurrentTelegramModel(ctx);
    await callTelegram("editMessageText", {
      chat_id: state.chatId,
      message_id: state.messageId,
      text: buildModelMenuText(state, activeModel),
      reply_markup: buildModelMenuReplyMarkup(state, activeModel),
    });
  }

  async function updateThinkingMenuMessage(
    state: TelegramModelMenuState,
    ctx: ExtensionContext,
  ): Promise<void> {
    state.mode = "thinking";
    await callTelegram("editMessageText", {
      chat_id: state.chatId,
      message_id: state.messageId,
      text: buildThinkingMenuText(ctx),
      reply_markup: buildThinkingMenuReplyMarkup(ctx),
    });
  }

  async function showStatusMessage(
    state: TelegramModelMenuState,
    ctx: ExtensionContext,
  ): Promise<void> {
    state.mode = "status";
    await callTelegram("editMessageText", {
      chat_id: state.chatId,
      message_id: state.messageId,
      text: buildStatusHtml(ctx),
      parse_mode: "HTML",
      reply_markup: buildStatusReplyMarkup(ctx),
    });
  }

  async function sendStatusMessage(
    chatId: number,
    replyToMessageId: number,
    ctx: ExtensionContext,
  ): Promise<void> {
    if (!ctx.isIdle()) {
      await sendTextReply(
        chatId,
        replyToMessageId,
        'Cannot open status while pi is busy. Send "stop" first.',
      );
      return;
    }
    const state = await getModelMenuState(chatId, ctx);
    const sent = await callTelegram<TelegramSentMessage>("sendMessage", {
      chat_id: chatId,
      text: buildStatusHtml(ctx),
      parse_mode: "HTML",
      reply_to_message_id: replyToMessageId,
      reply_markup: buildStatusReplyMarkup(ctx),
    });
    state.messageId = sent.message_id;
    state.mode = "status";
    modelMenus.set(sent.message_id, state);
  }

  async function openModelMenu(
    chatId: number,
    replyToMessageId: number,
    ctx: ExtensionContext,
  ): Promise<void> {
    if (!ctx.isIdle()) {
      await sendTextReply(
        chatId,
        replyToMessageId,
        'Cannot switch model while pi is busy. Send "stop" first.',
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
    const sent = await callTelegram<TelegramSentMessage>("sendMessage", {
      chat_id: chatId,
      text: buildModelMenuText(state, activeModel),
      reply_to_message_id: replyToMessageId,
      reply_markup: buildModelMenuReplyMarkup(state, activeModel),
    });
    state.messageId = sent.message_id;
    state.mode = "model";
    modelMenus.set(sent.message_id, state);
  }

  async function handleAuthorizedTelegramCallbackQuery(
    query: TelegramCallbackQuery,
    ctx: ExtensionContext,
  ): Promise<void> {
    const messageId = query.message?.message_id;
    if (!messageId || !query.data) {
      await answerCallbackQuery(query.id);
      return;
    }
    const state = modelMenus.get(messageId);
    if (!state) {
      await answerCallbackQuery(query.id, "Interactive message expired.");
      return;
    }
    if (query.data === "status:model") {
      await updateModelMenuMessage(state, ctx);
      await answerCallbackQuery(query.id);
      return;
    }
    if (query.data === "status:thinking") {
      const activeModel = getCurrentTelegramModel(ctx);
      if (!activeModel?.reasoning) {
        await answerCallbackQuery(
          query.id,
          "This model has no reasoning controls.",
        );
        return;
      }
      await updateThinkingMenuMessage(state, ctx);
      await answerCallbackQuery(query.id);
      return;
    }
    if (query.data.startsWith("thinking:set:")) {
      const level = query.data.slice("thinking:set:".length);
      if (!isThinkingLevel(level)) {
        await answerCallbackQuery(query.id, "Invalid thinking level.");
        return;
      }
      const activeModel = getCurrentTelegramModel(ctx);
      if (!activeModel?.reasoning) {
        await answerCallbackQuery(
          query.id,
          "This model has no reasoning controls.",
        );
        return;
      }
      pi.setThinkingLevel(level);
      await showStatusMessage(state, ctx);
      await answerCallbackQuery(query.id, `Thinking: ${pi.getThinkingLevel()}`);
      return;
    }
    if (!query.data.startsWith("model:")) {
      await answerCallbackQuery(query.id);
      return;
    }
    const [, action, value] = query.data.split(":");
    if (action === "noop") {
      await answerCallbackQuery(query.id);
      return;
    }
    if (action === "scope") {
      if (value !== "all" && value !== "scoped") {
        await answerCallbackQuery(query.id, "Unknown model scope.");
        return;
      }
      if (value === state.scope) {
        await answerCallbackQuery(query.id);
        return;
      }
      state.scope = value;
      state.page = 0;
      await updateModelMenuMessage(state, ctx);
      await answerCallbackQuery(
        query.id,
        state.scope === "scoped" ? "Scoped models" : "All models",
      );
      return;
    }
    if (action === "page") {
      const page = Number(value);
      if (!Number.isFinite(page)) {
        await answerCallbackQuery(query.id, "Invalid page.");
        return;
      }
      if (page === state.page) {
        await answerCallbackQuery(query.id);
        return;
      }
      state.page = page;
      await updateModelMenuMessage(state, ctx);
      await answerCallbackQuery(query.id);
      return;
    }
    if (action === "pick") {
      const index = Number(value);
      if (!Number.isFinite(index)) {
        await answerCallbackQuery(query.id, "Invalid model selection.");
        return;
      }
      const items = getModelMenuItems(state);
      const selection = items[index];
      if (!selection) {
        await answerCallbackQuery(
          query.id,
          "Selected model is no longer available.",
        );
        return;
      }
      if (!ctx.isIdle()) {
        await answerCallbackQuery(query.id, 'Pi is busy. Send "stop" first.');
        return;
      }
      const activeModel = getCurrentTelegramModel(ctx);
      if (modelsMatch(selection.model, activeModel)) {
        if (
          selection.thinkingLevel &&
          selection.thinkingLevel !== pi.getThinkingLevel()
        ) {
          pi.setThinkingLevel(selection.thinkingLevel);
        }
        await showStatusMessage(state, ctx);
        await answerCallbackQuery(query.id, `Model: ${selection.model.id}`);
        return;
      }
      try {
        const changed = await pi.setModel(selection.model);
        if (changed === false) {
          await answerCallbackQuery(query.id, "Model is not available.");
          return;
        }
        currentTelegramModel = selection.model;
        if (selection.thinkingLevel) {
          pi.setThinkingLevel(selection.thinkingLevel);
        }
        await showStatusMessage(state, ctx);
        await answerCallbackQuery(
          query.id,
          `Switched to ${selection.model.id}`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await answerCallbackQuery(query.id, message);
      }
      return;
    }
    await answerCallbackQuery(query.id);
  }

  function buildStatusHtml(ctx: ExtensionContext): string {
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalCacheWrite = 0;
    let totalCost = 0;
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type !== "message" || entry.message.role !== "assistant")
        continue;
      totalInput += entry.message.usage.input;
      totalOutput += entry.message.usage.output;
      totalCacheRead += entry.message.usage.cacheRead;
      totalCacheWrite += entry.message.usage.cacheWrite;
      totalCost += entry.message.usage.cost.total;
    }
    const activeModel = getCurrentTelegramModel(ctx);
    const usage = ctx.getContextUsage();
    const lines: string[] = [];
    const tokenParts: string[] = [];
    if (totalInput) tokenParts.push(`↑${formatTokens(totalInput)}`);
    if (totalOutput) tokenParts.push(`↓${formatTokens(totalOutput)}`);
    if (totalCacheRead) tokenParts.push(`R${formatTokens(totalCacheRead)}`);
    if (totalCacheWrite) tokenParts.push(`W${formatTokens(totalCacheWrite)}`);
    if (tokenParts.length > 0) {
      lines.push(
        `<b>Usage:</b> <code>${escapeHtml(tokenParts.join(" "))}</code>`,
      );
    }
    const usingSubscription = activeModel
      ? ctx.modelRegistry.isUsingOAuth(activeModel)
      : false;
    if (totalCost || usingSubscription) {
      lines.push(
        `<b>Cost:</b> <code>${escapeHtml(`$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`)}</code>`,
      );
    }
    if (usage) {
      const contextWindow =
        usage.contextWindow ?? activeModel?.contextWindow ?? 0;
      const percent =
        usage.percent !== null ? `${usage.percent.toFixed(1)}%` : "?";
      lines.push(
        `<b>Context:</b> <code>${escapeHtml(`${percent}/${formatTokens(contextWindow)}`)}</code>`,
      );
    } else {
      lines.push(`<b>Context:</b> <code>unknown</code>`);
    }
    if (lines.length === 0) {
      lines.push(`<b>Status:</b> <code>No usage data yet.</code>`);
    }
    return lines.join("\n");
  }

  function formatTelegramHistoryText(
    rawText: string,
    files: DownloadedTelegramFile[],
  ): string {
    let summary = rawText.length > 0 ? rawText : "(no text)";
    if (files.length > 0) {
      summary += `\nAttachments:`;
      for (const file of files) {
        summary += `\n- ${file.path}`;
      }
    }
    return summary;
  }

  async function createTelegramTurn(
    messages: TelegramMessage[],
    historyTurns: PendingTelegramTurn[] = [],
  ): Promise<PendingTelegramTurn> {
    const firstMessage = messages[0];
    if (!firstMessage)
      throw new Error("Missing Telegram message for turn creation");
    const rawText = messages
      .map((message) => (message.text || message.caption || "").trim())
      .filter(Boolean)
      .join("\n\n");
    const files = await buildTelegramFiles(messages);
    const content: Array<TextContent | ImageContent> = [];
    let prompt = `${TELEGRAM_PREFIX}`;

    if (historyTurns.length > 0) {
      prompt += `\n\nEarlier Telegram messages arrived after an aborted turn. Treat them as prior user messages, in order:`;
      for (const [index, turn] of historyTurns.entries()) {
        prompt += `\n\n${index + 1}. ${turn.historyText}`;
      }
      prompt += `\n\nCurrent Telegram message:`;
    }

    if (rawText.length > 0) {
      prompt += historyTurns.length > 0 ? `\n${rawText}` : ` ${rawText}`;
    }
    if (files.length > 0) {
      prompt += `\n\nTelegram attachments were saved locally:`;
      for (const file of files) {
        prompt += `\n- ${file.path}`;
      }
    }
    content.push({ type: "text", text: prompt });

    for (const file of files) {
      if (!file.isImage) continue;
      const mediaType = file.mimeType || guessMediaType(file.path);
      if (!mediaType) continue;
      const buffer = await readFile(file.path);
      content.push({
        type: "image",
        data: buffer.toString("base64"),
        mimeType: mediaType,
      });
    }

    return {
      chatId: firstMessage.chat.id,
      replyToMessageId: firstMessage.message_id,
      queuedAttachments: [],
      content,
      historyText: formatTelegramHistoryText(rawText, files),
    };
  }

  async function dispatchAuthorizedTelegramMessages(
    messages: TelegramMessage[],
    ctx: ExtensionContext,
  ): Promise<void> {
    const firstMessage = messages[0];
    if (!firstMessage) return;
    const rawText =
      messages
        .map((message) => (message.text || message.caption || "").trim())
        .find((text) => text.length > 0) || "";
    const lower = rawText.toLowerCase();
    const command = parseTelegramCommand(rawText);
    const commandName = command?.name;

    if (lower === "stop" || commandName === "stop") {
      if (currentAbort) {
        if (queuedTelegramTurns.length > 0) {
          preserveQueuedTurnsAsHistory = true;
        }
        currentAbort();
        updateStatus(ctx);
        await sendTextReply(
          firstMessage.chat.id,
          firstMessage.message_id,
          "Aborted current turn.",
        );
      } else {
        await sendTextReply(
          firstMessage.chat.id,
          firstMessage.message_id,
          "No active turn.",
        );
      }
      return;
    }

    if (commandName === "compact") {
      if (!ctx.isIdle()) {
        await sendTextReply(
          firstMessage.chat.id,
          firstMessage.message_id,
          'Cannot compact while pi is busy. Send "stop" first.',
        );
        return;
      }
      ctx.compact({
        onComplete: () => {
          void sendTextReply(
            firstMessage.chat.id,
            firstMessage.message_id,
            "Compaction completed.",
          );
        },
        onError: (error) => {
          const message =
            error instanceof Error ? error.message : String(error);
          void sendTextReply(
            firstMessage.chat.id,
            firstMessage.message_id,
            `Compaction failed: ${message}`,
          );
        },
      });
      await sendTextReply(
        firstMessage.chat.id,
        firstMessage.message_id,
        "Compaction started.",
      );
      return;
    }

    if (commandName === "status") {
      await sendStatusMessage(
        firstMessage.chat.id,
        firstMessage.message_id,
        ctx,
      );
      return;
    }

    if (commandName === "model") {
      await openModelMenu(firstMessage.chat.id, firstMessage.message_id, ctx);
      return;
    }

    if (commandName === "help" || commandName === "start") {
      await sendTextReply(
        firstMessage.chat.id,
        firstMessage.message_id,
        `Send me a message and I will forward it to pi. Commands: /status, /model, /compact, stop.`,
      );
      if (config.allowedUserId === undefined && firstMessage.from) {
        config.allowedUserId = firstMessage.from.id;
        await writeConfig(config);
        updateStatus(ctx);
      }
      return;
    }

    const historyTurns = preserveQueuedTurnsAsHistory
      ? queuedTelegramTurns.splice(0)
      : [];
    preserveQueuedTurnsAsHistory = false;
    const turn = await createTelegramTurn(messages, historyTurns);
    queuedTelegramTurns.push(turn);
    if (ctx.isIdle()) {
      startTypingLoop(ctx, turn.chatId);
      updateStatus(ctx);
      pi.sendUserMessage(turn.content);
    }
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

  async function handleUpdate(
    update: TelegramUpdate,
    ctx: ExtensionContext,
  ): Promise<void> {
    if (update.callback_query) {
      const query = update.callback_query;
      const message = query.message;
      if (
        !message ||
        message.chat.type !== "private" ||
        !query.from ||
        query.from.is_bot
      )
        return;
      if (config.allowedUserId === undefined) {
        config.allowedUserId = query.from.id;
        await writeConfig(config);
        updateStatus(ctx);
      }
      if (query.from.id !== config.allowedUserId) {
        await answerCallbackQuery(
          query.id,
          "This bot is not authorized for your account.",
        );
        return;
      }
      await handleAuthorizedTelegramCallbackQuery(query, ctx);
      return;
    }
    const message = update.message || update.edited_message;
    if (
      !message ||
      message.chat.type !== "private" ||
      !message.from ||
      message.from.is_bot
    )
      return;
    if (config.allowedUserId === undefined) {
      config.allowedUserId = message.from.id;
      await writeConfig(config);
      updateStatus(ctx);
      await sendTextReply(
        message.chat.id,
        message.message_id,
        "Telegram bridge paired with this account.",
      );
    }
    if (message.from.id !== config.allowedUserId) {
      await sendTextReply(
        message.chat.id,
        message.message_id,
        "This bot is not authorized for your account.",
      );
      return;
    }
    await handleAuthorizedTelegramMessage(message, ctx);
  }

  async function pollLoop(
    ctx: ExtensionContext,
    signal: AbortSignal,
  ): Promise<void> {
    if (!config.botToken) return;

    try {
      await callTelegram(
        "deleteWebhook",
        { drop_pending_updates: false },
        { signal },
      );
    } catch {
      // ignore
    }

    if (config.lastUpdateId === undefined) {
      try {
        const updates = await callTelegram<TelegramUpdate[]>(
          "getUpdates",
          { offset: -1, limit: 1, timeout: 0 },
          { signal },
        );
        const last = updates.at(-1);
        if (last) {
          config.lastUpdateId = last.update_id;
          await writeConfig(config);
        }
      } catch {
        // ignore
      }
    }

    while (!signal.aborted) {
      try {
        const updates = await callTelegram<TelegramUpdate[]>(
          "getUpdates",
          {
            offset:
              config.lastUpdateId !== undefined
                ? config.lastUpdateId + 1
                : undefined,
            limit: 10,
            timeout: 30,
            allowed_updates: ["message", "edited_message", "callback_query"],
          },
          { signal },
        );
        for (const update of updates) {
          config.lastUpdateId = update.update_id;
          await writeConfig(config);
          await handleUpdate(update, ctx);
        }
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        const message = error instanceof Error ? error.message : String(error);
        updateStatus(ctx, message);
        await new Promise((resolve) => setTimeout(resolve, 3000));
        updateStatus(ctx);
      }
    }
  }

  async function startPolling(ctx: ExtensionContext): Promise<void> {
    if (!config.botToken || pollingPromise) return;
    pollingController = new AbortController();
    pollingPromise = pollLoop(ctx, pollingController.signal).finally(() => {
      pollingPromise = undefined;
      pollingController = undefined;
      updateStatus(ctx);
    });
    updateStatus(ctx);
  }

  pi.registerTool({
    name: "telegram_attach",
    label: "Telegram Attach",
    description:
      "Queue one or more local files to be sent with the next Telegram reply.",
    promptSnippet: "Queue local files to be sent with the next Telegram reply.",
    promptGuidelines: [
      "When handling a [telegram] message and the user asked for a file or generated artifact, call telegram_attach with the local path instead of only mentioning the path in text.",
    ],
    parameters: Type.Object({
      paths: Type.Array(
        Type.String({ description: "Local file path to attach" }),
        { minItems: 1, maxItems: MAX_ATTACHMENTS_PER_TURN },
      ),
    }),
    async execute(_toolCallId, params) {
      if (!activeTelegramTurn) {
        throw new Error(
          "telegram_attach can only be used while replying to an active Telegram turn",
        );
      }
      const added: string[] = [];
      for (const inputPath of params.paths) {
        const stats = await stat(inputPath);
        if (!stats.isFile()) {
          throw new Error(`Not a file: ${inputPath}`);
        }
        if (
          activeTelegramTurn.queuedAttachments.length >=
          MAX_ATTACHMENTS_PER_TURN
        ) {
          throw new Error(
            `Attachment limit reached (${MAX_ATTACHMENTS_PER_TURN})`,
          );
        }
        activeTelegramTurn.queuedAttachments.push({
          path: inputPath,
          fileName: basename(inputPath),
        });
        added.push(inputPath);
      }
      return {
        content: [
          {
            type: "text",
            text: `Queued ${added.length} Telegram attachment(s).`,
          },
        ],
        details: { paths: added },
      };
    },
  });

  pi.registerCommand("telegram-setup", {
    description: "Configure Telegram bot token",
    handler: async (_args, ctx) => {
      await promptForConfig(ctx);
    },
  });

  pi.registerCommand("telegram-status", {
    description: "Show Telegram bridge status",
    handler: async (_args, ctx) => {
      const status = [
        `bot: ${config.botUsername ? `@${config.botUsername}` : "not configured"}`,
        `allowed user: ${config.allowedUserId ?? "not paired"}`,
        `polling: ${pollingPromise ? "running" : "stopped"}`,
        `active telegram turn: ${activeTelegramTurn ? "yes" : "no"}`,
        `queued telegram turns: ${queuedTelegramTurns.length}`,
      ];
      ctx.ui.notify(status.join(" | "), "info");
    },
  });

  pi.registerCommand("telegram-connect", {
    description: "Start the Telegram bridge in this pi session",
    handler: async (_args, ctx) => {
      config = await readConfig();
      if (!config.botToken) {
        await promptForConfig(ctx);
        return;
      }
      await startPolling(ctx);
      updateStatus(ctx);
    },
  });

  pi.registerCommand("telegram-disconnect", {
    description: "Stop the Telegram bridge in this pi session",
    handler: async (_args, ctx) => {
      await stopPolling();
      updateStatus(ctx);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    config = await readConfig();
    currentTelegramModel = ctx.model;
    await mkdir(TEMP_DIR, { recursive: true });
    updateStatus(ctx);
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    queuedTelegramTurns = [];
    currentTelegramModel = undefined;
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
  });

  pi.on("before_agent_start", async (event) => {
    const suffix = isTelegramPrompt(event.prompt)
      ? `${SYSTEM_PROMPT_SUFFIX}\n- The current user message came from Telegram.`
      : SYSTEM_PROMPT_SUFFIX;
    return {
      systemPrompt: event.systemPrompt + suffix,
    };
  });

  pi.on("model_select", async (event) => {
    currentTelegramModel = event.model;
  });

  pi.on("agent_start", async (_event, ctx) => {
    currentAbort = () => ctx.abort();
    if (!activeTelegramTurn && queuedTelegramTurns.length > 0) {
      const nextTurn = queuedTelegramTurns.shift();
      if (nextTurn) {
        activeTelegramTurn = { ...nextTurn };
        previewState = {
          mode: draftSupport === "unsupported" ? "message" : "draft",
          pendingText: "",
          lastSentText: "",
        };
        startTypingLoop(ctx);
      }
    }
    updateStatus(ctx);
  });

  pi.on("message_start", async (event, _ctx) => {
    if (!activeTelegramTurn || !isAssistantMessage(event.message)) return;
    if (
      previewState &&
      (previewState.pendingText.trim().length > 0 ||
        previewState.lastSentText.trim().length > 0)
    ) {
      await finalizePreview(activeTelegramTurn.chatId);
    }
    previewState = {
      mode: draftSupport === "unsupported" ? "message" : "draft",
      pendingText: "",
      lastSentText: "",
    };
  });

  pi.on("message_update", async (event, _ctx) => {
    if (!activeTelegramTurn || !isAssistantMessage(event.message)) return;
    if (!previewState) {
      previewState = {
        mode: draftSupport === "unsupported" ? "message" : "draft",
        pendingText: "",
        lastSentText: "",
      };
    }
    previewState.pendingText = getMessageText(event.message);
    schedulePreviewFlush(activeTelegramTurn.chatId);
  });

  pi.on("agent_end", async (event, ctx) => {
    const turn = activeTelegramTurn;
    currentAbort = undefined;
    stopTypingLoop();
    activeTelegramTurn = undefined;
    updateStatus(ctx);
    if (!turn) return;

    const assistant = extractAssistantText(event.messages);
    if (assistant.stopReason === "aborted") {
      await clearPreview(turn.chatId);
      return;
    }
    if (assistant.stopReason === "error") {
      await clearPreview(turn.chatId);
      await sendTextReply(
        turn.chatId,
        turn.replyToMessageId,
        assistant.errorMessage ||
          "Telegram bridge: pi failed while processing the request.",
      );
      return;
    }

    const finalText = assistant.text;
    if (previewState) {
      previewState.pendingText = finalText ?? previewState.pendingText;
    }

    if (finalText && finalText.length <= MAX_MESSAGE_LENGTH) {
      const finalized = await finalizePreview(turn.chatId);
      if (!finalized && turn.queuedAttachments.length > 0 && !finalText) {
        await sendTextReply(
          turn.chatId,
          turn.replyToMessageId,
          "Attached requested file(s).",
        );
      }
    } else {
      await clearPreview(turn.chatId);
      if (finalText) {
        await sendTextReply(turn.chatId, turn.replyToMessageId, finalText);
      } else if (turn.queuedAttachments.length > 0) {
        await sendTextReply(
          turn.chatId,
          turn.replyToMessageId,
          "Attached requested file(s).",
        );
      }
    }

    await sendQueuedAttachments(turn);

    if (queuedTelegramTurns.length > 0 && !preserveQueuedTurnsAsHistory) {
      const nextTurn = queuedTelegramTurns[0];
      startTypingLoop(ctx, nextTurn.chatId);
      updateStatus(ctx);
      pi.sendUserMessage(nextTurn.content);
    }
  });
}
