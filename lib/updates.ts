/**
 * Telegram updates domain helpers
 * Owns update extraction, authorization, classification, execution planning, and runtime execution for Telegram updates
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

// --- Extraction ---

export interface TelegramReactionTypeEmojiLike {
  type: "emoji";
  emoji: string;
}

export interface TelegramReactionTypeNonEmojiLike {
  type: string;
}

export type TelegramReactionTypeLike =
  | TelegramReactionTypeEmojiLike
  | TelegramReactionTypeNonEmojiLike;

export interface TelegramUpdateLike {
  deleted_business_messages?: { message_ids?: unknown };
}

function isTelegramMessageIdList(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => Number.isInteger(item));
}

export function normalizeTelegramReactionEmoji(emoji: string): string {
  return emoji.replace(/\uFE0F/g, "");
}

export function collectTelegramReactionEmojis(
  reactions: TelegramReactionTypeLike[],
): Set<string> {
  return new Set(
    reactions
      .filter(
        (reaction): reaction is TelegramReactionTypeEmojiLike =>
          reaction.type === "emoji",
      )
      .map((reaction) => normalizeTelegramReactionEmoji(reaction.emoji)),
  );
}

export function extractDeletedTelegramMessageIds(
  update: TelegramUpdateLike,
): number[] {
  const deletedBusinessMessageIds =
    update.deleted_business_messages?.message_ids;
  if (isTelegramMessageIdList(deletedBusinessMessageIds)) {
    return deletedBusinessMessageIds;
  }
  return [];
}

// --- Routing ---

export interface TelegramUserLike {
  id: number;
  is_bot: boolean;
}

export interface TelegramChatLike {
  id?: number;
  type: string;
}

export interface TelegramMessageLike {
  chat: TelegramChatLike;
  from?: TelegramUserLike;
  message_id?: number;
}

export interface TelegramCallbackQueryLike {
  id?: string;
  from: TelegramUserLike;
  message?: TelegramMessageLike;
}

export interface TelegramUpdateRoutingLike {
  message?: TelegramMessageLike;
  edited_message?: TelegramMessageLike;
  callback_query?: TelegramCallbackQueryLike;
}

export type TelegramAuthorizationState =
  | { kind: "pair"; userId: number }
  | { kind: "allow" }
  | { kind: "deny" };

export function getTelegramAuthorizationState(
  userId: number,
  allowedUserId?: number,
): TelegramAuthorizationState {
  if (allowedUserId === undefined) {
    return { kind: "pair", userId };
  }
  if (userId === allowedUserId) {
    return { kind: "allow" };
  }
  return { kind: "deny" };
}

export function getAuthorizedTelegramCallbackQuery(
  update: TelegramUpdateRoutingLike,
): TelegramCallbackQueryLike | undefined {
  const query = update.callback_query;
  if (!query) return undefined;
  const message = query.message;
  if (!message || message.chat.type !== "private" || query.from.is_bot) {
    return undefined;
  }
  return query;
}

export function getAuthorizedTelegramMessage(
  update: TelegramUpdateRoutingLike,
): TelegramMessageLike | undefined {
  const message = update.message;
  if (
    !message ||
    message.chat.type !== "private" ||
    !message.from ||
    message.from.is_bot
  ) {
    return undefined;
  }
  return message;
}

export function getAuthorizedTelegramEditedMessage(
  update: TelegramUpdateRoutingLike,
): TelegramMessageLike | undefined {
  const message = update.edited_message;
  if (
    !message ||
    message.chat.type !== "private" ||
    !message.from ||
    message.from.is_bot
  ) {
    return undefined;
  }
  return message;
}

// --- Flow ---

export interface TelegramMessageReactionUpdatedLike {
  chat: { type: string };
  user?: TelegramUserLike;
}

export interface TelegramUpdateFlowLike
  extends TelegramUpdateRoutingLike, TelegramUpdateLike {
  message_reaction?: TelegramMessageReactionUpdatedLike;
}

export type TelegramUpdateFlowAction =
  | { kind: "ignore" }
  | { kind: "deleted"; messageIds: number[] }
  | { kind: "reaction"; reactionUpdate: TelegramMessageReactionUpdatedLike }
  | {
      kind: "callback";
      query: TelegramCallbackQueryLike;
      authorization: TelegramAuthorizationState;
    }
  | {
      kind: "message";
      message: TelegramMessageLike & { from: TelegramUserLike };
      authorization: TelegramAuthorizationState;
    }
  | {
      kind: "edited-message";
      message: TelegramMessageLike & { from: TelegramUserLike };
      authorization: TelegramAuthorizationState;
    };

export function buildTelegramUpdateFlowAction(
  update: TelegramUpdateFlowLike,
  allowedUserId?: number,
): TelegramUpdateFlowAction {
  const deletedMessageIds = extractDeletedTelegramMessageIds(update);
  if (deletedMessageIds.length > 0) {
    return { kind: "deleted", messageIds: deletedMessageIds };
  }
  if (update.message_reaction) {
    return { kind: "reaction", reactionUpdate: update.message_reaction };
  }
  const query = getAuthorizedTelegramCallbackQuery(update);
  if (query) {
    return {
      kind: "callback",
      query,
      authorization: getTelegramAuthorizationState(
        query.from.id,
        allowedUserId,
      ),
    };
  }
  const message = getAuthorizedTelegramMessage(update);
  if (message?.from) {
    return {
      kind: "message",
      message: message as TelegramMessageLike & { from: TelegramUserLike },
      authorization: getTelegramAuthorizationState(
        message.from.id,
        allowedUserId,
      ),
    };
  }
  const editedMessage = getAuthorizedTelegramEditedMessage(update);
  if (editedMessage?.from) {
    return {
      kind: "edited-message",
      message: editedMessage as TelegramMessageLike & {
        from: TelegramUserLike;
      },
      authorization: getTelegramAuthorizationState(
        editedMessage.from.id,
        allowedUserId,
      ),
    };
  }
  return { kind: "ignore" };
}

// --- Execution Planning ---

export type TelegramUpdateExecutionPlan =
  | { kind: "ignore" }
  | { kind: "deleted"; messageIds: number[] }
  | {
      kind: "reaction";
      reactionUpdate: NonNullable<TelegramUpdateFlowLike["message_reaction"]>;
    }
  | {
      kind: "callback";
      query: TelegramCallbackQueryLike;
      shouldPair: boolean;
      shouldDeny: boolean;
    }
  | {
      kind: "message";
      message: TelegramMessageLike & { from: TelegramUserLike };
      shouldPair: boolean;
      shouldNotifyPaired: boolean;
      shouldDeny: boolean;
    }
  | {
      kind: "edited-message";
      message: TelegramMessageLike & { from: TelegramUserLike };
      shouldPair: boolean;
      shouldDeny: boolean;
    };

export function buildTelegramUpdateExecutionPlan(
  action: TelegramUpdateFlowAction,
): TelegramUpdateExecutionPlan {
  switch (action.kind) {
    case "ignore":
      return { kind: "ignore" };
    case "deleted":
      return { kind: "deleted", messageIds: action.messageIds };
    case "reaction":
      return { kind: "reaction", reactionUpdate: action.reactionUpdate };
    case "callback":
      return {
        kind: "callback",
        query: action.query,
        shouldPair: action.authorization.kind === "pair",
        shouldDeny: action.authorization.kind === "deny",
      };
    case "message":
      return {
        kind: "message",
        message: action.message,
        shouldPair: action.authorization.kind === "pair",
        shouldNotifyPaired: action.authorization.kind === "pair",
        shouldDeny: action.authorization.kind === "deny",
      };
    case "edited-message":
      return {
        kind: "edited-message",
        message: action.message,
        shouldPair: action.authorization.kind === "pair",
        shouldDeny: action.authorization.kind === "deny",
      };
  }
}

export function buildTelegramUpdateExecutionPlanFromUpdate(
  update: TelegramUpdateFlowLike,
  allowedUserId?: number,
): TelegramUpdateExecutionPlan {
  return buildTelegramUpdateExecutionPlan(
    buildTelegramUpdateFlowAction(update, allowedUserId),
  );
}

// --- Runtime ---

export interface TelegramUpdateRuntimeDeps {
  ctx: ExtensionContext;
  removePendingMediaGroupMessages: (messageIds: number[]) => void;
  removeQueuedTelegramTurnsByMessageIds: (
    messageIds: number[],
    ctx: ExtensionContext,
  ) => number;
  handleAuthorizedTelegramReactionUpdate: (
    reactionUpdate: NonNullable<
      Extract<
        TelegramUpdateExecutionPlan,
        { kind: "reaction" }
      >["reactionUpdate"]
    >,
    ctx: ExtensionContext,
  ) => Promise<void>;
  pairTelegramUserIfNeeded: (
    userId: number,
    ctx: ExtensionContext,
  ) => Promise<boolean>;
  answerCallbackQuery: (
    callbackQueryId: string,
    text?: string,
  ) => Promise<void>;
  handleAuthorizedTelegramCallbackQuery: (
    query: Extract<TelegramUpdateExecutionPlan, { kind: "callback" }>["query"],
    ctx: ExtensionContext,
  ) => Promise<void>;
  sendTextReply: (
    chatId: number,
    replyToMessageId: number,
    text: string,
  ) => Promise<number | undefined>;
  handleAuthorizedTelegramMessage: (
    message: Extract<
      TelegramUpdateExecutionPlan,
      { kind: "message" }
    >["message"],
    ctx: ExtensionContext,
  ) => Promise<void>;
  handleAuthorizedTelegramEditedMessage: (
    message: Extract<
      TelegramUpdateExecutionPlan,
      { kind: "edited-message" }
    >["message"],
    ctx: ExtensionContext,
  ) => Promise<void>;
}

function getTelegramCallbackQueryId(
  query: TelegramCallbackQueryLike,
): string | undefined {
  return typeof query.id === "string" ? query.id : undefined;
}

function getTelegramMessageReplyTarget(
  message: TelegramMessageLike,
): { chatId: number; messageId: number } | undefined {
  if (
    typeof message.chat.id !== "number" ||
    typeof message.message_id !== "number"
  ) {
    return undefined;
  }
  return {
    chatId: message.chat.id,
    messageId: message.message_id,
  };
}

export async function executeTelegramUpdate(
  update: TelegramUpdateFlowLike,
  allowedUserId: number | undefined,
  deps: TelegramUpdateRuntimeDeps,
): Promise<void> {
  await executeTelegramUpdatePlan(
    buildTelegramUpdateExecutionPlanFromUpdate(update, allowedUserId),
    deps,
  );
}

export async function executeTelegramUpdatePlan(
  plan: TelegramUpdateExecutionPlan,
  deps: TelegramUpdateRuntimeDeps,
): Promise<void> {
  if (plan.kind === "ignore") return;
  if (plan.kind === "deleted") {
    deps.removePendingMediaGroupMessages(plan.messageIds);
    deps.removeQueuedTelegramTurnsByMessageIds(plan.messageIds, deps.ctx);
    return;
  }
  if (plan.kind === "reaction") {
    await deps.handleAuthorizedTelegramReactionUpdate(
      plan.reactionUpdate,
      deps.ctx,
    );
    return;
  }
  if (plan.kind === "callback") {
    if (plan.shouldPair) {
      await deps.pairTelegramUserIfNeeded(plan.query.from.id, deps.ctx);
    }
    if (plan.shouldDeny) {
      const callbackQueryId = getTelegramCallbackQueryId(plan.query);
      if (callbackQueryId) {
        await deps.answerCallbackQuery(
          callbackQueryId,
          "This bot is not authorized for your account.",
        );
      }
      return;
    }
    await deps.handleAuthorizedTelegramCallbackQuery(plan.query, deps.ctx);
    return;
  }
  const pairedNow = plan.shouldPair
    ? await deps.pairTelegramUserIfNeeded(plan.message.from.id, deps.ctx)
    : false;
  const replyTarget = getTelegramMessageReplyTarget(plan.message);
  if (
    plan.kind === "message" &&
    pairedNow &&
    plan.shouldNotifyPaired &&
    replyTarget
  ) {
    await deps.sendTextReply(
      replyTarget.chatId,
      replyTarget.messageId,
      "Telegram bridge paired with this account.",
    );
  }
  if (plan.shouldDeny) {
    if (replyTarget) {
      await deps.sendTextReply(
        replyTarget.chatId,
        replyTarget.messageId,
        "This bot is not authorized for your account.",
      );
    }
    return;
  }
  if (plan.kind === "edited-message") {
    await deps.handleAuthorizedTelegramEditedMessage(plan.message, deps.ctx);
    return;
  }
  await deps.handleAuthorizedTelegramMessage(plan.message, deps.ctx);
}
