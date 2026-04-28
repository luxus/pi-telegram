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
import type { PendingTelegramTurn } from "./queue.ts";
import type { ResolvedTelegramVoiceSettings } from "./voice.ts";
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
- [telegram] messages may include local temp file paths for Telegram attachments. Read those files as needed.
- Telegram is often read on narrow phone screens, so prefer narrow table columns when presenting tabular data; wide monospace tables can become unreadable.
- If a [telegram] user asked for a file or generated artifact, use the telegram_attach tool with the local file path so the extension can send it with your next final reply.
- Do not assume mentioning a local file path in plain text will send it to Telegram. Use telegram_attach.
- When Telegram user asks for a spoken reply or sends a voice note while voice replies are preferred, use telegram_send_voice unless text only is clearly requested.`;

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

export interface TelegramVoiceToolRegistrationDeps {
  getActiveTurn: () => PendingTelegramTurn | undefined;
  getProactiveChatId: () => number | undefined;
  sendVoiceReply: (options: {
    text: string;
    voiceId?: string;
    language?: string;
    alsoSendText?: boolean;
    proactiveChatId?: number;
  }) => Promise<void>;
  getDefaultVoiceSettings: () => ResolvedTelegramVoiceSettings;
  shouldKeepTextReply: (
    activeTurn: PendingTelegramTurn,
    alsoSendText?: boolean,
  ) => boolean;
}

export function registerTelegramVoiceTool(
  pi: ExtensionAPI,
  deps: TelegramVoiceToolRegistrationDeps,
): void {
  pi.registerTool({
    name: "telegram_send_voice",
    label: "Telegram Voice",
    description:
      "Send a real Telegram voice-note reply using the configured Telegram voice provider. Works during active Telegram turns and for paired proactive outbound messages.",
    promptSnippet:
      "telegram_send_voice(text, voiceId?, language?, alsoSendText?) -> send Telegram voice note",
    promptGuidelines: [
      "When Telegram user explicitly asks for a voice note or spoken reply, call telegram_send_voice instead of replying only in text.",
      "Leave alsoSendText unset or false unless the user explicitly asked to receive both a voice note and a text copy/transcript.",
    ],
    parameters: Type.Object({
      text: Type.String({ description: "Text to speak in the Telegram voice note." }),
      voiceId: Type.Optional(
        Type.String({ description: "Optional provider-specific voice id override, e.g. eve or ara." }),
      ),
      language: Type.Optional(
        Type.String({ description: "Optional BCP-47 or short language code override." }),
      ),
      alsoSendText: Type.Optional(
        Type.Boolean({ description: "Also send a normal text copy when the user explicitly requested both." }),
      ),
    }),
    async execute(_toolCallId, params) {
      const activeTurn = deps.getActiveTurn();
      const proactiveChatId = deps.getProactiveChatId();
      if (!activeTurn && !proactiveChatId) {
        throw new Error(
          "telegram_send_voice requires an active Telegram turn or a paired Telegram user for proactive delivery",
        );
      }
      const defaults = deps.getDefaultVoiceSettings();
      const alsoSendText = activeTurn
        ? deps.shouldKeepTextReply(activeTurn, params.alsoSendText)
        : false;
      try {
        await deps.sendVoiceReply({
          text: params.text,
          voiceId: params.voiceId || defaults.defaultVoiceId,
          language: params.language || defaults.defaultLanguage,
          alsoSendText,
          proactiveChatId,
        });
        return {
          content: [{ type: "text", text: "Queued Telegram voice reply." }],
          details: {
            voiceId: params.voiceId || defaults.defaultVoiceId,
            language: params.language || defaults.defaultLanguage,
            alsoSendText,
            error: undefined as string | undefined,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text",
              text: `Telegram voice reply failed, continuing with normal text reply.\n${message}`,
            },
          ],
          details: {
            voiceId: params.voiceId || defaults.defaultVoiceId,
            language: params.language || defaults.defaultLanguage,
            alsoSendText: false,
            error: message,
          },
        };
      }
    },
  });
}

// --- Command Registration ---

export interface TelegramCommandRegistrationDeps {
  promptForConfig: (ctx: ExtensionCommandContext) => Promise<void>;
  getStatusLines: () => string[];
  reloadConfig: () => Promise<void>;
  hasBotToken: () => boolean;
  handleVoiceCommand: (
    args: string,
    ctx: ExtensionCommandContext,
  ) => Promise<void>;
  startPolling: (ctx: ExtensionCommandContext) => void | Promise<void>;
  stopPolling: () => Promise<void>;
  updateStatus: (ctx: ExtensionCommandContext) => void;
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
      await deps.startPolling(ctx);
      deps.updateStatus(ctx);
    },
  });
  pi.registerCommand("telegram-disconnect", {
    description: "Stop the Telegram bridge in this pi session",
    handler: async (_args, ctx) => {
      await deps.stopPolling();
      deps.updateStatus(ctx);
    },
  });
  pi.registerCommand("telegram-voice", {
    description: "Configure Telegram voice transcription and voice-note replies",
    handler: async (args, ctx) => {
      await deps.handleVoiceCommand(args, ctx);
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
