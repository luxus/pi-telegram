/**
 * Telegram preview and markdown rendering helpers
 * Converts assistant output into Telegram-safe plain text and HTML chunks with chunk-boundary handling
 */

export const MAX_MESSAGE_LENGTH = 4096;

// --- Escaping ---

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// --- Plain Preview Rendering ---

function splitPlainMarkdownLine(line: string, maxLength = 1500): string[] {
  if (line.length <= maxLength) return [line];
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [line];
  const parts: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }
    if (current.length > 0) {
      parts.push(current);
      current = "";
    }
    if (word.length <= maxLength) {
      current = word;
      continue;
    }
    for (let i = 0; i < word.length; i += maxLength) {
      parts.push(word.slice(i, i + maxLength));
    }
  }
  if (current.length > 0) {
    parts.push(current);
  }
  return parts.length > 0 ? parts : [line];
}

interface ParsedMarkdownInlineLink {
  startIndex: number;
  endIndex: number;
  label: string;
  destination: string;
  isImage: boolean;
}

interface ParsedMarkdownAutolink {
  startIndex: number;
  endIndex: number;
  destination: string;
}

function isEscapedMarkdownCharacter(text: string, index: number): boolean {
  let backslashCount = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) {
    backslashCount += 1;
  }
  return backslashCount % 2 === 1;
}

function findMarkdownClosingBracket(
  text: string,
  startIndex: number,
): number | undefined {
  let depth = 0;
  for (let index = startIndex; index < text.length; index += 1) {
    if (isEscapedMarkdownCharacter(text, index)) continue;
    const char = text[index] ?? "";
    if (char === "[") {
      depth += 1;
      continue;
    }
    if (char !== "]") continue;
    depth -= 1;
    if (depth === 0) return index;
  }
  return undefined;
}

function parseMarkdownLinkTarget(
  text: string,
  openParenIndex: number,
): { destination: string; endIndex: number } | undefined {
  let index = openParenIndex + 1;
  while (index < text.length && /\s/.test(text[index] ?? "")) {
    index += 1;
  }
  if (index >= text.length) return undefined;
  let destination = "";
  if (text[index] === "<") {
    const destinationStart = index + 1;
    index += 1;
    while (index < text.length) {
      if (!isEscapedMarkdownCharacter(text, index) && text[index] === ">") {
        break;
      }
      index += 1;
    }
    if (index >= text.length) return undefined;
    destination = text.slice(destinationStart, index).trim();
    index += 1;
  } else {
    const destinationStart = index;
    let parenDepth = 0;
    while (index < text.length) {
      if (isEscapedMarkdownCharacter(text, index)) {
        index += 1;
        continue;
      }
      const char = text[index] ?? "";
      if (/\s/.test(char) && parenDepth === 0) break;
      if (char === "(") {
        parenDepth += 1;
        index += 1;
        continue;
      }
      if (char === ")") {
        if (parenDepth === 0) break;
        parenDepth -= 1;
        index += 1;
        continue;
      }
      index += 1;
    }
    destination = text.slice(destinationStart, index).trim();
  }
  if (!destination) return undefined;
  while (index < text.length && /\s/.test(text[index] ?? "")) {
    index += 1;
  }
  if (
    index < text.length &&
    (text[index] === '"' || text[index] === "'" || text[index] === "(")
  ) {
    const titleDelimiter = text[index] ?? '"';
    const closingTitleDelimiter = titleDelimiter === "(" ? ")" : titleDelimiter;
    index += 1;
    while (index < text.length) {
      if (
        !isEscapedMarkdownCharacter(text, index) &&
        text[index] === closingTitleDelimiter
      ) {
        break;
      }
      index += 1;
    }
    if (index >= text.length) return undefined;
    index += 1;
    while (index < text.length && /\s/.test(text[index] ?? "")) {
      index += 1;
    }
  }
  if (text[index] !== ")") return undefined;
  return { destination, endIndex: index };
}

function isSupportedMarkdownLinkDestination(destination: string): boolean {
  return /^(?:https?:\/\/|mailto:)/i.test(destination.trim());
}

function parseMarkdownInlineLinkAt(
  text: string,
  index: number,
): ParsedMarkdownInlineLink | undefined {
  const isImage = text[index] === "!" && text[index + 1] === "[";
  const labelStartIndex = isImage ? index + 1 : index;
  if (text[labelStartIndex] !== "[") return undefined;
  if (
    isEscapedMarkdownCharacter(text, labelStartIndex) ||
    (isImage && isEscapedMarkdownCharacter(text, index))
  ) {
    return undefined;
  }
  const labelEndIndex = findMarkdownClosingBracket(text, labelStartIndex);
  if (labelEndIndex === undefined || text[labelEndIndex + 1] !== "(") {
    return undefined;
  }
  const target = parseMarkdownLinkTarget(text, labelEndIndex + 1);
  if (!target) return undefined;
  return {
    startIndex: index,
    endIndex: target.endIndex,
    label: text.slice(labelStartIndex + 1, labelEndIndex),
    destination: target.destination,
    isImage,
  };
}

function parseMarkdownAutolinkAt(
  text: string,
  index: number,
): ParsedMarkdownAutolink | undefined {
  if (text[index] !== "<" || isEscapedMarkdownCharacter(text, index)) {
    return undefined;
  }
  let endIndex = index + 1;
  while (endIndex < text.length) {
    if (!isEscapedMarkdownCharacter(text, endIndex) && text[endIndex] === ">") {
      break;
    }
    endIndex += 1;
  }
  if (endIndex >= text.length) return undefined;
  const destination = text.slice(index + 1, endIndex).trim();
  if (!isSupportedMarkdownLinkDestination(destination)) {
    return undefined;
  }
  return { startIndex: index, endIndex, destination };
}

function replaceMarkdownLinkLike(
  text: string,
  options: {
    renderInlineLink: (
      link: ParsedMarkdownInlineLink,
      supported: boolean,
    ) => string;
    renderAutolink: (link: ParsedMarkdownAutolink) => string;
  },
): string {
  let result = "";
  for (let index = 0; index < text.length; ) {
    const inlineLink = parseMarkdownInlineLinkAt(text, index);
    if (inlineLink) {
      result += options.renderInlineLink(
        inlineLink,
        isSupportedMarkdownLinkDestination(inlineLink.destination),
      );
      index = inlineLink.endIndex + 1;
      continue;
    }
    const autolink = parseMarkdownAutolinkAt(text, index);
    if (autolink) {
      result += options.renderAutolink(autolink);
      index = autolink.endIndex + 1;
      continue;
    }
    result += text[index] ?? "";
    index += 1;
  }
  return result;
}

function stripInlineMarkdownToPlainText(text: string): string {
  let result = replaceMarkdownLinkLike(text, {
    renderInlineLink: (link, supported) => {
      const plainLabel = stripInlineMarkdownToPlainText(link.label).trim();
      if (plainLabel.length > 0) return plainLabel;
      return supported ? link.destination : "";
    },
    renderAutolink: (link) => link.destination,
  });
  result = result.replace(/`([^`\n]+)`/g, "$1");
  result = result.replace(/(\*\*\*|___)(.+?)\1/g, "$2");
  result = result.replace(/(\*\*|__)(.+?)\1/g, "$2");
  result = result.replace(/(\*|_)(.+?)\1/g, "$2");
  result = result.replace(/~~(.+?)~~/g, "$1");
  result = result.replace(/\\([\\`*_{}\[\]()#+\-.!>~|])/g, "$1");
  return result;
}

function isMarkdownTableSeparator(line: string): boolean {
  return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line);
}

function parseMarkdownFence(
  line: string,
): { marker: "`" | "~"; length: number; info?: string } | undefined {
  const match = line.match(/^\s*([`~]{3,})(.*)$/);
  if (!match) return undefined;
  const fence = match[1] ?? "";
  const marker = fence[0];
  if ((marker !== "`" && marker !== "~") || /[^`~]/.test(fence)) {
    return undefined;
  }
  if (!fence.split("").every((char) => char === marker)) return undefined;
  return {
    marker,
    length: fence.length,
    info: (match[2] ?? "").trim() || undefined,
  };
}

function isFencedCodeStart(line: string): boolean {
  return parseMarkdownFence(line) !== undefined;
}

function isMatchingMarkdownFence(
  line: string,
  fence: { marker: "`" | "~"; length: number },
): boolean {
  const match = line.match(/^\s*([`~]{3,})\s*$/);
  if (!match) return false;
  const candidate = match[1] ?? "";
  return (
    candidate.length >= fence.length &&
    candidate[0] === fence.marker &&
    candidate.split("").every((char) => char === fence.marker)
  );
}

function isIndentedCodeLine(line: string): boolean {
  return /^(?:\t| {4,})/.test(line);
}

function isIndentedMarkdownStructureLine(line: string): boolean {
  const trimmed = line.trimStart();
  return (
    /^(?:[-*+]|\d+\.)\s+\[([ xX])\]\s+/.test(trimmed) ||
    /^(?:[-*+]|\d+\.)\s+/.test(trimmed) ||
    /^>\s?/.test(trimmed) ||
    /^#{1,6}\s+/.test(trimmed) ||
    parseMarkdownFence(trimmed) !== undefined
  );
}

function canStartIndentedCodeBlock(lines: string[], index: number): boolean {
  const line = lines[index] ?? "";
  if (!isIndentedCodeLine(line)) return false;
  if (isIndentedMarkdownStructureLine(line)) return false;
  if (index === 0) return true;
  return (lines[index - 1] ?? "").trim().length === 0;
}

function stripIndentedCodePrefix(line: string): string {
  if (line.startsWith("\t")) return line.slice(1);
  if (line.startsWith("    ")) return line.slice(4);
  return line;
}

function normalizeMarkdownDocument(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let start = 0;
  while (start < lines.length && (lines[start] ?? "").trim().length === 0) {
    start += 1;
  }
  let end = lines.length;
  while (end > start && (lines[end - 1] ?? "").trim().length === 0) {
    end -= 1;
  }
  return lines.slice(start, end).join("\n");
}

function isMarkdownNumberedListMarker(marker: string): boolean {
  return /^\d+\.$/.test(marker);
}

function matchMarkdownHeadingLine(line: string): RegExpMatchArray | null {
  return line.match(/^(\s*)#{1,6}\s+(.+)$/);
}

function endsWithMarkdownHeadingLine(markdown: string): boolean {
  const lines = markdown.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? "";
    if (line.trim().length === 0) continue;
    return matchMarkdownHeadingLine(line) !== null;
  }
  return false;
}

function splitLeadingMarkdownBlankLines(markdown: string): {
  blankLines: number;
  remainingText: string;
} {
  const lines = markdown.split("\n");
  let start = 0;
  while (start < lines.length && (lines[start] ?? "").trim().length === 0) {
    start += 1;
  }
  return {
    blankLines: start,
    remainingText: lines.slice(start).join("\n"),
  };
}

export type TelegramPreviewRenderStrategy = "plain" | "rich-stable-blocks";

export interface TelegramPreviewSnapshotStateLike {
  pendingText: string;
  lastSentText: string;
  lastSentParseMode?: "HTML";
  lastSentStrategy?: TelegramPreviewRenderStrategy;
}

export interface TelegramPreviewSnapshot extends TelegramRenderedChunk {
  sourceText: string;
  strategy: TelegramPreviewRenderStrategy;
}

export function buildTelegramPreviewFlushText(options: {
  state: TelegramPreviewSnapshotStateLike;
  maxMessageLength: number;
  renderPreviewText: (markdown: string) => string;
}): string | undefined {
  const rawText = options.state.pendingText.trim();
  const previewText = options.renderPreviewText(rawText).trim();
  if (!previewText || previewText === options.state.lastSentText) {
    return undefined;
  }
  return previewText.length > options.maxMessageLength
    ? previewText.slice(0, options.maxMessageLength)
    : previewText;
}

function buildTelegramPlainPreviewSnapshot(options: {
  sourceText: string;
  state: TelegramPreviewSnapshotStateLike;
  maxMessageLength: number;
  renderPreviewText: (markdown: string) => string;
}): TelegramPreviewSnapshot | undefined {
  const previewText = options.renderPreviewText(options.sourceText).trim();
  if (!previewText) return undefined;
  const truncatedPreviewText =
    previewText.length > options.maxMessageLength
      ? previewText.slice(0, options.maxMessageLength)
      : previewText;
  if (
    truncatedPreviewText === options.state.lastSentText &&
    options.state.lastSentStrategy === "plain"
  ) {
    return undefined;
  }
  return {
    text: truncatedPreviewText,
    sourceText: options.sourceText,
    strategy: "plain",
  };
}

interface TelegramStablePreviewSplit {
  stableMarkdown: string;
  unstableTail: string;
}

function splitTelegramStablePreviewMarkdown(
  markdown: string,
): TelegramStablePreviewSplit {
  const normalized = normalizeMarkdownDocument(markdown);
  if (normalized.length === 0) {
    return { stableMarkdown: "", unstableTail: "" };
  }
  const lines = normalized.split("\n");
  let index = 0;
  let stableEndIndex = 0;
  while (index < lines.length) {
    while (index < lines.length && (lines[index] ?? "").trim().length === 0) {
      index += 1;
    }
    if (index >= lines.length) break;
    const blockStart = index;
    const line = lines[index] ?? "";
    const nextLine = lines[index + 1] ?? "";
    const fence = parseMarkdownFence(line);
    if (fence) {
      index += 1;
      while (
        index < lines.length &&
        !isMatchingMarkdownFence(lines[index] ?? "", fence)
      ) {
        index += 1;
      }
      if (index >= lines.length) {
        return {
          stableMarkdown: lines.slice(0, stableEndIndex).join("\n"),
          unstableTail: lines.slice(stableEndIndex).join("\n"),
        };
      }
      index += 1;
      stableEndIndex = index;
      continue;
    }
    if (line.includes("|") && isMarkdownTableSeparator(nextLine)) {
      index += 2;
      while (index < lines.length) {
        const tableLine = lines[index] ?? "";
        if (tableLine.trim().length === 0 || !tableLine.includes("|")) {
          break;
        }
        index += 1;
      }
      if (index >= lines.length) {
        return {
          stableMarkdown: lines.slice(0, stableEndIndex).join("\n"),
          unstableTail: lines.slice(stableEndIndex).join("\n"),
        };
      }
      stableEndIndex = index;
      continue;
    }
    if (canStartIndentedCodeBlock(lines, index)) {
      while (index < lines.length) {
        const rawLine = lines[index] ?? "";
        if (rawLine.trim().length === 0) {
          index += 1;
          continue;
        }
        if (!isIndentedCodeLine(rawLine)) break;
        index += 1;
      }
      if (index >= lines.length) {
        return {
          stableMarkdown: lines.slice(0, stableEndIndex).join("\n"),
          unstableTail: lines.slice(stableEndIndex).join("\n"),
        };
      }
      stableEndIndex = index;
      continue;
    }
    if (/^\s*>/.test(line)) {
      while (index < lines.length && /^\s*>/.test(lines[index] ?? "")) {
        index += 1;
      }
      if (index >= lines.length) {
        return {
          stableMarkdown: lines.slice(0, stableEndIndex).join("\n"),
          unstableTail: lines.slice(stableEndIndex).join("\n"),
        };
      }
      stableEndIndex = index;
      continue;
    }
    while (index < lines.length) {
      const current = lines[index] ?? "";
      const following = lines[index + 1] ?? "";
      if (current.trim().length === 0) break;
      if (
        index !== blockStart &&
        (isFencedCodeStart(current) ||
          canStartIndentedCodeBlock(lines, index) ||
          /^\s*>/.test(current) ||
          (current.includes("|") && isMarkdownTableSeparator(following)))
      ) {
        break;
      }
      index += 1;
    }
    if (index >= lines.length) {
      return {
        stableMarkdown: lines.slice(0, stableEndIndex).join("\n"),
        unstableTail: lines.slice(stableEndIndex).join("\n"),
      };
    }
    stableEndIndex = index;
  }
  return {
    stableMarkdown: lines.slice(0, stableEndIndex).join("\n"),
    unstableTail: lines.slice(stableEndIndex).join("\n"),
  };
}

export function buildTelegramPreviewSnapshot(options: {
  state: TelegramPreviewSnapshotStateLike;
  maxMessageLength: number;
  renderPreviewText: (markdown: string) => string;
  renderTelegramMessage: (
    text: string,
    options?: { mode?: TelegramRenderMode },
  ) => TelegramRenderedChunk[];
}): TelegramPreviewSnapshot | undefined {
  const sourceText = options.state.pendingText.trim();
  if (!sourceText) return undefined;
  const split = splitTelegramStablePreviewMarkdown(sourceText);
  if (split.stableMarkdown.length === 0) {
    return buildTelegramPlainPreviewSnapshot({
      sourceText,
      state: options.state,
      maxMessageLength: options.maxMessageLength,
      renderPreviewText: options.renderPreviewText,
    });
  }
  const stableChunk = options.renderTelegramMessage(split.stableMarkdown, {
    mode: "markdown",
  })[0];
  if (
    !stableChunk ||
    stableChunk.text.length === 0 ||
    stableChunk.text.length > options.maxMessageLength
  ) {
    return buildTelegramPlainPreviewSnapshot({
      sourceText,
      state: options.state,
      maxMessageLength: options.maxMessageLength,
      renderPreviewText: options.renderPreviewText,
    });
  }
  let previewText = stableChunk.text;
  if (split.unstableTail.length > 0) {
    const tail = splitLeadingMarkdownBlankLines(split.unstableTail);
    const minimumBlankLinesBeforeTail = endsWithMarkdownHeadingLine(
      split.stableMarkdown,
    )
      ? 1
      : 0;
    const blankLinesBeforeTail = Math.max(
      tail.blankLines,
      minimumBlankLinesBeforeTail,
    );
    const separator =
      tail.remainingText.length > 0
        ? "\n".repeat(blankLinesBeforeTail + 1)
        : "";
    const tailText = escapeHtml(tail.remainingText);
    const candidate = `${previewText}${separator}${tailText}`;
    if (candidate.length <= options.maxMessageLength) {
      previewText = candidate;
    }
  }
  if (
    previewText === options.state.lastSentText &&
    stableChunk.parseMode === options.state.lastSentParseMode &&
    options.state.lastSentStrategy === "rich-stable-blocks"
  ) {
    return undefined;
  }
  return {
    text: previewText,
    parseMode: stableChunk.parseMode,
    sourceText,
    strategy: "rich-stable-blocks",
  };
}

export function renderMarkdownPreviewText(markdown: string): string {
  const normalized = normalizeMarkdownDocument(markdown);
  if (normalized.length === 0) return "";
  const output: string[] = [];
  const lines = normalized.split("\n");
  let activeFence: { marker: "`" | "~"; length: number } | undefined;
  for (const rawLine of lines) {
    const line = rawLine ?? "";
    const fence = parseMarkdownFence(line);
    if (activeFence) {
      if (fence && isMatchingMarkdownFence(line, activeFence)) {
        activeFence = undefined;
        continue;
      }
      if (line.trim().length === 0) {
        output.push("");
        continue;
      }
      output.push(line);
      continue;
    }
    if (fence) {
      activeFence = { marker: fence.marker, length: fence.length };
      continue;
    }
    if (line.trim().length === 0) {
      output.push("");
      continue;
    }
    if (isMarkdownTableSeparator(line)) {
      continue;
    }
    const heading = matchMarkdownHeadingLine(line);
    if (heading) {
      output.push(stripInlineMarkdownToPlainText(heading[2] ?? ""));
      continue;
    }
    const task = line.match(/^(\s*)([-*+]|\d+\.)\s+\[([ xX])\]\s+(.+)$/);
    if (task) {
      const indent = " ".repeat((task[1] ?? "").length);
      const listMarker = task[2] ?? "-";
      const checkboxMarker =
        (task[3] ?? " ").toLowerCase() === "x" ? "[x]" : "[ ]";
      const taskPrefix = isMarkdownNumberedListMarker(listMarker)
        ? `${listMarker} ${checkboxMarker}`
        : checkboxMarker;
      output.push(
        `${indent}${taskPrefix} ${stripInlineMarkdownToPlainText(task[4] ?? "")}`,
      );
      continue;
    }
    const bullet = line.match(/^(\s*)[-*+]\s+(.+)$/);
    if (bullet) {
      output.push(
        `${" ".repeat((bullet[1] ?? "").length)}- ${stripInlineMarkdownToPlainText(bullet[2] ?? "")}`,
      );
      continue;
    }
    const numbered = line.match(/^(\s*\d+\.)\s+(.+)$/);
    if (numbered) {
      output.push(
        `${numbered[1]} ${stripInlineMarkdownToPlainText(numbered[2] ?? "")}`,
      );
      continue;
    }
    const quote = line.match(/^\s*>\s?(.+)$/);
    if (quote) {
      output.push(`> ${stripInlineMarkdownToPlainText(quote[1] ?? "")}`);
      continue;
    }
    if (/^\s*([-*_]\s*){3,}\s*$/.test(line)) {
      output.push("────────");
      continue;
    }
    output.push(stripInlineMarkdownToPlainText(line));
  }
  return output.join("\n");
}

// --- Rich Markdown Rendering ---

function renderDelimitedInlineStyle(
  text: string,
  delimiter: string,
  render: (content: string) => string,
): string {
  const escapedDelimiter = delimiter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}\\\\])(${escapedDelimiter})(?=\\S)(.+?)(?<=\\S)\\2(?=[^\\p{L}\\p{N}]|$)`,
    "gu",
  );
  return text.replace(
    pattern,
    (_match, prefix: string, _wrapped: string, content: string) => {
      return `${prefix}${render(content)}`;
    },
  );
}

function renderInlineMarkdown(text: string): string {
  const tokens: string[] = [];
  const makeToken = (html: string): string => {
    const token = `\uE000${tokens.length}\uE001`;
    tokens.push(html);
    return token;
  };
  let result = replaceMarkdownLinkLike(text, {
    renderInlineLink: (link, supported) => {
      const plainLabel = stripInlineMarkdownToPlainText(link.label).trim();
      if (!supported) {
        return plainLabel.length > 0 ? plainLabel : link.destination;
      }
      const renderedLabel =
        plainLabel.length > 0 ? plainLabel : link.destination;
      return makeToken(
        `<a href="${escapeHtml(link.destination)}">${escapeHtml(renderedLabel)}</a>`,
      );
    },
    renderAutolink: (link) => {
      return makeToken(
        `<a href="${escapeHtml(link.destination)}">${escapeHtml(link.destination)}</a>`,
      );
    },
  });
  result = result.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    return makeToken(`<code>${escapeHtml(code)}</code>`);
  });
  result = escapeHtml(result);
  result = renderDelimitedInlineStyle(result, "***", (content) => {
    return `<b><i>${content}</i></b>`;
  });
  result = renderDelimitedInlineStyle(result, "___", (content) => {
    return `<b><i>${content}</i></b>`;
  });
  result = renderDelimitedInlineStyle(result, "~~", (content) => {
    return `<s>${content}</s>`;
  });
  result = renderDelimitedInlineStyle(result, "**", (content) => {
    return `<b>${content}</b>`;
  });
  result = renderDelimitedInlineStyle(result, "__", (content) => {
    return `<b>${content}</b>`;
  });
  result = renderDelimitedInlineStyle(result, "*", (content) => {
    return `<i>${content}</i>`;
  });
  result = renderDelimitedInlineStyle(result, "_", (content) => {
    return `<i>${content}</i>`;
  });
  result = result.replace(/\\([\\`*_{}\[\]()#+\-.!>~|])/g, "$1");
  return result.replace(
    /\uE000(\d+)\uE001/g,
    (_match, index: string) => tokens[Number(index)] ?? "",
  );
}

function buildListIndent(level: number): string {
  return "\u00A0".repeat(Math.max(0, level) * 2);
}

function parseMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed
    .split("|")
    .map((cell) => stripInlineMarkdownToPlainText(cell.trim()));
}

function parseMarkdownQuoteLine(
  line: string,
): { depth: number; content: string } | undefined {
  const match = line.match(/^\s*((?:>\s*)+)(.*)$/);
  if (!match) return undefined;
  const markers = match[1] ?? "";
  const depth = (markers.match(/>/g) ?? []).length;
  return {
    depth,
    content: match[2] ?? "",
  };
}

function renderMarkdownTextLines(block: string): string[] {
  const rendered: string[] = [];
  const lines = block.split("\n");
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const pieces = splitPlainMarkdownLine(line);
    for (const piece of pieces) {
      const heading = matchMarkdownHeadingLine(piece);
      if (heading) {
        rendered.push(
          `${buildListIndent(Math.floor((heading[1] ?? "").length / 2))}<b>${renderInlineMarkdown(heading[2] ?? "")}</b>`,
        );
        continue;
      }
      const task = piece.match(/^(\s*)([-*+]|\d+\.)\s+\[([ xX])\]\s+(.+)$/);
      if (task) {
        const indent = buildListIndent(Math.floor((task[1] ?? "").length / 2));
        const listMarker = task[2] ?? "-";
        const checkboxMarker =
          (task[3] ?? " ").toLowerCase() === "x" ? "[x]" : "[ ]";
        const taskPrefix = isMarkdownNumberedListMarker(listMarker)
          ? `<code>${listMarker}</code> <code>${checkboxMarker}</code>`
          : `<code>${checkboxMarker}</code>`;
        rendered.push(
          `${indent}${taskPrefix} ${renderInlineMarkdown(task[4] ?? "")}`,
        );
        continue;
      }
      const bullet = piece.match(/^(\s*)[-*+]\s+(.+)$/);
      if (bullet) {
        const indent = buildListIndent(
          Math.floor((bullet[1] ?? "").length / 2),
        );
        rendered.push(
          `${indent}<code>-</code> ${renderInlineMarkdown(bullet[2] ?? "")}`,
        );
        continue;
      }
      const numbered = piece.match(/^(\s*)(\d+)\.\s+(.+)$/);
      if (numbered) {
        const indent = buildListIndent(
          Math.floor((numbered[1] ?? "").length / 2),
        );
        rendered.push(
          `${indent}<code>${numbered[2]}.</code> ${renderInlineMarkdown(numbered[3] ?? "")}`,
        );
        continue;
      }
      const quote = piece.match(/^>\s?(.+)$/);
      if (quote) {
        rendered.push(
          `<blockquote>${renderInlineMarkdown(quote[1] ?? "")}</blockquote>`,
        );
        continue;
      }
      const trimmed = piece.trim();
      if (/^([-*_]\s*){3,}$/.test(trimmed)) {
        rendered.push("────────────");
        continue;
      }
      rendered.push(renderInlineMarkdown(piece));
    }
  }
  return rendered;
}

function renderMarkdownCodeBlock(code: string, language?: string): string[] {
  const open = language
    ? `<pre><code class="language-${escapeHtml(language)}">`
    : "<pre><code>";
  const close = "</code></pre>";
  const maxContentLength = MAX_MESSAGE_LENGTH - open.length - close.length;
  const chunks: string[] = [];
  let current = "";
  const pushCurrent = (): void => {
    if (current.length === 0) return;
    chunks.push(`${open}${current}${close}`);
    current = "";
  };
  const appendEscapedLine = (escapedLine: string): void => {
    if (escapedLine.length <= maxContentLength) {
      const candidate =
        current.length === 0 ? escapedLine : `${current}\n${escapedLine}`;
      if (candidate.length <= maxContentLength) {
        current = candidate;
        return;
      }
      pushCurrent();
      current = escapedLine;
      return;
    }
    pushCurrent();
    for (let i = 0; i < escapedLine.length; i += maxContentLength) {
      chunks.push(
        `${open}${escapedLine.slice(i, i + maxContentLength)}${close}`,
      );
    }
  };
  for (const line of code.split("\n")) {
    appendEscapedLine(escapeHtml(line));
  }
  pushCurrent();
  return chunks.length > 0 ? chunks : [`${open}${close}`];
}

function renderMarkdownTableBlock(lines: string[]): string[] {
  const rows = lines.map(parseMarkdownTableRow);
  const columnCount = Math.max(...rows.map((row) => row.length), 0);
  const normalizedRows = rows.map((row) => {
    const next = [...row];
    while (next.length < columnCount) {
      next.push("");
    }
    return next;
  });
  const widths = Array.from({ length: columnCount }, (_, columnIndex) => {
    return Math.max(
      3,
      ...normalizedRows.map((row) => (row[columnIndex] ?? "").length),
    );
  });
  const formatRow = (row: string[]): string => {
    return row
      .map((cell, columnIndex) => (cell ?? "").padEnd(widths[columnIndex] ?? 3))
      .join(" | ");
  };
  const separator = widths.map((width) => "-".repeat(width)).join(" | ");
  const [header, ...body] = normalizedRows;
  const tableLines = [
    formatRow(header ?? []),
    separator,
    ...body.map(formatRow),
  ];
  return renderMarkdownCodeBlock(tableLines.join("\n"), "markdown");
}

function chunkRenderedHtmlLines(
  lines: string[],
  wrapper?: { open: string; close: string },
): string[] {
  if (lines.length === 0) return [];
  const open = wrapper?.open ?? "";
  const close = wrapper?.close ?? "";
  const maxContentLength = MAX_MESSAGE_LENGTH - open.length - close.length;
  const chunks: string[] = [];
  let current = "";
  const pushCurrent = (): void => {
    if (current.length === 0) return;
    chunks.push(`${open}${current}${close}`);
    current = "";
  };
  for (const line of lines) {
    const candidate = current.length === 0 ? line : `${current}\n${line}`;
    if (candidate.length <= maxContentLength) {
      current = candidate;
      continue;
    }
    pushCurrent();
    if (line.length <= maxContentLength) {
      current = line;
      continue;
    }
    for (let i = 0; i < line.length; i += maxContentLength) {
      chunks.push(`${open}${line.slice(i, i + maxContentLength)}${close}`);
    }
  }
  pushCurrent();
  return chunks;
}

function renderMarkdownTextBlock(block: string): string[] {
  return chunkRenderedHtmlLines(renderMarkdownTextLines(block));
}

function renderMarkdownQuoteBlock(lines: string[]): string[] {
  const inner = lines
    .map((line) => {
      const parsed = parseMarkdownQuoteLine(line);
      if (!parsed) return line;
      const nestedIndent = "\u00A0".repeat(Math.max(0, parsed.depth - 1) * 2);
      return `${nestedIndent}${parsed.content}`;
    })
    .join("\n");
  return chunkRenderedHtmlLines(renderMarkdownTextLines(inner), {
    open: "<blockquote>",
    close: "</blockquote>",
  });
}

interface TelegramRenderedBlockWithSpacing {
  text: string;
  blankLinesBefore: number;
}

function renderMarkdownToTelegramHtmlChunks(markdown: string): string[] {
  const normalized = normalizeMarkdownDocument(markdown);
  if (normalized.length === 0) return [];
  const renderedBlocks: TelegramRenderedBlockWithSpacing[] = [];
  let minimumBlankLinesBeforeNextBlock = 0;
  const pushRenderedBlocks = (
    blocks: string[],
    blankLinesBefore: number,
  ): void => {
    const effectiveBlankLinesBefore =
      renderedBlocks.length === 0
        ? blankLinesBefore
        : Math.max(blankLinesBefore, minimumBlankLinesBeforeNextBlock);
    for (const [blockIndex, block] of blocks.entries()) {
      renderedBlocks.push({
        text: block,
        blankLinesBefore: blockIndex === 0 ? effectiveBlankLinesBefore : 0,
      });
    }
    minimumBlankLinesBeforeNextBlock = 0;
  };
  const lines = normalized.split("\n");
  let index = 0;
  let pendingBlankLines = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const nextLine = lines[index + 1] ?? "";
    if (line.trim().length === 0) {
      pendingBlankLines += 1;
      index += 1;
      continue;
    }
    const heading = matchMarkdownHeadingLine(line);
    if (heading) {
      pushRenderedBlocks(
        renderMarkdownTextBlock(line),
        renderedBlocks.length === 0
          ? pendingBlankLines
          : Math.max(pendingBlankLines, 1),
      );
      pendingBlankLines = 0;
      minimumBlankLinesBeforeNextBlock = 1;
      index += 1;
      continue;
    }
    const fence = parseMarkdownFence(line);
    if (fence) {
      index += 1;
      const codeLines: string[] = [];
      while (
        index < lines.length &&
        !isMatchingMarkdownFence(lines[index] ?? "", fence)
      ) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      pushRenderedBlocks(
        renderMarkdownCodeBlock(codeLines.join("\n"), fence.info),
        pendingBlankLines,
      );
      pendingBlankLines = 0;
      continue;
    }
    if (line.includes("|") && isMarkdownTableSeparator(nextLine)) {
      const tableLines: string[] = [line];
      index += 2;
      while (index < lines.length) {
        const tableLine = lines[index] ?? "";
        if (tableLine.trim().length === 0 || !tableLine.includes("|")) {
          break;
        }
        tableLines.push(tableLine);
        index += 1;
      }
      pushRenderedBlocks(
        renderMarkdownTableBlock(tableLines),
        pendingBlankLines,
      );
      pendingBlankLines = 0;
      continue;
    }
    if (canStartIndentedCodeBlock(lines, index)) {
      const codeLines: string[] = [];
      while (index < lines.length) {
        const rawLine = lines[index] ?? "";
        if (rawLine.trim().length === 0) {
          codeLines.push("");
          index += 1;
          continue;
        }
        if (!isIndentedCodeLine(rawLine)) break;
        codeLines.push(stripIndentedCodePrefix(rawLine));
        index += 1;
      }
      pushRenderedBlocks(
        renderMarkdownCodeBlock(codeLines.join("\n")),
        pendingBlankLines,
      );
      pendingBlankLines = 0;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index] ?? "")) {
        quoteLines.push(lines[index] ?? "");
        index += 1;
      }
      pushRenderedBlocks(
        renderMarkdownQuoteBlock(quoteLines),
        pendingBlankLines,
      );
      pendingBlankLines = 0;
      continue;
    }
    const textLines: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? "";
      const following = lines[index + 1] ?? "";
      if (current.trim().length === 0) break;
      if (
        isFencedCodeStart(current) ||
        canStartIndentedCodeBlock(lines, index) ||
        /^\s*>/.test(current)
      )
        break;
      if (current.includes("|") && isMarkdownTableSeparator(following)) break;
      textLines.push(current);
      index += 1;
    }
    pushRenderedBlocks(
      renderMarkdownTextBlock(textLines.join("\n")),
      pendingBlankLines,
    );
    pendingBlankLines = 0;
  }
  const chunks: string[] = [];
  let current = "";
  for (const block of renderedBlocks) {
    const separator = "\n".repeat(block.blankLinesBefore + 1);
    const candidate =
      current.length === 0 ? block.text : `${current}${separator}${block.text}`;
    if (candidate.length <= MAX_MESSAGE_LENGTH) {
      current = candidate;
      continue;
    }
    if (current.length > 0) {
      chunks.push(current);
      current = "";
    }
    if (block.text.length <= MAX_MESSAGE_LENGTH) {
      current = block.text;
      continue;
    }
    for (let i = 0; i < block.text.length; i += MAX_MESSAGE_LENGTH) {
      chunks.push(block.text.slice(i, i + MAX_MESSAGE_LENGTH));
    }
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

// --- Unified Telegram Rendering ---

export type TelegramRenderMode = "plain" | "markdown" | "html";

export interface TelegramRenderedChunk {
  text: string;
  parseMode?: "HTML";
}

function chunkParagraphs(text: string): string[] {
  if (text.length <= MAX_MESSAGE_LENGTH) return [text];
  const normalized = text.replace(/\r\n/g, "\n");
  const paragraphs = normalized.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";
  const flushCurrent = (): void => {
    if (current.trim().length > 0) chunks.push(current);
    current = "";
  };
  const splitLongBlock = (block: string): string[] => {
    if (block.length <= MAX_MESSAGE_LENGTH) return [block];
    const lines = block.split("\n");
    const lineChunks: string[] = [];
    let lineCurrent = "";
    for (const line of lines) {
      const candidate =
        lineCurrent.length === 0 ? line : `${lineCurrent}\n${line}`;
      if (candidate.length <= MAX_MESSAGE_LENGTH) {
        lineCurrent = candidate;
        continue;
      }
      if (lineCurrent.length > 0) {
        lineChunks.push(lineCurrent);
        lineCurrent = "";
      }
      if (line.length <= MAX_MESSAGE_LENGTH) {
        lineCurrent = line;
        continue;
      }
      for (let i = 0; i < line.length; i += MAX_MESSAGE_LENGTH) {
        lineChunks.push(line.slice(i, i + MAX_MESSAGE_LENGTH));
      }
    }
    if (lineCurrent.length > 0) {
      lineChunks.push(lineCurrent);
    }
    return lineChunks;
  };
  for (const paragraph of paragraphs) {
    if (paragraph.length === 0) continue;
    const parts = splitLongBlock(paragraph);
    for (const part of parts) {
      const candidate = current.length === 0 ? part : `${current}\n\n${part}`;
      if (candidate.length <= MAX_MESSAGE_LENGTH) {
        current = candidate;
      } else {
        flushCurrent();
        current = part;
      }
    }
  }
  flushCurrent();
  return chunks;
}

export function renderTelegramMessage(
  text: string,
  options?: { mode?: TelegramRenderMode },
): TelegramRenderedChunk[] {
  const mode = options?.mode ?? "plain";
  if (mode === "plain") {
    return chunkParagraphs(text).map((chunk) => ({ text: chunk }));
  }
  if (mode === "html") {
    return [{ text, parseMode: "HTML" }];
  }
  return renderMarkdownToTelegramHtmlChunks(text).map((chunk) => ({
    text: chunk,
    parseMode: "HTML",
  }));
}
