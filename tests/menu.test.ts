import assert from "node:assert/strict";
import test from "node:test";

import {
  applyTelegramModelPageSelection,
  applyTelegramModelScopeSelection,
  buildModelMenuReplyMarkup,
  buildStatusReplyMarkup,
  buildTelegramModelCallbackPlan,
  buildTelegramModelMenuRenderPayload,
  buildTelegramModelMenuState,
  buildTelegramStatusMenuRenderPayload,
  buildTelegramThinkingMenuRenderPayload,
  buildThinkingMenuReplyMarkup,
  buildThinkingMenuText,
  formatScopedModelButtonText,
  getCanonicalModelId,
  getTelegramModelMenuPage,
  getTelegramModelSelection,
  getModelMenuItems,
  handleTelegramMenuCallbackEntry,
  handleTelegramModelMenuCallbackAction,
  handleTelegramStatusMenuCallbackAction,
  handleTelegramThinkingMenuCallbackAction,
  isThinkingLevel,
  MODEL_MENU_TITLE,
  modelsMatch,
  parseTelegramMenuCallbackAction,
  resolveScopedModelPatterns,
  sendTelegramModelMenuMessage,
  sendTelegramStatusMessage,
  sortScopedModels,
  TELEGRAM_MODEL_PAGE_SIZE,
  updateTelegramModelMenuMessage,
  updateTelegramStatusMessage,
  updateTelegramThinkingMenuMessage,
  type TelegramModelMenuState,
} from "../lib/menu.ts";

test("Menu helpers match models, detect thinking levels, and expose constants", () => {
  assert.equal(MODEL_MENU_TITLE, "<b>Choose a model:</b>");
  assert.equal(TELEGRAM_MODEL_PAGE_SIZE, 6);
  assert.equal(
    modelsMatch(
      { provider: "openai", id: "gpt-5" },
      { provider: "openai", id: "gpt-5" },
    ),
    true,
  );
  assert.equal(
    modelsMatch(
      { provider: "openai", id: "gpt-5" },
      { provider: "anthropic", id: "gpt-5" },
    ),
    false,
  );
  assert.equal(
    getCanonicalModelId({ provider: "openai", id: "gpt-5" }),
    "openai/gpt-5",
  );
  assert.equal(isThinkingLevel("high"), true);
  assert.equal(isThinkingLevel("impossible"), false);
});

test("Menu helpers resolve scoped model patterns and sort current models first", () => {
  const models = [
    { provider: "openai", id: "gpt-5", name: "GPT 5" },
    { provider: "openai", id: "gpt-5-latest", name: "GPT 5 Latest" },
    {
      provider: "anthropic",
      id: "claude-sonnet-20250101",
      name: "Claude Sonnet",
    },
  ] as const;
  const resolved = resolveScopedModelPatterns(
    ["gpt-5:high", "anthropic/*:low"],
    models as never,
  );
  assert.deepEqual(
    resolved.map((entry) => ({
      id: entry.model.id,
      thinking: entry.thinkingLevel,
    })),
    [
      { id: "gpt-5", thinking: "high" },
      { id: "claude-sonnet-20250101", thinking: "low" },
    ],
  );
  const sorted = sortScopedModels(resolved, models[0] as never);
  assert.equal(sorted[0]?.model.id, "gpt-5");
});

test("Menu helpers build model menu state and parse callback actions", () => {
  const modelA = { provider: "openai", id: "gpt-5", reasoning: true } as const;
  const modelB = {
    provider: "anthropic",
    id: "claude-3",
    reasoning: false,
  } as const;
  const state = buildTelegramModelMenuState({
    chatId: 1,
    activeModel: modelA as never,
    availableModels: [modelA, modelB] as never,
    configuredScopedModelPatterns: ["missing-model"],
    cliScopedModelPatterns: ["missing-model"],
  });
  assert.equal(state.chatId, 1);
  assert.equal(state.scope, "all");
  assert.match(state.note ?? "", /No CLI scoped models matched/);
  assert.deepEqual(parseTelegramMenuCallbackAction("status:model"), {
    kind: "status",
    action: "model",
  });
  assert.deepEqual(parseTelegramMenuCallbackAction("thinking:set:high"), {
    kind: "thinking:set",
    level: "high",
  });
  assert.deepEqual(parseTelegramMenuCallbackAction("model:pick:2"), {
    kind: "model",
    action: "pick",
    value: "2",
  });
  assert.deepEqual(parseTelegramMenuCallbackAction("unknown"), {
    kind: "ignore",
  });
});

test("Menu helpers apply menu mutations and resolve model selections", () => {
  const modelA = { provider: "openai", id: "gpt-5", reasoning: true } as const;
  const state = {
    chatId: 1,
    messageId: 2,
    page: 0,
    scope: "all" as const,
    scopedModels: [{ model: modelA, thinkingLevel: "high" as const }],
    allModels: [{ model: modelA }],
    mode: "status" as const,
  } as unknown as TelegramModelMenuState;
  assert.equal(applyTelegramModelScopeSelection(state, "scoped"), "changed");
  assert.equal(state.scope, "scoped");
  assert.equal(applyTelegramModelScopeSelection(state, "scoped"), "unchanged");
  assert.equal(applyTelegramModelScopeSelection(state, "bad"), "invalid");
  assert.equal(applyTelegramModelPageSelection(state, "2"), "changed");
  assert.equal(state.page, 2);
  assert.equal(applyTelegramModelPageSelection(state, "2"), "unchanged");
  assert.equal(applyTelegramModelPageSelection(state, "bad"), "invalid");
  assert.deepEqual(getTelegramModelSelection(state, "bad"), {
    kind: "invalid",
  });
  assert.deepEqual(getTelegramModelSelection(state, "9"), { kind: "missing" });
  assert.equal(getTelegramModelSelection(state, "0").kind, "selected");
});

test("Menu helpers derive normalized menu pages without mutating state", () => {
  const modelA = { provider: "openai", id: "gpt-5" } as const;
  const modelB = { provider: "anthropic", id: "claude-3" } as const;
  const state = {
    chatId: 1,
    messageId: 2,
    page: 99,
    scope: "all" as const,
    scopedModels: [],
    allModels: [{ model: modelA }, { model: modelB }],
    mode: "model" as const,
  } as unknown as TelegramModelMenuState;
  const menuPage = getTelegramModelMenuPage(state, 1);
  assert.equal(menuPage.page, 1);
  assert.equal(menuPage.pageCount, 2);
  assert.equal(menuPage.start, 1);
  assert.deepEqual(menuPage.items, [{ model: modelB }]);
  assert.equal(state.page, 99);
  const markup = buildModelMenuReplyMarkup(state, modelA as never, 1);
  assert.equal(markup.inline_keyboard[1]?.[1]?.text, "2/2");
  assert.equal(state.page, 99);
});

test("Menu helpers build model callback plans for paging, selection, and restart modes", () => {
  const modelA = { provider: "openai", id: "gpt-5", reasoning: true } as const;
  const modelB = {
    provider: "anthropic",
    id: "claude-3",
    reasoning: false,
  } as const;
  const state = {
    chatId: 1,
    messageId: 2,
    page: 0,
    scope: "all" as const,
    scopedModels: [{ model: modelA, thinkingLevel: "high" as const }],
    allModels: [{ model: modelA }, { model: modelB }],
    mode: "model" as const,
  } as unknown as TelegramModelMenuState;
  assert.deepEqual(
    buildTelegramModelCallbackPlan({
      data: "model:page:1",
      state,
      activeModel: modelA as never,
      currentThinkingLevel: "medium",
      isIdle: true,
      canRestartBusyRun: false,
      hasActiveToolExecutions: false,
    }),
    { kind: "update-menu" },
  );
  assert.deepEqual(
    buildTelegramModelCallbackPlan({
      data: "model:pick:0",
      state,
      activeModel: modelA as never,
      currentThinkingLevel: "medium",
      isIdle: true,
      canRestartBusyRun: false,
      hasActiveToolExecutions: false,
    }),
    {
      kind: "refresh-status",
      selection: state.allModels[0],
      callbackText: "Model: gpt-5",
      shouldApplyThinkingLevel: false,
    },
  );
  assert.deepEqual(
    buildTelegramModelCallbackPlan({
      data: "model:pick:1",
      state,
      activeModel: modelA as never,
      currentThinkingLevel: "medium",
      isIdle: false,
      canRestartBusyRun: true,
      hasActiveToolExecutions: true,
    }),
    {
      kind: "switch-model",
      selection: state.allModels[1],
      mode: "restart-after-tool",
      callbackText:
        "Switched to claude-3. Restarting after the current tool finishes…",
    },
  );
  assert.deepEqual(
    buildTelegramModelCallbackPlan({
      data: "model:pick:1",
      state,
      activeModel: modelA as never,
      currentThinkingLevel: "medium",
      isIdle: false,
      canRestartBusyRun: false,
      hasActiveToolExecutions: false,
    }),
    { kind: "answer", text: "Pi is busy. Send /stop first." },
  );
});

test("Menu helpers route callback entry states before action handlers", async () => {
  const events: string[] = [];
  await handleTelegramMenuCallbackEntry("callback-1", undefined, undefined, {
    handleStatusAction: async () => false,
    handleThinkingAction: async () => false,
    handleModelAction: async () => false,
    answerCallbackQuery: async (_id, text) => {
      events.push(`answer:${text ?? ""}`);
    },
  });
  await handleTelegramMenuCallbackEntry(
    "callback-2",
    "status:model",
    undefined,
    {
      handleStatusAction: async () => false,
      handleThinkingAction: async () => false,
      handleModelAction: async () => false,
      answerCallbackQuery: async (_id, text) => {
        events.push(`answer:${text ?? ""}`);
      },
    },
  );
  await handleTelegramMenuCallbackEntry(
    "callback-3",
    "status:model",
    {
      chatId: 1,
      messageId: 2,
      page: 0,
      scope: "all",
      scopedModels: [],
      allModels: [],
      mode: "status",
    },
    {
      handleStatusAction: async () => {
        events.push("status");
        return true;
      },
      handleThinkingAction: async () => false,
      handleModelAction: async () => false,
      answerCallbackQuery: async (_id, text) => {
        events.push(`answer:${text ?? ""}`);
      },
    },
  );
  assert.deepEqual(events, [
    "answer:",
    "answer:Interactive message expired.",
    "status",
  ]);
});

test("Menu helpers execute model callback actions across update, switch, and restart paths", async () => {
  const events: string[] = [];
  const modelA = { provider: "openai", id: "gpt-5", reasoning: true } as const;
  const modelB = {
    provider: "anthropic",
    id: "claude-3",
    reasoning: false,
  } as const;
  const state = {
    chatId: 1,
    messageId: 2,
    page: 0,
    scope: "all" as const,
    scopedModels: [],
    allModels: [{ model: modelA }, { model: modelB }],
    mode: "model" as const,
  } as unknown as TelegramModelMenuState;
  assert.equal(
    await handleTelegramModelMenuCallbackAction(
      "callback-1",
      {
        data: "model:page:1",
        state,
        activeModel: modelA as never,
        currentThinkingLevel: "medium",
        isIdle: true,
        canRestartBusyRun: false,
        hasActiveToolExecutions: false,
      },
      {
        updateModelMenuMessage: async () => {
          events.push("update-menu");
        },
        updateStatusMessage: async () => {
          events.push("status");
        },
        answerCallbackQuery: async (_id, text) => {
          events.push(`answer:${text ?? ""}`);
        },
        setModel: async () => true,
        setCurrentModel: (model) => {
          events.push(`current:${model.id}`);
        },
        setThinkingLevel: (level) => {
          events.push(`thinking:${level}`);
        },
        stagePendingModelSwitch: (selection) => {
          events.push(`pending:${selection.model.id}`);
        },
        restartInterruptedTelegramTurn: (selection) => {
          events.push(`restart:${selection.model.id}`);
          return true;
        },
      },
    ),
    true,
  );
  assert.equal(
    await handleTelegramModelMenuCallbackAction(
      "callback-2",
      {
        data: "model:pick:1",
        state,
        activeModel: modelA as never,
        currentThinkingLevel: "medium",
        isIdle: false,
        canRestartBusyRun: true,
        hasActiveToolExecutions: true,
      },
      {
        updateModelMenuMessage: async () => {
          events.push("unexpected:update");
        },
        updateStatusMessage: async () => {
          events.push("status");
        },
        answerCallbackQuery: async (_id, text) => {
          events.push(`answer:${text ?? ""}`);
        },
        setModel: async () => true,
        setCurrentModel: (model) => {
          events.push(`current:${model.id}`);
        },
        setThinkingLevel: (level) => {
          events.push(`thinking:${level}`);
        },
        stagePendingModelSwitch: (selection) => {
          events.push(`pending:${selection.model.id}`);
        },
        restartInterruptedTelegramTurn: (selection) => {
          events.push(`restart:${selection.model.id}`);
          return true;
        },
      },
    ),
    true,
  );
  assert.equal(
    await handleTelegramModelMenuCallbackAction(
      "callback-3",
      {
        data: "model:pick:1",
        state,
        activeModel: modelA as never,
        currentThinkingLevel: "medium",
        isIdle: false,
        canRestartBusyRun: true,
        hasActiveToolExecutions: false,
      },
      {
        updateModelMenuMessage: async () => {
          events.push("unexpected:update");
        },
        updateStatusMessage: async () => {
          events.push("status");
        },
        answerCallbackQuery: async (_id, text) => {
          events.push(`answer:${text ?? ""}`);
        },
        setModel: async () => true,
        setCurrentModel: (model) => {
          events.push(`current:${model.id}`);
        },
        setThinkingLevel: (level) => {
          events.push(`thinking:${level}`);
        },
        stagePendingModelSwitch: (selection) => {
          events.push(`pending:${selection.model.id}`);
        },
        restartInterruptedTelegramTurn: (selection) => {
          events.push(`restart:${selection.model.id}`);
          return true;
        },
      },
    ),
    true,
  );
  assert.equal(events[0], "update-menu");
  assert.equal(events[1], "answer:");
  assert.equal(events[2], "current:claude-3");
  assert.equal(events[3], "status");
  assert.equal(events[4], "pending:claude-3");
  assert.equal(
    events[5],
    "answer:Switched to claude-3. Restarting after the current tool finishes…",
  );
  assert.equal(events[6], "current:claude-3");
  assert.equal(events[7], "status");
  assert.equal(events[8], "restart:claude-3");
  assert.equal(events[9], "answer:Switching to claude-3 and continuing…");
});

test("Menu helpers handle status and thinking callback actions", async () => {
  const events: string[] = [];
  const reasoningModel = {
    provider: "openai",
    id: "gpt-5",
    reasoning: true,
  } as const;
  const plainModel = {
    provider: "openai",
    id: "gpt-4o",
    reasoning: false,
  } as const;
  assert.equal(
    await handleTelegramStatusMenuCallbackAction(
      "callback-1",
      "status:model",
      reasoningModel as never,
      {
        updateModelMenuMessage: async () => {
          events.push("status:model");
        },
        updateThinkingMenuMessage: async () => {
          events.push("status:thinking");
        },
        answerCallbackQuery: async (_id, text) => {
          events.push(`answer:${text ?? ""}`);
        },
      },
    ),
    true,
  );
  assert.equal(
    await handleTelegramThinkingMenuCallbackAction(
      "callback-2",
      "thinking:set:high",
      reasoningModel as never,
      {
        setThinkingLevel: (level) => {
          events.push(`set:${level}`);
        },
        getCurrentThinkingLevel: () => "high",
        updateStatusMessage: async () => {
          events.push("status:update");
        },
        answerCallbackQuery: async (_id, text) => {
          events.push(`answer:${text ?? ""}`);
        },
      },
    ),
    true,
  );
  assert.equal(
    await handleTelegramStatusMenuCallbackAction(
      "callback-3",
      "status:thinking",
      plainModel as never,
      {
        updateModelMenuMessage: async () => {
          events.push("unexpected:model");
        },
        updateThinkingMenuMessage: async () => {
          events.push("unexpected:thinking");
        },
        answerCallbackQuery: async (_id, text) => {
          events.push(`answer:${text ?? ""}`);
        },
      },
    ),
    true,
  );
  assert.equal(events[0], "status:model");
  assert.equal(events[1], "answer:");
  assert.equal(events[2], "set:high");
  assert.equal(events[3], "status:update");
  assert.equal(events[4], "answer:Thinking: high");
  assert.equal(events[5], "answer:This model has no reasoning controls.");
});

test("Menu helpers build pure render payloads before transport", () => {
  const modelA = { provider: "openai", id: "gpt-5", reasoning: true } as const;
  const state = {
    chatId: 1,
    messageId: 2,
    page: 0,
    scope: "all" as const,
    scopedModels: [],
    allModels: [{ model: modelA }],
    mode: "status" as const,
  } as unknown as TelegramModelMenuState;
  const modelPayload = buildTelegramModelMenuRenderPayload(
    state,
    modelA as never,
  );
  const thinkingPayload = buildTelegramThinkingMenuRenderPayload(
    modelA as never,
    "medium",
  );
  const statusPayload = buildTelegramStatusMenuRenderPayload(
    "<b>Status</b>",
    modelA as never,
    "medium",
  );
  assert.equal(modelPayload.nextMode, "model");
  assert.equal(modelPayload.text, "<b>Choose a model:</b>");
  assert.equal(modelPayload.mode, "html");
  assert.equal(thinkingPayload.nextMode, "thinking");
  assert.match(thinkingPayload.text, /^Choose a thinking level/);
  assert.equal(thinkingPayload.mode, "plain");
  assert.equal(statusPayload.nextMode, "status");
  assert.equal(statusPayload.text, "<b>Status</b>");
  assert.equal(statusPayload.mode, "html");
  assert.equal(state.mode, "status");
});

test("Menu helpers update and send interactive menu messages", async () => {
  const events: string[] = [];
  const modelA = { provider: "openai", id: "gpt-5", reasoning: true } as const;
  const state = {
    chatId: 1,
    messageId: 2,
    page: 0,
    scope: "all" as const,
    scopedModels: [],
    allModels: [{ model: modelA }],
    mode: "status" as const,
  } as unknown as TelegramModelMenuState;
  const deps = {
    editInteractiveMessage: async (
      chatId: number,
      messageId: number,
      text: string,
      mode: "html" | "plain",
    ) => {
      events.push(`edit:${chatId}:${messageId}:${mode}:${text}`);
    },
    sendInteractiveMessage: async (
      chatId: number,
      text: string,
      mode: "html" | "plain",
    ) => {
      events.push(`send:${chatId}:${mode}:${text}`);
      return 99;
    },
  };
  await updateTelegramModelMenuMessage(state, modelA as never, deps);
  await updateTelegramThinkingMenuMessage(
    state,
    modelA as never,
    "medium",
    deps,
  );
  await updateTelegramStatusMessage(
    state,
    "<b>Status</b>",
    modelA as never,
    "medium",
    deps,
  );
  const sentStatusId = await sendTelegramStatusMessage(
    state,
    "<b>Status</b>",
    modelA as never,
    "medium",
    deps,
  );
  const sentModelId = await sendTelegramModelMenuMessage(
    state,
    modelA as never,
    deps,
  );
  assert.equal(sentStatusId, 99);
  assert.equal(sentModelId, 99);
  assert.equal(events[0], "edit:1:2:html:<b>Choose a model:</b>");
  assert.match(events[1] ?? "", /^edit:1:2:plain:Choose a thinking level/);
  assert.equal(events[2], "edit:1:2:html:<b>Status</b>");
  assert.equal(events[3], "send:1:html:<b>Status</b>");
  assert.equal(events[4], "send:1:html:<b>Choose a model:</b>");
});

test("Menu helpers build model, thinking, and status UI payloads", () => {
  const modelA = { provider: "openai", id: "gpt-5", reasoning: true } as const;
  const modelB = {
    provider: "anthropic",
    id: "claude-3",
    reasoning: false,
  } as const;
  const state = {
    chatId: 1,
    messageId: 2,
    page: 0,
    scope: "scoped" as const,
    scopedModels: [{ model: modelA, thinkingLevel: "high" as const }],
    allModels: [{ model: modelB }],
    mode: "model" as const,
  } as unknown as TelegramModelMenuState;
  assert.deepEqual(getModelMenuItems(state), state.scopedModels);
  assert.match(
    formatScopedModelButtonText(state.scopedModels[0], modelA as never),
    /^✅ /,
  );
  const modelMarkup = buildModelMenuReplyMarkup(state, modelA as never, 6);
  assert.equal(
    modelMarkup.inline_keyboard[0]?.[0]?.callback_data,
    "model:pick:0",
  );
  const thinkingText = buildThinkingMenuText(modelA as never, "medium");
  assert.match(thinkingText, /Model: openai\/gpt-5/);
  const thinkingMarkup = buildThinkingMenuReplyMarkup("medium");
  assert.equal(
    thinkingMarkup.inline_keyboard.some((row) => row[0]?.text === "✅ medium"),
    true,
  );
  const statusMarkup = buildStatusReplyMarkup(modelA as never, "medium");
  assert.equal(statusMarkup.inline_keyboard.length, 2);
  const noReasoningMarkup = buildStatusReplyMarkup(modelB as never, "medium");
  assert.equal(noReasoningMarkup.inline_keyboard.length, 1);
});
