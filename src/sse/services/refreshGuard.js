// Cross-process OAuth refresh guard. Processes that share one SQLite file (a
// start-first deploy, two replicas on one volume) must not refresh the same
// connection at the same time: providers that rotate refresh tokens (OpenAI,
// xAI, ...) revoke the whole session when an already-used one comes back.
// One refresh per connection holds a lease row in the database. A waiter then
// reads the connection and uses the tokens the other process saved.
import { AsyncLocalStorage } from "node:async_hooks";
import { acquireLease, releaseLease, getProviderConnectionById } from "../../lib/localDb.js";
import { isUnrecoverableRefreshError } from "open-sse/services/tokenRefresh.js";
import { updateProviderCredentials } from "./tokenRefresh.js";

const LEASE_MS = 60_000; // longer than any refresh call; a crashed owner frees it after this
const WAIT_MS = 30_000;
const EXPIRY_MARGIN_MS = 60_000;
const held = new AsyncLocalStorage(); // leases this call chain already holds (nested refresh)
const pending = new Map(); // same-process callers share one refresh

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hasToken = (r) => !!(r?.accessToken || r?.apiKey || r?.copilotToken);

// Tokens another process saved after the caller read its copy, if still valid.
function savedByOther(latest, credentials) {
  if (!latest?.accessToken || latest.accessToken === credentials.accessToken) return null;
  const expiresAt = Date.parse(latest.expiresAt || "");
  if (Number.isFinite(expiresAt) && expiresAt - Date.now() < EXPIRY_MARGIN_MS) return null;
  return {
    accessToken: latest.accessToken,
    ...(latest.refreshToken && { refreshToken: latest.refreshToken }),
    ...(latest.idToken && { idToken: latest.idToken }),
    ...(latest.expiresAt && { expiresAt: latest.expiresAt }),
    ...(latest.lastRefreshAt && { lastRefreshAt: latest.lastRefreshAt }),
    ...(latest.providerSpecificData && { providerSpecificData: latest.providerSpecificData }),
  };
}

async function lockedRefresh(key, connectionId, credentials, refreshFn) {
  const deadline = Date.now() + WAIT_MS;
  let waited = false;
  const acquire = async () => {
    try { return await acquireLease(key, LEASE_MS); } catch { return null; }
  };
  let got;
  while (!(got = await acquire())) {
    // Database unavailable: refresh unguarded rather than not at all.
    if (got === null) return refreshFn();
    // ponytail: a stuck owner falls back to an unguarded refresh after WAIT_MS.
    if (Date.now() > deadline) return refreshFn();
    waited = true;
    await sleep(250);
  }
  try {
    const latest = await getProviderConnectionById(connectionId).catch(() => null);
    const adopted = savedByOther(latest, credentials);
    if (adopted) return adopted;
    // Never refresh with a refresh token that a newer refresh already replaced.
    if (latest?.refreshToken && latest.refreshToken !== credentials.refreshToken) {
      credentials.refreshToken = latest.refreshToken;
    }
    const result = await refreshFn();
    // Save before the lease is released, so the next holder reads these tokens.
    if (hasToken(result) && !isUnrecoverableRefreshError(result)) {
      await updateProviderCredentials(connectionId, { ...result, existingProviderSpecificData: latest?.providerSpecificData });
    }
    if (waited && !hasToken(result)) console.log(`[refresh-guard] ${key}: refresh after wait returned no token`);
    return result;
  } finally {
    try { await releaseLease(key); } catch { /* lease expires by itself */ }
  }
}

export function guardRefresh(provider, credentials, refreshFn) {
  const connectionId = credentials?.connectionId || credentials?.id;
  if (!connectionId || connectionId === "noauth") return refreshFn();
  const key = `refresh:${connectionId}`;
  const holding = held.getStore();
  if (holding?.has(key)) return refreshFn();
  if (pending.has(key)) return pending.get(key);
  const run = held.run(new Set([...(holding || []), key]), () => lockedRefresh(key, connectionId, credentials, refreshFn))
    .finally(() => pending.delete(key));
  pending.set(key, run);
  return run;
}

// open-sse cannot import the database; it calls the guard through this global.
globalThis.__9rRefreshGuard = guardRefresh;
