/**
 * Telegram bridge extension entrypoint and orchestration layer
 * Keeps the runtime wiring in one place while delegating reusable domain logic to /lib modules
 */

import * as Api from "./lib/api.ts";
import * as Attachments from "./lib/attachments.ts";
import * as Commands from "./lib/commands.ts";
import * as Config from "./lib/config.ts";
import * as Media from "./lib/media.ts";
import * as Menu from "./lib/menu.ts";
import * as Model from "./lib/model.ts";
import * as Pi from "./lib/pi.ts";
import * as Polling from "./lib/polling.ts";
import * as Preview from "./lib/preview.ts";
import * as Queue from "./lib/queue.ts";
import * as Registration from "./lib/registration.ts";
import * as Replies from "./lib/replies.ts";
import * as Runtime from "./lib/runtime.ts";
import * as Setup from "./lib/setup.ts";
import * as Status from "./lib/status.ts";
import * as Turns from "./lib/turns.ts";
import * as Updates from "./lib/updates.ts";

type ActivePiModel = NonNullable<Pi.ExtensionContext["model"]>;
type RuntimeTelegramQueueItem = Queue.TelegramQueueItem<Pi.ExtensionContext>;

// --- Extension Runtime ---

export default function (pi: Pi.ExtensionAPI) {
  const piRuntime = Pi.createExtensionApiRuntimePorts(pi);
  const bridgeRuntime = Runtime.createTelegramBridgeRuntime();
  const configStore = Config.createTelegramConfigStore();
  const activeTurnRuntime = Queue.createTelegramActiveTurnStore();
  const pendingModelSwitchStore =
    Model.createPendingModelSwitchStore<
      Model.ScopedTelegramModel<ActivePiModel>
    >();
  const modelMenuRuntime = Menu.createTelegramModelMenuRuntime<ActivePiModel>();
  const runtimeEvents = Status.createTelegramRuntimeEventRecorder({
    getBotToken: configStore.getBotToken,
  });
  const mediaGroupRuntime =
    Media.createTelegramMediaGroupController<Api.TelegramMessage>();
  const telegramQueueStore =
    Queue.createTelegramQueueStore<Pi.ExtensionContext>();
  const pollingControllerState = Polling.createTelegramPollingControllerState();
  const { getStatusLines, updateStatus } =
    Status.createTelegramBridgeStatusRuntime<
      Pi.ExtensionContext,
      RuntimeTelegramQueueItem
    >({
      getConfig: configStore.get,
      isPollingActive: Polling.createTelegramPollingActivityReader(
        pollingControllerState,
      ),
      getActiveSourceMessageIds: activeTurnRuntime.getSourceMessageIds,
      hasActiveTurn: activeTurnRuntime.has,
      hasDispatchPending: bridgeRuntime.lifecycle.hasDispatchPending,
      isCompactionInProgress: bridgeRuntime.lifecycle.isCompactionInProgress,
      getActiveToolExecutions: bridgeRuntime.lifecycle.getActiveToolExecutions,
      hasPendingModelSwitch: pendingModelSwitchStore.has,
      getQueuedItems: telegramQueueStore.getQueuedItems,
      formatQueuedStatus: Queue.formatQueuedTelegramItemsStatus,
      getRecentRuntimeEvents: runtimeEvents.getEvents,
    });
  const currentModelRuntime = Model.createCurrentModelRuntime<
    Pi.ExtensionContext,
    ActivePiModel
  >({
    getContextModel: Pi.getExtensionContextModel,
    updateStatus,
  });
  const queueMutationRuntime =
    Queue.createTelegramQueueMutationController<Pi.ExtensionContext>({
      ...telegramQueueStore,
      getNextPriorityReactionOrder:
        bridgeRuntime.queue.getNextPriorityReactionOrder,
      incrementNextPriorityReactionOrder:
        bridgeRuntime.queue.incrementNextPriorityReactionOrder,
      updateStatus,
    });

  // --- Telegram API ---

  const {
    callMultipart,
    deleteWebhook,
    getUpdates,
    setMyCommands,
    sendTypingAction,
    sendMessageDraft,
    sendMessage,
    downloadFile: downloadTelegramBridgeFile,
    editMessageText: editTelegramMessageText,
    answerCallbackQuery,
    prepareTempDir,
  } = Api.createDefaultTelegramBridgeApiRuntime({
    getBotToken: configStore.getBotToken,
    recordRuntimeEvent: runtimeEvents.record,
  });

  // --- Message Delivery & Preview ---

  const promptDispatchRuntime =
    Runtime.createTelegramPromptDispatchRuntime<Pi.ExtensionContext>({
      lifecycle: bridgeRuntime.lifecycle,
      typing: bridgeRuntime.typing,
      getDefaultChatId: activeTurnRuntime.getChatId,
      sendTypingAction,
      updateStatus,
      recordRuntimeEvent: runtimeEvents.record,
    });

  // --- Reply Runtime Wiring ---

  const {
    replyTransport,
    sendTextReply,
    sendMarkdownReply,
    editInteractiveMessage,
    sendInteractiveMessage,
  } =
    Replies.createTelegramRenderedMessageDeliveryRuntime<Menu.TelegramReplyMarkup>(
      {
        sendMessage,
        editMessage: editTelegramMessageText,
      },
    );
  const dispatchNextQueuedTelegramTurn =
    Queue.createTelegramQueueDispatchRuntime<Pi.ExtensionContext>({
      ...telegramQueueStore,
      isCompactionInProgress: bridgeRuntime.lifecycle.isCompactionInProgress,
      hasActiveTurn: activeTurnRuntime.has,
      hasDispatchPending: bridgeRuntime.lifecycle.hasDispatchPending,
      isIdle: Pi.isExtensionContextIdle,
      hasPendingMessages: Pi.hasExtensionContextPendingMessages,
      updateStatus,
      sendTextReply,
      recordRuntimeEvent: runtimeEvents.record,
      ...promptDispatchRuntime,
      sendUserMessage: piRuntime.sendUserMessage,
    }).dispatchNext;
  const previewRuntime = Preview.createTelegramAssistantPreviewRuntime({
    getActiveTurn: activeTurnRuntime.get,
    isAssistantMessage: Replies.isAssistantAgentMessage,
    getMessageText: Replies.getAgentMessageText,
    getDefaultReplyToMessageId: activeTurnRuntime.getReplyToMessageId,
    sendDraft: sendMessageDraft,
    sendMessage,
    editMessageText: editTelegramMessageText,
    ...replyTransport,
  });

  // --- Bridge Setup ---

  const modelSwitchController =
    Model.createTelegramModelSwitchControllerRuntime<
      Pi.ExtensionContext,
      Model.ScopedTelegramModel<ActivePiModel>
    >({
      isIdle: Pi.isExtensionContextIdle,
      getPendingModelSwitch: pendingModelSwitchStore.get,
      setPendingModelSwitch: pendingModelSwitchStore.set,
      getActiveTurn: activeTurnRuntime.get,
      getAbortHandler: bridgeRuntime.abort.getHandler,
      hasAbortHandler: bridgeRuntime.abort.hasHandler,
      getActiveToolExecutions: bridgeRuntime.lifecycle.getActiveToolExecutions,
      allocateItemOrder: bridgeRuntime.queue.allocateItemOrder,
      allocateControlOrder: bridgeRuntime.queue.allocateControlOrder,
      appendQueuedItem: queueMutationRuntime.append,
      updateStatus,
    });
  const menuActions = Menu.createTelegramMenuActionRuntimeWithStateBuilder<
    ActivePiModel,
    Pi.ExtensionContext
  >({
    runtime: modelMenuRuntime,
    createSettingsManager: Pi.createSettingsManager,
    getActiveModel: currentModelRuntime.get,
    getThinkingLevel: piRuntime.getThinkingLevel,
    buildStatusHtml: Status.createTelegramStatusHtmlBuilder({
      getActiveModel: currentModelRuntime.get,
    }),
    storeModelMenuState: modelMenuRuntime.storeState,
    isIdle: Pi.isExtensionContextIdle,
    canOfferInFlightModelSwitch: modelSwitchController.canOfferInFlightSwitch,
    sendTextReply,
    editInteractiveMessage,
    sendInteractiveMessage,
  });

  // --- Polling ---

  const pollingRuntime = Polling.createTelegramPollingControllerRuntime<
    Api.TelegramUpdate,
    Pi.ExtensionContext
  >({
    state: pollingControllerState,
    getConfig: configStore.get,
    hasBotToken: configStore.hasBotToken,
    deleteWebhook,
    getUpdates,
    persistConfig: configStore.persist,
    handleUpdate: Updates.createTelegramPairedUpdateRuntime<
      Pi.ExtensionContext,
      Api.TelegramUpdate
    >({
      getAllowedUserId: configStore.getAllowedUserId,
      setAllowedUserId: configStore.setAllowedUserId,
      persistConfig: configStore.persist,
      updateStatus,
      removePendingMediaGroupMessages: mediaGroupRuntime.removeMessages,
      removeQueuedTelegramTurnsByMessageIds:
        queueMutationRuntime.removeByMessageIds,
      clearQueuedTelegramTurnPriorityByMessageId:
        queueMutationRuntime.clearPriorityByMessageId,
      prioritizeQueuedTelegramTurnByMessageId:
        queueMutationRuntime.prioritizeByMessageId,
      answerCallbackQuery,
      handleAuthorizedTelegramCallbackQuery:
        Menu.createTelegramMenuCallbackHandlerForContext<
          Api.TelegramCallbackQuery,
          Pi.ExtensionContext,
          ActivePiModel
        >({
          getStoredModelMenuState: modelMenuRuntime.getState,
          getActiveModel: currentModelRuntime.get,
          getThinkingLevel: piRuntime.getThinkingLevel,
          setThinkingLevel: piRuntime.setThinkingLevel,
          updateStatus,
          updateModelMenuMessage: menuActions.updateModelMenuMessage,
          updateThinkingMenuMessage: menuActions.updateThinkingMenuMessage,
          updateStatusMessage: menuActions.updateStatusMessage,
          answerCallbackQuery,
          isIdle: Pi.isExtensionContextIdle,
          hasActiveTelegramTurn: activeTurnRuntime.has,
          hasAbortHandler: bridgeRuntime.abort.hasHandler,
          getActiveToolExecutions:
            bridgeRuntime.lifecycle.getActiveToolExecutions,
          setModel: piRuntime.setModel,
          setCurrentModel: currentModelRuntime.setCurrentModel,
          stagePendingModelSwitch: modelSwitchController.stagePendingSwitch,
          restartInterruptedTelegramTurn:
            modelSwitchController.restartInterruptedTurn,
        }),
      sendTextReply,
      handleAuthorizedTelegramMessage:
        Media.createTelegramMediaGroupDispatchRuntime<
          Api.TelegramMessage,
          Pi.ExtensionContext
        >({
          mediaGroups: mediaGroupRuntime,
          dispatchMessages: Commands.createTelegramCommandOrPromptRuntime<
            Api.TelegramMessage,
            Pi.ExtensionContext
          >({
            extractRawText: Media.extractFirstTelegramMessageText,
            handleCommand: Commands.createTelegramCommandHandlerTargetRuntime<
              Api.TelegramMessage,
              Pi.ExtensionContext
            >({
              hasAbortHandler: bridgeRuntime.abort.hasHandler,
              clearPendingModelSwitch: modelSwitchController.clearPendingSwitch,
              hasQueuedTelegramItems: telegramQueueStore.hasQueuedItems,
              setPreserveQueuedTurnsAsHistory:
                bridgeRuntime.lifecycle.setPreserveQueuedTurnsAsHistory,
              abortCurrentTurn: bridgeRuntime.abort.abortTurn,
              isIdle: Pi.isExtensionContextIdle,
              hasPendingMessages: Pi.hasExtensionContextPendingMessages,
              hasActiveTelegramTurn: activeTurnRuntime.has,
              hasDispatchPending: bridgeRuntime.lifecycle.hasDispatchPending,
              isCompactionInProgress:
                bridgeRuntime.lifecycle.isCompactionInProgress,
              setCompactionInProgress:
                bridgeRuntime.lifecycle.setCompactionInProgress,
              updateStatus,
              dispatchNextQueuedTelegramTurn,
              compact: Pi.compactExtensionContext,
              allocateItemOrder: bridgeRuntime.queue.allocateItemOrder,
              allocateControlOrder: bridgeRuntime.queue.allocateControlOrder,
              appendControlItem: queueMutationRuntime.append,
              showStatus: menuActions.sendStatusMessage,
              openModelMenu: menuActions.openModelMenu,
              getAllowedUserId: configStore.getAllowedUserId,
              setAllowedUserId: configStore.setAllowedUserId,
              setMyCommands,
              persistConfig: configStore.persist,
              sendTextReply,
              recordRuntimeEvent: runtimeEvents.record,
            }),
            enqueueTurn: Queue.createTelegramPromptEnqueueController<
              Api.TelegramMessage,
              Pi.ExtensionContext
            >({
              ...telegramQueueStore,
              getPreserveQueuedTurnsAsHistory:
                bridgeRuntime.lifecycle.shouldPreserveQueuedTurnsAsHistory,
              setPreserveQueuedTurnsAsHistory:
                bridgeRuntime.lifecycle.setPreserveQueuedTurnsAsHistory,
              createTurn:
                Turns.createTelegramPromptTurnRuntimeBuilder<Api.TelegramMessage>(
                  {
                    allocateQueueOrder: bridgeRuntime.queue.allocateItemOrder,
                    downloadFile: downloadTelegramBridgeFile,
                  },
                ),
              updateStatus,
              dispatchNextQueuedTelegramTurn,
            }).enqueue,
          }).dispatchMessages,
        }).handleMessage,
      handleAuthorizedTelegramEditedMessage:
        Turns.createTelegramQueuedPromptEditRuntime<
          Api.TelegramMessage,
          Pi.ExtensionContext
        >({
          ...telegramQueueStore,
          updateStatus,
        }).updateFromEditedMessage,
    }).handleUpdate,
    stopTypingLoop: bridgeRuntime.typing.stop,
    updateStatus,
    recordRuntimeEvent: runtimeEvents.record,
  });

  // --- Extension Registration ---

  Registration.registerTelegramAttachmentTool(pi, {
    getActiveTurn: activeTurnRuntime.get,
    recordRuntimeEvent: runtimeEvents.record,
  });

  Registration.registerTelegramCommands(pi, {
    promptForConfig: Setup.createTelegramSetupPromptRuntime({
      getConfig: configStore.get,
      setConfig: configStore.set,
      setupGuard: bridgeRuntime.setup,
      getMe: Api.fetchTelegramBotIdentity,
      persistConfig: configStore.persist,
      startPolling: pollingRuntime.start,
      updateStatus,
      recordRuntimeEvent: runtimeEvents.record,
    }),
    getStatusLines,
    reloadConfig: configStore.load,
    hasBotToken: configStore.hasBotToken,
    startPolling: pollingRuntime.start,
    stopPolling: pollingRuntime.stop,
    updateStatus,
  });

  // --- Lifecycle Hooks ---

  Registration.registerTelegramLifecycleHooks(pi, {
    ...Queue.createTelegramSessionLifecycleRuntime<
      Pi.ExtensionContext,
      RuntimeTelegramQueueItem,
      ActivePiModel
    >({
      getCurrentModel: Pi.getExtensionContextModel,
      loadConfig: configStore.load,
      setQueuedItems: telegramQueueStore.setQueuedItems,
      setCurrentModel: currentModelRuntime.set,
      setPendingModelSwitch: pendingModelSwitchStore.set,
      syncCounters: bridgeRuntime.queue.syncCounters,
      syncFlags: bridgeRuntime.lifecycle.syncFlags,
      prepareTempDir,
      updateStatus,
      clearPendingMediaGroups: mediaGroupRuntime.clear,
      clearModelMenuState: modelMenuRuntime.clear,
      getActiveTurnChatId: activeTurnRuntime.getChatId,
      clearPreview: previewRuntime.clear,
      clearActiveTurn: activeTurnRuntime.clear,
      clearAbort: bridgeRuntime.abort.clearHandler,
      stopPolling: pollingRuntime.stop,
      recordRuntimeEvent: runtimeEvents.record,
    }),
    onBeforeAgentStart: Registration.createTelegramBeforeAgentStartHook(),
    onModelSelect: currentModelRuntime.onModelSelect,
    ...Queue.createTelegramAgentLifecycleHooks<
      Queue.PendingTelegramTurn,
      Pi.ExtensionContext,
      unknown
    >({
      setAbortHandler: Runtime.createTelegramContextAbortHandlerSetter(
        bridgeRuntime.abort,
      ),
      getQueuedItems: telegramQueueStore.getQueuedItems,
      hasPendingDispatch: bridgeRuntime.lifecycle.hasDispatchPending,
      hasActiveTurn: activeTurnRuntime.has,
      resetToolExecutions: bridgeRuntime.lifecycle.resetActiveToolExecutions,
      resetPendingModelSwitch: modelSwitchController.clearPendingSwitch,
      setQueuedItems: telegramQueueStore.setQueuedItems,
      clearDispatchPending: bridgeRuntime.lifecycle.clearDispatchPending,
      setActiveTurn: activeTurnRuntime.set,
      createPreviewState: previewRuntime.resetState,
      startTypingLoop: promptDispatchRuntime.startTypingLoop,
      updateStatus,
      getActiveTurn: activeTurnRuntime.get,
      extractAssistant: Replies.extractLatestAssistantMessageText,
      getPreserveQueuedTurnsAsHistory:
        bridgeRuntime.lifecycle.shouldPreserveQueuedTurnsAsHistory,
      resetRuntimeState: Runtime.createTelegramAgentEndResetter({
        abort: bridgeRuntime.abort,
        typing: bridgeRuntime.typing,
        clearActiveTurn: activeTurnRuntime.clear,
        resetToolExecutions: bridgeRuntime.lifecycle.resetActiveToolExecutions,
        clearPendingModelSwitch: modelSwitchController.clearPendingSwitch,
        clearDispatchPending: bridgeRuntime.lifecycle.clearDispatchPending,
      }),
      dispatchNextQueuedTelegramTurn,
      clearPreview: previewRuntime.clear,
      setPreviewPendingText: previewRuntime.setPendingText,
      finalizeMarkdownPreview: previewRuntime.finalizeMarkdown,
      sendMarkdownReply,
      sendTextReply,
      sendQueuedAttachments: Attachments.createTelegramQueuedAttachmentSender({
        sendMultipart: callMultipart,
        sendTextReply,
        recordRuntimeEvent: runtimeEvents.record,
      }),
      getActiveToolExecutions: bridgeRuntime.lifecycle.getActiveToolExecutions,
      setActiveToolExecutions: bridgeRuntime.lifecycle.setActiveToolExecutions,
      triggerPendingModelSwitchAbort: modelSwitchController.triggerPendingAbort,
    }),
    onMessageStart: previewRuntime.onMessageStart,
    onMessageUpdate: previewRuntime.onMessageUpdate,
  });
}
