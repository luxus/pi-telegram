/**
 * Regression tests for Telegram media and text extraction helpers
 * Covers inbound file-info collection, text extraction, media groups, id collection, and history formatting
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  collectTelegramFileInfos,
  collectTelegramMessageIds,
  extractFirstTelegramMessageText,
  extractTelegramMessagesText,
  formatTelegramHistoryText,
  getTelegramMediaGroupKey,
  guessMediaType,
  queueTelegramMediaGroupMessage,
  removePendingTelegramMediaGroupMessages,
  type TelegramMediaGroupState,
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
    })),
    [
      { id: "large", name: "photo-1.jpg", image: true },
      { id: "doc", name: "report.png", image: true },
      { id: "voice", name: "voice-1.ogg", image: false },
      { id: "sticker", name: "sticker-1.webp", image: true },
    ],
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

test("Media helpers key messages by chat and media group", () => {
  assert.equal(
    getTelegramMediaGroupKey({
      message_id: 1,
      chat: { id: 7 },
      media_group_id: "album",
    }),
    "7:album",
  );
  assert.equal(
    getTelegramMediaGroupKey({ message_id: 1, chat: { id: 7 } }),
    undefined,
  );
});

test("Media helpers replace debounce timers and dispatch grouped messages", () => {
  const groups = new Map<
    string,
    TelegramMediaGroupState<{
      message_id: number;
      chat: { id: number };
      media_group_id?: string;
    }>
  >();
  const cleared: number[] = [];
  const callbacks: Array<() => void> = [];
  const dispatched: number[][] = [];
  let nextTimer = 1;
  const setTimer = (callback: () => void): ReturnType<typeof setTimeout> => {
    callbacks.push(callback);
    return nextTimer++ as unknown as ReturnType<typeof setTimeout>;
  };
  const clearTimer = (timer: ReturnType<typeof setTimeout>): void => {
    cleared.push(timer as unknown as number);
  };
  assert.equal(
    queueTelegramMediaGroupMessage({
      message: { message_id: 1, chat: { id: 7 }, media_group_id: "album" },
      groups,
      debounceMs: 100,
      setTimer,
      clearTimer,
      dispatchMessages: (messages) =>
        dispatched.push(messages.map((message) => message.message_id)),
    }),
    true,
  );
  queueTelegramMediaGroupMessage({
    message: { message_id: 2, chat: { id: 7 }, media_group_id: "album" },
    groups,
    debounceMs: 100,
    setTimer,
    clearTimer,
    dispatchMessages: (messages) =>
      dispatched.push(messages.map((message) => message.message_id)),
  });
  assert.deepEqual(cleared, [1]);
  callbacks.at(-1)?.();
  assert.deepEqual(dispatched, [[1, 2]]);
  assert.equal(groups.size, 0);
});

test("Media helpers remove pending groups by message id", () => {
  const groups = new Map<
    string,
    TelegramMediaGroupState<{ message_id: number; chat: { id: number } }>
  >();
  groups.set("7:album", {
    messages: [
      { message_id: 1, chat: { id: 7 } },
      { message_id: 2, chat: { id: 7 } },
    ],
    flushTimer: 10 as unknown as ReturnType<typeof setTimeout>,
  });
  const cleared: number[] = [];
  assert.equal(
    removePendingTelegramMediaGroupMessages(groups, [2], (timer) => {
      cleared.push(timer as unknown as number);
    }),
    1,
  );
  assert.deepEqual(cleared, [10]);
  assert.equal(groups.size, 0);
});
