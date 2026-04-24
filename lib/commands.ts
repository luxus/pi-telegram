/**
 * Telegram command parsing helpers
 * Owns slash-command normalization so command routing stays separate from transport update handling
 */

export interface ParsedTelegramCommand {
  name: string;
  args: string;
}

export type TelegramCommandAction =
  | { kind: "ignore" }
  | { kind: "stop" }
  | { kind: "compact" }
  | { kind: "status" }
  | { kind: "model" }
  | { kind: "help"; commandName: "help" | "start" };

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
      return { kind: "stop" };
    case "compact":
      return { kind: "compact" };
    case "status":
      return { kind: "status" };
    case "model":
      return { kind: "model" };
    case "help":
    case "start":
      return { kind: "help", commandName };
    default:
      return { kind: "ignore" };
  }
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
