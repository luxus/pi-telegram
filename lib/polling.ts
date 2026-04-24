/**
 * Telegram polling domain helpers
 * Owns polling request builders, stop conditions, and the long-poll loop runtime for Telegram updates
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

import type { TelegramConfig } from "./api.ts";

export interface TelegramUpdateLike {
  update_id: number;
}

// Standard Telegram DM polling does not expose ordinary message-deletion events,
// so queue removal stays reaction-driven while delete-like business updates remain defensive-only.
export const TELEGRAM_ALLOWED_UPDATES = [
  "message",
  "edited_message",
  "callback_query",
  "message_reaction",
] as const;

export function buildTelegramInitialSyncRequest(): {
  offset: number;
  limit: number;
  timeout: number;
} {
  return {
    offset: -1,
    limit: 1,
    timeout: 0,
  };
}

export function buildTelegramLongPollRequest(lastUpdateId?: number): {
  offset?: number;
  limit: number;
  timeout: number;
  allowed_updates: readonly string[];
} {
  return {
    offset: lastUpdateId !== undefined ? lastUpdateId + 1 : undefined,
    limit: 10,
    timeout: 30,
    allowed_updates: TELEGRAM_ALLOWED_UPDATES,
  };
}

export function getLatestTelegramUpdateId(
  updates: TelegramUpdateLike[],
): number | undefined {
  return updates.at(-1)?.update_id;
}

export function shouldStopTelegramPolling(
  signalAborted: boolean,
  error: unknown,
): boolean {
  return (
    signalAborted ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}

export interface TelegramPollLoopDeps<TUpdate extends TelegramUpdateLike> {
  ctx: ExtensionContext;
  signal: AbortSignal;
  config: TelegramConfig;
  deleteWebhook: (signal: AbortSignal) => Promise<void>;
  getUpdates: (
    body: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<TUpdate[]>;
  persistConfig: () => Promise<void>;
  handleUpdate: (update: TUpdate, ctx: ExtensionContext) => Promise<void>;
  onErrorStatus: (message: string) => void;
  onStatusReset: () => void;
  sleep: (ms: number) => Promise<void>;
  maxUpdateFailures?: number;
}

function getTelegramPollingErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runTelegramPollLoop<TUpdate extends TelegramUpdateLike>(
  deps: TelegramPollLoopDeps<TUpdate>,
): Promise<void> {
  if (!deps.config.botToken) return;
  try {
    await deps.deleteWebhook(deps.signal);
  } catch {
    // ignore
  }
  if (deps.config.lastUpdateId === undefined) {
    try {
      const updates = await deps.getUpdates(
        buildTelegramInitialSyncRequest(),
        deps.signal,
      );
      const lastUpdateId = getLatestTelegramUpdateId(updates);
      if (lastUpdateId !== undefined) {
        deps.config.lastUpdateId = lastUpdateId;
        await deps.persistConfig();
      }
    } catch {
      // ignore
    }
  }
  const maxUpdateFailures = Math.max(1, deps.maxUpdateFailures ?? 3);
  const updateFailures = new Map<number, number>();
  while (!deps.signal.aborted) {
    try {
      const updates = await deps.getUpdates(
        buildTelegramLongPollRequest(deps.config.lastUpdateId),
        deps.signal,
      );
      for (const update of updates) {
        try {
          await deps.handleUpdate(update, deps.ctx);
          deps.config.lastUpdateId = update.update_id;
          updateFailures.delete(update.update_id);
          await deps.persistConfig();
        } catch (error) {
          const failureCount = (updateFailures.get(update.update_id) ?? 0) + 1;
          updateFailures.set(update.update_id, failureCount);
          if (failureCount < maxUpdateFailures) throw error;
          const message = getTelegramPollingErrorMessage(error);
          deps.onErrorStatus(
            `skipping Telegram update ${update.update_id} after ${failureCount} failures: ${message}`,
          );
          deps.config.lastUpdateId = update.update_id;
          updateFailures.delete(update.update_id);
          await deps.persistConfig();
        }
      }
    } catch (error) {
      if (shouldStopTelegramPolling(deps.signal.aborted, error)) return;
      deps.onErrorStatus(getTelegramPollingErrorMessage(error));
      await deps.sleep(3000);
      deps.onStatusReset();
    }
  }
}
