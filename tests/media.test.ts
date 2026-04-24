/**
 * Regression tests for Telegram media and text extraction helpers
 * Covers inbound file-info collection, text extraction, id collection, and history formatting
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  collectTelegramFileInfos,
  collectTelegramMessageIds,
  detectTelegramInputModality,
  extractFirstTelegramMessageText,
  extractTelegramMessagesText,
  formatTelegramHistoryText,
  guessMediaType,
} from "../lib/media.ts";

test("Media helpers collect file infos across Telegram message variants", () => {
  const files = collectTelegramFileInfos([
    {
      message_id: 1,
      text: "hello",
      photo: [
        { file_id: "small", file_size: 1 },
        { file_id: "large", file_size: 10 },
      ],
      document: {
        file_id: "doc",
        file_name: "report.png",
        mime_type: "image/png",
      },
      voice: {
        file_id: "voice",
        mime_type: "audio/ogg",
      },
      sticker: {
        file_id: "sticker",
      },
    },
  ]);
  assert.deepEqual(
    files.map((file) => ({
      id: file.file_id,
      name: file.fileName,
      image: file.isImage,
      kind: file.kind,
    })),
    [
      { id: "large", name: "photo-1.jpg", image: true, kind: "photo" },
      { id: "doc", name: "report.png", image: true, kind: "document" },
      { id: "voice", name: "voice-1.ogg", image: false, kind: "voice" },
      { id: "sticker", name: "sticker-1.webp", image: true, kind: "sticker" },
    ],
  );
});

test("Media helpers detect voice, audio, and mixed input modalities", () => {
  assert.equal(
    detectTelegramInputModality([{ message_id: 1, voice: { file_id: "v" } }]),
    "voice",
  );
  assert.equal(
    detectTelegramInputModality([{ message_id: 1, audio: { file_id: "a" } }]),
    "audio",
  );
  assert.equal(
    detectTelegramInputModality([
      { message_id: 1, voice: { file_id: "v" }, text: "hi" },
    ]),
    "mixed",
  );
});

test("Media helpers extract text, ids, and history summaries", () => {
  const messages = [
    { message_id: 1, text: "first" },
    { message_id: 2, caption: "second" },
    { message_id: 2, text: "duplicate id" },
  ];
  assert.equal(
    extractTelegramMessagesText(messages),
    "first\n\nsecond\n\nduplicate id",
  );
  assert.equal(extractFirstTelegramMessageText(messages), "first");
  assert.deepEqual(collectTelegramMessageIds(messages), [1, 2]);
  assert.equal(
    formatTelegramHistoryText("hello", [{ path: "/tmp/demo.txt" }]),
    "hello\nAttachments:\n- /tmp/demo.txt",
  );
});

test("Media helpers infer outgoing image media types from file paths", () => {
  assert.equal(guessMediaType("/tmp/demo.png"), "image/png");
  assert.equal(guessMediaType("/tmp/demo.txt"), undefined);
});
