import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { U } from "./shared.js";

const finite = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;
const unavailable = (what) => ({ plan: "NaN", message: `NaN ${what} unavailable: missing or invalid counters` });

// Credits plan (/api/usage/credits, browser session only today): one shared pool,
// then one row per model with its share. Model rows use the pool as total so bars compare.
export function formatNanCredits(report) {
  if (report?.enabled !== true || !finite(report.allowanceCredits) || report.allowanceCredits <= 0
      || !finite(report.usedCredits)) return unavailable("credits");
  const resetAt = Number.isFinite(Date.parse(report.periodEnd)) ? report.periodEnd : null;
  const total = report.allowanceCredits;
  const quotas = { credits: { used: report.usedCredits, total, resetAt, unit: "credits" } };
  for (const m of Array.isArray(report.models) ? report.models : []) {
    if (typeof m?.model !== "string" || !m.model || !finite(m.creditsThisMonth)) continue;
    quotas[m.model] = { used: m.creditsThisMonth, total, resetAt, unit: "credits" };
  }
  return { plan: "NaN", quotas };
}

// Public /v1/usage report: tokens per model over the window, no limit published.
export function formatNanTokenUsage(report, resetAt) {
  const rows = report?.totals?.by_model;
  if (!Array.isArray(rows)) return unavailable("usage");
  const quotas = Object.create(null);
  for (const row of rows) {
    if (typeof row?.model !== "string" || !row.model || !Number.isSafeInteger(row.total_tokens)) continue;
    quotas[row.model] = {
      used: row.total_tokens, total: 0, resetAt, unit: "tokens", limitUnknown: true,
      apiRequests: Number.isSafeInteger(row.api_requests) ? row.api_requests : 0,
    };
  }
  return { plan: "NaN", quotas };
}

function get(url, apiKey, proxyOptions) {
  return proxyAwareFetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  }, proxyOptions);
}

export async function getNanUsage(apiKey, proxyOptions) {
  if (!apiKey) return { plan: "NaN", message: "NaN API key missing" };
  const { creditsUrl, url } = U("nan");
  // Credits endpoint answers 401 session_required to sk- keys today; picks up automatically once allowed.
  const credits = await get(creditsUrl, apiKey, proxyOptions).catch(() => null);
  if (credits?.ok) {
    const report = await credits.json().catch(() => null);
    if (report?.enabled === true) return formatNanCredits(report);
  }
  // ponytail: window = calendar month (UTC); NaN periods start on the 1st. Use credits periodStart if that changes.
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const resetAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  const response = await get(`${url}?start_date=${start.toISOString().slice(0, 10)}&limit=1`, apiKey, proxyOptions);
  if (!response.ok) return { plan: "NaN", message: `NaN usage: HTTP ${response.status}` };
  return formatNanTokenUsage(await response.json(), resetAt);
}
