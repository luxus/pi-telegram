/**
 * Regression tests for the Telegram registration domain
 * Covers tool registration and command registration behavior without exercising the full extension runtime
 */

import assert from "node:assert/strict";
import test from "node:test";

import telegramExtension from "../index.ts";
import {
  registerTelegramAttachmentTool,
  registerTelegramCommands,
  registerTelegramLifecycleHooks,
  registerTelegramVoiceTool,
} from "../lib/registration.ts";

function createRegistrationApiHarness() {
  const tools: any[] = [];
  const commands = new Map<string, any>();
  const handlers = new Map<string, any>();
  return {
    tool: () => tools[0],
    tools: () => tools,
    commands,
    handlers,
    api: {
      on: (event: string, handler: unknown) => {
        handlers.set(event, handler);
      },
      registerTool: (definition: unknown) => {
        tools.push(definition);
      },
      registerCommand: (name: string, definition: unknown) => {
        commands.set(name, definition);
      },
    } as never,
  };
}

test("Registration registers the attachment tool and delegates queueing", async () => {
  const harness = createRegistrationApiHarness();
  const activeTurn = {
    queuedAttachments: [],
  } as unknown as {
    queuedAttachments: Array<{ path: string; fileName: string }>;
  } & ReturnType<
    Parameters<typeof registerTelegramAttachmentTool>[1]["getActiveTurn"]
  >;
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
    handleVoiceCommand: async (args) => {
      events.push(`voice:${args}`);
    },
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
  const setupCommand = harness.commands.get("telegram-setup");
  const statusCommand = harness.commands.get("telegram-status");
  const voiceCommand = harness.commands.get("telegram-voice");
  const notifications: string[] = [];
  const ctx = {
    ui: {
      notify: (message: string) => {
        notifications.push(message);
      },
    },
  } as never;
  await setupCommand.handler("", ctx);
  await statusCommand.handler("", ctx);
  await voiceCommand.handler("status", ctx);
  assert.deepEqual(events, ["setup", "voice:status"]);
  assert.deepEqual(notifications, ["bot: @demo | polling: stopped"]);
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
    handleVoiceCommand: async () => {
      events.push("voice");
    },
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
  const connectCommand = harness.commands.get("telegram-connect");
  const disconnectCommand = harness.commands.get("telegram-disconnect");
  const ctx = { ui: { notify: () => {} } } as never;
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

test("Registration registers Telegram voice tool and delegates delivery", async () => {
  const harness = createRegistrationApiHarness();
  const events: Array<Record<string, unknown>> = [];
  registerTelegramVoiceTool(harness.api, {
    getActiveTurn: () => ({ kind: "prompt" }) as never,
    getProactiveChatId: () => undefined,
    shouldKeepTextReply: (_activeTurn, alsoSendText) => alsoSendText === true,
    sendVoiceReply: async (options) => {
      events.push(options);
    },
    getDefaultVoiceSettings: () =>
      ({
        enabled: true,
        provider: "xai",
        providerOptions: {},
        autoTranscribeIncoming: true,
        replyWithVoiceOnIncomingVoice: true,
        alsoSendTextReply: false,
        defaultVoiceId: "eve",
        defaultLanguage: "de",
        sttLanguage: "de",
        speechStyle: "literal",
        speechPreparationPrompt: "x",
      }) as never,
  });
  const tool = harness.tools().find((entry) => entry.name === "telegram_send_voice");
  assert.equal(tool?.name, "telegram_send_voice");
  const result = await tool.execute("tool-call", { text: "Hallo" });
  assert.deepEqual(events, [
    {
      text: "Hallo",
      voiceId: "eve",
      language: "de",
      alsoSendText: false,
      proactiveChatId: undefined,
    },
  ]);
  assert.equal(result.content[0]?.text, "Queued Telegram voice reply.");
  assert.equal(result.details.alsoSendText, false);
});

test("Registration voice tool suppresses text copy unless explicitly allowed", async () => {
  const harness = createRegistrationApiHarness();
  const events: Array<Record<string, unknown>> = [];
  registerTelegramVoiceTool(harness.api, {
    getActiveTurn: () => ({ kind: "prompt" }) as never,
    getProactiveChatId: () => undefined,
    shouldKeepTextReply: () => false,
    sendVoiceReply: async (options) => {
      events.push(options);
    },
    getDefaultVoiceSettings: () =>
      ({
        enabled: true,
        provider: "xai",
        providerOptions: {},
        autoTranscribeIncoming: true,
        replyWithVoiceOnIncomingVoice: true,
        alsoSendTextReply: false,
        defaultVoiceId: "eve",
        defaultLanguage: "de",
        sttLanguage: "de",
        speechStyle: "literal",
        speechPreparationPrompt: "x",
      }) as never,
  });
  const tool = harness.tools().find((entry) => entry.name === "telegram_send_voice");
  await tool.execute("tool-call", { text: "Hallo", alsoSendText: true });
  assert.deepEqual(events, [
    {
      text: "Hallo",
      voiceId: "eve",
      language: "de",
      alsoSendText: false,
      proactiveChatId: undefined,
    },
  ]);
});

test("Registration voice tool falls back to normal text reply when voice sending fails", async () => {
  const harness = createRegistrationApiHarness();
  registerTelegramVoiceTool(harness.api, {
    getActiveTurn: () => ({ kind: "prompt" }) as never,
    getProactiveChatId: () => undefined,
    shouldKeepTextReply: () => false,
    sendVoiceReply: async () => {
      throw new Error("tts down");
    },
    getDefaultVoiceSettings: () =>
      ({
        enabled: true,
        provider: "xai",
        providerOptions: {},
        autoTranscribeIncoming: true,
        replyWithVoiceOnIncomingVoice: true,
        alsoSendTextReply: false,
        defaultVoiceId: "eve",
        defaultLanguage: "de",
        sttLanguage: "de",
        speechStyle: "literal",
        speechPreparationPrompt: "x",
      }) as never,
  });
  const tool = harness.tools().find((entry) => entry.name === "telegram_send_voice");
  const result = await tool.execute("tool-call", { text: "Hallo" });
  assert.match(
    result.content[0]?.text,
    /continuing with normal text reply/i,
  );
  assert.equal(result.details.alsoSendText, false);
  assert.equal(result.details.error, "tts down");
});

test("Registration voice tool supports proactive paired delivery without active turn", async () => {
  const harness = createRegistrationApiHarness();
  const events: Array<Record<string, unknown>> = [];
  registerTelegramVoiceTool(harness.api, {
    getActiveTurn: () => undefined,
    getProactiveChatId: () => 123,
    shouldKeepTextReply: () => false,
    sendVoiceReply: async (options) => {
      events.push(options);
    },
    getDefaultVoiceSettings: () =>
      ({
        enabled: true,
        provider: "xai",
        providerOptions: {},
        autoTranscribeIncoming: true,
        replyWithVoiceOnIncomingVoice: true,
        alsoSendTextReply: false,
        defaultVoiceId: "eve",
        defaultLanguage: "de",
        sttLanguage: "de",
        speechStyle: "literal",
        speechPreparationPrompt: "x",
      }) as never,
  });
  const tool = harness.tools().find((entry) => entry.name === "telegram_send_voice");
  const result = await tool.execute("tool-call", { text: "Aufstehen" });
  assert.deepEqual(events, [
    {
      text: "Aufstehen",
      voiceId: "eve",
      language: "de",
      alsoSendText: false,
      proactiveChatId: 123,
    },
  ]);
  assert.equal(result.content[0]?.text, "Queued Telegram voice reply.");
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
  const ctx = {} as never;
  await harness.handlers.get("session_start")({}, ctx);
  await harness.handlers.get("session_shutdown")({}, ctx);
  const beforeAgentStartResult = await harness.handlers.get(
    "before_agent_start",
  )({}, ctx);
  await harness.handlers.get("model_select")({}, ctx);
  await harness.handlers.get("agent_start")({}, ctx);
  await harness.handlers.get("tool_execution_start")({}, ctx);
  await harness.handlers.get("tool_execution_end")({}, ctx);
  await harness.handlers.get("message_start")({}, ctx);
  await harness.handlers.get("message_update")({}, ctx);
  await harness.handlers.get("agent_end")({}, ctx);
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
  assert.deepEqual(
    harness.tools().map((tool) => tool.name),
    ["telegram_attach", "telegram_send_voice"],
  );
  assert.deepEqual(
    [...harness.commands.keys()],
    [
      "telegram-setup",
      "telegram-status",
      "telegram-connect",
      "telegram-disconnect",
      "telegram-voice",
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
  const handler = harness.handlers.get("before_agent_start");
  const basePrompt = "System base";
  const telegramResult = await handler(
    { systemPrompt: basePrompt, prompt: "[telegram] hello" },
    {} as never,
  );
  const localResult = await handler(
    { systemPrompt: basePrompt, prompt: "hello" },
    {} as never,
  );
  assert.match(
    telegramResult.systemPrompt,
    /current user message came from Telegram/,
  );
  assert.match(telegramResult.systemPrompt, /telegram_attach/);
  assert.equal(localResult.systemPrompt.includes("came from Telegram"), false);
});
