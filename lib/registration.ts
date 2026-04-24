/**
 * Telegram extension registration helpers
 * Owns tool, command, and lifecycle-hook registration so index.ts can stay focused on runtime orchestration state and side effects
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { queueTelegramAttachments } from "./attachments.ts";
import type { PendingTelegramTurn } from "./queue.ts";
import type { ResolvedTelegramVoiceSettings } from "./voice.ts";

// --- Tool Registration ---

export interface TelegramAttachmentToolRegistrationDeps {
  maxAttachmentsPerTurn: number;
  getActiveTurn: () => PendingTelegramTurn | undefined;
  statPath: (path: string) => Promise<{ isFile(): boolean }>;
}

export function registerTelegramAttachmentTool(
  pi: ExtensionAPI,
  deps: TelegramAttachmentToolRegistrationDeps,
): void {
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
        { minItems: 1, maxItems: deps.maxAttachmentsPerTurn },
      ),
    }),
    async execute(_toolCallId, params) {
      return queueTelegramAttachments({
        activeTurn: deps.getActiveTurn(),
        paths: params.paths,
        maxAttachmentsPerTurn: deps.maxAttachmentsPerTurn,
        statPath: deps.statPath,
      });
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
  shouldKeepTextReply: (activeTurn: PendingTelegramTurn, alsoSendText?: boolean) => boolean;
}

export function registerTelegramVoiceTool(
  pi: ExtensionAPI,
  deps: TelegramVoiceToolRegistrationDeps,
): void {
  pi.registerTool({
    name: "telegram_send_voice",
    label: "Telegram Voice",
    description:
      "Send real Telegram voice note reply using configured Telegram voice provider. Works during active Telegram turns and for paired proactive outbound messages.",
    promptSnippet:
      "telegram_send_voice(text, voiceId?, language?, alsoSendText?) -> send Telegram voice note (leave alsoSendText false unless user explicitly asked for both voice and text)",
    promptGuidelines: [
      "When Telegram user explicitly asks for voice note or spoken reply, call telegram_send_voice instead of replying only in text.",
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
        Type.Boolean({ description: "If true, also keep the normal final text reply." }),
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
          content: [
            {
              type: "text",
              text: "Queued Telegram voice reply.",
            },
          ],
          details: {
            voiceId: params.voiceId || defaults.defaultVoiceId,
            language: params.language || defaults.defaultLanguage,
            alsoSendText,
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
  startPolling: (ctx: ExtensionCommandContext) => Promise<void>;
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
      ctx.ui.notify(deps.getStatusLines().join(" | "), "info");
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

export interface TelegramLifecycleRegistrationDeps {
  onSessionStart: (event: unknown, ctx: ExtensionContext) => Promise<void>;
  onSessionShutdown: (event: unknown, ctx: ExtensionContext) => Promise<void>;
  onBeforeAgentStart: (
    event: unknown,
    ctx: ExtensionContext,
  ) => Promise<unknown> | unknown;
  onModelSelect: (
    event: unknown,
    ctx: ExtensionContext,
  ) => Promise<void> | void;
  onAgentStart: (event: unknown, ctx: ExtensionContext) => Promise<void>;
  onToolExecutionStart: (
    event: unknown,
    ctx: ExtensionContext,
  ) => Promise<void> | void;
  onToolExecutionEnd: (
    event: unknown,
    ctx: ExtensionContext,
  ) => Promise<void> | void;
  onMessageStart: (event: unknown, ctx: ExtensionContext) => Promise<void>;
  onMessageUpdate: (event: unknown, ctx: ExtensionContext) => Promise<void>;
  onAgentEnd: (event: unknown, ctx: ExtensionContext) => Promise<void>;
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
  pi.on("before_agent_start", (async (event: unknown, ctx: ExtensionContext) =>
    deps.onBeforeAgentStart(event, ctx)) as never);
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
