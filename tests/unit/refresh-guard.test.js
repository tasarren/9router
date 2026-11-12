// Cross-process refresh guard: one lease per connection in SQLite, and a waiter
// adopts the tokens the lease holder saved instead of refreshing again.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-refresh-guard-"));
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

describe("lease", () => {
  it("is exclusive until released or expired", async () => {
    expect(await db.acquireLease("t", 60_000)).toBe(true);
    expect(await db.acquireLease("t", 60_000)).toBe(true); // same owner renews
    const adapter = await (await import("@/lib/db/driver.js")).getAdapter();
    adapter.run(`UPDATE kv SET value = ? WHERE scope = 'lease' AND key = 't'`, [`other|${Date.now() + 60_000}`]);
    expect(await db.acquireLease("t", 60_000)).toBe(false);
    adapter.run(`UPDATE kv SET value = ? WHERE scope = 'lease' AND key = 't'`, [`other|${Date.now() - 1}`]);
    expect(await db.acquireLease("t", 60_000)).toBe(true);
    await db.releaseLease("t");
    expect(adapter.get(`SELECT 1 AS x FROM kv WHERE scope = 'lease' AND key = 't'`)).toBeUndefined();
  });
});

describe("guardRefresh", () => {
  it("shares one refresh, saves it, and adopts tokens another process saved", async () => {
    const { guardRefresh } = await import("@/sse/services/refreshGuard.js");
    const conn = await db.createProviderConnection({
      provider: "codex", authType: "oauth", name: "a",
      accessToken: "old", refreshToken: "rt-1", expiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    const refresh = vi.fn(async () => ({ accessToken: "new", refreshToken: "rt-2", expiresIn: 3600 }));
    const creds = { connectionId: conn.id, accessToken: "old", refreshToken: "rt-1" };
    const [a, b] = await Promise.all([guardRefresh("codex", creds, refresh), guardRefresh("codex", creds, refresh)]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(a.accessToken).toBe("new");
    expect(b).toBe(a);
    expect((await db.getProviderConnectionById(conn.id)).refreshToken).toBe("rt-2");

    // A caller holding the stale copy adopts the saved tokens without refreshing.
    const stale = vi.fn();
    const adopted = await guardRefresh("codex", { connectionId: conn.id, accessToken: "old", refreshToken: "rt-1" }, stale);
    expect(stale).not.toHaveBeenCalled();
    expect(adopted).toMatchObject({ accessToken: "new", refreshToken: "rt-2" });
  });
});
