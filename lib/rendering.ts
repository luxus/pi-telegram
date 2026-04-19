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

function stripInlineMarkdownToPlainText(text: string): string {
  let result = text;
  result = result.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, "$1");
  result = result.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1");
  result = result.replace(/<((?:https?:\/\/|mailto:)[^>]+)>/g, "$1");
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
        if (output.at(-1) !== "") output.push("");
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
      if (output.at(-1) !== "") output.push("");
      continue;
    }
    if (isMarkdownTableSeparator(line)) {
      continue;
    }
    const heading = line.match(/^\s*#{1,6}\s+(.+)$/);
    if (heading) {
      output.push(stripInlineMarkdownToPlainText(heading[1] ?? ""));
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
  let result = text;
  result = result.replace(
    /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g,
    (_match, alt: string, url: string) => {
      const label = alt.trim().length > 0 ? alt : url;
      return makeToken(`<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`);
    },
  );
  result = result.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_match, label: string, url: string) => {
      return makeToken(`<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`);
    },
  );
  result = result.replace(
    /<((?:https?:\/\/|mailto:)[^>]+)>/g,
    (_match, url: string) => {
      return makeToken(`<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`);
    },
  );
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
      const heading = piece.match(/^(\s*)#{1,6}\s+(.+)$/);
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

function renderMarkdownToTelegramHtmlChunks(markdown: string): string[] {
  const normalized = normalizeMarkdownDocument(markdown);
  if (normalized.length === 0) return [];
  const renderedBlocks: string[] = [];
  const lines = normalized.split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const nextLine = lines[index + 1] ?? "";
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
      renderedBlocks.push(
        ...renderMarkdownCodeBlock(codeLines.join("\n"), fence.info),
      );
      while (index < lines.length && (lines[index] ?? "").trim().length === 0) {
        index += 1;
      }
      continue;
    }
    if (line.trim().length === 0) {
      index += 1;
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
      renderedBlocks.push(...renderMarkdownTableBlock(tableLines));
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
      renderedBlocks.push(...renderMarkdownCodeBlock(codeLines.join("\n")));
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index] ?? "")) {
        quoteLines.push(lines[index] ?? "");
        index += 1;
      }
      renderedBlocks.push(...renderMarkdownQuoteBlock(quoteLines));
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
    renderedBlocks.push(...renderMarkdownTextBlock(textLines.join("\n")));
  }
  const chunks: string[] = [];
  let current = "";
  for (const block of renderedBlocks) {
    const candidate = current.length === 0 ? block : `${current}\n\n${block}`;
    if (candidate.length <= MAX_MESSAGE_LENGTH) {
      current = candidate;
      continue;
    }
    if (current.length > 0) {
      chunks.push(current);
      current = "";
    }
    if (block.length <= MAX_MESSAGE_LENGTH) {
      current = block;
      continue;
    }
    for (let i = 0; i < block.length; i += MAX_MESSAGE_LENGTH) {
      chunks.push(block.slice(i, i + MAX_MESSAGE_LENGTH));
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
