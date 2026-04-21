/**
 * Telegram voice helpers
 * Owns provider-neutral voice settings, provider adapters, speech cleanup, and optional Telegram voice-note transcoding
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";

import type { TelegramConfig, TelegramVoiceConfig } from "./api.ts";
import type { TelegramInputModality } from "./media.ts";

const XAI_API_BASE = "https://api.x.ai/v1";
const USER_PI_SETTINGS_PATH = resolve(homedir(), ".pi/agent/settings.json");
const TEMP_AUDIO_DIR = join(tmpdir(), "pi-telegram", "voice");

export const DEFAULT_TELEGRAM_VOICE_PROVIDER = "xai";
export const DEFAULT_TELEGRAM_SPEECH_STYLE = "literal";
export const DEFAULT_TELEGRAM_SPEECH_PREPARATION_PROMPT =
  "Rewrite following assistant reply for spoken delivery in vivid, natural {language}. Keep meaning exactly. Add no new facts. Input modality: {inputModality}. Speech style: {speechStyle}. Provider: {provider}. Provider tag style: {tagStyle}. Allowed tags: {allowedTags}. Use only these exact tags when needed. Never invent new tags, never rename tags, and never use any tag outside this allowed list. For wrapper tags, use only matching opening and closing forms from the allowed list. Do not use emojis, emoticons, kaomoji, decorative unicode symbols, or visual markdown emphasis markers in the spoken output. Write plain speakable words plus allowed speech tags only. Place inline tags where expression would occur naturally in conversation. Combine tags with punctuation instead of stacking too many tags together. Use [pause] or [long-pause] for timing, suspense, scene transitions, or to let a punchline land. Use laughter tags like [giggle], [laugh], [chuckle], or <laugh-speak>...</laugh-speak> for jokes, teasing, or warm amusement when they fit naturally. Use wrapping tags around complete phrases, not isolated random words. Use <emphasis>...</emphasis> for key emotional beats, <whisper>...</whisper> for secrets or intimacy, <slow>...</slow> for dramatic or reflective lines, and <soft>...</soft> when delivery should feel gentle. You may combine wrapping tags for effect, for example <slow><soft>...</soft></slow>. For rewrite-tags, prefer around 2 to 5 natural tags in a short reply when helpful. For rewrite-strong, lean into expressive performance and prefer around 3 to 8 natural tags when the content supports it. Especially for stories, suspense, jokes, and playful replies, actively use multiple tags from the allowed list when they improve delivery. Never place tags inside code, commands, URLs, file names, or quoted literals. Reply only with final spoken text.\n\n{text}";

export const XAI_INLINE_SPEECH_TAGS = [
  "[pause]",
  "[long-pause]",
  "[laugh]",
  "[chuckle]",
  "[giggle]",
  "[cry]",
  "[tsk]",
  "[tongue-click]",
  "[lip-smack]",
  "[hum-tune]",
  "[breath]",
  "[inhale]",
  "[exhale]",
  "[sigh]",
  "[gasp]",
] as const;

export const XAI_WRAPPER_SPEECH_TAGS = [
  "soft",
  "whisper",
  "decrease-intensity",
  "higher-pitch",
  "sing-song",
  "loud",
  "build-intensity",
  "lower-pitch",
  "singing",
  "slow",
  "laugh-speak",
  "fast",
  "emphasis",
  "shout",
  "excited",
  "calm",
  "sad",
  "happy",
] as const;

export const XAI_ALLOWED_SPEECH_TAGS = [
  ...XAI_INLINE_SPEECH_TAGS,
  ...XAI_WRAPPER_SPEECH_TAGS.map((tag) => `<${tag}>...</${tag}>`),
] as const;

const XAI_INLINE_SPEECH_TAG_SET = new Set<string>(XAI_INLINE_SPEECH_TAGS);
const XAI_WRAPPER_SPEECH_TAG_SET = new Set<string>(XAI_WRAPPER_SPEECH_TAGS);

interface JsonRecord {
  [key: string]: unknown;
}

interface XaiVoiceDefaults {
  apiKey?: string;
  baseUrl: string;
  defaultVoiceId?: string;
  defaultLanguage?: string;
  sttLanguage?: string;
}

export type TelegramSpeechStyle = "literal" | "rewrite-light" | "rewrite-tags" | "rewrite-strong";
export type TelegramVoiceTagStyle = "none" | "xai" | "ssml" | "custom";

export interface ResolvedTelegramVoiceSettings {
  enabled: boolean;
  provider: string;
  providerOptions: Record<string, unknown>;
  autoTranscribeIncoming: boolean;
  replyWithVoiceOnIncomingVoice: boolean;
  alsoSendTextReply: boolean;
  defaultVoiceId?: string;
  defaultLanguage?: string;
  sttLanguage?: string;
  speechStyle: TelegramSpeechStyle;
  speechPreparationPrompt?: string;
}

export type TelegramVoiceCommand =
  | { action: "status" }
  | { action: "toggle"; enabled: boolean }
  | { action: "reply"; enabled: boolean }
  | { action: "transcribe"; enabled: boolean }
  | { action: "text"; enabled: boolean }
  | { action: "voice"; voiceId: string }
  | { action: "language"; language: string }
  | { action: "provider"; provider: string }
  | { action: "style"; style: TelegramSpeechStyle }
  | { action: "prompt" }
  | { action: "prompt-reset" };

export interface TelegramVoicePreparationInput {
  text: string;
  settings: ResolvedTelegramVoiceSettings;
  inputModality?: TelegramInputModality;
  language?: string;
}

export interface TelegramVoicePreparedSpeech {
  speechText: string;
  appliedStyle: TelegramSpeechStyle;
}

export interface TelegramVoiceTranscriptionInput {
  cwd: string;
  filePath: string;
  language?: string;
  settings: ResolvedTelegramVoiceSettings;
}

const XAI_LANGUAGE_ALIASES: Record<string, string> = {
  auto: "auto",
  english: "en",
  en: "en",
  german: "de",
  deutsch: "de",
  de: "de",
  french: "fr",
  fr: "fr",
  arabic: "ar-SA",
  "arabic-egypt": "ar-EG",
  "arabic-saudi-arabia": "ar-SA",
  "arabic-united-arab-emirates": "ar-AE",
  "ar-eg": "ar-EG",
  "ar-sa": "ar-SA",
  "ar-ae": "ar-AE",
  spanish: "es-ES",
  espanol: "es-ES",
  español: "es-ES",
  "es-es": "es-ES",
  "es-mx": "es-MX",
  es: "es-ES",
  italian: "it",
  it: "it",
  portuguese: "pt-BR",
  portugues: "pt-BR",
  português: "pt-BR",
  "pt-br": "pt-BR",
  "pt-pt": "pt-PT",
  pt: "pt-BR",
  turkish: "tr",
  tr: "tr",
  chinese: "zh",
  zh: "zh",
  hindi: "hi",
  hi: "hi",
  indonesian: "id",
  id: "id",
  japanese: "ja",
  ja: "ja",
  korean: "ko",
  ko: "ko",
  russian: "ru",
  ru: "ru",
  vietnamese: "vi",
  vi: "vi",
  bengali: "bn",
  bn: "bn",
};

export interface TelegramVoiceSynthesisInput {
  cwd: string;
  text: string;
  voiceId?: string;
  language?: string;
  settings: ResolvedTelegramVoiceSettings;
  inputModality?: TelegramInputModality;
}

export interface TelegramVoiceSynthesisResult {
  method: "sendVoice" | "sendAudio";
  fieldName: "voice" | "audio";
  filePath: string;
  fileName: string;
  cleanupPaths: string[];
}

export interface TelegramVoiceProvider {
  id: string;
  tagStyle: TelegramVoiceTagStyle;
  allowedTags?: string[];
  getDefaults(cwd: string): {
    defaultVoiceId?: string;
    defaultLanguage?: string;
    sttLanguage?: string;
  };
  prepareSpeechText(
    input: TelegramVoicePreparationInput,
  ): Promise<TelegramVoicePreparedSpeech> | TelegramVoicePreparedSpeech;
  transcribe(
    input: TelegramVoiceTranscriptionInput,
  ): Promise<{ text: string; language?: string }>;
  synthesize(input: TelegramVoiceSynthesisInput): Promise<TelegramVoiceSynthesisResult>;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeRecords(base: JsonRecord, override: JsonRecord): JsonRecord {
  const merged: JsonRecord = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = merged[key];
    if (isRecord(current) && isRecord(value)) {
      merged[key] = mergeRecords(current, value);
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

function readJsonRecord(path: string): JsonRecord {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function getProjectPiSettingsPath(cwd: string): string {
  return resolve(cwd, ".pi/settings.json");
}

function getStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function getRecordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? { ...value } : {};
}

export function normalizeTelegramVoiceLanguage(
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  const lower = normalized.toLowerCase();
  if (XAI_LANGUAGE_ALIASES[lower]) return XAI_LANGUAGE_ALIASES[lower];
  if (/^[a-z]{2}(?:-[a-z]{2})?$/i.test(normalized)) return normalized;
  return undefined;
}

export function inferTelegramVoiceLanguage(text: string): string | undefined {
  const normalized = text.toLowerCase();
  const score = (words: string[]): number =>
    words.reduce((total, word) => {
      return total + (normalized.includes(word) ? 1 : 0);
    }, 0);
  const germanScore = score([
    " der ",
    " die ",
    " und ",
    " nicht ",
    " ist ",
    " ich ",
    " wir ",
    " ä",
    " ö",
    " ü",
    "ß",
  ]);
  const englishScore = score([
    " the ",
    " and ",
    " you ",
    " is ",
    " are ",
    " this ",
    " that ",
  ]);
  if (germanScore >= 2 && germanScore > englishScore) return "de";
  if (englishScore >= 2 && englishScore > germanScore) return "en";
  return undefined;
}

export function resolveTelegramVoiceLanguage(options: {
  text: string;
  requestedLanguage?: string;
  transcriptLanguage?: string;
}): string {
  return (
    inferTelegramVoiceLanguage(options.text) ||
    normalizeTelegramVoiceLanguage(options.transcriptLanguage) ||
    normalizeTelegramVoiceLanguage(options.requestedLanguage) ||
    "auto"
  );
}

function inferAudioMimeType(filePath: string): string {
  const extension = extname(filePath).slice(1).toLowerCase();
  switch (extension) {
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "ogg":
      return "audio/ogg";
    case "opus":
      return "audio/opus";
    case "flac":
      return "audio/flac";
    case "aac":
      return "audio/aac";
    case "mp4":
    case "m4a":
      return "audio/mp4";
    default:
      return "application/octet-stream";
  }
}

function getRequiredXaiVoiceDefaults(cwd: string): XaiVoiceDefaults {
  const projectConfig = readJsonRecord(getProjectPiSettingsPath(cwd));
  const userConfig = readJsonRecord(USER_PI_SETTINGS_PATH);
  const merged = mergeRecords(userConfig, projectConfig);
  const xai = isRecord(merged.xai) ? merged.xai : {};
  const voice = isRecord(xai.voice) ? xai.voice : {};
  const apiKey = process.env.XAI_API_KEY?.trim() || getStringValue(xai.apiKey);
  if (!apiKey) {
    throw new Error(
      `Missing voice provider API key. Set XAI_API_KEY or configure xai.apiKey in ${getProjectPiSettingsPath(cwd)} or ${USER_PI_SETTINGS_PATH}.`,
    );
  }
  return {
    apiKey,
    baseUrl: getStringValue(xai.baseUrl) || XAI_API_BASE,
    defaultVoiceId: getStringValue(voice.defaultVoice),
    defaultLanguage: getStringValue(voice.defaultLanguage),
    sttLanguage: getStringValue(voice.sttLanguage),
  };
}

async function ensureTempAudioDir(): Promise<void> {
  await mkdir(TEMP_AUDIO_DIR, { recursive: true });
}

function createTempAudioPath(stem: string, extension: string): string {
  const safeStem = stem.replace(/[^a-zA-Z0-9._-]+/g, "-") || "voice";
  const random = Math.random().toString(36).slice(2, 8);
  return join(TEMP_AUDIO_DIR, `${safeStem}-${Date.now()}-${random}${extension}`);
}

async function requestWithBearerAuth(
  url: string,
  apiKey: string,
  init: RequestInit,
): Promise<Response> {
  const headers = new Headers(init.headers || undefined);
  headers.set("Authorization", `Bearer ${apiKey}`);
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body.trim() || `Voice provider request failed: ${response.status}`);
  }
  return response;
}

async function runFfmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", ["-y", ...args], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      reject(
        new Error(
          `Failed to start ffmpeg: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          stderr.trim() || `ffmpeg exited with code ${String(code ?? "unknown")}`,
        ),
      );
    });
  });
}

export function stripMarkdownForSpeech(text: string): string {
  return text
    .replace(/```[a-zA-Z0-9_-]*\n?/g, "")
    .replace(/```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+[.)]\s+/gm, "")
    .replace(/[*_~]+/g, "")
    .replace(/(?:\p{Regional_Indicator}{2})/gu, " ")
    .replace(/[#*0-9]\uFE0F?\u20E3/gu, " ")
    .replace(
      /(?:\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?)*)/gu,
      " ",
    )
    .replace(/[\u200D\uFE0F\uFE0E]/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function applyBasicSpeechRewrite(
  text: string,
  style: TelegramSpeechStyle,
): string {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (style === "literal") {
    return normalized;
  }
  const softened = normalized
    .replace(/\bETA\b/g, "voraussichtliche Zeit")
    .replace(/\be\.g\.\b/gi, "zum Beispiel")
    .replace(/\bi\.e\.\b/gi, "das heißt")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n- /g, "\n")
    .replace(/\n\d+[.)] /g, "\n")
    .trim();
  if (style === "rewrite-strong") {
    return softened
      .replace(/\bETA\b/g, "ungefähre Zeit")
      .replace(/\bvs\.\b/gi, "gegen")
      .replace(/\bevtl\.\b/gi, "eventuell")
      .trim();
  }
  return softened;
}

function normalizeXaiSpeechTags(text: string): string {
  return text
    .replace(/\[([a-z-]+)\]/gi, (_match, name: string) => {
      const normalized = `[${name.toLowerCase()}]`;
      return XAI_INLINE_SPEECH_TAG_SET.has(normalized) ? normalized : "";
    })
    .replace(/<(\/)?([a-z-]+)>/gi, (_match, closing: string | undefined, name: string) => {
      const normalized = name.toLowerCase();
      if (!XAI_WRAPPER_SPEECH_TAG_SET.has(normalized)) return "";
      return closing ? `</${normalized}>` : `<${normalized}>`;
    })
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function hasXaiSpeechTags(text: string): boolean {
  return /\[([a-z-]+)\]|<(\/)?([a-z-]+)>/i.test(normalizeXaiSpeechTags(text));
}

function looksLikeJoke(text: string): boolean {
  return /(witz|scherz|pointe|haha|hehe|lustig|witzig|😂|🤣)/i.test(text)
    || /(warum .*\?|kommt .* in .*bar|treffen sich .*|sagt .* zu .*)/i.test(text);
}

function applyXaiSpeechTags(text: string, style: TelegramSpeechStyle): string {
  let tagged = text.replace(/\n\n+/g, style === "rewrite-strong" ? " [long-pause] " : " [pause] ").trim();
  if (style === "rewrite-strong") {
    if (!/<(slow|soft|emphasis|laugh-speak)>/i.test(tagged) && tagged.length > 80) {
      tagged = `<slow><soft>${tagged}</soft></slow>`;
    }
    if (looksLikeJoke(tagged) && !/\[(laugh|giggle|chuckle)\]|<laugh-speak>/i.test(tagged)) {
      tagged = tagged.replace(/([.!?])\s*$/, "$1 [giggle]");
    }
    if (!/\[(pause|long-pause)\]/i.test(tagged) && /[,;:]/.test(tagged)) {
      tagged = tagged.replace(/([,;:])\s+/g, "$1 [pause] ");
    }
    return tagged.trim();
  }
  return tagged;
}

export function buildSpeechPreparationPrompt(options: {
  settings: ResolvedTelegramVoiceSettings;
  inputModality?: TelegramInputModality;
  text: string;
  language?: string;
  tagStyle?: TelegramVoiceTagStyle;
}): string {
  const template =
    options.settings.speechPreparationPrompt ||
    DEFAULT_TELEGRAM_SPEECH_PREPARATION_PROMPT;
  const replacements: Record<string, string> = {
    provider: options.settings.provider,
    language: options.language || options.settings.defaultLanguage || "auto",
    inputModality: options.inputModality || "text",
    speechStyle: options.settings.speechStyle,
    text: options.text,
    tagStyle: options.tagStyle || "none",
    allowedTags:
      getTelegramVoiceProvider(options.settings.provider)?.allowedTags?.join(", ") ||
      "none",
  };
  return template.replace(/\{(provider|language|inputModality|speechStyle|text|tagStyle|allowedTags)\}/g, (_match, key) => {
    return replacements[key] || "";
  });
}

async function synthesizeSpeechWithXai(options: {
  cwd: string;
  text: string;
  voiceId?: string;
  language?: string;
  codec?: "mp3" | "wav";
}): Promise<{
  audioPath: string;
  voiceId: string;
  language: string;
  codec: "mp3" | "wav";
}> {
  const defaults = getRequiredXaiVoiceDefaults(options.cwd);
  await ensureTempAudioDir();
  const voiceId = options.voiceId || defaults.defaultVoiceId || "eve";
  const language = options.language || defaults.defaultLanguage || "en";
  const codec = options.codec || "mp3";
  const response = await requestWithBearerAuth(
    `${defaults.baseUrl.replace(/\/+$/, "")}/tts`,
    defaults.apiKey!,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: options.text,
        voice_id: voiceId,
        language,
        output_format: {
          codec,
          sample_rate: 24000,
          ...(codec === "mp3" ? { bit_rate: 64000 } : {}),
        },
      }),
    },
  );
  const targetPath = createTempAudioPath(
    `tts-${voiceId}`,
    codec === "mp3" ? ".mp3" : ".wav",
  );
  await writeFile(targetPath, Buffer.from(await response.arrayBuffer()));
  return { audioPath: targetPath, voiceId, language, codec };
}

export async function transcodeTelegramVoiceNote(
  inputPath: string,
): Promise<string> {
  await ensureTempAudioDir();
  const outputPath = createTempAudioPath("telegram-voice", ".ogg");
  await runFfmpeg([
    "-i",
    inputPath,
    "-vn",
    "-c:a",
    "libopus",
    "-b:a",
    "48k",
    "-f",
    "ogg",
    outputPath,
  ]);
  return outputPath;
}

const xaiVoiceProvider: TelegramVoiceProvider = {
  id: "xai",
  tagStyle: "xai",
  allowedTags: [...XAI_ALLOWED_SPEECH_TAGS],
  getDefaults(cwd) {
    const defaults = getRequiredXaiVoiceDefaults(cwd);
    return {
      defaultVoiceId: defaults.defaultVoiceId,
      defaultLanguage: defaults.defaultLanguage,
      sttLanguage: defaults.sttLanguage,
    };
  },
  prepareSpeechText(input) {
    const stripped = stripMarkdownForSpeech(input.text);
    if (!stripped) {
      throw new Error("Voice reply text is empty after markdown cleanup");
    }
    const rewritten = applyBasicSpeechRewrite(stripped, input.settings.speechStyle);
    const speechText =
      input.settings.speechStyle === "rewrite-tags" ||
      input.settings.speechStyle === "rewrite-strong"
        ? hasXaiSpeechTags(rewritten)
          ? rewritten
          : applyXaiSpeechTags(rewritten, input.settings.speechStyle)
        : rewritten;
    return {
      speechText: normalizeXaiSpeechTags(speechText),
      appliedStyle: input.settings.speechStyle,
    };
  },
  async transcribe(input) {
    const defaults = getRequiredXaiVoiceDefaults(input.cwd);
    const language =
      input.language ||
      input.settings.sttLanguage ||
      input.settings.defaultLanguage ||
      defaults.sttLanguage ||
      defaults.defaultLanguage;
    const form = new FormData();
    if (language) {
      form.append("language", language);
      form.append("format", "true");
    }
    const blob = new Blob([readFileSync(input.filePath)], {
      type: inferAudioMimeType(input.filePath),
    });
    form.append("file", blob, basename(input.filePath));
    const response = await requestWithBearerAuth(
      `${defaults.baseUrl.replace(/\/+$/, "")}/stt`,
      defaults.apiKey!,
      { method: "POST", body: form },
    );
    const raw = (await response.json()) as { text?: string; language?: string };
    return {
      text: raw.text?.trim() || "",
      language: normalizeTelegramVoiceLanguage(raw.language?.trim()) || language,
    };
  },
  async synthesize(input) {
    const prepared = await this.prepareSpeechText({
      text: input.text,
      settings: input.settings,
      inputModality: input.inputModality,
      language: input.language,
    });
    const directTts = await synthesizeSpeechWithXai({
      cwd: input.cwd,
      text: prepared.speechText,
      voiceId: input.voiceId || input.settings.defaultVoiceId,
      language: input.language || input.settings.defaultLanguage,
      codec: "mp3",
    });
    return {
      method: "sendVoice",
      fieldName: "voice",
      filePath: directTts.audioPath,
      fileName: basename(directTts.audioPath),
      cleanupPaths: [directTts.audioPath],
    };
  },
};

const TELEGRAM_VOICE_PROVIDERS: Record<string, TelegramVoiceProvider> = {
  [xaiVoiceProvider.id]: xaiVoiceProvider,
};

export function getTelegramVoiceProvider(
  providerId: string | undefined,
): TelegramVoiceProvider | undefined {
  if (!providerId) return TELEGRAM_VOICE_PROVIDERS[DEFAULT_TELEGRAM_VOICE_PROVIDER];
  return TELEGRAM_VOICE_PROVIDERS[providerId.trim().toLowerCase()];
}

export function normalizeTelegramVoiceSettings(
  configVoice: TelegramVoiceConfig | undefined,
  defaults: Pick<
    ResolvedTelegramVoiceSettings,
    "defaultVoiceId" | "defaultLanguage" | "sttLanguage"
  > = {},
): ResolvedTelegramVoiceSettings {
  const enabled = configVoice?.enabled === true;
  return {
    enabled,
    provider:
      configVoice?.provider?.trim().toLowerCase() ||
      DEFAULT_TELEGRAM_VOICE_PROVIDER,
    providerOptions: getRecordValue(configVoice?.providerOptions),
    autoTranscribeIncoming: configVoice?.autoTranscribeIncoming ?? enabled,
    replyWithVoiceOnIncomingVoice:
      configVoice?.replyWithVoiceOnIncomingVoice ?? enabled,
    alsoSendTextReply: configVoice?.alsoSendTextReply === true,
    defaultVoiceId: configVoice?.defaultVoiceId || defaults.defaultVoiceId,
    defaultLanguage: configVoice?.defaultLanguage || defaults.defaultLanguage,
    sttLanguage: defaults.sttLanguage,
    speechStyle: configVoice?.speechStyle || DEFAULT_TELEGRAM_SPEECH_STYLE,
    speechPreparationPrompt:
      configVoice?.speechPreparationPrompt ||
      DEFAULT_TELEGRAM_SPEECH_PREPARATION_PROMPT,
  };
}

export function resolveTelegramVoiceSettings(
  config: TelegramConfig,
  cwd: string,
): ResolvedTelegramVoiceSettings {
  const provider =
    config.voice?.provider?.trim().toLowerCase() || DEFAULT_TELEGRAM_VOICE_PROVIDER;
  const adapter = getTelegramVoiceProvider(provider);
  let providerDefaults: {
    defaultVoiceId?: string;
    defaultLanguage?: string;
    sttLanguage?: string;
  } = {};
  try {
    providerDefaults = adapter?.getDefaults(cwd) || {};
  } catch {
    providerDefaults = {};
  }
  return normalizeTelegramVoiceSettings(
    {
      ...config.voice,
      provider,
    },
    providerDefaults,
  );
}

export function parseTelegramVoiceCommand(
  args: string,
): TelegramVoiceCommand | undefined {
  const parts = args
    .trim()
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return { action: "status" };
  const [first, second] = parts;
  switch (first?.toLowerCase()) {
    case "status":
      return { action: "status" };
    case "on":
      return { action: "toggle", enabled: true };
    case "off":
      return { action: "toggle", enabled: false };
    case "text":
      if (second?.toLowerCase() === "on") return { action: "text", enabled: true };
      if (second?.toLowerCase() === "off") return { action: "text", enabled: false };
      return undefined;
    case "reply":
      if (second?.toLowerCase() === "on") return { action: "reply", enabled: true };
      if (second?.toLowerCase() === "off") return { action: "reply", enabled: false };
      return undefined;
    case "transcribe":
      if (second?.toLowerCase() === "on") {
        return { action: "transcribe", enabled: true };
      }
      if (second?.toLowerCase() === "off") {
        return { action: "transcribe", enabled: false };
      }
      return undefined;
    case "voice":
      if (!second) return undefined;
      return { action: "voice", voiceId: second };
    case "lang":
    case "language":
      if (!second) return undefined;
      return { action: "language", language: second };
    case "provider":
      if (!second) return undefined;
      return { action: "provider", provider: second.toLowerCase() };
    case "style":
      if (
        second === "literal" ||
        second === "rewrite-light" ||
        second === "rewrite-tags" ||
        second === "rewrite-strong"
      ) {
        return { action: "style", style: second };
      }
      return undefined;
    case "prompt":
      if (second?.toLowerCase() === "reset") return { action: "prompt-reset" };
      return { action: "prompt" };
    default:
      return undefined;
  }
}

export function formatTelegramVoiceStatus(
  settings: ResolvedTelegramVoiceSettings,
): string {
  return [
    `voice: ${settings.enabled ? "on" : "off"}`,
    `provider: ${settings.provider}`,
    `auto-transcribe: ${settings.autoTranscribeIncoming ? "on" : "off"}`,
    `voice-on-voice: ${settings.replyWithVoiceOnIncomingVoice ? "on" : "off"}`,
    `also-send-text: ${settings.alsoSendTextReply ? "on" : "off"}`,
    `voice: ${settings.defaultVoiceId ?? "unset"}`,
    `language: ${settings.defaultLanguage ?? "auto"}`,
    `style: ${settings.speechStyle}`,
    `prompt: ${settings.speechPreparationPrompt === DEFAULT_TELEGRAM_SPEECH_PREPARATION_PROMPT ? "default" : "custom"}`,
  ].join(" | ");
}

export async function prepareTelegramSpeechText(options: {
  text: string;
  settings: ResolvedTelegramVoiceSettings;
  inputModality?: TelegramInputModality;
  language?: string;
}): Promise<TelegramVoicePreparedSpeech> {
  const provider = getTelegramVoiceProvider(options.settings.provider);
  if (!provider) {
    throw new Error(
      `Unsupported Telegram voice provider: ${options.settings.provider}`,
    );
  }
  return provider.prepareSpeechText(options);
}

export async function transcribeTelegramAudio(options: {
  cwd: string;
  filePath: string;
  settings: ResolvedTelegramVoiceSettings;
  language?: string;
}): Promise<{ text: string; language?: string }> {
  const provider = getTelegramVoiceProvider(options.settings.provider);
  if (!provider) {
    throw new Error(
      `Unsupported Telegram voice provider: ${options.settings.provider}`,
    );
  }
  return provider.transcribe(options);
}

export async function synthesizeTelegramVoiceReply(options: TelegramVoiceSynthesisInput): Promise<TelegramVoiceSynthesisResult> {
  const provider = getTelegramVoiceProvider(options.settings.provider);
  if (!provider) {
    throw new Error(
      `Unsupported Telegram voice provider: ${options.settings.provider}`,
    );
  }
  return provider.synthesize(options);
}

export function updateTelegramVoiceConfig(
  config: TelegramConfig,
  command: TelegramVoiceCommand,
): TelegramConfig {
  const current = { ...(config.voice || {}) };
  switch (command.action) {
    case "status":
      return config;
    case "toggle":
      current.enabled = command.enabled;
      break;
    case "text":
      current.alsoSendTextReply = command.enabled;
      break;
    case "reply":
      current.replyWithVoiceOnIncomingVoice = command.enabled;
      break;
    case "transcribe":
      current.autoTranscribeIncoming = command.enabled;
      break;
    case "voice":
      current.defaultVoiceId = command.voiceId;
      break;
    case "language":
      current.defaultLanguage = command.language;
      break;
    case "provider":
      current.provider = command.provider;
      break;
    case "style":
      current.speechStyle = command.style;
      break;
    case "prompt":
    case "prompt-reset":
      return config;
  }
  return {
    ...config,
    voice: current,
  };
}
