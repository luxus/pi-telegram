/**
 * Regression tests for inbound Telegram attachment handlers
 * Covers MIME/type matching, command substitution, auto-tool invocation, handler failures, and prompt-text routing
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTelegramAttachmentCommandInvocation,
  processTelegramAttachmentHandlers,
  telegramAttachmentHandlerMatchesFile,
} from "../lib/handlers.ts";

test("Attachment handlers match MIME wildcards and Telegram file types", () => {
  const voiceFile = {
    path: "/tmp/voice.ogg",
    fileName: "voice.ogg",
    mimeType: "audio/ogg",
    kind: "voice",
  };
  assert.equal(
    telegramAttachmentHandlerMatchesFile({ mime: "audio/*" }, voiceFile),
    true,
  );
  assert.equal(
    telegramAttachmentHandlerMatchesFile({ type: "voice" }, voiceFile),
    true,
  );
  assert.equal(
    telegramAttachmentHandlerMatchesFile({ match: "application/pdf" }, voiceFile),
    false,
  );
  assert.equal(telegramAttachmentHandlerMatchesFile({}, voiceFile), true);
});

test("Attachment command handlers substitute paths without shell interpolation", async () => {
  const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
  const file = {
    path: "/tmp/voice one.ogg",
    fileName: "voice one.ogg",
    mimeType: "audio/ogg",
    kind: "voice",
  };
  const result = await processTelegramAttachmentHandlers({
    files: [file],
    rawText: "please summarize",
    handlers: [
      {
        mime: "audio/*",
        command: "/opt/transcribe --file={filename} --mime {mime} --type {type}",
      },
    ],
    cwd: "/work",
    execCommand: async (command, args, options) => {
      calls.push({ command, args, cwd: options?.cwd });
      return { stdout: "hello from voice\n", stderr: "", code: 0, killed: false };
    },
  });
  assert.deepEqual(calls, [
    {
      command: "/opt/transcribe",
      args: ["--file=/tmp/voice one.ogg", "--mime", "audio/ogg", "--type", "voice"],
      cwd: "/work",
    },
  ]);
  assert.deepEqual(result.promptFiles, [file]);
  assert.equal(result.rawText, "please summarize");
  assert.deepEqual(result.handlerOutputs, ["hello from voice"]);
});

test("Attachment command handlers append the path when no placeholder is present", () => {
  const invocation = buildTelegramAttachmentCommandInvocation(
    "./scripts/transcribe --lang ru",
    { path: "/tmp/a.ogg" },
    "/work",
  );
  assert.deepEqual(invocation, {
    command: "/work/scripts/transcribe",
    args: ["--lang", "ru", "/tmp/a.ogg"],
  });
});

test("Attachment tool handlers invoke pi-auto-tools scripts with configured args", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const result = await processTelegramAttachmentHandlers({
    files: [
      {
        path: "/tmp/voice.ogg",
        fileName: "voice.ogg",
        mimeType: "audio/ogg",
        kind: "voice",
      },
    ],
    rawText: "",
    handlers: [
      {
        type: "voice",
        tool: "transcribe_mistral",
        args: { lang: "ru", model: "voxtral-mini" },
      },
    ],
    cwd: "/work",
    readTextFile: async () =>
      JSON.stringify({
        transcribe_mistral: {
          name: "transcribe_mistral",
          script: "/tools/transcribe",
          args: ["file", "lang", "model"],
        },
      }),
    execCommand: async (command, args) => {
      calls.push({ command, args });
      return { stdout: "расшифровка", stderr: "", code: 0, killed: false };
    },
  });
  assert.deepEqual(calls, [
    { command: "/tools/transcribe", args: ["/tmp/voice.ogg", "ru", "voxtral-mini"] },
  ]);
  assert.equal(result.rawText, "");
  assert.deepEqual(result.handlerOutputs, ["расшифровка"]);
  assert.deepEqual(result.promptFiles, [
    {
      path: "/tmp/voice.ogg",
      fileName: "voice.ogg",
      mimeType: "audio/ogg",
      kind: "voice",
    },
  ]);
});

test("Attachment handler failures fall back to normal attachment prompts", async () => {
  const events: Array<{ category: string; details?: Record<string, unknown> }> = [];
  const file = {
    path: "/tmp/report.pdf",
    fileName: "report.pdf",
    mimeType: "application/pdf",
    kind: "document",
  };
  const result = await processTelegramAttachmentHandlers({
    files: [file],
    rawText: "read this",
    handlers: [{ mime: "application/pdf", command: "/opt/pdf-to-text {filename}" }],
    cwd: "/work",
    execCommand: async () => ({
      stdout: "partial",
      stderr: "boom",
      code: 1,
      killed: false,
    }),
    recordRuntimeEvent: (category, _error, details) => {
      events.push({ category, details });
    },
  });
  assert.equal(result.rawText, "read this");
  assert.deepEqual(result.handlerOutputs, []);
  assert.deepEqual(result.promptFiles, [file]);
  assert.deepEqual(events, [
    {
      category: "attachment-handler",
      details: { fileName: "report.pdf", handler: "command" },
    },
  ]);
});
