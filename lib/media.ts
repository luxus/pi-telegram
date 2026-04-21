/**
 * Telegram media and text extraction helpers
 * Normalizes inbound Telegram messages into reusable file, text, id, and history metadata
 */

export interface TelegramPhotoSizeLike {
  file_id: string;
  file_size?: number;
}

export interface TelegramDocumentLike {
  file_id: string;
  file_name?: string;
  mime_type?: string;
}

export interface TelegramVideoLike {
  file_id: string;
  file_name?: string;
  mime_type?: string;
}

export interface TelegramAudioLike {
  file_id: string;
  file_name?: string;
  mime_type?: string;
}

export interface TelegramVoiceLike {
  file_id: string;
  mime_type?: string;
}

export interface TelegramAnimationLike {
  file_id: string;
  file_name?: string;
  mime_type?: string;
}

export interface TelegramStickerLike {
  file_id: string;
}

export interface TelegramMessageLike {
  message_id: number;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSizeLike[];
  document?: TelegramDocumentLike;
  video?: TelegramVideoLike;
  audio?: TelegramAudioLike;
  voice?: TelegramVoiceLike;
  animation?: TelegramAnimationLike;
  sticker?: TelegramStickerLike;
}

export type TelegramFileKind =
  | "photo"
  | "document"
  | "video"
  | "audio"
  | "voice"
  | "animation"
  | "sticker";

export type TelegramInputModality = "text" | "voice" | "audio" | "mixed";

export interface TelegramFileInfo {
  file_id: string;
  fileName: string;
  mimeType?: string;
  isImage: boolean;
  kind: TelegramFileKind;
}

export interface DownloadedTelegramFileLike {
  path: string;
}

export function guessExtensionFromMime(
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

export function guessMediaType(path: string): string | undefined {
  const normalized = path.toLowerCase();
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (normalized.endsWith(".png")) return "image/png";
  if (normalized.endsWith(".webp")) return "image/webp";
  if (normalized.endsWith(".gif")) return "image/gif";
  return undefined;
}

export function isImageMimeType(mimeType: string | undefined): boolean {
  return mimeType?.toLowerCase().startsWith("image/") ?? false;
}

export function extractTelegramMessageText(
  message: TelegramMessageLike,
): string {
  return (message.text || message.caption || "").trim();
}

export function extractTelegramMessagesText(
  messages: TelegramMessageLike[],
): string {
  return messages.map(extractTelegramMessageText).filter(Boolean).join("\n\n");
}

export function extractFirstTelegramMessageText(
  messages: TelegramMessageLike[],
): string {
  return messages.map(extractTelegramMessageText).find(Boolean) ?? "";
}

export function collectTelegramMessageIds(
  messages: TelegramMessageLike[],
): number[] {
  return [...new Set(messages.map((message) => message.message_id))];
}

export function detectTelegramInputModality(
  messages: TelegramMessageLike[],
): TelegramInputModality {
  const hasVoice = messages.some((message) => !!message.voice);
  const hasAudio = messages.some((message) => !!message.audio);
  const hasText = messages.some(
    (message) => extractTelegramMessageText(message).length > 0,
  );
  const hasOtherMedia = messages.some(
    (message) =>
      (Array.isArray(message.photo) && message.photo.length > 0) ||
      !!message.document ||
      !!message.video ||
      !!message.animation ||
      !!message.sticker,
  );
  if (hasVoice && !hasText && !hasAudio && !hasOtherMedia) return "voice";
  if (hasAudio && !hasText && !hasVoice && !hasOtherMedia) return "audio";
  if (hasVoice || hasAudio) return "mixed";
  return "text";
}

export function formatTelegramHistoryText(
  rawText: string,
  files: DownloadedTelegramFileLike[],
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

export function collectTelegramFileInfos(
  messages: TelegramMessageLike[],
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
          kind: "photo",
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
        kind: "document",
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
        kind: "video",
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
        kind: "audio",
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
        kind: "voice",
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
        kind: "animation",
      });
    }
    if (message.sticker) {
      files.push({
        file_id: message.sticker.file_id,
        fileName: `sticker-${message.message_id}.webp`,
        mimeType: "image/webp",
        isImage: true,
        kind: "sticker",
      });
    }
  }
  return files;
}
