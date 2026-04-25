/**
 * Telegram command routing helpers
 * Owns slash-command normalization and command side-effect branching behind runtime ports
 */

import { pairTelegramUserIfNeeded } from "./config.ts";
import {
  createTelegramControlItemBuilder,
  createTelegramControlQueueController,
  type PendingTelegramControlItem,
} from "./queue.ts";

export interface ParsedTelegramCommand {
  name: string;
  args: string;
}

export interface TelegramBotCommandDefinition {
  command: string;
  description: string;
}

export const TELEGRAM_BOT_COMMANDS: readonly TelegramBotCommandDefinition[] = [
  {
    command: "start",
    description: "Show help and pair the Telegram bridge",
  },
  {
    command: "status",
    description: "Show model, usage, cost, and context status",
  },
  { command: "model", description: "Open the interactive model selector" },
  { command: "compact", description: "Compact the current pi session" },
  { command: "stop", description: "Abort the current pi task" },
];

export interface TelegramBotCommandRegistrationDeps {
  setMyCommands: (
    commands: readonly TelegramBotCommandDefinition[],
  ) => Promise<unknown>;
}

export async function registerTelegramBotCommands(
  deps: TelegramBotCommandRegistrationDeps,
): Promise<void> {
  await deps.setMyCommands(TELEGRAM_BOT_COMMANDS);
}

export function createTelegramBotCommandRegistrar(
  deps: TelegramBotCommandRegistrationDeps,
): () => Promise<void> {
  return () => registerTelegramBotCommands(deps);
}

export type TelegramCommandAction =
  | { kind: "ignore"; executionMode: "ignored" }
  | { kind: "stop"; executionMode: "immediate" }
  | { kind: "compact"; executionMode: "immediate" }
  | { kind: "status"; executionMode: "control-queue" }
  | { kind: "model"; executionMode: "control-queue" }
  | {
      kind: "help";
      commandName: "help" | "start";
      executionMode: "immediate";
    };

export type TelegramCommandExecutionMode =
  | "ignored"
  | "immediate"
  | "control-queue";

export interface TelegramCommandActionDeps<TMessage, TContext> {
  handleStop: (message: TMessage, ctx: TContext) => Promise<void>;
  handleCompact: (message: TMessage, ctx: TContext) => Promise<void>;
  handleStatus: (message: TMessage, ctx: TContext) => Promise<void>;
  handleModel: (message: TMessage, ctx: TContext) => Promise<void>;
  handleHelp: (
    message: TMessage,
    commandName: "help" | "start",
    ctx: TContext,
  ) => Promise<void>;
}

export interface TelegramStopCommandDeps {
  hasAbortHandler: () => boolean;
  clearPendingModelSwitch: () => void;
  hasQueuedTelegramItems: () => boolean;
  setPreserveQueuedTurnsAsHistory: (preserve: boolean) => void;
  abortCurrentTurn: () => void;
  updateStatus: () => void;
  sendTextReply: (text: string) => Promise<void>;
}

export interface TelegramRuntimeEventRecorderPort {
  recordRuntimeEvent?: (
    category: string,
    error: unknown,
    details?: Record<string, unknown>,
  ) => void;
}

export interface TelegramCompactCommandDeps
  extends TelegramRuntimeEventRecorderPort {
  isIdle: () => boolean;
  hasPendingMessages: () => boolean;
  hasActiveTelegramTurn: () => boolean;
  hasDispatchPending: () => boolean;
  hasQueuedTelegramItems: () => boolean;
  isCompactionInProgress: () => boolean;
  setCompactionInProgress: (inProgress: boolean) => void;
  updateStatus: () => void;
  dispatchNextQueuedTelegramTurn: () => void;
  compact: (callbacks: {
    onComplete: () => void;
    onError: (error: unknown) => void;
  }) => void;
  sendTextReply: (text: string) => Promise<void>;
}

export interface TelegramHelpCommandDeps {
  senderUserId?: number;
  getAllowedUserId: () => number | undefined;
  setAllowedUserId: (userId: number) => void;
  registerBotCommands: () => Promise<void>;
  persistConfig: () => Promise<void>;
  updateStatus: () => void;
  sendTextReply: (text: string) => Promise<void>;
}

export type TelegramControlCommandType =
  PendingTelegramControlItem<unknown>["controlType"];

export interface TelegramQueuedControlCommandDeps<TContext> {
  enqueueControlItem: (
    controlType: TelegramControlCommandType,
    statusSummary: string,
    execute: (ctx: TContext) => Promise<void>,
  ) => void;
}

export interface TelegramCommandRuntimeMessage {
  chat: { id: number };
  message_id: number;
  from?: { id?: number };
}

export interface TelegramCommandMessageTarget {
  chatId: number;
  replyToMessageId: number;
}

export interface TelegramCommandTargetRuntimeDeps<TContext> {
  enqueueControlItem: (
    target: TelegramCommandMessageTarget,
    ctx: TContext,
    controlType: TelegramControlCommandType,
    statusSummary: string,
    execute: (ctx: TContext) => Promise<void>,
  ) => void;
  showStatus: (
    chatId: number,
    replyToMessageId: number,
    ctx: TContext,
  ) => Promise<void>;
  openModelMenu: (
    chatId: number,
    replyToMessageId: number,
    ctx: TContext,
  ) => Promise<void>;
  sendTextReply: (
    chatId: number,
    replyToMessageId: number,
    text: string,
  ) => Promise<unknown>;
}

export interface TelegramCommandTargetRuntime<
  TMessage extends TelegramCommandRuntimeMessage,
  TContext,
> {
  enqueueControlItem: (
    message: TMessage,
    ctx: TContext,
    controlType: TelegramControlCommandType,
    statusSummary: string,
    execute: (ctx: TContext) => Promise<void>,
  ) => void;
  showStatus: (message: TMessage, ctx: TContext) => Promise<void>;
  openModelMenu: (message: TMessage, ctx: TContext) => Promise<void>;
  sendTextReply: (message: TMessage, text: string) => Promise<void>;
}

export function getTelegramCommandMessageTarget(
  message: TelegramCommandRuntimeMessage,
): TelegramCommandMessageTarget {
  return {
    chatId: message.chat.id,
    replyToMessageId: message.message_id,
  };
}

export interface TelegramCommandControlQueueRuntimeDeps<TContext> {
  createControlItem: (options: {
    chatId: number;
    replyToMessageId: number;
    controlType: TelegramControlCommandType;
    statusSummary: string;
    execute: (ctx: TContext) => Promise<void>;
  }) => PendingTelegramControlItem<TContext>;
  appendControlItem: (
    item: PendingTelegramControlItem<TContext>,
    ctx: TContext,
  ) => void;
  dispatchNextQueuedTelegramTurn: (ctx: TContext) => void;
}

export function createTelegramCommandControlQueueRuntime<TContext>(
  deps: TelegramCommandControlQueueRuntimeDeps<TContext>,
): TelegramCommandTargetRuntimeDeps<TContext>["enqueueControlItem"] {
  const controlQueueController = createTelegramControlQueueController({
    appendControlItem: deps.appendControlItem,
    dispatchNextQueuedTelegramTurn: deps.dispatchNextQueuedTelegramTurn,
  });
  return createTelegramCommandControlEnqueueAdapter({
    createControlItem: deps.createControlItem,
    enqueueControlItem: controlQueueController.enqueue,
  });
}

export function createTelegramCommandControlEnqueueAdapter<TContext>(deps: {
  createControlItem: (options: {
    chatId: number;
    replyToMessageId: number;
    controlType: TelegramControlCommandType;
    statusSummary: string;
    execute: (ctx: TContext) => Promise<void>;
  }) => PendingTelegramControlItem<TContext>;
  enqueueControlItem: (
    item: PendingTelegramControlItem<TContext>,
    ctx: TContext,
  ) => void;
}): TelegramCommandTargetRuntimeDeps<TContext>["enqueueControlItem"] {
  return (target, ctx, controlType, statusSummary, execute) => {
    deps.enqueueControlItem(
      deps.createControlItem({
        ...target,
        controlType,
        statusSummary,
        execute,
      }),
      ctx,
    );
  };
}

export type TelegramCommandTargetQueueRuntimeDeps<TContext> =
  TelegramCommandControlQueueRuntimeDeps<TContext> &
    Omit<TelegramCommandTargetRuntimeDeps<TContext>, "enqueueControlItem">;

export function createTelegramCommandTargetQueueRuntime<
  TMessage extends TelegramCommandRuntimeMessage,
  TContext,
>(
  deps: TelegramCommandTargetQueueRuntimeDeps<TContext>,
): TelegramCommandTargetRuntime<TMessage, TContext> {
  return createTelegramCommandTargetRuntime({
    enqueueControlItem: createTelegramCommandControlQueueRuntime({
      createControlItem: deps.createControlItem,
      appendControlItem: deps.appendControlItem,
      dispatchNextQueuedTelegramTurn: deps.dispatchNextQueuedTelegramTurn,
    }),
    showStatus: deps.showStatus,
    openModelMenu: deps.openModelMenu,
    sendTextReply: deps.sendTextReply,
  });
}

export function createTelegramCommandTargetRuntime<
  TMessage extends TelegramCommandRuntimeMessage,
  TContext,
>(
  deps: TelegramCommandTargetRuntimeDeps<TContext>,
): TelegramCommandTargetRuntime<TMessage, TContext> {
  return {
    enqueueControlItem: (message, ctx, controlType, statusSummary, execute) => {
      deps.enqueueControlItem(
        getTelegramCommandMessageTarget(message),
        ctx,
        controlType,
        statusSummary,
        execute,
      );
    },
    showStatus: (message, ctx) => {
      const target = getTelegramCommandMessageTarget(message);
      return deps.showStatus(target.chatId, target.replyToMessageId, ctx);
    },
    openModelMenu: (message, ctx) => {
      const target = getTelegramCommandMessageTarget(message);
      return deps.openModelMenu(target.chatId, target.replyToMessageId, ctx);
    },
    sendTextReply: async (message, text) => {
      const target = getTelegramCommandMessageTarget(message);
      await deps.sendTextReply(target.chatId, target.replyToMessageId, text);
    },
  };
}

export interface TelegramCommandOrPromptRuntimeDeps<TMessage, TContext> {
  extractRawText: (messages: TMessage[]) => string;
  handleCommand: (
    commandName: string | undefined,
    message: TMessage,
    ctx: TContext,
  ) => Promise<boolean>;
  enqueueTurn: (messages: TMessage[], ctx: TContext) => Promise<void>;
}

export interface TelegramCommandRuntimeDeps<
  TMessage extends TelegramCommandRuntimeMessage,
  TContext,
> extends TelegramRuntimeEventRecorderPort {
  hasAbortHandler: () => boolean;
  clearPendingModelSwitch: () => void;
  hasQueuedTelegramItems: () => boolean;
  setPreserveQueuedTurnsAsHistory: (preserve: boolean) => void;
  abortCurrentTurn: () => void;
  isIdle: (ctx: TContext) => boolean;
  hasPendingMessages: (ctx: TContext) => boolean;
  hasActiveTelegramTurn: () => boolean;
  hasDispatchPending: () => boolean;
  isCompactionInProgress: () => boolean;
  setCompactionInProgress: (inProgress: boolean) => void;
  updateStatus: (ctx: TContext) => void;
  dispatchNextQueuedTelegramTurn: (ctx: TContext) => void;
  compact: (
    ctx: TContext,
    callbacks: { onComplete: () => void; onError: (error: unknown) => void },
  ) => void;
  enqueueControlItem: (
    message: TMessage,
    ctx: TContext,
    controlType: TelegramControlCommandType,
    statusSummary: string,
    execute: (ctx: TContext) => Promise<void>,
  ) => void;
  showStatus: (message: TMessage, ctx: TContext) => Promise<void>;
  openModelMenu: (message: TMessage, ctx: TContext) => Promise<void>;
  getAllowedUserId: () => number | undefined;
  setAllowedUserId: (userId: number) => void;
  registerBotCommands: () => Promise<void>;
  persistConfig: () => Promise<void>;
  sendTextReply: (message: TMessage, text: string) => Promise<void>;
}

export const TELEGRAM_HELP_TEXT =
  "Send me a message and I will forward it to pi. Commands: /status, /model, /compact, /stop.";

function getTelegramCommandErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function parseTelegramCommand(
  text: string,
): ParsedTelegramCommand | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return undefined;
  const [head, ...tail] = trimmed.split(/\s+/);
  const name = head.slice(1).split("@")[0]?.toLowerCase();
  if (!name) return undefined;
  return { name, args: tail.join(" ").trim() };
}

export function buildTelegramCommandAction(
  commandName: string | undefined,
): TelegramCommandAction {
  switch (commandName) {
    case "stop":
      return { kind: "stop", executionMode: "immediate" };
    case "compact":
      return { kind: "compact", executionMode: "immediate" };
    case "status":
      return { kind: "status", executionMode: "control-queue" };
    case "model":
      return { kind: "model", executionMode: "control-queue" };
    case "help":
    case "start":
      return { kind: "help", commandName, executionMode: "immediate" };
    default:
      return { kind: "ignore", executionMode: "ignored" };
  }
}

export function getTelegramCommandExecutionMode(
  action: TelegramCommandAction,
): TelegramCommandExecutionMode {
  return action.executionMode;
}

export async function handleTelegramStopCommand(
  deps: TelegramStopCommandDeps,
): Promise<void> {
  if (!deps.hasAbortHandler()) {
    await deps.sendTextReply("No active turn.");
    return;
  }
  deps.clearPendingModelSwitch();
  if (deps.hasQueuedTelegramItems()) {
    deps.setPreserveQueuedTurnsAsHistory(true);
  }
  deps.abortCurrentTurn();
  deps.updateStatus();
  await deps.sendTextReply("Aborted current turn.");
}

export async function handleTelegramCompactCommand(
  deps: TelegramCompactCommandDeps,
): Promise<void> {
  if (
    !deps.isIdle() ||
    deps.hasPendingMessages() ||
    deps.hasActiveTelegramTurn() ||
    deps.hasDispatchPending() ||
    deps.hasQueuedTelegramItems() ||
    deps.isCompactionInProgress()
  ) {
    await deps.sendTextReply(
      "Cannot compact while pi or the Telegram queue is busy. Wait for queued turns to finish or send /stop first.",
    );
    return;
  }
  deps.setCompactionInProgress(true);
  deps.updateStatus();
  try {
    deps.compact({
      onComplete: () => {
        deps.setCompactionInProgress(false);
        deps.updateStatus();
        deps.dispatchNextQueuedTelegramTurn();
        void deps.sendTextReply("Compaction completed.");
      },
      onError: (error) => {
        deps.setCompactionInProgress(false);
        deps.updateStatus();
        deps.dispatchNextQueuedTelegramTurn();
        deps.recordRuntimeEvent?.("compact", error);
        const errorMessage = getTelegramCommandErrorMessage(error);
        void deps.sendTextReply(`Compaction failed: ${errorMessage}`);
      },
    });
  } catch (error) {
    deps.setCompactionInProgress(false);
    deps.updateStatus();
    deps.recordRuntimeEvent?.("compact", error);
    const errorMessage = getTelegramCommandErrorMessage(error);
    await deps.sendTextReply(`Compaction failed: ${errorMessage}`);
    return;
  }
  await deps.sendTextReply("Compaction started.");
}

export async function handleTelegramHelpCommand(
  commandName: "help" | "start",
  deps: TelegramHelpCommandDeps,
): Promise<void> {
  let helpText = TELEGRAM_HELP_TEXT;
  if (commandName === "start") {
    try {
      await deps.registerBotCommands();
    } catch (error) {
      const errorMessage = getTelegramCommandErrorMessage(error);
      helpText += `\n\nWarning: failed to register bot commands menu: ${errorMessage}`;
    }
  }
  await deps.sendTextReply(helpText);
  if (deps.senderUserId === undefined) return;
  await pairTelegramUserIfNeeded(deps.senderUserId, {
    allowedUserId: deps.getAllowedUserId(),
    ctx: undefined,
    setAllowedUserId: deps.setAllowedUserId,
    persistConfig: deps.persistConfig,
    updateStatus: deps.updateStatus,
  });
}

export async function handleTelegramStatusCommand<TContext>(
  deps: TelegramQueuedControlCommandDeps<TContext> & {
    showStatus: (ctx: TContext) => Promise<void>;
  },
): Promise<void> {
  deps.enqueueControlItem("status", "⚡ status", deps.showStatus);
}

export async function handleTelegramModelCommand<TContext>(
  deps: TelegramQueuedControlCommandDeps<TContext> & {
    openModelMenu: (ctx: TContext) => Promise<void>;
  },
): Promise<void> {
  deps.enqueueControlItem("model", "⚡ model", deps.openModelMenu);
}

export async function executeTelegramCommandAction<TMessage, TContext>(
  action: TelegramCommandAction,
  message: TMessage,
  ctx: TContext,
  deps: TelegramCommandActionDeps<TMessage, TContext>,
): Promise<boolean> {
  switch (action.kind) {
    case "ignore":
      return false;
    case "stop":
      await deps.handleStop(message, ctx);
      return true;
    case "compact":
      await deps.handleCompact(message, ctx);
      return true;
    case "status":
      await deps.handleStatus(message, ctx);
      return true;
    case "model":
      await deps.handleModel(message, ctx);
      return true;
    case "help":
      await deps.handleHelp(message, action.commandName, ctx);
      return true;
  }
}

export interface TelegramCommandHandlerTargetRuntimeDeps<
  TMessage extends TelegramCommandRuntimeMessage,
  TContext,
>
  extends
    Omit<
      TelegramCommandRuntimeDeps<TMessage, TContext>,
      | "enqueueControlItem"
      | "showStatus"
      | "openModelMenu"
      | "sendTextReply"
      | "registerBotCommands"
    >,
    Omit<TelegramCommandTargetQueueRuntimeDeps<TContext>, "createControlItem">,
    TelegramBotCommandRegistrationDeps {
  allocateItemOrder: () => number;
  allocateControlOrder: () => number;
}

export function createTelegramCommandHandlerTargetRuntime<
  TMessage extends TelegramCommandRuntimeMessage,
  TContext,
>(
  deps: TelegramCommandHandlerTargetRuntimeDeps<TMessage, TContext>,
): (
  commandName: string | undefined,
  message: TMessage,
  ctx: TContext,
) => Promise<boolean> {
  const commandTargetRuntime = createTelegramCommandTargetQueueRuntime<
    TMessage,
    TContext
  >({
    createControlItem: createTelegramControlItemBuilder<TContext>({
      allocateItemOrder: deps.allocateItemOrder,
      allocateControlOrder: deps.allocateControlOrder,
    }),
    appendControlItem: deps.appendControlItem,
    dispatchNextQueuedTelegramTurn: deps.dispatchNextQueuedTelegramTurn,
    showStatus: deps.showStatus,
    openModelMenu: deps.openModelMenu,
    sendTextReply: deps.sendTextReply,
  });
  return createTelegramCommandHandler({
    hasAbortHandler: deps.hasAbortHandler,
    clearPendingModelSwitch: deps.clearPendingModelSwitch,
    hasQueuedTelegramItems: deps.hasQueuedTelegramItems,
    setPreserveQueuedTurnsAsHistory: deps.setPreserveQueuedTurnsAsHistory,
    abortCurrentTurn: deps.abortCurrentTurn,
    isIdle: deps.isIdle,
    hasPendingMessages: deps.hasPendingMessages,
    hasActiveTelegramTurn: deps.hasActiveTelegramTurn,
    hasDispatchPending: deps.hasDispatchPending,
    isCompactionInProgress: deps.isCompactionInProgress,
    setCompactionInProgress: deps.setCompactionInProgress,
    updateStatus: deps.updateStatus,
    dispatchNextQueuedTelegramTurn: deps.dispatchNextQueuedTelegramTurn,
    compact: deps.compact,
    enqueueControlItem: commandTargetRuntime.enqueueControlItem,
    showStatus: commandTargetRuntime.showStatus,
    openModelMenu: commandTargetRuntime.openModelMenu,
    getAllowedUserId: deps.getAllowedUserId,
    setAllowedUserId: deps.setAllowedUserId,
    registerBotCommands: createTelegramBotCommandRegistrar({
      setMyCommands: deps.setMyCommands,
    }),
    persistConfig: deps.persistConfig,
    sendTextReply: commandTargetRuntime.sendTextReply,
    recordRuntimeEvent: deps.recordRuntimeEvent,
  });
}

export function createTelegramCommandHandler<
  TMessage extends TelegramCommandRuntimeMessage,
  TContext,
>(deps: TelegramCommandRuntimeDeps<TMessage, TContext>) {
  return async function handleTelegramCommand(
    commandName: string | undefined,
    message: TMessage,
    ctx: TContext,
  ): Promise<boolean> {
    return handleTelegramCommandRuntime(commandName, message, ctx, deps);
  };
}

export function createTelegramCommandOrPromptRuntime<TMessage, TContext>(
  deps: TelegramCommandOrPromptRuntimeDeps<TMessage, TContext>,
) {
  return {
    dispatchMessages: async (
      messages: TMessage[],
      ctx: TContext,
    ): Promise<void> => {
      const firstMessage = messages[0];
      if (!firstMessage) return;
      const commandName = parseTelegramCommand(
        deps.extractRawText(messages),
      )?.name;
      const handled = await deps.handleCommand(commandName, firstMessage, ctx);
      if (handled) return;
      await deps.enqueueTurn(messages, ctx);
    },
  };
}

async function handleTelegramCommandRuntime<
  TMessage extends TelegramCommandRuntimeMessage,
  TContext,
>(
  commandName: string | undefined,
  message: TMessage,
  ctx: TContext,
  deps: TelegramCommandRuntimeDeps<TMessage, TContext>,
): Promise<boolean> {
  const sendReplyFor = (nextMessage: TMessage) => (text: string) =>
    deps.sendTextReply(nextMessage, text);
  const updateStatusFor = (commandCtx: TContext) => () =>
    deps.updateStatus(commandCtx);
  const enqueueControlFor =
    (nextMessage: TMessage, commandCtx: TContext) =>
    (
      controlType: TelegramControlCommandType,
      statusSummary: string,
      execute: (ctx: TContext) => Promise<void>,
    ) => {
      deps.enqueueControlItem(
        nextMessage,
        commandCtx,
        controlType,
        statusSummary,
        execute,
      );
    };
  return executeTelegramCommandAction(
    buildTelegramCommandAction(commandName),
    message,
    ctx,
    {
      handleStop: async (nextMessage, commandCtx) => {
        await handleTelegramStopCommand({
          hasAbortHandler: deps.hasAbortHandler,
          clearPendingModelSwitch: deps.clearPendingModelSwitch,
          hasQueuedTelegramItems: deps.hasQueuedTelegramItems,
          setPreserveQueuedTurnsAsHistory: deps.setPreserveQueuedTurnsAsHistory,
          abortCurrentTurn: deps.abortCurrentTurn,
          updateStatus: updateStatusFor(commandCtx),
          sendTextReply: sendReplyFor(nextMessage),
        });
      },
      handleCompact: async (nextMessage, commandCtx) => {
        await handleTelegramCompactCommand({
          isIdle: () => deps.isIdle(commandCtx),
          hasPendingMessages: () => deps.hasPendingMessages(commandCtx),
          hasActiveTelegramTurn: deps.hasActiveTelegramTurn,
          hasDispatchPending: deps.hasDispatchPending,
          hasQueuedTelegramItems: deps.hasQueuedTelegramItems,
          isCompactionInProgress: deps.isCompactionInProgress,
          setCompactionInProgress: deps.setCompactionInProgress,
          updateStatus: updateStatusFor(commandCtx),
          dispatchNextQueuedTelegramTurn: () =>
            deps.dispatchNextQueuedTelegramTurn(commandCtx),
          compact: (callbacks) => deps.compact(commandCtx, callbacks),
          sendTextReply: sendReplyFor(nextMessage),
          recordRuntimeEvent: deps.recordRuntimeEvent,
        });
      },
      handleStatus: async (nextMessage, commandCtx) => {
        await handleTelegramStatusCommand<TContext>({
          enqueueControlItem: enqueueControlFor(nextMessage, commandCtx),
          showStatus: (controlCtx) => deps.showStatus(nextMessage, controlCtx),
        });
      },
      handleModel: async (nextMessage, commandCtx) => {
        await handleTelegramModelCommand<TContext>({
          enqueueControlItem: enqueueControlFor(nextMessage, commandCtx),
          openModelMenu: (controlCtx) =>
            deps.openModelMenu(nextMessage, controlCtx),
        });
      },
      handleHelp: async (nextMessage, nextCommandName, commandCtx) => {
        await handleTelegramHelpCommand(nextCommandName, {
          senderUserId: nextMessage.from?.id,
          getAllowedUserId: deps.getAllowedUserId,
          setAllowedUserId: deps.setAllowedUserId,
          registerBotCommands: deps.registerBotCommands,
          persistConfig: deps.persistConfig,
          updateStatus: updateStatusFor(commandCtx),
          sendTextReply: sendReplyFor(nextMessage),
        });
      },
    },
  );
}
