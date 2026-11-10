import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { U } from "./shared.js";

const finite = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;

// Credits plan (/api/usage/credits): one pool shared by every model.
// ponytail: pack credits and per-model creditsThisMonth not shown; add rows when the dashboard needs them.
function formatNanCredits(report) {
  if (!finite(report.allowanceCredits) || !finite(report.usedCredits) || report.allowanceCredits <= 0) {
    return { plan: "NaN", message: "NaN credits unavailable: missing or invalid counters" };
  }
  const resetAt = Number.isFinite(Date.parse(report.periodEnd)) ? report.periodEnd : null;
  return {
    plan: "NaN",
    quotas: { credits: { used: report.usedCredits, total: report.allowanceCredits, resetAt, unit: "credits" } },
  };
}

export function formatNanUsage(report) {
  if (report?.enabled === true) return formatNanCredits(report);
  const unavailable = { plan: "NaN", message: "NaN quota unavailable: missing or invalid model counters" };
  if (!Array.isArray(report?.models) || !report.models.length) return unavailable;
  const quotas = Object.create(null);
  for (const row of report.models) {
    if (typeof row?.model !== "string" || !row.model.trim() || Object.hasOwn(quotas, row.model)
        || !Number.isSafeInteger(row.tokensUsed) || row.tokensUsed < 0
        || !Number.isSafeInteger(row.cap) || row.cap <= 0) return unavailable;
    const resetAt = row.periodEnd ?? null;
    if (resetAt !== null && (typeof resetAt !== "string" || !Number.isFinite(Date.parse(resetAt)))) return unavailable;
    quotas[row.model] = { used: row.tokensUsed, total: row.cap, resetAt, unit: "tokens" };
  }
  return { plan: "NaN", quotas };
}

async function fetchJson(url, apiKey, proxyOptions) {
  return proxyAwareFetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  }, proxyOptions);
}

export async function getNanUsage(apiKey, proxyOptions) {
  if (!apiKey) return { plan: "NaN", message: "NaN API key missing" };
  const { creditsUrl, url } = U("nan");
  // Credits endpoint rejects sk- keys today (session_required); fall back to legacy per-model quota.
  const credits = await fetchJson(creditsUrl, apiKey, proxyOptions).catch(() => null);
  if (credits?.ok) {
    const report = await credits.json().catch(() => null);
    if (report?.enabled === true) return formatNanCredits(report);
  }
  const response = await fetchJson(url, apiKey, proxyOptions);
  if (!response.ok) return { plan: "NaN", message: `NaN usage: HTTP ${response.status}` };
  return formatNanUsage(await response.json());
}
