/**
 * Regression tests for Telegram command helpers
 * Covers slash-command normalization, bot suffix stripping, arguments, and non-command input
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTelegramCommandAction,
  executeTelegramCommandAction,
  parseTelegramCommand,
} from "../lib/commands.ts";

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

test("Command helpers build command actions", () => {
  assert.deepEqual(buildTelegramCommandAction("stop"), { kind: "stop" });
  assert.deepEqual(buildTelegramCommandAction("compact"), { kind: "compact" });
  assert.deepEqual(buildTelegramCommandAction("status"), { kind: "status" });
  assert.deepEqual(buildTelegramCommandAction("model"), { kind: "model" });
  assert.deepEqual(buildTelegramCommandAction("help"), {
    kind: "help",
    commandName: "help",
  });
  assert.deepEqual(buildTelegramCommandAction("start"), {
    kind: "help",
    commandName: "start",
  });
  assert.deepEqual(buildTelegramCommandAction("unknown"), { kind: "ignore" });
  assert.deepEqual(buildTelegramCommandAction(undefined), { kind: "ignore" });
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
    await executeTelegramCommandAction({ kind: "ignore" }, {}, {}, deps),
    false,
  );
  assert.equal(
    await executeTelegramCommandAction({ kind: "stop" }, {}, {}, deps),
    true,
  );
  assert.equal(
    await executeTelegramCommandAction(
      { kind: "help", commandName: "start" },
      {},
      {},
      deps,
    ),
    true,
  );
  assert.deepEqual(events, ["stop", "help:start"]);
});
