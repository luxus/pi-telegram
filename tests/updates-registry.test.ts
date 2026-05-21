/**
 * Regression tests for Telegram update handler registry
 * Covers globalThis-shared registry semantics, dispatch order, consume short-circuit, and wrapped handleUpdate composition
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  createTelegramUpdateHandle,
  getTelegramUpdateHandlerRegistry,
  registerTelegramUpdateHandler,
  type TelegramUpdateHandler,
  type TelegramUpdateHandlerRegistry,
} from "../lib/updates.ts";

const REGISTRY_KEY = "__piTelegramUpdateHandlerRegistry__";

function clearGlobalRegistry(): void {
  delete (globalThis as Record<string, unknown>)[REGISTRY_KEY];
}

function getGlobalRegistry(): TelegramUpdateHandlerRegistry | undefined {
  return (globalThis as Record<string, unknown>)[REGISTRY_KEY] as
    | TelegramUpdateHandlerRegistry
    | undefined;
}

test("Registry is created lazily on first access and reused", () => {
  clearGlobalRegistry();
  assert.equal(getGlobalRegistry(), undefined);
  const first = getTelegramUpdateHandlerRegistry();
  assert.equal(first.version, 1);
  const second = getTelegramUpdateHandlerRegistry();
  assert.equal(first, second);
  assert.equal(getGlobalRegistry(), first);
  clearGlobalRegistry();
});

test("Registry is shared across import paths via globalThis", () => {
  clearGlobalRegistry();
  const fromHelper = getTelegramUpdateHandlerRegistry();
  const fromGlobal = getGlobalRegistry();
  assert.equal(fromHelper, fromGlobal);
  clearGlobalRegistry();
});

test("Dispatch returns 'pass' when no handlers are registered", async () => {
  clearGlobalRegistry();
  const registry = getTelegramUpdateHandlerRegistry();
  const verdict = await registry.dispatch({ update_id: 1 });
  assert.equal(verdict, "pass");
  clearGlobalRegistry();
});

test("registerTelegramUpdateHandler registers handlers and disposer removes them", async () => {
  clearGlobalRegistry();
  const seen: unknown[] = [];
  const handler: TelegramUpdateHandler = (update) => {
    seen.push(update);
    return "pass";
  };
  const off = registerTelegramUpdateHandler(handler);
  await getTelegramUpdateHandlerRegistry().dispatch({ update_id: 1 });
  assert.deepEqual(seen, [{ update_id: 1 }]);
  off();
  await getTelegramUpdateHandlerRegistry().dispatch({ update_id: 2 });
  assert.deepEqual(seen, [{ update_id: 1 }]);
  clearGlobalRegistry();
});

test("Consume short-circuits later handlers and bubbles up to dispatch", async () => {
  clearGlobalRegistry();
  const calls: string[] = [];
  const off1 = registerTelegramUpdateHandler((update) => {
    calls.push("first");
    const cb = (update as { callback_query?: { data?: string } })
      .callback_query;
    if (cb?.data === "myext:ok") return "consume";
    return "pass";
  });
  const off2 = registerTelegramUpdateHandler(() => {
    calls.push("second");
    return "pass";
  });
  const consumed = await getTelegramUpdateHandlerRegistry().dispatch({
    callback_query: { data: "myext:ok" },
  });
  assert.equal(consumed, "consume");
  assert.deepEqual(calls, ["first"]);

  calls.length = 0;
  const passed = await getTelegramUpdateHandlerRegistry().dispatch({
    callback_query: { data: "other" },
  });
  assert.equal(passed, "pass");
  assert.deepEqual(calls, ["first", "second"]);
  off1();
  off2();
  clearGlobalRegistry();
});

test("Handler errors do not break polling and do not consume the update", async () => {
  clearGlobalRegistry();
  const calls: string[] = [];
  const offThrow = registerTelegramUpdateHandler(() => {
    calls.push("thrower");
    throw new Error("boom");
  });
  const offAfter = registerTelegramUpdateHandler(() => {
    calls.push("after");
    return "pass";
  });
  const verdict = await getTelegramUpdateHandlerRegistry().dispatch({
    update_id: 1,
  });
  assert.equal(verdict, "pass");
  assert.deepEqual(calls, ["thrower", "after"]);
  offThrow();
  offAfter();
  clearGlobalRegistry();
});

test("Void/undefined return values are treated as 'pass'", async () => {
  clearGlobalRegistry();
  const off = registerTelegramUpdateHandler(() => undefined);
  const verdict = await getTelegramUpdateHandlerRegistry().dispatch({
    update_id: 1,
  });
  assert.equal(verdict, "pass");
  off();
  clearGlobalRegistry();
});

test("createTelegramUpdateHandle skips defaultHandle on consume", async () => {
  clearGlobalRegistry();
  const defaultCalls: number[] = [];
  const defaultHandle = async (update: { update_id: number }) => {
    defaultCalls.push(update.update_id);
  };
  const off = registerTelegramUpdateHandler((update) => {
    const id = (update as { update_id?: number }).update_id;
    return id === 99 ? "consume" : "pass";
  });
  const handler = createTelegramUpdateHandle({ defaultHandle });
  await handler({ update_id: 1 }, undefined);
  await handler({ update_id: 99 }, undefined);
  await handler({ update_id: 2 }, undefined);
  assert.deepEqual(defaultCalls, [1, 2]);
  off();
  clearGlobalRegistry();
});

test("createTelegramUpdateHandle calls defaultHandle when no handlers registered", async () => {
  clearGlobalRegistry();
  const defaultCalls: unknown[] = [];
  const defaultHandle = async (update: { update_id: number }, ctx: string) => {
    defaultCalls.push({ update, ctx });
  };
  const handler = createTelegramUpdateHandle({ defaultHandle });
  await handler({ update_id: 7 }, "ctx");
  assert.deepEqual(defaultCalls, [{ update: { update_id: 7 }, ctx: "ctx" }]);
  clearGlobalRegistry();
});

test("Pre-existing docs-style registry missing 'dispatch' is replaced with a valid one", async () => {
  // Simulate a layered extension that loaded first and installed an early
  // draft of the zero-coupling registry shape (only `version` and `add`).
  // pi-telegram must not reuse it as-is, because its polling runtime calls
  // `dispatch` on whatever it finds and would crash on the first update.
  clearGlobalRegistry();
  const docsHandlers = new Set<TelegramUpdateHandler>();
  const docsStyle = {
    version: 1,
    add(handler: TelegramUpdateHandler) {
      docsHandlers.add(handler);
      return () => docsHandlers.delete(handler);
    },
    // dispatch deliberately missing
  };
  (globalThis as Record<string, unknown>)[REGISTRY_KEY] = docsStyle;

  const registry = getTelegramUpdateHandlerRegistry();
  assert.notEqual(registry, docsStyle as unknown);
  assert.equal(registry.version, 1);
  assert.equal(typeof registry.add, "function");
  assert.equal(typeof registry.dispatch, "function");
  // Polling loop must succeed against the replacement registry.
  const verdict = await registry.dispatch({ update_id: 1 });
  assert.equal(verdict, "pass");
  // Replacement is now the canonical registry on globalThis.
  assert.equal(getGlobalRegistry(), registry);
  clearGlobalRegistry();
});

test("Pre-existing malformed registry (wrong types) is replaced", async () => {
  clearGlobalRegistry();
  const malformed = {
    version: 1,
    add: "not a function",
    dispatch: 42,
  };
  (globalThis as Record<string, unknown>)[REGISTRY_KEY] = malformed;

  const registry = getTelegramUpdateHandlerRegistry();
  assert.notEqual(registry, malformed as unknown);
  assert.equal(typeof registry.add, "function");
  assert.equal(typeof registry.dispatch, "function");
  const verdict = await registry.dispatch({ update_id: 1 });
  assert.equal(verdict, "pass");
  clearGlobalRegistry();
});

test("Pre-existing registry with future version is replaced (v1 runtime, v2 squatter)", () => {
  clearGlobalRegistry();
  const futureShape = {
    version: 2,
    add: () => () => {},
    dispatch: async () => "pass" as const,
  };
  (globalThis as Record<string, unknown>)[REGISTRY_KEY] = futureShape;

  const registry = getTelegramUpdateHandlerRegistry();
  assert.notEqual(registry, futureShape as unknown);
  assert.equal(registry.version, 1);
  clearGlobalRegistry();
});

test("Pre-existing fully-formed v1 registry from a layered extension is reused", async () => {
  // Documented happy path: a layered extension implements the full v1
  // contract (including `dispatch`) before pi-telegram loads. Both sides
  // must converge on the same object so handlers registered through either
  // path see the same updates.
  clearGlobalRegistry();
  const handlers = new Set<TelegramUpdateHandler>();
  const layered: TelegramUpdateHandlerRegistry = {
    version: 1,
    add(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    async dispatch(update) {
      for (const handler of handlers) {
        const r = await handler(update);
        if (r === "consume") return "consume";
      }
      return "pass";
    },
  };
  (globalThis as Record<string, unknown>)[REGISTRY_KEY] = layered;

  const registry = getTelegramUpdateHandlerRegistry();
  assert.equal(registry, layered);

  const seen: unknown[] = [];
  const off = registerTelegramUpdateHandler((update) => {
    seen.push(update);
    return "pass";
  });
  await registry.dispatch({ update_id: 1 });
  assert.deepEqual(seen, [{ update_id: 1 }]);
  off();
  clearGlobalRegistry();
});

test("Pre-existing non-object value at registry key is replaced", () => {
  clearGlobalRegistry();
  (globalThis as Record<string, unknown>)[REGISTRY_KEY] = "not an object";
  const registry = getTelegramUpdateHandlerRegistry();
  assert.equal(registry.version, 1);
  assert.equal(typeof registry.dispatch, "function");
  clearGlobalRegistry();
});

test("createTelegramUpdateHandle accepts an explicit registry override", async () => {
  clearGlobalRegistry();
  const seen: unknown[] = [];
  const customRegistry: TelegramUpdateHandlerRegistry = {
    version: 1,
    add: () => () => {},
    async dispatch(update) {
      seen.push(update);
      return "consume";
    },
  };
  const defaultCalls: unknown[] = [];
  const handler = createTelegramUpdateHandle({
    defaultHandle: async (update) => {
      defaultCalls.push(update);
    },
    registry: customRegistry,
  });
  await handler({ update_id: 1 }, undefined);
  assert.deepEqual(seen, [{ update_id: 1 }]);
  assert.deepEqual(defaultCalls, []);
  // Global registry should remain untouched.
  assert.equal(getGlobalRegistry(), undefined);
  clearGlobalRegistry();
});
