/**
 * Regression tests for the Telegram time-injection runtime
 * Covers mode gating, interval bookkeeping per chat, and timezone formatting
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveTelegramTimeInjectionConfig,
  type ResolvedTelegramTimeInjectionConfig,
} from "../lib/config.ts";
import {
  createTimeInjectionRuntime,
  formatTelegramTimeInjectionLine,
} from "../lib/time-injection.ts";

function makeRuntime(config: Partial<ResolvedTelegramTimeInjectionConfig>) {
  const resolved = resolveTelegramTimeInjectionConfig(config);
  return createTimeInjectionRuntime({ getConfig: () => resolved });
}

test("Time injection config resolves defaults when keys are missing", () => {
  const resolved = resolveTelegramTimeInjectionConfig(undefined);
  assert.equal(resolved.mode, "off");
  assert.equal(resolved.intervalSeconds, 3600);
  assert.equal(typeof resolved.timezone, "string");
  assert.ok(resolved.timezone.length > 0);
});

test("Time injection config rejects non-positive intervalSeconds", () => {
  const resolved = resolveTelegramTimeInjectionConfig({
    mode: "interval",
    intervalSeconds: 0,
  });
  assert.equal(resolved.intervalSeconds, 3600);
});

test("Time injection config falls back when timezone is invalid", () => {
  const resolved = resolveTelegramTimeInjectionConfig({
    mode: "always",
    timezone: "not/a-zone",
  });
  assert.notEqual(resolved.timezone, "not/a-zone");
  assert.ok(resolved.timezone.length > 0);
});

test("Time injection runtime returns null for every call when mode is off", () => {
  const runtime = makeRuntime({ mode: "off", timezone: "UTC" });
  for (let i = 0; i < 5; i++) {
    assert.equal(runtime.resolveLine(1, new Date(i * 1000)), null);
  }
});

test("Time injection runtime returns formatted line on every call when mode is always", () => {
  const runtime = makeRuntime({ mode: "always", timezone: "UTC" });
  const first = runtime.resolveLine(1, new Date("2026-05-16T14:32:10Z"));
  const second = runtime.resolveLine(1, new Date("2026-05-16T14:32:11Z"));
  assert.equal(first, "2026-05-16 14:32:10 UTC");
  assert.equal(second, "2026-05-16 14:32:11 UTC");
});

test("Time injection runtime suppresses repeat lines within the interval window", () => {
  const runtime = makeRuntime({
    mode: "interval",
    intervalSeconds: 60,
    timezone: "UTC",
  });
  const t0 = new Date("2026-05-16T14:00:00Z");
  const tWithin = new Date("2026-05-16T14:00:30Z");
  const tAfter = new Date("2026-05-16T14:01:01Z");
  assert.equal(runtime.resolveLine(1, t0), "2026-05-16 14:00:00 UTC");
  assert.equal(runtime.resolveLine(1, tWithin), null);
  assert.equal(runtime.resolveLine(1, tAfter), "2026-05-16 14:01:01 UTC");
});

test("Time injection runtime tracks interval state per chatId", () => {
  const runtime = makeRuntime({
    mode: "interval",
    intervalSeconds: 60,
    timezone: "UTC",
  });
  const t0 = new Date("2026-05-16T14:00:00Z");
  const tWithin = new Date("2026-05-16T14:00:30Z");
  assert.ok(runtime.resolveLine(1, t0));
  assert.equal(runtime.resolveLine(1, tWithin), null);
  // Different chat should not be gated by chat 1's recent injection
  assert.ok(runtime.resolveLine(2, tWithin));
});

test("Time injection formatting honours the requested timezone", () => {
  const now = new Date("2026-05-16T14:32:10Z");
  assert.equal(
    formatTelegramTimeInjectionLine(now, "UTC"),
    "2026-05-16 14:32:10 UTC",
  );
  // Europe/Berlin is UTC+2 in May (CEST)
  assert.equal(
    formatTelegramTimeInjectionLine(now, "Europe/Berlin"),
    "2026-05-16 16:32:10 Europe/Berlin",
  );
});
