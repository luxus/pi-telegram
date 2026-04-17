/**
 * Telegram queue and queue-runtime domain helpers
 * Owns queue items, queue mutations, dispatch and lifecycle planning, session resets, and queue-adjacent runtime helpers
 */

import type { ImageContent, Model, TextContent } from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

// --- Queue Items ---

export interface QueuedAttachment {
  path: string;
  fileName: string;
}

export type TelegramQueueItemKind = "prompt" | "control";
export type TelegramQueueLane = "control" | "priority" | "default";

export interface TelegramQueueItemBase {
  kind: TelegramQueueItemKind;
  chatId: number;
  replyToMessageId: number;
  queueOrder: number;
  queueLane: TelegramQueueLane;
  laneOrder: number;
  statusSummary: string;
}

export interface PendingTelegramTurn extends TelegramQueueItemBase {
  kind: "prompt";
  sourceMessageIds: number[];
  queuedAttachments: QueuedAttachment[];
  content: Array<TextContent | ImageContent>;
  historyText: string;
}

export interface PendingTelegramControlItem extends TelegramQueueItemBase {
  kind: "control";
  controlType: "status" | "model";
  execute: (ctx: ExtensionContext) => Promise<void>;
}

export type TelegramQueueItem =
  | PendingTelegramTurn
  | PendingTelegramControlItem;

export interface TelegramDispatchGuardState {
  compactionInProgress: boolean;
  hasActiveTelegramTurn: boolean;
  hasPendingTelegramDispatch: boolean;
  isIdle: boolean;
  hasPendingMessages: boolean;
}

export interface TelegramInFlightModelSwitchState {
  isIdle: boolean;
  hasActiveTelegramTurn: boolean;
  hasAbortHandler: boolean;
}

function getTelegramQueueLaneRank(lane: TelegramQueueLane): number {
  switch (lane) {
    case "control":
      return 0;
    case "priority":
      return 1;
    default:
      return 2;
  }
}

export function isPendingTelegramTurn(
  item: TelegramQueueItem,
): item is PendingTelegramTurn {
  return item.kind === "prompt";
}

// --- Queue Mutations ---

export function partitionTelegramQueueItemsForHistory(
  items: TelegramQueueItem[],
): {
  historyTurns: PendingTelegramTurn[];
  remainingItems: TelegramQueueItem[];
} {
  const historyTurns: PendingTelegramTurn[] = [];
  const remainingItems: TelegramQueueItem[] = [];
  for (const item of items) {
    if (isPendingTelegramTurn(item)) {
      historyTurns.push(item);
      continue;
    }
    remainingItems.push(item);
  }
  return { historyTurns, remainingItems };
}

export function compareTelegramQueueItems(
  left: TelegramQueueItem,
  right: TelegramQueueItem,
): number {
  const laneRankDelta =
    getTelegramQueueLaneRank(left.queueLane) -
    getTelegramQueueLaneRank(right.queueLane);
  if (laneRankDelta !== 0) return laneRankDelta;
  if (left.laneOrder !== right.laneOrder) {
    return left.laneOrder - right.laneOrder;
  }
  return left.queueOrder - right.queueOrder;
}

export function removeTelegramQueueItemsByMessageIds(
  items: TelegramQueueItem[],
  messageIds: number[],
): { items: TelegramQueueItem[]; removedCount: number } {
  if (messageIds.length === 0 || items.length === 0) {
    return { items, removedCount: 0 };
  }
  const deletedMessageIds = new Set(messageIds);
  const nextItems = items.filter((item) => {
    if (!isPendingTelegramTurn(item)) return true;
    return !item.sourceMessageIds.some((messageId) =>
      deletedMessageIds.has(messageId),
    );
  });
  return {
    items: nextItems,
    removedCount: items.length - nextItems.length,
  };
}

export function clearTelegramQueuePromptPriority(
  items: TelegramQueueItem[],
  messageId: number,
): { items: TelegramQueueItem[]; changed: boolean } {
  let changed = false;
  const nextItems = items.map((item) => {
    if (
      !isPendingTelegramTurn(item) ||
      !item.sourceMessageIds.includes(messageId) ||
      item.queueLane !== "priority"
    ) {
      return item;
    }
    changed = true;
    return {
      ...item,
      queueLane: "default" as const,
      laneOrder: item.queueOrder,
    };
  });
  return { items: nextItems, changed };
}

export function prioritizeTelegramQueuePrompt(
  items: TelegramQueueItem[],
  messageId: number,
  laneOrder: number,
): { items: TelegramQueueItem[]; changed: boolean } {
  let changed = false;
  const nextItems = items.map((item) => {
    if (
      !isPendingTelegramTurn(item) ||
      !item.sourceMessageIds.includes(messageId)
    ) {
      return item;
    }
    changed = true;
    return {
      ...item,
      queueLane: "priority" as const,
      laneOrder,
    };
  });
  return { items: nextItems, changed };
}

export function consumeDispatchedTelegramPrompt(
  items: TelegramQueueItem[],
  hasPendingDispatch: boolean,
): { activeTurn?: PendingTelegramTurn; remainingItems: TelegramQueueItem[] } {
  if (!hasPendingDispatch) {
    return { activeTurn: undefined, remainingItems: items };
  }
  const nextItem = items[0];
  if (!nextItem || !isPendingTelegramTurn(nextItem)) {
    return { activeTurn: undefined, remainingItems: items };
  }
  return { activeTurn: nextItem, remainingItems: items.slice(1) };
}

function formatTelegramQueueItemStatusSummary(item: TelegramQueueItem): string {
  if (item.queueLane === "priority") {
    return `⬆ ${item.statusSummary}`;
  }
  return item.statusSummary;
}

export function formatQueuedTelegramItemsStatus(
  items: TelegramQueueItem[],
): string {
  if (items.length === 0) return "";
  const previewCount = 4;
  const summaries = items
    .slice(0, previewCount)
    .map(formatTelegramQueueItemStatusSummary)
    .filter(Boolean);
  if (summaries.length === 0) return ` +${items.length}`;
  const suffix = items.length > summaries.length ? ", …" : "";
  return ` +${items.length}: [${summaries.join(", ")}${suffix}]`;
}

export function canDispatchTelegramTurnState(
  state: TelegramDispatchGuardState,
): boolean {
  return (
    !state.compactionInProgress &&
    !state.hasActiveTelegramTurn &&
    !state.hasPendingTelegramDispatch &&
    state.isIdle &&
    !state.hasPendingMessages
  );
}

export function canRestartTelegramTurnForModelSwitch(
  state: TelegramInFlightModelSwitchState,
): boolean {
  return !state.isIdle && state.hasActiveTelegramTurn && state.hasAbortHandler;
}

export function shouldTriggerPendingTelegramModelSwitchAbort(state: {
  hasPendingModelSwitch: boolean;
  hasActiveTelegramTurn: boolean;
  hasAbortHandler: boolean;
  activeToolExecutions: number;
}): boolean {
  return (
    state.hasPendingModelSwitch &&
    state.hasActiveTelegramTurn &&
    state.hasAbortHandler &&
    state.activeToolExecutions === 0
  );
}

// --- Dispatch Planning ---

export type TelegramQueueDispatchAction =
  | { kind: "none"; remainingItems: TelegramQueueItem[] }
  | {
      kind: "control";
      item: PendingTelegramControlItem;
      remainingItems: TelegramQueueItem[];
    }
  | {
      kind: "prompt";
      item: PendingTelegramTurn;
      remainingItems: TelegramQueueItem[];
    };

export function planNextTelegramQueueAction(
  items: TelegramQueueItem[],
  canDispatch: boolean,
): TelegramQueueDispatchAction {
  if (!canDispatch || items.length === 0) {
    return { kind: "none", remainingItems: items };
  }
  const [firstItem, ...remainingItems] = items;
  if (!firstItem) {
    return { kind: "none", remainingItems: items };
  }
  if (isPendingTelegramTurn(firstItem)) {
    return { kind: "prompt", item: firstItem, remainingItems: items };
  }
  return { kind: "control", item: firstItem, remainingItems };
}

export function shouldDispatchAfterTelegramAgentEnd(options: {
  hasTurn: boolean;
  stopReason?: string;
  preserveQueuedTurnsAsHistory: boolean;
}): boolean {
  if (!options.hasTurn) return true;
  if (options.stopReason === "aborted") {
    return !options.preserveQueuedTurnsAsHistory;
  }
  return true;
}

// --- Agent Runtime ---

export interface TelegramAgentStartPlan {
  activeTurn?: PendingTelegramTurn;
  remainingItems: TelegramQueueItem[];
  shouldResetPendingModelSwitch: boolean;
  shouldResetToolExecutions: boolean;
  shouldClearDispatchPending: boolean;
}

export function buildTelegramAgentStartPlan(options: {
  queuedItems: TelegramQueueItem[];
  hasPendingDispatch: boolean;
  hasActiveTurn: boolean;
}): TelegramAgentStartPlan {
  if (options.hasActiveTurn || !options.hasPendingDispatch) {
    return {
      activeTurn: undefined,
      remainingItems: options.queuedItems,
      shouldResetPendingModelSwitch: true,
      shouldResetToolExecutions: true,
      shouldClearDispatchPending: options.hasPendingDispatch,
    };
  }
  const nextDispatch = consumeDispatchedTelegramPrompt(
    options.queuedItems,
    options.hasPendingDispatch,
  );
  return {
    activeTurn: nextDispatch.activeTurn,
    remainingItems: nextDispatch.remainingItems,
    shouldResetPendingModelSwitch: true,
    shouldResetToolExecutions: true,
    shouldClearDispatchPending: options.hasPendingDispatch,
  };
}

export function getNextTelegramToolExecutionCount(options: {
  hasActiveTurn: boolean;
  currentCount: number;
  event: "start" | "end";
}): number {
  if (!options.hasActiveTurn) return options.currentCount;
  if (options.event === "start") {
    return options.currentCount + 1;
  }
  return Math.max(0, options.currentCount - 1);
}

// --- Agent End Lifecycle ---

export interface TelegramAgentEndPlan {
  kind: "no-turn" | "aborted" | "error" | "text" | "attachments-only" | "empty";
  shouldClearPreview: boolean;
  shouldDispatchNext: boolean;
  shouldSendErrorMessage: boolean;
  shouldSendAttachmentNotice: boolean;
}

export function buildTelegramAgentEndPlan(options: {
  hasTurn: boolean;
  stopReason?: string;
  hasFinalText: boolean;
  hasQueuedAttachments: boolean;
  preserveQueuedTurnsAsHistory: boolean;
}): TelegramAgentEndPlan {
  const shouldDispatchNext = shouldDispatchAfterTelegramAgentEnd({
    hasTurn: options.hasTurn,
    stopReason: options.stopReason,
    preserveQueuedTurnsAsHistory: options.preserveQueuedTurnsAsHistory,
  });
  if (!options.hasTurn) {
    return {
      kind: "no-turn",
      shouldClearPreview: false,
      shouldDispatchNext,
      shouldSendErrorMessage: false,
      shouldSendAttachmentNotice: false,
    };
  }
  if (options.stopReason === "aborted") {
    return {
      kind: "aborted",
      shouldClearPreview: true,
      shouldDispatchNext,
      shouldSendErrorMessage: false,
      shouldSendAttachmentNotice: false,
    };
  }
  if (options.stopReason === "error") {
    return {
      kind: "error",
      shouldClearPreview: true,
      shouldDispatchNext,
      shouldSendErrorMessage: true,
      shouldSendAttachmentNotice: false,
    };
  }
  if (options.hasFinalText) {
    return {
      kind: "text",
      shouldClearPreview: false,
      shouldDispatchNext,
      shouldSendErrorMessage: false,
      shouldSendAttachmentNotice: false,
    };
  }
  if (options.hasQueuedAttachments) {
    return {
      kind: "attachments-only",
      shouldClearPreview: true,
      shouldDispatchNext,
      shouldSendErrorMessage: false,
      shouldSendAttachmentNotice: true,
    };
  }
  return {
    kind: "empty",
    shouldClearPreview: true,
    shouldDispatchNext,
    shouldSendErrorMessage: false,
    shouldSendAttachmentNotice: false,
  };
}

// --- Session Runtime ---

export interface TelegramPollingStartState {
  hasBotToken: boolean;
  hasPollingPromise: boolean;
}

export function shouldStartTelegramPolling(
  state: TelegramPollingStartState,
): boolean {
  return state.hasBotToken && !state.hasPollingPromise;
}

export function buildTelegramSessionStartState(
  currentModel: Model<any> | undefined,
): {
  currentTelegramModel: Model<any> | undefined;
  activeTelegramToolExecutions: number;
  pendingTelegramModelSwitch: undefined;
  nextQueuedTelegramItemOrder: number;
  nextQueuedTelegramControlOrder: number;
  telegramTurnDispatchPending: boolean;
  compactionInProgress: boolean;
} {
  return {
    currentTelegramModel: currentModel,
    activeTelegramToolExecutions: 0,
    pendingTelegramModelSwitch: undefined,
    nextQueuedTelegramItemOrder: 0,
    nextQueuedTelegramControlOrder: 0,
    telegramTurnDispatchPending: false,
    compactionInProgress: false,
  };
}

export function buildTelegramSessionShutdownState<TQueueItem>(): {
  queuedTelegramItems: TQueueItem[];
  nextQueuedTelegramItemOrder: number;
  nextQueuedTelegramControlOrder: number;
  nextPriorityReactionOrder: number;
  currentTelegramModel: undefined;
  activeTelegramToolExecutions: number;
  pendingTelegramModelSwitch: undefined;
  telegramTurnDispatchPending: boolean;
  compactionInProgress: boolean;
  preserveQueuedTurnsAsHistory: boolean;
} {
  return {
    queuedTelegramItems: [],
    nextQueuedTelegramItemOrder: 0,
    nextQueuedTelegramControlOrder: 0,
    nextPriorityReactionOrder: 0,
    currentTelegramModel: undefined,
    activeTelegramToolExecutions: 0,
    pendingTelegramModelSwitch: undefined,
    telegramTurnDispatchPending: false,
    compactionInProgress: false,
    preserveQueuedTurnsAsHistory: false,
  };
}

// --- Control Runtime ---

export interface TelegramControlRuntimeDeps {
  ctx: ExtensionContext;
  sendTextReply: (
    chatId: number,
    replyToMessageId: number,
    text: string,
  ) => Promise<number | undefined>;
  onSettled: () => void;
}

export async function executeTelegramControlItemRuntime(
  item: PendingTelegramControlItem,
  deps: TelegramControlRuntimeDeps,
): Promise<void> {
  try {
    await item.execute(deps.ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.sendTextReply(
      item.chatId,
      item.replyToMessageId,
      `Telegram control action failed: ${message}`,
    );
  } finally {
    deps.onSettled();
  }
}

// --- Dispatch Runtime ---

export interface TelegramDispatchRuntimeDeps {
  executeControlItem: (
    item: Extract<TelegramQueueDispatchAction, { kind: "control" }>["item"],
  ) => void;
  onPromptDispatchStart: (chatId: number) => void;
  sendUserMessage: (
    content: Extract<
      TelegramQueueDispatchAction,
      { kind: "prompt" }
    >["item"]["content"],
  ) => void;
  onPromptDispatchFailure: (message: string) => void;
  onIdle: () => void;
}

export function executeTelegramQueueDispatchPlan(
  plan: TelegramQueueDispatchAction,
  deps: TelegramDispatchRuntimeDeps,
): void {
  if (plan.kind === "none") {
    deps.onIdle();
    return;
  }
  if (plan.kind === "control") {
    deps.executeControlItem(plan.item);
    return;
  }
  deps.onPromptDispatchStart(plan.item.chatId);
  try {
    deps.sendUserMessage(plan.item.content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.onPromptDispatchFailure(message);
  }
}
