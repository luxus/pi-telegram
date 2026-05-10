/**
 * Telegram bridge preference and prompt guidance bus
 * Zones: shared utils, extension interop
 * Lets layered extensions inject boolean preferences into the Telegram settings menu
 * and conditional prompt guidance into the before-agent-start hook.
 *
 * Uses the same globalThis registry pattern as external-handlers.ts.
 */

export interface TelegramPreferenceEntry {
  /** Human-readable label shown in the settings menu. */
  label: string;
  /** Read current value. */
  get: () => boolean;
  /** Write new value. */
  set: (enabled: boolean) => Promise<void>;
}

export interface TelegramPreferenceRegistry {
  readonly version: 1;
  add(
    category: string,
    key: string,
    entry: TelegramPreferenceEntry,
  ): () => void;
  list(): Array<{
    category: string;
    key: string;
    label: string;
    get: () => boolean;
    set: (enabled: boolean) => Promise<void>;
  }>;
}

export interface TelegramPromptGuidanceEntry {
  /** Return true when the guidance text should be injected. */
  condition: () => boolean;
  /** Guidance text appended to the system prompt. */
  text: string;
}

export interface TelegramPromptGuidanceRegistry {
  readonly version: 1;
  add(id: string, entry: TelegramPromptGuidanceEntry): () => void;
  evaluate(): string[];
}

const PREF_KEY = "__piTelegramPreferences__";
const GUIDANCE_KEY = "__piTelegramPromptGuidance__";

function isValidPreferenceRegistry(
  candidate: unknown,
): candidate is TelegramPreferenceRegistry {
  if (!candidate || typeof candidate !== "object") return false;
  const r = candidate as Partial<TelegramPreferenceRegistry>;
  return (
    r.version === 1 &&
    typeof r.add === "function" &&
    typeof r.list === "function"
  );
}

function isValidGuidanceRegistry(
  candidate: unknown,
): candidate is TelegramPromptGuidanceRegistry {
  if (!candidate || typeof candidate !== "object") return false;
  const r = candidate as Partial<TelegramPromptGuidanceRegistry>;
  return (
    r.version === 1 &&
    typeof r.add === "function" &&
    typeof r.evaluate === "function"
  );
}

function getOrCreatePreferenceRegistry(): TelegramPreferenceRegistry {
  const g = globalThis as Record<string, unknown>;
  const existing = g[PREF_KEY];
  if (isValidPreferenceRegistry(existing)) return existing;

  const entries = new Map<string, TelegramPreferenceEntry>();
  const registry: TelegramPreferenceRegistry = {
    version: 1,
    add(category, key, entry) {
      const fullKey = `${category}:${key}`;
      entries.set(fullKey, entry);
      return () => entries.delete(fullKey);
    },
    list() {
      return [...entries.entries()].map(([fullKey, entry]) => {
        const [category, key] = fullKey.split(":") as [string, string];
        return { category, key, label: entry.label, get: entry.get, set: entry.set };
      });
    },
  };
  g[PREF_KEY] = registry;
  return registry;
}

function getOrCreateGuidanceRegistry(): TelegramPromptGuidanceRegistry {
  const g = globalThis as Record<string, unknown>;
  const existing = g[GUIDANCE_KEY];
  if (isValidGuidanceRegistry(existing)) return existing;

  const entries = new Map<string, TelegramPromptGuidanceEntry>();
  const registry: TelegramPromptGuidanceRegistry = {
    version: 1,
    add(id, entry) {
      entries.set(id, entry);
      return () => entries.delete(id);
    },
    evaluate() {
      const result: string[] = [];
      for (const entry of entries.values()) {
        try {
          if (entry.condition()) result.push(entry.text);
        } catch {
          // Skip entries whose condition throws.
        }
      }
      return result;
    },
  };
  g[GUIDANCE_KEY] = registry;
  return registry;
}

export function getTelegramPreferenceRegistry(): TelegramPreferenceRegistry {
  return getOrCreatePreferenceRegistry();
}

export function getTelegramPromptGuidanceRegistry(): TelegramPromptGuidanceRegistry {
  return getOrCreateGuidanceRegistry();
}

export function registerTelegramPreference(
  category: string,
  key: string,
  entry: TelegramPreferenceEntry,
): () => void {
  return getOrCreatePreferenceRegistry().add(category, key, entry);
}

export function registerTelegramPromptGuidance(
  id: string,
  entry: TelegramPromptGuidanceEntry,
): () => void {
  return getOrCreateGuidanceRegistry().add(id, entry);
}
