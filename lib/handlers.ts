/**
 * Telegram inbound attachment handler pipeline
 * Owns MIME/type matching plus command and auto-tool execution for downloaded inbound files before prompt enqueueing
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";

const DEFAULT_ATTACHMENT_HANDLER_TIMEOUT_MS = 120_000;

function getDefaultAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR
    ? resolve(process.env.PI_CODING_AGENT_DIR)
    : join(homedir(), ".pi", "agent");
}

function getDefaultAutoToolsPath(): string {
  return join(getDefaultAgentDir(), "auto-tools.json");
}

export interface TelegramAttachmentHandlerConfig {
  match?: string | string[];
  mime?: string | string[];
  type?: string | string[];
  command?: string;
  tool?: string;
  args?: Record<string, unknown>;
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
  readTextFile?: (path: string) => Promise<string>;
  autoToolsPath?: string;
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

interface AutoToolConfig {
  name: string;
  script: string;
  args: string[];
}

function normalizeStringList(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
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

function handlerHasSelectors(handler: TelegramAttachmentHandlerConfig): boolean {
  return (
    normalizeStringList(handler.match).length > 0 ||
    normalizeStringList(handler.mime).length > 0 ||
    normalizeStringList(handler.type).length > 0
  );
}

function matchesAnyPattern(patterns: string[], value: string | undefined): boolean {
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

export function findTelegramAttachmentHandler(
  handlers: TelegramAttachmentHandlerConfig[] | undefined,
  file: TelegramAttachmentHandlerFile,
): TelegramAttachmentHandlerConfig | undefined {
  if (!Array.isArray(handlers)) return undefined;
  return handlers.find(
    (handler) =>
      !!handler &&
      typeof handler === "object" &&
      telegramAttachmentHandlerMatchesFile(handler, file),
  );
}

function hasAttachmentPlaceholder(value: string): boolean {
  return /\{(?:filename|path|basename|mime|type)\}/.test(value);
}

export function substituteTelegramAttachmentHandlerToken(
  token: string,
  file: TelegramAttachmentHandlerFile,
): string {
  const replacements: Record<string, string> = {
    "{filename}": file.path,
    "{path}": file.path,
    "{basename}": file.fileName || basename(file.path),
    "{mime}": file.mimeType ?? "",
    "{type}": file.kind ?? "",
  };
  let result = token;
  for (const [key, value] of Object.entries(replacements)) {
    result = result.split(key).join(value);
  }
  return result;
}

export function splitTelegramAttachmentHandlerCommand(input: string): string[] {
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

export function buildTelegramAttachmentCommandInvocation(
  commandTemplate: string,
  file: TelegramAttachmentHandlerFile,
  cwd: string,
): AttachmentHandlerInvocation {
  const parts = splitTelegramAttachmentHandlerCommand(commandTemplate);
  const commandPart = parts[0];
  if (!commandPart) throw new Error("Attachment handler command is empty");
  const hadPlaceholder = parts.some(hasAttachmentPlaceholder);
  const command = expandExecutablePath(
    substituteTelegramAttachmentHandlerToken(commandPart, file),
    cwd,
  );
  const args = parts
    .slice(1)
    .map((part) => substituteTelegramAttachmentHandlerToken(part, file));
  if (!hadPlaceholder) args.push(file.path);
  return { command, args };
}

function normalizeAutoToolName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeAutoToolArgs(value: unknown): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const args: string[] = [];
  const seen = new Set<string>();
  for (const item of source) {
    const arg = normalizeAutoToolName(String(item));
    if (!arg || seen.has(arg)) continue;
    seen.add(arg);
    args.push(arg);
  }
  return args;
}

export function parseTelegramAutoToolsRegistry(
  content: string,
): Map<string, AutoToolConfig> {
  const raw = JSON.parse(content) as unknown;
  const entries = Array.isArray(raw)
    ? raw.map((value) => [undefined, value] as const)
    : raw && typeof raw === "object"
      ? Object.entries(raw as Record<string, unknown>)
      : [];
  const tools = new Map<string, AutoToolConfig>();
  for (const [key, value] of entries) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const name = normalizeAutoToolName(
      typeof record.name === "string" ? record.name : (key ?? ""),
    );
    const script = typeof record.script === "string" ? record.script.trim() : "";
    if (!name || !script) continue;
    tools.set(name, { name, script, args: normalizeAutoToolArgs(record.args) });
  }
  return tools;
}

async function readTelegramAutoToolsRegistry(
  path: string,
  readTextFile: (path: string) => Promise<string>,
): Promise<Map<string, AutoToolConfig>> {
  try {
    return parseTelegramAutoToolsRegistry(await readTextFile(path));
  } catch {
    return new Map();
  }
}

function getConfiguredToolArgValue(
  value: unknown,
  file: TelegramAttachmentHandlerFile,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  return substituteTelegramAttachmentHandlerToken(String(value), file);
}

function getDefaultToolArgValue(
  arg: string,
  file: TelegramAttachmentHandlerFile,
): string {
  if (["file", "filename", "path"].includes(arg)) return file.path;
  if (["basename", "name"].includes(arg)) {
    return file.fileName || basename(file.path);
  }
  if (["mime", "mime_type", "mimetype"].includes(arg)) return file.mimeType ?? "";
  if (["type", "kind"].includes(arg)) return file.kind ?? "";
  return "";
}

async function buildTelegramAttachmentToolInvocation(
  handler: TelegramAttachmentHandlerConfig,
  file: TelegramAttachmentHandlerFile,
  cwd: string,
  deps: Pick<
    TelegramAttachmentHandlerRuntimeDeps<unknown>,
    "readTextFile" | "autoToolsPath"
  >,
): Promise<AttachmentHandlerInvocation> {
  const toolName = normalizeAutoToolName(handler.tool ?? "");
  if (!toolName) throw new Error("Attachment handler tool is empty");
  const readRegistryFile =
    deps.readTextFile ?? ((path: string) => readFile(path, "utf8"));
  const registry = await readTelegramAutoToolsRegistry(
    deps.autoToolsPath ?? getDefaultAutoToolsPath(),
    readRegistryFile,
  );
  const tool = registry.get(toolName);
  if (!tool) {
    throw new Error(`Attachment handler tool not found in auto-tools: ${toolName}`);
  }
  const script = expandExecutablePath(tool.script, cwd);
  const args = tool.args.map(
    (arg) =>
      getConfiguredToolArgValue(handler.args?.[arg], file) ??
      getDefaultToolArgValue(arg, file),
  );
  return { command: script, args };
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

function getTelegramAttachmentHandlerKind(handler: TelegramAttachmentHandlerConfig): string {
  if (handler.command) return "command";
  if (handler.tool) return "tool";
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
  deps: Pick<
    TelegramAttachmentHandlerRuntimeDeps<unknown>,
    "execCommand" | "readTextFile" | "autoToolsPath"
  >,
): Promise<string> {
  const invocation = handler.command
    ? buildTelegramAttachmentCommandInvocation(handler.command, file, cwd)
    : await buildTelegramAttachmentToolInvocation(handler, file, cwd, deps);
  const result = await deps.execCommand(invocation.command, invocation.args, {
    cwd,
    timeout: getTelegramAttachmentHandlerTimeout(handler),
  });
  if (result.code !== 0) throw new Error(formatTelegramAttachmentHandlerFailure(result));
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
  readTextFile?: (path: string) => Promise<string>;
  autoToolsPath?: string;
  recordRuntimeEvent?: TelegramAttachmentHandlerRuntimeDeps<unknown>["recordRuntimeEvent"];
}): Promise<TelegramAttachmentHandlerProcessResult<TFile>> {
  const promptFiles: TFile[] = [...options.files];
  const outputs: TelegramAttachmentHandlerOutput[] = [];
  for (const file of options.files) {
    const handler = findTelegramAttachmentHandler(options.handlers, file);
    if (!handler) continue;
    try {
      const output = await executeTelegramAttachmentHandler(
        handler,
        file,
        options.cwd,
        options,
      );
      if (output) outputs.push({ file, output, handler });
    } catch (error) {
      options.recordRuntimeEvent?.("attachment-handler", error, {
        fileName: file.fileName || basename(file.path),
        handler: getTelegramAttachmentHandlerKind(handler),
      });
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
        readTextFile: deps.readTextFile,
        autoToolsPath: deps.autoToolsPath,
        recordRuntimeEvent: deps.recordRuntimeEvent,
      }),
  };
}
