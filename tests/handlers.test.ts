/**
 * Regression tests for inbound Telegram attachment handlers
 * Covers MIME/type matching, template substitution, fallback failures, and prompt-text routing
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTelegramAttachmentHandlerInvocation,
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

test("Attachment template handlers substitute paths without shell interpolation", async () => {
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
        template: "/opt/transcribe --file={file} --mime {mime} --type {type}",
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

test("Attachment template handlers apply declared defaults", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const file = {
    path: "/tmp/voice one.ogg",
    fileName: "voice one.ogg",
    mimeType: "audio/ogg",
    kind: "voice",
  };
  const result = await processTelegramAttachmentHandlers({
    files: [file],
    rawText: "",
    handlers: [
      {
        type: "voice",
        template: "/opt/transcribe {file} {lang} {model}",
        args: ["file", "lang", "model"],
        defaults: { lang: "ru", model: "voxtral-mini-latest" },
      },
    ],
    cwd: "/work",
    execCommand: async (command, args) => {
      calls.push({ command, args });
      return { stdout: "voice transcript", stderr: "", code: 0, killed: false };
    },
  });
  assert.deepEqual(calls, [
    {
      command: "/opt/transcribe",
      args: ["/tmp/voice one.ogg", "ru", "voxtral-mini-latest"],
    },
  ]);
  assert.deepEqual(result.handlerOutputs, ["voice transcript"]);
});

test("Attachment template invocation supports defaults in args strings", () => {
  const invocation = buildTelegramAttachmentHandlerInvocation(
    {
      template: "./scripts/transcribe {file} {lang} {model}",
      args: "file,lang=ru,model=voxtral-mini-latest",
    },
    { path: "/tmp/a.ogg" },
    "/work",
  );
  assert.deepEqual(invocation, {
    command: "/work/scripts/transcribe",
    args: ["/tmp/a.ogg", "ru", "voxtral-mini-latest"],
  });
});

test("Attachment template handlers resolve relative commands", () => {
  const invocation = buildTelegramAttachmentHandlerInvocation(
    { template: "./scripts/transcribe {file} ru" },
    { path: "/tmp/a.ogg" },
    "/work",
  );
  assert.deepEqual(invocation, {
    command: "/work/scripts/transcribe",
    args: ["/tmp/a.ogg", "ru"],
  });
});

test("Attachment template handlers append the path when no placeholder is present", () => {
  const invocation = buildTelegramAttachmentHandlerInvocation(
    { template: "./scripts/transcribe --lang ru" },
    { path: "/tmp/a.ogg" },
    "/work",
  );
  assert.deepEqual(invocation, {
    command: "/work/scripts/transcribe",
    args: ["--lang", "ru", "/tmp/a.ogg"],
  });
});

test("Attachment handlers fall back to the next matching handler on failure", async () => {
  const calls: string[] = [];
  const events: Array<{ category: string; details?: Record<string, unknown> }> = [];
  const file = {
    path: "/tmp/voice.ogg",
    fileName: "voice.ogg",
    mimeType: "audio/ogg",
    kind: "voice",
  };
  const result = await processTelegramAttachmentHandlers({
    files: [file],
    rawText: "",
    handlers: [
      { type: "voice", template: "/tools/primary {file} ru" },
      { mime: "audio/*", template: "/tools/fallback {file} ru" },
    ],
    cwd: "/work",
    execCommand: async (command) => {
      calls.push(command);
      if (command === "/tools/primary") {
        return { stdout: "", stderr: "primary down", code: 1, killed: false };
      }
      return { stdout: "fallback transcript", stderr: "", code: 0, killed: false };
    },
    recordRuntimeEvent: (category, _error, details) => {
      events.push({ category, details });
    },
  });
  assert.deepEqual(calls, ["/tools/primary", "/tools/fallback"]);
  assert.deepEqual(result.handlerOutputs, ["fallback transcript"]);
  assert.deepEqual(events, [
    {
      category: "attachment-handler",
      details: { fileName: "voice.ogg", handler: "template" },
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
    handlers: [{ mime: "application/pdf", template: "/opt/pdf-to-text {file}" }],
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
      details: { fileName: "report.pdf", handler: "template" },
    },
  ]);
});
