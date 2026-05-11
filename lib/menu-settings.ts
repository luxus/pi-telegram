/**
 * Telegram settings menu UI helpers
 * Zones: telegram ui, settings controls, menu composition
 * Owns hidden settings-menu rendering, settings callbacks, and persisted toggle wiring
 */

import {
  getTelegramExtensionSettingsRows,
  type TelegramSectionRegistry,
} from "./extension-sections.ts";
import type { TelegramInlineKeyboardMarkup } from "./keyboard.ts";
import type { TelegramModelMenuState } from "./menu-model.ts";
import type { MenuModel } from "./model.ts";

export type TelegramSettingsMenuReplyMarkup = TelegramInlineKeyboardMarkup;

export interface TelegramSettingsStateDeps {
  isProactivePushEnabled: () => boolean;
}

export interface TelegramSettingsMutationDeps extends TelegramSettingsStateDeps {
  setProactivePushEnabled: (enabled: boolean) => Promise<void>;
}

export interface TelegramSettingsMenuOpenDeps<
  TModel extends MenuModel = MenuModel,
> extends TelegramSettingsStateDeps {
  getModelMenuState: () => Promise<TelegramModelMenuState<TModel>>;
  sendSettingsMenu: (
    state: TelegramModelMenuState<TModel>,
    text: string,
    replyMarkup: TelegramSettingsMenuReplyMarkup,
  ) => Promise<number | undefined>;
  storeModelMenuState: (state: TelegramModelMenuState<TModel>) => void;
}

export interface TelegramSettingsMenuCallbackDeps extends TelegramSettingsMutationDeps {
  updateSettingsMessage: (
    text: string,
    replyMarkup: TelegramSettingsMenuReplyMarkup,
  ) => Promise<void>;
  answerCallbackQuery: (
    callbackQueryId: string,
    text?: string,
  ) => Promise<void>;
  sectionRegistry?: TelegramSectionRegistry;
}

export interface TelegramSettingsMenuRuntime<TContext> {
  openSettingsMenu: (
    chatId: number,
    replyToMessageId: number,
    ctx: TContext,
  ) => Promise<void>;
  handleCallbackQuery: (
    query: {
      id: string;
      data?: string;
      message?: { message_id?: number };
    },
    ctx: TContext,
  ) => Promise<boolean>;
  updateSettingsMenuMessage: (
    state: TelegramModelMenuState,
    ctx: TContext,
  ) => Promise<void>;
}

export interface TelegramSettingsMenuMessageUpdateDeps extends TelegramSettingsStateDeps {
  updateSettingsMessage: (
    text: string,
    replyMarkup: TelegramSettingsMenuReplyMarkup,
  ) => Promise<void>;
}

export interface TelegramSettingsMenuRuntimeDeps<
  TContext,
  TModel extends MenuModel = MenuModel,
> extends TelegramSettingsMutationDeps {
  getModelMenuState: (
    chatId: number,
    ctx: TContext,
  ) => Promise<TelegramModelMenuState<TModel>>;
  getStoredModelMenuState: (
    messageId: number | undefined,
  ) => TelegramModelMenuState<TModel> | undefined;
  storeModelMenuState: (state: TelegramModelMenuState<TModel>) => void;
  editInteractiveMessage: (
    chatId: number,
    messageId: number,
    text: string,
    mode: "html" | "plain",
    replyMarkup: TelegramSettingsMenuReplyMarkup,
  ) => Promise<void>;
  sendInteractiveMessage: (
    chatId: number,
    text: string,
    mode: "html" | "plain",
    replyMarkup: TelegramSettingsMenuReplyMarkup,
  ) => Promise<number | undefined>;
  answerCallbackQuery: (
    callbackQueryId: string,
    text?: string,
  ) => Promise<void>;
}

export const SETTINGS_MENU_TITLE = "<b>⚙️ Settings:</b>";
export const PROACTIVE_PUSH_SETTINGS_TITLE = "<b>Proactive push:</b>";

export function buildTelegramSettingsMenuText(): string {
  return SETTINGS_MENU_TITLE;
}

export function buildProactivePushSettingsText(): string {
  return [
    PROACTIVE_PUSH_SETTINGS_TITLE,
    "",
    "Send successful local π task results to Telegram when the bridge is connected.",
  ].join("\n");
}

export function buildTelegramSettingsMenuReplyMarkup(
  proactivePushEnabled: boolean,
  sectionRegistry?: TelegramSectionRegistry,
): TelegramSettingsMenuReplyMarkup {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [
    [{ text: "⬆️ Main menu", callback_data: "menu:back" }],
  ];
  // Extension settings rows before built-in controls
  if (sectionRegistry) {
    const settingsRows = getTelegramExtensionSettingsRows(sectionRegistry);
    for (const row of settingsRows) {
      rows.push([{ text: row.label, callback_data: row.callback_data }]);
    }
  }
  rows.push([
    {
      text: `${proactivePushEnabled ? "🟢" : "⚫️"} Proactive push`,
      callback_data: "settings:open:proactive",
    },
  ]);
  return { inline_keyboard: rows };
}

export async function openTelegramSettingsMenu<
  TModel extends MenuModel = MenuModel,
>(
  deps: TelegramSettingsMenuOpenDeps<TModel>,
  sectionRegistry?: TelegramSectionRegistry,
): Promise<void> {
  const state = await deps.getModelMenuState();
  const messageId = await deps.sendSettingsMenu(
    state,
    buildTelegramSettingsMenuText(),
    buildTelegramSettingsMenuReplyMarkup(
      deps.isProactivePushEnabled(),
      sectionRegistry,
    ),
  );
  if (messageId === undefined) return;
  state.messageId = messageId;
  state.mode = "settings";
  deps.storeModelMenuState(state);
}

export function buildProactivePushSettingsReplyMarkup(
  proactivePushEnabled: boolean,
): TelegramSettingsMenuReplyMarkup {
  return {
    inline_keyboard: [
      [{ text: "⬆️ Back", callback_data: "settings:list" }],
      [
        {
          text: proactivePushEnabled ? "🟢 On" : "⚫️ On",
          callback_data: "settings:set:proactive:on",
        },
        {
          text: proactivePushEnabled ? "⚫️ Off" : "🟡 Off",
          callback_data: "settings:set:proactive:off",
        },
      ],
    ],
  };
}

export async function updateTelegramSettingsMenuMessage(
  deps: TelegramSettingsMenuMessageUpdateDeps,
  sectionRegistry?: TelegramSectionRegistry,
): Promise<void> {
  await deps.updateSettingsMessage(
    buildTelegramSettingsMenuText(),
    buildTelegramSettingsMenuReplyMarkup(
      deps.isProactivePushEnabled(),
      sectionRegistry,
    ),
  );
}

export async function updateProactivePushSettingsMessage(
  deps: TelegramSettingsMenuCallbackDeps,
): Promise<void> {
  await deps.updateSettingsMessage(
    buildProactivePushSettingsText(),
    buildProactivePushSettingsReplyMarkup(deps.isProactivePushEnabled()),
  );
}

export async function handleTelegramSettingsMenuCallbackAction(
  callbackQueryId: string,
  data: string | undefined,
  deps: TelegramSettingsMenuCallbackDeps,
): Promise<boolean> {
  if (!data?.startsWith("settings:")) return false;
  if (data === "settings:list") {
    await updateTelegramSettingsMenuMessage(deps, deps.sectionRegistry);
    await deps.answerCallbackQuery(callbackQueryId);
    return true;
  }
  if (data === "settings:open:proactive") {
    await updateProactivePushSettingsMessage(deps);
    await deps.answerCallbackQuery(callbackQueryId);
    return true;
  }
  if (
    data === "settings:set:proactive:on" ||
    data === "settings:set:proactive:off"
  ) {
    const enabled = data.endsWith(":on");
    await deps.setProactivePushEnabled(enabled);
    await updateProactivePushSettingsMessage(deps);
    await deps.answerCallbackQuery(
      callbackQueryId,
      `Proactive push ${enabled ? "enabled" : "disabled"}`,
    );
    return true;
  }
  await deps.answerCallbackQuery(callbackQueryId);
  return true;
}

export function createTelegramSettingsMenuRuntime<
  TContext,
  TModel extends MenuModel = MenuModel,
>(
  deps: TelegramSettingsMenuRuntimeDeps<TContext, TModel>,
  sectionRegistry?: TelegramSectionRegistry,
): TelegramSettingsMenuRuntime<TContext> {
  return {
    openSettingsMenu: (chatId, _replyToMessageId, ctx) =>
      openTelegramSettingsMenu(
        {
          getModelMenuState: () => deps.getModelMenuState(chatId, ctx),
          isProactivePushEnabled: deps.isProactivePushEnabled,
          sendSettingsMenu: (state, text, replyMarkup) =>
            deps.sendInteractiveMessage(
              state.chatId,
              text,
              "html",
              replyMarkup,
            ),
          storeModelMenuState: deps.storeModelMenuState,
        },
        sectionRegistry,
      ),
    updateSettingsMenuMessage: (state) =>
      updateTelegramSettingsMenuMessage(
        {
          isProactivePushEnabled: deps.isProactivePushEnabled,
          updateSettingsMessage: (text, replyMarkup) =>
            deps.editInteractiveMessage(
              state.chatId,
              state.messageId,
              text,
              "html",
              replyMarkup,
            ),
        },
        sectionRegistry,
      ),
    handleCallbackQuery: async (query) => {
      if (!query.data?.startsWith("settings:")) return false;
      const state = deps.getStoredModelMenuState(query.message?.message_id);
      if (!state) {
        await deps.answerCallbackQuery(
          query.id,
          "Interactive message expired.",
        );
        return true;
      }
      return handleTelegramSettingsMenuCallbackAction(query.id, query.data, {
        isProactivePushEnabled: deps.isProactivePushEnabled,
        setProactivePushEnabled: deps.setProactivePushEnabled,
        updateSettingsMessage: (text, replyMarkup) =>
          deps.editInteractiveMessage(
            state.chatId,
            state.messageId,
            text,
            "html",
            replyMarkup,
          ),
        answerCallbackQuery: deps.answerCallbackQuery,
        sectionRegistry,
      });
    },
  };
}
