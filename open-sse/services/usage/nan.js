import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { U } from "./shared.js";

const finite = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;
// Account-wide credit pool row; the dashboard pins it above the per-model rows.
export const POOL_ROW = "Quota";
const unavailable = () => ({ plan: "NaN", message: "NaN usage unavailable: missing or invalid counters" });

// /v1/usage report. Credits plan: `credits` holds the account's period pool; by_model rows
// carry each model's spend from that pool. Only the pool row has a limit and a reset;
// model rows (`spendOnly`) show credits used, nothing remaining.
// Accounts without credits get `credits: null`: fall back to tokens with no published limit.
export function formatNanUsage(report, fallbackResetAt) {
  const rows = report?.totals?.by_model;
  if (!Array.isArray(rows)) return unavailable();
  const pool = report.credits;
  const usable = (r) => typeof r?.model === "string" && r.model;

  if (pool && finite(pool.allowance) && pool.allowance > 0 && finite(pool.used)) {
    const total = pool.allowance; // `used` counts the allowance only; pack credits are separate
    const resetAt = Number.isFinite(Date.parse(pool.period_end)) ? pool.period_end : fallbackResetAt;
    const remainingPercentage = pool.frozen ? 0 : Math.max(0, Math.round((1 - pool.used / total) * 100));
    const quotas = { [POOL_ROW]: { used: pool.used, total, resetAt, unit: "credits", remainingPercentage, pinned: true } };
    for (const r of rows) {
      if (usable(r) && finite(r.credits)) quotas[r.model] = { used: r.credits, total: 0, unit: "credits", spendOnly: true };
    }
    return { plan: pool.frozen ? "NaN (frozen)" : "NaN", quotas };
  }

  const quotas = Object.create(null);
  for (const r of rows) {
    if (!usable(r) || !Number.isSafeInteger(r.total_tokens)) continue;
    quotas[r.model] = {
      used: r.total_tokens, total: 0, resetAt: fallbackResetAt, unit: "tokens", limitUnknown: true,
      apiRequests: Number.isSafeInteger(r.api_requests) ? r.api_requests : 0,
    };
  }
  return { plan: "NaN", quotas };
}

export async function getNanUsage(apiKey, proxyOptions) {
  if (!apiKey) return { plan: "NaN", message: "NaN API key missing" };
  // ponytail: window = calendar month (UTC). Credits cover their own billing period whatever
  // the window; only the token fallback depends on it.
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const resetAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  const response = await proxyAwareFetch(`${U("nan").url}?start_date=${start.toISOString().slice(0, 10)}&limit=1`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  }, proxyOptions);
  if (!response.ok) return { plan: "NaN", message: `NaN usage: HTTP ${response.status}` };
  return formatNanUsage(await response.json().catch(() => null), resetAt);
}
