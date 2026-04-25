/**
 * Regression tests for the pi SDK adapter boundary
 * Covers narrow bridge-facing helpers over concrete pi context contracts
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  compactExtensionContext,
  createExtensionApiRuntimePorts,
  type ExtensionContext,
  getExtensionContextModel,
  hasExtensionContextPendingMessages,
  isExtensionContextIdle,
} from "../lib/pi.ts";

type PiRuntimeApiHarness = Parameters<
  typeof createExtensionApiRuntimePorts
>[0] & {
  events: string[];
};

type PiRuntimeModel = Parameters<PiRuntimeApiHarness["setModel"]>[0];

function createHarnessModel(id: string): PiRuntimeModel {
  return { id } as PiRuntimeModel;
}

function getHarnessModelId(model: PiRuntimeModel): string {
  return String(Reflect.get(Object(model), "id"));
}

test("Pi API runtime ports bind methods without losing receiver context", async () => {
  const api: PiRuntimeApiHarness = {
    events: [],
    sendUserMessage(content) {
      this.events.push(`send:${String(content)}`);
    },
    getThinkingLevel() {
      this.events.push("get-thinking");
      return "high";
    },
    setThinkingLevel(level) {
      this.events.push(`thinking:${String(level)}`);
    },
    async setModel(model) {
      this.events.push(`model:${getHarnessModelId(model)}`);
      return true;
    },
  };
  const runtime = createExtensionApiRuntimePorts(api);
  runtime.sendUserMessage("hello");
  assert.equal(runtime.getThinkingLevel(), "high");
  runtime.setThinkingLevel("low");
  assert.equal(await runtime.setModel(createHarnessModel("gpt-5")), true);
  assert.deepEqual(api.events, [
    "send:hello",
    "get-thinking",
    "thinking:low",
    "model:gpt-5",
  ]);
});

test("Pi context helpers expose model, idle, pending-message, and compact adapters", () => {
  const model = { provider: "openai", id: "gpt-5", name: "GPT-5" };
  const events: string[] = [];
  const ctx = {
    model,
    isIdle: () => true,
    hasPendingMessages: () => false,
    compact: (callbacks: { onComplete: () => void }) => {
      events.push("compact");
      callbacks.onComplete();
    },
  } as unknown as ExtensionContext;
  compactExtensionContext(ctx, {
    onComplete: () => {
      events.push("complete");
    },
    onError: () => {
      events.push("error");
    },
  });
  assert.equal(getExtensionContextModel(ctx), model);
  assert.equal(isExtensionContextIdle(ctx), true);
  assert.equal(hasExtensionContextPendingMessages(ctx), false);
  assert.deepEqual(events, ["compact", "complete"]);
});
