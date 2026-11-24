import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { usageErrorMessage } from "open-sse/services/usage/claude.js";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-reauth-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("OAuth re-auth", () => {
  it("replaces tokens on the chosen row and keeps its settings", async () => {
    const old = await db.createProviderConnection({
      provider: "claude", authType: "oauth", name: "TASA2U", accessToken: "old", refreshToken: "old-r",
      providerSpecificData: { blockedModels: ["claude-fable-*"], proxyPoolId: "p1" },
      testStatus: "error", lastError: "401",
    });

    const updated = await db.createProviderConnection({
      provider: "claude", authType: "oauth", accessToken: "new", refreshToken: "new-r",
      testStatus: "active", replaceId: old.id,
    });

    expect(updated.id).toBe(old.id);
    expect(updated.name).toBe("TASA2U");
    expect(updated.accessToken).toBe("new");
    expect(updated.lastError).toBeNull();
    expect(updated.providerSpecificData).toEqual({ blockedModels: ["claude-fable-*"], proxyPoolId: "p1" });
    expect(updated.replaceId).toBeUndefined();
    expect(await db.getProviderConnections({ provider: "claude" })).toHaveLength(1);
  });

  it("refuses a login from another account", async () => {
    const row = await db.createProviderConnection({ provider: "codex", authType: "oauth", email: "a@x.dev", accessToken: "t" });
    await expect(db.createProviderConnection({
      provider: "codex", authType: "oauth", email: "b@x.dev", accessToken: "t2", replaceId: row.id,
    })).rejects.toThrow(/a@x.dev/);
  });

  it("explains Claude usage failures", () => {
    expect(usageErrorMessage(401)).toMatchObject({ needsReauth: true, message: expect.stringMatching(/Re-auth/) });
    expect(usageErrorMessage(403, "scope missing").message).toContain('"scope missing"');
    expect(usageErrorMessage(500).needsReauth).toBeUndefined();
  });
});
