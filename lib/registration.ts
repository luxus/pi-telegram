/**
 * Telegram extension registration helpers
 * Owns tool, command, and lifecycle-hook registration so index.ts can stay focused on runtime orchestration state and side effects
 */

import { Type } from "@sinclair/typebox";

import {
  queueTelegramAttachments,
  TELEGRAM_OUTBOUND_ATTACHMENT_MAX_BYTES,
  type TelegramAttachmentQueueTargetView,
} from "./attachments.ts";
import type {
  AgentEndEvent,
  AgentStartEvent,
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  SessionShutdownEvent,
  SessionStartEvent,
} from "./pi.ts";
import { TELEGRAM_PREFIX } from "./turns.ts";

const MAX_ATTACHMENTS_PER_TURN = 10;

const SYSTEM_PROMPT_SUFFIX = `

Telegram bridge extension is active.
- Messages forwarded from Telegram are prefixed with "[telegram]".
- [telegram] messages may include [attachments] sections with a base directory plus relative local file entries. Resolve and read those files as needed.
- Telegram is often read on narrow phone screens, so prefer narrow table columns when presenting tabular data; wide monospace tables can become unreadable.
- If a [telegram] user asked for a file or generated artifact, use the telegram_attach tool with the local file path so the extension can send it with your next final reply.
- Do not assume mentioning a local file path in plain text will send it to Telegram. Use telegram_attach.`;

// --- Tool Registration ---

export interface TelegramRuntimeEventRecorderPort {
  recordRuntimeEvent?: (
    category: string,
    error: unknown,
    details?: Record<string, unknown>,
  ) => void;
}

export interface TelegramAttachmentToolRegistrationDeps
  extends TelegramRuntimeEventRecorderPort {
  maxAttachmentsPerTurn?: number;
  maxAttachmentSizeBytes?: number;
  getActiveTurn: () => TelegramAttachmentQueueTargetView | undefined;
  statPath?: (path: string) => Promise<{ isFile(): boolean; size?: number }>;
}

export function registerTelegramAttachmentTool(
  pi: ExtensionAPI,
  deps: TelegramAttachmentToolRegistrationDeps,
): void {
  const maxAttachmentsPerTurn =
    deps.maxAttachmentsPerTurn ?? MAX_ATTACHMENTS_PER_TURN;
  const maxAttachmentSizeBytes =
    deps.maxAttachmentSizeBytes ?? TELEGRAM_OUTBOUND_ATTACHMENT_MAX_BYTES;
  pi.registerTool({
    name: "telegram_attach",
    label: "Telegram Attach",
    description:
      "Queue one or more local files to be sent with the next Telegram reply.",
    promptSnippet: "Queue local files to be sent with the next Telegram reply.",
    promptGuidelines: [
      "When handling a [telegram] message and the user asked for a file or generated artifact, call telegram_attach with the local path instead of only mentioning the path in text.",
    ],
    parameters: Type.Object({
      paths: Type.Array(
        Type.String({ description: "Local file path to attach" }),
        { minItems: 1, maxItems: maxAttachmentsPerTurn },
      ),
    }),
    async execute(_toolCallId, params) {
      try {
        return await queueTelegramAttachments({
          activeTurn: deps.getActiveTurn(),
          paths: params.paths,
          maxAttachmentsPerTurn,
          maxAttachmentSizeBytes,
          statPath: deps.statPath,
        });
      } catch (error) {
        deps.recordRuntimeEvent?.("attachment", error, {
          phase: "queue",
          count: params.paths.length,
        });
        throw error;
      }
    },
  });
}

// --- Command Registration ---

export interface TelegramCommandStartPollingOptions {
  force?: boolean;
}

export interface TelegramCommandStartPollingResult {
  ok: boolean;
  message?: string;
  canTakeover?: boolean;
  owner?: string;
}

export interface TelegramCommandRegistrationDeps {
  promptForConfig: (ctx: ExtensionCommandContext) => Promise<void>;
  getStatusLines: () => string[];
  reloadConfig: () => Promise<void>;
  hasBotToken: () => boolean;
  startPolling: (
    ctx: ExtensionCommandContext,
    options?: TelegramCommandStartPollingOptions,
  ) =>
    | void
    | Promise<void | TelegramCommandStartPollingResult>
    | TelegramCommandStartPollingResult;
  stopPolling: () => Promise<void | string>;
  updateStatus: (ctx: ExtensionCommandContext) => void;
}

function formatTelegramTakeoverTitle(ctx: ExtensionCommandContext): string {
  return ctx.ui.theme.fg("accent", "pi-telegram");
}

function formatTelegramTakeoverPrompt(
  ctx: ExtensionCommandContext,
  owner?: string,
): string {
  const theme = ctx.ui.theme;
  const action = theme.fg("warning", "move singleton lock here?");
  const from = theme.fg("muted", "from:");
  const to = theme.fg("muted", "to:");
  const source = owner ?? "another pi instance";
  return `${action}\n\n${from} ${source}\n${to} ${ctx.cwd}`;
}

export function registerTelegramCommands(
  pi: ExtensionAPI,
  deps: TelegramCommandRegistrationDeps,
): void {
  pi.registerCommand("telegram-setup", {
    description: "Configure Telegram bot token",
    handler: async (_args, ctx) => {
      await deps.promptForConfig(ctx);
    },
  });
  pi.registerCommand("telegram-status", {
    description: "Show Telegram bridge status",
    handler: async (_args, ctx) => {
      ctx.ui.notify(deps.getStatusLines().join("\n"), "info");
    },
  });
  pi.registerCommand("telegram-connect", {
    description: "Start the Telegram bridge in this pi session",
    handler: async (_args, ctx) => {
      await deps.reloadConfig();
      if (!deps.hasBotToken()) {
        await deps.promptForConfig(ctx);
        return;
      }
      let result = await deps.startPolling(ctx);
      if (result && !result.ok && result.canTakeover) {
        const confirmed = await ctx.ui.confirm(
          formatTelegramTakeoverTitle(ctx),
          formatTelegramTakeoverPrompt(ctx, result.owner),
        );
        if (!confirmed) {
          ctx.ui.notify("Telegram bridge takeover cancelled.", "info");
          deps.updateStatus(ctx);
          return;
        }
        result = await deps.startPolling(ctx, { force: true });
      }
      if (result?.message) {
        ctx.ui.notify(result.message, result.ok ? "info" : "warning");
      }
      deps.updateStatus(ctx);
    },
  });
  pi.registerCommand("telegram-disconnect", {
    description: "Stop the Telegram bridge in this pi session",
    handler: async (_args, ctx) => {
      const message = await deps.stopPolling();
      if (message) ctx.ui.notify(message, "info");
      deps.updateStatus(ctx);
    },
  });
}

// --- Lifecycle Hook Registration ---

export function buildTelegramBridgeSystemPrompt(options: {
  prompt: string;
  systemPrompt: string;
  telegramPrefix?: string;
  systemPromptSuffix: string;
}): { systemPrompt: string } {
  const telegramPrefix = options.telegramPrefix ?? TELEGRAM_PREFIX;
  const suffix = options.prompt.trimStart().startsWith(telegramPrefix)
    ? `${options.systemPromptSuffix}\n- The current user message came from Telegram.`
    : options.systemPromptSuffix;
  return { systemPrompt: options.systemPrompt + suffix };
}

export function createTelegramBeforeAgentStartHook(
  options: {
    telegramPrefix?: string;
    systemPromptSuffix?: string;
  } = {},
): (event: BeforeAgentStartEvent) => { systemPrompt: string } {
  return (event) =>
    buildTelegramBridgeSystemPrompt({
      prompt: event.prompt,
      systemPrompt: event.systemPrompt,
      telegramPrefix: options.telegramPrefix,
      systemPromptSuffix: options.systemPromptSuffix ?? SYSTEM_PROMPT_SUFFIX,
    });
}

export interface TelegramBeforeAgentStartResult {
  systemPrompt?: string;
}

type TelegramBeforeAgentStartReturn =
  | Promise<TelegramBeforeAgentStartResult | undefined>
  | TelegramBeforeAgentStartResult
  | undefined;

type TelegramLifecycleModel = ExtensionContext["model"];
type TelegramLifecycleMessage = AgentEndEvent["messages"][number];

export interface TelegramLifecycleRegistrationDeps {
  onSessionStart: (
    event: SessionStartEvent,
    ctx: ExtensionContext,
  ) => Promise<void>;
  onSessionShutdown: (
    event: SessionShutdownEvent,
    ctx: ExtensionContext,
  ) => Promise<void>;
  onBeforeAgentStart: (
    event: BeforeAgentStartEvent,
    ctx: ExtensionContext,
  ) => TelegramBeforeAgentStartReturn;
  onModelSelect: (
    event: { model: TelegramLifecycleModel },
    ctx: ExtensionContext,
  ) => Promise<void> | void;
  onAgentStart: (
    event: AgentStartEvent,
    ctx: ExtensionContext,
  ) => Promise<void>;
  onToolExecutionStart: (
    event: unknown,
    ctx: ExtensionContext,
  ) => Promise<void> | void;
  onToolExecutionEnd: (
    event: unknown,
    ctx: ExtensionContext,
  ) => Promise<void> | void;
  onMessageStart: (
    event: { message: TelegramLifecycleMessage },
    ctx: ExtensionContext,
  ) => Promise<void>;
  onMessageUpdate: (
    event: { message: TelegramLifecycleMessage },
    ctx: ExtensionContext,
  ) => Promise<void>;
  onAgentEnd: (event: AgentEndEvent, ctx: ExtensionContext) => Promise<void>;
}

export interface TelegramSessionLifecycleHooks {
  onSessionStart: (event: SessionStartEvent, ctx: ExtensionContext) => Promise<void>;
  onSessionShutdown: (
    event: SessionShutdownEvent,
    ctx: ExtensionContext,
  ) => Promise<void>;
}

export interface TelegramExtraLifecycleHooks {
  onSessionStart?: (
    event: SessionStartEvent,
    ctx: ExtensionContext,
  ) => Promise<void>;
  onSessionShutdown?: (
    event: SessionShutdownEvent,
    ctx: ExtensionContext,
  ) => Promise<void>;
}

export function appendTelegramLifecycleHooks(
  base: TelegramSessionLifecycleHooks,
  extra: TelegramExtraLifecycleHooks,
): TelegramSessionLifecycleHooks {
  return {
    onSessionStart: async (event, ctx) => {
      await base.onSessionStart(event, ctx);
      await extra.onSessionStart?.(event, ctx);
    },
    onSessionShutdown: async (event, ctx) => {
      await base.onSessionShutdown(event, ctx);
      await extra.onSessionShutdown?.(event, ctx);
    },
  };
}

export function registerTelegramLifecycleHooks(
  pi: ExtensionAPI,
  deps: TelegramLifecycleRegistrationDeps,
): void {
  pi.on("session_start", async (event, ctx) => {
    await deps.onSessionStart(event, ctx);
  });
  pi.on("session_shutdown", async (event, ctx) => {
    await deps.onSessionShutdown(event, ctx);
  });
  pi.on("before_agent_start", async (event, ctx) => {
    return deps.onBeforeAgentStart(event, ctx);
  });
  pi.on("model_select", async (event, ctx) => {
    await deps.onModelSelect(event, ctx);
  });
  pi.on("agent_start", async (event, ctx) => {
    await deps.onAgentStart(event, ctx);
  });
  pi.on("tool_execution_start", async (event, ctx) => {
    await deps.onToolExecutionStart(event, ctx);
  });
  pi.on("tool_execution_end", async (event, ctx) => {
    await deps.onToolExecutionEnd(event, ctx);
  });
  pi.on("message_start", async (event, ctx) => {
    await deps.onMessageStart(event, ctx);
  });
  pi.on("message_update", async (event, ctx) => {
    await deps.onMessageUpdate(event, ctx);
  });
  pi.on("agent_end", async (event, ctx) => {
    await deps.onAgentEnd(event, ctx);
  });
}
