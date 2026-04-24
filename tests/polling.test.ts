/**
 * Regression tests for the Telegram polling domain
 * Covers polling request helpers, stop conditions, and the long-poll loop runtime in one suite
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  TELEGRAM_ALLOWED_UPDATES,
  buildTelegramInitialSyncRequest,
  buildTelegramLongPollRequest,
  getLatestTelegramUpdateId,
  runTelegramPollLoop,
  shouldStopTelegramPolling,
} from "../lib/polling.ts";

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

test("Polling helpers stop only for abort conditions", () => {
  assert.equal(shouldStopTelegramPolling(true, new Error("ignored")), true);
  assert.equal(
    shouldStopTelegramPolling(false, new DOMException("aborted", "AbortError")),
    true,
  );
  assert.equal(shouldStopTelegramPolling(false, new Error("network")), false);
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
    ctx: {} as never,
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
    ctx: {} as never,
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
  let calls = 0;
  await runTelegramPollLoop({
    ctx: {} as never,
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
  });
  assert.equal(config.lastUpdateId, 6);
  assert.deepEqual(persisted, [6]);
  assert.deepEqual(statusMessages, [
    "handler failed",
    "sleep:3000",
    "reset",
    "skipping Telegram update 6 after 2 failures: handler failed",
  ]);
});

test("Poll loop reports retryable errors and sleeps before retrying", async () => {
  const config = { botToken: "123:abc", lastUpdateId: 1 };
  const statusMessages: string[] = [];
  let calls = 0;
  await runTelegramPollLoop({
    ctx: {} as never,
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
  });
  assert.deepEqual(statusMessages, [
    "error:network down",
    "sleep:3000",
    "reset",
  ]);
});
