import crypto from "node:crypto";
import { getAdapter } from "../driver.js";

// Short leases in the shared SQLite file, so processes that share one database
// (start-first deploys, two replicas on one volume) do not run the same job twice.
// A lease expires by itself, so a crashed owner blocks nobody for longer than ttlMs.
const OWNER = crypto.randomUUID();
const SCOPE = "lease";

export async function acquireLease(name, ttlMs) {
  const db = await getAdapter();
  const now = Date.now();
  // One statement, so it is atomic across processes: take the row when it is
  // missing, ours, or expired. value = "<owner>|<expiresAtMs>".
  const { changes } = db.run(
    `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?)
     ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value
     WHERE kv.value LIKE ? OR CAST(substr(kv.value, instr(kv.value, '|') + 1) AS INTEGER) <= ?`,
    [SCOPE, name, `${OWNER}|${now + ttlMs}`, `${OWNER}|%`, now]
  );
  return changes > 0;
}

export async function releaseLease(name) {
  const db = await getAdapter();
  db.run(`DELETE FROM kv WHERE scope = ? AND key = ? AND value LIKE ?`, [SCOPE, name, `${OWNER}|%`]);
}
