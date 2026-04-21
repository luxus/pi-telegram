/**
 * Telegram menu and inline-keyboard rendering helpers
 * Owns model resolution, menu state, and inline UI text and reply-markup generation for status, model, and thinking controls
 */

import type { Model } from "@mariozechner/pi-ai";

export type ThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";
export type TelegramModelScope = "all" | "scoped";

export interface ScopedTelegramModel {
  model: Model<any>;
  thinkingLevel?: ThinkingLevel;
}

export interface TelegramModelMenuState {
  chatId: number;
  messageId: number;
  page: number;
  scope: TelegramModelScope;
  scopedModels: ScopedTelegramModel[];
  allModels: ScopedTelegramModel[];
  note?: string;
  mode:
    | "status"
    | "model"
    | "thinking"
    | "voice"
    | "voice-language"
    | "voice-style"
    | "voice-voice";
}

export interface TelegramVoiceMenuSettings {
  enabled: boolean;
  provider: string;
  replyWithVoiceOnIncomingVoice: boolean;
  autoTranscribeIncoming: boolean;
  alsoSendTextReply: boolean;
  voiceId?: string;
  language?: string;
  speechStyle: "literal" | "rewrite-light" | "rewrite-tags" | "rewrite-strong";
}

export type TelegramReplyMarkup = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

export interface TelegramMenuMessageRuntimeDeps {
  editInteractiveMessage: (
    chatId: number,
    messageId: number,
    text: string,
    mode: "html" | "plain",
    replyMarkup: TelegramReplyMarkup,
  ) => Promise<void>;
  sendInteractiveMessage: (
    chatId: number,
    text: string,
    mode: "html" | "plain",
    replyMarkup: TelegramReplyMarkup,
  ) => Promise<number | undefined>;
}

export interface TelegramMenuEffectPort {
  answerCallbackQuery: (
    callbackQueryId: string,
    text?: string,
  ) => Promise<void>;
  updateModelMenuMessage: () => Promise<void>;
  updateThinkingMenuMessage: () => Promise<void>;
  updateVoiceMenuMessage: () => Promise<void>;
  updateVoiceLanguageMenuMessage: () => Promise<void>;
  updateVoiceStyleMenuMessage: () => Promise<void>;
  updateVoiceVoiceMenuMessage: () => Promise<void>;
  updateStatusMessage: () => Promise<void>;
  setModel: (model: Model<any>) => Promise<boolean>;
  setCurrentModel: (model: Model<any>) => void;
  setThinkingLevel: (level: ThinkingLevel) => void;
  getCurrentThinkingLevel: () => ThinkingLevel;
  stagePendingModelSwitch: (selection: ScopedTelegramModel) => void;
  restartInterruptedTelegramTurn: (
    selection: ScopedTelegramModel,
  ) => Promise<boolean> | boolean;
}

export type TelegramStatusMenuCallbackDeps = Pick<
  TelegramMenuEffectPort,
  | "updateModelMenuMessage"
  | "updateThinkingMenuMessage"
  | "updateVoiceMenuMessage"
  | "answerCallbackQuery"
>;

export interface TelegramVoiceMenuCallbackDeps {
  getVoiceSettings: () => TelegramVoiceMenuSettings;
  saveVoiceSetting: (
    command:
      | { action: "toggle"; enabled: boolean }
      | { action: "reply"; enabled: boolean }
      | { action: "text"; enabled: boolean }
      | { action: "voice"; voiceId: string }
      | { action: "language"; language: string }
      | {
          action: "style";
          style: "literal" | "rewrite-light" | "rewrite-tags" | "rewrite-strong";
        },
  ) => Promise<void>;
  updateVoiceMenuMessage: () => Promise<void>;
  updateVoiceAnswerMenuMessage: () => Promise<void>;
  updateVoiceLanguageMenuMessage: () => Promise<void>;
  updateVoiceStyleMenuMessage: () => Promise<void>;
  updateVoiceVoiceMenuMessage: () => Promise<void>;
  updateStatusMessage: () => Promise<void>;
  answerCallbackQuery: (callbackQueryId: string, text?: string) => Promise<void>;
};

export type TelegramThinkingMenuCallbackDeps = Pick<
  TelegramMenuEffectPort,
  "setThinkingLevel" | "getCurrentThinkingLevel" | "updateStatusMessage" | "answerCallbackQuery"
>;

export type TelegramModelMenuCallbackDeps = Pick<
  TelegramMenuEffectPort,
  | "updateModelMenuMessage"
  | "updateStatusMessage"
  | "answerCallbackQuery"
  | "setModel"
  | "setCurrentModel"
  | "setThinkingLevel"
  | "stagePendingModelSwitch"
  | "restartInterruptedTelegramTurn"
>;

export interface TelegramMenuCallbackEntryDeps {
  handleStatusAction: () => Promise<boolean>;
  handleThinkingAction: () => Promise<boolean>;
  handleVoiceAction: () => Promise<boolean>;
  handleModelAction: () => Promise<boolean>;
  answerCallbackQuery: (
    callbackQueryId: string,
    text?: string,
  ) => Promise<void>;
}

export const THINKING_LEVELS: readonly ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];
export const TELEGRAM_MODEL_PAGE_SIZE = 6;
export const MODEL_MENU_TITLE = "<b>Choose a model:</b>";
export const TELEGRAM_VOICE_MENU_TITLE = "<b>Voice settings</b>";
export const TELEGRAM_VOICE_MENU_VOICE_IDS = ["eve", "ara", "rex", "sal", "leo", "una"] as const;
export const TELEGRAM_VOICE_MENU_LANGUAGES = [
  "auto",
  "en",
  "ar-EG",
  "ar-SA",
  "ar-AE",
  "bn",
  "zh",
  "fr",
  "de",
  "hi",
  "id",
  "it",
  "ja",
  "ko",
  "pt-BR",
  "pt-PT",
  "ru",
  "es-MX",
  "es-ES",
  "tr",
  "vi",
] as const;
export const TELEGRAM_VOICE_MENU_STYLES = [
  "literal",
  "rewrite-light",
  "rewrite-tags",
  "rewrite-strong",
] as const;

export interface BuildTelegramModelMenuStateParams {
  chatId: number;
  activeModel: Model<any> | undefined;
  availableModels: Model<any>[];
  configuredScopedModelPatterns: string[];
  cliScopedModelPatterns?: string[];
}

export type TelegramMenuCallbackAction =
  | { kind: "ignore" }
  | { kind: "status"; action: "model" | "thinking" | "voice" }
  | { kind: "thinking:set"; level: string }
  | {
      kind: "voice";
      action:
        | "noop"
        | "back"
        | "answerback"
        | "answermenu"
        | "langback"
        | "langmenu"
        | "styleback"
        | "stylemenu"
        | "voiceback"
        | "voicemenu"
        | "toggle"
        | "answer"
        | "style"
        | "voice"
        | "lang";
      value?: string;
    }
  | {
      kind: "model";
      action: "noop" | "scope" | "page" | "pick";
      value?: string;
    };

export type TelegramMenuMutationResult = "invalid" | "unchanged" | "changed";
export type TelegramMenuSelectionResult =
  | { kind: "invalid" }
  | { kind: "missing" }
  | { kind: "selected"; selection: ScopedTelegramModel };

export interface TelegramModelMenuPage {
  page: number;
  pageCount: number;
  start: number;
  items: ScopedTelegramModel[];
}

export interface TelegramMenuRenderPayload {
  nextMode: TelegramModelMenuState["mode"];
  text: string;
  mode: "html" | "plain";
  replyMarkup: TelegramReplyMarkup;
}

export type TelegramModelCallbackPlan =
  | { kind: "ignore" }
  | { kind: "answer"; text?: string }
  | { kind: "update-menu"; text?: string }
  | {
      kind: "refresh-status";
      selection: ScopedTelegramModel;
      callbackText: string;
      shouldApplyThinkingLevel: boolean;
    }
  | {
      kind: "switch-model";
      selection: ScopedTelegramModel;
      mode: "idle" | "restart-now" | "restart-after-tool";
      callbackText: string;
    };

export interface BuildTelegramModelCallbackPlanParams {
  data: string | undefined;
  state: TelegramModelMenuState;
  activeModel: Model<any> | undefined;
  currentThinkingLevel: ThinkingLevel;
  isIdle: boolean;
  canRestartBusyRun: boolean;
  hasActiveToolExecutions: boolean;
}

export function modelsMatch(
  a: Pick<Model<any>, "provider" | "id"> | undefined,
  b: Pick<Model<any>, "provider" | "id"> | undefined,
): boolean {
  return !!a && !!b && a.provider === b.provider && a.id === b.id;
}

export function getCanonicalModelId(
  model: Pick<Model<any>, "provider" | "id">,
): string {
  return `${model.provider}/${model.id}`;
}

export function isThinkingLevel(value: string): value is ThinkingLevel {
  return THINKING_LEVELS.includes(value as ThinkingLevel);
}

function escapeRegex(text: string): string {
  return text.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globMatches(text: string, pattern: string): boolean {
  let regex = "^";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "*") {
      regex += ".*";
      continue;
    }
    if (char === "?") {
      regex += ".";
      continue;
    }
    if (char === "[") {
      const end = pattern.indexOf("]", i + 1);
      if (end !== -1) {
        const content = pattern.slice(i + 1, end);
        regex += content.startsWith("!")
          ? `[^${content.slice(1)}]`
          : `[${content}]`;
        i = end;
        continue;
      }
    }
    regex += escapeRegex(char);
  }
  regex += "$";
  return new RegExp(regex, "i").test(text);
}

function isAliasModelId(id: string): boolean {
  if (id.endsWith("-latest")) return true;
  return !/-\d{8}$/.test(id);
}

function findExactModelReferenceMatch(
  modelReference: string,
  availableModels: Model<any>[],
): Model<any> | undefined {
  const trimmedReference = modelReference.trim();
  if (!trimmedReference) return undefined;
  const normalizedReference = trimmedReference.toLowerCase();
  const canonicalMatches = availableModels.filter(
    (model) => getCanonicalModelId(model).toLowerCase() === normalizedReference,
  );
  if (canonicalMatches.length === 1) return canonicalMatches[0];
  if (canonicalMatches.length > 1) return undefined;
  const slashIndex = trimmedReference.indexOf("/");
  if (slashIndex !== -1) {
    const provider = trimmedReference.substring(0, slashIndex).trim();
    const modelId = trimmedReference.substring(slashIndex + 1).trim();
    if (provider && modelId) {
      const providerMatches = availableModels.filter(
        (model) =>
          model.provider.toLowerCase() === provider.toLowerCase() &&
          model.id.toLowerCase() === modelId.toLowerCase(),
      );
      if (providerMatches.length === 1) return providerMatches[0];
      if (providerMatches.length > 1) return undefined;
    }
  }
  const idMatches = availableModels.filter(
    (model) => model.id.toLowerCase() === normalizedReference,
  );
  return idMatches.length === 1 ? idMatches[0] : undefined;
}

function tryMatchScopedModel(
  modelPattern: string,
  availableModels: Model<any>[],
): Model<any> | undefined {
  const exactMatch = findExactModelReferenceMatch(
    modelPattern,
    availableModels,
  );
  if (exactMatch) return exactMatch;
  const matches = availableModels.filter(
    (model) =>
      model.id.toLowerCase().includes(modelPattern.toLowerCase()) ||
      model.name?.toLowerCase().includes(modelPattern.toLowerCase()),
  );
  if (matches.length === 0) return undefined;
  const aliases = matches.filter((model) => isAliasModelId(model.id));
  const datedVersions = matches.filter((model) => !isAliasModelId(model.id));
  if (aliases.length > 0) {
    aliases.sort((a, b) => b.id.localeCompare(a.id));
    return aliases[0];
  }
  datedVersions.sort((a, b) => b.id.localeCompare(a.id));
  return datedVersions[0];
}

function parseScopedModelPattern(
  pattern: string,
  availableModels: Model<any>[],
): { model: Model<any> | undefined; thinkingLevel?: ThinkingLevel } {
  const exactMatch = tryMatchScopedModel(pattern, availableModels);
  if (exactMatch) {
    return { model: exactMatch, thinkingLevel: undefined };
  }
  const lastColonIndex = pattern.lastIndexOf(":");
  if (lastColonIndex === -1) {
    return { model: undefined, thinkingLevel: undefined };
  }
  const prefix = pattern.substring(0, lastColonIndex);
  const suffix = pattern.substring(lastColonIndex + 1);
  if (isThinkingLevel(suffix)) {
    const result = parseScopedModelPattern(prefix, availableModels);
    if (result.model) {
      return { model: result.model, thinkingLevel: suffix };
    }
    return result;
  }
  return parseScopedModelPattern(prefix, availableModels);
}

export function resolveScopedModelPatterns(
  patterns: string[],
  availableModels: Model<any>[],
): ScopedTelegramModel[] {
  const resolved: ScopedTelegramModel[] = [];
  const seen = new Set<string>();
  for (const pattern of patterns) {
    if (
      pattern.includes("*") ||
      pattern.includes("?") ||
      pattern.includes("[")
    ) {
      const colonIndex = pattern.lastIndexOf(":");
      let globPattern = pattern;
      let thinkingLevel: ThinkingLevel | undefined;
      if (colonIndex !== -1) {
        const suffix = pattern.substring(colonIndex + 1);
        if (isThinkingLevel(suffix)) {
          thinkingLevel = suffix;
          globPattern = pattern.substring(0, colonIndex);
        }
      }
      const matches = availableModels.filter(
        (model) =>
          globMatches(getCanonicalModelId(model), globPattern) ||
          globMatches(model.id, globPattern),
      );
      for (const model of matches) {
        const key = getCanonicalModelId(model);
        if (seen.has(key)) continue;
        seen.add(key);
        resolved.push({ model, thinkingLevel });
      }
      continue;
    }
    const matched = parseScopedModelPattern(pattern, availableModels);
    if (!matched.model) continue;
    const key = getCanonicalModelId(matched.model);
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push({
      model: matched.model,
      thinkingLevel: matched.thinkingLevel,
    });
  }
  return resolved;
}

export function sortScopedModels(
  models: ScopedTelegramModel[],
  currentModel: Model<any> | undefined,
): ScopedTelegramModel[] {
  const sorted = [...models];
  sorted.sort((a, b) => {
    const aIsCurrent = modelsMatch(a.model, currentModel);
    const bIsCurrent = modelsMatch(b.model, currentModel);
    if (aIsCurrent && !bIsCurrent) return -1;
    if (!aIsCurrent && bIsCurrent) return 1;
    const providerCompare = a.model.provider.localeCompare(b.model.provider);
    if (providerCompare !== 0) return providerCompare;
    return a.model.id.localeCompare(b.model.id);
  });
  return sorted;
}

function truncateTelegramButtonLabel(label: string, maxLength = 56): string {
  return label.length <= maxLength
    ? label
    : `${label.slice(0, maxLength - 1)}…`;
}

export function formatScopedModelButtonText(
  entry: ScopedTelegramModel,
  currentModel: Model<any> | undefined,
): string {
  let label = `${modelsMatch(entry.model, currentModel) ? "✅ " : ""}${entry.model.id} [${entry.model.provider}]`;
  if (entry.thinkingLevel) {
    label += ` · ${entry.thinkingLevel}`;
  }
  return truncateTelegramButtonLabel(label);
}

export function formatStatusButtonLabel(label: string, value: string): string {
  return truncateTelegramButtonLabel(`${label}: ${value}`, 64);
}

export function getModelMenuItems(
  state: TelegramModelMenuState,
): ScopedTelegramModel[] {
  return state.scope === "scoped" && state.scopedModels.length > 0
    ? state.scopedModels
    : state.allModels;
}

export function buildTelegramModelMenuState(
  params: BuildTelegramModelMenuStateParams,
): TelegramModelMenuState {
  const allModels = sortScopedModels(
    params.availableModels.map((model) => ({ model })),
    params.activeModel,
  );
  const scopedModels =
    params.configuredScopedModelPatterns.length > 0
      ? sortScopedModels(
          resolveScopedModelPatterns(
            params.configuredScopedModelPatterns,
            params.availableModels,
          ),
          params.activeModel,
        )
      : [];
  let note: string | undefined;
  if (
    params.configuredScopedModelPatterns.length > 0 &&
    scopedModels.length === 0
  ) {
    note = params.cliScopedModelPatterns
      ? "No CLI scoped models matched the current auth configuration. Showing all available models."
      : "No scoped models matched the current auth configuration. Showing all available models.";
  }
  return {
    chatId: params.chatId,
    messageId: 0,
    page: 0,
    scope: scopedModels.length > 0 ? "scoped" : "all",
    scopedModels,
    allModels,
    note,
    mode: "status",
  };
}

export function parseTelegramMenuCallbackAction(
  data: string | undefined,
): TelegramMenuCallbackAction {
  if (data === "status:model") return { kind: "status", action: "model" };
  if (data === "status:thinking") {
    return { kind: "status", action: "thinking" };
  }
  if (data === "status:voice") {
    return { kind: "status", action: "voice" };
  }
  if (data?.startsWith("thinking:set:")) {
    return {
      kind: "thinking:set",
      level: data.slice("thinking:set:".length),
    };
  }
  if (data?.startsWith("voice:")) {
    const [, action, value] = data.split(":");
    if (
      action === "noop" ||
      action === "back" ||
      action === "answerback" ||
      action === "answermenu" ||
      action === "langback" ||
      action === "langmenu" ||
      action === "styleback" ||
      action === "stylemenu" ||
      action === "voiceback" ||
      action === "voicemenu" ||
      action === "toggle" ||
      action === "answer" ||
      action === "style" ||
      action === "voice" ||
      action === "lang"
    ) {
      return { kind: "voice", action, value };
    }
  }
  if (data?.startsWith("model:")) {
    const [, action, value] = data.split(":");
    if (
      action === "noop" ||
      action === "scope" ||
      action === "page" ||
      action === "pick"
    ) {
      return { kind: "model", action, value };
    }
  }
  return { kind: "ignore" };
}

export function applyTelegramModelScopeSelection(
  state: TelegramModelMenuState,
  value: string | undefined,
): TelegramMenuMutationResult {
  if (value !== "all" && value !== "scoped") return "invalid";
  if (value === state.scope) return "unchanged";
  state.scope = value;
  state.page = 0;
  return "changed";
}

export function applyTelegramModelPageSelection(
  state: TelegramModelMenuState,
  value: string | undefined,
): TelegramMenuMutationResult {
  const page = Number(value);
  if (!Number.isFinite(page)) return "invalid";
  if (page === state.page) return "unchanged";
  state.page = page;
  return "changed";
}

export function getTelegramModelSelection(
  state: TelegramModelMenuState,
  value: string | undefined,
): TelegramMenuSelectionResult {
  const index = Number(value);
  if (!Number.isFinite(index)) return { kind: "invalid" };
  const selection = getModelMenuItems(state)[index];
  if (!selection) return { kind: "missing" };
  return { kind: "selected", selection };
}

export function buildTelegramModelCallbackPlan(
  params: BuildTelegramModelCallbackPlanParams,
): TelegramModelCallbackPlan {
  const action = parseTelegramMenuCallbackAction(params.data);
  if (action.kind !== "model") return { kind: "ignore" };
  if (action.action === "noop") return { kind: "answer" };
  if (action.action === "scope") {
    const result = applyTelegramModelScopeSelection(params.state, action.value);
    if (result === "invalid") {
      return { kind: "answer", text: "Unknown model scope." };
    }
    if (result === "unchanged") {
      return { kind: "answer" };
    }
    return {
      kind: "update-menu",
      text: params.state.scope === "scoped" ? "Scoped models" : "All models",
    };
  }
  if (action.action === "page") {
    const result = applyTelegramModelPageSelection(params.state, action.value);
    if (result === "invalid") {
      return { kind: "answer", text: "Invalid page." };
    }
    if (result === "unchanged") {
      return { kind: "answer" };
    }
    return { kind: "update-menu" };
  }
  if (action.action !== "pick") {
    return { kind: "answer" };
  }
  const selectionResult = getTelegramModelSelection(params.state, action.value);
  if (selectionResult.kind === "invalid") {
    return { kind: "answer", text: "Invalid model selection." };
  }
  if (selectionResult.kind === "missing") {
    return { kind: "answer", text: "Selected model is no longer available." };
  }
  const selection = selectionResult.selection;
  if (modelsMatch(selection.model, params.activeModel)) {
    return {
      kind: "refresh-status",
      selection,
      callbackText: `Model: ${selection.model.id}`,
      shouldApplyThinkingLevel:
        !!selection.thinkingLevel &&
        selection.thinkingLevel !== params.currentThinkingLevel,
    };
  }
  if (!params.isIdle) {
    if (!params.canRestartBusyRun) {
      return { kind: "answer", text: "Pi is busy. Send /stop first." };
    }
    return {
      kind: "switch-model",
      selection,
      mode: params.hasActiveToolExecutions
        ? "restart-after-tool"
        : "restart-now",
      callbackText: params.hasActiveToolExecutions
        ? `Switched to ${selection.model.id}. Restarting after the current tool finishes…`
        : `Switching to ${selection.model.id} and continuing…`,
    };
  }
  return {
    kind: "switch-model",
    selection,
    mode: "idle",
    callbackText: `Switched to ${selection.model.id}`,
  };
}

export async function handleTelegramMenuCallbackEntry(
  callbackQueryId: string,
  data: string | undefined,
  state: TelegramModelMenuState | undefined,
  deps: TelegramMenuCallbackEntryDeps,
): Promise<void> {
  if (!data) {
    await deps.answerCallbackQuery(callbackQueryId);
    return;
  }
  if (!state) {
    await deps.answerCallbackQuery(callbackQueryId, "Interactive message expired.");
    return;
  }
  const handled =
    (await deps.handleStatusAction()) ||
    (await deps.handleThinkingAction()) ||
    (await deps.handleVoiceAction()) ||
    (await deps.handleModelAction());
  if (!handled) {
    await deps.answerCallbackQuery(callbackQueryId);
  }
}

export async function handleTelegramModelMenuCallbackAction(
  callbackQueryId: string,
  params: BuildTelegramModelCallbackPlanParams,
  deps: TelegramModelMenuCallbackDeps,
): Promise<boolean> {
  const plan = buildTelegramModelCallbackPlan(params);
  if (plan.kind === "ignore") return false;
  if (plan.kind === "answer") {
    await deps.answerCallbackQuery(callbackQueryId, plan.text);
    return true;
  }
  if (plan.kind === "update-menu") {
    await deps.updateModelMenuMessage();
    await deps.answerCallbackQuery(callbackQueryId, plan.text);
    return true;
  }
  if (plan.kind === "refresh-status") {
    if (plan.shouldApplyThinkingLevel && plan.selection.thinkingLevel) {
      deps.setThinkingLevel(plan.selection.thinkingLevel);
    }
    await deps.updateStatusMessage();
    await deps.answerCallbackQuery(callbackQueryId, plan.callbackText);
    return true;
  }
  const changed = await deps.setModel(plan.selection.model);
  if (changed === false) {
    await deps.answerCallbackQuery(callbackQueryId, "Model is not available.");
    return true;
  }
  deps.setCurrentModel(plan.selection.model);
  if (plan.selection.thinkingLevel) {
    deps.setThinkingLevel(plan.selection.thinkingLevel);
  }
  await deps.updateStatusMessage();
  if (plan.mode === "restart-after-tool") {
    deps.stagePendingModelSwitch(plan.selection);
    await deps.answerCallbackQuery(callbackQueryId, plan.callbackText);
    return true;
  }
  if (plan.mode === "restart-now") {
    const restarted = await deps.restartInterruptedTelegramTurn(plan.selection);
    if (!restarted) {
      await deps.answerCallbackQuery(
        callbackQueryId,
        "Pi is busy. Send /stop first.",
      );
      return true;
    }
  }
  await deps.answerCallbackQuery(callbackQueryId, plan.callbackText);
  return true;
}

export async function handleTelegramStatusMenuCallbackAction(
  callbackQueryId: string,
  data: string | undefined,
  activeModel: Model<any> | undefined,
  deps: TelegramStatusMenuCallbackDeps,
): Promise<boolean> {
  const action = parseTelegramMenuCallbackAction(data);
  if (action.kind === "status" && action.action === "model") {
    await deps.updateModelMenuMessage();
    await deps.answerCallbackQuery(callbackQueryId);
    return true;
  }
  if (action.kind === "status" && action.action === "voice") {
    await deps.updateVoiceMenuMessage();
    await deps.answerCallbackQuery(callbackQueryId);
    return true;
  }
  if (!(action.kind === "status" && action.action === "thinking")) {
    return false;
  }
  if (!activeModel?.reasoning) {
    await deps.answerCallbackQuery(
      callbackQueryId,
      "This model has no reasoning controls.",
    );
    return true;
  }
  await deps.updateThinkingMenuMessage();
  await deps.answerCallbackQuery(callbackQueryId);
  return true;
}

export async function handleTelegramThinkingMenuCallbackAction(
  callbackQueryId: string,
  data: string | undefined,
  activeModel: Model<any> | undefined,
  deps: TelegramThinkingMenuCallbackDeps,
): Promise<boolean> {
  const action = parseTelegramMenuCallbackAction(data);
  if (action.kind !== "thinking:set") return false;
  if (!isThinkingLevel(action.level)) {
    await deps.answerCallbackQuery(callbackQueryId, "Invalid thinking level.");
    return true;
  }
  if (!activeModel?.reasoning) {
    await deps.answerCallbackQuery(
      callbackQueryId,
      "This model has no reasoning controls.",
    );
    return true;
  }
  deps.setThinkingLevel(action.level);
  await deps.updateStatusMessage();
  await deps.answerCallbackQuery(
    callbackQueryId,
    `Thinking: ${deps.getCurrentThinkingLevel()}`,
  );
  return true;
}

export async function handleTelegramVoiceMenuCallbackAction(
  callbackQueryId: string,
  data: string | undefined,
  deps: TelegramVoiceMenuCallbackDeps,
): Promise<boolean> {
  const action = parseTelegramMenuCallbackAction(data);
  if (action.kind !== "voice") return false;
  if (action.action === "noop") {
    await deps.answerCallbackQuery(callbackQueryId);
    return true;
  }
  if (action.action === "answermenu") {
    await deps.updateVoiceAnswerMenuMessage();
    await deps.answerCallbackQuery(callbackQueryId);
    return true;
  }
  if (action.action === "answerback") {
    await deps.updateVoiceMenuMessage();
    await deps.answerCallbackQuery(callbackQueryId);
    return true;
  }
  if (action.action === "voicemenu") {
    await deps.updateVoiceVoiceMenuMessage();
    await deps.answerCallbackQuery(callbackQueryId);
    return true;
  }
  if (action.action === "voiceback") {
    await deps.updateVoiceMenuMessage();
    await deps.answerCallbackQuery(callbackQueryId);
    return true;
  }
  if (action.action === "stylemenu") {
    await deps.updateVoiceStyleMenuMessage();
    await deps.answerCallbackQuery(callbackQueryId);
    return true;
  }
  if (action.action === "styleback") {
    await deps.updateVoiceMenuMessage();
    await deps.answerCallbackQuery(callbackQueryId);
    return true;
  }
  if (action.action === "langmenu") {
    await deps.updateVoiceLanguageMenuMessage();
    await deps.answerCallbackQuery(callbackQueryId);
    return true;
  }
  if (action.action === "langback") {
    await deps.updateVoiceMenuMessage();
    await deps.answerCallbackQuery(callbackQueryId);
    return true;
  }
  if (action.action === "back") {
    await deps.updateStatusMessage();
    await deps.answerCallbackQuery(callbackQueryId);
    return true;
  }
  const apply = async (
    command: Parameters<TelegramVoiceMenuCallbackDeps["saveVoiceSetting"]>[0],
    text?: string,
  ): Promise<boolean> => {
    await deps.saveVoiceSetting(command);
    await deps.updateVoiceMenuMessage();
    await deps.answerCallbackQuery(callbackQueryId, text);
    return true;
  };
  if (action.action === "toggle") {
    if (action.value !== "on" && action.value !== "off") {
      await deps.answerCallbackQuery(callbackQueryId, "Invalid voice mode.");
      return true;
    }
    return apply(
      { action: "toggle", enabled: action.value === "on" },
      action.value === "on" ? "Voice replies allowed" : "Voice replies disabled",
    );
  }
  if (action.action === "answer") {
    if (
      action.value !== "text" &&
      action.value !== "voice" &&
      action.value !== "voice-text"
    ) {
      await deps.answerCallbackQuery(callbackQueryId, "Invalid answer mode.");
      return true;
    }
    if (action.value === "text") {
      await deps.saveVoiceSetting({ action: "reply", enabled: false });
      await deps.saveVoiceSetting({ action: "text", enabled: false });
      await deps.updateVoiceAnswerMenuMessage();
      await deps.answerCallbackQuery(callbackQueryId, "Answer mode: Text");
      return true;
    }
    if (action.value === "voice") {
      await deps.saveVoiceSetting({ action: "reply", enabled: true });
      await deps.saveVoiceSetting({ action: "text", enabled: false });
      await deps.updateVoiceAnswerMenuMessage();
      await deps.answerCallbackQuery(callbackQueryId, "Answer mode: Voice");
      return true;
    }
    await deps.saveVoiceSetting({ action: "reply", enabled: true });
    await deps.saveVoiceSetting({ action: "text", enabled: true });
    await deps.updateVoiceAnswerMenuMessage();
    await deps.answerCallbackQuery(callbackQueryId, "Answer mode: Voice + text");
    return true;
  }
  if (
    action.action === "style" &&
    (action.value === "literal" ||
      action.value === "rewrite-light" ||
      action.value === "rewrite-tags" ||
      action.value === "rewrite-strong")
  ) {
    return apply(
      { action: "style", style: action.value },
      `Speech style: ${formatVoiceStyleLabel(action.value)}`,
    );
  }
  if (action.action === "voice" && action.value) {
    return apply({ action: "voice", voiceId: action.value }, `Voice: ${action.value}`);
  }
  if (action.action === "lang" && action.value) {
    return apply(
      { action: "language", language: action.value },
      `Force language: ${formatVoiceLanguageLabel(action.value)}`,
    );
  }
  await deps.answerCallbackQuery(callbackQueryId, "Unknown voice action.");
  return true;
}

export function buildThinkingMenuText(
  activeModel: Model<any> | undefined,
  currentThinkingLevel: ThinkingLevel,
): string {
  const lines = ["Choose a thinking level"];
  if (activeModel) {
    lines.push(`Model: ${getCanonicalModelId(activeModel)}`);
  }
  lines.push(`Current: ${currentThinkingLevel}`);
  return lines.join("\n");
}

export function getTelegramModelMenuPage(
  state: TelegramModelMenuState,
  pageSize: number,
): TelegramModelMenuPage {
  const items = getModelMenuItems(state);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.max(0, Math.min(state.page, pageCount - 1));
  const start = page * pageSize;
  return {
    page,
    pageCount,
    start,
    items: items.slice(start, start + pageSize),
  };
}

export function buildModelMenuReplyMarkup(
  state: TelegramModelMenuState,
  currentModel: Model<any> | undefined,
  pageSize: number,
): TelegramReplyMarkup {
  const menuPage = getTelegramModelMenuPage(state, pageSize);
  const rows = menuPage.items.map((entry, index) => [
    {
      text: formatScopedModelButtonText(entry, currentModel),
      callback_data: `model:pick:${menuPage.start + index}`,
    },
  ]);
  if (menuPage.pageCount > 1) {
    const previousPage =
      menuPage.page === 0 ? menuPage.pageCount - 1 : menuPage.page - 1;
    const nextPage =
      menuPage.page === menuPage.pageCount - 1 ? 0 : menuPage.page + 1;
    rows.push([
      { text: "⬅️", callback_data: `model:page:${previousPage}` },
      {
        text: `${menuPage.page + 1}/${menuPage.pageCount}`,
        callback_data: "model:noop",
      },
      { text: "➡️", callback_data: `model:page:${nextPage}` },
    ]);
  }
  if (state.scopedModels.length > 0) {
    rows.push([
      {
        text: state.scope === "scoped" ? "✅ Scoped" : "Scoped",
        callback_data: "model:scope:scoped",
      },
      {
        text: state.scope === "all" ? "✅ All" : "All",
        callback_data: "model:scope:all",
      },
    ]);
  }
  return { inline_keyboard: rows };
}

export function buildThinkingMenuReplyMarkup(
  currentThinkingLevel: ThinkingLevel,
): TelegramReplyMarkup {
  return {
    inline_keyboard: THINKING_LEVELS.map((level) => [
      {
        text: level === currentThinkingLevel ? `✅ ${level}` : level,
        callback_data: `thinking:set:${level}`,
      },
    ]),
  };
}

function formatVoiceButtonText(
  current: string | undefined,
  value: string,
  label?: string,
): string {
  const resolvedLabel = label ?? value;
  return current === value ? `✅ ${resolvedLabel}` : resolvedLabel;
}

const TELEGRAM_VOICE_LANGUAGE_LABELS: Record<string, string> = {
  auto: "Auto",
  en: "English (en)",
  "ar-EG": "Arabic Egypt (ar-EG)",
  "ar-SA": "Arabic Saudi Arabia (ar-SA)",
  "ar-AE": "Arabic UAE (ar-AE)",
  bn: "Bengali (bn)",
  zh: "Chinese (zh)",
  fr: "French (fr)",
  de: "German (de)",
  hi: "Hindi (hi)",
  id: "Indonesian (id)",
  it: "Italian (it)",
  ja: "Japanese (ja)",
  ko: "Korean (ko)",
  "pt-BR": "Portuguese Brazil (pt-BR)",
  "pt-PT": "Portuguese Portugal (pt-PT)",
  ru: "Russian (ru)",
  "es-MX": "Spanish Mexico (es-MX)",
  "es-ES": "Spanish Spain (es-ES)",
  tr: "Turkish (tr)",
  vi: "Vietnamese (vi)",
};

const TELEGRAM_VOICE_CHOICE_METADATA: Record<
  string,
  { symbol: string; tone: string; description: string }
> = {
  eve: {
    symbol: "♀",
    tone: "Energetic, upbeat",
    description: "Default voice, engaging and enthusiastic",
  },
  ara: {
    symbol: "♀",
    tone: "Warm, friendly",
    description: "Balanced and conversational",
  },
  rex: {
    symbol: "♂",
    tone: "Confident, clear",
    description: "Professional and articulate",
  },
  sal: {
    symbol: "◌",
    tone: "Smooth, balanced",
    description: "Versatile and calm",
  },
  leo: {
    symbol: "♂",
    tone: "Authoritative, strong",
    description: "Decisive and commanding",
  },
  una: {
    symbol: "♀",
    tone: "Bright, lively",
    description: "Compact and playful",
  },
};

const TELEGRAM_VOICE_STYLE_LABELS: Record<
  TelegramVoiceMenuSettings["speechStyle"],
  string
> = {
  literal: "Literal",
  "rewrite-light": "Natural",
  "rewrite-tags": "Expressive",
  "rewrite-strong": "Expressive+",
};

function formatVoiceLanguageLabel(language: string | undefined): string {
  if (!language) return "Auto";
  return TELEGRAM_VOICE_LANGUAGE_LABELS[language] ?? language;
}

function formatVoiceStyleLabel(
  style: TelegramVoiceMenuSettings["speechStyle"],
): string {
  return TELEGRAM_VOICE_STYLE_LABELS[style] ?? style;
}

function getVoiceAnswerMode(settings: TelegramVoiceMenuSettings):
  | "text"
  | "voice"
  | "voice-text" {
  if (!settings.replyWithVoiceOnIncomingVoice) return "text";
  return settings.alsoSendTextReply ? "voice-text" : "voice";
}

function formatVoiceAnswerModeLabel(
  mode: ReturnType<typeof getVoiceAnswerMode>,
): string {
  switch (mode) {
    case "text":
      return "Text";
    case "voice":
      return "Voice";
    case "voice-text":
      return "Voice + text";
  }
}

function buildVoiceLanguageRows(settings: TelegramVoiceMenuSettings) {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (let index = 0; index < TELEGRAM_VOICE_MENU_LANGUAGES.length; index += 2) {
    const pair = TELEGRAM_VOICE_MENU_LANGUAGES.slice(index, index + 2);
    rows.push(
      pair.map((language) => ({
        text: formatVoiceButtonText(
          settings.language,
          language,
          formatVoiceLanguageLabel(language),
        ),
        callback_data: `voice:lang:${language}`,
      })),
    );
  }
  return rows;
}

function buildVoiceRows(settings: TelegramVoiceMenuSettings) {
  return [
    TELEGRAM_VOICE_MENU_VOICE_IDS.slice(0, 3).map((voiceId) => ({
      text: formatVoiceButtonText(
        settings.voiceId,
        voiceId,
        `${TELEGRAM_VOICE_CHOICE_METADATA[voiceId]?.symbol ?? "•"} ${voiceId}`,
      ),
      callback_data: `voice:voice:${voiceId}`,
    })),
    TELEGRAM_VOICE_MENU_VOICE_IDS.slice(3).map((voiceId) => ({
      text: formatVoiceButtonText(
        settings.voiceId,
        voiceId,
        `${TELEGRAM_VOICE_CHOICE_METADATA[voiceId]?.symbol ?? "•"} ${voiceId}`,
      ),
      callback_data: `voice:voice:${voiceId}`,
    })),
  ];
}

function buildVoiceStyleRows(settings: TelegramVoiceMenuSettings) {
  return TELEGRAM_VOICE_MENU_STYLES.map((style) => [
    {
      text: formatVoiceButtonText(
        settings.speechStyle,
        style,
        formatVoiceStyleLabel(style),
      ),
      callback_data: `voice:style:${style}`,
    },
  ]);
}

export function buildVoiceMenuText(
  settings: TelegramVoiceMenuSettings,
): string {
  const lines = [TELEGRAM_VOICE_MENU_TITLE];
  lines.push("Choose how Telegram should answer with voice.");
  lines.push(`Voice replies: ${settings.enabled ? "allowed" : "disabled"}`);
  lines.push(`Answer mode: ${formatVoiceAnswerModeLabel(getVoiceAnswerMode(settings))}`);
  lines.push("Incoming voice messages are transcribed automatically.");
  lines.push(`Selected voice: ${settings.voiceId ?? "provider default"}`);
  lines.push(`Force language: ${formatVoiceLanguageLabel(settings.language)}`);
  lines.push(`Speech style: ${formatVoiceStyleLabel(settings.speechStyle)}`);
  return lines.join("\n");
}

export function buildVoiceMenuReplyMarkup(
  settings: TelegramVoiceMenuSettings,
): TelegramReplyMarkup {
  return {
    inline_keyboard: [
      [
        {
          text: settings.enabled ? "✅ Allow voice replies" : "Allow voice replies",
          callback_data: "voice:toggle:on",
        },
        {
          text: !settings.enabled ? "✅ Disable voice replies" : "Disable voice replies",
          callback_data: "voice:toggle:off",
        },
      ],
      [
        {
          text: `Answer mode: ${formatVoiceAnswerModeLabel(getVoiceAnswerMode(settings))}`,
          callback_data: "voice:answermenu",
        },
      ],
      [
        {
          text: `Voice: ${settings.voiceId ?? "provider default"}`,
          callback_data: "voice:voicemenu",
        },
      ],
      [
        {
          text: `Speech style: ${formatVoiceStyleLabel(settings.speechStyle)}`,
          callback_data: "voice:stylemenu",
        },
      ],
      [
        {
          text: `Force language: ${formatVoiceLanguageLabel(settings.language)}`,
          callback_data: "voice:langmenu",
        },
      ],
      [{ text: "⬅️ Back", callback_data: "voice:back" }],
    ],
  };
}

export function buildVoiceLanguageMenuText(
  settings: TelegramVoiceMenuSettings,
): string {
  return [
    "<b>Force language</b>",
    `Current: ${formatVoiceLanguageLabel(settings.language)}`,
    "Pick the language you want TTS to force. Auto lets the provider decide.",
  ].join("\n");
}

export function buildVoiceAnswerMenuText(
  settings: TelegramVoiceMenuSettings,
): string {
  return [
    "<b>Answer mode</b>",
    `Current: ${formatVoiceAnswerModeLabel(getVoiceAnswerMode(settings))}`,
    "Text keeps normal text replies.",
    "Voice sends spoken replies.",
    "Voice + text sends a voice reply plus a text copy.",
  ].join("\n");
}

export function buildVoiceAnswerMenuReplyMarkup(
  settings: TelegramVoiceMenuSettings,
): TelegramReplyMarkup {
  const current = getVoiceAnswerMode(settings);
  return {
    inline_keyboard: [
      [
        {
          text: current === "text" ? "✅ Text" : "Text",
          callback_data: "voice:answer:text",
        },
      ],
      [
        {
          text: current === "voice" ? "✅ Voice" : "Voice",
          callback_data: "voice:answer:voice",
        },
      ],
      [
        {
          text: current === "voice-text" ? "✅ Voice + text" : "Voice + text",
          callback_data: "voice:answer:voice-text",
        },
      ],
      [{ text: "⬅️ Voice settings", callback_data: "voice:answerback" }],
    ],
  };
}

export function buildVoiceLanguageMenuReplyMarkup(
  settings: TelegramVoiceMenuSettings,
): TelegramReplyMarkup {
  return {
    inline_keyboard: [
      ...buildVoiceLanguageRows(settings),
      [{ text: "⬅️ Voice settings", callback_data: "voice:langback" }],
    ],
  };
}

export function buildVoiceStyleMenuText(
  settings: TelegramVoiceMenuSettings,
): string {
  return [
    "<b>Speech style</b>",
    `Current: ${formatVoiceStyleLabel(settings.speechStyle)}`,
    "Literal keeps wording close to the original.",
    "Natural sounds more spoken.",
    "Expressive adds a few speech tags.",
    "Expressive+ leans into stronger delivery.",
  ].join("\n");
}

export function buildVoiceStyleMenuReplyMarkup(
  settings: TelegramVoiceMenuSettings,
): TelegramReplyMarkup {
  return {
    inline_keyboard: [
      ...buildVoiceStyleRows(settings),
      [{ text: "⬅️ Voice settings", callback_data: "voice:styleback" }],
    ],
  };
}

export function buildVoiceVoiceMenuText(
  settings: TelegramVoiceMenuSettings,
): string {
  const lines = [
    "<b>Voice</b>",
    `Current: ${settings.voiceId ?? "provider default"}`,
    "Pick the xAI voice used for Telegram voice notes.",
    "",
  ];
  for (const voiceId of TELEGRAM_VOICE_MENU_VOICE_IDS) {
    const meta = TELEGRAM_VOICE_CHOICE_METADATA[voiceId];
    if (!meta) {
      lines.push(`• ${voiceId}`);
      continue;
    }
    lines.push(
      `${meta.symbol} ${voiceId} — ${meta.tone}. ${meta.description}`,
    );
  }
  return lines.join("\n");
}

export function buildVoiceVoiceMenuReplyMarkup(
  settings: TelegramVoiceMenuSettings,
): TelegramReplyMarkup {
  return {
    inline_keyboard: [
      ...buildVoiceRows(settings),
      [{ text: "⬅️ Voice settings", callback_data: "voice:voiceback" }],
    ],
  };
}

export function buildStatusReplyMarkup(
  activeModel: Model<any> | undefined,
  currentThinkingLevel: ThinkingLevel,
  voiceSummary?: string,
): TelegramReplyMarkup {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  rows.push([
    {
      text: formatStatusButtonLabel(
        "Model",
        activeModel ? getCanonicalModelId(activeModel) : "unknown",
      ),
      callback_data: "status:model",
    },
  ]);
  if (activeModel?.reasoning) {
    rows.push([
      {
        text: formatStatusButtonLabel("Thinking", currentThinkingLevel),
        callback_data: "status:thinking",
      },
    ]);
  }
  rows.push([
    {
      text: voiceSummary
        ? formatStatusButtonLabel("Voice settings", voiceSummary)
        : "🔊 Voice settings",
      callback_data: "status:voice",
    },
  ]);
  return { inline_keyboard: rows };
}

export function buildTelegramModelMenuRenderPayload(
  state: TelegramModelMenuState,
  activeModel: Model<any> | undefined,
): TelegramMenuRenderPayload {
  return {
    nextMode: "model",
    text: MODEL_MENU_TITLE,
    mode: "html",
    replyMarkup: buildModelMenuReplyMarkup(
      state,
      activeModel,
      TELEGRAM_MODEL_PAGE_SIZE,
    ),
  };
}

export function buildTelegramThinkingMenuRenderPayload(
  activeModel: Model<any> | undefined,
  currentThinkingLevel: ThinkingLevel,
): TelegramMenuRenderPayload {
  return {
    nextMode: "thinking",
    text: buildThinkingMenuText(activeModel, currentThinkingLevel),
    mode: "plain",
    replyMarkup: buildThinkingMenuReplyMarkup(currentThinkingLevel),
  };
}

export function buildTelegramVoiceMenuRenderPayload(
  settings: TelegramVoiceMenuSettings,
): TelegramMenuRenderPayload {
  return {
    nextMode: "voice",
    text: buildVoiceMenuText(settings),
    mode: "html",
    replyMarkup: buildVoiceMenuReplyMarkup(settings),
  };
}

export function buildTelegramVoiceLanguageMenuRenderPayload(
  settings: TelegramVoiceMenuSettings,
): TelegramMenuRenderPayload {
  return {
    nextMode: "voice-language",
    text: buildVoiceLanguageMenuText(settings),
    mode: "html",
    replyMarkup: buildVoiceLanguageMenuReplyMarkup(settings),
  };
}

export function buildTelegramVoiceAnswerMenuRenderPayload(
  settings: TelegramVoiceMenuSettings,
): TelegramMenuRenderPayload {
  return {
    nextMode: "voice-answer",
    text: buildVoiceAnswerMenuText(settings),
    mode: "html",
    replyMarkup: buildVoiceAnswerMenuReplyMarkup(settings),
  };
}

export function buildTelegramVoiceStyleMenuRenderPayload(
  settings: TelegramVoiceMenuSettings,
): TelegramMenuRenderPayload {
  return {
    nextMode: "voice-style",
    text: buildVoiceStyleMenuText(settings),
    mode: "html",
    replyMarkup: buildVoiceStyleMenuReplyMarkup(settings),
  };
}

export function buildTelegramVoiceVoiceMenuRenderPayload(
  settings: TelegramVoiceMenuSettings,
): TelegramMenuRenderPayload {
  return {
    nextMode: "voice-voice",
    text: buildVoiceVoiceMenuText(settings),
    mode: "html",
    replyMarkup: buildVoiceVoiceMenuReplyMarkup(settings),
  };
}

export function buildTelegramStatusMenuRenderPayload(
  statusText: string,
  activeModel: Model<any> | undefined,
  currentThinkingLevel: ThinkingLevel,
  voiceSummary?: string,
): TelegramMenuRenderPayload {
  return {
    nextMode: "status",
    text: statusText,
    mode: "html",
    replyMarkup: buildStatusReplyMarkup(
      activeModel,
      currentThinkingLevel,
      voiceSummary,
    ),
  };
}

export async function updateTelegramModelMenuMessage(
  state: TelegramModelMenuState,
  activeModel: Model<any> | undefined,
  deps: TelegramMenuMessageRuntimeDeps,
): Promise<void> {
  const payload = buildTelegramModelMenuRenderPayload(state, activeModel);
  state.mode = payload.nextMode;
  await deps.editInteractiveMessage(
    state.chatId,
    state.messageId,
    payload.text,
    payload.mode,
    payload.replyMarkup,
  );
}

export async function updateTelegramThinkingMenuMessage(
  state: TelegramModelMenuState,
  activeModel: Model<any> | undefined,
  currentThinkingLevel: ThinkingLevel,
  deps: TelegramMenuMessageRuntimeDeps,
): Promise<void> {
  const payload = buildTelegramThinkingMenuRenderPayload(
    activeModel,
    currentThinkingLevel,
  );
  state.mode = payload.nextMode;
  await deps.editInteractiveMessage(
    state.chatId,
    state.messageId,
    payload.text,
    payload.mode,
    payload.replyMarkup,
  );
}

export async function updateTelegramVoiceMenuMessage(
  state: TelegramModelMenuState,
  settings: TelegramVoiceMenuSettings,
  deps: TelegramMenuMessageRuntimeDeps,
): Promise<void> {
  const payload = buildTelegramVoiceMenuRenderPayload(settings);
  state.mode = payload.nextMode;
  await deps.editInteractiveMessage(
    state.chatId,
    state.messageId,
    payload.text,
    payload.mode,
    payload.replyMarkup,
  );
}

export async function updateTelegramVoiceLanguageMenuMessage(
  state: TelegramModelMenuState,
  settings: TelegramVoiceMenuSettings,
  deps: TelegramMenuMessageRuntimeDeps,
): Promise<void> {
  const payload = buildTelegramVoiceLanguageMenuRenderPayload(settings);
  state.mode = payload.nextMode;
  await deps.editInteractiveMessage(
    state.chatId,
    state.messageId,
    payload.text,
    payload.mode,
    payload.replyMarkup,
  );
}

export async function updateTelegramVoiceAnswerMenuMessage(
  state: TelegramModelMenuState,
  settings: TelegramVoiceMenuSettings,
  deps: TelegramMenuMessageRuntimeDeps,
): Promise<void> {
  const payload = buildTelegramVoiceAnswerMenuRenderPayload(settings);
  state.mode = payload.nextMode;
  await deps.editInteractiveMessage(
    state.chatId,
    state.messageId,
    payload.text,
    payload.mode,
    payload.replyMarkup,
  );
}

export async function updateTelegramVoiceStyleMenuMessage(
  state: TelegramModelMenuState,
  settings: TelegramVoiceMenuSettings,
  deps: TelegramMenuMessageRuntimeDeps,
): Promise<void> {
  const payload = buildTelegramVoiceStyleMenuRenderPayload(settings);
  state.mode = payload.nextMode;
  await deps.editInteractiveMessage(
    state.chatId,
    state.messageId,
    payload.text,
    payload.mode,
    payload.replyMarkup,
  );
}

export async function updateTelegramVoiceVoiceMenuMessage(
  state: TelegramModelMenuState,
  settings: TelegramVoiceMenuSettings,
  deps: TelegramMenuMessageRuntimeDeps,
): Promise<void> {
  const payload = buildTelegramVoiceVoiceMenuRenderPayload(settings);
  state.mode = payload.nextMode;
  await deps.editInteractiveMessage(
    state.chatId,
    state.messageId,
    payload.text,
    payload.mode,
    payload.replyMarkup,
  );
}

export async function updateTelegramStatusMessage(
  state: TelegramModelMenuState,
  statusText: string,
  activeModel: Model<any> | undefined,
  currentThinkingLevel: ThinkingLevel,
  voiceSummary: string | undefined,
  deps: TelegramMenuMessageRuntimeDeps,
): Promise<void> {
  const payload = buildTelegramStatusMenuRenderPayload(
    statusText,
    activeModel,
    currentThinkingLevel,
    voiceSummary,
  );
  state.mode = payload.nextMode;
  await deps.editInteractiveMessage(
    state.chatId,
    state.messageId,
    payload.text,
    payload.mode,
    payload.replyMarkup,
  );
}

export async function sendTelegramStatusMessage(
  state: TelegramModelMenuState,
  statusText: string,
  activeModel: Model<any> | undefined,
  currentThinkingLevel: ThinkingLevel,
  voiceSummary: string | undefined,
  deps: TelegramMenuMessageRuntimeDeps,
): Promise<number | undefined> {
  const payload = buildTelegramStatusMenuRenderPayload(
    statusText,
    activeModel,
    currentThinkingLevel,
    voiceSummary,
  );
  state.mode = payload.nextMode;
  return deps.sendInteractiveMessage(
    state.chatId,
    payload.text,
    payload.mode,
    payload.replyMarkup,
  );
}

export async function sendTelegramModelMenuMessage(
  state: TelegramModelMenuState,
  activeModel: Model<any> | undefined,
  deps: TelegramMenuMessageRuntimeDeps,
): Promise<number | undefined> {
  const payload = buildTelegramModelMenuRenderPayload(state, activeModel);
  state.mode = payload.nextMode;
  return deps.sendInteractiveMessage(
    state.chatId,
    payload.text,
    payload.mode,
    payload.replyMarkup,
  );
}
