/**
 * Regression tests for the Telegram turn-building domain
 * Covers queue-summary formatting, prompt construction, and prompt-turn assembly from messages and downloaded files
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTelegramPromptTurn,
  buildTelegramTurnPrompt,
  formatTelegramTurnStatusSummary,
  truncateTelegramQueueSummary,
  updateTelegramPromptTurnText,
} from "../lib/turns.ts";

test("Turn helpers truncate queue summaries predictably", () => {
  assert.equal(
    truncateTelegramQueueSummary("one two three four"),
    "one two three four",
  );
  assert.equal(
    truncateTelegramQueueSummary("one two three four five six"),
    "one two three four five…",
  );
  assert.equal(truncateTelegramQueueSummary("   "), "");
});

test("Turn helpers build prompt text with history and attachments", () => {
  const prompt = buildTelegramTurnPrompt({
    telegramPrefix: "[telegram]",
    rawText: "current message",
    files: [{ path: "/tmp/demo.png", fileName: "demo.png", isImage: true }],
    historyTurns: [{ historyText: "older message" }],
  });
  assert.match(prompt, /^\[telegram\]/);
  assert.match(
    prompt,
    /Earlier Telegram messages arrived after an aborted turn/,
  );
  assert.match(prompt, /1\. older message/);
  assert.match(prompt, /Current Telegram message:\ncurrent message/);
  assert.match(
    prompt,
    /Telegram attachments were saved locally:\n- \/tmp\/demo.png/,
  );
});

test("Turn helpers summarize text and attachment-only turns", () => {
  assert.equal(
    formatTelegramTurnStatusSummary("hello there from telegram", []),
    "hello there from telegram",
  );
  assert.equal(
    formatTelegramTurnStatusSummary("", [
      {
        path: "/tmp/report-final-version.txt",
        fileName: "report-final-version.txt",
        isImage: false,
      },
    ]),
    "📎 report-final-version.txt",
  );
  assert.equal(
    formatTelegramTurnStatusSummary("", [
      { path: "/tmp/a.txt", fileName: "a.txt", isImage: false },
      { path: "/tmp/b.txt", fileName: "b.txt", isImage: false },
    ]),
    "📎 2 attachments",
  );
});

test("Turn helpers update queued prompt text for edited Telegram messages", () => {
  const turn = {
    kind: "prompt" as const,
    chatId: 99,
    replyToMessageId: 10,
    sourceMessageIds: [10],
    queueOrder: 1,
    queueLane: "default" as const,
    laneOrder: 1,
    queuedAttachments: [],
    content: [{ type: "text" as const, text: "[telegram] old" }],
    historyText: "old",
    statusSummary: "old",
  };
  const updated = updateTelegramPromptTurnText({
    turn,
    telegramPrefix: "[telegram]",
    rawText: "new edited message",
  });
  assert.equal(updated.content[0]?.type, "text");
  assert.equal(
    (updated.content[0] as { type: "text"; text: string }).text,
    "[telegram] new edited message",
  );
  assert.equal(updated.historyText, "new edited message");
  assert.equal(updated.statusSummary, "new edited message");
  assert.notEqual(updated, turn);
});

test("Turn helpers preserve queued prompt attachments when captions are edited", () => {
  const turn = {
    kind: "prompt" as const,
    chatId: 99,
    replyToMessageId: 10,
    sourceMessageIds: [10],
    queueOrder: 1,
    queueLane: "default" as const,
    laneOrder: 1,
    queuedAttachments: [],
    content: [
      {
        type: "text" as const,
        text:
          "[telegram] old caption\n\n" +
          "Telegram attachments were saved locally:\n" +
          "- /tmp/demo.png\n" +
          "- /tmp/report.txt",
      },
      { type: "image" as const, data: "abc", mimeType: "image/png" },
    ],
    historyText: "old caption\nAttachments:\n- /tmp/demo.png\n- /tmp/report.txt",
    statusSummary: "old caption",
  };
  const updated = updateTelegramPromptTurnText({
    turn,
    telegramPrefix: "[telegram]",
    rawText: "new caption",
  });
  assert.equal(
    (updated.content[0] as { type: "text"; text: string }).text,
    "[telegram] new caption\n\n" +
      "Telegram attachments were saved locally:\n" +
      "- /tmp/demo.png\n" +
      "- /tmp/report.txt",
  );
  assert.deepEqual(updated.content[1], turn.content[1]);
  assert.equal(
    updated.historyText,
    "new caption\nAttachments:\n- /tmp/demo.png\n- /tmp/report.txt",
  );
  assert.equal(updated.statusSummary, "new caption");
});

test("Turn helpers preserve abort-history prompt context when queued turns are edited", () => {
  const turn = {
    kind: "prompt" as const,
    chatId: 99,
    replyToMessageId: 10,
    sourceMessageIds: [10],
    queueOrder: 1,
    queueLane: "default" as const,
    laneOrder: 1,
    queuedAttachments: [],
    content: [
      {
        type: "text" as const,
        text:
          "[telegram]\n\n" +
          "Earlier Telegram messages arrived after an aborted turn. " +
          "Treat them as prior user messages, in order:\n\n" +
          "1. older Current Telegram message: quote\n\n" +
          "Current Telegram message:\nold current",
      },
    ],
    historyText: "old current",
    statusSummary: "old current",
  };
  const updated = updateTelegramPromptTurnText({
    turn,
    telegramPrefix: "[telegram]",
    rawText: "new current",
  });
  assert.equal(
    (updated.content[0] as { type: "text"; text: string }).text,
    "[telegram]\n\n" +
      "Earlier Telegram messages arrived after an aborted turn. " +
      "Treat them as prior user messages, in order:\n\n" +
      "1. older Current Telegram message: quote\n\n" +
      "Current Telegram message:\nnew current",
  );
  assert.equal(updated.historyText, "new current");
  assert.equal(updated.statusSummary, "new current");
});

test("Turn helpers assemble prompt turns with text, ids, history, and image payloads", async () => {
  const turn = await buildTelegramPromptTurn({
    telegramPrefix: "[telegram]",
    messages: [
      { message_id: 10, chat: { id: 99 } },
      { message_id: 11, chat: { id: 99 } },
    ],
    historyTurns: [
      {
        kind: "prompt",
        chatId: 99,
        replyToMessageId: 1,
        sourceMessageIds: [1],
        queueOrder: 1,
        queueLane: "default",
        laneOrder: 1,
        queuedAttachments: [],
        content: [{ type: "text", text: "ignored" }],
        historyText: "older message",
        statusSummary: "older",
      },
    ],
    queueOrder: 7,
    rawText: "current message",
    files: [
      {
        path: "/tmp/demo.png",
        fileName: "demo.png",
        isImage: true,
        mimeType: "image/png",
      },
      {
        path: "/tmp/report.txt",
        fileName: "report.txt",
        isImage: false,
      },
    ],
    readBinaryFile: async () => new Uint8Array([1, 2, 3]),
    inferImageMimeType: () => undefined,
  });
  assert.equal(turn.chatId, 99);
  assert.equal(turn.replyToMessageId, 10);
  assert.deepEqual(turn.sourceMessageIds, [10, 11]);
  assert.equal(turn.queueOrder, 7);
  assert.equal(turn.statusSummary, "current message");
  assert.equal(
    turn.historyText,
    "current message\nAttachments:\n- /tmp/demo.png\n- /tmp/report.txt",
  );
  assert.equal(turn.content.length, 2);
  assert.equal(turn.content[0]?.type, "text");
  assert.match(
    (turn.content[0] as { type: "text"; text: string }).text,
    /Earlier Telegram messages arrived after an aborted turn/,
  );
  assert.deepEqual(turn.content[1], {
    type: "image",
    data: Buffer.from([1, 2, 3]).toString("base64"),
    mimeType: "image/png",
  });
});
