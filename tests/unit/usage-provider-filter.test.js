// Usage dashboard: provider filter (stats + chart, live and daily paths) and
// the Recent Requests shape (newest first, cache read/write, server clock).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-usage-filter-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  const now = Date.now();
  await db.saveRequestUsage({
    provider: "nan", model: "gemma4", timestamp: new Date(now - 60000).toISOString(),
    connectionId: "acct-a",
    tokens: { prompt_tokens: 100, completion_tokens: 10, cached_tokens: 40 }, status: "ok",
  });
  await db.saveRequestUsage({
    provider: "nan", model: "gemma4", connectionId: "acct-b", timestamp: new Date(now - 45000).toISOString(),
    tokens: { prompt_tokens: 7, completion_tokens: 3 }, status: "ok",
  });
  await db.saveRequestUsage({
    provider: "anthropic", model: "claude-sonnet-4-6", timestamp: new Date(now - 30000).toISOString(),
    tokens: { prompt_tokens: 300, completion_tokens: 30, cache_read_input_tokens: 200, cache_creation_input_tokens: 50 }, status: "ok",
  });
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("usage provider filter", () => {
  it.each(["24h", "7d"])("stats %s only count the selected provider", async (period) => {
    const all = await db.getUsageStats(period);
    expect(all.totalRequests).toBe(3);
    const nan = await db.getUsageStats(period, { provider: "nan" });
    expect(Object.keys(nan.byProvider)).toEqual(["nan"]);
    expect(nan.totalRequests).toBe(2);
    expect(nan.totalPromptTokens).toBe(107);
    expect(nan.totalCachedTokens).toBe(40);
    expect(Object.values(nan.byModel).map((m) => m.rawModel)).toEqual(["gemma4"]);
    expect(nan.recentRequests.map((r) => r.provider)).toEqual(["nan", "nan"]);
  });

  it.each(["24h", "7d"])("chart %s only counts the selected provider", async (period) => {
    const sum = (rows) => rows.reduce((s, r) => s + r.tokens, 0);
    expect(sum(await db.getChartData(period))).toBe(450);
    expect(sum(await db.getChartData(period, "nan"))).toBe(120);
  });

  it.each(["24h", "7d"])("chart %s splits each bucket per model", async (period) => {
    const models = {};
    for (const b of await db.getChartData(period)) {
      expect(Object.values(b.models).reduce((s, m) => s + m.tokens, 0)).toBe(b.tokens);
      for (const [k, m] of Object.entries(b.models)) models[k] = (models[k] || 0) + m.tokens;
    }
    expect(models["gemma4|nan"]).toBe(120);
    expect(Object.keys(models)).toHaveLength(2);
    const nanOnly = (await db.getChartData(period, "nan")).flatMap((b) => Object.keys(b.models));
    expect(new Set(nanOnly)).toEqual(new Set(["gemma4|nan"]));
  });

  it("recent requests are newest first with cache read/write and server clock", async () => {
    const live = await db.getActiveRequests();
    expect(typeof live.serverNow).toBe("number");
    expect(live.recentRequests.map((r) => r.provider)).toEqual(["anthropic", "nan", "nan"]);
    expect(live.recentRequests[0]).toMatchObject({ cachedTokens: 200, cacheWriteTokens: 50 });
    expect(live.recentRequests[2]).toMatchObject({ cachedTokens: 40, cacheWriteTokens: 0 });
    expect((await db.getActiveRequests("nan")).recentRequests).toHaveLength(2);
    expect((await db.getActiveRequests("nan", "acct-b")).recentRequests).toHaveLength(1);
  });

  it.each(["24h", "7d", "all"])("account filter %s narrows stats and chart to one connection", async (period) => {
    const a = await db.getUsageStats(period, { provider: "nan", connectionId: "acct-a" });
    expect(a.totalRequests).toBe(1);
    expect(a.totalPromptTokens).toBe(100);
    expect(Object.values(a.byAccount).map((r) => r.connectionId)).toEqual(["acct-a"]);
    const sum = (rows) => rows.reduce((s, r) => s + r.tokens, 0);
    expect(sum(await db.getChartData(period, "nan", "acct-b"))).toBe(10);
  });
});

describe("privacy redaction", () => {
  it("replaces emails with a stable account tag and keeps other text", async () => {
    const { redactEmails } = await import("@/store/privacyStore.js");
    const out = redactEmails("gpt-5 (codex - Jane.Doe@example.com)");
    expect(out).not.toMatch(/@/);
    expect(out).toMatch(/^gpt-5 \(codex - Account #[0-9a-f]{4}\)$/);
    expect(redactEmails("jane.doe@example.com")).toBe(redactEmails("JANE.DOE@example.com"));
    expect(redactEmails("Work account")).toBe("Work account");
  });
});
