/**
 * Regression tests for the Telegram polling domain
 * Covers polling request helpers, stop conditions, and the long-poll loop runtime in one suite
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTelegramInitialSyncRequest,
  buildTelegramLongPollRequest,
  createTelegramPollingActivityReader,
  createTelegramPollingController,
  createTelegramPollingControllerRuntime,
  createTelegramPollingControllerState,
  createTelegramPollLoopRunner,
  getLatestTelegramUpdateId,
  isTelegramPollingControllerActive,
  runTelegramPollLoop,
  shouldStartTelegramPolling,
  shouldStopTelegramPolling,
  startTelegramPollingRuntime,
  stopTelegramPollingRuntime,
  TELEGRAM_ALLOWED_UPDATES,
} from "../lib/polling.ts";

const TEST_CONTEXT = "ctx";

test("Polling helpers build the initial sync request", () => {
  assert.deepEqual(buildTelegramInitialSyncRequest(), {
    offset: -1,
    limit: 1,
    timeout: 0,
  });
});

test("Polling helpers build long-poll requests with and without lastUpdateId", () => {
  assert.deepEqual(buildTelegramLongPollRequest(), {
    offset: undefined,
    limit: 10,
    timeout: 30,
    allowed_updates: TELEGRAM_ALLOWED_UPDATES,
  });
  assert.deepEqual(buildTelegramLongPollRequest(41), {
    offset: 42,
    limit: 10,
    timeout: 30,
    allowed_updates: TELEGRAM_ALLOWED_UPDATES,
  });
});

test("Polling helpers extract the latest update id", () => {
  assert.equal(getLatestTelegramUpdateId([]), undefined);
  assert.equal(
    getLatestTelegramUpdateId([{ update_id: 1 }, { update_id: 7 }]),
    7,
  );
});

test("Polling helpers start only when a bot token exists and polling is idle", () => {
  assert.equal(
    shouldStartTelegramPolling({
      hasBotToken: true,
      hasPollingPromise: false,
    }),
    true,
  );
  assert.equal(
    shouldStartTelegramPolling({
      hasBotToken: false,
      hasPollingPromise: false,
    }),
    false,
  );
  assert.equal(
    shouldStartTelegramPolling({
      hasBotToken: true,
      hasPollingPromise: true,
    }),
    false,
  );
});

test("Polling runtime starts and stops polling through state ports", async () => {
  const events: string[] = [];
  let pollingPromise: Promise<void> | undefined;
  let pollingController: AbortController | undefined;
  let finishPollLoop: (() => void) | undefined;
  const deps = {
    hasBotToken: () => true,
    getPollingPromise: () => pollingPromise,
    setPollingPromise: (promise: Promise<void> | undefined) => {
      pollingPromise = promise;
      events.push(`promise:${promise ? "set" : "clear"}`);
    },
    getPollingController: () => pollingController,
    setPollingController: (controller: AbortController | undefined) => {
      pollingController = controller;
      events.push(`controller:${controller ? "set" : "clear"}`);
    },
    stopTypingLoop: () => {
      events.push("typing:stop");
    },
    runPollLoop: async (_ctx: string, signal: AbortSignal) => {
      events.push(`run:${signal.aborted}`);
      await new Promise<void>((resolve) => {
        finishPollLoop = resolve;
      });
    },
    updateStatus: (ctx: string) => {
      events.push(`status:${ctx}`);
    },
  };
  startTelegramPollingRuntime("ctx", deps);
  assert.equal(!!pollingPromise, true);
  assert.equal(!!pollingController, true);
  const stopPromise = stopTelegramPollingRuntime(deps);
  assert.equal(pollingController, undefined);
  finishPollLoop?.();
  await stopPromise;
  assert.deepEqual(events, [
    "controller:set",
    "run:false",
    "promise:set",
    "status:ctx",
    "typing:stop",
    "controller:clear",
    "promise:clear",
    "controller:clear",
    "status:ctx",
    "promise:clear",
  ]);
});

test("Polling controller owns polling promise and abort-controller state", async () => {
  const events: string[] = [];
  let finishPollLoop: (() => void) | undefined;
  const state = createTelegramPollingControllerState();
  const isPollingActive = createTelegramPollingActivityReader(state);
  const controller = createTelegramPollingController({
    state,
    hasBotToken: () => true,
    stopTypingLoop: () => {
      events.push("typing:stop");
    },
    runPollLoop: async (_ctx: string, signal: AbortSignal) => {
      events.push(`run:${signal.aborted}`);
      await new Promise<void>((resolve) => {
        finishPollLoop = resolve;
      });
    },
    updateStatus: (ctx: string) => {
      events.push(`status:${ctx}`);
    },
  });
  controller.start("ctx");
  assert.equal(controller.isActive(), true);
  assert.equal(isTelegramPollingControllerActive(state), true);
  assert.equal(isPollingActive(), true);
  controller.start("ctx");
  const stopPromise = controller.stop();
  finishPollLoop?.();
  await stopPromise;
  assert.equal(controller.isActive(), false);
  assert.equal(isTelegramPollingControllerActive(state), false);
  assert.equal(isPollingActive(), false);
  assert.deepEqual(events, [
    "run:false",
    "status:ctx",
    "typing:stop",
    "status:ctx",
  ]);
});

test("Polling controller runtime binds loop runner and controller state", async () => {
  const events: string[] = [];
  const state = createTelegramPollingControllerState();
  const controller = createTelegramPollingControllerRuntime({
    state,
    getConfig: () => ({ botToken: "123:abc" }),
    hasBotToken: () => true,
    deleteWebhook: async () => {
      events.push("deleteWebhook");
    },
    getUpdates: async () => {
      throw new DOMException("stop", "AbortError");
    },
    persistConfig: async () => {
      events.push("persist");
    },
    handleUpdate: async () => {
      events.push("handle");
    },
    stopTypingLoop: () => {
      events.push("typing:stop");
    },
    updateStatus: (_ctx: string, message?: string) => {
      events.push(`status:${message ?? "ok"}`);
    },
  });
  controller.start("ctx");
  assert.equal(controller.isActive(), true);
  await controller.stop();
  assert.equal(controller.isActive(), false);
  assert.deepEqual(events, [
    "deleteWebhook",
    "status:ok",
    "typing:stop",
    "status:ok",
  ]);
});

test("Polling helpers stop only for abort conditions", () => {
  assert.equal(shouldStopTelegramPolling(true, new Error("ignored")), true);
  assert.equal(
    shouldStopTelegramPolling(false, new DOMException("aborted", "AbortError")),
    true,
  );
  assert.equal(shouldStopTelegramPolling(false, new Error("network")), false);
});

test("Poll loop runner binds config, status, and transport ports", async () => {
  const config: { botToken: string; lastUpdateId?: number } = {
    botToken: "123:abc",
    lastUpdateId: 5,
  };
  const events: string[] = [];
  let calls = 0;
  const runPollLoop = createTelegramPollLoopRunner({
    getConfig: () => config,
    deleteWebhook: async () => {
      events.push("deleteWebhook");
    },
    getUpdates: async () => {
      calls += 1;
      if (calls === 1) return [{ update_id: 6 }];
      throw new DOMException("stop", "AbortError");
    },
    persistConfig: async () => {
      events.push(`persist:${config.lastUpdateId}`);
    },
    handleUpdate: async (update, ctx: string) => {
      events.push(`handle:${ctx}:${update.update_id}`);
    },
    updateStatus: (ctx, message) => {
      events.push(`status:${ctx}:${message ?? "ok"}`);
    },
    sleep: async () => {
      events.push("sleep");
    },
  });
  await runPollLoop("ctx", new AbortController().signal);
  assert.deepEqual(events, ["deleteWebhook", "handle:ctx:6", "persist:6"]);
});

test("Poll loop initializes lastUpdateId and processes updates", async () => {
  const handled: number[] = [];
  const config: { botToken: string; lastUpdateId?: number } = {
    botToken: "123:abc",
  };
  let getUpdatesCalls = 0;
  let persistCount = 0;
  const signal = new AbortController().signal;
  await runTelegramPollLoop({
    ctx: TEST_CONTEXT,
    signal,
    config,
    deleteWebhook: async () => {},
    getUpdates: async () => {
      getUpdatesCalls += 1;
      if (getUpdatesCalls === 1) {
        return [{ update_id: 5 }];
      }
      if (getUpdatesCalls === 2) {
        return [{ update_id: 6 }, { update_id: 7 }];
      }
      throw new DOMException("stop", "AbortError");
    },
    persistConfig: async () => {
      persistCount += 1;
    },
    handleUpdate: async (update) => {
      handled.push(update.update_id);
    },
    onErrorStatus: () => {},
    onStatusReset: () => {},
    sleep: async () => {},
  });
  assert.equal(config.lastUpdateId, 7);
  assert.deepEqual(handled, [6, 7]);
  assert.equal(persistCount, 3);
});

test("Poll loop persists long-poll offsets only after handling updates", async () => {
  const config = { botToken: "123:abc", lastUpdateId: 5 };
  const handled: number[] = [];
  const persisted: number[] = [];
  let calls = 0;
  await runTelegramPollLoop({
    ctx: TEST_CONTEXT,
    signal: new AbortController().signal,
    config,
    deleteWebhook: async () => {},
    getUpdates: async () => {
      calls += 1;
      if (calls === 1) return [{ update_id: 6 }];
      throw new DOMException("stop", "AbortError");
    },
    persistConfig: async () => {
      persisted.push(config.lastUpdateId ?? -1);
    },
    handleUpdate: async (update) => {
      handled.push(update.update_id);
      throw new Error("handler failed");
    },
    onErrorStatus: () => {},
    onStatusReset: () => {},
    sleep: async () => {},
  });
  assert.deepEqual(handled, [6]);
  assert.equal(config.lastUpdateId, 5);
  assert.deepEqual(persisted, []);
});

test("Poll loop skips repeatedly failing updates after the configured threshold", async () => {
  const config = { botToken: "123:abc", lastUpdateId: 5 };
  const persisted: number[] = [];
  const statusMessages: string[] = [];
  const runtimeEvents: string[] = [];
  let calls = 0;
  await runTelegramPollLoop({
    ctx: TEST_CONTEXT,
    signal: new AbortController().signal,
    config,
    maxUpdateFailures: 2,
    deleteWebhook: async () => {},
    getUpdates: async () => {
      calls += 1;
      if (calls <= 2) return [{ update_id: 6 }];
      throw new DOMException("stop", "AbortError");
    },
    persistConfig: async () => {
      persisted.push(config.lastUpdateId ?? -1);
    },
    handleUpdate: async () => {
      throw new Error("handler failed");
    },
    onErrorStatus: (message) => {
      statusMessages.push(message);
    },
    onStatusReset: () => {
      statusMessages.push("reset");
    },
    sleep: async (ms) => {
      statusMessages.push(`sleep:${ms}`);
    },
    recordRuntimeEvent: (category, error, details) => {
      const message = error instanceof Error ? error.message : String(error);
      runtimeEvents.push(
        `${category}:${message}:${details?.phase}:${details?.failureCount}`,
      );
    },
  });
  assert.equal(config.lastUpdateId, 6);
  assert.deepEqual(persisted, [6]);
  assert.deepEqual(statusMessages, [
    "handler failed",
    "sleep:3000",
    "reset",
    "skipping Telegram update 6 after 2 failures: handler failed",
  ]);
  assert.deepEqual(runtimeEvents, [
    "polling:handler failed:handleUpdate:1",
    "polling:handler failed:handleUpdate:2",
  ]);
});

test("Poll loop reports retryable errors and sleeps before retrying", async () => {
  const config = { botToken: "123:abc", lastUpdateId: 1 };
  const statusMessages: string[] = [];
  const runtimeEvents: string[] = [];
  let calls = 0;
  await runTelegramPollLoop({
    ctx: TEST_CONTEXT,
    signal: new AbortController().signal,
    config,
    deleteWebhook: async () => {},
    getUpdates: async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("network down");
      }
      throw new DOMException("stop", "AbortError");
    },
    persistConfig: async () => {},
    handleUpdate: async () => {},
    onErrorStatus: (message) => {
      statusMessages.push(`error:${message}`);
    },
    onStatusReset: () => {
      statusMessages.push("reset");
    },
    sleep: async (ms) => {
      statusMessages.push(`sleep:${ms}`);
    },
    recordRuntimeEvent: (category, error, details) => {
      const message = error instanceof Error ? error.message : String(error);
      runtimeEvents.push(`${category}:${message}:${details?.phase}`);
    },
  });
  assert.deepEqual(statusMessages, [
    "error:network down",
    "sleep:3000",
    "reset",
  ]);
  assert.deepEqual(runtimeEvents, ["polling:network down:loop"]);
});
