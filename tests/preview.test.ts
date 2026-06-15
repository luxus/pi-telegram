/**
 * Regression tests for the Telegram preview domain
 * Covers preview snapshot decisions, transport selection, runtime flushing, and finalization behavior
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  allocateTelegramDraftId,
  buildTelegramPreviewFinalText,
  clearTelegramPreview,
  createTelegramAssistantMessagePreviewHooks,
  createTelegramAssistantPreviewRuntime,
  createTelegramNativeMarkdownMessageEditor,
  createTelegramNativeMarkdownPreviewFinalizer,
  createTelegramPreviewController,
  createTelegramPreviewControllerRuntime,
  createTelegramPreviewMessageTransport,
  createTelegramPreviewRuntimeState,
  finalizeTelegramPreview,
  flushTelegramPreview,
  handleTelegramAssistantMessagePreviewStart,
  handleTelegramAssistantMessagePreviewUpdate,
  shouldUseTelegramDraftPreview,
} from "../lib/preview.ts";

function createPreviewRuntimeHarness(state?: {
  mode: "draft" | "message";
  draftId?: number;
  messageId?: number;
  pendingText: string;
  lastSentText: string;
  lastSentParseMode?: "HTML";
  flushTimer?: ReturnType<typeof setTimeout>;
}) {
  let previewState = state;
  let draftSupport: "unknown" | "supported" | "unsupported" = "unknown";
  let nextDraftId = 10;
  const events: string[] = [];
  return {
    events,
    getState: () => previewState,
    getDraftSupport: () => draftSupport,
    setDraftSupport: (support: "unknown" | "supported" | "unsupported") => {
      draftSupport = support;
    },
    deps: {
      getState: () => previewState,
      setState: (nextState: typeof previewState) => {
        previewState = nextState;
      },
      clearScheduledFlush: (nextState: NonNullable<typeof previewState>) => {
        if (!nextState.flushTimer) return;
        clearTimeout(nextState.flushTimer);
        nextState.flushTimer = undefined;
        events.push("clear-timer");
      },
      maxMessageLength: 50,
      getDraftSupport: () => draftSupport,
      setDraftSupport: (support: "unknown" | "supported" | "unsupported") => {
        draftSupport = support;
      },
      allocateDraftId: () => nextDraftId++,
      sendDraft: async (chatId: number, draftId: number, text?: string) => {
        events.push(`draft:${chatId}:${draftId}:${text}`);
      },
      sendMessage: async (
        chatId: number,
        text: string,
        options?: { parseMode?: "HTML" },
      ) => {
        events.push(`send:${chatId}:${text}:${options?.parseMode ?? "plain"}`);
        return { message_id: 77 };
      },
      editMessageText: async (
        chatId: number,
        messageId: number,
        text: string,
        options?: { parseMode?: "HTML" },
      ) => {
        events.push(
          `edit:${chatId}:${messageId}:${text}:${options?.parseMode ?? "plain"}`,
        );
      },
      canSend: undefined as undefined | (() => boolean),
      recordRuntimeEvent: (
        category: string,
        _error: unknown,
        details?: Record<string, unknown>,
      ) => {
        events.push(`${category}:${details?.phase}`);
      },
    },
  };
}

test("Preview helpers create state and allocate draft ids", () => {
  assert.deepEqual(createTelegramPreviewRuntimeState("unknown"), {
    mode: "draft",
    pendingText: "",
    lastSentText: "",
  });
  assert.equal(
    createTelegramPreviewRuntimeState("unsupported").mode,
    "message",
  );
  assert.equal(allocateTelegramDraftId(0, 2), 1);
  assert.equal(allocateTelegramDraftId(1, 2), 2);
  assert.equal(allocateTelegramDraftId(2, 2), 1);
});

test("Preview helpers compute final text fallback without reusing HTML snapshots", () => {
  assert.equal(
    buildTelegramPreviewFinalText({
      mode: "message",
      pendingText: "   ",
      lastSentText: "saved",
    }),
    "saved",
  );
  assert.equal(
    buildTelegramPreviewFinalText({
      mode: "message",
      pendingText: "   ",
      lastSentText: "<b>saved</b>",
      lastSentParseMode: "HTML",
    }),
    undefined,
  );
  assert.equal(
    buildTelegramPreviewFinalText({
      mode: "message",
      pendingText: "   ",
      lastSentText: "   ",
    }),
    undefined,
  );
});

test("Preview helpers use drafts for native Markdown snapshots", () => {
  assert.equal(
    shouldUseTelegramDraftPreview({ draftSupport: "unknown" }),
    true,
  );
  assert.equal(
    shouldUseTelegramDraftPreview({
      draftSupport: "supported",
      snapshot: { text: "preview", sourceText: "preview" },
    }),
    true,
  );
  assert.equal(
    shouldUseTelegramDraftPreview({ draftSupport: "unsupported" }),
    false,
  );
});

test("Preview message transport adapts Bot API bodies and reply metadata", async () => {
  const calls: unknown[] = [];
  const transport = createTelegramPreviewMessageTransport({
    sendMessage: async (body) => {
      calls.push(body);
      return { message_id: 3 };
    },
    editMessageText: async (body) => {
      calls.push(body);
      return "edited";
    },
    buildReplyParameters: (_chatId, messageId) =>
      messageId === undefined
        ? undefined
        : { message_id: messageId, allow_sending_without_reply: true },
  });
  assert.deepEqual(
    await transport.sendMessage(7, "hello", { parseMode: "HTML" }, 9),
    { message_id: 3 },
  );
  await transport.editMessageText(7, 3, "next", { parseMode: "HTML" });
  assert.deepEqual(calls, [
    {
      chat_id: 7,
      text: "hello",
      parse_mode: "HTML",
      reply_parameters: { message_id: 9, allow_sending_without_reply: true },
    },
    { chat_id: 7, message_id: 3, text: "next", parse_mode: "HTML" },
  ]);
  const defaultCalls: unknown[] = [];
  const defaultTransport = createTelegramPreviewMessageTransport({
    sendMessage: async (body) => {
      defaultCalls.push(body);
      return { message_id: 4 };
    },
    editMessageText: async () => undefined,
  });
  await defaultTransport.sendMessage(7, "default", undefined, 10);
  assert.deepEqual(defaultCalls, [
    {
      chat_id: 7,
      text: "default",
      parse_mode: undefined,
      reply_parameters: { message_id: 10, allow_sending_without_reply: true },
    },
  ]);
});

test("Native Markdown message editor normalizes rich markdown", async () => {
  const calls: unknown[] = [];
  const editMarkdown = createTelegramNativeMarkdownMessageEditor({
    editMessageText: async (body) => {
      calls.push(body);
      return "edited";
    },
  });
  await editMarkdown(7, 55, "> quoted\n\n**$BTC**");
  assert.deepEqual(calls, [
    {
      chat_id: 7,
      message_id: 55,
      rich_message: {
        markdown: ">quoted\n\n**\\$BTC**",
        skip_entity_detection: true,
      },
    },
  ]);
});

test("Assistant preview runtime binds controller and message hooks", async () => {
  const events: string[] = [];
  let activeTurn: { chatId: number } | undefined = { chatId: 7 };
  const runtime = createTelegramAssistantPreviewRuntime<{
    role: string;
    text?: string;
  }>({
    getActiveTurn: () => activeTurn,
    isAssistantMessage: (message) => message.role === "assistant",
    getMessageText: (message) => message.text ?? "",
    maxMessageLength: 100,
    sendDraft: async () => {
      events.push("draft");
    },
    sendMessage: async () => ({ message_id: 22 }),
    editMessageText: async () => {},
    buildReplyParameters: () => undefined,
    sendMarkdownReply: async () => undefined,
  });
  await runtime.onMessageStart({ message: { role: "assistant" } });
  await runtime.onMessageUpdate({
    message: { role: "assistant", text: "hello" },
  });
  assert.equal(runtime.getState()?.pendingText, "hello");
  await runtime.onMessageUpdate({
    message: {
      role: "assistant",
      text: "hello\n\n<!-- telegram_voice\nhidden streaming voice",
    },
  });
  assert.equal(runtime.getState()?.pendingText, "hello");
  activeTurn = undefined;
  await runtime.onMessageUpdate({
    message: { role: "assistant", text: "ignored" },
  });
  assert.equal(runtime.getState()?.pendingText, "hello");
  assert.deepEqual(events, ["draft"]);
});

test("Assistant preview runtime finalizes previous markdown through native reply sender", async () => {
  const events: string[] = [];
  const runtime = createTelegramAssistantPreviewRuntime<{
    role: string;
    text?: string;
  }>({
    getActiveTurn: () => ({ chatId: 7 }),
    isAssistantMessage: (message) => message.role === "assistant",
    getMessageText: (message) => message.text ?? "",
    maxMessageLength: 100,
    sendDraft: async () => {},
    sendMessage: async () => ({ message_id: 22 }),
    editMessageText: async () => {},
    buildReplyParameters: () => undefined,
    sendMarkdownReply: async (chatId, replyToMessageId, markdown) => {
      events.push(
        `native-final:${chatId}:${replyToMessageId ?? "none"}:${markdown}`,
      );
      return 99;
    },
  });
  runtime.setState({
    mode: "draft",
    pendingText: "**previous**",
    lastSentText: "**previous**",
  });
  await runtime.onMessageStart({ message: { role: "assistant" } });
  assert.deepEqual(events, ["native-final:7:none:**previous**"]);
  assert.equal(runtime.getState()?.pendingText, "");
});

test("Assistant preview runtime edits fallback preview messages with native markdown", async () => {
  const events: string[] = [];
  const runtime = createTelegramAssistantPreviewRuntime<{
    role: string;
    text?: string;
  }>({
    getActiveTurn: () => ({ chatId: 7 }),
    isAssistantMessage: (message) => message.role === "assistant",
    getMessageText: (message) => message.text ?? "",
    maxMessageLength: 100,
    sendDraft: async () => {},
    sendMessage: async () => ({ message_id: 22 }),
    editMessageText: async () => {},
    buildReplyParameters: () => undefined,
    sendMarkdownReply: async () => {
      events.push("unexpected-send");
      return 99;
    },
    editMarkdownMessage: async (chatId, messageId, markdown) => {
      events.push(`native-edit:${chatId}:${messageId}:${markdown}`);
    },
  });
  runtime.setState({
    mode: "message",
    messageId: 55,
    pendingText: "**previous**",
    lastSentText: "**previous**",
  });
  await runtime.onMessageStart({ message: { role: "assistant" } });
  assert.deepEqual(events, ["native-edit:7:55:**previous**"]);
  assert.equal(runtime.getState()?.pendingText, "");
});

test("Assistant preview runtime suppresses text preview for voice-tagged turns", async () => {
  const events: string[] = [];
  const activeTurn = { chatId: 7, voiceReplyPreferred: true };
  const runtime = createTelegramAssistantPreviewRuntime<{
    role: string;
    text?: string;
  }>({
    getActiveTurn: () => activeTurn,
    isAssistantMessage: (message) => message.role === "assistant",
    getMessageText: (message) => message.text ?? "",
    maxMessageLength: 100,
    sendDraft: async () => {
      events.push("draft");
    },
    sendMessage: async () => ({ message_id: 22 }),
    editMessageText: async () => {},
    buildReplyParameters: () => undefined,
    sendMarkdownReply: async () => undefined,
  });
  await runtime.onMessageStart({ message: { role: "assistant" } });
  assert.equal(runtime.getState(), undefined);
  await runtime.onMessageUpdate({
    message: { role: "assistant", text: "hello" },
  });
  assert.equal(runtime.getState(), undefined);
  assert.deepEqual(events, []);
});

test("Assistant preview runtime suppresses text preview for voice-required turns", async () => {
  const events: string[] = [];
  const activeTurn = { chatId: 7, voiceReplyRequired: true };
  const runtime = createTelegramAssistantPreviewRuntime<{
    role: string;
    text?: string;
  }>({
    getActiveTurn: () => activeTurn,
    isAssistantMessage: (message) => message.role === "assistant",
    getMessageText: (message) => message.text ?? "",
    maxMessageLength: 100,
    sendDraft: async () => {
      events.push("draft");
    },
    sendMessage: async () => ({ message_id: 22 }),
    editMessageText: async () => {},
    buildReplyParameters: () => undefined,
    sendMarkdownReply: async () => undefined,
  });
  await runtime.onMessageStart({ message: { role: "assistant" } });
  assert.equal(runtime.getState(), undefined);
  await runtime.onMessageUpdate({
    message: { role: "assistant", text: "hello" },
  });
  assert.equal(runtime.getState(), undefined);
  assert.deepEqual(events, []);
});

test("Preview controller runtime binds Bot API transports", async () => {
  const calls: unknown[] = [];
  const controller = createTelegramPreviewControllerRuntime({
    getDefaultReplyToMessageId: () => 11,
    maxMessageLength: 100,
    sendDraft: async () => {},
    sendMessage: async (body) => {
      calls.push(body);
      return { message_id: 22 };
    },
    editMessageText: async (body) => {
      calls.push(body);
    },
    buildReplyParameters: (_chatId, messageId) =>
      messageId === undefined
        ? undefined
        : { message_id: messageId, allow_sending_without_reply: true },
  });
  controller.setState({
    mode: "draft",
    draftId: 1,
    pendingText: "done",
    lastSentText: "done",
  });
  assert.equal(await controller.finalize(7), true);
  assert.deepEqual(calls, [
    {
      chat_id: 7,
      text: "done",
      parse_mode: undefined,
      reply_parameters: { message_id: 11, allow_sending_without_reply: true },
    },
  ]);
});

test("Preview controller owns pending text mutation and state reset", () => {
  const controller = createTelegramPreviewController({
    maxMessageLength: 50,
    sendDraft: async () => {},
    sendMessage: async () => ({ message_id: 1 }),
    editMessageText: async () => {},
  });
  controller.setPendingText("ignored");
  assert.equal(controller.getState(), undefined);
  controller.setState(controller.createState());
  controller.setPendingText("next markdown");
  assert.equal(controller.getState()?.pendingText, "next markdown");
  controller.resetState();
  assert.equal(controller.getState()?.pendingText, "");
});

test("Preview runtime handles assistant message lifecycle hooks", async () => {
  const events: string[] = [];
  let activeTurn: { chatId: number } | undefined = { chatId: 7 };
  let previewState:
    | {
        mode: "draft" | "message";
        pendingText: string;
        lastSentText: string;
      }
    | undefined = {
    mode: "message",
    pendingText: "previous markdown",
    lastSentText: "",
  };
  const createPreviewState = () => ({
    mode: "message" as const,
    pendingText: "",
    lastSentText: "",
  });
  await handleTelegramAssistantMessagePreviewStart(
    { role: "assistant", text: "new" },
    {
      getActiveTurn: () => activeTurn,
      isAssistantMessage: (message) => message.role === "assistant",
      getState: () => previewState,
      setState: (state) => {
        previewState = state;
        events.push(`set:${state?.pendingText ?? "none"}`);
      },
      createPreviewState,
      finalizePreview: async (chatId) => {
        events.push(`finalize:${chatId}`);
        return true;
      },
      finalizeMarkdownPreview: async (chatId, markdown) => {
        events.push(`markdown:${chatId}:${markdown}`);
        return true;
      },
    },
  );
  await handleTelegramAssistantMessagePreviewUpdate(
    { role: "assistant", text: "hello" },
    {
      getActiveTurn: () => activeTurn,
      isAssistantMessage: (message) => message.role === "assistant",
      getState: () => previewState,
      setState: (state) => {
        previewState = state;
        events.push(`set:${state?.pendingText ?? "none"}`);
      },
      createPreviewState,
      getMessageText: (message) => message.text,
      schedulePreviewFlush: (chatId) => {
        events.push(`flush:${chatId}`);
      },
    },
  );
  activeTurn = undefined;
  await handleTelegramAssistantMessagePreviewUpdate(
    { role: "assistant", text: "ignored" },
    {
      getActiveTurn: () => activeTurn,
      isAssistantMessage: (message) => message.role === "assistant",
      getState: () => previewState,
      setState: (state) => {
        previewState = state;
      },
      createPreviewState,
      getMessageText: (message) => message.text,
      schedulePreviewFlush: () => {
        events.push("unexpected:flush");
      },
    },
  );
  assert.deepEqual(events, ["markdown:7:previous markdown", "set:", "flush:7"]);
  assert.equal(previewState?.pendingText, "hello");
});

test("Preview hook runtime binds assistant message start and update deps", async () => {
  const events: string[] = [];
  let previewState:
    | {
        mode: "draft" | "message";
        pendingText: string;
        lastSentText: string;
      }
    | undefined = {
    mode: "message",
    pendingText: "previous markdown",
    lastSentText: "",
  };
  const hooks = createTelegramAssistantMessagePreviewHooks({
    getActiveTurn: () => ({ chatId: 7 }),
    isAssistantMessage: (message: { role: string; text?: string }) =>
      message.role === "assistant",
    getState: () => previewState,
    setState: (state) => {
      previewState = state;
      events.push(`set:${state?.pendingText ?? "none"}`);
    },
    createPreviewState: () => ({
      mode: "message" as const,
      pendingText: "",
      lastSentText: "",
    }),
    finalizePreview: async (chatId) => {
      events.push(`finalize:${chatId}`);
      return true;
    },
    finalizeMarkdownPreview: async (chatId, markdown) => {
      events.push(`markdown:${chatId}:${markdown}`);
      return true;
    },
    getMessageText: (message) => message.text ?? "",
    schedulePreviewFlush: (chatId) => {
      events.push(`flush:${chatId}`);
    },
  });
  await hooks.onMessageStart({ message: { role: "assistant" } });
  await hooks.onMessageUpdate({
    message: { role: "assistant", text: "next markdown" },
  });
  assert.deepEqual(events, ["markdown:7:previous markdown", "set:", "flush:7"]);
  assert.equal(previewState?.pendingText, "next markdown");
});

test("Preview runtime sends normalized native Markdown drafts", async () => {
  const harness = createPreviewRuntimeHarness({
    mode: "draft",
    pendingText: "## Intro\n\n**$BTC**",
    lastSentText: "",
    flushTimer: setTimeout(() => {}, 1000),
  });
  await flushTelegramPreview(7, harness.deps);
  assert.deepEqual(harness.events, ["draft:7:10:## Intro\n\n**\\$BTC**"]);
  assert.equal(harness.getState()?.mode, "draft");
  assert.equal(harness.getState()?.draftId, 10);
  assert.equal(harness.getState()?.lastSentText, "## Intro\n\n**$BTC**");
  assert.equal(harness.getState()?.lastSentParseMode, undefined);
  assert.equal(harness.getDraftSupport(), "supported");
});

test("Preview runtime preserves original blank-line spacing in draft Markdown", async () => {
  const cases = [
    {
      markdown: "Para\n\n\n> Quote",
      expectedEvent: "draft:7:10:Para\n\n\n>Quote",
      expectedText: "Para\n\n\n> Quote",
    },
    {
      markdown: "Para\n\n\n- item",
      expectedEvent: "draft:7:10:Para\n\n\n- item",
      expectedText: "Para\n\n\n- item",
    },
  ];
  for (const testCase of cases) {
    const harness = createPreviewRuntimeHarness({
      mode: "draft",
      pendingText: testCase.markdown,
      lastSentText: "",
      flushTimer: setTimeout(() => {}, 1000),
    });
    await flushTelegramPreview(7, harness.deps);
    assert.deepEqual(harness.events, [testCase.expectedEvent]);
    assert.equal(harness.getState()?.lastSentText, testCase.expectedText);
  }
});

test("Preview runtime keeps heading-to-code spacing readable without source blank lines", async () => {
  const harness = createPreviewRuntimeHarness({
    mode: "draft",
    pendingText: "### Title\n```ts\nconst x = 1\n```",
    lastSentText: "",
    flushTimer: setTimeout(() => {}, 1000),
  });
  harness.deps.maxMessageLength = 4096;
  await flushTelegramPreview(7, harness.deps);
  assert.deepEqual(harness.events, [
    "draft:7:10:### Title\n```ts\nconst x = 1\n```",
  ]);
  assert.equal(
    harness.getState()?.lastSentText,
    "### Title\n```ts\nconst x = 1\n```",
  );
});

test("Preview runtime can still use and clear plain draft previews", async () => {
  const harness = createPreviewRuntimeHarness({
    mode: "draft",
    pendingText: "**hello**",
    lastSentText: "",
    flushTimer: setTimeout(() => {}, 1000),
  });
  await flushTelegramPreview(7, harness.deps);
  assert.deepEqual(harness.events, ["draft:7:10:**hello**"]);
  assert.equal(harness.getState()?.mode, "draft");
  assert.equal(harness.getState()?.draftId, 10);
  assert.equal(harness.getState()?.lastSentText, "**hello**");
  assert.equal(harness.getDraftSupport(), "supported");
  await clearTelegramPreview(7, harness.deps);
  assert.deepEqual(harness.events, [
    "draft:7:10:**hello**",
    "draft:7:10:undefined",
  ]);
  assert.equal(harness.getState(), undefined);
});

test("Preview runtime optional send gate clears without sending", async () => {
  const timer = setTimeout(() => {}, 1000);
  const harness = createPreviewRuntimeHarness({
    mode: "draft",
    pendingText: "**hello**",
    lastSentText: "",
    flushTimer: timer,
  });
  harness.deps.canSend = () => false;
  await flushTelegramPreview(7, harness.deps);
  assert.deepEqual(harness.events, []);
  assert.equal(harness.getState(), undefined);
});

test("Preview runtime falls back to editable plain messages when draft delivery fails", async () => {
  const harness = createPreviewRuntimeHarness({
    mode: "draft",
    pendingText: "abcdef",
    lastSentText: "",
  });
  harness.deps.sendDraft = async () => {
    throw new Error("draft unsupported");
  };
  await flushTelegramPreview(7, harness.deps);
  assert.deepEqual(harness.events, ["send:7:abcdef:plain"]);
  assert.equal(harness.getState()?.mode, "message");
  assert.equal(harness.getState()?.messageId, 77);
  assert.equal(harness.getDraftSupport(), "unsupported");
});

test("Preview runtime records transport failures without throwing", async () => {
  const harness = createPreviewRuntimeHarness({
    mode: "message",
    messageId: 77,
    pendingText: "next",
    lastSentText: "old",
  });
  harness.setDraftSupport("unsupported");
  const deps = {
    ...harness.deps,
    editMessageText: async () => {
      throw new Error("fetch failed");
    },
  };
  await flushTelegramPreview(7, deps);
  assert.deepEqual(harness.events, ["preview:flush"]);
});

test("Preview controller runtime forwards runtime-event recorder", async () => {
  const events: string[] = [];
  const runtime = createTelegramPreviewControllerRuntime({
    sendDraft: async () => {
      throw new Error("draft unsupported");
    },
    sendMessage: async () => {
      throw new Error("websocket disconnected");
    },
    editMessageText: async () => undefined,
    recordRuntimeEvent: (category, error, details) => {
      const message = error instanceof Error ? error.message : String(error);
      events.push(`${category}:${message}:${details?.phase}`);
    },
  });
  runtime.resetState();
  runtime.setPendingText("hello");

  await runtime.flush(7);

  assert.deepEqual(events, ["preview:websocket disconnected:flush"]);
});

test("Preview runtime serializes overlapping flush requests", async () => {
  const harness = createPreviewRuntimeHarness({
    mode: "message",
    messageId: 44,
    pendingText: "first",
    lastSentText: "",
  });
  harness.setDraftSupport("unsupported");
  let releaseEdit: (() => void) | undefined;
  harness.deps.editMessageText = async (
    chatId: number,
    messageId: number,
    text: string,
    options?: { parseMode?: "HTML" },
  ) => {
    harness.events.push(
      `edit:${chatId}:${messageId}:${text}:${options?.parseMode ?? "plain"}`,
    );
    if (!releaseEdit) {
      await new Promise<void>((resolve) => {
        releaseEdit = resolve;
      });
    }
  };
  const firstFlush = flushTelegramPreview(7, harness.deps);
  await Promise.resolve();
  const state = harness.getState();
  assert.ok(state);
  state.pendingText = "second";
  const secondFlush = flushTelegramPreview(7, harness.deps);
  releaseEdit?.();
  await Promise.all([firstFlush, secondFlush]);
  assert.deepEqual(harness.events, [
    "edit:7:44:first:plain",
    "edit:7:44:second:plain",
  ]);
  assert.equal(harness.getState()?.lastSentText, "second");
});

test("Preview runtime waits for an active draft flush before clearing", async () => {
  const harness = createPreviewRuntimeHarness({
    mode: "draft",
    draftId: 10,
    pendingText: "new draft",
    lastSentText: "",
  });
  let releaseDraft: (() => void) | undefined;
  harness.deps.sendDraft = async (chatId, draftId, text) => {
    harness.events.push(`draft-start:${chatId}:${draftId}:${text}`);
    await new Promise<void>((resolve) => {
      releaseDraft = resolve;
    });
    harness.events.push(`draft-finish:${chatId}:${draftId}:${text}`);
  };
  const flush = flushTelegramPreview(7, harness.deps);
  await Promise.resolve();
  const clear = clearTelegramPreview(7, harness.deps);
  await Promise.resolve();
  assert.deepEqual(harness.events, ["draft-start:7:10:new draft"]);
  releaseDraft?.();
  for (let i = 0; i < 5 && harness.events.length < 3; i++) {
    await Promise.resolve();
  }
  assert.deepEqual(harness.events, [
    "draft-start:7:10:new draft",
    "draft-finish:7:10:new draft",
    "draft-start:7:10:undefined",
  ]);
  releaseDraft?.();
  await Promise.all([flush, clear]);
  assert.deepEqual(harness.events, [
    "draft-start:7:10:new draft",
    "draft-finish:7:10:new draft",
    "draft-start:7:10:undefined",
    "draft-finish:7:10:undefined",
  ]);
  assert.equal(harness.getState(), undefined);
});

test("Native Markdown finalization waits for active draft flush before final reply", async () => {
  const harness = createPreviewRuntimeHarness({
    mode: "draft",
    draftId: 10,
    pendingText: "draft body",
    lastSentText: "",
  });
  const releases: Array<() => void> = [];
  harness.deps.sendDraft = async (chatId, draftId, text) => {
    harness.events.push(`draft-start:${chatId}:${draftId}:${text}`);
    await new Promise<void>((resolve) => {
      releases.push(resolve);
    });
    harness.events.push(`draft-finish:${chatId}:${draftId}:${text}`);
  };
  const finalizeMarkdown = createTelegramNativeMarkdownPreviewFinalizer({
    getState: harness.deps.getState,
    clear: (chatId) => clearTelegramPreview(chatId, harness.deps),
    discard: () => harness.deps.setState(undefined),
    sendMarkdownReply: async (chatId, replyToMessageId, markdown) => {
      harness.events.push(`final:${chatId}:${replyToMessageId ?? "none"}:${markdown}`);
      return 88;
    },
  });
  const flush = flushTelegramPreview(7, harness.deps);
  await Promise.resolve();
  const finalize = finalizeMarkdown(7, "final body", 42);
  await Promise.resolve();
  assert.deepEqual(harness.events, ["draft-start:7:10:draft body"]);
  releases.shift()?.();
  for (let i = 0; i < 10 && harness.events.length < 3; i++) {
    await Promise.resolve();
  }
  assert.deepEqual(harness.events, [
    "draft-start:7:10:draft body",
    "draft-finish:7:10:draft body",
    "final:7:42:final body",
  ]);
  await Promise.all([flush, finalize]);
  assert.deepEqual(harness.events, [
    "draft-start:7:10:draft body",
    "draft-finish:7:10:draft body",
    "final:7:42:final body",
  ]);
  assert.equal(harness.getState(), undefined);
});

test("Preview runtime sends final fallback without clearing draft preview", async () => {
  const draftHarness = createPreviewRuntimeHarness({
    mode: "draft",
    draftId: 10,
    pendingText: "done",
    lastSentText: "",
  });
  assert.equal(await finalizeTelegramPreview(7, draftHarness.deps), true);
  assert.deepEqual(draftHarness.events, [
    "draft:7:10:done",
    "send:7:done:plain",
  ]);
  assert.equal(draftHarness.getState(), undefined);
});

test("Preview runtime finalizes plain previews", async () => {
  const plainHarness = createPreviewRuntimeHarness({
    mode: "message",
    messageId: 44,
    pendingText: "done",
    lastSentText: "",
  });
  plainHarness.setDraftSupport("unsupported");
  assert.equal(await finalizeTelegramPreview(7, plainHarness.deps), true);
  assert.deepEqual(plainHarness.events, ["edit:7:44:done:plain"]);
  assert.equal(plainHarness.getState(), undefined);
});
