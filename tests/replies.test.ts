/**
 * Regression tests for Telegram reply delivery helpers
 * Covers rendered-message transport, chunk delivery, and plain or markdown final reply sending
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTelegramReplyTransport,
  editTelegramRenderedMessage,
  sendTelegramMarkdownReply,
  sendTelegramPlainReply,
  sendTelegramRenderedChunks,
} from "../lib/replies.ts";

test("Reply transport forwards send and edit operations through delivery helpers", async () => {
  const events: string[] = [];
  const transport = buildTelegramReplyTransport({
    sendMessage: async (body) => {
      events.push(`send:${body.chat_id}:${body.text}`);
      return { message_id: 5 };
    },
    editMessage: async (body) => {
      events.push(`edit:${body.chat_id}:${body.message_id}:${body.text}`);
    },
  });
  assert.equal(await transport.sendRenderedChunks(7, [{ text: "one" }]), 5);
  assert.equal(await transport.editRenderedMessage(7, 9, [{ text: "two" }]), 9);
  assert.deepEqual(events, ["send:7:one", "edit:7:9:two"]);
});

test("Reply delivery sends chunks and applies reply markup only to the last chunk", async () => {
  const sentBodies: Array<Record<string, unknown>> = [];
  const messageId = await sendTelegramRenderedChunks(
    7,
    [{ text: "one" }, { text: "two", parseMode: "HTML" }],
    {
      sendMessage: async (body) => {
        sentBodies.push(body);
        return { message_id: sentBodies.length };
      },
      editMessage: async () => {},
    },
    {
      replyMarkup: {
        inline_keyboard: [[{ text: "ok", callback_data: "noop" }]],
      },
      replyToMessageId: 42,
    },
  );
  assert.equal(messageId, 2);
  assert.deepEqual(sentBodies, [
    {
      chat_id: 7,
      text: "one",
      parse_mode: undefined,
      reply_markup: undefined,
      reply_to_message_id: 42,
    },
    {
      chat_id: 7,
      text: "two",
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[{ text: "ok", callback_data: "noop" }]],
      },
      reply_to_message_id: undefined,
    },
  ]);
});

test("Reply delivery edits the first chunk and sends remaining chunks separately", async () => {
  const editedBodies: Array<Record<string, unknown>> = [];
  const sentBodies: Array<Record<string, unknown>> = [];
  const result = await editTelegramRenderedMessage(
    7,
    99,
    [{ text: "first", parseMode: "HTML" }, { text: "second" }],
    {
      sendMessage: async (body) => {
        sentBodies.push(body);
        return { message_id: 123 };
      },
      editMessage: async (body) => {
        editedBodies.push(body);
      },
    },
    {
      replyMarkup: {
        inline_keyboard: [[{ text: "ok", callback_data: "noop" }]],
      },
      replyToMessageId: 42,
    },
  );
  assert.equal(result, 123);
  assert.deepEqual(editedBodies, [
    {
      chat_id: 7,
      message_id: 99,
      text: "first",
      parse_mode: "HTML",
      reply_markup: undefined,
    },
  ]);
  assert.deepEqual(sentBodies, [
    {
      chat_id: 7,
      text: "second",
      parse_mode: undefined,
      reply_markup: {
        inline_keyboard: [[{ text: "ok", callback_data: "noop" }]],
      },
      reply_to_message_id: 42,
    },
  ]);
});

test("Reply runtime sends plain replies using the requested parse mode", async () => {
  const sent: string[] = [];
  const messageId = await sendTelegramPlainReply(
    "hello",
    {
      renderTelegramMessage: (_text, options) => [
        { text: options?.mode === "html" ? "html" : "plain" },
      ],
      sendRenderedChunks: async (chunks) => {
        sent.push(chunks[0]?.text ?? "");
        return 7;
      },
    },
    { parseMode: "HTML" },
  );
  assert.equal(messageId, 7);
  assert.deepEqual(sent, ["html"]);
});

test("Reply runtime falls back to plain delivery when markdown rendering yields no chunks", async () => {
  const calls: Array<string> = [];
  const messageId = await sendTelegramMarkdownReply("hello", {
    renderTelegramMessage: (_text, options) => {
      if (options?.mode === "markdown") return [];
      return [{ text: options?.mode ?? "plain" }];
    },
    sendRenderedChunks: async (chunks) => {
      calls.push(chunks[0]?.text ?? "");
      return 9;
    },
  });
  assert.equal(messageId, 9);
  assert.deepEqual(calls, ["plain"]);
});
