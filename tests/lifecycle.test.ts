/**
 * Regression tests for Telegram lifecycle hook helpers
 * Covers pi lifecycle hook registration and hook composition ordering
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  appendTelegramLifecycleHooks,
  registerTelegramLifecycleHooks,
} from "../lib/lifecycle.ts";
import type { ExtensionAPI, ExtensionContext } from "../lib/pi.ts";

type RegisteredLifecycleHandler = (
  event: unknown,
  ctx: ExtensionContext,
) => Promise<unknown> | unknown;

function createLifecycleApiHarness() {
  const handlers = new Map<string, RegisteredLifecycleHandler>();
  const api = {
    on: (event: string, handler: RegisteredLifecycleHandler) => {
      handlers.set(event, handler);
    },
  } as unknown as ExtensionAPI;
  return { api, handlers };
}

function getRequiredLifecycleHandler(
  handlers: Map<string, RegisteredLifecycleHandler>,
  name: string,
): RegisteredLifecycleHandler {
  const handler = handlers.get(name);
  assert.ok(handler, `Expected lifecycle handler ${name}`);
  return handler;
}

function createLifecycleContext(): ExtensionContext {
  return {} as ExtensionContext;
}

test("Lifecycle helpers compose session hooks in order", async () => {
  const events: string[] = [];
  const hooks = appendTelegramLifecycleHooks(
    {
      onSessionStart: async () => {
        events.push("base-start");
      },
      onSessionShutdown: async () => {
        events.push("base-shutdown");
      },
    },
    {
      onSessionStart: async () => {
        events.push("extra-start");
      },
      onSessionShutdown: async () => {
        events.push("extra-shutdown");
      },
    },
  );
  await hooks.onSessionStart({} as never, createLifecycleContext());
  await hooks.onSessionShutdown({} as never, createLifecycleContext());
  assert.deepEqual(events, [
    "base-start",
    "extra-start",
    "base-shutdown",
    "extra-shutdown",
  ]);
});

test("Lifecycle helpers register pi hooks and delegate to handlers", async () => {
  const harness = createLifecycleApiHarness();
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
  const ctx = createLifecycleContext();
  await getRequiredLifecycleHandler(harness.handlers, "session_start")({}, ctx);
  await getRequiredLifecycleHandler(harness.handlers, "session_shutdown")(
    {},
    ctx,
  );
  const beforeAgentStartResult = await getRequiredLifecycleHandler(
    harness.handlers,
    "before_agent_start",
  )({}, ctx);
  await getRequiredLifecycleHandler(harness.handlers, "model_select")({}, ctx);
  await getRequiredLifecycleHandler(harness.handlers, "agent_start")({}, ctx);
  await getRequiredLifecycleHandler(harness.handlers, "tool_execution_start")(
    {},
    ctx,
  );
  await getRequiredLifecycleHandler(harness.handlers, "tool_execution_end")(
    {},
    ctx,
  );
  await getRequiredLifecycleHandler(harness.handlers, "message_start")({}, ctx);
  await getRequiredLifecycleHandler(harness.handlers, "message_update")({}, ctx);
  await getRequiredLifecycleHandler(harness.handlers, "agent_end")({}, ctx);
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
