import test from "node:test";
import assert from "node:assert/strict";

import { __telegramTestUtils } from "../index.ts";

test("Dispatch is allowed only when every guard is clear", () => {
  assert.equal(
    __telegramTestUtils.canDispatchTelegramTurnState({
      compactionInProgress: false,
      hasActiveTelegramTurn: false,
      hasPendingTelegramDispatch: false,
      isIdle: true,
      hasPendingMessages: false,
    }),
    true,
  );
});

test("Dispatch is blocked during compaction", () => {
  assert.equal(
    __telegramTestUtils.canDispatchTelegramTurnState({
      compactionInProgress: true,
      hasActiveTelegramTurn: false,
      hasPendingTelegramDispatch: false,
      isIdle: true,
      hasPendingMessages: false,
    }),
    false,
  );
});

test("Dispatch is blocked while a Telegram turn is active or pending", () => {
  assert.equal(
    __telegramTestUtils.canDispatchTelegramTurnState({
      compactionInProgress: false,
      hasActiveTelegramTurn: true,
      hasPendingTelegramDispatch: false,
      isIdle: true,
      hasPendingMessages: false,
    }),
    false,
  );
  assert.equal(
    __telegramTestUtils.canDispatchTelegramTurnState({
      compactionInProgress: false,
      hasActiveTelegramTurn: false,
      hasPendingTelegramDispatch: true,
      isIdle: true,
      hasPendingMessages: false,
    }),
    false,
  );
});

test("Dispatch is blocked when pi is busy or has pending messages", () => {
  assert.equal(
    __telegramTestUtils.canDispatchTelegramTurnState({
      compactionInProgress: false,
      hasActiveTelegramTurn: false,
      hasPendingTelegramDispatch: false,
      isIdle: false,
      hasPendingMessages: false,
    }),
    false,
  );
  assert.equal(
    __telegramTestUtils.canDispatchTelegramTurnState({
      compactionInProgress: false,
      hasActiveTelegramTurn: false,
      hasPendingTelegramDispatch: false,
      isIdle: true,
      hasPendingMessages: true,
    }),
    false,
  );
});

test("In-flight model switch is allowed only for active Telegram turns with abort support", () => {
  assert.equal(
    __telegramTestUtils.canRestartTelegramTurnForModelSwitch({
      isIdle: false,
      hasActiveTelegramTurn: true,
      hasAbortHandler: true,
    }),
    true,
  );
  assert.equal(
    __telegramTestUtils.canRestartTelegramTurnForModelSwitch({
      isIdle: true,
      hasActiveTelegramTurn: true,
      hasAbortHandler: true,
    }),
    false,
  );
  assert.equal(
    __telegramTestUtils.canRestartTelegramTurnForModelSwitch({
      isIdle: false,
      hasActiveTelegramTurn: false,
      hasAbortHandler: true,
    }),
    false,
  );
  assert.equal(
    __telegramTestUtils.canRestartTelegramTurnForModelSwitch({
      isIdle: false,
      hasActiveTelegramTurn: true,
      hasAbortHandler: false,
    }),
    false,
  );
});

test("Continuation prompt stays Telegram-scoped and resume-oriented", () => {
  const text = __telegramTestUtils.buildTelegramModelSwitchContinuationText(
    { provider: "openai", id: "gpt-5", name: "GPT-5" },
    "high",
  );
  assert.match(text, /^\[telegram\]/);
  assert.match(text, /Continue the interrupted previous Telegram request/);
  assert.match(text, /openai\/gpt-5/);
  assert.match(text, /thinking level \(high\)/);
});
