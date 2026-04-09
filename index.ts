import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { homedir } from "node:os";

import type { ImageContent, Model, TextContent } from "@mariozechner/pi-ai";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { SettingsManager } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

// --- Telegram API Types ---

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
}

interface QueuedAttachment {
  path: string;
  fileName: string;
}

interface PendingTelegramTurn {
  chatId: number;
  replyToMessageId: number;
  sourceMessageIds: number[];
  queueOrder: number;
  priorityReactionOrder?: number;
  queuedAttachments: QueuedAttachment[];
  content: Array<TextContent | ImageContent>;
  historyText: string;
  statusSummary: string;
}

type ActiveTelegramTurn = PendingTelegramTurn;

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

interface TelegramUsageStats {
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  totalCost: number;
}

type TelegramReplyMarkup = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

const AGENT_DIR = join(homedir(), ".pi", "agent");
const CONFIG_PATH = join(AGENT_DIR, "telegram.json");
const TEMP_DIR = join(AGENT_DIR, "tmp", "telegram");
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
const MODEL_MENU_TITLE = "<b>Choose a model:</b>";

// --- Generic Utilities ---

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
  const normalized = path.toLowerCase();
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (normalized.endsWith(".png")) return "image/png";
  if (normalized.endsWith(".webp")) return "image/webp";
  if (normalized.endsWith(".gif")) return "image/gif";
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
        regex += content.startsWith("!")
          ? `[^${content.slice(1)}]`
          : `[${content}]`;
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

function truncateTelegramQueueSummary(
  text: string,
  maxWords = 4,
  maxLength = 32,
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

function formatTelegramTurnStatusSummary(
  rawText: string,
  files: DownloadedTelegramFile[],
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

function formatQueuedTelegramTurnsStatus(turns: PendingTelegramTurn[]): string {
  if (turns.length === 0) return "";
  const previewCount = 4;
  const summaries = turns
    .slice(0, previewCount)
    .map((turn) => turn.statusSummary)
    .filter(Boolean);
  if (summaries.length === 0) return ` +${turns.length}`;
  const suffix = turns.length > summaries.length ? ", …" : "";
  return ` +${turns.length}: [${summaries.join(", ")}${suffix}]`;
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

// --- Escaping ---

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// --- Plain Preview Rendering ---

function splitPlainMarkdownLine(line: string, maxLength = 1500): string[] {
  if (line.length <= maxLength) return [line];
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [line];
  const parts: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }
    if (current.length > 0) {
      parts.push(current);
      current = "";
    }
    if (word.length <= maxLength) {
      current = word;
      continue;
    }
    for (let i = 0; i < word.length; i += maxLength) {
      parts.push(word.slice(i, i + maxLength));
    }
  }
  if (current.length > 0) {
    parts.push(current);
  }
  return parts.length > 0 ? parts : [line];
}

function stripInlineMarkdownToPlainText(text: string): string {
  let result = text;
  result = result.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, "$1");
  result = result.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1");
  result = result.replace(/<((?:https?:\/\/|mailto:)[^>]+)>/g, "$1");
  result = result.replace(/`([^`\n]+)`/g, "$1");
  result = result.replace(/(\*\*\*|___)(.+?)\1/g, "$2");
  result = result.replace(/(\*\*|__)(.+?)\1/g, "$2");
  result = result.replace(/(\*|_)(.+?)\1/g, "$2");
  result = result.replace(/~~(.+?)~~/g, "$1");
  result = result.replace(/\\([\\`*_{}\[\]()#+\-.!>~|])/g, "$1");
  return result;
}

function isMarkdownTableSeparator(line: string): boolean {
  return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line);
}

function isFencedCodeStart(line: string): boolean {
  return /^\s*```/.test(line);
}

function isIndentedCodeLine(line: string): boolean {
  return /^(?:\t| {4,})/.test(line);
}

function renderMarkdownPreviewText(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) return "";
  const output: string[] = [];
  const lines = normalized.split("\n");
  let inFence = false;
  for (const rawLine of lines) {
    const line = rawLine ?? "";
    if (isFencedCodeStart(line)) {
      inFence = !inFence;
      continue;
    }
    if (line.trim().length === 0) {
      if (output.at(-1) !== "") output.push("");
      continue;
    }
    if (inFence) {
      output.push(line);
      continue;
    }
    if (isMarkdownTableSeparator(line)) {
      continue;
    }
    const heading = line.match(/^\s*#{1,6}\s+(.+)$/);
    if (heading) {
      output.push(stripInlineMarkdownToPlainText(heading[1] ?? ""));
      continue;
    }
    const task = line.match(/^(\s*)([-*+]|\d+\.)\s+\[([ xX])\]\s+(.+)$/);
    if (task) {
      const indent = " ".repeat((task[1] ?? "").length);
      const marker = (task[3] ?? " ").toLowerCase() === "x" ? "[x]" : "[ ]";
      output.push(
        `${indent}${marker} ${stripInlineMarkdownToPlainText(task[4] ?? "")}`,
      );
      continue;
    }
    const bullet = line.match(/^(\s*)[-*+]\s+(.+)$/);
    if (bullet) {
      output.push(
        `${" ".repeat((bullet[1] ?? "").length)}• ${stripInlineMarkdownToPlainText(bullet[2] ?? "")}`,
      );
      continue;
    }
    const numbered = line.match(/^(\s*\d+\.)\s+(.+)$/);
    if (numbered) {
      output.push(
        `${numbered[1]} ${stripInlineMarkdownToPlainText(numbered[2] ?? "")}`,
      );
      continue;
    }
    const quote = line.match(/^\s*>\s?(.+)$/);
    if (quote) {
      output.push(`> ${stripInlineMarkdownToPlainText(quote[1] ?? "")}`);
      continue;
    }
    if (/^\s*([-*_]\s*){3,}\s*$/.test(line)) {
      output.push("────────");
      continue;
    }
    output.push(stripInlineMarkdownToPlainText(line));
  }
  return output.join("\n");
}

// --- Rich Markdown Rendering ---

function renderInlineMarkdown(text: string): string {
  const tokens: string[] = [];
  const makeToken = (html: string): string => {
    const token = `\uE000${tokens.length}\uE001`;
    tokens.push(html);
    return token;
  };
  let result = text;
  result = result.replace(
    /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g,
    (_match, alt: string, url: string) => {
      const label = alt.trim().length > 0 ? alt : url;
      return makeToken(`<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`);
    },
  );
  result = result.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_match, label: string, url: string) => {
      return makeToken(`<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`);
    },
  );
  result = result.replace(
    /<((?:https?:\/\/|mailto:)[^>]+)>/g,
    (_match, url: string) => {
      return makeToken(`<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`);
    },
  );
  result = result.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    return makeToken(`<code>${escapeHtml(code)}</code>`);
  });
  result = escapeHtml(result);
  result = result.replace(/(\*\*\*|___)(.+?)\1/g, "<b><i>$2</i></b>");
  result = result.replace(/~~(.+?)~~/g, "<s>$1</s>");
  result = result.replace(/(\*\*|__)(.+?)\1/g, "<b>$2</b>");
  result = result.replace(/(\*|_)(.+?)\1/g, "<i>$2</i>");
  result = result.replace(
    /(^|[\s>(])(\[(?: |x|X)\])(?=($|[\s<).,:;!?]))/g,
    (_match, prefix: string, checkbox: string) => {
      const normalized = checkbox.toLowerCase() === "[x]" ? "[x]" : "[ ]";
      return `${prefix}<code>${normalized}</code>`;
    },
  );
  result = result.replace(/\\([\\`*_{}\[\]()#+\-.!>~|])/g, "$1");
  return result.replace(
    /\uE000(\d+)\uE001/g,
    (_match, index: string) => tokens[Number(index)] ?? "",
  );
}

function buildListIndent(level: number): string {
  return "\u00A0".repeat(Math.max(0, Math.min(12, level * 2)));
}

function parseMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed
    .split("|")
    .map((cell) => stripInlineMarkdownToPlainText(cell.trim()));
}

function renderMarkdownTextLines(block: string): string[] {
  const rendered: string[] = [];
  const lines = block.split("\n");
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const pieces = splitPlainMarkdownLine(line);
    for (const piece of pieces) {
      const heading = piece.match(/^(\s*)#{1,6}\s+(.+)$/);
      if (heading) {
        rendered.push(
          `${buildListIndent(Math.floor((heading[1] ?? "").length / 2))}<b>${renderInlineMarkdown(heading[2] ?? "")}</b>`,
        );
        continue;
      }
      const task = piece.match(/^(\s*)([-*+]|\d+\.)\s+\[([ xX])\]\s+(.+)$/);
      if (task) {
        const indent = buildListIndent(Math.floor((task[1] ?? "").length / 2));
        const marker = (task[3] ?? " ").toLowerCase() === "x" ? "[x]" : "[ ]";
        rendered.push(
          `${indent}<code>${marker}</code> ${renderInlineMarkdown(task[4] ?? "")}`,
        );
        continue;
      }
      const bullet = piece.match(/^(\s*)[-*+]\s+(.+)$/);
      if (bullet) {
        const indent = buildListIndent(
          Math.floor((bullet[1] ?? "").length / 2),
        );
        rendered.push(`${indent}• ${renderInlineMarkdown(bullet[2] ?? "")}`);
        continue;
      }
      const numbered = piece.match(/^(\s*)(\d+)\.\s+(.+)$/);
      if (numbered) {
        const indent = buildListIndent(
          Math.floor((numbered[1] ?? "").length / 2),
        );
        rendered.push(
          `${indent}${numbered[2]}. ${renderInlineMarkdown(numbered[3] ?? "")}`,
        );
        continue;
      }
      const quote = piece.match(/^>\s?(.+)$/);
      if (quote) {
        rendered.push(
          `<blockquote>${renderInlineMarkdown(quote[1] ?? "")}</blockquote>`,
        );
        continue;
      }
      const trimmed = piece.trim();
      if (/^([-*_]\s*){3,}$/.test(trimmed)) {
        rendered.push("────────────────");
        continue;
      }
      rendered.push(renderInlineMarkdown(piece));
    }
  }
  return rendered;
}

function renderMarkdownCodeBlock(code: string, language?: string): string[] {
  const open = language
    ? `<pre><code class="language-${escapeHtml(language)}">`
    : "<pre><code>";
  const close = "</code></pre>";
  const maxContentLength = MAX_MESSAGE_LENGTH - open.length - close.length;
  const chunks: string[] = [];
  let current = "";
  const pushCurrent = (): void => {
    if (current.length === 0) return;
    chunks.push(`${open}${current}${close}`);
    current = "";
  };
  const appendEscapedLine = (escapedLine: string): void => {
    if (escapedLine.length <= maxContentLength) {
      const candidate =
        current.length === 0 ? escapedLine : `${current}\n${escapedLine}`;
      if (candidate.length <= maxContentLength) {
        current = candidate;
        return;
      }
      pushCurrent();
      current = escapedLine;
      return;
    }
    pushCurrent();
    for (let i = 0; i < escapedLine.length; i += maxContentLength) {
      chunks.push(
        `${open}${escapedLine.slice(i, i + maxContentLength)}${close}`,
      );
    }
  };
  for (const line of code.split("\n")) {
    appendEscapedLine(escapeHtml(line));
  }
  pushCurrent();
  return chunks.length > 0 ? chunks : [`${open}${close}`];
}

function renderMarkdownTableBlock(lines: string[]): string[] {
  const rows = lines.map(parseMarkdownTableRow);
  const columnCount = Math.max(...rows.map((row) => row.length), 0);
  const normalizedRows = rows.map((row) => {
    const next = [...row];
    while (next.length < columnCount) {
      next.push("");
    }
    return next;
  });
  const widths = Array.from({ length: columnCount }, (_, columnIndex) => {
    return Math.max(
      3,
      ...normalizedRows.map((row) => (row[columnIndex] ?? "").length),
    );
  });
  const formatRow = (row: string[]): string => {
    return `| ${row.map((cell, columnIndex) => (cell ?? "").padEnd(widths[columnIndex] ?? 3)).join(" | ")} |`;
  };
  const separator = `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`;
  const [header, ...body] = normalizedRows;
  const tableLines = [
    formatRow(header ?? []),
    separator,
    ...body.map(formatRow),
  ];
  return renderMarkdownCodeBlock(tableLines.join("\n"), "markdown");
}

function renderMarkdownQuoteBlock(lines: string[]): string[] {
  const inner = lines.map((line) => line.replace(/^\s*>\s?/, "")).join("\n");
  const rendered = renderMarkdownTextLines(inner).join("\n");
  return rendered.length > 0 ? [`<blockquote>${rendered}</blockquote>`] : [];
}

function renderMarkdownToTelegramHtmlChunks(markdown: string): string[] {
  const normalized = markdown.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) return [];
  const renderedBlocks: string[] = [];
  const lines = normalized.split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const nextLine = lines[index + 1] ?? "";
    if (isFencedCodeStart(line)) {
      const language = line.trim().slice(3).trim() || undefined;
      index += 1;
      const codeLines: string[] = [];
      while (index < lines.length && !isFencedCodeStart(lines[index] ?? "")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      renderedBlocks.push(
        ...renderMarkdownCodeBlock(codeLines.join("\n"), language),
      );
      while (index < lines.length && (lines[index] ?? "").trim().length === 0) {
        index += 1;
      }
      continue;
    }
    if (line.trim().length === 0) {
      index += 1;
      continue;
    }
    if (line.includes("|") && isMarkdownTableSeparator(nextLine)) {
      const tableLines: string[] = [line];
      index += 2;
      while (index < lines.length) {
        const tableLine = lines[index] ?? "";
        if (tableLine.trim().length === 0 || !tableLine.includes("|")) {
          break;
        }
        tableLines.push(tableLine);
        index += 1;
      }
      renderedBlocks.push(...renderMarkdownTableBlock(tableLines));
      continue;
    }
    if (isIndentedCodeLine(line)) {
      const codeLines: string[] = [];
      while (index < lines.length && isIndentedCodeLine(lines[index] ?? "")) {
        const rawLine = lines[index] ?? "";
        codeLines.push(
          rawLine.startsWith("\t") ? rawLine.slice(1) : rawLine.slice(4),
        );
        index += 1;
      }
      renderedBlocks.push(...renderMarkdownCodeBlock(codeLines.join("\n")));
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index] ?? "")) {
        quoteLines.push(lines[index] ?? "");
        index += 1;
      }
      renderedBlocks.push(...renderMarkdownQuoteBlock(quoteLines));
      continue;
    }
    const textLines: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? "";
      const following = lines[index + 1] ?? "";
      if (current.trim().length === 0) break;
      if (
        isFencedCodeStart(current) ||
        isIndentedCodeLine(current) ||
        /^\s*>/.test(current)
      )
        break;
      if (current.includes("|") && isMarkdownTableSeparator(following)) break;
      textLines.push(current);
      index += 1;
    }
    const renderedTextBlock = renderMarkdownTextLines(
      textLines.join("\n"),
    ).join("\n");
    if (renderedTextBlock.length > 0) {
      renderedBlocks.push(renderedTextBlock);
    }
  }
  const chunks: string[] = [];
  let current = "";
  for (const block of renderedBlocks) {
    const candidate = current.length === 0 ? block : `${current}\n\n${block}`;
    if (candidate.length <= MAX_MESSAGE_LENGTH) {
      current = candidate;
      continue;
    }
    if (current.length > 0) {
      chunks.push(current);
      current = "";
    }
    if (block.length <= MAX_MESSAGE_LENGTH) {
      current = block;
      continue;
    }
    for (let i = 0; i < block.length; i += MAX_MESSAGE_LENGTH) {
      chunks.push(block.slice(i, i + MAX_MESSAGE_LENGTH));
    }
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

// --- Unified Telegram Rendering ---

type TelegramRenderMode = "plain" | "markdown" | "html";

interface TelegramRenderedChunk {
  text: string;
  parseMode?: "HTML";
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
    if (lineCurrent.length > 0) {
      lineChunks.push(lineCurrent);
    }
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

function renderTelegramMessage(
  text: string,
  options?: { mode?: TelegramRenderMode },
): TelegramRenderedChunk[] {
  const mode = options?.mode ?? "plain";
  if (mode === "plain") {
    return chunkParagraphs(text).map((chunk) => ({ text: chunk }));
  }
  if (mode === "html") {
    return [{ text, parseMode: "HTML" }];
  }
  return renderMarkdownToTelegramHtmlChunks(text).map((chunk) => ({
    text: chunk,
    parseMode: "HTML",
  }));
}

// --- Persistence ---

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
  await mkdir(AGENT_DIR, { recursive: true });
  await writeFile(
    CONFIG_PATH,
    JSON.stringify(config, null, "\t") + "\n",
    "utf8",
  );
}

// --- Extension Runtime ---

export default function (pi: ExtensionAPI) {
  let config: TelegramConfig = {};
  let pollingController: AbortController | undefined;
  let pollingPromise: Promise<void> | undefined;
  let queuedTelegramTurns: PendingTelegramTurn[] = [];
  let nextQueuedTelegramTurnOrder = 0;
  let nextPriorityReactionOrder = 0;
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

  // --- Runtime State ---

  function allocateDraftId(): number {
    nextDraftId = nextDraftId >= TELEGRAM_DRAFT_ID_MAX ? 1 : nextDraftId + 1;
    return nextDraftId;
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
    if (activeTelegramTurn || queuedTelegramTurns.length > 0) {
      const queued = theme.fg(
        "muted",
        formatQueuedTelegramTurnsStatus(queuedTelegramTurns),
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

  // --- Message Delivery & Preview ---

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

  async function sendRenderedChunks(
    chatId: number,
    chunks: TelegramRenderedChunk[],
    options?: { replyMarkup?: TelegramReplyMarkup },
  ): Promise<number | undefined> {
    let lastMessageId: number | undefined;
    for (const [index, chunk] of chunks.entries()) {
      const sent = await callTelegram<TelegramSentMessage>("sendMessage", {
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

  async function editRenderedMessage(
    chatId: number,
    messageId: number,
    chunks: TelegramRenderedChunk[],
    options?: { replyMarkup?: TelegramReplyMarkup },
  ): Promise<number | undefined> {
    if (chunks.length === 0) return messageId;
    const [firstChunk, ...remainingChunks] = chunks;
    await callTelegram("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: firstChunk.text,
      parse_mode: firstChunk.parseMode,
      reply_markup:
        remainingChunks.length === 0 ? options?.replyMarkup : undefined,
    });
    if (remainingChunks.length > 0) {
      return sendRenderedChunks(chatId, remainingChunks, options);
    }
    return messageId;
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
    const rawText = state.pendingText.trim();
    const previewText = renderMarkdownPreviewText(rawText).trim();
    if (!previewText || previewText === state.lastSentText) return;
    const truncated =
      previewText.length > MAX_MESSAGE_LENGTH
        ? previewText.slice(0, MAX_MESSAGE_LENGTH)
        : previewText;

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

  async function finalizeMarkdownPreview(
    chatId: number,
    markdown: string,
  ): Promise<boolean> {
    const state = previewState;
    if (!state) return false;
    await flushPreview(chatId);
    const chunks = renderTelegramMessage(markdown, { mode: "markdown" });
    if (chunks.length === 0) {
      await clearPreview(chatId);
      return false;
    }
    if (state.mode === "draft") {
      await sendRenderedChunks(chatId, chunks);
      await clearPreview(chatId);
      return true;
    }
    if (state.messageId !== undefined) {
      await editRenderedMessage(chatId, state.messageId, chunks);
      previewState = undefined;
      return true;
    }
    return false;
  }

  async function sendTextReply(
    chatId: number,
    _replyToMessageId: number,
    text: string,
    options?: { parseMode?: "HTML" },
  ): Promise<number | undefined> {
    const chunks = renderTelegramMessage(text, {
      mode: options?.parseMode === "HTML" ? "html" : "plain",
    });
    return sendRenderedChunks(chatId, chunks);
  }

  async function sendMarkdownReply(
    chatId: number,
    replyToMessageId: number,
    markdown: string,
  ): Promise<number | undefined> {
    const chunks = renderTelegramMessage(markdown, { mode: "markdown" });
    if (chunks.length === 0) {
      return sendTextReply(chatId, replyToMessageId, markdown);
    }
    return sendRenderedChunks(chatId, chunks);
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
    await callTelegram<boolean>("setMyCommands", { commands });
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
  ): TelegramReplyMarkup {
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

  function buildThinkingMenuReplyMarkup(
    ctx: ExtensionContext,
  ): TelegramReplyMarkup {
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

  // --- Interactive Menu Actions ---

  async function updateModelMenuMessage(
    state: TelegramModelMenuState,
    ctx: ExtensionContext,
  ): Promise<void> {
    state.mode = "model";
    const activeModel = getCurrentTelegramModel(ctx);
    await editInteractiveMessage(
      state.chatId,
      state.messageId,
      MODEL_MENU_TITLE,
      "html",
      buildModelMenuReplyMarkup(state, activeModel),
    );
  }

  async function updateThinkingMenuMessage(
    state: TelegramModelMenuState,
    ctx: ExtensionContext,
  ): Promise<void> {
    state.mode = "thinking";
    await editInteractiveMessage(
      state.chatId,
      state.messageId,
      buildThinkingMenuText(ctx),
      "plain",
      buildThinkingMenuReplyMarkup(ctx),
    );
  }

  async function editInteractiveMessage(
    chatId: number,
    messageId: number,
    text: string,
    mode: TelegramRenderMode,
    replyMarkup: TelegramReplyMarkup,
  ): Promise<void> {
    await editRenderedMessage(
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
    return sendRenderedChunks(chatId, renderTelegramMessage(text, { mode }), {
      replyMarkup,
    });
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
    state.mode = "status";
    await editInteractiveMessage(
      state.chatId,
      state.messageId,
      buildStatusHtml(ctx),
      "html",
      buildStatusReplyMarkup(ctx),
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
    const messageId = await sendInteractiveMessage(
      chatId,
      buildStatusHtml(ctx),
      "html",
      buildStatusReplyMarkup(ctx),
    );
    if (messageId === undefined) return;
    state.messageId = messageId;
    state.mode = "status";
    modelMenus.set(messageId, state);
  }

  async function openModelMenu(
    chatId: number,
    replyToMessageId: number,
    ctx: ExtensionContext,
  ): Promise<void> {
    const isIdle = await ensureIdleOrNotify(
      ctx,
      chatId,
      replyToMessageId,
      "Cannot switch model while pi is busy. Send /stop first.",
    );
    if (!isIdle) return;
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
    const messageId = await sendInteractiveMessage(
      chatId,
      MODEL_MENU_TITLE,
      "html",
      buildModelMenuReplyMarkup(state, activeModel),
    );
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
    if (query.data === "status:model") {
      await updateModelMenuMessage(state, ctx);
      await answerCallbackQuery(query.id);
      return true;
    }
    if (query.data !== "status:thinking") return false;
    const activeModel = getCurrentTelegramModel(ctx);
    if (!activeModel?.reasoning) {
      await answerCallbackQuery(
        query.id,
        "This model has no reasoning controls.",
      );
      return true;
    }
    await updateThinkingMenuMessage(state, ctx);
    await answerCallbackQuery(query.id);
    return true;
  }

  async function handleThinkingCallbackAction(
    query: TelegramCallbackQuery,
    state: TelegramModelMenuState,
    ctx: ExtensionContext,
  ): Promise<boolean> {
    if (!query.data?.startsWith("thinking:set:")) return false;
    const level = query.data.slice("thinking:set:".length);
    if (!isThinkingLevel(level)) {
      await answerCallbackQuery(query.id, "Invalid thinking level.");
      return true;
    }
    const activeModel = getCurrentTelegramModel(ctx);
    if (!activeModel?.reasoning) {
      await answerCallbackQuery(
        query.id,
        "This model has no reasoning controls.",
      );
      return true;
    }
    pi.setThinkingLevel(level);
    await showStatusMessage(state, ctx);
    await answerCallbackQuery(query.id, `Thinking: ${pi.getThinkingLevel()}`);
    return true;
  }

  async function handleModelCallbackAction(
    query: TelegramCallbackQuery,
    state: TelegramModelMenuState,
    ctx: ExtensionContext,
  ): Promise<boolean> {
    if (!query.data?.startsWith("model:")) return false;
    const [, action, value] = query.data.split(":");
    if (action === "noop") {
      await answerCallbackQuery(query.id);
      return true;
    }
    if (action === "scope") {
      if (value !== "all" && value !== "scoped") {
        await answerCallbackQuery(query.id, "Unknown model scope.");
        return true;
      }
      if (value === state.scope) {
        await answerCallbackQuery(query.id);
        return true;
      }
      state.scope = value;
      state.page = 0;
      await updateModelMenuMessage(state, ctx);
      await answerCallbackQuery(
        query.id,
        state.scope === "scoped" ? "Scoped models" : "All models",
      );
      return true;
    }
    if (action === "page") {
      const page = Number(value);
      if (!Number.isFinite(page)) {
        await answerCallbackQuery(query.id, "Invalid page.");
        return true;
      }
      if (page === state.page) {
        await answerCallbackQuery(query.id);
        return true;
      }
      state.page = page;
      await updateModelMenuMessage(state, ctx);
      await answerCallbackQuery(query.id);
      return true;
    }
    if (action !== "pick") {
      await answerCallbackQuery(query.id);
      return true;
    }
    const index = Number(value);
    if (!Number.isFinite(index)) {
      await answerCallbackQuery(query.id, "Invalid model selection.");
      return true;
    }
    const selection = getModelMenuItems(state)[index];
    if (!selection) {
      await answerCallbackQuery(
        query.id,
        "Selected model is no longer available.",
      );
      return true;
    }
    if (!ctx.isIdle()) {
      await answerCallbackQuery(query.id, "Pi is busy. Send /stop first.");
      return true;
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
      return true;
    }
    try {
      const changed = await pi.setModel(selection.model);
      if (changed === false) {
        await answerCallbackQuery(query.id, "Model is not available.");
        return true;
      }
      currentTelegramModel = selection.model;
      if (selection.thinkingLevel) {
        pi.setThinkingLevel(selection.thinkingLevel);
      }
      await showStatusMessage(state, ctx);
      await answerCallbackQuery(query.id, `Switched to ${selection.model.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await answerCallbackQuery(query.id, message);
    }
    return true;
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
    const handled =
      (await handleStatusCallbackAction(query, state, ctx)) ||
      (await handleThinkingCallbackAction(query, state, ctx)) ||
      (await handleModelCallbackAction(query, state, ctx));
    if (!handled) {
      await answerCallbackQuery(query.id);
    }
  }

  // --- Status Rendering ---

  function buildStatusReplyMarkup(ctx: ExtensionContext): TelegramReplyMarkup {
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

  function collectUsageStats(ctx: ExtensionContext): TelegramUsageStats {
    const stats: TelegramUsageStats = {
      totalInput: 0,
      totalOutput: 0,
      totalCacheRead: 0,
      totalCacheWrite: 0,
      totalCost: 0,
    };
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type !== "message" || entry.message.role !== "assistant") {
        continue;
      }
      stats.totalInput += entry.message.usage.input;
      stats.totalOutput += entry.message.usage.output;
      stats.totalCacheRead += entry.message.usage.cacheRead;
      stats.totalCacheWrite += entry.message.usage.cacheWrite;
      stats.totalCost += entry.message.usage.cost.total;
    }
    return stats;
  }

  function buildStatusRow(label: string, value: string): string {
    return `<b>${escapeHtml(label)}:</b> <code>${escapeHtml(value)}</code>`;
  }

  function buildUsageSummary(stats: TelegramUsageStats): string | undefined {
    const tokenParts: string[] = [];
    if (stats.totalInput) tokenParts.push(`↑${formatTokens(stats.totalInput)}`);
    if (stats.totalOutput)
      tokenParts.push(`↓${formatTokens(stats.totalOutput)}`);
    if (stats.totalCacheRead)
      tokenParts.push(`R${formatTokens(stats.totalCacheRead)}`);
    if (stats.totalCacheWrite)
      tokenParts.push(`W${formatTokens(stats.totalCacheWrite)}`);
    return tokenParts.length > 0 ? tokenParts.join(" ") : undefined;
  }

  function buildCostSummary(
    stats: TelegramUsageStats,
    usesSubscription: boolean,
  ): string | undefined {
    if (!stats.totalCost && !usesSubscription) return undefined;
    return `$${stats.totalCost.toFixed(3)}${usesSubscription ? " (sub)" : ""}`;
  }

  function buildContextSummary(
    ctx: ExtensionContext,
    activeModel: Model<any> | undefined,
  ): string {
    const usage = ctx.getContextUsage();
    if (!usage) return "unknown";
    const contextWindow =
      usage.contextWindow ?? activeModel?.contextWindow ?? 0;
    const percent =
      usage.percent !== null ? `${usage.percent.toFixed(1)}%` : "?";
    return `${percent}/${formatTokens(contextWindow)}`;
  }

  function buildStatusHtml(ctx: ExtensionContext): string {
    const stats = collectUsageStats(ctx);
    const activeModel = getCurrentTelegramModel(ctx);
    const usesSubscription = activeModel
      ? ctx.modelRegistry.isUsingOAuth(activeModel)
      : false;
    const lines: string[] = [];
    const usageSummary = buildUsageSummary(stats);
    const costSummary = buildCostSummary(stats, usesSubscription);
    if (usageSummary) {
      lines.push(buildStatusRow("Usage", usageSummary));
    }
    if (costSummary) {
      lines.push(buildStatusRow("Cost", costSummary));
    }
    lines.push(
      buildStatusRow("Context", buildContextSummary(ctx, activeModel)),
    );
    if (lines.length === 0) {
      lines.push(buildStatusRow("Status", "No usage data yet."));
    }
    return lines.join("\n");
  }

  // --- Turn Queue & Message Dispatch ---

  function extractTelegramMessageText(message: TelegramMessage): string {
    return (message.text || message.caption || "").trim();
  }

  function extractTelegramMessagesText(messages: TelegramMessage[]): string {
    return messages
      .map(extractTelegramMessageText)
      .filter(Boolean)
      .join("\n\n");
  }

  function extractFirstTelegramMessageText(
    messages: TelegramMessage[],
  ): string {
    return messages.map(extractTelegramMessageText).find(Boolean) ?? "";
  }

  function collectTelegramMessageIds(messages: TelegramMessage[]): number[] {
    return [...new Set(messages.map((message) => message.message_id))];
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
          `document-${message.message_id}${guessExtensionFromMime(
            message.document.mime_type,
            "",
          )}`;
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
          `video-${message.message_id}${guessExtensionFromMime(
            message.video.mime_type,
            ".mp4",
          )}`;
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
          `audio-${message.message_id}${guessExtensionFromMime(
            message.audio.mime_type,
            ".mp3",
          )}`;
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
          fileName: `voice-${message.message_id}${guessExtensionFromMime(
            message.voice.mime_type,
            ".ogg",
          )}`,
          mimeType: message.voice.mime_type,
          isImage: false,
        });
      }
      if (message.animation) {
        const fileName =
          message.animation.file_name ||
          `animation-${message.message_id}${guessExtensionFromMime(
            message.animation.mime_type,
            ".mp4",
          )}`;
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

  function isTelegramMessageIdList(value: unknown): value is number[] {
    return (
      Array.isArray(value) && value.every((item) => Number.isInteger(item))
    );
  }

  function normalizeTelegramReactionEmoji(emoji: string): string {
    return emoji.replace(/\uFE0F/g, "");
  }

  function collectTelegramReactionEmojis(
    reactions: TelegramReactionType[],
  ): Set<string> {
    return new Set(
      reactions
        .filter(
          (reaction): reaction is TelegramReactionTypeEmoji =>
            reaction.type === "emoji",
        )
        .map((reaction) => normalizeTelegramReactionEmoji(reaction.emoji)),
    );
  }

  function compareQueuedTelegramTurns(
    left: PendingTelegramTurn,
    right: PendingTelegramTurn,
  ): number {
    const leftPriority = left.priorityReactionOrder ?? Number.POSITIVE_INFINITY;
    const rightPriority =
      right.priorityReactionOrder ?? Number.POSITIVE_INFINITY;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return left.queueOrder - right.queueOrder;
  }

  function reorderQueuedTelegramTurns(ctx: ExtensionContext): void {
    queuedTelegramTurns.sort(compareQueuedTelegramTurns);
    updateStatus(ctx);
  }

  function extractDeletedTelegramMessageIds(update: TelegramUpdate): number[] {
    const deletedBusinessMessageIds = (
      update as TelegramUpdate & {
        deleted_business_messages?: { message_ids?: unknown };
      }
    ).deleted_business_messages?.message_ids;
    if (isTelegramMessageIdList(deletedBusinessMessageIds)) {
      return deletedBusinessMessageIds;
    }
    const rawDeleteUpdate = update as TelegramUpdate & {
      _: string;
      messages?: unknown;
    };
    if (
      rawDeleteUpdate._ === "updateDeleteMessages" &&
      isTelegramMessageIdList(rawDeleteUpdate.messages)
    ) {
      return rawDeleteUpdate.messages;
    }
    return [];
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
    if (messageIds.length === 0 || queuedTelegramTurns.length === 0) return 0;
    const deletedMessageIds = new Set(messageIds);
    const nextQueue = queuedTelegramTurns.filter(
      (turn) =>
        !turn.sourceMessageIds.some((messageId) =>
          deletedMessageIds.has(messageId),
        ),
    );
    const removedCount = queuedTelegramTurns.length - nextQueue.length;
    if (removedCount === 0) return 0;
    queuedTelegramTurns = nextQueue;
    updateStatus(ctx);
    return removedCount;
  }

  function clearQueuedTelegramTurnPriorityByMessageId(
    messageId: number,
    ctx: ExtensionContext,
  ): boolean {
    const turn = queuedTelegramTurns.find((entry) =>
      entry.sourceMessageIds.includes(messageId),
    );
    if (!turn || turn.priorityReactionOrder === undefined) return false;
    turn.priorityReactionOrder = undefined;
    reorderQueuedTelegramTurns(ctx);
    return true;
  }

  function prioritizeQueuedTelegramTurnByMessageId(
    messageId: number,
    ctx: ExtensionContext,
  ): boolean {
    const turn = queuedTelegramTurns.find((entry) =>
      entry.sourceMessageIds.includes(messageId),
    );
    if (!turn) return false;
    turn.priorityReactionOrder = nextPriorityReactionOrder++;
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
    const firstMessage = messages[0];
    if (!firstMessage)
      throw new Error("Missing Telegram message for turn creation");
    const rawText = extractTelegramMessagesText(messages);
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
      sourceMessageIds: collectTelegramMessageIds(messages),
      queueOrder: nextQueuedTelegramTurnOrder++,
      queuedAttachments: [],
      content,
      historyText: formatTelegramHistoryText(rawText, files),
      statusSummary: formatTelegramTurnStatusSummary(rawText, files),
    };
  }

  async function handleStopCommand(
    message: TelegramMessage,
    ctx: ExtensionContext,
  ): Promise<void> {
    if (currentAbort) {
      if (queuedTelegramTurns.length > 0) {
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
    if (!ctx.isIdle()) {
      await sendTextReply(
        message.chat.id,
        message.message_id,
        "Cannot compact while pi is busy. Send /stop first.",
      );
      return;
    }
    ctx.compact({
      onComplete: () => {
        void sendTextReply(
          message.chat.id,
          message.message_id,
          "Compaction completed.",
        );
      },
      onError: (error) => {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        void sendTextReply(
          message.chat.id,
          message.message_id,
          `Compaction failed: ${errorMessage}`,
        );
      },
    });
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
    await sendStatusMessage(message.chat.id, message.message_id, ctx);
  }

  async function handleModelCommand(
    message: TelegramMessage,
    ctx: ExtensionContext,
  ): Promise<void> {
    await openModelMenu(message.chat.id, message.message_id, ctx);
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
      await writeConfig(config);
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
    const historyTurns = preserveQueuedTurnsAsHistory
      ? queuedTelegramTurns.splice(0)
      : [];
    preserveQueuedTurnsAsHistory = false;
    const turn = await createTelegramTurn(messages, historyTurns);
    queuedTelegramTurns.push(turn);
    updateStatus(ctx);
    if (!ctx.isIdle()) return;
    startTypingLoop(ctx, turn.chatId);
    pi.sendUserMessage(turn.content);
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
    if (config.allowedUserId !== undefined) return false;
    config.allowedUserId = userId;
    await writeConfig(config);
    updateStatus(ctx);
    return true;
  }

  async function handleUpdate(
    update: TelegramUpdate,
    ctx: ExtensionContext,
  ): Promise<void> {
    const deletedMessageIds = extractDeletedTelegramMessageIds(update);
    if (deletedMessageIds.length > 0) {
      removePendingMediaGroupMessages(deletedMessageIds);
      removeQueuedTelegramTurnsByMessageIds(deletedMessageIds, ctx);
      return;
    }
    if (update.message_reaction) {
      await handleAuthorizedTelegramReactionUpdate(
        update.message_reaction,
        ctx,
      );
      return;
    }
    if (update.callback_query) {
      const query = update.callback_query;
      const message = query.message;
      if (!message || message.chat.type !== "private" || query.from.is_bot) {
        return;
      }
      await pairTelegramUserIfNeeded(query.from.id, ctx);
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
    ) {
      return;
    }
    const pairedNow = await pairTelegramUserIfNeeded(message.from.id, ctx);
    if (pairedNow) {
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
            allowed_updates: [
              "message",
              "edited_message",
              "callback_query",
              "message_reaction",
            ],
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

  // --- Extension Registration ---

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
        `bot: ${
          config.botUsername ? `@${config.botUsername}` : "not configured"
        }`,
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

  // --- Lifecycle Hooks ---

  pi.on("session_start", async (_event, ctx) => {
    config = await readConfig();
    currentTelegramModel = ctx.model;
    await mkdir(TEMP_DIR, { recursive: true });
    updateStatus(ctx);
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    queuedTelegramTurns = [];
    nextQueuedTelegramTurnOrder = 0;
    nextPriorityReactionOrder = 0;
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
        previewState = createPreviewState();
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
      const previousText = previewState.pendingText.trim();
      if (previousText.length > 0) {
        await finalizeMarkdownPreview(activeTelegramTurn.chatId, previousText);
      } else {
        await finalizePreview(activeTelegramTurn.chatId);
      }
    }
    previewState = createPreviewState();
  });

  pi.on("message_update", async (event, _ctx) => {
    if (!activeTelegramTurn || !isAssistantMessage(event.message)) return;
    if (!previewState) {
      previewState = createPreviewState();
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
    if (finalText) {
      const finalized = await finalizeMarkdownPreview(turn.chatId, finalText);
      if (!finalized) {
        await clearPreview(turn.chatId);
        await sendMarkdownReply(turn.chatId, turn.replyToMessageId, finalText);
      }
    } else {
      await clearPreview(turn.chatId);
      if (turn.queuedAttachments.length > 0) {
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
