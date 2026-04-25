/**
 * Regression tests for the Telegram registration domain
 * Covers tool registration and command registration behavior without exercising the full extension runtime
 */

import assert from "node:assert/strict";
import test from "node:test";

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "../lib/pi.ts";

import telegramExtension from "../index.ts";
import {
  buildTelegramBridgeSystemPrompt,
  createTelegramBeforeAgentStartHook,
  registerTelegramAttachmentTool,
  registerTelegramCommands,
  registerTelegramLifecycleHooks,
} from "../lib/registration.ts";
import type { PendingTelegramTurn } from "../lib/queue.ts";

type RegisteredHarnessTool = {
  name?: string;
  execute: (
    toolCallId: string,
    params: { paths: string[] },
  ) => Promise<{ details: { paths: string[] } }>;
};

type RegisteredHarnessCommand = {
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> | void;
};

type RegisteredHarnessHandler = (
  event: unknown,
  ctx: ExtensionContext,
) => Promise<unknown> | unknown;

type BeforeAgentStartHookEvent = Parameters<
  ReturnType<typeof createTelegramBeforeAgentStartHook>
>[0];

function createBeforeAgentStartEvent(
  prompt: string,
  systemPrompt: string,
): BeforeAgentStartHookEvent {
  return { prompt, systemPrompt } as BeforeAgentStartHookEvent;
}

function createRegistrationApiHarness() {
  let tool: RegisteredHarnessTool | undefined;
  const commands = new Map<string, RegisteredHarnessCommand>();
  const handlers = new Map<string, RegisteredHarnessHandler>();
  const api = {
    on: (event: string, handler: RegisteredHarnessHandler) => {
      handlers.set(event, handler);
    },
    registerTool: (definition: RegisteredHarnessTool) => {
      tool = definition;
    },
    registerCommand: (name: string, definition: RegisteredHarnessCommand) => {
      commands.set(name, definition);
    },
  } as unknown as ExtensionAPI;
  return { tool: () => tool, commands, handlers, api };
}

function getRequiredMapValue<TKey, TValue>(
  map: Map<TKey, TValue>,
  key: TKey,
): TValue {
  const value = map.get(key);
  assert.ok(value, `Expected map value for ${String(key)}`);
  return value;
}

function createCommandContext(
  notify: (message: string) => void = () => {},
): ExtensionCommandContext {
  return { ui: { notify } } as unknown as ExtensionCommandContext;
}

function createExtensionContext(): ExtensionContext {
  return {} as ExtensionContext;
}

function createRegistrationActiveTurn(): PendingTelegramTurn {
  return {
    kind: "prompt",
    chatId: 1,
    replyToMessageId: 1,
    queueOrder: 0,
    queueLane: "default",
    laneOrder: 0,
    statusSummary: "demo",
    sourceMessageIds: [1],
    queuedAttachments: [],
    content: [],
    historyText: "",
  };
}

function assertSystemPromptResult(
  value: unknown,
): asserts value is { systemPrompt: string } {
  assert.ok(typeof value === "object" && value !== null);
  assert.equal(typeof Reflect.get(value, "systemPrompt"), "string");
}

test("Registration registers the attachment tool and delegates queueing", async () => {
  const harness = createRegistrationApiHarness();
  const activeTurn = createRegistrationActiveTurn();
  registerTelegramAttachmentTool(harness.api, {
    maxAttachmentsPerTurn: 2,
    getActiveTurn: () => activeTurn,
    statPath: async () => ({ isFile: () => true }),
  });
  const tool = harness.tool();
  assert.equal(tool?.name, "telegram_attach");
  const result = await tool.execute("tool-call", { paths: ["/tmp/report.md"] });
  assert.deepEqual(activeTurn.queuedAttachments, [
    { path: "/tmp/report.md", fileName: "report.md" },
  ]);
  assert.deepEqual(result.details.paths, ["/tmp/report.md"]);
});

test("Registration commands expose setup and status behaviors", async () => {
  const harness = createRegistrationApiHarness();
  const events: string[] = [];
  registerTelegramCommands(harness.api, {
    promptForConfig: async () => {
      events.push("setup");
    },
    getStatusLines: () => ["bot: @demo", "polling: stopped"],
    reloadConfig: async () => {
      events.push("reload");
    },
    hasBotToken: () => false,
    startPolling: async () => {
      events.push("start");
    },
    stopPolling: async () => {
      events.push("stop");
    },
    updateStatus: () => {
      events.push("update-status");
    },
  });
  const setupCommand = getRequiredMapValue(harness.commands, "telegram-setup");
  const statusCommand = getRequiredMapValue(
    harness.commands,
    "telegram-status",
  );
  const notifications: string[] = [];
  const ctx = createCommandContext((message) => {
    notifications.push(message);
  });
  await setupCommand.handler("", ctx);
  await statusCommand.handler("", ctx);
  assert.deepEqual(events, ["setup"]);
  assert.deepEqual(notifications, ["bot: @demo\npolling: stopped"]);
});

test("Registration connect and disconnect commands reload config and control polling", async () => {
  const harness = createRegistrationApiHarness();
  const events: string[] = [];
  let hasToken = false;
  registerTelegramCommands(harness.api, {
    promptForConfig: async () => {
      events.push("setup");
    },
    getStatusLines: () => [],
    reloadConfig: async () => {
      events.push("reload");
    },
    hasBotToken: () => hasToken,
    startPolling: async () => {
      events.push("start");
    },
    stopPolling: async () => {
      events.push("stop");
    },
    updateStatus: () => {
      events.push("update-status");
    },
  });
  const connectCommand = getRequiredMapValue(
    harness.commands,
    "telegram-connect",
  );
  const disconnectCommand = getRequiredMapValue(
    harness.commands,
    "telegram-disconnect",
  );
  const ctx = createCommandContext();
  await connectCommand.handler("", ctx);
  hasToken = true;
  await connectCommand.handler("", ctx);
  await disconnectCommand.handler("", ctx);
  assert.deepEqual(events, [
    "reload",
    "setup",
    "reload",
    "start",
    "update-status",
    "stop",
    "update-status",
  ]);
});

test("Registration builds Telegram-aware system prompt suffixes", () => {
  assert.deepEqual(
    buildTelegramBridgeSystemPrompt({
      prompt: " [telegram] hello",
      systemPrompt: "base",
      telegramPrefix: "[telegram]",
      systemPromptSuffix: "\nbridge active",
    }),
    {
      systemPrompt:
        "base\nbridge active\n- The current user message came from Telegram.",
    },
  );
  assert.deepEqual(
    buildTelegramBridgeSystemPrompt({
      prompt: "local hello",
      systemPrompt: "base",
      telegramPrefix: "[telegram]",
      systemPromptSuffix: "\nbridge active",
    }),
    { systemPrompt: "base\nbridge active" },
  );
  const hook = createTelegramBeforeAgentStartHook({
    telegramPrefix: "[telegram]",
    systemPromptSuffix: "\nbridge active",
  });
  assert.deepEqual(
    hook(createBeforeAgentStartEvent(" [telegram] hello", "base")),
    {
      systemPrompt:
        "base\nbridge active\n- The current user message came from Telegram.",
    },
  );
  const defaultHook = createTelegramBeforeAgentStartHook();
  const defaultSystemPrompt = defaultHook(
    createBeforeAgentStartEvent(" [telegram] hello", "base"),
  ).systemPrompt;
  assert.match(
    defaultSystemPrompt,
    /The current user message came from Telegram/,
  );
  assert.match(defaultSystemPrompt, /prefer narrow table columns/);
});

test("Registration lifecycle hooks are registered and delegate to the provided handlers", async () => {
  const harness = createRegistrationApiHarness();
  const events: string[] = [];
  registerTelegramLifecycleHooks(harness.api, {
    onSessionStart: async () => {
      events.push("session-start");
    },
    onSessionShutdown: async () => {
      events.push("session-shutdown");
    },
    onBeforeAgentStart: () => {
      events.push("before-agent-start");
      return { systemPrompt: "prompt" };
    },
    onModelSelect: () => {
      events.push("model-select");
    },
    onAgentStart: async () => {
      events.push("agent-start");
    },
    onToolExecutionStart: () => {
      events.push("tool-start");
    },
    onToolExecutionEnd: () => {
      events.push("tool-end");
    },
    onMessageStart: async () => {
      events.push("message-start");
    },
    onMessageUpdate: async () => {
      events.push("message-update");
    },
    onAgentEnd: async () => {
      events.push("agent-end");
    },
  });
  assert.deepEqual(
    [...harness.handlers.keys()],
    [
      "session_start",
      "session_shutdown",
      "before_agent_start",
      "model_select",
      "agent_start",
      "tool_execution_start",
      "tool_execution_end",
      "message_start",
      "message_update",
      "agent_end",
    ],
  );
  const ctx = createExtensionContext();
  await getRequiredMapValue(harness.handlers, "session_start")({}, ctx);
  await getRequiredMapValue(harness.handlers, "session_shutdown")({}, ctx);
  const beforeAgentStartResult = await getRequiredMapValue(
    harness.handlers,
    "before_agent_start",
  )({}, ctx);
  await getRequiredMapValue(harness.handlers, "model_select")({}, ctx);
  await getRequiredMapValue(harness.handlers, "agent_start")({}, ctx);
  await getRequiredMapValue(harness.handlers, "tool_execution_start")({}, ctx);
  await getRequiredMapValue(harness.handlers, "tool_execution_end")({}, ctx);
  await getRequiredMapValue(harness.handlers, "message_start")({}, ctx);
  await getRequiredMapValue(harness.handlers, "message_update")({}, ctx);
  await getRequiredMapValue(harness.handlers, "agent_end")({}, ctx);
  assert.deepEqual(beforeAgentStartResult, { systemPrompt: "prompt" });
  assert.deepEqual(events, [
    "session-start",
    "session-shutdown",
    "before-agent-start",
    "model-select",
    "agent-start",
    "tool-start",
    "tool-end",
    "message-start",
    "message-update",
    "agent-end",
  ]);
});

test("Extension entrypoint wires registration domains into the pi API", () => {
  const harness = createRegistrationApiHarness();
  telegramExtension(harness.api);
  assert.equal(harness.tool()?.name, "telegram_attach");
  assert.deepEqual(
    [...harness.commands.keys()],
    [
      "telegram-setup",
      "telegram-status",
      "telegram-connect",
      "telegram-disconnect",
    ],
  );
  assert.deepEqual(
    [...harness.handlers.keys()],
    [
      "session_start",
      "session_shutdown",
      "before_agent_start",
      "model_select",
      "agent_start",
      "tool_execution_start",
      "tool_execution_end",
      "message_start",
      "message_update",
      "agent_end",
    ],
  );
});

test("Extension before-agent-start hook appends Telegram-specific system prompt guidance", async () => {
  const harness = createRegistrationApiHarness();
  telegramExtension(harness.api);
  const handler = getRequiredMapValue(harness.handlers, "before_agent_start");
  const basePrompt = "System base";
  const telegramResult = await handler(
    { systemPrompt: basePrompt, prompt: "[telegram] hello" },
    createExtensionContext(),
  );
  const localResult = await handler(
    { systemPrompt: basePrompt, prompt: "hello" },
    createExtensionContext(),
  );
  assertSystemPromptResult(telegramResult);
  assertSystemPromptResult(localResult);
  assert.match(
    telegramResult.systemPrompt,
    /current user message came from Telegram/,
  );
  assert.match(telegramResult.systemPrompt, /telegram_attach/);
  assert.equal(localResult.systemPrompt.includes("came from Telegram"), false);
});
