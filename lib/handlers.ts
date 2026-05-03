/**
 * Telegram inbound attachment handler pipeline
 * Owns MIME/type matching, command-template execution, fallback handling, and prompt injection before prompt enqueueing
 */

import { homedir } from "node:os";
import { basename, isAbsolute, resolve } from "node:path";

const DEFAULT_ATTACHMENT_HANDLER_TIMEOUT_MS = 120_000;

export interface TelegramAttachmentHandlerConfig {
  match?: string | string[];
  mime?: string | string[];
  type?: string | string[];
  template?: string;
  args?: string | string[];
  defaults?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface TelegramAttachmentHandlerFile {
  path: string;
  fileName?: string;
  mimeType?: string;
  kind?: string;
  isImage?: boolean;
}

export interface TelegramAttachmentHandlerOutput {
  file: TelegramAttachmentHandlerFile;
  output: string;
  handler: TelegramAttachmentHandlerConfig;
}

export interface TelegramAttachmentHandlerProcessResult<
  TFile extends TelegramAttachmentHandlerFile = TelegramAttachmentHandlerFile,
> {
  rawText: string;
  promptFiles: TFile[];
  handlerOutputs: string[];
  handledFiles: TelegramAttachmentHandlerOutput[];
}

export interface TelegramAttachmentHandlerExecOptions {
  cwd?: string;
  timeout?: number;
  signal?: AbortSignal;
}

export interface TelegramAttachmentHandlerExecResult {
  stdout: string;
  stderr: string;
  code: number;
  killed: boolean;
}

export interface TelegramAttachmentHandlerRuntimeContext {
  cwd: string;
}

export interface TelegramAttachmentHandlerRuntimeDeps<TContext> {
  getHandlers: () => TelegramAttachmentHandlerConfig[] | undefined;
  execCommand: (
    command: string,
    args: string[],
    options?: TelegramAttachmentHandlerExecOptions,
  ) => Promise<TelegramAttachmentHandlerExecResult>;
  getCwd: (ctx: TContext) => string;
  recordRuntimeEvent?: (
    category: string,
    error: unknown,
    details?: Record<string, unknown>,
  ) => void;
}

export interface TelegramAttachmentHandlerRuntime<TContext> {
  process: <TFile extends TelegramAttachmentHandlerFile>(
    files: TFile[],
    rawText: string,
    ctx: TContext,
  ) => Promise<TelegramAttachmentHandlerProcessResult<TFile>>;
}

interface AttachmentHandlerInvocation {
  command: string;
  args: string[];
}

function normalizeStringList(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) {
    return value
      .map(String)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function matchesWildcard(pattern: string, value: string | undefined): boolean {
  if (!value) return false;
  const normalizedPattern = pattern.toLowerCase();
  const normalizedValue = value.toLowerCase();
  if (normalizedPattern === "*") return true;
  const escaped = normalizedPattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(normalizedValue);
}

function handlerHasSelectors(
  handler: TelegramAttachmentHandlerConfig,
): boolean {
  return (
    normalizeStringList(handler.match).length > 0 ||
    normalizeStringList(handler.mime).length > 0 ||
    normalizeStringList(handler.type).length > 0
  );
}

function matchesAnyPattern(
  patterns: string[],
  value: string | undefined,
): boolean {
  return patterns.some((pattern) => matchesWildcard(pattern, value));
}

export function telegramAttachmentHandlerMatchesFile(
  handler: TelegramAttachmentHandlerConfig,
  file: TelegramAttachmentHandlerFile,
): boolean {
  if (!handlerHasSelectors(handler)) return true;
  const matchPatterns = normalizeStringList(handler.match);
  const mimePatterns = normalizeStringList(handler.mime);
  const typePatterns = normalizeStringList(handler.type);
  if (matchesAnyPattern(mimePatterns, file.mimeType)) return true;
  if (matchesAnyPattern(typePatterns, file.kind)) return true;
  if (matchesAnyPattern(matchPatterns, file.mimeType)) return true;
  return matchesAnyPattern(matchPatterns, file.kind);
}

export function findTelegramAttachmentHandlers(
  handlers: TelegramAttachmentHandlerConfig[] | undefined,
  file: TelegramAttachmentHandlerFile,
): TelegramAttachmentHandlerConfig[] {
  if (!Array.isArray(handlers)) return [];
  return handlers.filter(
    (handler) =>
      !!handler &&
      typeof handler === "object" &&
      telegramAttachmentHandlerMatchesFile(handler, file),
  );
}

export function findTelegramAttachmentHandler(
  handlers: TelegramAttachmentHandlerConfig[] | undefined,
  file: TelegramAttachmentHandlerFile,
): TelegramAttachmentHandlerConfig | undefined {
  return findTelegramAttachmentHandlers(handlers, file)[0];
}

function hasAttachmentFilePlaceholder(value: string): boolean {
  return /\{file\}/.test(value);
}

function normalizeTelegramAttachmentHandlerArgs(
  value: string | string[] | undefined,
): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim());
  if (typeof value !== "string") return [];
  return value.split(",").map((item) => item.trim());
}

function getTelegramAttachmentHandlerArgDefaults(
  handler: TelegramAttachmentHandlerConfig,
): Record<string, string> {
  const defaults: Record<string, string> = {};
  for (const item of normalizeTelegramAttachmentHandlerArgs(handler.args)) {
    if (!item) continue;
    const [name, ...defaultParts] = item.split("=");
    if (!name || defaultParts.length === 0) continue;
    defaults[name.trim()] = defaultParts.join("=").trim();
  }
  for (const [key, value] of Object.entries(handler.defaults ?? {})) {
    defaults[key] = value === undefined || value === null ? "" : String(value);
  }
  return defaults;
}

function getTelegramAttachmentHandlerTemplateValues(
  handler: TelegramAttachmentHandlerConfig,
  file: TelegramAttachmentHandlerFile,
): Record<string, string> {
  return {
    ...getTelegramAttachmentHandlerArgDefaults(handler),
    file: file.path,
    mime: file.mimeType ?? "",
    type: file.kind ?? "",
  };
}

function substituteTelegramAttachmentHandlerTemplateToken(
  token: string,
  values: Record<string, string>,
): string {
  return token.replace(/\{([A-Za-z_][A-Za-z0-9_-]*)\}/g, (_match, name) => {
    if (Object.hasOwn(values, name)) return values[name] ?? "";
    throw new Error(`Missing attachment handler template value: ${name}`);
  });
}

export function splitTelegramAttachmentHandlerTemplate(input: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;
  let active = false;
  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      active = true;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      active = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
      active = true;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      active = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (active) words.push(current);
      if (active) current = "";
      active = false;
      continue;
    }
    current += char;
    active = true;
  }
  if (escaped) current += "\\";
  if (active || current) words.push(current);
  return words;
}

function expandExecutablePath(command: string, cwd: string): string {
  if (command === "~") return homedir();
  if (command.startsWith("~/")) return resolve(homedir(), command.slice(2));
  if (command.includes("/") && !isAbsolute(command)) {
    return resolve(cwd, command);
  }
  return command;
}

function buildTelegramAttachmentTemplateInvocation(
  template: string,
  handler: TelegramAttachmentHandlerConfig,
  file: TelegramAttachmentHandlerFile,
  cwd: string,
): AttachmentHandlerInvocation {
  const parts = splitTelegramAttachmentHandlerTemplate(template);
  const commandPart = parts[0];
  if (!commandPart) throw new Error("Attachment handler template is empty");
  const values = getTelegramAttachmentHandlerTemplateValues(handler, file);
  const hadFilePlaceholder = parts.some(hasAttachmentFilePlaceholder);
  const command = expandExecutablePath(
    substituteTelegramAttachmentHandlerTemplateToken(commandPart, values),
    cwd,
  );
  const args = parts
    .slice(1)
    .map((part) =>
      substituteTelegramAttachmentHandlerTemplateToken(part, values),
    );
  if (!hadFilePlaceholder) args.push(file.path);
  return { command, args };
}

export function buildTelegramAttachmentHandlerInvocation(
  handler: TelegramAttachmentHandlerConfig,
  file: TelegramAttachmentHandlerFile,
  cwd: string,
): AttachmentHandlerInvocation {
  const { template } = handler;
  if (!template) throw new Error("Attachment handler template is required");
  return buildTelegramAttachmentTemplateInvocation(template, handler, file, cwd);
}

function getTelegramAttachmentHandlerTimeout(
  handler: TelegramAttachmentHandlerConfig,
): number {
  return typeof handler.timeoutMs === "number" &&
    Number.isFinite(handler.timeoutMs) &&
    handler.timeoutMs > 0
    ? handler.timeoutMs
    : DEFAULT_ATTACHMENT_HANDLER_TIMEOUT_MS;
}

function getTelegramAttachmentHandlerKind(
  handler: TelegramAttachmentHandlerConfig,
): string {
  if (handler.template) return "template";
  return "unknown";
}

function formatTelegramAttachmentHandlerFailure(
  result: TelegramAttachmentHandlerExecResult,
): string {
  const parts = [
    `Attachment handler exited with code ${result.code}${result.killed ? " (killed)" : ""}`,
  ];
  if (result.stderr.trim()) parts.push(`stderr:\n${result.stderr.trimEnd()}`);
  if (result.stdout.trim()) parts.push(`stdout:\n${result.stdout.trimEnd()}`);
  return parts.join("\n\n");
}

async function executeTelegramAttachmentHandler(
  handler: TelegramAttachmentHandlerConfig,
  file: TelegramAttachmentHandlerFile,
  cwd: string,
  deps: Pick<TelegramAttachmentHandlerRuntimeDeps<unknown>, "execCommand">,
): Promise<string> {
  const invocation = buildTelegramAttachmentHandlerInvocation(
    handler,
    file,
    cwd,
  );
  const result = await deps.execCommand(invocation.command, invocation.args, {
    cwd,
    timeout: getTelegramAttachmentHandlerTimeout(handler),
  });
  if (result.code !== 0)
    throw new Error(formatTelegramAttachmentHandlerFailure(result));
  return result.stdout.trim();
}

export async function processTelegramAttachmentHandlers<
  TFile extends TelegramAttachmentHandlerFile,
>(options: {
  files: TFile[];
  rawText: string;
  handlers?: TelegramAttachmentHandlerConfig[];
  cwd: string;
  execCommand: TelegramAttachmentHandlerRuntimeDeps<unknown>["execCommand"];
  recordRuntimeEvent?: TelegramAttachmentHandlerRuntimeDeps<unknown>["recordRuntimeEvent"];
}): Promise<TelegramAttachmentHandlerProcessResult<TFile>> {
  const promptFiles: TFile[] = [...options.files];
  const outputs: TelegramAttachmentHandlerOutput[] = [];
  for (const file of options.files) {
    const handlers = findTelegramAttachmentHandlers(options.handlers, file);
    for (const handler of handlers) {
      try {
        const output = await executeTelegramAttachmentHandler(
          handler,
          file,
          options.cwd,
          options,
        );
        if (output) outputs.push({ file, output, handler });
        break;
      } catch (error) {
        options.recordRuntimeEvent?.("attachment-handler", error, {
          fileName: file.fileName || basename(file.path),
          handler: getTelegramAttachmentHandlerKind(handler),
        });
      }
    }
  }
  return {
    rawText: options.rawText,
    promptFiles,
    handlerOutputs: outputs.map((output) => output.output),
    handledFiles: outputs,
  };
}

export function createTelegramAttachmentHandlerRuntime<TContext>(
  deps: TelegramAttachmentHandlerRuntimeDeps<TContext>,
): TelegramAttachmentHandlerRuntime<TContext> {
  return {
    process: (files, rawText, ctx) =>
      processTelegramAttachmentHandlers({
        files,
        rawText,
        handlers: deps.getHandlers(),
        cwd: deps.getCwd(ctx),
        execCommand: deps.execCommand,
        recordRuntimeEvent: deps.recordRuntimeEvent,
      }),
  };
}
