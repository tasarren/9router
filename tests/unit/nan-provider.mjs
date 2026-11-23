import assert from "node:assert/strict";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { parseUpstreamError } from "../../open-sse/utils/error.js";
import { formatNanUsage } from "../../open-sse/services/usage/nan.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

assert.equal(new Set(REGISTRY.map((item) => item.id)).size, REGISTRY.length, "provider IDs must be unique");
for (const id of ["nan", "tinyfish", "v1m", "muse", "minimax-code", "minimax-code-global", "bedrock", "bedrock-xai", "sensenova", "deepseek-web", "gemini-web", "muse-web", "chatgpt-web", "veoaifree-web", "uc-web"]) {
  assert.equal(REGISTRY.filter((item) => item.id === id).length, 1, `${id} must be registered once`);
}
for (const id of ["trae", "devin-cli", "windsurf"]) {
  assert.equal(REGISTRY.some((item) => item.id === id), false, `${id} must remain disabled`);
}
const nan = REGISTRY.find((item) => item.id === "nan");
assert(nan);
assert.equal(nan.models.find((item) => item.id === "rerank").kind, "rerank");
assert.equal(nan.models.find((item) => item.id === "flux-2-klein").kind, "image");
assert.equal(nan.imageConfig.editUrl, "https://api.nan.builders/v1/images/edits");
assert.equal(getCapabilitiesForModel("nan", "mimo-v2.5").audioInput, true);
assert.equal(getCapabilitiesForModel("nan", "glm5.3-flash").vision, true);
assert.equal(getCapabilitiesForModel("nan", "glm5.3").vision, false);
const retry = await parseUpstreamError(new Response('{"error":{"message":"slow down"}}', {
  status: 429, headers: { "retry-after": "60" },
}));
assert(retry.resetsAtMs > Date.now() + 59000 && retry.resetsAtMs < Date.now() + 61000);
// Shape of /v1/usage with credits (2026-11-23), trimmed.
const resetAt = "2026-12-01T15:06:22Z";
const fallback = "2026-12-01T00:00:00.000Z";
const rows = [
  { model: "deepseek-v4-flash", total_tokens: 2139091165, api_requests: 10796, credits: 439.4 },
  { model: "kimi-k3.1-pro", total_tokens: 24, api_requests: 1, credits: 0 },
  { model: "", total_tokens: 1, credits: 1 },
];
const credits = { period_start: "2026-11-01T15:06:22Z", period_end: resetAt, allowance: 7000, used: 2756.7, remaining: 4243.3, pack_credits: 0, frozen: false };
assert.deepEqual(formatNanUsage({ credits, totals: { by_model: rows } }, fallback), { plan: "NaN", quotas: {
  credits: { used: 2756.7, total: 7000, resetAt, unit: "credits" },
  "deepseek-v4-flash": { used: 439.4, total: 7000, resetAt, unit: "credits" },
  "kimi-k3.1-pro": { used: 0, total: 7000, resetAt, unit: "credits" },
} });
assert.equal(formatNanUsage({ credits: { ...credits, frozen: true }, totals: { by_model: [] } }, fallback).plan, "NaN (frozen)");
// credits: null (account not billed in credits) or broken pool: tokens, no limit.
for (const pool of [null, { ...credits, allowance: 0 }, { ...credits, used: "1" }]) {
  assert.deepEqual({ ...formatNanUsage({ credits: pool, totals: { by_model: rows } }, fallback).quotas }, {
    "deepseek-v4-flash": { used: 2139091165, total: 0, resetAt: fallback, unit: "tokens", limitUnknown: true, apiRequests: 10796 },
    "kimi-k3.1-pro": { used: 24, total: 0, resetAt: fallback, unit: "tokens", limitUnknown: true, apiRequests: 1 },
  });
}
for (const bad of [null, {}, { credits }]) assert.match(formatNanUsage(bad, fallback).message, /unavailable/i);
assert.equal(nan.transport.usage.url, "https://api.nan.builders/v1/usage");

const nanExec = new DefaultExecutor("nan");
const msgs = [{ role: "user", content: "hi" }];
assert.deepEqual(nanExec.transformRequest("gemma4", { messages: msgs, stream: true }, true, {}).stream_options, { include_usage: true });
assert.equal(nanExec.transformRequest("gemma4", { messages: msgs }, false, {}).stream_options, undefined);
assert.deepEqual(nanExec.transformRequest("gemma4", { messages: msgs, stream_options: { include_usage: false } }, true, {}).stream_options, { include_usage: false });
console.log("NaN provider and usage OK");
