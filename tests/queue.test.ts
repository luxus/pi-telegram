/**
 * Regression tests for Telegram queue and runtime decision helpers
 * Exercises queue ordering, mutation, dispatch planning, lifecycle plans, and model-switch guard behavior
 */

import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import telegramExtension, { __telegramTestUtils } from "../index.ts";
import {
  buildTelegramAgentStartPlan,
  buildTelegramSessionShutdownState,
  buildTelegramSessionStartState,
  executeTelegramControlItemRuntime,
  executeTelegramQueueDispatchPlan,
  formatQueuedTelegramItemsStatus,
  getNextTelegramToolExecutionCount,
  shouldStartTelegramPolling,
} from "../lib/queue.ts";

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}

test("Control-lane items sort before priority and default prompt items", () => {
  const queueItemType = undefined as
    | Parameters<typeof __telegramTestUtils.compareTelegramQueueItems>[0]
    | undefined;
  const defaultPrompt: typeof queueItemType = {
    kind: "prompt",
    chatId: 1,
    replyToMessageId: 1,
    sourceMessageIds: [1],
    queueOrder: 10,
    queueLane: "default",
    laneOrder: 10,
    queuedAttachments: [],
    content: [{ type: "text", text: "default" }],
    historyText: "default",
    statusSummary: "default",
  };
  const priorityPrompt: typeof queueItemType = {
    kind: "prompt",
    chatId: 1,
    replyToMessageId: 2,
    sourceMessageIds: [2],
    queueOrder: 11,
    queueLane: "priority",
    laneOrder: 0,
    queuedAttachments: [],
    content: [{ type: "text", text: "priority" }],
    historyText: "priority",
    statusSummary: "priority",
  };
  const controlItem: typeof queueItemType = {
    kind: "control",
    controlType: "status",
    chatId: 1,
    replyToMessageId: 3,
    queueOrder: 12,
    queueLane: "control",
    laneOrder: 0,
    statusSummary: "control",
    execute: async () => {},
  };
  const items = [defaultPrompt, controlItem, priorityPrompt].sort(
    __telegramTestUtils.compareTelegramQueueItems,
  );
  assert.deepEqual(
    items.map((item) => item?.statusSummary),
    ["control", "priority", "default"],
  );
});

test("Queue mutation helpers remove prompt items by Telegram message id", () => {
  const queueItemType = undefined as
    | Parameters<
        typeof __telegramTestUtils.removeTelegramQueueItemsByMessageIds
      >[0][number]
    | undefined;
  const promptItem: typeof queueItemType = {
    kind: "prompt",
    chatId: 1,
    replyToMessageId: 1,
    sourceMessageIds: [11, 12],
    queueOrder: 1,
    queueLane: "default",
    laneOrder: 1,
    queuedAttachments: [],
    content: [{ type: "text", text: "prompt" }],
    historyText: "prompt history",
    statusSummary: "prompt",
  };
  const controlItem: typeof queueItemType = {
    kind: "control",
    controlType: "status",
    chatId: 1,
    replyToMessageId: 2,
    queueOrder: 2,
    queueLane: "control",
    laneOrder: 0,
    statusSummary: "control",
    execute: async () => {},
  };
  const result = __telegramTestUtils.removeTelegramQueueItemsByMessageIds(
    [promptItem, controlItem],
    [12],
  );
  assert.equal(result.removedCount, 1);
  assert.deepEqual(
    result.items.map((item) => item.statusSummary),
    ["control"],
  );
});

test("Queue mutation helpers apply and clear prompt priority without touching control items", () => {
  const queueItemType = undefined as
    | Parameters<
        typeof __telegramTestUtils.prioritizeTelegramQueuePrompt
      >[0][number]
    | undefined;
  const promptItem: typeof queueItemType = {
    kind: "prompt",
    chatId: 1,
    replyToMessageId: 1,
    sourceMessageIds: [11],
    queueOrder: 4,
    queueLane: "default",
    laneOrder: 4,
    queuedAttachments: [],
    content: [{ type: "text", text: "prompt" }],
    historyText: "prompt history",
    statusSummary: "prompt",
  };
  const controlItem: typeof queueItemType = {
    kind: "control",
    controlType: "status",
    chatId: 1,
    replyToMessageId: 2,
    queueOrder: 5,
    queueLane: "control",
    laneOrder: 0,
    statusSummary: "control",
    execute: async () => {},
  };
  const prioritized = __telegramTestUtils.prioritizeTelegramQueuePrompt(
    [promptItem, controlItem],
    11,
    0,
  );
  assert.equal(prioritized.changed, true);
  assert.equal(prioritized.items[0]?.queueLane, "priority");
  const cleared = __telegramTestUtils.clearTelegramQueuePromptPriority(
    prioritized.items,
    11,
  );
  assert.equal(cleared.changed, true);
  assert.equal(cleared.items[0]?.queueLane, "default");
  assert.equal(cleared.items[1]?.queueLane, "control");
});

test("Queued status formatting marks priority prompts in the pi status bar", () => {
  const queueItemType = undefined as
    | Parameters<typeof formatQueuedTelegramItemsStatus>[0][number]
    | undefined;
  const priorityPrompt: typeof queueItemType = {
    kind: "prompt",
    chatId: 1,
    replyToMessageId: 1,
    sourceMessageIds: [11],
    queueOrder: 4,
    queueLane: "priority",
    laneOrder: 0,
    queuedAttachments: [],
    content: [{ type: "text", text: "prompt" }],
    historyText: "prompt history",
    statusSummary: "prompt",
  };
  const defaultPrompt: typeof queueItemType = {
    kind: "prompt",
    chatId: 1,
    replyToMessageId: 2,
    sourceMessageIds: [12],
    queueOrder: 5,
    queueLane: "default",
    laneOrder: 5,
    queuedAttachments: [],
    content: [{ type: "text", text: "default" }],
    historyText: "default history",
    statusSummary: "default",
  };
  const controlItem: typeof queueItemType = {
    kind: "control",
    controlType: "status",
    chatId: 1,
    replyToMessageId: 3,
    queueOrder: 6,
    queueLane: "control",
    laneOrder: 0,
    statusSummary: "⚡ status",
    execute: async () => {},
  };
  assert.equal(
    formatQueuedTelegramItemsStatus([
      controlItem,
      priorityPrompt,
      defaultPrompt,
    ]),
    " +3: [⚡ status, ⬆ prompt, default]",
  );
});

test("History partition keeps control items queued and extracts prompt items", () => {
  const queueItemType = undefined as
    | Parameters<
        typeof __telegramTestUtils.partitionTelegramQueueItemsForHistory
      >[0][number]
    | undefined;
  const promptItem: typeof queueItemType = {
    kind: "prompt",
    chatId: 1,
    replyToMessageId: 1,
    sourceMessageIds: [1],
    queueOrder: 1,
    queueLane: "default",
    laneOrder: 1,
    queuedAttachments: [],
    content: [{ type: "text", text: "prompt" }],
    historyText: "prompt history",
    statusSummary: "prompt",
  };
  const controlItem: typeof queueItemType = {
    kind: "control",
    controlType: "status",
    chatId: 1,
    replyToMessageId: 2,
    queueOrder: 2,
    queueLane: "control",
    laneOrder: 0,
    statusSummary: "control",
    execute: async () => {},
  };
  const result = __telegramTestUtils.partitionTelegramQueueItemsForHistory([
    promptItem,
    controlItem,
  ]);
  assert.deepEqual(
    result.historyTurns.map((item) => item.statusSummary),
    ["prompt"],
  );
  assert.deepEqual(
    result.remainingItems.map((item) => item.statusSummary),
    ["control"],
  );
});

test("Dispatch planning returns the prompt item when dispatch is allowed", () => {
  const queueItemType = undefined as
    | Parameters<
        typeof __telegramTestUtils.planNextTelegramQueueAction
      >[0][number]
    | undefined;
  const controlItem: typeof queueItemType = {
    kind: "control",
    controlType: "status",
    chatId: 1,
    replyToMessageId: 1,
    queueOrder: 1,
    queueLane: "control",
    laneOrder: 0,
    statusSummary: "control",
    execute: async () => {},
  };
  const promptItem: typeof queueItemType = {
    kind: "prompt",
    chatId: 1,
    replyToMessageId: 2,
    sourceMessageIds: [2],
    queueOrder: 2,
    queueLane: "default",
    laneOrder: 2,
    queuedAttachments: [],
    content: [{ type: "text", text: "prompt" }],
    historyText: "prompt history",
    statusSummary: "prompt",
  };
  const result = __telegramTestUtils.planNextTelegramQueueAction(
    [promptItem, controlItem],
    true,
  );
  assert.equal(result.kind, "prompt");
  assert.equal(
    result.kind === "prompt" ? result.item.statusSummary : "",
    "prompt",
  );
  assert.deepEqual(
    result.remainingItems.map((item) => item.statusSummary),
    ["prompt", "control"],
  );
});

test("Dispatch planning runs control items before normal prompts", () => {
  const queueItemType = undefined as
    | Parameters<
        typeof __telegramTestUtils.planNextTelegramQueueAction
      >[0][number]
    | undefined;
  const controlItem: typeof queueItemType = {
    kind: "control",
    controlType: "status",
    chatId: 1,
    replyToMessageId: 1,
    queueOrder: 1,
    queueLane: "control",
    laneOrder: 0,
    statusSummary: "control",
    execute: async () => {},
  };
  const promptItem: typeof queueItemType = {
    kind: "prompt",
    chatId: 1,
    replyToMessageId: 2,
    sourceMessageIds: [2],
    queueOrder: 2,
    queueLane: "default",
    laneOrder: 2,
    queuedAttachments: [],
    content: [{ type: "text", text: "prompt" }],
    historyText: "prompt history",
    statusSummary: "prompt",
  };
  const result = __telegramTestUtils.planNextTelegramQueueAction(
    [controlItem, promptItem],
    true,
  );
  assert.equal(result.kind, "control");
  assert.equal(
    result.kind === "control" ? result.item.statusSummary : "",
    "control",
  );
  assert.deepEqual(
    result.remainingItems.map((item) => item.statusSummary),
    ["prompt"],
  );
});

test("Dispatch planning returns none when dispatch is blocked", () => {
  const queueItemType = undefined as
    | Parameters<
        typeof __telegramTestUtils.planNextTelegramQueueAction
      >[0][number]
    | undefined;
  const promptItem: typeof queueItemType = {
    kind: "prompt",
    chatId: 1,
    replyToMessageId: 2,
    sourceMessageIds: [2],
    queueOrder: 2,
    queueLane: "default",
    laneOrder: 2,
    queuedAttachments: [],
    content: [{ type: "text", text: "prompt" }],
    historyText: "prompt history",
    statusSummary: "prompt",
  };
  const result = __telegramTestUtils.planNextTelegramQueueAction(
    [promptItem],
    false,
  );
  assert.equal(result.kind, "none");
  assert.deepEqual(
    result.remainingItems.map((item) => item.statusSummary),
    ["prompt"],
  );
});

test("Control-item dispatch sequencing hands off to the next prompt", () => {
  const queueItemType = undefined as
    | Parameters<
        typeof __telegramTestUtils.planNextTelegramQueueAction
      >[0][number]
    | undefined;
  const controlItem: typeof queueItemType = {
    kind: "control",
    controlType: "status",
    chatId: 1,
    replyToMessageId: 1,
    queueOrder: 1,
    queueLane: "control",
    laneOrder: 0,
    statusSummary: "control",
    execute: async () => {},
  };
  const promptItem: typeof queueItemType = {
    kind: "prompt",
    chatId: 1,
    replyToMessageId: 2,
    sourceMessageIds: [2],
    queueOrder: 2,
    queueLane: "default",
    laneOrder: 2,
    queuedAttachments: [],
    content: [{ type: "text", text: "prompt" }],
    historyText: "prompt history",
    statusSummary: "prompt",
  };
  const firstStep = __telegramTestUtils.planNextTelegramQueueAction(
    [controlItem, promptItem],
    true,
  );
  assert.equal(firstStep.kind, "control");
  const secondStep = __telegramTestUtils.planNextTelegramQueueAction(
    firstStep.remainingItems,
    true,
  );
  assert.equal(secondStep.kind, "prompt");
  assert.equal(
    secondStep.kind === "prompt" ? secondStep.item.statusSummary : "",
    "prompt",
  );
});

test("Preserved abort leaves queued prompts waiting for explicit continuation", () => {
  assert.equal(
    __telegramTestUtils.shouldDispatchAfterTelegramAgentEnd({
      hasTurn: true,
      stopReason: "aborted",
      preserveQueuedTurnsAsHistory: true,
    }),
    false,
  );
  const queueItemType = undefined as
    | Parameters<
        typeof __telegramTestUtils.planNextTelegramQueueAction
      >[0][number]
    | undefined;
  const promptItem: typeof queueItemType = {
    kind: "prompt",
    chatId: 1,
    replyToMessageId: 2,
    sourceMessageIds: [2],
    queueOrder: 2,
    queueLane: "default",
    laneOrder: 2,
    queuedAttachments: [],
    content: [{ type: "text", text: "prompt" }],
    historyText: "prompt history",
    statusSummary: "prompt",
  };
  const blockedDispatch = __telegramTestUtils.planNextTelegramQueueAction(
    [promptItem],
    __telegramTestUtils.shouldDispatchAfterTelegramAgentEnd({
      hasTurn: true,
      stopReason: "aborted",
      preserveQueuedTurnsAsHistory: true,
    }),
  );
  assert.equal(blockedDispatch.kind, "none");
  assert.deepEqual(
    blockedDispatch.remainingItems.map((item) => item.statusSummary),
    ["prompt"],
  );
});

test("Agent end dispatch policy resumes after success and error, but not preserved aborts", () => {
  assert.equal(
    __telegramTestUtils.shouldDispatchAfterTelegramAgentEnd({
      hasTurn: false,
      preserveQueuedTurnsAsHistory: false,
    }),
    true,
  );
  assert.equal(
    __telegramTestUtils.shouldDispatchAfterTelegramAgentEnd({
      hasTurn: true,
      stopReason: "error",
      preserveQueuedTurnsAsHistory: false,
    }),
    true,
  );
  assert.equal(
    __telegramTestUtils.shouldDispatchAfterTelegramAgentEnd({
      hasTurn: true,
      stopReason: "aborted",
      preserveQueuedTurnsAsHistory: false,
    }),
    true,
  );
  assert.equal(
    __telegramTestUtils.shouldDispatchAfterTelegramAgentEnd({
      hasTurn: true,
      stopReason: "aborted",
      preserveQueuedTurnsAsHistory: true,
    }),
    false,
  );
});

test("Agent end plan classifies turn outcomes correctly", () => {
  const noTurnPlan = __telegramTestUtils.buildTelegramAgentEndPlan({
    hasTurn: false,
    preserveQueuedTurnsAsHistory: false,
    hasFinalText: false,
    hasQueuedAttachments: false,
  });
  assert.equal(noTurnPlan.kind, "no-turn");
  assert.equal(noTurnPlan.shouldDispatchNext, true);
  const abortedPlan = __telegramTestUtils.buildTelegramAgentEndPlan({
    hasTurn: true,
    stopReason: "aborted",
    preserveQueuedTurnsAsHistory: true,
    hasFinalText: false,
    hasQueuedAttachments: true,
  });
  assert.equal(abortedPlan.kind, "aborted");
  assert.equal(abortedPlan.shouldClearPreview, true);
  assert.equal(abortedPlan.shouldDispatchNext, false);
  const errorPlan = __telegramTestUtils.buildTelegramAgentEndPlan({
    hasTurn: true,
    stopReason: "error",
    preserveQueuedTurnsAsHistory: false,
    hasFinalText: false,
    hasQueuedAttachments: false,
  });
  assert.equal(errorPlan.kind, "error");
  assert.equal(errorPlan.shouldSendErrorMessage, true);
  const attachmentPlan = __telegramTestUtils.buildTelegramAgentEndPlan({
    hasTurn: true,
    preserveQueuedTurnsAsHistory: false,
    hasFinalText: false,
    hasQueuedAttachments: true,
  });
  assert.equal(attachmentPlan.kind, "attachments-only");
  assert.equal(attachmentPlan.shouldSendAttachmentNotice, true);
  const textPlan = __telegramTestUtils.buildTelegramAgentEndPlan({
    hasTurn: true,
    preserveQueuedTurnsAsHistory: false,
    hasFinalText: true,
    hasQueuedAttachments: false,
  });
  assert.equal(textPlan.kind, "text");
  assert.equal(textPlan.shouldClearPreview, false);
});

test("Agent start plan consumes a dispatched prompt and resets transient flags", () => {
  const queueItemType = undefined as
    | Parameters<typeof buildTelegramAgentStartPlan>[0]["queuedItems"][number]
    | undefined;
  const promptItem: typeof queueItemType = {
    kind: "prompt",
    chatId: 1,
    replyToMessageId: 2,
    sourceMessageIds: [2],
    queueOrder: 2,
    queueLane: "default",
    laneOrder: 2,
    queuedAttachments: [],
    content: [{ type: "text", text: "prompt" }],
    historyText: "prompt history",
    statusSummary: "prompt",
  };
  const plan = buildTelegramAgentStartPlan({
    queuedItems: [promptItem],
    hasPendingDispatch: true,
    hasActiveTurn: false,
  });
  assert.equal(plan.activeTurn?.statusSummary, "prompt");
  assert.equal(plan.shouldClearDispatchPending, true);
  assert.equal(plan.shouldResetPendingModelSwitch, true);
  assert.equal(plan.shouldResetToolExecutions, true);
  assert.deepEqual(plan.remainingItems, []);
});

test("Tool execution count helper respects active-turn presence", () => {
  assert.equal(
    getNextTelegramToolExecutionCount({
      hasActiveTurn: true,
      currentCount: 0,
      event: "start",
    }),
    1,
  );
  assert.equal(
    getNextTelegramToolExecutionCount({
      hasActiveTurn: true,
      currentCount: 1,
      event: "end",
    }),
    0,
  );
  assert.equal(
    getNextTelegramToolExecutionCount({
      hasActiveTurn: false,
      currentCount: 3,
      event: "end",
    }),
    3,
  );
});

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

test("Pending model switch abort waits until no tool executions remain", () => {
  assert.equal(
    __telegramTestUtils.shouldTriggerPendingTelegramModelSwitchAbort({
      hasPendingModelSwitch: true,
      hasActiveTelegramTurn: true,
      hasAbortHandler: true,
      activeToolExecutions: 0,
    }),
    true,
  );
  assert.equal(
    __telegramTestUtils.shouldTriggerPendingTelegramModelSwitchAbort({
      hasPendingModelSwitch: true,
      hasActiveTelegramTurn: true,
      hasAbortHandler: true,
      activeToolExecutions: 1,
    }),
    false,
  );
  assert.equal(
    __telegramTestUtils.shouldTriggerPendingTelegramModelSwitchAbort({
      hasPendingModelSwitch: false,
      hasActiveTelegramTurn: true,
      hasAbortHandler: true,
      activeToolExecutions: 0,
    }),
    false,
  );
});

test("Model-switch continuation restart queues before abort when state is present", () => {
  const events: string[] = [];
  assert.equal(
    __telegramTestUtils.restartTelegramModelSwitchContinuation({
      activeTurn: { id: 1 },
      abort: () => {
        events.push("abort");
      },
      selection: { model: { provider: "openai", id: "gpt-5" } },
      queueContinuation: (turn, selection) => {
        events.push(`queue:${turn.id}:${selection.model.id}`);
      },
    }),
    true,
  );
  assert.deepEqual(events, ["queue:1:gpt-5", "abort"]);
  assert.equal(
    __telegramTestUtils.restartTelegramModelSwitchContinuation({
      activeTurn: undefined,
      abort: () => {},
      selection: { model: { provider: "openai", id: "gpt-5" } },
      queueContinuation: () => {
        events.push("unexpected");
      },
    }),
    false,
  );
});

test("Continuation prompt stays Telegram-scoped and resume-oriented", () => {
  const text = __telegramTestUtils.buildTelegramModelSwitchContinuationText(
    { provider: "openai", id: "gpt-5" },
    "high",
  );
  assert.match(text, /^\[telegram\]/);
  assert.match(text, /Continue the interrupted previous Telegram request/);
  assert.match(text, /openai\/gpt-5/);
  assert.match(text, /thinking level \(high\)/);
});

test("Control runtime runs the control item and always settles", async () => {
  const events: string[] = [];
  await executeTelegramControlItemRuntime(
    {
      kind: "control",
      controlType: "status",
      chatId: 1,
      replyToMessageId: 2,
      queueOrder: 1,
      queueLane: "control",
      laneOrder: 0,
      statusSummary: "status",
      execute: async () => {
        events.push("execute");
      },
    },
    {
      ctx: {} as never,
      sendTextReply: async () => {
        events.push("reply");
        return undefined;
      },
      onSettled: () => {
        events.push("settled");
      },
    },
  );
  assert.deepEqual(events, ["execute", "settled"]);
});

test("Control runtime reports failures before settling", async () => {
  const events: string[] = [];
  await executeTelegramControlItemRuntime(
    {
      kind: "control",
      controlType: "model",
      chatId: 3,
      replyToMessageId: 4,
      queueOrder: 2,
      queueLane: "control",
      laneOrder: 1,
      statusSummary: "model",
      execute: async () => {
        throw new Error("boom");
      },
    },
    {
      ctx: {} as never,
      sendTextReply: async (_chatId, _replyToMessageId, text) => {
        events.push(text);
        return undefined;
      },
      onSettled: () => {
        events.push("settled");
      },
    },
  );
  assert.deepEqual(events, ["Telegram control action failed: boom", "settled"]);
});

test("Dispatch runtime idles on none and executes control items directly", () => {
  const events: string[] = [];
  executeTelegramQueueDispatchPlan(
    { kind: "none", remainingItems: [] },
    {
      executeControlItem: () => {
        events.push("control");
      },
      onPromptDispatchStart: () => {
        events.push("prompt-start");
      },
      sendUserMessage: () => {
        events.push("prompt");
      },
      onPromptDispatchFailure: (message) => {
        events.push(`error:${message}`);
      },
      onIdle: () => {
        events.push("idle");
      },
    },
  );
  executeTelegramQueueDispatchPlan(
    {
      kind: "control",
      item: {
        kind: "control",
        controlType: "status",
        chatId: 1,
        replyToMessageId: 1,
        queueOrder: 1,
        queueLane: "control",
        laneOrder: 0,
        statusSummary: "status",
        execute: async () => {},
      },
      remainingItems: [],
    },
    {
      executeControlItem: () => {
        events.push("control");
      },
      onPromptDispatchStart: () => {
        events.push("prompt-start");
      },
      sendUserMessage: () => {
        events.push("prompt");
      },
      onPromptDispatchFailure: (message) => {
        events.push(`error:${message}`);
      },
      onIdle: () => {
        events.push("idle");
      },
    },
  );
  assert.deepEqual(events, ["idle", "control"]);
});

test("Dispatch runtime reports prompt dispatch failures after starting", () => {
  const events: string[] = [];
  executeTelegramQueueDispatchPlan(
    {
      kind: "prompt",
      item: {
        kind: "prompt",
        chatId: 2,
        replyToMessageId: 3,
        sourceMessageIds: [3],
        queueOrder: 2,
        queueLane: "default",
        laneOrder: 2,
        queuedAttachments: [],
        content: [{ type: "text", text: "prompt" }],
        historyText: "prompt",
        statusSummary: "prompt",
      },
      remainingItems: [],
    },
    {
      executeControlItem: () => {
        events.push("control");
      },
      onPromptDispatchStart: (chatId) => {
        events.push(`start:${chatId}`);
      },
      sendUserMessage: () => {
        throw new Error("boom");
      },
      onPromptDispatchFailure: (message) => {
        events.push(`error:${message}`);
      },
      onIdle: () => {
        events.push("idle");
      },
    },
  );
  assert.deepEqual(events, ["start:2", "error:boom"]);
});

test("Session runtime helper starts polling only when a bot token exists and polling is idle", () => {
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

test("Session runtime helper resets session start state", () => {
  const currentModel = { provider: "openai", id: "gpt-5" } as const;
  const state = buildTelegramSessionStartState(currentModel as never);
  assert.equal(state.currentTelegramModel, currentModel);
  assert.equal(state.activeTelegramToolExecutions, 0);
  assert.equal(state.nextQueuedTelegramItemOrder, 0);
  assert.equal(state.nextQueuedTelegramControlOrder, 0);
  assert.equal(state.telegramTurnDispatchPending, false);
  assert.equal(state.compactionInProgress, false);
});

test("Session runtime helper clears shutdown state", () => {
  const state = buildTelegramSessionShutdownState<string>();
  assert.deepEqual(state.queuedTelegramItems, []);
  assert.equal(state.nextQueuedTelegramItemOrder, 0);
  assert.equal(state.nextQueuedTelegramControlOrder, 0);
  assert.equal(state.nextPriorityReactionOrder, 0);
  assert.equal(state.currentTelegramModel, undefined);
  assert.equal(state.activeTelegramToolExecutions, 0);
  assert.equal(state.telegramTurnDispatchPending, false);
  assert.equal(state.compactionInProgress, false);
  assert.equal(state.preserveQueuedTurnsAsHistory, false);
});

test("Extension runtime polls, pairs, and dispatches an inbound Telegram turn into pi", async () => {
  const agentDir = join(homedir(), ".pi", "agent");
  const configPath = join(agentDir, "telegram.json");
  const previousConfig = await readFile(configPath, "utf8").catch(
    () => undefined,
  );
  const handlers = new Map<
    string,
    (event: unknown, ctx: unknown) => Promise<unknown>
  >();
  const commands = new Map<
    string,
    { handler: (args: string, ctx: unknown) => Promise<void> }
  >();
  const sentMessages: Array<string | Array<{ type: string; text?: string }>> =
    [];
  let resolveDispatch:
    | ((value: string | Array<{ type: string; text?: string }>) => void)
    | undefined;
  const dispatched = new Promise<
    string | Array<{ type: string; text?: string }>
  >((resolve) => {
    resolveDispatch = resolve;
  });
  const pi = {
    on: (
      event: string,
      handler: (event: unknown, ctx: unknown) => Promise<unknown>,
    ) => {
      handlers.set(event, handler);
    },
    registerCommand: (
      name: string,
      definition: { handler: (args: string, ctx: unknown) => Promise<void> },
    ) => {
      commands.set(name, definition);
    },
    registerTool: () => {},
    sendUserMessage: (
      content: string | Array<{ type: string; text?: string }>,
    ) => {
      sentMessages.push(content);
      resolveDispatch?.(content);
    },
    getThinkingLevel: () => "medium",
  } as never;
  const originalFetch = globalThis.fetch;
  let getUpdatesCalls = 0;
  const apiCalls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = url.split("/").at(-1) ?? "";
    apiCalls.push(method);
    if (method === "deleteWebhook") {
      return { json: async () => ({ ok: true, result: true }) } as Response;
    }
    if (method === "getUpdates") {
      getUpdatesCalls += 1;
      if (getUpdatesCalls === 1) {
        return {
          json: async () => ({
            ok: true,
            result: [
              {
                _: "other",
                update_id: 1,
                message: {
                  message_id: 42,
                  chat: { id: 99, type: "private" },
                  from: { id: 77, is_bot: false, first_name: "Test" },
                  text: "hello from telegram",
                },
              },
            ],
          }),
        } as Response;
      }
      throw new DOMException("stop", "AbortError");
    }
    if (method === "sendMessage") {
      return {
        json: async () => ({ ok: true, result: { message_id: 100 } }),
      } as Response;
    }
    if (method === "sendChatAction") {
      return { json: async () => ({ ok: true, result: true }) } as Response;
    }
    throw new Error(`Unexpected Telegram API method: ${method}`);
  };
  try {
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify({ botToken: "123:abc", lastUpdateId: 0 }, null, "\t") +
        "\n",
      "utf8",
    );
    telegramExtension(pi);
    const ctx = {
      hasUI: true,
      model: undefined,
      signal: undefined,
      ui: {
        theme: {
          fg: (_token: string, text: string) => text,
        },
        setStatus: () => {},
        notify: () => {},
      },
      isIdle: () => true,
      hasPendingMessages: () => false,
      abort: () => {},
    } as never;
    await handlers.get("session_start")?.({}, ctx);
    await commands.get("telegram-connect")?.handler("", ctx);
    const dispatchedContent = await dispatched;
    assert.equal(sentMessages.length, 1);
    assert.equal(Array.isArray(dispatchedContent), true);
    assert.equal(apiCalls.includes("sendMessage"), true);
    assert.equal(apiCalls.includes("sendChatAction"), true);
    const promptBlocks = dispatchedContent as Array<{
      type: string;
      text?: string;
    }>;
    assert.equal(promptBlocks[0]?.type, "text");
    assert.match(
      promptBlocks[0]?.text ?? "",
      /^\[telegram\] hello from telegram$/,
    );
    await handlers.get("session_shutdown")?.({}, ctx);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousConfig === undefined) {
      await rm(configPath, { force: true });
    } else {
      await writeFile(configPath, previousConfig, "utf8");
    }
  }
});

test("Extension runtime finalizes a drafted preview into the final Telegram reply on agent end", async () => {
  const agentDir = join(homedir(), ".pi", "agent");
  const configPath = join(agentDir, "telegram.json");
  const previousConfig = await readFile(configPath, "utf8").catch(
    () => undefined,
  );
  const handlers = new Map<
    string,
    (event: unknown, ctx: unknown) => Promise<unknown>
  >();
  const commands = new Map<
    string,
    { handler: (args: string, ctx: unknown) => Promise<void> }
  >();
  let resolveDispatch: (() => void) | undefined;
  const dispatched = new Promise<void>((resolve) => {
    resolveDispatch = resolve;
  });
  const draftTexts: string[] = [];
  const sentTexts: string[] = [];
  const pi = {
    on: (
      event: string,
      handler: (event: unknown, ctx: unknown) => Promise<unknown>,
    ) => {
      handlers.set(event, handler);
    },
    registerCommand: (
      name: string,
      definition: { handler: (args: string, ctx: unknown) => Promise<void> },
    ) => {
      commands.set(name, definition);
    },
    registerTool: () => {},
    sendUserMessage: () => {
      resolveDispatch?.();
    },
    getThinkingLevel: () => "medium",
  } as never;
  const originalFetch = globalThis.fetch;
  let getUpdatesCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = url.split("/").at(-1) ?? "";
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined;
    if (method === "deleteWebhook") {
      return { json: async () => ({ ok: true, result: true }) } as Response;
    }
    if (method === "getUpdates") {
      getUpdatesCalls += 1;
      if (getUpdatesCalls === 1) {
        return {
          json: async () => ({
            ok: true,
            result: [
              {
                _: "other",
                update_id: 1,
                message: {
                  message_id: 7,
                  chat: { id: 99, type: "private" },
                  from: { id: 77, is_bot: false, first_name: "Test" },
                  text: "please answer",
                },
              },
            ],
          }),
        } as Response;
      }
      throw new DOMException("stop", "AbortError");
    }
    if (method === "sendMessageDraft") {
      draftTexts.push(String(body?.text ?? ""));
      return { json: async () => ({ ok: true, result: true }) } as Response;
    }
    if (method === "sendMessage") {
      sentTexts.push(String(body?.text ?? ""));
      return {
        json: async () => ({
          ok: true,
          result: { message_id: 100 + sentTexts.length },
        }),
      } as Response;
    }
    if (method === "sendChatAction") {
      return { json: async () => ({ ok: true, result: true }) } as Response;
    }
    if (method === "editMessageText") {
      return { json: async () => ({ ok: true, result: true }) } as Response;
    }
    throw new Error(`Unexpected Telegram API method: ${method}`);
  };
  try {
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify(
        { botToken: "123:abc", allowedUserId: 77, lastUpdateId: 0 },
        null,
        "\t",
      ) + "\n",
      "utf8",
    );
    telegramExtension(pi);
    const ctx = {
      hasUI: true,
      model: undefined,
      signal: undefined,
      ui: {
        theme: {
          fg: (_token: string, text: string) => text,
        },
        setStatus: () => {},
        notify: () => {},
      },
      isIdle: () => true,
      hasPendingMessages: () => false,
      abort: () => {},
    } as never;
    await handlers.get("session_start")?.({}, ctx);
    await commands.get("telegram-connect")?.handler("", ctx);
    await dispatched;
    await handlers.get("agent_start")?.({}, ctx);
    await handlers.get("message_update")?.(
      {
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Draft **preview**" }],
        },
      },
      ctx,
    );
    await new Promise((resolve) => setTimeout(resolve, 850));
    await handlers.get("agent_end")?.(
      {
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: "Final **answer**" }],
          },
        ],
      },
      ctx,
    );
    assert.deepEqual(draftTexts, ["Draft preview", "Final answer", ""]);
    assert.equal(sentTexts.length, 1);
    assert.match(sentTexts[0] ?? "", /Final <b>answer<\/b>/);
    await handlers.get("session_shutdown")?.({}, ctx);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousConfig === undefined) {
      await rm(configPath, { force: true });
    } else {
      await writeFile(configPath, previousConfig, "utf8");
    }
  }
});

test("Extension runtime carries queued follow-ups into history after an aborted turn", async () => {
  const agentDir = join(homedir(), ".pi", "agent");
  const configPath = join(agentDir, "telegram.json");
  const previousConfig = await readFile(configPath, "utf8").catch(
    () => undefined,
  );
  const handlers = new Map<
    string,
    (event: unknown, ctx: unknown) => Promise<unknown>
  >();
  const commands = new Map<
    string,
    { handler: (args: string, ctx: unknown) => Promise<void> }
  >();
  const sentMessages: Array<string | Array<{ type: string; text?: string }>> =
    [];
  let firstDispatchResolved = false;
  let secondUpdatesResolve: ((value: Response) => void) | undefined;
  let thirdUpdatesResolve: ((value: Response) => void) | undefined;
  let fourthUpdatesResolve: ((value: Response) => void) | undefined;
  const secondUpdates = new Promise<Response>((resolve) => {
    secondUpdatesResolve = resolve;
  });
  const thirdUpdates = new Promise<Response>((resolve) => {
    thirdUpdatesResolve = resolve;
  });
  const fourthUpdates = new Promise<Response>((resolve) => {
    fourthUpdatesResolve = resolve;
  });
  const pi = {
    on: (
      event: string,
      handler: (event: unknown, ctx: unknown) => Promise<unknown>,
    ) => {
      handlers.set(event, handler);
    },
    registerCommand: (
      name: string,
      definition: { handler: (args: string, ctx: unknown) => Promise<void> },
    ) => {
      commands.set(name, definition);
    },
    registerTool: () => {},
    sendUserMessage: (
      content: string | Array<{ type: string; text?: string }>,
    ) => {
      sentMessages.push(content);
      firstDispatchResolved = true;
    },
    getThinkingLevel: () => "medium",
  } as never;
  const originalFetch = globalThis.fetch;
  let getUpdatesCalls = 0;
  const sendTexts: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = url.split("/").at(-1) ?? "";
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined;
    if (method === "deleteWebhook") {
      return { json: async () => ({ ok: true, result: true }) } as Response;
    }
    if (method === "getUpdates") {
      getUpdatesCalls += 1;
      if (getUpdatesCalls === 1) {
        return {
          json: async () => ({
            ok: true,
            result: [
              {
                _: "other",
                update_id: 1,
                message: {
                  message_id: 10,
                  chat: { id: 99, type: "private" },
                  from: { id: 77, is_bot: false, first_name: "Test" },
                  text: "first request",
                },
              },
            ],
          }),
        } as Response;
      }
      if (getUpdatesCalls === 2) return secondUpdates;
      if (getUpdatesCalls === 3) return thirdUpdates;
      if (getUpdatesCalls === 4) return fourthUpdates;
      throw new DOMException("stop", "AbortError");
    }
    if (method === "sendMessage") {
      sendTexts.push(String(body?.text ?? ""));
      return {
        json: async () => ({
          ok: true,
          result: { message_id: 100 + sendTexts.length },
        }),
      } as Response;
    }
    if (method === "sendChatAction") {
      return { json: async () => ({ ok: true, result: true }) } as Response;
    }
    throw new Error(`Unexpected Telegram API method: ${method}`);
  };
  try {
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify(
        { botToken: "123:abc", allowedUserId: 77, lastUpdateId: 0 },
        null,
        "\t",
      ) + "\n",
      "utf8",
    );
    telegramExtension(pi);
    const baseCtx = {
      hasUI: true,
      model: undefined,
      signal: undefined,
      ui: {
        theme: {
          fg: (_token: string, text: string) => text,
        },
        setStatus: () => {},
        notify: () => {},
      },
      hasPendingMessages: () => false,
    };
    const idleCtx = {
      ...baseCtx,
      isIdle: () => true,
      abort: () => {},
    } as never;
    let aborted = false;
    const activeCtx = {
      ...baseCtx,
      isIdle: () => false,
      abort: () => {
        aborted = true;
      },
    } as never;
    await handlers.get("session_start")?.({}, idleCtx);
    await commands.get("telegram-connect")?.handler("", idleCtx);
    await waitForCondition(() => firstDispatchResolved);
    await handlers.get("agent_start")?.({}, activeCtx);
    secondUpdatesResolve?.({
      json: async () => ({
        ok: true,
        result: [
          {
            _: "other",
            update_id: 2,
            message: {
              message_id: 11,
              chat: { id: 99, type: "private" },
              from: { id: 77, is_bot: false, first_name: "Test" },
              text: "follow up",
            },
          },
        ],
      }),
    } as Response);
    await waitForCondition(() => getUpdatesCalls >= 3);
    thirdUpdatesResolve?.({
      json: async () => ({
        ok: true,
        result: [
          {
            _: "other",
            update_id: 3,
            message: {
              message_id: 12,
              chat: { id: 99, type: "private" },
              from: { id: 77, is_bot: false, first_name: "Test" },
              text: "/stop",
            },
          },
        ],
      }),
    } as Response);
    await waitForCondition(() => aborted);
    await handlers.get("agent_end")?.(
      {
        messages: [
          {
            role: "assistant",
            stopReason: "aborted",
            content: [{ type: "text", text: "" }],
          },
        ],
      },
      idleCtx,
    );
    const dispatchCountBeforeNextTurn = sentMessages.length;
    fourthUpdatesResolve?.({
      json: async () => ({
        ok: true,
        result: [
          {
            _: "other",
            update_id: 4,
            message: {
              message_id: 13,
              chat: { id: 99, type: "private" },
              from: { id: 77, is_bot: false, first_name: "Test" },
              text: "new request",
            },
          },
        ],
      }),
    } as Response);
    await waitForCondition(
      () => sentMessages.length === dispatchCountBeforeNextTurn + 1,
    );
    const promptBlocks = sentMessages.at(-1) as Array<{
      type: string;
      text?: string;
    }>;
    const promptText = promptBlocks[0]?.text ?? "";
    assert.match(promptText, /^\[telegram\]/);
    assert.match(
      promptText,
      /Earlier Telegram messages arrived after an aborted turn/,
    );
    assert.match(promptText, /1\. follow up/);
    assert.match(promptText, /Current Telegram message:\nnew request/);
    assert.equal(sendTexts.includes("Aborted current turn."), true);
    await handlers.get("session_shutdown")?.({}, idleCtx);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousConfig === undefined) {
      await rm(configPath, { force: true });
    } else {
      await writeFile(configPath, previousConfig, "utf8");
    }
  }
});

test("Extension runtime runs queued status control before the next queued prompt after agent end", async () => {
  const agentDir = join(homedir(), ".pi", "agent");
  const configPath = join(agentDir, "telegram.json");
  const previousConfig = await readFile(configPath, "utf8").catch(
    () => undefined,
  );
  const handlers = new Map<
    string,
    (event: unknown, ctx: unknown) => Promise<unknown>
  >();
  const commands = new Map<
    string,
    { handler: (args: string, ctx: unknown) => Promise<void> }
  >();
  const runtimeEvents: string[] = [];
  let firstDispatchResolved = false;
  let secondUpdatesResolve: ((value: Response) => void) | undefined;
  let thirdUpdatesResolve: ((value: Response) => void) | undefined;
  const secondUpdates = new Promise<Response>((resolve) => {
    secondUpdatesResolve = resolve;
  });
  const thirdUpdates = new Promise<Response>((resolve) => {
    thirdUpdatesResolve = resolve;
  });
  const pi = {
    on: (
      event: string,
      handler: (event: unknown, ctx: unknown) => Promise<unknown>,
    ) => {
      handlers.set(event, handler);
    },
    registerCommand: (
      name: string,
      definition: { handler: (args: string, ctx: unknown) => Promise<void> },
    ) => {
      commands.set(name, definition);
    },
    registerTool: () => {},
    sendUserMessage: (
      content: string | Array<{ type: string; text?: string }>,
    ) => {
      const promptBlocks = content as Array<{ type: string; text?: string }>;
      runtimeEvents.push(`dispatch:${promptBlocks[0]?.text ?? ""}`);
      firstDispatchResolved = true;
    },
    getThinkingLevel: () => "medium",
  } as never;
  const originalFetch = globalThis.fetch;
  let getUpdatesCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = url.split("/").at(-1) ?? "";
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined;
    if (method === "deleteWebhook") {
      return { json: async () => ({ ok: true, result: true }) } as Response;
    }
    if (method === "getUpdates") {
      getUpdatesCalls += 1;
      if (getUpdatesCalls === 1) {
        return {
          json: async () => ({
            ok: true,
            result: [
              {
                _: "other",
                update_id: 1,
                message: {
                  message_id: 20,
                  chat: { id: 99, type: "private" },
                  from: { id: 77, is_bot: false, first_name: "Test" },
                  text: "first request",
                },
              },
            ],
          }),
        } as Response;
      }
      if (getUpdatesCalls === 2) return secondUpdates;
      if (getUpdatesCalls === 3) return thirdUpdates;
      throw new DOMException("stop", "AbortError");
    }
    if (method === "sendMessage") {
      runtimeEvents.push(`send:${String(body?.text ?? "")}`);
      return {
        json: async () => ({
          ok: true,
          result: { message_id: 100 + runtimeEvents.length },
        }),
      } as Response;
    }
    if (method === "sendChatAction") {
      return { json: async () => ({ ok: true, result: true }) } as Response;
    }
    throw new Error(`Unexpected Telegram API method: ${method}`);
  };
  try {
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify(
        { botToken: "123:abc", allowedUserId: 77, lastUpdateId: 0 },
        null,
        "\t",
      ) + "\n",
      "utf8",
    );
    telegramExtension(pi);
    const baseCtx = {
      hasUI: true,
      cwd: process.cwd(),
      model: undefined,
      signal: undefined,
      ui: {
        theme: {
          fg: (_token: string, text: string) => text,
        },
        setStatus: () => {},
        notify: () => {},
      },
      sessionManager: {
        getEntries: () => [],
      },
      modelRegistry: {
        refresh: () => {},
        getAvailable: () => [],
        isUsingOAuth: () => false,
      },
      getContextUsage: () => undefined,
      hasPendingMessages: () => false,
      abort: () => {},
    };
    const idleCtx = {
      ...baseCtx,
      isIdle: () => true,
    } as never;
    const activeCtx = {
      ...baseCtx,
      isIdle: () => false,
    } as never;
    await handlers.get("session_start")?.({}, idleCtx);
    await commands.get("telegram-connect")?.handler("", idleCtx);
    await waitForCondition(() => firstDispatchResolved);
    await handlers.get("agent_start")?.({}, activeCtx);
    secondUpdatesResolve?.({
      json: async () => ({
        ok: true,
        result: [
          {
            _: "other",
            update_id: 2,
            message: {
              message_id: 21,
              chat: { id: 99, type: "private" },
              from: { id: 77, is_bot: false, first_name: "Test" },
              text: "/status",
            },
          },
        ],
      }),
    } as Response);
    await waitForCondition(() => getUpdatesCalls >= 3);
    thirdUpdatesResolve?.({
      json: async () => ({
        ok: true,
        result: [
          {
            _: "other",
            update_id: 3,
            message: {
              message_id: 22,
              chat: { id: 99, type: "private" },
              from: { id: 77, is_bot: false, first_name: "Test" },
              text: "follow up after status",
            },
          },
        ],
      }),
    } as Response);
    await waitForCondition(() => runtimeEvents.length >= 1);
    await handlers.get("agent_end")?.(
      {
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: "" }],
          },
        ],
      },
      idleCtx,
    );
    await waitForCondition(() => runtimeEvents.length >= 3);
    assert.equal(runtimeEvents[0], "dispatch:[telegram] first request");
    assert.match(runtimeEvents[1] ?? "", /^send:<b>Context:<\/b>/);
    assert.equal(
      runtimeEvents[2],
      "dispatch:[telegram] follow up after status",
    );
    await handlers.get("session_shutdown")?.({}, idleCtx);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousConfig === undefined) {
      await rm(configPath, { force: true });
    } else {
      await writeFile(configPath, previousConfig, "utf8");
    }
  }
});

test("Extension runtime runs queued model control before the next queued prompt after agent end", async () => {
  const agentDir = join(homedir(), ".pi", "agent");
  const configPath = join(agentDir, "telegram.json");
  const previousConfig = await readFile(configPath, "utf8").catch(
    () => undefined,
  );
  const handlers = new Map<
    string,
    (event: unknown, ctx: unknown) => Promise<unknown>
  >();
  const commands = new Map<
    string,
    { handler: (args: string, ctx: unknown) => Promise<void> }
  >();
  const runtimeEvents: string[] = [];
  const modelA = {
    provider: "openai",
    id: "gpt-a",
    reasoning: true,
  } as const;
  const modelB = {
    provider: "anthropic",
    id: "claude-b",
    reasoning: false,
  } as const;
  let firstDispatchResolved = false;
  let secondUpdatesResolve: ((value: Response) => void) | undefined;
  let thirdUpdatesResolve: ((value: Response) => void) | undefined;
  const secondUpdates = new Promise<Response>((resolve) => {
    secondUpdatesResolve = resolve;
  });
  const thirdUpdates = new Promise<Response>((resolve) => {
    thirdUpdatesResolve = resolve;
  });
  const pi = {
    on: (
      event: string,
      handler: (event: unknown, ctx: unknown) => Promise<unknown>,
    ) => {
      handlers.set(event, handler);
    },
    registerCommand: (
      name: string,
      definition: { handler: (args: string, ctx: unknown) => Promise<void> },
    ) => {
      commands.set(name, definition);
    },
    registerTool: () => {},
    sendUserMessage: (
      content: string | Array<{ type: string; text?: string }>,
    ) => {
      const promptBlocks = content as Array<{ type: string; text?: string }>;
      runtimeEvents.push(`dispatch:${promptBlocks[0]?.text ?? ""}`);
      firstDispatchResolved = true;
    },
    getThinkingLevel: () => "medium",
  } as never;
  const originalFetch = globalThis.fetch;
  let getUpdatesCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = url.split("/").at(-1) ?? "";
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined;
    if (method === "deleteWebhook") {
      return { json: async () => ({ ok: true, result: true }) } as Response;
    }
    if (method === "getUpdates") {
      getUpdatesCalls += 1;
      if (getUpdatesCalls === 1) {
        return {
          json: async () => ({
            ok: true,
            result: [
              {
                _: "other",
                update_id: 1,
                message: {
                  message_id: 23,
                  chat: { id: 99, type: "private" },
                  from: { id: 77, is_bot: false, first_name: "Test" },
                  text: "first request",
                },
              },
            ],
          }),
        } as Response;
      }
      if (getUpdatesCalls === 2) return secondUpdates;
      if (getUpdatesCalls === 3) return thirdUpdates;
      throw new DOMException("stop", "AbortError");
    }
    if (method === "sendMessage") {
      runtimeEvents.push(`send:${String(body?.text ?? "")}`);
      return {
        json: async () => ({
          ok: true,
          result: { message_id: 100 + runtimeEvents.length },
        }),
      } as Response;
    }
    if (method === "sendChatAction") {
      return { json: async () => ({ ok: true, result: true }) } as Response;
    }
    throw new Error(`Unexpected Telegram API method: ${method}`);
  };
  try {
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify(
        { botToken: "123:abc", allowedUserId: 77, lastUpdateId: 0 },
        null,
        "\t",
      ) + "\n",
      "utf8",
    );
    telegramExtension(pi);
    const baseCtx = {
      hasUI: true,
      cwd: process.cwd(),
      model: modelA,
      signal: undefined,
      ui: {
        theme: {
          fg: (_token: string, text: string) => text,
        },
        setStatus: () => {},
        notify: () => {},
      },
      sessionManager: {
        getEntries: () => [],
      },
      modelRegistry: {
        refresh: () => {},
        getAvailable: () => [modelA, modelB],
        isUsingOAuth: () => false,
      },
      getContextUsage: () => undefined,
      hasPendingMessages: () => false,
      abort: () => {},
    };
    const idleCtx = {
      ...baseCtx,
      isIdle: () => true,
    } as never;
    const activeCtx = {
      ...baseCtx,
      isIdle: () => false,
    } as never;
    await handlers.get("session_start")?.({}, idleCtx);
    await commands.get("telegram-connect")?.handler("", idleCtx);
    await waitForCondition(() => firstDispatchResolved);
    await handlers.get("agent_start")?.({}, activeCtx);
    secondUpdatesResolve?.({
      json: async () => ({
        ok: true,
        result: [
          {
            _: "other",
            update_id: 2,
            message: {
              message_id: 24,
              chat: { id: 99, type: "private" },
              from: { id: 77, is_bot: false, first_name: "Test" },
              text: "/model",
            },
          },
        ],
      }),
    } as Response);
    await waitForCondition(() => getUpdatesCalls >= 3);
    thirdUpdatesResolve?.({
      json: async () => ({
        ok: true,
        result: [
          {
            _: "other",
            update_id: 3,
            message: {
              message_id: 25,
              chat: { id: 99, type: "private" },
              from: { id: 77, is_bot: false, first_name: "Test" },
              text: "follow up after model",
            },
          },
        ],
      }),
    } as Response);
    await waitForCondition(() => runtimeEvents.length >= 1);
    await handlers.get("agent_end")?.(
      {
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: "" }],
          },
        ],
      },
      idleCtx,
    );
    await waitForCondition(() => runtimeEvents.length >= 3);
    assert.equal(runtimeEvents[0], "dispatch:[telegram] first request");
    assert.equal(runtimeEvents[1], "send:<b>Choose a model:</b>");
    assert.equal(runtimeEvents[2], "dispatch:[telegram] follow up after model");
    await handlers.get("session_shutdown")?.({}, idleCtx);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousConfig === undefined) {
      await rm(configPath, { force: true });
    } else {
      await writeFile(configPath, previousConfig, "utf8");
    }
  }
});

test("Extension runtime keeps queued turns blocked until compaction completes", async () => {
  const agentDir = join(homedir(), ".pi", "agent");
  const configPath = join(agentDir, "telegram.json");
  const previousConfig = await readFile(configPath, "utf8").catch(
    () => undefined,
  );
  const handlers = new Map<
    string,
    (event: unknown, ctx: unknown) => Promise<unknown>
  >();
  const commands = new Map<
    string,
    { handler: (args: string, ctx: unknown) => Promise<void> }
  >();
  const runtimeEvents: string[] = [];
  let compactHooks:
    | {
        onComplete: () => void;
        onError: (error: unknown) => void;
      }
    | undefined;
  let secondUpdatesResolve: ((value: Response) => void) | undefined;
  const secondUpdates = new Promise<Response>((resolve) => {
    secondUpdatesResolve = resolve;
  });
  const pi = {
    on: (
      event: string,
      handler: (event: unknown, ctx: unknown) => Promise<unknown>,
    ) => {
      handlers.set(event, handler);
    },
    registerCommand: (
      name: string,
      definition: { handler: (args: string, ctx: unknown) => Promise<void> },
    ) => {
      commands.set(name, definition);
    },
    registerTool: () => {},
    sendUserMessage: (
      content: string | Array<{ type: string; text?: string }>,
    ) => {
      const promptBlocks = content as Array<{ type: string; text?: string }>;
      runtimeEvents.push(`dispatch:${promptBlocks[0]?.text ?? ""}`);
    },
    getThinkingLevel: () => "medium",
  } as never;
  const originalFetch = globalThis.fetch;
  let getUpdatesCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = url.split("/").at(-1) ?? "";
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined;
    if (method === "deleteWebhook") {
      return { json: async () => ({ ok: true, result: true }) } as Response;
    }
    if (method === "getUpdates") {
      getUpdatesCalls += 1;
      if (getUpdatesCalls === 1) {
        return {
          json: async () => ({
            ok: true,
            result: [
              {
                _: "other",
                update_id: 1,
                message: {
                  message_id: 30,
                  chat: { id: 99, type: "private" },
                  from: { id: 77, is_bot: false, first_name: "Test" },
                  text: "/compact",
                },
              },
            ],
          }),
        } as Response;
      }
      if (getUpdatesCalls === 2) {
        return secondUpdates;
      }
      throw new DOMException("stop", "AbortError");
    }
    if (method === "sendMessage") {
      runtimeEvents.push(`send:${String(body?.text ?? "")}`);
      return {
        json: async () => ({
          ok: true,
          result: { message_id: 100 + runtimeEvents.length },
        }),
      } as Response;
    }
    throw new Error(`Unexpected Telegram API method: ${method}`);
  };
  try {
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify(
        { botToken: "123:abc", allowedUserId: 77, lastUpdateId: 0 },
        null,
        "\t",
      ) + "\n",
      "utf8",
    );
    telegramExtension(pi);
    const ctx = {
      hasUI: true,
      model: undefined,
      signal: undefined,
      ui: {
        theme: {
          fg: (_token: string, text: string) => text,
        },
        setStatus: () => {},
        notify: () => {},
      },
      isIdle: () => true,
      hasPendingMessages: () => false,
      abort: () => {},
      compact: (hooks: {
        onComplete: () => void;
        onError: (error: unknown) => void;
      }) => {
        compactHooks = hooks;
        runtimeEvents.push("compact:start");
      },
    } as never;
    await handlers.get("session_start")?.({}, ctx);
    await commands.get("telegram-connect")?.handler("", ctx);
    await waitForCondition(() => runtimeEvents.includes("compact:start"));
    assert.equal(runtimeEvents.includes("send:Compaction started."), true);
    secondUpdatesResolve?.({
      json: async () => ({
        ok: true,
        result: [
          {
            _: "other",
            update_id: 2,
            message: {
              message_id: 31,
              chat: { id: 99, type: "private" },
              from: { id: 77, is_bot: false, first_name: "Test" },
              text: "follow up after compaction",
            },
          },
        ],
      }),
    } as Response);
    await waitForCondition(() => getUpdatesCalls >= 3);
    assert.equal(
      runtimeEvents.some(
        (event) => event === "dispatch:[telegram] follow up after compaction",
      ),
      false,
    );
    compactHooks?.onComplete();
    await waitForCondition(() =>
      runtimeEvents.includes("dispatch:[telegram] follow up after compaction"),
    );
    await waitForCondition(() =>
      runtimeEvents.includes("send:Compaction completed."),
    );
    await handlers.get("session_shutdown")?.({}, ctx);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousConfig === undefined) {
      await rm(configPath, { force: true });
    } else {
      await writeFile(configPath, previousConfig, "utf8");
    }
  }
});

test("Extension runtime coalesces media-group updates into one delayed dispatch", async () => {
  const agentDir = join(homedir(), ".pi", "agent");
  const configPath = join(agentDir, "telegram.json");
  const previousConfig = await readFile(configPath, "utf8").catch(
    () => undefined,
  );
  const handlers = new Map<
    string,
    (event: unknown, ctx: unknown) => Promise<unknown>
  >();
  const commands = new Map<
    string,
    { handler: (args: string, ctx: unknown) => Promise<void> }
  >();
  const runtimeEvents: string[] = [];
  const pi = {
    on: (
      event: string,
      handler: (event: unknown, ctx: unknown) => Promise<unknown>,
    ) => {
      handlers.set(event, handler);
    },
    registerCommand: (
      name: string,
      definition: { handler: (args: string, ctx: unknown) => Promise<void> },
    ) => {
      commands.set(name, definition);
    },
    registerTool: () => {},
    sendUserMessage: (
      content: string | Array<{ type: string; text?: string }>,
    ) => {
      const promptBlocks = content as Array<{ type: string; text?: string }>;
      runtimeEvents.push(`dispatch:${promptBlocks[0]?.text ?? ""}`);
    },
    getThinkingLevel: () => "medium",
  } as never;
  const originalFetch = globalThis.fetch;
  let getUpdatesCalls = 0;
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = url.split("/").at(-1) ?? "";
    if (method === "deleteWebhook") {
      return { json: async () => ({ ok: true, result: true }) } as Response;
    }
    if (method === "getUpdates") {
      getUpdatesCalls += 1;
      if (getUpdatesCalls === 1) {
        return {
          json: async () => ({
            ok: true,
            result: [
              {
                _: "other",
                update_id: 1,
                message: {
                  message_id: 40,
                  media_group_id: "album-1",
                  chat: { id: 99, type: "private" },
                  from: { id: 77, is_bot: false, first_name: "Test" },
                  caption: "first caption",
                },
              },
              {
                _: "other",
                update_id: 2,
                message: {
                  message_id: 41,
                  media_group_id: "album-1",
                  chat: { id: 99, type: "private" },
                  from: { id: 77, is_bot: false, first_name: "Test" },
                  caption: "second caption",
                },
              },
            ],
          }),
        } as Response;
      }
      throw new DOMException("stop", "AbortError");
    }
    throw new Error(`Unexpected Telegram API method: ${method}`);
  };
  try {
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify(
        { botToken: "123:abc", allowedUserId: 77, lastUpdateId: 0 },
        null,
        "\t",
      ) + "\n",
      "utf8",
    );
    telegramExtension(pi);
    const ctx = {
      hasUI: true,
      model: undefined,
      signal: undefined,
      ui: {
        theme: {
          fg: (_token: string, text: string) => text,
        },
        setStatus: () => {},
        notify: () => {},
      },
      isIdle: () => true,
      hasPendingMessages: () => false,
      abort: () => {},
    } as never;
    await handlers.get("session_start")?.({}, ctx);
    await commands.get("telegram-connect")?.handler("", ctx);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(runtimeEvents.length, 0);
    await waitForCondition(() => runtimeEvents.length === 1, 2500);
    assert.equal(
      runtimeEvents[0],
      "dispatch:[telegram] first caption\n\nsecond caption",
    );
    await handlers.get("session_shutdown")?.({}, ctx);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousConfig === undefined) {
      await rm(configPath, { force: true });
    } else {
      await writeFile(configPath, previousConfig, "utf8");
    }
  }
});

test("Extension runtime applies reaction priority and removal before the next dispatch", async () => {
  const agentDir = join(homedir(), ".pi", "agent");
  const configPath = join(agentDir, "telegram.json");
  const previousConfig = await readFile(configPath, "utf8").catch(
    () => undefined,
  );
  const handlers = new Map<
    string,
    (event: unknown, ctx: unknown) => Promise<unknown>
  >();
  const commands = new Map<
    string,
    { handler: (args: string, ctx: unknown) => Promise<void> }
  >();
  const runtimeEvents: string[] = [];
  let firstDispatchResolved = false;
  let secondUpdatesResolve: ((value: Response) => void) | undefined;
  let thirdUpdatesResolve: ((value: Response) => void) | undefined;
  let fourthUpdatesResolve: ((value: Response) => void) | undefined;
  let fifthUpdatesResolve: ((value: Response) => void) | undefined;
  const secondUpdates = new Promise<Response>((resolve) => {
    secondUpdatesResolve = resolve;
  });
  const thirdUpdates = new Promise<Response>((resolve) => {
    thirdUpdatesResolve = resolve;
  });
  const fourthUpdates = new Promise<Response>((resolve) => {
    fourthUpdatesResolve = resolve;
  });
  const fifthUpdates = new Promise<Response>((resolve) => {
    fifthUpdatesResolve = resolve;
  });
  const pi = {
    on: (
      event: string,
      handler: (event: unknown, ctx: unknown) => Promise<unknown>,
    ) => {
      handlers.set(event, handler);
    },
    registerCommand: (
      name: string,
      definition: { handler: (args: string, ctx: unknown) => Promise<void> },
    ) => {
      commands.set(name, definition);
    },
    registerTool: () => {},
    sendUserMessage: (
      content: string | Array<{ type: string; text?: string }>,
    ) => {
      const promptBlocks = content as Array<{ type: string; text?: string }>;
      runtimeEvents.push(`dispatch:${promptBlocks[0]?.text ?? ""}`);
      firstDispatchResolved = true;
    },
    getThinkingLevel: () => "medium",
  } as never;
  const originalFetch = globalThis.fetch;
  let getUpdatesCalls = 0;
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = url.split("/").at(-1) ?? "";
    if (method === "deleteWebhook") {
      return { json: async () => ({ ok: true, result: true }) } as Response;
    }
    if (method === "getUpdates") {
      getUpdatesCalls += 1;
      if (getUpdatesCalls === 1) {
        return {
          json: async () => ({
            ok: true,
            result: [
              {
                _: "other",
                update_id: 1,
                message: {
                  message_id: 30,
                  chat: { id: 99, type: "private" },
                  from: { id: 77, is_bot: false, first_name: "Test" },
                  text: "first request",
                },
              },
            ],
          }),
        } as Response;
      }
      if (getUpdatesCalls === 2) return secondUpdates;
      if (getUpdatesCalls === 3) return thirdUpdates;
      if (getUpdatesCalls === 4) return fourthUpdates;
      if (getUpdatesCalls === 5) return fifthUpdates;
      throw new DOMException("stop", "AbortError");
    }
    if (method === "sendChatAction") {
      return { json: async () => ({ ok: true, result: true }) } as Response;
    }
    throw new Error(`Unexpected Telegram API method: ${method}`);
  };
  try {
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify(
        { botToken: "123:abc", allowedUserId: 77, lastUpdateId: 0 },
        null,
        "\t",
      ) + "\n",
      "utf8",
    );
    telegramExtension(pi);
    const baseCtx = {
      hasUI: true,
      model: undefined,
      signal: undefined,
      ui: {
        theme: {
          fg: (_token: string, text: string) => text,
        },
        setStatus: () => {},
        notify: () => {},
      },
      hasPendingMessages: () => false,
      abort: () => {},
    };
    const idleCtx = {
      ...baseCtx,
      isIdle: () => true,
    } as never;
    const activeCtx = {
      ...baseCtx,
      isIdle: () => false,
    } as never;
    await handlers.get("session_start")?.({}, idleCtx);
    await commands.get("telegram-connect")?.handler("", idleCtx);
    await waitForCondition(() => firstDispatchResolved);
    await handlers.get("agent_start")?.({}, activeCtx);
    secondUpdatesResolve?.({
      json: async () => ({
        ok: true,
        result: [
          {
            _: "other",
            update_id: 2,
            message: {
              message_id: 31,
              chat: { id: 99, type: "private" },
              from: { id: 77, is_bot: false, first_name: "Test" },
              text: "older waiting",
            },
          },
        ],
      }),
    } as Response);
    await waitForCondition(() => getUpdatesCalls >= 3);
    thirdUpdatesResolve?.({
      json: async () => ({
        ok: true,
        result: [
          {
            _: "other",
            update_id: 3,
            message: {
              message_id: 32,
              chat: { id: 99, type: "private" },
              from: { id: 77, is_bot: false, first_name: "Test" },
              text: "newer waiting",
            },
          },
        ],
      }),
    } as Response);
    await waitForCondition(() => getUpdatesCalls >= 4);
    fourthUpdatesResolve?.({
      json: async () => ({
        ok: true,
        result: [
          {
            _: "other",
            update_id: 4,
            message_reaction: {
              chat: { id: 99, type: "private" },
              message_id: 32,
              user: { id: 77, is_bot: false, first_name: "Test" },
              old_reaction: [],
              new_reaction: [{ type: "emoji", emoji: "👍" }],
              date: 1,
            },
          },
        ],
      }),
    } as Response);
    await waitForCondition(() => getUpdatesCalls >= 5);
    fifthUpdatesResolve?.({
      json: async () => ({
        ok: true,
        result: [
          {
            _: "other",
            update_id: 5,
            message_reaction: {
              chat: { id: 99, type: "private" },
              message_id: 31,
              user: { id: 77, is_bot: false, first_name: "Test" },
              old_reaction: [],
              new_reaction: [{ type: "emoji", emoji: "👎" }],
              date: 2,
            },
          },
        ],
      }),
    } as Response);
    await waitForCondition(() => getUpdatesCalls >= 6);
    await handlers.get("agent_end")?.(
      {
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: "" }],
          },
        ],
      },
      idleCtx,
    );
    await waitForCondition(() => runtimeEvents.length === 2);
    assert.equal(runtimeEvents[0], "dispatch:[telegram] first request");
    assert.equal(runtimeEvents[1], "dispatch:[telegram] newer waiting");
    await handlers.get("agent_start")?.({}, activeCtx);
    await handlers.get("agent_end")?.(
      {
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: "" }],
          },
        ],
      },
      idleCtx,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(runtimeEvents, [
      "dispatch:[telegram] first request",
      "dispatch:[telegram] newer waiting",
    ]);
    await handlers.get("session_shutdown")?.({}, idleCtx);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousConfig === undefined) {
      await rm(configPath, { force: true });
    } else {
      await writeFile(configPath, previousConfig, "utf8");
    }
  }
});

test("Extension runtime applies idle model picks immediately and refreshes status", async () => {
  const agentDir = join(homedir(), ".pi", "agent");
  const configPath = join(agentDir, "telegram.json");
  const previousConfig = await readFile(configPath, "utf8").catch(
    () => undefined,
  );
  const previousArgv = [...process.argv];
  const handlers = new Map<
    string,
    (event: unknown, ctx: unknown) => Promise<unknown>
  >();
  const commands = new Map<
    string,
    { handler: (args: string, ctx: unknown) => Promise<void> }
  >();
  const runtimeEvents: string[] = [];
  const statusEvents: string[] = [];
  const modelA = {
    provider: "openai",
    id: "gpt-a",
    reasoning: true,
  } as const;
  const modelB = {
    provider: "anthropic",
    id: "claude-b",
    reasoning: true,
  } as const;
  const setModels: Array<string> = [];
  const thinkingLevels: Array<string> = [];
  let secondUpdatesResolve: ((value: Response) => void) | undefined;
  const secondUpdates = new Promise<Response>((resolve) => {
    secondUpdatesResolve = resolve;
  });
  const pi = {
    on: (
      event: string,
      handler: (event: unknown, ctx: unknown) => Promise<unknown>,
    ) => {
      handlers.set(event, handler);
    },
    registerCommand: (
      name: string,
      definition: { handler: (args: string, ctx: unknown) => Promise<void> },
    ) => {
      commands.set(name, definition);
    },
    registerTool: () => {},
    sendUserMessage: () => {},
    getThinkingLevel: () => thinkingLevels.at(-1) ?? "medium",
    setModel: async (model: { provider: string; id: string }) => {
      setModels.push(`${model.provider}/${model.id}`);
      return true;
    },
    setThinkingLevel: (level: string) => {
      thinkingLevels.push(level);
    },
  } as never;
  const originalFetch = globalThis.fetch;
  let getUpdatesCalls = 0;
  let nextMessageId = 100;
  const callbackAnswers: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = url.split("/").at(-1) ?? "";
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined;
    if (method === "deleteWebhook") {
      return { json: async () => ({ ok: true, result: true }) } as Response;
    }
    if (method === "getUpdates") {
      getUpdatesCalls += 1;
      if (getUpdatesCalls === 1) {
        return {
          json: async () => ({
            ok: true,
            result: [
              {
                _: "other",
                update_id: 1,
                message: {
                  message_id: 60,
                  chat: { id: 99, type: "private" },
                  from: { id: 77, is_bot: false, first_name: "Test" },
                  text: "/model",
                },
              },
            ],
          }),
        } as Response;
      }
      if (getUpdatesCalls === 2) return secondUpdates;
      throw new DOMException("stop", "AbortError");
    }
    if (method === "sendMessage") {
      runtimeEvents.push(`send:${String(body?.text ?? "")}`);
      return {
        json: async () => ({
          ok: true,
          result: { message_id: nextMessageId++ },
        }),
      } as Response;
    }
    if (method === "editMessageText") {
      runtimeEvents.push(`edit:${String(body?.text ?? "")}`);
      return { json: async () => ({ ok: true, result: true }) } as Response;
    }
    if (method === "answerCallbackQuery") {
      callbackAnswers.push(String(body?.text ?? ""));
      return { json: async () => ({ ok: true, result: true }) } as Response;
    }
    if (method === "sendChatAction") {
      return { json: async () => ({ ok: true, result: true }) } as Response;
    }
    throw new Error(`Unexpected Telegram API method: ${method}`);
  };
  try {
    process.argv = [
      previousArgv[0] ?? "node",
      previousArgv[1] ?? "index.ts",
      "--models=anthropic/claude-b:high",
    ];
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify(
        { botToken: "123:abc", allowedUserId: 77, lastUpdateId: 0 },
        null,
        "\t",
      ) + "\n",
      "utf8",
    );
    telegramExtension(pi);
    const ctx = {
      hasUI: true,
      cwd: process.cwd(),
      model: modelA,
      signal: undefined,
      ui: {
        theme: {
          fg: (_token: string, text: string) => text,
        },
        setStatus: (_slot: string, text: string) => {
          statusEvents.push(text);
        },
        notify: () => {},
      },
      sessionManager: {
        getEntries: () => [],
      },
      modelRegistry: {
        refresh: () => {},
        getAvailable: () => [modelA, modelB],
        isUsingOAuth: () => false,
      },
      getContextUsage: () => undefined,
      hasPendingMessages: () => false,
      isIdle: () => true,
      abort: () => {},
    } as never;
    await handlers.get("session_start")?.({}, ctx);
    await commands.get("telegram-connect")?.handler("", ctx);
    await waitForCondition(() =>
      runtimeEvents.some((event) => event === "send:<b>Choose a model:</b>"),
    );
    const statusCountBeforePick = statusEvents.length;
    secondUpdatesResolve?.({
      json: async () => ({
        ok: true,
        result: [
          {
            _: "other",
            update_id: 2,
            callback_query: {
              id: "cb-idle-1",
              from: { id: 77, is_bot: false, first_name: "Test" },
              data: "model:pick:0",
              message: {
                message_id: 100,
                chat: { id: 99, type: "private" },
              },
            },
          },
        ],
      }),
    } as Response);
    await waitForCondition(() => setModels.length === 1);
    assert.deepEqual(setModels, ["anthropic/claude-b"]);
    assert.deepEqual(thinkingLevels, ["high"]);
    assert.equal(callbackAnswers.includes("Switched to claude-b"), true);
    assert.equal(statusEvents.length > statusCountBeforePick, true);
    assert.equal(
      runtimeEvents.some((event) => event.startsWith("edit:<b>Context:")),
      true,
    );
    await handlers.get("session_shutdown")?.({}, ctx);
  } finally {
    process.argv = previousArgv;
    globalThis.fetch = originalFetch;
    if (previousConfig === undefined) {
      await rm(configPath, { force: true });
    } else {
      await writeFile(configPath, previousConfig, "utf8");
    }
  }
});

test("Extension runtime switches model in flight and dispatches a continuation turn after abort", async () => {
  const agentDir = join(homedir(), ".pi", "agent");
  const configPath = join(agentDir, "telegram.json");
  const previousConfig = await readFile(configPath, "utf8").catch(
    () => undefined,
  );
  const handlers = new Map<
    string,
    (event: unknown, ctx: unknown) => Promise<unknown>
  >();
  const commands = new Map<
    string,
    { handler: (args: string, ctx: unknown) => Promise<void> }
  >();
  const runtimeEvents: string[] = [];
  const modelA = {
    provider: "openai",
    id: "gpt-a",
    reasoning: true,
  } as const;
  const modelB = {
    provider: "anthropic",
    id: "claude-b",
    reasoning: false,
  } as const;
  let idle = true;
  let aborted = false;
  const setModels: Array<string> = [];
  let secondUpdatesResolve: ((value: Response) => void) | undefined;
  let thirdUpdatesResolve: ((value: Response) => void) | undefined;
  const secondUpdates = new Promise<Response>((resolve) => {
    secondUpdatesResolve = resolve;
  });
  const thirdUpdates = new Promise<Response>((resolve) => {
    thirdUpdatesResolve = resolve;
  });
  const pi = {
    on: (
      event: string,
      handler: (event: unknown, ctx: unknown) => Promise<unknown>,
    ) => {
      handlers.set(event, handler);
    },
    registerCommand: (
      name: string,
      definition: { handler: (args: string, ctx: unknown) => Promise<void> },
    ) => {
      commands.set(name, definition);
    },
    registerTool: () => {},
    sendUserMessage: (
      content: string | Array<{ type: string; text?: string }>,
    ) => {
      const promptBlocks = content as Array<{ type: string; text?: string }>;
      runtimeEvents.push(`dispatch:${promptBlocks[0]?.text ?? ""}`);
    },
    getThinkingLevel: () => "medium",
    setModel: async (model: { provider: string; id: string }) => {
      setModels.push(`${model.provider}/${model.id}`);
      return true;
    },
    setThinkingLevel: () => {},
  } as never;
  const originalFetch = globalThis.fetch;
  let getUpdatesCalls = 0;
  let nextMessageId = 100;
  const callbackAnswers: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = url.split("/").at(-1) ?? "";
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined;
    if (method === "deleteWebhook") {
      return { json: async () => ({ ok: true, result: true }) } as Response;
    }
    if (method === "getUpdates") {
      getUpdatesCalls += 1;
      if (getUpdatesCalls === 1) {
        return {
          json: async () => ({
            ok: true,
            result: [
              {
                _: "other",
                update_id: 1,
                message: {
                  message_id: 40,
                  chat: { id: 99, type: "private" },
                  from: { id: 77, is_bot: false, first_name: "Test" },
                  text: "/model",
                },
              },
            ],
          }),
        } as Response;
      }
      if (getUpdatesCalls === 2) return secondUpdates;
      if (getUpdatesCalls === 3) return thirdUpdates;
      throw new DOMException("stop", "AbortError");
    }
    if (method === "sendMessage") {
      runtimeEvents.push(`send:${String(body?.text ?? "")}`);
      return {
        json: async () => ({
          ok: true,
          result: { message_id: nextMessageId++ },
        }),
      } as Response;
    }
    if (method === "editMessageText") {
      runtimeEvents.push(`edit:${String(body?.text ?? "")}`);
      return { json: async () => ({ ok: true, result: true }) } as Response;
    }
    if (method === "answerCallbackQuery") {
      callbackAnswers.push(String(body?.text ?? ""));
      return { json: async () => ({ ok: true, result: true }) } as Response;
    }
    if (method === "sendChatAction") {
      return { json: async () => ({ ok: true, result: true }) } as Response;
    }
    throw new Error(`Unexpected Telegram API method: ${method}`);
  };
  try {
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify(
        { botToken: "123:abc", allowedUserId: 77, lastUpdateId: 0 },
        null,
        "\t",
      ) + "\n",
      "utf8",
    );
    telegramExtension(pi);
    const ctx = {
      hasUI: true,
      cwd: process.cwd(),
      model: modelA,
      signal: undefined,
      ui: {
        theme: {
          fg: (_token: string, text: string) => text,
        },
        setStatus: () => {},
        notify: () => {},
      },
      sessionManager: {
        getEntries: () => [],
      },
      modelRegistry: {
        refresh: () => {},
        getAvailable: () => [modelA, modelB],
        isUsingOAuth: () => false,
      },
      getContextUsage: () => undefined,
      hasPendingMessages: () => false,
      isIdle: () => idle,
      abort: () => {
        aborted = true;
      },
    } as never;
    await handlers.get("session_start")?.({}, ctx);
    await commands.get("telegram-connect")?.handler("", ctx);
    await waitForCondition(() =>
      runtimeEvents.some((event) => event === "send:<b>Choose a model:</b>"),
    );
    secondUpdatesResolve?.({
      json: async () => ({
        ok: true,
        result: [
          {
            _: "other",
            update_id: 2,
            message: {
              message_id: 41,
              chat: { id: 99, type: "private" },
              from: { id: 77, is_bot: false, first_name: "Test" },
              text: "first request",
            },
          },
        ],
      }),
    } as Response);
    await waitForCondition(() =>
      runtimeEvents.some(
        (event) => event === "dispatch:[telegram] first request",
      ),
    );
    idle = false;
    await handlers.get("agent_start")?.({}, ctx);
    thirdUpdatesResolve?.({
      json: async () => ({
        ok: true,
        result: [
          {
            _: "other",
            update_id: 3,
            callback_query: {
              id: "cb-1",
              from: { id: 77, is_bot: false, first_name: "Test" },
              data: "model:pick:1",
              message: {
                message_id: 100,
                chat: { id: 99, type: "private" },
              },
            },
          },
        ],
      }),
    } as Response);
    await waitForCondition(() => aborted);
    assert.deepEqual(setModels, ["anthropic/claude-b"]);
    assert.equal(
      callbackAnswers.includes("Switching to claude-b and continuing…"),
      true,
    );
    idle = true;
    await handlers.get("agent_end")?.(
      {
        messages: [
          {
            role: "assistant",
            stopReason: "aborted",
            content: [{ type: "text", text: "" }],
          },
        ],
      },
      ctx,
    );
    await waitForCondition(() =>
      runtimeEvents.some((event) =>
        event.includes(
          "Continue the interrupted previous Telegram request using the newly selected model (anthropic/claude-b)",
        ),
      ),
    );
    assert.equal(
      runtimeEvents.includes("dispatch:[telegram] first request"),
      true,
    );
    assert.equal(
      runtimeEvents.some((event) =>
        event.includes(
          "dispatch:[telegram] Continue the interrupted previous Telegram request using the newly selected model (anthropic/claude-b)",
        ),
      ),
      true,
    );
    await handlers.get("session_shutdown")?.({}, ctx);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousConfig === undefined) {
      await rm(configPath, { force: true });
    } else {
      await writeFile(configPath, previousConfig, "utf8");
    }
  }
});

test("Extension runtime delays model-switch abort until the active tool finishes", async () => {
  const agentDir = join(homedir(), ".pi", "agent");
  const configPath = join(agentDir, "telegram.json");
  const previousConfig = await readFile(configPath, "utf8").catch(
    () => undefined,
  );
  const handlers = new Map<
    string,
    (event: unknown, ctx: unknown) => Promise<unknown>
  >();
  const commands = new Map<
    string,
    { handler: (args: string, ctx: unknown) => Promise<void> }
  >();
  const runtimeEvents: string[] = [];
  const modelA = {
    provider: "openai",
    id: "gpt-a",
    reasoning: true,
  } as const;
  const modelB = {
    provider: "anthropic",
    id: "claude-b",
    reasoning: false,
  } as const;
  let idle = true;
  let aborted = false;
  const setModels: Array<string> = [];
  let secondUpdatesResolve: ((value: Response) => void) | undefined;
  let thirdUpdatesResolve: ((value: Response) => void) | undefined;
  const secondUpdates = new Promise<Response>((resolve) => {
    secondUpdatesResolve = resolve;
  });
  const thirdUpdates = new Promise<Response>((resolve) => {
    thirdUpdatesResolve = resolve;
  });
  const pi = {
    on: (
      event: string,
      handler: (event: unknown, ctx: unknown) => Promise<unknown>,
    ) => {
      handlers.set(event, handler);
    },
    registerCommand: (
      name: string,
      definition: { handler: (args: string, ctx: unknown) => Promise<void> },
    ) => {
      commands.set(name, definition);
    },
    registerTool: () => {},
    sendUserMessage: (
      content: string | Array<{ type: string; text?: string }>,
    ) => {
      const promptBlocks = content as Array<{ type: string; text?: string }>;
      runtimeEvents.push(`dispatch:${promptBlocks[0]?.text ?? ""}`);
    },
    getThinkingLevel: () => "medium",
    setModel: async (model: { provider: string; id: string }) => {
      setModels.push(`${model.provider}/${model.id}`);
      return true;
    },
    setThinkingLevel: () => {},
  } as never;
  const originalFetch = globalThis.fetch;
  let getUpdatesCalls = 0;
  let nextMessageId = 100;
  const callbackAnswers: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = url.split("/").at(-1) ?? "";
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined;
    if (method === "deleteWebhook") {
      return { json: async () => ({ ok: true, result: true }) } as Response;
    }
    if (method === "getUpdates") {
      getUpdatesCalls += 1;
      if (getUpdatesCalls === 1) {
        return {
          json: async () => ({
            ok: true,
            result: [
              {
                _: "other",
                update_id: 1,
                message: {
                  message_id: 50,
                  chat: { id: 99, type: "private" },
                  from: { id: 77, is_bot: false, first_name: "Test" },
                  text: "/model",
                },
              },
            ],
          }),
        } as Response;
      }
      if (getUpdatesCalls === 2) return secondUpdates;
      if (getUpdatesCalls === 3) return thirdUpdates;
      throw new DOMException("stop", "AbortError");
    }
    if (method === "sendMessage") {
      runtimeEvents.push(`send:${String(body?.text ?? "")}`);
      return {
        json: async () => ({
          ok: true,
          result: { message_id: nextMessageId++ },
        }),
      } as Response;
    }
    if (method === "editMessageText") {
      runtimeEvents.push(`edit:${String(body?.text ?? "")}`);
      return { json: async () => ({ ok: true, result: true }) } as Response;
    }
    if (method === "answerCallbackQuery") {
      callbackAnswers.push(String(body?.text ?? ""));
      return { json: async () => ({ ok: true, result: true }) } as Response;
    }
    if (method === "sendChatAction") {
      return { json: async () => ({ ok: true, result: true }) } as Response;
    }
    throw new Error(`Unexpected Telegram API method: ${method}`);
  };
  try {
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify(
        { botToken: "123:abc", allowedUserId: 77, lastUpdateId: 0 },
        null,
        "\t",
      ) + "\n",
      "utf8",
    );
    telegramExtension(pi);
    const ctx = {
      hasUI: true,
      cwd: process.cwd(),
      model: modelA,
      signal: undefined,
      ui: {
        theme: {
          fg: (_token: string, text: string) => text,
        },
        setStatus: () => {},
        notify: () => {},
      },
      sessionManager: {
        getEntries: () => [],
      },
      modelRegistry: {
        refresh: () => {},
        getAvailable: () => [modelA, modelB],
        isUsingOAuth: () => false,
      },
      getContextUsage: () => undefined,
      hasPendingMessages: () => false,
      isIdle: () => idle,
      abort: () => {
        aborted = true;
      },
    } as never;
    await handlers.get("session_start")?.({}, ctx);
    await commands.get("telegram-connect")?.handler("", ctx);
    await waitForCondition(() =>
      runtimeEvents.some((event) => event === "send:<b>Choose a model:</b>"),
    );
    secondUpdatesResolve?.({
      json: async () => ({
        ok: true,
        result: [
          {
            _: "other",
            update_id: 2,
            message: {
              message_id: 51,
              chat: { id: 99, type: "private" },
              from: { id: 77, is_bot: false, first_name: "Test" },
              text: "first request",
            },
          },
        ],
      }),
    } as Response);
    await waitForCondition(() =>
      runtimeEvents.some(
        (event) => event === "dispatch:[telegram] first request",
      ),
    );
    idle = false;
    await handlers.get("agent_start")?.({}, ctx);
    await handlers.get("tool_execution_start")?.({}, ctx);
    thirdUpdatesResolve?.({
      json: async () => ({
        ok: true,
        result: [
          {
            _: "other",
            update_id: 3,
            callback_query: {
              id: "cb-2",
              from: { id: 77, is_bot: false, first_name: "Test" },
              data: "model:pick:1",
              message: {
                message_id: 100,
                chat: { id: 99, type: "private" },
              },
            },
          },
        ],
      }),
    } as Response);
    await waitForCondition(() =>
      callbackAnswers.includes(
        "Switched to claude-b. Restarting after the current tool finishes…",
      ),
    );
    assert.deepEqual(setModels, ["anthropic/claude-b"]);
    assert.equal(aborted, false);
    await handlers.get("tool_execution_end")?.({}, ctx);
    await waitForCondition(() => aborted);
    idle = true;
    await handlers.get("agent_end")?.(
      {
        messages: [
          {
            role: "assistant",
            stopReason: "aborted",
            content: [{ type: "text", text: "" }],
          },
        ],
      },
      ctx,
    );
    await waitForCondition(() =>
      runtimeEvents.some((event) =>
        event.includes(
          "dispatch:[telegram] Continue the interrupted previous Telegram request using the newly selected model (anthropic/claude-b)",
        ),
      ),
    );
    await handlers.get("session_shutdown")?.({}, ctx);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousConfig === undefined) {
      await rm(configPath, { force: true });
    } else {
      await writeFile(configPath, previousConfig, "utf8");
    }
  }
});
