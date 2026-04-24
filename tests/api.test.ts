/**
 * Regression tests for Telegram API and config helpers
 * Verifies config persistence and direct helper behavior around missing tokens and callback-query failures
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  answerTelegramCallbackQuery,
  callTelegram,
  callTelegramMultipart,
  cleanupTelegramTempFiles,
  createTelegramApiClient,
  downloadTelegramFile,
  readTelegramConfig,
  writeTelegramConfig,
} from "../lib/api.ts";

test("Telegram config helpers persist and reload config", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-telegram-config-"));
  const configPath = join(agentDir, "telegram.json");
  const config = {
    botToken: "123:abc",
    botUsername: "demo_bot",
    allowedUserId: 42,
  };
  await writeTelegramConfig(agentDir, configPath, config);
  const reloaded = await readTelegramConfig(configPath);
  assert.deepEqual(reloaded, config);
  const raw = await readFile(configPath, "utf8");
  assert.match(raw, /demo_bot/);
});

test("Telegram temp cleanup removes only stale files", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "pi-telegram-cleanup-"));
  const oldFile = join(tempDir, "old.txt");
  const freshFile = join(tempDir, "fresh.txt");
  const nestedDir = join(tempDir, "nested");
  await writeFile(oldFile, "old", "utf8");
  await writeFile(freshFile, "fresh", "utf8");
  await mkdir(nestedDir);
  await writeFile(join(nestedDir, "keep.txt"), "keep", "utf8");
  await utimes(oldFile, new Date(1_000), new Date(1_000));
  await utimes(freshFile, new Date(10_000), new Date(10_000));
  assert.equal(await cleanupTelegramTempFiles(tempDir, 5_000, 11_000), 1);
  assert.deepEqual((await readdir(tempDir)).sort(), ["fresh.txt", "nested"]);
});

test("Telegram API helpers reject missing bot token for direct calls", async () => {
  await assert.rejects(() => callTelegram(undefined, "getMe", {}), {
    message: "Telegram bot token is not configured",
  });
  await assert.rejects(
    () =>
      downloadTelegramFile(
        undefined,
        "file-id",
        "demo.txt",
        join(tmpdir(), "pi-telegram-missing-token"),
      ),
    {
      message: "Telegram bot token is not configured",
    },
  );
});

test("Telegram API helpers include HTTP status details for failed responses", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return {
      ok: false,
      status: 429,
      text: async () => JSON.stringify({ ok: false, description: "Too Many Requests" }),
    } as Response;
  }) as typeof fetch;
  try {
    await assert.rejects(
      () => callTelegram("123:abc", "sendMessage", {}, { maxAttempts: 1 }),
      {
        message: "Telegram API sendMessage failed: HTTP 429: Too Many Requests",
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Telegram API helpers retry 429 and 5xx responses", async () => {
  const originalFetch = globalThis.fetch;
  const sleeps: number[] = [];
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) {
      return {
        ok: false,
        status: 429,
        headers: new Headers({ "retry-after": "2" }),
        text: async () => JSON.stringify({ ok: false, description: "Too Many Requests" }),
      } as Response;
    }
    if (calls === 2) {
      return {
        ok: false,
        status: 502,
        text: async () => JSON.stringify({ ok: false, description: "Bad Gateway" }),
      } as Response;
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, result: "sent" }),
    } as Response;
  }) as typeof fetch;
  try {
    const result = await callTelegram<string>("123:abc", "sendMessage", {}, {
      retryBaseDelayMs: 10,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    assert.equal(result, "sent");
    assert.equal(calls, 3);
    assert.deepEqual(sleeps, [2000, 20]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Telegram multipart API rebuilds forms for retryable responses", async () => {
  const originalFetch = globalThis.fetch;
  const tempDir = await mkdtemp(join(tmpdir(), "pi-telegram-upload-"));
  const filePath = join(tempDir, "demo.txt");
  await writeFile(filePath, "hello", "utf8");
  const contentTypes: string[] = [];
  let calls = 0;
  globalThis.fetch = (async (_input, init) => {
    calls += 1;
    contentTypes.push((init?.body as FormData).get("document") instanceof Blob ? "blob" : "missing");
    if (calls === 1) {
      return {
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ ok: false, description: "Server Error" }),
      } as Response;
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, result: true }),
    } as Response;
  }) as typeof fetch;
  try {
    assert.equal(
      await callTelegramMultipart<boolean>(
        "123:abc",
        "sendDocument",
        { chat_id: "1" },
        "document",
        filePath,
        "demo.txt",
        { retryBaseDelayMs: 0, sleep: async () => {} },
      ),
      true,
    );
    assert.equal(calls, 2);
    assert.deepEqual(contentTypes, ["blob", "blob"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Telegram file downloads use unique sanitized temp file names", async () => {
  const originalFetch = globalThis.fetch;
  const tempDir = await mkdtemp(join(tmpdir(), "pi-telegram-download-"));
  globalThis.fetch = (async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/getFile")) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ ok: true, result: { file_path: "files/demo" } }),
      } as Response;
    }
    return new Response("hello", { status: 200 });
  }) as typeof fetch;
  try {
    const path = await downloadTelegramFile(
      "123:abc",
      "file-id",
      "bad name?.txt",
      tempDir,
    );
    assert.match(path, /[0-9a-f-]{36}-bad_name_\.txt$/);
    assert.equal(await readFile(path, "utf8"), "hello");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Telegram file downloads reject files above configured limits", async () => {
  const originalFetch = globalThis.fetch;
  const tempDir = await mkdtemp(join(tmpdir(), "pi-telegram-download-limit-"));
  let calls = 0;
  globalThis.fetch = (async (input) => {
    calls += 1;
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/getFile")) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            ok: true,
            result: { file_path: "files/demo", file_size: 10 },
          }),
      } as Response;
    }
    return new Response("too large", { status: 200 });
  }) as typeof fetch;
  try {
    await assert.rejects(
      () =>
        downloadTelegramFile(
          "123:abc",
          "file-id",
          "demo.txt",
          tempDir,
          { maxFileSizeBytes: 5 },
        ),
      { message: "Telegram file exceeds size limit (10 bytes > 5 bytes)" },
    );
    assert.equal(calls, 1);
    assert.deepEqual(await readdir(tempDir), []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Telegram streaming downloads remove partial files after limit failures", async () => {
  const originalFetch = globalThis.fetch;
  const tempDir = await mkdtemp(join(tmpdir(), "pi-telegram-download-partial-"));
  globalThis.fetch = (async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/getFile")) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ ok: true, result: { file_path: "files/demo" } }),
      } as Response;
    }
    return new Response("too large", { status: 200 });
  }) as typeof fetch;
  try {
    await assert.rejects(
      () =>
        downloadTelegramFile(
          "123:abc",
          "file-id",
          "demo.txt",
          tempDir,
          { maxFileSizeBytes: 5 },
        ),
      { message: "Telegram file exceeds size limit (9 bytes > 5 bytes)" },
    );
    assert.deepEqual(await readdir(tempDir), []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Telegram API helpers reject malformed successful responses", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return {
      ok: true,
      status: 200,
      text: async () => "not json",
    } as Response;
  }) as typeof fetch;
  try {
    await assert.rejects(() => callTelegram("123:abc", "getMe", {}), {
      message: "Telegram API getMe returned invalid JSON",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("answerTelegramCallbackQuery ignores Telegram API failures", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;
  try {
    await assert.doesNotReject(() =>
      answerTelegramCallbackQuery("123:abc", "callback-id", "ok"),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Telegram API client resolves bot tokens lazily for wrapped calls", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  let botToken = "123:abc";
  globalThis.fetch = (async (input) => {
    calls.push(typeof input === "string" ? input : input.toString());
    return {
      ok: true,
      json: async () => ({ ok: true, result: true }),
    } as Response;
  }) as typeof fetch;
  try {
    const client = createTelegramApiClient(() => botToken);
    await client.call("sendChatAction", { chat_id: 1, action: "typing" });
    botToken = "456:def";
    await client.answerCallbackQuery("cb-1", "ok");
    assert.match(calls[0] ?? "", /bot123:abc\/sendChatAction$/);
    assert.match(calls[1] ?? "", /bot456:def\/answerCallbackQuery$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
