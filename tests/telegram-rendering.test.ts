import test from "node:test";
import assert from "node:assert/strict";

import { __telegramTestUtils } from "../index.ts";

test("Nested lists stay out of code blocks", () => {
  const chunks = __telegramTestUtils.renderTelegramMessage(
    "- Level 1\n  - Level 2\n    - Level 3 with **bold** text",
    { mode: "markdown" },
  );
  assert.ok(chunks.length > 0);
  assert.equal(
    chunks.some((chunk) => chunk.text.includes("<pre><code>")),
    false,
  );
  assert.equal(
    chunks.some((chunk) =>
      chunk.text.includes("• Level 3 with <b>bold</b> text"),
    ),
    true,
  );
});

test("Fenced code blocks preserve literal markdown", () => {
  const chunks = __telegramTestUtils.renderTelegramMessage(
    '~~~ts\nconst value = "**raw**";\n~~~',
    { mode: "markdown" },
  );
  assert.equal(chunks.length, 1);
  assert.match(chunks[0]?.text ?? "", /<pre><code class="language-ts">/);
  assert.match(chunks[0]?.text ?? "", /\*\*raw\*\*/);
});

test("Underscores inside words do not become italic", () => {
  const chunks = __telegramTestUtils.renderTelegramMessage(
    "Path: foo_bar_baz.txt and **bold**",
    { mode: "markdown" },
  );
  assert.equal(chunks.length, 1);
  assert.equal((chunks[0]?.text ?? "").includes("<i>bar</i>"), false);
  assert.match(chunks[0]?.text ?? "", /<b>bold<\/b>/);
});

test("Long markdown replies stay chunked below Telegram limits", () => {
  const markdown = Array.from(
    { length: 600 },
    (_, index) => `- item **${index}**`,
  ).join("\n");
  const chunks = __telegramTestUtils.renderTelegramMessage(markdown, {
    mode: "markdown",
  });
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.text.length <= __telegramTestUtils.MAX_MESSAGE_LENGTH);
    assert.equal(
      (chunk.text.match(/<b>/g) ?? []).length,
      (chunk.text.match(/<\/b>/g) ?? []).length,
    );
  }
});
