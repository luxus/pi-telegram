/**
 * Regression tests for Telegram command helpers
 * Covers slash-command normalization, bot suffix stripping, arguments, and non-command input
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTelegramCommandAction,
  createTelegramBotCommandRegistrar,
  createTelegramCommandControlEnqueueAdapter,
  createTelegramCommandControlQueueRuntime,
  createTelegramCommandHandler,
  createTelegramCommandHandlerTargetRuntime,
  createTelegramCommandOrPromptRuntime,
  createTelegramCommandTargetQueueRuntime,
  createTelegramCommandTargetRuntime,
  executeTelegramCommandAction,
  getTelegramCommandExecutionMode,
  getTelegramCommandMessageTarget,
  handleTelegramCompactCommand,
  handleTelegramHelpCommand,
  handleTelegramModelCommand,
  handleTelegramStatusCommand,
  handleTelegramStopCommand,
  parseTelegramCommand,
  registerTelegramBotCommands,
  TELEGRAM_BOT_COMMANDS,
  TELEGRAM_HELP_TEXT,
} from "../lib/commands.ts";

test("Command helpers expose Telegram bot command definitions", () => {
  assert.deepEqual(TELEGRAM_BOT_COMMANDS, [
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
  ]);
});

test("Command helpers register Telegram bot commands through deps", async () => {
  const calls: unknown[] = [];
  await registerTelegramBotCommands({
    setMyCommands: async (commands) => {
      calls.push(commands);
    },
  });
  await createTelegramBotCommandRegistrar({
    setMyCommands: async (commands) => {
      calls.push(commands);
    },
  })();
  assert.deepEqual(calls, [TELEGRAM_BOT_COMMANDS, TELEGRAM_BOT_COMMANDS]);
});

test("Command helpers parse slash commands with args", () => {
  assert.deepEqual(parseTelegramCommand(" /Model@DemoBot  claude opus "), {
    name: "model",
    args: "claude opus",
  });
  assert.deepEqual(parseTelegramCommand("/status"), {
    name: "status",
    args: "",
  });
});

test("Command helpers ignore non-command input and empty names", () => {
  assert.equal(parseTelegramCommand("hello /status"), undefined);
  assert.equal(parseTelegramCommand("/"), undefined);
});

test("Command helpers resolve message reply targets", () => {
  assert.deepEqual(
    getTelegramCommandMessageTarget({ chat: { id: 1 }, message_id: 2 }),
    { chatId: 1, replyToMessageId: 2 },
  );
});

test("Command control enqueue adapter builds and enqueues control items", async () => {
  const calls: string[] = [];
  const enqueueControlItem = createTelegramCommandControlEnqueueAdapter<string>(
    {
      createControlItem: (options) => ({
        kind: "control",
        queueLane: "control",
        queueOrder: 0,
        laneOrder: 0,
        chatId: options.chatId,
        replyToMessageId: options.replyToMessageId,
        controlType: options.controlType,
        statusSummary: options.statusSummary,
        execute: options.execute,
      }),
      enqueueControlItem: (item, ctx) => {
        calls.push(`${item.controlType}:${item.statusSummary}:${ctx}`);
        void item.execute(ctx);
      },
    },
  );
  enqueueControlItem(
    { chatId: 7, replyToMessageId: 11 },
    "ctx",
    "status",
    "⚡ status",
    async (ctx) => {
      calls.push(`execute:${ctx}`);
    },
  );
  assert.deepEqual(calls, ["status:⚡ status:ctx", "execute:ctx"]);
});

test("Command control queue runtime builds, enqueues, and dispatches control items", async () => {
  const calls: string[] = [];
  const enqueueControlItem = createTelegramCommandControlQueueRuntime<string>({
    createControlItem: (options) => ({
      kind: "control",
      queueLane: "control",
      queueOrder: 0,
      laneOrder: 0,
      chatId: options.chatId,
      replyToMessageId: options.replyToMessageId,
      controlType: options.controlType,
      statusSummary: options.statusSummary,
      execute: options.execute,
    }),
    appendControlItem: (item, ctx) => {
      calls.push(`append:${item.controlType}:${ctx}`);
      void item.execute(ctx);
    },
    dispatchNextQueuedTelegramTurn: (ctx) => {
      calls.push(`dispatch:${ctx}`);
    },
  });
  enqueueControlItem(
    { chatId: 7, replyToMessageId: 11 },
    "ctx",
    "model",
    "⚙ model",
    async (ctx) => {
      calls.push(`execute:${ctx}`);
    },
  );
  assert.deepEqual(calls, ["append:model:ctx", "execute:ctx", "dispatch:ctx"]);
});

test("Command target queue runtime binds control queue and chat targets", async () => {
  const calls: string[] = [];
  const runtime = createTelegramCommandTargetQueueRuntime<
    { chat: { id: number }; message_id: number },
    string
  >({
    createControlItem: (options) => ({
      kind: "control",
      queueLane: "control",
      queueOrder: 0,
      laneOrder: 0,
      chatId: options.chatId,
      replyToMessageId: options.replyToMessageId,
      controlType: options.controlType,
      statusSummary: options.statusSummary,
      execute: options.execute,
    }),
    appendControlItem: (item, ctx) => {
      calls.push(`append:${item.chatId}:${item.replyToMessageId}:${ctx}`);
      void item.execute(ctx);
    },
    dispatchNextQueuedTelegramTurn: (ctx) => {
      calls.push(`dispatch:${ctx}`);
    },
    showStatus: async () => {},
    openModelMenu: async () => {},
    sendTextReply: async () => {},
  });
  runtime.enqueueControlItem(
    { chat: { id: 7 }, message_id: 11 },
    "ctx",
    "status",
    "⚡ status",
    async (ctx) => {
      calls.push(`execute:${ctx}`);
    },
  );
  assert.deepEqual(calls, ["append:7:11:ctx", "execute:ctx", "dispatch:ctx"]);
});

test("Command target runtime binds chat reply targets to command ports", async () => {
  const calls: string[] = [];
  const runtime = createTelegramCommandTargetRuntime<
    { chat: { id: number }; message_id: number },
    string
  >({
    enqueueControlItem: (target, ctx, controlType, statusSummary, execute) => {
      calls.push(
        `enqueue:${target.chatId}:${target.replyToMessageId}:${ctx}:${controlType}:${statusSummary}`,
      );
      void execute(ctx);
    },
    showStatus: async (chatId, replyToMessageId, ctx) => {
      calls.push(`status:${chatId}:${replyToMessageId}:${ctx}`);
    },
    openModelMenu: async (chatId, replyToMessageId, ctx) => {
      calls.push(`model:${chatId}:${replyToMessageId}:${ctx}`);
    },
    sendTextReply: async (chatId, replyToMessageId, text) => {
      calls.push(`reply:${chatId}:${replyToMessageId}:${text}`);
    },
  });
  const message = { chat: { id: 7 }, message_id: 11 };
  runtime.enqueueControlItem(
    message,
    "ctx",
    "status",
    "⚡ status",
    async () => {
      calls.push("execute");
    },
  );
  await runtime.showStatus(message, "ctx");
  await runtime.openModelMenu(message, "ctx");
  await runtime.sendTextReply(message, "hello");
  assert.deepEqual(calls, [
    "enqueue:7:11:ctx:status:⚡ status",
    "execute",
    "status:7:11:ctx",
    "model:7:11:ctx",
    "reply:7:11:hello",
  ]);
});

test("Command helpers build command actions", () => {
  assert.deepEqual(buildTelegramCommandAction("stop"), {
    kind: "stop",
    executionMode: "immediate",
  });
  assert.deepEqual(buildTelegramCommandAction("compact"), {
    kind: "compact",
    executionMode: "immediate",
  });
  assert.deepEqual(buildTelegramCommandAction("status"), {
    kind: "status",
    executionMode: "control-queue",
  });
  assert.deepEqual(buildTelegramCommandAction("model"), {
    kind: "model",
    executionMode: "control-queue",
  });
  assert.deepEqual(buildTelegramCommandAction("help"), {
    kind: "help",
    commandName: "help",
    executionMode: "immediate",
  });
  assert.deepEqual(buildTelegramCommandAction("start"), {
    kind: "help",
    commandName: "start",
    executionMode: "immediate",
  });
  assert.deepEqual(buildTelegramCommandAction("unknown"), {
    kind: "ignore",
    executionMode: "ignored",
  });
  assert.deepEqual(buildTelegramCommandAction(undefined), {
    kind: "ignore",
    executionMode: "ignored",
  });
});

test("Command execution mode contract separates immediate and queued controls", () => {
  const cases: Array<[string | undefined, string]> = [
    ["stop", "immediate"],
    ["compact", "immediate"],
    ["help", "immediate"],
    ["start", "immediate"],
    ["status", "control-queue"],
    ["model", "control-queue"],
    ["unknown", "ignored"],
    [undefined, "ignored"],
  ];
  assert.deepEqual(
    cases.map(([commandName, _mode]) => [
      commandName,
      getTelegramCommandExecutionMode(buildTelegramCommandAction(commandName)),
    ]),
    cases,
  );
});

test("Command helpers run stop command side effects", async () => {
  const events: string[] = [];
  await handleTelegramStopCommand({
    hasAbortHandler: () => false,
    clearPendingModelSwitch: () => {
      events.push("unexpected:clear");
    },
    hasQueuedTelegramItems: () => false,
    setPreserveQueuedTurnsAsHistory: () => {
      events.push("unexpected:preserve");
    },
    abortCurrentTurn: () => {
      events.push("unexpected:abort");
    },
    updateStatus: () => {
      events.push("unexpected:status");
    },
    sendTextReply: async (text) => {
      events.push(`reply:${text}`);
    },
  });
  await handleTelegramStopCommand({
    hasAbortHandler: () => true,
    clearPendingModelSwitch: () => {
      events.push("clear");
    },
    hasQueuedTelegramItems: () => true,
    setPreserveQueuedTurnsAsHistory: (preserve) => {
      events.push(`preserve:${preserve}`);
    },
    abortCurrentTurn: () => {
      events.push("abort");
    },
    updateStatus: () => {
      events.push("status");
    },
    sendTextReply: async (text) => {
      events.push(`reply:${text}`);
    },
  });
  assert.deepEqual(events, [
    "reply:No active turn.",
    "clear",
    "preserve:true",
    "abort",
    "status",
    "reply:Aborted current turn.",
  ]);
});

test("Command helpers guard and complete compact command flow", async () => {
  const events: string[] = [];
  await handleTelegramCompactCommand({
    isIdle: () => false,
    hasPendingMessages: () => false,
    hasActiveTelegramTurn: () => false,
    hasDispatchPending: () => false,
    hasQueuedTelegramItems: () => false,
    isCompactionInProgress: () => false,
    setCompactionInProgress: (inProgress) => {
      events.push(`set:${inProgress}`);
    },
    updateStatus: () => {
      events.push("status");
    },
    dispatchNextQueuedTelegramTurn: () => {
      events.push("dispatch");
    },
    compact: () => {
      events.push("unexpected:compact");
    },
    sendTextReply: async (text) => {
      events.push(`reply:${text}`);
    },
  });
  let complete: (() => void) | undefined;
  await handleTelegramCompactCommand({
    isIdle: () => true,
    hasPendingMessages: () => false,
    hasActiveTelegramTurn: () => false,
    hasDispatchPending: () => false,
    hasQueuedTelegramItems: () => false,
    isCompactionInProgress: () => false,
    setCompactionInProgress: (inProgress) => {
      events.push(`set:${inProgress}`);
    },
    updateStatus: () => {
      events.push("status");
    },
    dispatchNextQueuedTelegramTurn: () => {
      events.push("dispatch");
    },
    compact: (callbacks) => {
      events.push("compact");
      complete = callbacks.onComplete;
    },
    sendTextReply: async (text) => {
      events.push(`reply:${text}`);
    },
  });
  complete?.();
  assert.deepEqual(events, [
    "reply:Cannot compact while pi or the Telegram queue is busy. Wait for queued turns to finish or send /stop first.",
    "set:true",
    "status",
    "compact",
    "reply:Compaction started.",
    "set:false",
    "status",
    "dispatch",
    "reply:Compaction completed.",
  ]);
});

test("Command helpers report compact errors", async () => {
  const events: string[] = [];
  const recordRuntimeEvent = (category: string, error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    events.push(`event:${category}:${message}`);
  };
  let fail: ((error: unknown) => void) | undefined;
  await handleTelegramCompactCommand({
    isIdle: () => true,
    hasPendingMessages: () => false,
    hasActiveTelegramTurn: () => false,
    hasDispatchPending: () => false,
    hasQueuedTelegramItems: () => false,
    isCompactionInProgress: () => false,
    setCompactionInProgress: (inProgress) => {
      events.push(`set:${inProgress}`);
    },
    updateStatus: () => {
      events.push("status");
    },
    dispatchNextQueuedTelegramTurn: () => {
      events.push("dispatch");
    },
    compact: (callbacks) => {
      events.push("compact");
      fail = callbacks.onError;
    },
    sendTextReply: async (text) => {
      events.push(`reply:${text}`);
    },
    recordRuntimeEvent,
  });
  fail?.(new Error("boom"));
  await handleTelegramCompactCommand({
    isIdle: () => true,
    hasPendingMessages: () => false,
    hasActiveTelegramTurn: () => false,
    hasDispatchPending: () => false,
    hasQueuedTelegramItems: () => false,
    isCompactionInProgress: () => false,
    setCompactionInProgress: (inProgress) => {
      events.push(`throw-set:${inProgress}`);
    },
    updateStatus: () => {
      events.push("throw-status");
    },
    dispatchNextQueuedTelegramTurn: () => {},
    compact: () => {
      throw new Error("sync boom");
    },
    sendTextReply: async (text) => {
      events.push(`reply:${text}`);
    },
    recordRuntimeEvent,
  });
  assert.deepEqual(events, [
    "set:true",
    "status",
    "compact",
    "reply:Compaction started.",
    "set:false",
    "status",
    "dispatch",
    "event:compact:boom",
    "reply:Compaction failed: boom",
    "throw-set:true",
    "throw-status",
    "throw-set:false",
    "throw-status",
    "event:compact:sync boom",
    "reply:Compaction failed: sync boom",
  ]);
});

test("Command helpers enqueue status and model control commands", async () => {
  const events: string[] = [];
  const enqueueControlItem = (
    controlType: "status" | "model",
    statusSummary: string,
    execute: (ctx: string) => Promise<void>,
  ) => {
    events.push(`${controlType}:${statusSummary}`);
    void execute("ctx");
  };
  await handleTelegramStatusCommand({
    enqueueControlItem,
    showStatus: async (ctx) => {
      events.push(`show:${ctx}`);
    },
  });
  await handleTelegramModelCommand({
    enqueueControlItem,
    openModelMenu: async (ctx) => {
      events.push(`model:${ctx}`);
    },
  });
  assert.deepEqual(events, [
    "status:⚡ status",
    "show:ctx",
    "model:⚡ model",
    "model:ctx",
  ]);
});

test("Command helpers send help, register start commands, and pair first sender", async () => {
  const events: string[] = [];
  let allowedUserId: number | undefined;
  await handleTelegramHelpCommand("help", {
    senderUserId: 7,
    getAllowedUserId: () => allowedUserId,
    setAllowedUserId: (userId) => {
      allowedUserId = userId;
      events.push(`pair:${userId}`);
    },
    registerBotCommands: async () => {
      events.push("unexpected:register");
    },
    persistConfig: async () => {
      events.push("persist");
    },
    updateStatus: () => {
      events.push("status");
    },
    sendTextReply: async (text) => {
      events.push(`reply:${text}`);
    },
  });
  await handleTelegramHelpCommand("start", {
    senderUserId: 8,
    getAllowedUserId: () => allowedUserId,
    setAllowedUserId: (userId) => {
      allowedUserId = userId;
      events.push(`unexpected:pair:${userId}`);
    },
    registerBotCommands: async () => {
      events.push("register");
    },
    persistConfig: async () => {
      events.push("unexpected:persist");
    },
    updateStatus: () => {
      events.push("unexpected:status");
    },
    sendTextReply: async (text) => {
      events.push(`reply:${text}`);
    },
  });
  assert.equal(allowedUserId, 7);
  assert.deepEqual(events, [
    `reply:${TELEGRAM_HELP_TEXT}`,
    "pair:7",
    "persist",
    "status",
    "register",
    `reply:${TELEGRAM_HELP_TEXT}`,
  ]);
});

test("Command helpers include start registration warnings in help replies", async () => {
  const events: string[] = [];
  await handleTelegramHelpCommand("start", {
    getAllowedUserId: () => 1,
    setAllowedUserId: () => {
      events.push("unexpected:pair");
    },
    registerBotCommands: async () => {
      throw new Error("menu unavailable");
    },
    persistConfig: async () => {
      events.push("unexpected:persist");
    },
    updateStatus: () => {
      events.push("unexpected:status");
    },
    sendTextReply: async (text) => {
      events.push(text);
    },
  });
  assert.deepEqual(events, [
    `${TELEGRAM_HELP_TEXT}\n\nWarning: failed to register bot commands menu: menu unavailable`,
  ]);
});

test("Command handler target runtime binds command targets into command handling", async () => {
  const calls: string[] = [];
  const handleCommand = createTelegramCommandHandlerTargetRuntime<
    { chat: { id: number }; message_id: number },
    string
  >({
    hasAbortHandler: () => false,
    clearPendingModelSwitch: () => {},
    hasQueuedTelegramItems: () => false,
    setPreserveQueuedTurnsAsHistory: () => {},
    abortCurrentTurn: () => {},
    isIdle: () => true,
    hasPendingMessages: () => false,
    hasActiveTelegramTurn: () => false,
    hasDispatchPending: () => false,
    isCompactionInProgress: () => false,
    setCompactionInProgress: () => {},
    updateStatus: () => {},
    dispatchNextQueuedTelegramTurn: (ctx) => {
      calls.push(`dispatch:${ctx}`);
    },
    compact: () => {},
    allocateItemOrder: () => 0,
    allocateControlOrder: () => 0,
    appendControlItem: (item, ctx) => {
      calls.push(
        `append:${item.chatId}:${item.replyToMessageId}:${item.controlType}:${ctx}`,
      );
    },
    showStatus: async () => {},
    openModelMenu: async () => {},
    getAllowedUserId: () => undefined,
    setAllowedUserId: () => {},
    setMyCommands: async () => {},
    persistConfig: async () => {},
    sendTextReply: async () => {},
  });
  assert.equal(
    await handleCommand("status", { chat: { id: 7 }, message_id: 11 }, "ctx"),
    true,
  );
  assert.deepEqual(calls, ["append:7:11:status:ctx", "dispatch:ctx"]);
});

test("Command runtime routes commands through runtime ports", async () => {
  const events: string[] = [];
  const message = { chat: { id: 42 }, message_id: 99, from: { id: 7 } };
  let allowedUserId: number | undefined;
  let compactComplete: (() => void) | undefined;
  const deps = {
    hasAbortHandler: () => true,
    clearPendingModelSwitch: () => {
      events.push("clear-switch");
    },
    hasQueuedTelegramItems: () => false,
    setPreserveQueuedTurnsAsHistory: () => {
      events.push("preserve");
    },
    abortCurrentTurn: () => {
      events.push("abort");
    },
    isIdle: (ctx: { idle: boolean }) => ctx.idle,
    hasPendingMessages: () => false,
    hasActiveTelegramTurn: () => false,
    hasDispatchPending: () => false,
    isCompactionInProgress: () => false,
    setCompactionInProgress: (inProgress: boolean) => {
      events.push(`compact:${inProgress}`);
    },
    updateStatus: () => {
      events.push("status");
    },
    dispatchNextQueuedTelegramTurn: () => {
      events.push("dispatch");
    },
    compact: (
      _ctx: { idle: boolean },
      callbacks: { onComplete: () => void },
    ) => {
      events.push("compact:start");
      compactComplete = callbacks.onComplete;
    },
    enqueueControlItem: async (
      nextMessage: typeof message,
      _ctx: { idle: boolean },
      controlType: "status" | "model",
      statusSummary: string,
      execute: (ctx: { idle: boolean }) => Promise<void>,
    ) => {
      events.push(
        `enqueue:${nextMessage.message_id}:${controlType}:${statusSummary}`,
      );
      await execute({ idle: true });
    },
    showStatus: async (nextMessage: typeof message) => {
      events.push(`show:${nextMessage.chat.id}`);
    },
    openModelMenu: async (nextMessage: typeof message) => {
      events.push(`model:${nextMessage.chat.id}`);
    },
    getAllowedUserId: () => allowedUserId,
    setAllowedUserId: (userId: number) => {
      allowedUserId = userId;
      events.push(`pair:${userId}`);
    },
    registerBotCommands: async () => {
      events.push("register");
    },
    persistConfig: async () => {
      events.push("persist");
    },
    sendTextReply: async (nextMessage: typeof message, text: string) => {
      events.push(`reply:${nextMessage.message_id}:${text}`);
    },
  };
  const handleCommand = createTelegramCommandHandler(deps);
  assert.equal(await handleCommand("status", message, { idle: true }), true);
  assert.equal(await handleCommand("model", message, { idle: true }), true);
  assert.equal(await handleCommand("debug", message, { idle: true }), false);
  assert.equal(await handleCommand("start", message, { idle: true }), true);
  assert.equal(await handleCommand("compact", message, { idle: true }), true);
  compactComplete?.();
  assert.equal(await handleCommand("stop", message, { idle: true }), true);
  assert.equal(await handleCommand("unknown", message, { idle: true }), false);
  assert.equal(allowedUserId, 7);
  assert.deepEqual(events, [
    "enqueue:99:status:⚡ status",
    "show:42",
    "enqueue:99:model:⚡ model",
    "model:42",
    "register",
    `reply:99:${TELEGRAM_HELP_TEXT}`,
    "pair:7",
    "persist",
    "status",
    "compact:true",
    "status",
    "compact:start",
    "reply:99:Compaction started.",
    "compact:false",
    "status",
    "dispatch",
    "reply:99:Compaction completed.",
    "clear-switch",
    "abort",
    "status",
    "reply:99:Aborted current turn.",
  ]);
});

test("Command or prompt runtime routes commands before enqueue fallback", async () => {
  const events: string[] = [];
  const runtime = createTelegramCommandOrPromptRuntime<
    { text: string },
    { id: string }
  >({
    extractRawText: (messages) =>
      messages.map((message) => message.text).join(" "),
    handleCommand: async (commandName, message, ctx) => {
      events.push(`command:${commandName ?? "none"}:${message.text}:${ctx.id}`);
      return commandName === "status";
    },
    enqueueTurn: async (messages, ctx) => {
      events.push(`enqueue:${messages.length}:${ctx.id}`);
    },
  });
  await runtime.dispatchMessages([{ text: "/status" }], { id: "ctx" });
  await runtime.dispatchMessages([{ text: "hello" }], { id: "ctx" });
  await runtime.dispatchMessages([], { id: "ctx" });
  assert.deepEqual(events, [
    "command:status:/status:ctx",
    "command:none:hello:ctx",
    "enqueue:1:ctx",
  ]);
});

test("Command helpers execute command actions through provided handlers", async () => {
  const events: string[] = [];
  const deps = {
    handleStop: async () => {
      events.push("stop");
    },
    handleCompact: async () => {
      events.push("compact");
    },
    handleStatus: async () => {
      events.push("status");
    },
    handleModel: async () => {
      events.push("model");
    },
    handleHelp: async (_message: unknown, commandName: "help" | "start") => {
      events.push(`help:${commandName}`);
    },
  };
  assert.equal(
    await executeTelegramCommandAction(
      { kind: "ignore", executionMode: "ignored" },
      {},
      {},
      deps,
    ),
    false,
  );
  assert.equal(
    await executeTelegramCommandAction(
      { kind: "stop", executionMode: "immediate" },
      {},
      {},
      deps,
    ),
    true,
  );
  assert.equal(
    await executeTelegramCommandAction(
      { kind: "help", commandName: "start", executionMode: "immediate" },
      {},
      {},
      deps,
    ),
    true,
  );
  assert.deepEqual(events, ["stop", "help:start"]);
});
