/**
 * Regression tests for Telegram reply delivery helpers
 * Covers UI/compat rendered-message transport, chunk delivery, and native/plain final reply sending
 */

import assert from "node:assert/strict";
import test from "node:test";

// Transport-level dedup is module-global; reset between tests.
test.beforeEach(() => {
  resetTransportReplyDedup();
});

import {
  buildTelegramReplyParameters,
  buildTelegramReplyTransport,
  createGuestMarkdownReplySender,
  createReplyDedupRuntime,
  createTelegramRenderedMessageDeliveryRuntime,
  createTelegramRenderedMessageRuntime,
  dedupSendTextReply,
  editTelegramRenderedMessage,
  extractLatestAssistantMessageText,
  getAgentMessageText,
  isAssistantAgentMessage,
  normalizeTelegramNativeMarkdown,
  resetTransportReplyDedup,
  sendTelegramNativeMarkdownReply,
  sendTelegramPlainReply,
  sendTelegramRenderedChunks,
  splitTelegramNativeMarkdown,
  TELEGRAM_RICH_MESSAGE_MAX_BLOCKS,
  TELEGRAM_RICH_MESSAGE_MAX_CHARS,
} from "../lib/replies.ts";
import { createDedupAgentStartHook } from "../lib/lifecycle.ts";

test("Reply helpers extract assistant message text and metadata", () => {
  const messages = [
    { role: "user", content: [{ type: "text", text: "question" }] },
    {
      role: "assistant",
      stopReason: "error",
      errorMessage: "boom",
      content: [
        { type: "text", text: " hello " },
        { type: "image", source: "ignored" },
        { type: "text", text: "world " },
      ],
    },
  ];
  assert.equal(isAssistantAgentMessage(messages[1]), true);
  assert.equal(getAgentMessageText(messages[1]), "hello world");
  assert.deepEqual(extractLatestAssistantMessageText(messages), {
    text: "hello world",
    stopReason: "error",
    errorMessage: "boom",
  });
});

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
    },
  );
  assert.equal(messageId, 2);
  assert.deepEqual(sentBodies, [
    { chat_id: 7, text: "one", parse_mode: undefined, reply_markup: undefined },
    {
      chat_id: 7,
      text: "two",
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[{ text: "ok", callback_data: "noop" }]],
      },
    },
  ]);
});

test("Reply delivery rejects generated buttons above Telegram callback limit", async () => {
  const sentBodies: Array<Record<string, unknown>> = [];
  await assert.rejects(
    () =>
      sendTelegramRenderedChunks(
        7,
        [{ text: "one" }],
        {
          sendMessage: async (body) => {
            sentBodies.push(body);
            return { message_id: sentBodies.length };
          },
          editMessage: async () => {},
        },
        {
          replyMarkup: {
            inline_keyboard: [[{ text: "Too long", callback_data: "x".repeat(65) }]],
          },
        },
      ),
    /exceeds 64 bytes/,
  );
  assert.deepEqual(sentBodies, []);
});

test("Reply delivery applies reply parameters only to the first chunk", async () => {
  const sentBodies: Array<Record<string, unknown>> = [];
  await sendTelegramRenderedChunks(
    7,
    [{ text: "one" }, { text: "two" }],
    {
      sendMessage: async (body) => {
        sentBodies.push(body);
        return { message_id: sentBodies.length };
      },
      editMessage: async () => {},
    },
    { replyToMessageId: 42 },
  );
  assert.deepEqual(sentBodies[0]?.reply_parameters, {
    message_id: 42,
    allow_sending_without_reply: true,
  });
  assert.equal("reply_parameters" in (sentBodies[1] ?? {}), false);
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
    },
  ]);
  assert.equal("reply_parameters" in (sentBodies[0] ?? {}), false);
});

test("Reply runtime bundles text, native markdown, and UI/compat interactive delivery", async () => {
  const sent: Array<Record<string, unknown>> = [];
  const richSent: Array<Record<string, unknown>> = [];
  const edited: Array<Record<string, unknown>> = [];
  const runtime = createTelegramRenderedMessageRuntime({
    renderTelegramMessage: (text, options) => [
      { text: `${options?.mode ?? "plain"}:${text}` },
    ],
    replyTransport: buildTelegramReplyTransport({
      sendMessage: async (body) => {
        sent.push(body);
        return { message_id: sent.length };
      },
      editMessage: async (body) => {
        edited.push(body);
      },
    }),
    sendRichMessage: async (body) => {
      richSent.push(body);
      return { message_id: 77 };
    },
  });
  assert.equal(await runtime.sendTextReply(7, 42, "hello"), 1);
  assert.equal(await runtime.sendMarkdownReply(7, 43, "**hello**"), 77);
  assert.equal(
    await runtime.sendInteractiveMessage(7, "menu", "html", {
      inline_keyboard: [],
    }),
    2,
  );
  await runtime.editInteractiveMessage(7, 9, "menu", "html", {
    inline_keyboard: [],
  });
  assert.deepEqual(
    sent.map((body) => body.text),
    ["plain:hello", "html:menu"],
  );
  assert.deepEqual(richSent, [
    {
      chat_id: 7,
      rich_message: { markdown: "**hello**", skip_entity_detection: true },
      reply_markup: undefined,
      reply_parameters: {
        message_id: 43,
        allow_sending_without_reply: true,
      },
    },
  ]);
  assert.deepEqual(sent[0]?.reply_parameters, {
    message_id: 42,
    allow_sending_without_reply: true,
  });
  assert.deepEqual(sent[1]?.reply_markup, { inline_keyboard: [] });
  assert.deepEqual(
    edited.map((body) => body.text),
    ["html:menu"],
  );
});

test("Reply runtime can send markdown through native rich messages", async () => {
  const richBodies: Array<Record<string, unknown>> = [];
  const sentBodies: Array<Record<string, unknown>> = [];
  const runtime = createTelegramRenderedMessageRuntime({
    renderTelegramMessage: (text, options) => [
      { text: `${options?.mode ?? "plain"}:${text}` },
    ],
    replyTransport: buildTelegramReplyTransport({
      sendMessage: async (body) => {
        sentBodies.push(body);
        return { message_id: sentBodies.length };
      },
      editMessage: async () => {},
    }),
    sendRichMessage: async (body) => {
      richBodies.push(body);
      return { message_id: 77 };
    },
  });
  assert.equal(await runtime.sendMarkdownReply(7, 43, "# hello", {
    replyMarkup: { inline_keyboard: [[{ text: "ok", callback_data: "noop" }]] },
  }), 77);
  assert.deepEqual(richBodies, [
    {
      chat_id: 7,
      rich_message: { markdown: "# hello", skip_entity_detection: true },
      reply_markup: {
        inline_keyboard: [[{ text: "ok", callback_data: "noop" }]],
      },
      reply_parameters: {
        message_id: 43,
        allow_sending_without_reply: true,
      },
    },
  ]);
  assert.deepEqual(sentBodies, []);
});

test("Reply runtime does not fall back to HTML when native rich message delivery fails", async () => {
  const sentBodies: Array<Record<string, unknown>> = [];
  const runtime = createTelegramRenderedMessageRuntime({
    renderTelegramMessage: (text, options) => [
      { text: `${options?.mode ?? "plain"}:${text}`, parseMode: "HTML" },
    ],
    replyTransport: buildTelegramReplyTransport({
      sendMessage: async (body) => {
        sentBodies.push(body);
        return { message_id: sentBodies.length };
      },
      editMessage: async () => {},
    }),
    sendRichMessage: async () => {
      throw new Error("rich unsupported");
    },
  });
  await assert.rejects(() => runtime.sendMarkdownReply(7, 43, "# hello"), {
    message: "rich unsupported",
  });
  assert.deepEqual(sentBodies, []);
});

test("Reply delivery runtime exposes transport and UI/compat rendered-message helpers", async () => {
  const sent: Array<Record<string, unknown>> = [];
  const runtime = createTelegramRenderedMessageDeliveryRuntime({
    renderTelegramMessage: (text, options) => [
      { text: `${options?.mode ?? "plain"}:${text}` },
    ],
    sendMessage: async (body) => {
      sent.push(body);
      return { message_id: sent.length };
    },
    editMessage: async () => {},
    sendRichMessage: async () => ({ message_id: 99 }),
  });
  assert.equal(await runtime.sendTextReply(7, 42, "hello"), 1);
  assert.equal(
    await runtime.replyTransport.sendRenderedChunks(7, [{ text: "raw" }]),
    2,
  );
  assert.deepEqual(
    sent.map((body) => body.text),
    ["plain:hello", "raw"],
  );
});

test("Guest replies answer with native Rich Markdown content", async () => {
  const calls: Array<{
    guestQueryId: string;
    text?: string;
    options?: { richMessage?: { markdown?: string; skip_entity_detection?: boolean } };
  }> = [];
  const sendGuestReply = createGuestMarkdownReplySender({
    answerGuestQuery: async (guestQueryId, text, options) => {
      calls.push({ guestQueryId, text, options });
    },
  });
  await sendGuestReply("guest-1", "**hello** /start");
  assert.deepEqual(calls, [
    {
      guestQueryId: "guest-1",
      text: undefined,
      options: {
        richMessage: { markdown: "**hello** /start", skip_entity_detection: true },
      },
    },
  ]);
});

test("Native Markdown delivery normalizes space-after-marker blockquotes outside code", () => {
  const markdown = "> quoted\n\n```md\n> quoted code\n```";
  assert.equal(
    normalizeTelegramNativeMarkdown(markdown),
    ">quoted\n\n```md\n> quoted code\n```",
  );
});

test("Native Markdown delivery escapes dollar ticker atoms outside code", () => {
  const markdown = [
    "Токен $BLDR может ломать math parsing.",
    "Bold ticker **$BTC** тоже ломает rich parsing.",
    "Токен $NTVE, $VETO. и $NTVE/Bucket тоже опасны.",
    "Inline code: `$BLDR`, formula $x^2 + y^2$, and explicit math $BTC$ stay unchanged.",
    "```md",
    "$BLDR in code fence",
    "```",
  ].join("\n");
  assert.equal(
    normalizeTelegramNativeMarkdown(markdown),
    [
      "Токен \\$BLDR может ломать math parsing.",
      "Bold ticker **\\$BTC** тоже ломает rich parsing.",
      "Токен \\$NTVE, \\$VETO. и \\$NTVE/Bucket тоже опасны.",
      "Inline code: `$BLDR`, formula $x^2 + y^2$, and explicit math $BTC$ stay unchanged.",
      "```md",
      "$BLDR in code fence",
      "```",
    ].join("\n"),
  );
});

test("Native Markdown splitter prefers paragraph boundaries", () => {
  const first = "a".repeat(TELEGRAM_RICH_MESSAGE_MAX_CHARS - 10);
  const second = "b".repeat(30);
  const chunks = splitTelegramNativeMarkdown(`${first}\n\n${second}`);
  assert.deepEqual(chunks, [first, second]);
  assert.ok(chunks.every((chunk) => chunk.length <= TELEGRAM_RICH_MESSAGE_MAX_CHARS));
});

test("Native Markdown splitter falls back to hard limits for long atoms", () => {
  const chunks = splitTelegramNativeMarkdown("x".repeat(TELEGRAM_RICH_MESSAGE_MAX_CHARS + 5));
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0]?.length, TELEGRAM_RICH_MESSAGE_MAX_CHARS);
  assert.equal(chunks[1], "xxxxx");
});

test("Native Markdown splitter keeps fenced code blocks together when possible", () => {
  const codeBlock = `\`\`\`ts\n${"x\n\n".repeat(100)}\`\`\``;
  const prefix = "a".repeat(TELEGRAM_RICH_MESSAGE_MAX_CHARS - codeBlock.length);
  const chunks = splitTelegramNativeMarkdown(`${prefix}\n\n${codeBlock}\n\ntail`);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[1], `${codeBlock}\n\ntail`);
});

test("Native Markdown splitter respects the rich-message block limit for lists", () => {
  const markdown = Array.from(
    { length: TELEGRAM_RICH_MESSAGE_MAX_BLOCKS + 5 },
    (_, index) => `- item ${index + 1}`,
  ).join("\n");
  const chunks = splitTelegramNativeMarkdown(markdown);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0]?.split("\n").length, TELEGRAM_RICH_MESSAGE_MAX_BLOCKS);
  assert.equal(chunks[1]?.split("\n").length, 5);
});

 test("Native Markdown delivery attaches reply metadata first and markup last", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const markdown = `${"a".repeat(TELEGRAM_RICH_MESSAGE_MAX_CHARS - 10)}\n\n${"b".repeat(30)}`;
  const lastId = await sendTelegramNativeMarkdownReply(
    7,
    42,
    markdown,
    {
      sendRichMessage: async (body) => {
        bodies.push(body);
        return { message_id: bodies.length };
      },
    },
    { replyMarkup: { inline_keyboard: [[{ text: "ok", callback_data: "noop" }]] } },
  );
  assert.equal(lastId, 2);
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[0]?.reply_parameters, {
    message_id: 42,
    allow_sending_without_reply: true,
  });
  assert.equal("reply_markup" in (bodies[0] ?? {}), true);
  assert.equal(bodies[0]?.reply_markup, undefined);
  assert.equal("reply_parameters" in (bodies[1] ?? {}), false);
  assert.deepEqual(bodies[1]?.reply_markup, {
    inline_keyboard: [[{ text: "ok", callback_data: "noop" }]],
  });
  assert.deepEqual((bodies[0]?.rich_message as { markdown?: string })?.markdown, "a".repeat(TELEGRAM_RICH_MESSAGE_MAX_CHARS - 10));
  assert.deepEqual((bodies[1]?.rich_message as { markdown?: string })?.markdown, "b".repeat(30));
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

test("Transport reply dedup scopes repeated prompt message ids by chat", () => {
  assert.deepEqual(buildTelegramReplyParameters(1, 42), {
    message_id: 42,
    allow_sending_without_reply: true,
  });
  assert.equal(buildTelegramReplyParameters(1, 42), undefined);
  assert.deepEqual(buildTelegramReplyParameters(2, 42), {
    message_id: 42,
    allow_sending_without_reply: true,
  });
  resetTransportReplyDedup();
  assert.deepEqual(buildTelegramReplyParameters(1, 42), {
    message_id: 42,
    allow_sending_without_reply: true,
  });
});

test("Reply dedup tracks first reply per prompt message id and resets", () => {
  const dedup = createReplyDedupRuntime();
  assert.equal(dedup.shouldReply(42), true);
  assert.equal(dedup.shouldReply(42), false);
  assert.equal(dedup.shouldReply(99), true);
  dedup.reset();
  assert.equal(dedup.shouldReply(42), true);
});

test("Dedup wrapper suppresses reply_to_message_id after the first message in a turn", async () => {
  const dedup = createReplyDedupRuntime();
  const passedReplyIds: Array<number | undefined> = [];
  const inner = async (
    _chatId: number,
    replyToMessageId: number | undefined,
  ) => {
    passedReplyIds.push(replyToMessageId);
    return 1;
  };
  const wrapped = dedupSendTextReply(dedup, inner);
  await wrapped(7, 42, "first");
  await wrapped(7, 42, "second");
  await wrapped(7, 99, "other");
  assert.deepEqual(passedReplyIds, [42, undefined, 99]);
});

test("Dedup reset fires on agent_start through lifecycle hook", async () => {
  const dedup = createReplyDedupRuntime();
  dedup.shouldReply(42); // marks replied
  let agentStartCalled = false;
  const hook = createDedupAgentStartHook(dedup, async () => {
    agentStartCalled = true;
  });
  await hook(
    {} as Parameters<typeof hook>[0],
    {} as Parameters<typeof hook>[1],
  );
  assert.equal(agentStartCalled, true);
  assert.equal(
    dedup.shouldReply(42),
    true,
    "reset clears previous reply state",
  );
});
