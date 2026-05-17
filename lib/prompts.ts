/**
 * Telegram prompt injection helpers
 * Zones: pi agent prompts, telegram guidance
 * Owns Telegram-specific system prompt suffixes injected into pi agent turns
 */

import type { BeforeAgentStartEvent } from "./pi.ts";
import { TELEGRAM_PREFIX } from "./turns.ts";

const SYSTEM_PROMPT_SUFFIX = `

Telegram bridge extension is active.

Inbound context:
- \`[telegram]\` marks Telegram-originated messages. Suffixes \`|from:user\` (sender) and \`|guest:group\` (guest mode — message from another chat where the bot is not a member) may be present; the bot sees the message as if forwarded from that user/chat.
- \`[reply]\` is quoted context from the replied-to message, not a new instruction by itself. Suffix \`|from:user\` identifies the original author in guest-mode replies. Use it to resolve references like "this", "it", or "that message"; the actual instruction is before [reply] unless it explicitly asks to act on the quote.
- \`[attachments]\` gives a base directory plus relative local files; resolve and read them as needed. \`[outputs]\` contains inbound-handler stdout such as transcriptions or extracted text for those attachments.
- \`[time]\` gives the wall-clock time for this Telegram turn when the operator enabled time injection. Use it for relative-date requests like "today", "now", or scheduling; otherwise do not mention it.
- \`[voice]\` describes Telegram voice reply policy for this turn. \`manual\` means answer normally and use explicit \`telegram_voice\` markup only when a spoken reply is useful; \`mirror\` means voice input prefers a voice reply; \`always\` means the final reply is expected to be converted to voice, so keep it TTS-friendly.
- Unknown \`[callback] ...\` messages may be intended for another extension; if you see one, say the callback was not handled and the environment may be misconfigured.

Telegram-visible output:
- Telegram is often phone-width; keep tables, dense list items, and compact text blocks at or below 37 visible cells when possible.
- Count display width, not raw characters: emoji and some glyphs are wide, so prefer shorter labels when unsure.
- Wide monospace blocks can become unreadable on mobile; use them only when structure or literal code requires them.
- For requested/generated files, call tool \`telegram_attach(local_path)\`; mentioning a local path in text does not send it.

Native outbound actions:
- Use top-level column-zero hidden Markdown comments outside code, quotes, and lists; the bridge handles them after agent_end, so do not call or register transport/TTS/text-to-OGG tools.
- \`telegram_voice\`: text is synthesized by the registered voice synthesis provider and delivered by pi-telegram. Use body text for multiline voice, \`<!-- telegram_voice text="Short summary" -->\` for explicit one-line voice, or \`<!-- telegram_voice: Short summary -->\` for one-line voice with no attributes. A companion summary is optional, no specific summary format is required. Keep it TTS-friendly; avoid raw Markdown, code, formulas, tables, or long lists.
- \`telegram_button\`: callback prompt is routed back as a normal Telegram turn. Use \`<!-- telegram_button: OK -->\` when prompt equals label, \`<!-- telegram_button label=Continue prompt="Continue with the current plan." -->\` for one-line prompts, or body form \`<!-- telegram_button label="Show risks"\nList the main risks first.\n-->\` for multiline prompts.
- If only hidden action comments would remain, add visible parent text like "Choose one:".
`;

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

export interface TelegramProactivePromptHookDeps<TContext> {
  baseHook?: (event: BeforeAgentStartEvent) => { systemPrompt: string };
  isProactivePushEnabled: () => boolean;
  isCurrentOwner: (ctx: TContext) => boolean;
}

export function createTelegramProactiveBeforeAgentStartHook<TContext>(
  deps: TelegramProactivePromptHookDeps<TContext>,
): (
  event: BeforeAgentStartEvent,
  ctx: TContext,
) => Promise<{ systemPrompt: string }> {
  const baseHook = deps.baseHook ?? createTelegramBeforeAgentStartHook();
  return async function onBeforeAgentStart(event, ctx) {
    const result = baseHook(event);
    if (!deps.isProactivePushEnabled()) return result;
    if (!deps.isCurrentOwner(ctx)) return result;
    return result;
  };
}
